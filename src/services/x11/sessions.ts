import { randomUUID, randomBytes } from 'node:crypto';
import type { Client, ClientChannel } from 'ssh2';
import { createConnection } from 'node:net';
import { Connections } from '../ssh/connections';
import { authorityCookie, proxyX11 } from './proxy';
interface Session { id:string; owner:string; profileId:string; state:string; leaseId:string; client:Client; command?:ClientChannel; close():void }
export class X11Service {
  private cookie?:Buffer; private display=0;private sessions=new Map<string,Session>();private pending=0;private stopped=false;
  constructor(private connections:Connections){}
  configure(display:number,authority:Buffer){if(this.sessions.size||this.pending)throw new Error('请先停止 X11 会话。');this.cookie?.fill(0);this.cookie=authorityCookie(authority,display);this.display=display;return this.status();}
  status(){return {configured:!!this.cookie,display:this.display,sessions:[...this.sessions.values()].map(s=>({id:s.id,profileId:s.profileId,state:s.state}))};}
  async launch(owner:string,profileId:string,command:string){
    if(this.stopped)throw new Error('X11 服务已停止。');
    if(!this.cookie)throw new Error('请先启动带认证的本地 X Server，并选择 Xauthority 文件。');
    if(this.sessions.size+this.pending>=1)throw new Error('当前只允许一个 X11 信任域；请先关闭现有会话。');
    this.pending++;
    try{
      await new Promise<void>((resolve,reject)=>{const socket=createConnection({host:'127.0.0.1',port:6000+this.display});socket.setTimeout(2000,()=>socket.destroy(new Error('X Server 未响应。')));socket.once('connect',()=>{socket.destroy();resolve();});socket.once('error',reject);});
      const lease=await this.connections.acquire(owner,profileId),client=this.connections.get(owner,lease.connectionId).client;
      if(this.stopped){this.connections.release(owner,lease.leaseId);throw new Error('X11 服务已停止。');}
      const cookie=Buffer.from(this.cookie),fake=randomBytes(16),id=randomUUID(),channels=new Set<()=>void>();let closed=false;
      const handler=(_info:unknown,accept:()=>ClientChannel,reject:()=>void)=>{
        if(closed||channels.size>=32){reject();return;}
        const channel=accept();const cleanup=proxyX11(channel,fake,cookie,6000+this.display,()=>channels.delete(cleanup));channels.add(cleanup);
      };
      const close=()=>{if(closed)return;closed=true;client.removeListener('x11',handler);client.removeListener('close',close);for(const stop of channels)stop();session.command?.destroy();fake.fill(0);cookie.fill(0);this.connections.release(owner,lease.leaseId);this.sessions.delete(id);};
      const session:Session={id,owner,profileId,client,leaseId:lease.leaseId,state:'launching',close};this.sessions.set(id,session);client.on('x11',handler);client.once('close',close);
      try{
        await new Promise<void>((resolve,reject)=>{
          const timer=setTimeout(()=>{close();reject(new Error('X11 转发或命令启动超时。'));},15000);
          client.exec(command,{x11:{cookie:fake,protocol:'MIT-MAGIC-COOKIE-1',single:false,screen:0}},(error,stream)=>{
            clearTimeout(timer);if(error||closed){stream?.destroy();close();reject(new Error('X11 请求失败；请检查远端 xauth 和 sshd X11Forwarding。'));return;}
            session.command=stream;session.state='running';stream.resume();stream.stderr.resume();stream.on('error',close);
            stream.on('exit',(code:number)=>{session.state=code?'command-failed':'command-exited';});resolve();
          });
        });return {id};
      }catch(e){close();throw e;}
    }finally{this.pending--;}
  }
  close(owner:string,id:string){const session=this.sessions.get(id);if(!session)return;if(session.owner!==owner)throw new Error('无权关闭 X11 会话。');session.close();}
  stop(){this.stopped=true;for(const s of this.sessions.values())s.close();this.cookie?.fill(0);this.cookie=undefined;}
}
