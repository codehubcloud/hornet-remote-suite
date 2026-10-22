import { TerminalCodec } from './encoding';
import type { TerminalEncoding } from '../../packages/contracts/terminal-encoding';
import { createConnection,type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { userInfo } from 'node:os';
import type { HornetEvent,Profile } from '../../packages/contracts';
import { AppError } from '../../packages/core/errors';

interface Session {text:TerminalCodec;id:string;owner:string;profile:Profile;socket:Socket;ready:boolean;attached:boolean;seq:number;ack:number;input:number;bytes:number;pending:Map<number,number>;onHandshake?:()=>void;failHandshake?:(error:Error)=>void}

/** RFC 1282 rlogin over TCP. The remote host must explicitly trust the local user. */
export class RloginTerminals {
 private sessions=new Map<string,Session>();private stopped=false;
 constructor(private emit:(owner:string,event:HornetEvent)=>void){}
 has(id:string){return this.sessions.has(id);}
 hasProfile(id:string){return [...this.sessions.values()].some(s=>s.profile.profileId===id);}
 private get(owner:string,id:string){const s=this.sessions.get(id);if(!s||s.owner!==owner)throw new AppError('IPC005','终端已关闭或无权访问。');return s;}
 inspect(owner:string,id:string){this.get(owner,id);return {generation:1};}
 async open(owner:string,profile:Profile,cols:number,rows:number){
  if(profile.protocol!=='rlogin')throw new AppError('RLOGIN_PROTOCOL','请选择 RLOGIN 连接配置。');
  if(this.stopped||this.sessions.size>=32)throw new AppError('RLOGIN_LIMIT','RLOGIN 服务正在停止或会话已达到 32 个上限。');
  const id=randomUUID(),socket=createConnection({host:profile.host,port:profile.port});socket.setNoDelay(true);socket.setKeepAlive(true,30000);
  const s:Session={text:new TerminalCodec(profile.encoding),id,owner,profile,socket,ready:false,attached:false,seq:0,ack:0,input:0,bytes:0,pending:new Map()};
  this.sessions.set(id,s);
  this.emit(owner,{type:'connection.state',connectionId:id,profileId:profile.profileId,generation:1,state:'connecting'});
  socket.on('readable',()=>this.read(s));socket.on('error',error=>this.finish(s,error.message.slice(0,1000)));
  socket.on('end',()=>{this.flush(s);this.finish(s);});socket.on('close',()=>this.finish(s));
  try{
   await new Promise<void>((resolve,reject)=>{
    const localUser=(userInfo().username||process.env.USERNAME||process.env.USER||profile.username).replace(/[\x00-\x1f\x7f]/g,'').slice(0,255);
    const remoteUser=profile.username;
    const terminal=`${profile.session?.terminal?.type??'xterm-256color'}/38400`;
    let settled=false;
    const timer=setTimeout(()=>{fail(new AppError('RLOGIN_TIMEOUT','RLOGIN 连接或服务器信任确认超时。'));socket.destroy();},10000);
    const cleanup=()=>{clearTimeout(timer);socket.off('connect',connected);socket.off('error',failed);socket.off('close',closed);};
    const fail=(error:Error)=>{if(settled)return;settled=true;cleanup();reject(error);};
    const connected=()=>{socket.write(Buffer.concat([Buffer.from([0]),Buffer.from(localUser+'\0'+remoteUser+'\0'+terminal+'\0','utf8')]));};
    const failed=(error:Error)=>fail(new AppError('RLOGIN_CONNECT',`无法连接 RLOGIN 主机：${error.message}`));
    const closed=()=>fail(new AppError('RLOGIN_CONNECT','RLOGIN 连接已关闭。'));
    const ready=()=>{if(settled)return;settled=true;cleanup();s.ready=true;this.emit(owner,{type:'connection.state',connectionId:id,profileId:profile.profileId,generation:1,state:'ready'});resolve();};
    s.onHandshake=ready;
    s.failHandshake=fail;
    socket.once('connect',connected);socket.once('error',failed);socket.once('close',closed);
   });
   if(!this.sessions.has(id)||this.stopped)throw new AppError('RLOGIN_CONNECT','RLOGIN 连接已关闭。');
   return {terminalId:id,connectionId:id,generation:1};
  }catch(error){this.finish(s,error instanceof Error?error.message:'RLOGIN 连接失败。');throw error;}
 }
 encoding(owner:string,id:string,generation:number,encoding?:TerminalEncoding){const s=this.get(owner,id);if(generation!==1)throw new AppError('IPC005','终端版本已改变。');if(encoding&&encoding!==s.text.encoding){this.output(s,s.text.end());s.text=new TerminalCodec(encoding);}return s.text.encoding;}
 attach(owner:string,id:string){const s=this.get(owner,id);s.attached=true;this.flush(s);}
 private output(s:Session,data:Buffer){if(!data.length)return;const seq=++s.seq;s.bytes+=data.length;s.pending.set(seq,data.length);this.emit(s.owner,{type:'terminal.data',terminalId:s.id,generation:1,seq,data});}
 private read(s:Session){
  if(!this.sessions.has(s.id))return;
  try{
   if(!s.ready){const first=s.socket.read(1) as Buffer|null;if(!first)return;
    if(first[0]!==0){const rest=s.socket.read(Math.min(1024,s.socket.readableLength)) as Buffer|null;const message=Buffer.concat([first,rest??Buffer.alloc(0)]).toString('utf8').replace(/[\x00-\x1f]+/g,' ').trim();s.failHandshake?.(new AppError('RLOGIN_REJECTED',message||'RLOGIN 服务器拒绝连接，请检查两端用户名及主机信任配置。'));return;}
    s.onHandshake?.();
   }
   this.flush(s);
  }catch(error){this.finish(s,error instanceof Error?error.message:'RLOGIN 协议错误。');}
 }
 private flush(s:Session){
  if(!s.ready||!s.attached||!this.sessions.has(s.id))return;
  try{while(s.socket.readableLength&&s.bytes<1048564){const data=s.socket.read(Math.min(8192,Math.floor((1048576-s.bytes-9)/3),s.socket.readableLength)) as Buffer|null;if(!data)break;this.output(s,s.text.decode(data));}}
  catch(error){this.finish(s,error instanceof Error?error.message:'RLOGIN 协议错误。');}
 }
 ack(owner:string,id:string,seq:number){const s=this.get(owner,id),bytes=s.pending.get(seq);if(bytes===undefined||seq!==s.ack+1)throw new AppError('IPC002','终端确认序号不正确。');s.pending.delete(seq);s.bytes-=bytes;s.ack=seq;this.flush(s);}
 write(owner:string,id:string,generation:number,seq:number,data:string){
  const s=this.get(owner,id);if(generation!==1||seq!==s.input+1)throw new AppError('IPC002','终端输入版本已失效。');
  if(Buffer.byteLength(data)>32768||s.socket.writableLength>65536||s.bytes>1048576)throw new AppError('IPC002','终端输入过快。');
  s.input=seq;s.socket.write(s.text.encode(data));
 }
 resize(owner:string,id:string,generation:number,_cols:number,_rows:number){const s=this.get(owner,id);if(generation!==1)throw new AppError('IPC005','终端版本已改变。');}
 cwd(owner:string,id:string){this.get(owner,id);return {path:null,reason:'RLOGIN 不提供 SFTP 目录跟随。'};}
 close(owner:string,id:string){const s=this.sessions.get(id);if(!s)return;if(s.owner!==owner)throw new AppError('IPC005','无权关闭终端。');this.finish(s,undefined,'user');}
 private finish(s:Session,error?:string,reason:'remote'|'user'='remote'){
  if(!this.sessions.delete(s.id))return;
  s.failHandshake?.(new AppError('RLOGIN_CONNECT',error??'RLOGIN 连接已关闭。'));
  this.output(s,s.text.end());s.socket.destroy();
  const disconnect={reason:error?'error' as const:reason,at:Date.now(),error};
  this.emit(s.owner,{type:'connection.state',connectionId:s.id,profileId:s.profile.profileId,generation:1,state:error?'failed':'closed',error,disconnect});
  if(error)this.emit(s.owner,{type:'service.error',message:error});
  this.emit(s.owner,{type:'terminal.closed',terminalId:s.id,generation:1,disconnect});
 }
 stop(){this.stopped=true;for(const s of [...this.sessions.values()])this.finish(s);}
}
