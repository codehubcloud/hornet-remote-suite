import { app,powerMonitor,utilityProcess,type UtilityProcess } from 'electron';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { HornetEvent,Profile,Result } from '../../../packages/contracts';
import { AppError } from '../../../packages/core/errors';
import { Liveness } from '../../../packages/core/liveness';
import type { TransferContext } from '../../../services/file/tree-transfers';
import { Vault } from './vault';
export class Backend {
  private child!:UtilityProcess;
  private pending=new Map<string,{resolve:(data:unknown)=>void;reject:(e:Error)=>void;deadline:number}>();
  private health=new Liveness();private watchdog?:ReturnType<typeof setInterval>;private available=false;private stopping=false;private terminated=false;
  private suspend=()=>this.health.suspend();private resume=()=>this.health.resume();
  constructor(private vault:Vault,private emit:(event:HornetEvent)=>void,private stopped:()=>void=()=>{}) {}
  async start(userData:string){
    this.health=new Liveness();this.stopping=false;this.terminated=false;
    await new Promise<void>((resolve,reject)=>{
      const hostDirectory=app.isPackaged?__dirname.replace(/app\.asar(?=[\\/])/,'app.asar.unpacked'):__dirname;
      this.child=utilityProcess.fork(join(hostDirectory,'host.cjs'),[userData],{serviceName:'Hornet Protocol Host',stdio:'pipe'});
      const timeout=setTimeout(()=>{this.child.kill();reject(new Error('后台服务启动超时'));},15000);
      this.child.once('exit',()=>{this.available=false;this.stopped();clearTimeout(timeout);clearInterval(this.watchdog);powerMonitor.removeListener('suspend',this.suspend);powerMonitor.removeListener('resume',this.resume);reject(new Error('后台服务退出'));for(const p of this.pending.values())p.reject(new AppError('IPC004','后台服务已退出，请重启应用。'));this.pending.clear();if(!this.stopping)this.emit({type:'service.error',message:'连接服务已停止，请重启应用。'});});
      this.child.on('message',(m:{type:string;event?:HornetEvent;requestId:string;result?:Result<unknown>;profile?:Profile;error?:{code:string;message:string;retryable:boolean}})=>{
        if(m.type==='startup.failed'&&m.error){clearTimeout(timeout);reject(new AppError(m.error.code,m.error.message,m.error.retryable));return;}
        this.health.activity();
        if(m.type==='ready'){this.available=true;clearTimeout(timeout);resolve();}
        if(m.type==='event'&&m.event)this.emit(m.event);
        if(m.type==='vault.get'&&m.profile)this.child.postMessage({type:'vault.reply',requestId:m.requestId,secret:this.vault.get(m.profile)});
        if(m.type==='result'&&m.result){const p=this.pending.get(m.requestId);if(!p)return;this.pending.delete(m.requestId);m.result.ok?p.resolve(m.result.data):p.reject(new AppError(m.result.error.code,m.result.error.message,m.result.error.retryable));}
      });
      this.child.stderr?.on('data',data=>{if(process.env.HORNET_DIAGNOSTICS==='1')process.stderr.write(data);});
    });
    powerMonitor.on('suspend',this.suspend);powerMonitor.on('resume',this.resume);
    this.watchdog=setInterval(()=>{
      const state=this.health.poll(),now=this.health.time();
      if(state==='probe')try{this.child.postMessage({type:'ping'});}catch{/* The exit handler rejects pending requests. */}
      if(state==='unresponsive'){this.available=false;this.emit({type:'service.error',message:'后台服务失去响应，请重启应用。'});this.child.kill();return;}
      for(const [id,p]of this.pending)if(now>=p.deadline){this.pending.delete(id);p.reject(new AppError('IPC003','请求超时，操作结果请在任务中心核对。'));}
    },1000);
  }
  call<T>(method:string,payload:unknown={},context?:TransferContext,timeoutMs=120000):Promise<T>{
    const requestId=randomUUID();
    return new Promise((resolve,reject)=>{
      if(!this.available){reject(new AppError('IPC004','后台服务已退出，请重启应用。'));return;}
      this.pending.set(requestId,{resolve:data=>resolve(data as T),reject,deadline:this.health.time()+timeoutMs});
      try{this.child.postMessage({type:'call',requestId,owner:'local-user',method,payload,context});}catch{this.pending.delete(requestId);reject(new AppError('IPC004','后台服务已退出，请重启应用。'));}
    });
  }
  forceStop(){
    if(this.terminated)return;this.terminated=true;
    this.stopping=true;this.available=false;clearInterval(this.watchdog);
    powerMonitor.removeListener('suspend',this.suspend);powerMonitor.removeListener('resume',this.resume);
    for(const p of this.pending.values())p.reject(new AppError('IPC006','应用正在退出。'));this.pending.clear();
    this.child?.kill();
  }
  async stop(){this.stopping=true;try{if(this.available)await this.call('shutdown',{},undefined,10000);}finally{this.forceStop();}}
}
