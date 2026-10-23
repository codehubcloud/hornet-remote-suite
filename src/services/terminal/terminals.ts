import type { TerminalDisconnect } from '../../packages/contracts/terminal-disconnect';
import { TerminalCodec } from './encoding';
import type { TerminalEncoding } from '../../packages/contracts/terminal-encoding';
import { randomUUID } from 'node:crypto';
import type { ClientChannel } from 'ssh2';
import type { HornetEvent } from '../../packages/contracts';
import { Connections } from '../ssh/connections';
import { sftpDirectoryLink,execDirectoryLink } from './directory-link';
import { ShellIdentity } from './shell-identity';
import { AppError } from '../../packages/core/errors';
interface Session {raw?:{consume:(data:Buffer)=>void;close:()=>void}; codec:TerminalCodec; directoryViaExec:boolean;identity?:ShellIdentity;cwdPending?:Promise<{path:string|null;reason?:string}>;id:string;owner:string;connectionId:string;leaseId:string;generation:number;stream:ClientChannel;attached:boolean;seq:number;inputSeq:number;ackSeq:number;pending:Map<number,number>;bytes:number }
export class Terminals {
  private sessions=new Map<string,Session>();
  private unsubscribe:()=>void;
  constructor(private connections:Connections,private emit:(owner:string,event:HornetEvent)=>void) {
    // Transport failure must close every shell, including paused channels that
    // have not delivered their own close event yet.
    this.unsubscribe=connections.onClosed((owner,connectionId,disconnect)=>{for(const s of [...this.sessions.values()])if(s.owner===owner&&s.connectionId===connectionId)this.close(owner,s.id,disconnect);});
  }
  async create(owner:string,connectionId:string,cols:number,rows:number,trackDirectory=false) {
    const c=this.connections.get(owner,connectionId), lease=this.connections.retain(owner,connectionId);
    try {
      let linux=false,directoryViaExec=false;
      if(trackDirectory){
        const valid=(value:string|null)=>value!==null&&/^[1-9][0-9]{0,9}$/.test(value);
        linux=valid(await sftpDirectoryLink(()=>this.connections.sftp(owner,connectionId),'/proc/self'));
        if(!linux){linux=valid(await execDirectoryLink(c.client,'/proc/self'));directoryViaExec=linux;}
      }
      let identity=linux?new ShellIdentity():undefined;
      const stream=await new Promise<ClientChannel>((resolve,reject)=>{
        const term=c.profile.session?.terminal?.type??'xterm-256color';
        const callback=(err:Error|undefined,channel:ClientChannel)=>err?reject(new AppError('SSH004','无法打开远程终端。')):resolve(channel);
        if(identity)c.client.exec(identity.command,{pty:{term,cols,rows}},(error,channel)=>{if(error){identity=undefined;c.client.shell({term,cols,rows},callback);}else callback(undefined,channel);});
        else c.client.shell({term,cols,rows},callback);
      });
      try{this.connections.get(owner,connectionId);if(stream.destroyed||stream.readableEnded)throw new AppError('SSH006','连接已断开。');}catch(e){stream.destroy();throw e;}
      const s:Session={codec:new TerminalCodec(c.profile.encoding),directoryViaExec,identity,id:randomUUID(),owner,connectionId,leaseId:lease.leaseId,generation:c.generation,stream,attached:false,seq:0,inputSeq:0,ackSeq:0,pending:new Map(),bytes:0};
      this.sessions.set(s.id,s);
      stream.on('readable',()=>this.flush(s));
      stream.on('error',(error:Error)=>this.close(owner,s.id,{reason:'error',at:Date.now(),error:error.message.slice(0,1000)}));
      stream.on('close',()=>this.close(owner,s.id,{reason:'exit',at:Date.now()}));
      stream.on('end',()=>this.close(owner,s.id,{reason:'exit',at:Date.now()}));
      return {terminalId:s.id,generation:s.generation};
    }catch(e){this.connections.release(owner,lease.leaseId);throw e;}
  }
  private get(owner:string,id:string){const s=this.sessions.get(id);if(!s||s.owner!==owner)throw new AppError('IPC005','终端已关闭或无权访问。');return s;}
  binary(owner:string,id:string):import('./zmodem').BinaryTerminal{const s=this.get(owner,id);return {
    begin:(consume,close)=>{if(s.raw)throw new AppError('TERMINAL_BUSY','终端已有二进制传输。');s.raw={consume,close};this.emit(s.owner,{type:'terminal.binary',terminalId:s.id,active:true});this.flush(s);},
    write:data=>new Promise<void>((resolve,reject)=>{if(s.stream.destroyed){reject(new Error('终端已断开。'));return;}s.stream.write(data,error=>error?reject(error):resolve());}),
    output:data=>this.output(s,s.codec.decode(data)),end:()=>{s.raw=undefined;this.emit(s.owner,{type:'terminal.binary',terminalId:s.id,active:false});this.flush(s);}
  };}
  inspect(owner:string,id:string){return {generation:this.get(owner,id).generation};}
  encoding(owner:string,id:string,generation:number,encoding?:TerminalEncoding){const s=this.get(owner,id);if(generation!==s.generation)throw new AppError('IPC005','终端版本已改变。');if(encoding&&encoding!==s.codec.encoding){this.output(s,s.codec.end());s.codec=new TerminalCodec(encoding);}return s.codec.encoding;}
  private output(s:Session,data:Buffer){if(!data.length)return;const seq=++s.seq;s.pending.set(seq,data.length);s.bytes+=data.length;this.emit(s.owner,{type:'terminal.data',terminalId:s.id,generation:s.generation,seq,data});}
  detach(owner:string,id:string){const s=this.get(owner,id);if(s.raw)throw new AppError('TERMINAL_BUSY','请先完成或取消 ZMODEM 传输。');s.attached=false;return {inputSeq:s.inputSeq,seq:s.seq};}
 attach(owner:string,id:string){const s=this.get(owner,id);s.attached=true;this.flush(s);}
  private flush(s:Session){
    if(!s.attached)return;
    while(s.stream.readableLength>0&&(s.raw||s.bytes<1024*1024-12)){
      const size=Math.min(8192,s.raw?8192:Math.floor((1024*1024-s.bytes-9)/3),s.stream.readableLength);
      const data=s.stream.read(size) as Buffer|null;if(!data)break;
      if(s.raw){s.raw.consume(data);continue;}
      s.identity?.feed(data);
      this.output(s,s.codec.decode(data));
    }
  }
  async cwd(owner:string,id:string):Promise<{path:string|null;reason?:string}>{
    const s=this.get(owner,id);
    if(!s.identity?.pid)return {path:null,reason:s.identity?'正在获取 Shell 目录信息…':'目录跟随未初始化：请重新打开此终端；若仍失败，请检查远端 /proc 和 SSH exec 权限。'};
    if(s.cwdPending)return s.cwdPending;
    s.cwdPending=(async()=>{
      const procPath='/proc/'+s.identity!.pid+'/cwd';
      let path=s.directoryViaExec?null:await sftpDirectoryLink(()=>this.connections.sftp(owner,s.connectionId),procPath);
      if(!path){
        path=await execDirectoryLink(this.connections.get(owner,s.connectionId).client,procPath);
        if(path)s.directoryViaExec=true;
      }
      if(!path||!path.startsWith('/')||path.length>4096||/[\x00-\x1f\x7f]/.test(path))return {path:null,reason:'无法读取当前 Shell 目录：SFTP 与 SSH 查询均失败，请检查 /proc 访问权限。'};
      return {path};
    })();
    try{return await s.cwdPending;}finally{s.cwdPending=undefined;}
  }
  ack(owner:string,id:string,seq:number){
    const s=this.get(owner,id),bytes=s.pending.get(seq);
    if(bytes===undefined||seq!==s.ackSeq+1)throw new AppError('IPC002','终端确认序号不正确。');
    s.pending.delete(seq);s.bytes-=bytes;s.ackSeq=seq;this.flush(s);
  }
  write(owner:string,id:string,generation:number,seq:number,data:string){
    const s=this.get(owner,id);if(s.raw)throw new AppError('TERMINAL_BUSY','ZMODEM 传输期间暂停终端输入。');
    if(s.generation!==generation||seq!==s.inputSeq+1)throw new AppError('IPC002','终端输入版本已失效。');
    if(Buffer.byteLength(data)>32768||s.stream.writableLength>65536)throw new AppError('IPC002','终端输入过快。');
    s.inputSeq=seq;s.stream.write(s.codec.encode(data));
  }
  resize(owner:string,id:string,generation:number,cols:number,rows:number){const s=this.get(owner,id);if(s.generation!==generation)throw new AppError('IPC005','终端版本已改变。');s.stream.setWindow(rows,cols,0,0);}
  close(owner:string,id:string,disconnect:TerminalDisconnect={reason:'user',at:Date.now()}){const s=this.sessions.get(id);if(!s)return;if(s.owner!==owner)throw new AppError('IPC005','无权关闭终端。');s.raw?.close();this.output(s,s.codec.end());this.sessions.delete(id);s.stream.destroy();this.connections.release(owner,s.leaseId);this.emit(owner,{type:'terminal.closed',terminalId:id,generation:s.generation,disconnect});}
  stop(){this.unsubscribe();for(const s of [...this.sessions.values()])this.close(s.owner,s.id);}
}
