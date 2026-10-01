import { randomUUID, randomBytes } from 'node:crypto';
import type { Client, ClientChannel } from 'ssh2';
import { createConnection } from 'node:net';
import type { X11Session, X11Status, XServerOptions } from '../../packages/contracts/native';
import type { XServers } from './engine';
import { AppError, safeError } from '../../packages/core/errors';
import { Connections } from '../ssh/connections';
import { authorityCookie, proxyX11 } from './proxy';

interface Session {
  owner:string; snapshot:X11Session; abort:AbortController;
  channels:Set<()=>void>; cleanup:Set<()=>void|Promise<void>>; stopping?:Promise<void>;
}

// Reject promptly on cancellation, while still observing any late result/error.
function cancellable<T>(work:Promise<T>,signal:AbortSignal):Promise<T> {
  return new Promise((resolve,reject)=>{
    const cancel=()=>reject(signal.reason);
    if(signal.aborted)cancel();else signal.addEventListener('abort',cancel,{once:true});
    work.then(resolve,reject).finally(()=>signal.removeEventListener('abort',cancel));
  });
}

export class X11Service {
  private cookie?:Buffer;
  private display=0;
  private sessions=new Map<string,Session>();
  private stopped=false;
  constructor(private connections:Connections,private engines?:XServers){}

  configure(display:number,authority:Buffer){
    if(this.stopped)throw new AppError('IPC006','X11 服务已停止。');
    if(!Number.isInteger(display)||display<0||display>99)throw new AppError('IPC002','X11 显示号必须为 0–99。');
    if([...this.sessions.values()].some(s=>!s.abort.signal.aborted))throw new AppError('X11_DISPLAY_BUSY','请先停止 X11 会话。');
    // A bad replacement must not erase the working credential.
    let cookie:Buffer;
    try{cookie=authorityCookie(authority,display);}catch{throw new AppError('X11_AUTHORITY_INVALID','Xauthority 文件损坏或没有此显示号的 MIT-MAGIC-COOKIE-1。');}
    this.cookie?.fill(0);this.cookie=cookie;this.display=display;
    return this.status();
  }

  status(owner?:string):X11Status {
    return {configured:!!this.cookie,display:this.display,sessions:[...this.sessions.values()]
      .filter(s=>owner===undefined||s.owner===owner).map(s=>({...s.snapshot}))};
  }

  private dispose(s:Session,error:AppError){
    if(s.abort.signal.aborted)return s.stopping??Promise.resolve();
    s.abort.abort(error);
    const pending:Promise<void>[]=[];
    for(const cleanup of s.cleanup){const result=cleanup();if(result)pending.push(result);}
    s.cleanup.clear();
    for(const close of [...s.channels])close();
    s.channels.clear();s.snapshot.activeChannels=0;
    return s.stopping=Promise.all(pending).then(()=>{});
  }

  private fail(s:Session,error:AppError){
    if(s.abort.signal.aborted)return;
    s.snapshot.state='failed';s.snapshot.error=error.message;
    void this.dispose(s,error);
  }

  async launch(owner:string,profileId:string,command:string,managed?:XServerOptions){
    if(this.stopped)throw new AppError('IPC006','X11 服务已停止。');
    if(!managed&&!this.cookie)throw new AppError('X11_ENGINE_MISSING','请先启动带认证的本地 X Server，并选择 Xauthority 文件。');
    if(managed&&!this.engines)throw new AppError('X11_ENGINE_MISSING','受管理的 X Server 不可用。');
    const active=[...this.sessions.values()].filter(s=>!s.abort.signal.aborted);
    if(active.length>=8||(!managed&&active.some(s=>!s.snapshot.managed)))throw new AppError('X11_DISPLAY_BUSY','独立显示最多 8 个，外部显示只允许一个转发会话。');
    // Retain a bounded failure history, without retaining credentials or streams.
    while(this.sessions.size>=20){const old=[...this.sessions.values()].find(s=>s.abort.signal.aborted);if(!old)break;this.sessions.delete(old.snapshot.id);}
    const id=randomUUID(),cookie=managed?Buffer.alloc(16):Buffer.from(this.cookie!),fake=randomBytes(16);
    let port=6000+this.display;
    const s:Session={owner,snapshot:{id,profileId,command,state:'preparing',activeChannels:0,managed:!!managed,display:managed?undefined:this.display},abort:new AbortController(),channels:new Set(),cleanup:new Set()};
    s.cleanup.add(()=>{fake.fill(0);cookie.fill(0);});
    this.sessions.set(id,s);
    const signal=s.abort.signal;
    try{
      if(managed){
        s.snapshot.state='startingServer';
        const engine=await this.engines!.start(managed,signal,error=>this.fail(s,error));
        s.cleanup.add(()=>engine.stop());
        engine.cookie.copy(cookie);port=engine.port;s.snapshot.display=engine.display;
      }else await cancellable(new Promise<void>((resolve,reject)=>{
        const socket=createConnection({host:'127.0.0.1',port});
        const close=()=>{socket.destroy();};s.cleanup.add(close);
        socket.setTimeout(2000,()=>socket.destroy(new Error('timeout')));
        socket.once('connect',()=>{socket.destroy();resolve();});
        socket.once('error',()=>reject(new AppError('X11_ENGINE_MISSING','无法连接本地 X Server，请检查显示号、监听端口和服务状态。')));
        socket.once('close',()=>s.cleanup.delete(close));
      }),signal);
      signal.throwIfAborted();s.snapshot.state='connecting';
      // Dedicated SSH transport prevents X11 channel acceptance from crossing display sessions.
      const acquiring=managed?this.connections.acquireIsolated(owner,profileId):this.connections.acquire(owner,profileId);
      const lease=await cancellable(acquiring.then(lease=>{
        // Authentication may be shared by other views, so only release our lease.
        if(signal.aborted)this.connections.release(owner,lease.leaseId);
        else s.cleanup.add(()=>this.connections.release(owner,lease.leaseId));
        return lease;
      }),signal);
      signal.throwIfAborted();
      const client=this.connections.get(owner,lease.connectionId).client;
      const disconnected=()=>this.fail(s,new AppError('SSH006','SSH 连接已断开，X11 转发已停止。'));
      const handler=(_info:unknown,accept:()=>ClientChannel,reject:()=>void)=>{
        if(signal.aborted||s.channels.size>=32){reject();return;}
        const channel=accept();
        const cleanup=proxyX11(channel,fake,cookie,port,error=>{
          s.channels.delete(cleanup);s.snapshot.activeChannels=s.channels.size;
          if(error&&!signal.aborted)s.snapshot.error=error.message;
        });
        s.channels.add(cleanup);s.snapshot.activeChannels=s.channels.size;
      };
      client.on('x11',handler);client.once('close',disconnected);client.once('error',disconnected);
      s.cleanup.add(()=>{client.removeListener('x11',handler);client.removeListener('close',disconnected);client.removeListener('error',disconnected);});
      s.snapshot.state='launching';
      await this.startCommand(s,client,command,fake);
      signal.throwIfAborted();return {id};
    }catch(error){
      if(!signal.aborted){const detail=safeError(error);this.fail(s,new AppError(detail.code,detail.message,detail.retryable));}
      throw signal.reason;
    }
  }

  private async startCommand(s:Session,client:Client,command:string,fake:Buffer){
    const signal=s.abort.signal;
    const timer=setTimeout(()=>this.fail(s,new AppError('X11_LAUNCH_FAILED','X11 转发或命令启动超时。')),15000);
    const clear=()=>clearTimeout(timer);s.cleanup.add(clear);
    try{
      await cancellable(new Promise<void>((resolve,reject)=>{
        client.exec(command,{x11:{cookie:fake,protocol:'MIT-MAGIC-COOKIE-1',single:false,screen:0}},(error,stream)=>{
          if(signal.aborted){stream?.on('error',()=>{});stream?.destroy();return;}
          if(error){reject(new AppError('X11_FORWARD_DENIED','X11 请求失败；请检查远端 xauth 和 sshd X11Forwarding。'));return;}
          s.cleanup.add(()=>{stream.destroy();});
          s.snapshot.state='running';
          stream.on('error',()=>this.fail(s,new AppError('X11_LAUNCH_FAILED','远端 X11 启动命令通道异常。')));
          stream.on('exit',(code:number|null,signalName?:string)=>{
            if(signal.aborted)return;
            if(typeof code==='number')s.snapshot.exitCode=code;
            if(signalName)s.snapshot.signal=signalName.replace(/[^A-Za-z0-9_-]/g,'').slice(0,32);
            if((code!==null&&code!==0)||signalName){
              this.fail(s,new AppError('X11_LAUNCH_FAILED',signalName?'远端 X11 命令被信号终止。':'远端 X11 命令执行失败，退出码 '+code+'。'));
            }else s.snapshot.state='command-exited';
          });
          stream.on('close',()=>{if(!signal.aborted&&s.snapshot.state==='running')s.snapshot.state='command-exited';});
          // A launcher may exit before its background X clients. Stop forwarding explicitly.
          stream.resume();stream.stderr.resume();resolve();
        });
      }),signal);
    }finally{clear();s.cleanup.delete(clear);}
  }

  close(owner:string,id:string){
    const s=this.sessions.get(id);if(!s)return;
    if(s.owner!==owner)throw new AppError('IPC005','无权关闭 X11 会话。');
    const stopping=this.dispose(s,new AppError('IPC006','X11 会话已停止。'));this.sessions.delete(id);return stopping;
  }
  stop(){
    this.stopped=true;
    const pending=[...this.sessions.values()].map(s=>this.dispose(s,new AppError('IPC006','X11 服务已停止。')));
    this.sessions.clear();this.cookie?.fill(0);this.cookie=undefined;
    return Promise.all(pending).then(()=>{});
  }
}
