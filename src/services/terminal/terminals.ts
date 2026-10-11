import { TerminalCodec } from './encoding';
import type { TerminalEncoding } from '../../packages/contracts/terminal-encoding';
import { randomUUID } from 'node:crypto';
import type { ClientChannel } from 'ssh2';
import type { HornetEvent } from '../../packages/contracts';
import { Connections } from '../ssh/connections';
import { sftpDirectoryLink,execDirectoryLink } from './directory-link';
import { ShellIdentity } from './shell-identity';
import { AppError } from '../../packages/core/errors';
interface Session { codec:TerminalCodec; directoryViaExec:boolean;identity?:ShellIdentity;cwdPending?:Promise<{path:string|null;reason?:string}>;id:string;owner:string;connectionId:string;leaseId:string;generation:number;stream:ClientChannel;attached:boolean;seq:number;inputSeq:number;ackSeq:number;pending:Map<number,number>;bytes:number }
export class Terminals {
  private sessions=new Map<string,Session>();
  constructor(private connections:Connections,private emit:(owner:string,event:HornetEvent)=>void) {}
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
        const callback=(err:Error|undefined,channel:ClientChannel)=>err?reject(new AppError('SSH004','无法打开远程终端。')):resolve(channel);
        if(identity)c.client.exec(identity.command,{pty:{term:'xterm-256color',cols,rows}},(error,channel)=>{if(error){identity=undefined;c.client.shell({term:'xterm-256color',cols,rows},callback);}else callback(undefined,channel);});
        else c.client.shell({term:'xterm-256color',cols,rows},callback);
      });
      const s:Session={codec:new TerminalCodec(c.profile.encoding),directoryViaExec,identity,id:randomUUID(),owner,connectionId,leaseId:lease.leaseId,generation:c.generation,stream,attached:false,seq:0,inputSeq:0,ackSeq:0,pending:new Map(),bytes:0};
      this.sessions.set(s.id,s);
      stream.on('readable',()=>this.flush(s));
      stream.on('error',()=>this.close(owner,s.id));
      stream.on('close',()=>this.close(owner,s.id));
      return {terminalId:s.id,generation:s.generation};
    }catch(e){this.connections.release(owner,lease.leaseId);throw e;}
  }
  private get(owner:string,id:string){const s=this.sessions.get(id);if(!s||s.owner!==owner)throw new AppError('IPC005','终端已关闭或无权访问。');return s;}
  inspect(owner:string,id:string){return {generation:this.get(owner,id).generation};}
  encoding(owner:string,id:string,generation:number,encoding?:TerminalEncoding){const s=this.get(owner,id);if(generation!==s.generation)throw new AppError('IPC005','终端版本已改变。');if(encoding&&encoding!==s.codec.encoding){this.output(s,s.codec.end());s.codec=new TerminalCodec(encoding);}return s.codec.encoding;}
  private output(s:Session,data:Buffer){if(!data.length)return;const seq=++s.seq;s.pending.set(seq,data.length);s.bytes+=data.length;this.emit(s.owner,{type:'terminal.data',terminalId:s.id,generation:s.generation,seq,data});}
  attach(owner:string,id:string){const s=this.get(owner,id);s.attached=true;this.flush(s);}
  private flush(s:Session){
    if(!s.attached)return;
    while(s.stream.readableLength>0&&s.bytes<1024*1024-12){
      const size=Math.min(8192,Math.floor((1024*1024-s.bytes-9)/3),s.stream.readableLength);
      const data=s.stream.read(size) as Buffer|null;if(!data)break;
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
    const s=this.get(owner,id);
    if(s.generation!==generation||seq!==s.inputSeq+1)throw new AppError('IPC002','终端输入版本已失效。');
    if(Buffer.byteLength(data)>32768||s.stream.writableLength>65536)throw new AppError('IPC002','终端输入过快。');
    s.inputSeq=seq;s.stream.write(s.codec.encode(data));
  }
  resize(owner:string,id:string,generation:number,cols:number,rows:number){const s=this.get(owner,id);if(s.generation!==generation)throw new AppError('IPC005','终端版本已改变。');s.stream.setWindow(rows,cols,0,0);}
  close(owner:string,id:string){const s=this.sessions.get(id);if(!s)return;if(s.owner!==owner)throw new AppError('IPC005','无权关闭终端。');this.output(s,s.codec.end());this.sessions.delete(id);s.stream.destroy();this.connections.release(owner,s.leaseId);this.emit(owner,{type:'terminal.closed',terminalId:id});}
  stop(){for(const s of [...this.sessions.values()])this.close(s.owner,s.id);}
}
