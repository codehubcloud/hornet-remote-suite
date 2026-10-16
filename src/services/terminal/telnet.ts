import { TerminalCodec } from './encoding';
import type { TerminalEncoding } from '../../packages/contracts/terminal-encoding';
import { createConnection,type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import type { HornetEvent,Profile } from '../../packages/contracts';
import { AppError } from '../../packages/core/errors';
import { TelnetCodec } from './telnet-codec';
interface Session {text:TerminalCodec;id:string;owner:string;profile:Profile;socket:Socket;codec:TelnetCodec;ready:boolean;attached:boolean;seq:number;ack:number;input:number;bytes:number;pending:Map<number,number>}
export class TelnetTerminals {
 private sessions=new Map<string,Session>();private stopped=false;
 constructor(private emit:(owner:string,event:HornetEvent)=>void){}
 has(id:string){return this.sessions.has(id);}
 hasProfile(id:string){return [...this.sessions.values()].some(s=>s.profile.profileId===id);}
 private get(owner:string,id:string){const s=this.sessions.get(id);if(!s||s.owner!==owner)throw new AppError('IPC005','终端已关闭或无权访问。');return s;}
 inspect(owner:string,id:string){this.get(owner,id);return {generation:1};}
 async open(owner:string,profile:Profile,cols:number,rows:number){
  if(profile.protocol!=='telnet')throw new AppError('TELNET_PROTOCOL','请选择 Telnet 连接配置。');
  if(this.stopped||this.sessions.size>=32)throw new AppError('TELNET_LIMIT','Telnet 服务正在停止或会话已达 32 个上限。');
  const id=randomUUID(),socket=createConnection({host:profile.host,port:profile.port});
  socket.setNoDelay(true);socket.setKeepAlive(true,30000);
  const codec=new TelnetCodec(data=>{if(socket.writableLength>262144)throw new AppError('TELNET_LIMIT','Telnet 发送缓冲区已满。');socket.write(data);},cols,rows,profile.session?.terminal?.type);
  const s:Session={text:new TerminalCodec(profile.encoding),id,owner,profile,socket,codec,ready:false,attached:false,seq:0,ack:0,input:0,bytes:0,pending:new Map()};
  this.sessions.set(id,s);
  this.emit(owner,{type:'connection.state',connectionId:id,profileId:profile.profileId,generation:1,state:'connecting'});
  socket.on('readable',()=>this.flush(s));
  socket.on('error',()=>this.finish(s,'Telnet 连接失败或已中断。'));
  socket.on('end',()=>{this.flush(s);this.finish(s);});socket.on('close',()=>this.finish(s));
  try{
   await new Promise<void>((resolve,reject)=>{
    const timer=setTimeout(()=>{socket.destroy();reject(new AppError('TELNET_TIMEOUT','Telnet 连接超时。'));},10000);
    const cleanup=()=>{clearTimeout(timer);socket.off('connect',connected);socket.off('error',failed);socket.off('close',closed);};
    const connected=()=>{cleanup();resolve();},failed=()=>{cleanup();reject(new AppError('TELNET_CONNECT','无法连接 Telnet 主机。'));},closed=()=>{cleanup();reject(new AppError('TELNET_CONNECT','Telnet 连接已关闭。'));};
    socket.once('connect',connected);socket.once('error',failed);socket.once('close',closed);
   });
   if(!this.sessions.has(id)||this.stopped)throw new AppError('TELNET_CONNECT','Telnet 连接已关闭。');
   s.ready=true;codec.start();
   this.emit(owner,{type:'connection.state',connectionId:id,profileId:profile.profileId,generation:1,state:'ready'});
   return {terminalId:id,connectionId:id,generation:1};
  }catch(e){this.finish(s);throw e;}
 }
 encoding(owner:string,id:string,generation:number,encoding?:TerminalEncoding){const s=this.get(owner,id);if(generation!==1)throw new AppError('IPC005','终端版本已改变。');if(encoding&&encoding!==s.text.encoding){this.output(s,s.text.end());s.text=new TerminalCodec(encoding);}return s.text.encoding;}
 attach(owner:string,id:string){const s=this.get(owner,id);s.attached=true;this.flush(s);}
 private output(s:Session,data:Buffer){if(!data.length)return;const seq=++s.seq;s.bytes+=data.length;s.pending.set(seq,data.length);this.emit(s.owner,{type:'terminal.data',terminalId:s.id,generation:1,seq,data});}
 private flush(s:Session){
  if(!s.attached||!this.sessions.has(s.id))return;
  try{while(s.socket.readableLength&&s.bytes<1048564){const data=s.socket.read(Math.min(Math.min(8192,Math.floor((1048576-s.bytes-9)/3)),s.socket.readableLength)) as Buffer|null;if(!data)break;this.output(s,s.text.decode(s.codec.feed(data)));}}
  catch(e){this.finish(s,e instanceof Error?e.message:'Telnet 协议错误。');}
 }
 ack(owner:string,id:string,seq:number){const s=this.get(owner,id),bytes=s.pending.get(seq);if(bytes===undefined||seq!==s.ack+1)throw new AppError('IPC002','终端确认序号不正确。');s.pending.delete(seq);s.bytes-=bytes;s.ack=seq;this.flush(s);}
 write(owner:string,id:string,generation:number,seq:number,data:string){
  const s=this.get(owner,id);
  if(generation!==1||seq!==s.input+1)throw new AppError('IPC002','终端输入版本已失效。');
  if(Buffer.byteLength(data)>32768)throw new AppError('IPC002','终端输入过快。');
  const echo=s.codec.remoteEcho?Buffer.alloc(0):Buffer.from(data.replace(/\r\n|\r|\n/g,'\r\n').replace(/[\x08\x7f]/g,'\b \b'));
  if(s.socket.writableLength>65536||s.bytes>1048576-Math.max(32768,echo.length))throw new AppError('IPC002','终端输入过快。');
  s.input=seq;s.socket.write(s.codec.encode(data,text=>s.text.encode(text)));
  this.output(s,echo);
 }
 resize(owner:string,id:string,generation:number,cols:number,rows:number){const s=this.get(owner,id);if(generation!==1)throw new AppError('IPC005','终端版本已改变。');try{s.codec.resize(cols,rows);}catch(e){this.finish(s,(e as Error).message);}}
 cwd(owner:string,id:string){this.get(owner,id);return {path:null,reason:'Telnet 不提供 SFTP 目录跟随。'};}
 close(owner:string,id:string){const s=this.sessions.get(id);if(!s)return;if(s.owner!==owner)throw new AppError('IPC005','无权关闭终端。');this.finish(s);}
 private finish(s:Session,error?:string){if(!this.sessions.delete(s.id))return;this.output(s,s.text.end());s.socket.destroy();this.emit(s.owner,{type:'connection.state',connectionId:s.id,profileId:s.profile.profileId,generation:1,state:error?'failed':'closed',error});if(error)this.emit(s.owner,{type:'service.error',message:error});this.emit(s.owner,{type:'terminal.closed',terminalId:s.id});}
 stop(){this.stopped=true;for(const s of [...this.sessions.values()])this.finish(s);}
}
