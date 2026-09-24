import { utilityProcess,type UtilityProcess } from 'electron';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { HornetEvent,Profile,Result } from '../../../packages/contracts';
import { AppError } from '../../../packages/core/errors';
import { Vault } from './vault';
export class Backend {
  private child!:UtilityProcess;
  private pending=new Map<string,{resolve:(data:unknown)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  private beat=Date.now();private watchdog?:ReturnType<typeof setInterval>;
  constructor(private vault:Vault,private emit:(event:HornetEvent)=>void) {}
  async start(userData:string){
    await new Promise<void>((resolve,reject)=>{
      this.child=utilityProcess.fork(join(__dirname,'host.cjs'),[userData],{serviceName:'Hornet Protocol Host',stdio:'pipe'});
      const timeout=setTimeout(()=>{this.child.kill();reject(new Error('后台服务启动超时'));},15000);
      this.child.once('exit',()=>{clearTimeout(timeout);clearInterval(this.watchdog);reject(new Error('后台服务退出'));for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new AppError('IPC004','后台服务已退出，请重启应用。'));}this.pending.clear();this.emit({type:'service.error',message:'连接服务已停止，请重启应用。'});});
      this.child.on('message',(m:{type:string;event?:HornetEvent;requestId:string;result?:Result<unknown>;profile?:Profile})=>{
        if(m.type==='ready'){clearTimeout(timeout);resolve();}
        if(m.type==='heartbeat')this.beat=Date.now();
        if(m.type==='event'&&m.event)this.emit(m.event);
        if(m.type==='vault.get'&&m.profile)this.child.postMessage({type:'vault.reply',requestId:m.requestId,secret:this.vault.get(m.profile)});
        if(m.type==='result'&&m.result){const p=this.pending.get(m.requestId);if(!p)return;clearTimeout(p.timer);this.pending.delete(m.requestId);m.result.ok?p.resolve(m.result.data):p.reject(new AppError(m.result.error.code,m.result.error.message,m.result.error.retryable));}
      });
      this.child.stderr?.on('data',data=>{if(process.env.HORNET_DIAGNOSTICS==='1')process.stderr.write(data);});
    });
    this.watchdog=setInterval(()=>{if(Date.now()-this.beat>20000){this.emit({type:'service.error',message:'后台服务失去响应，请重启应用。'});this.child.kill();}},5000);
  }
  call<T>(method:string,payload:unknown={},context?:{localPath:string;localParent:string},timeoutMs=120000):Promise<T>{
    const requestId=randomUUID();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(requestId);reject(new AppError('IPC003','请求超时，操作结果请在任务中心核对。'));},timeoutMs);
      this.pending.set(requestId,{resolve:data=>resolve(data as T),reject,timer});
      this.child.postMessage({type:'call',requestId,owner:'local-user',method,payload,context});
    });
  }
  async stop(){clearInterval(this.watchdog);try{await this.call('shutdown',{},undefined,10000);}finally{this.child.kill();}}
}
