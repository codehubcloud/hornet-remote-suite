import type { TerminalEncoding } from '../../packages/contracts/terminal-encoding';
import { randomUUID } from 'node:crypto';
import type { HornetEvent } from '../../packages/contracts';
import type { DeviceTerminal } from '../../packages/contracts/device-terminal';
import { AppError } from '../../packages/core/errors';

export interface TerminalDriver {
 encoding?(encoding?:TerminalEncoding):TerminalEncoding;write(data:string):void;resize(cols:number,rows:number):void;pause():void;resume():void;close():Promise<void>;
}
export interface DriverEvents {data(data:Buffer):void;end(error?:string):void}
interface Session {
 owner:string;descriptor:DeviceTerminal;key?:string;driver?:TerminalDriver;attached:boolean;ended:boolean;error?:string;
 queue:Buffer[];queued:number;pending:Map<number,number>;outstanding:number;seq:number;ack:number;input:number;
 windowStart:number;windowBytes:number;closing?:Promise<void>;
}
// Device adapters share the same ownership, ACK and lifecycle contract as SSH.
// Pause at 512KiB, with a hard 1MiB ceiling for a driver that ignores pause.
export class DeviceTerminals {
 private sessions=new Map<string,Session>();private stopped=false;
 constructor(private emit:(owner:string,event:HornetEvent)=>void){}
 has(id:string){return this.sessions.has(id);}
 private get(owner:string,id:string){const s=this.sessions.get(id);if(!s||s.owner!==owner||s.closing)throw new AppError('IPC005','终端已关闭或无权访问。');return s;}
 inspect(owner:string,id:string){this.get(owner,id);return {generation:1};}
 encoding(owner:string,id:string,generation:number,encoding?:TerminalEncoding){const s=this.get(owner,id);if(generation!==1)throw new AppError('IPC005','终端版本已改变。');if(s.driver?.encoding)return s.driver.encoding(encoding);if(encoding&&encoding!=='utf8')throw new AppError('ENCODING_LOCAL','本地 ConPTY 终端使用 Unicode，不支持切换传输编码。');return 'utf8' as const;}
 async open(owner:string,info:{name:string;address:string;source:'local'|'serial';key?:string},factory:(events:DriverEvents)=>Promise<TerminalDriver>):Promise<DeviceTerminal>{
  if(this.stopped||this.sessions.size>=16)throw new AppError('DEVICE_LIMIT','本地/串口终端已达到16个上限或服务正在停止。');
  if(info.key&&[...this.sessions.values()].some(s=>s.key===info.key))throw new AppError('DEVICE_BUSY','此串口已在本应用中打开，请先关闭原终端。');
  const id=randomUUID(),descriptor:DeviceTerminal={terminalId:id,connectionId:id,generation:1,name:info.name,address:info.address,source:info.source};
  const s:Session={owner,descriptor,key:info.key,attached:false,ended:false,queue:[],queued:0,pending:new Map(),outstanding:0,seq:0,ack:0,input:0,windowStart:Date.now(),windowBytes:0};
  this.sessions.set(id,s);
  try{
   const driver=await factory({data:data=>this.receive(s,data),end:error=>{s.ended=true;s.error=error;this.flush(s);}});
   s.driver=driver;
   if(this.stopped||s.closing){await driver.close();throw new AppError('DEVICE_CLOSED','终端启动已取消。');}
   driver.pause();this.state(s,'ready');return descriptor;
  }catch(e){await this.finish(s,e instanceof Error?e.message:'设备终端启动失败。');throw e;}
 }
 private state(s:Session,state:string,error?:string){this.emit(s.owner,{type:'connection.state',connectionId:s.descriptor.connectionId,profileId:s.descriptor.connectionId,generation:1,state,error});}
 private receive(s:Session,data:Buffer){
  if(s.closing||!data.length)return;
  if(s.queued+s.outstanding+data.length>1048576){void this.finish(s,'终端输出超过缓冲上限，已关闭会话。');return;}
  s.queue.push(Buffer.from(data));s.queued+=data.length;this.flush(s);
 }
 private flush(s:Session){
  if(s.closing)return;
  if(s.attached){while(s.queue.length&&s.outstanding<524288){const head=s.queue[0],length=Math.min(head.length,32768,524288-s.outstanding),data=head.subarray(0,length);if(length===head.length)s.queue.shift();else s.queue[0]=head.subarray(length);s.queued-=length;s.outstanding+=length;const seq=++s.seq;s.pending.set(seq,length);this.emit(s.owner,{type:'terminal.data',terminalId:s.descriptor.terminalId,generation:1,seq,data});}}
  if(s.ended&&s.attached&&!s.queued){void this.finish(s,s.error);return;}
  if(!s.attached||s.queued+s.outstanding>=524288)s.driver?.pause();else s.driver?.resume();
 }
 attach(owner:string,id:string){const s=this.get(owner,id);s.attached=true;this.flush(s);}
 ack(owner:string,id:string,seq:number){const s=this.get(owner,id),bytes=s.pending.get(seq);if(bytes===undefined||seq!==s.ack+1)throw new AppError('IPC002','终端确认序号不正确。');s.pending.delete(seq);s.ack=seq;s.outstanding-=bytes;this.flush(s);}
 write(owner:string,id:string,generation:number,seq:number,data:string){
  const s=this.get(owner,id);if(generation!==1||seq!==s.input+1)throw new AppError('IPC002','终端输入版本已失效。');
  if(s.ended||!s.driver)throw new AppError('DEVICE_CLOSED','终端已退出。');
  if(Date.now()-s.windowStart>=1000){s.windowStart=Date.now();s.windowBytes=0;}
  const bytes=Buffer.byteLength(data);if(bytes>32768||s.windowBytes+bytes>65536)throw new AppError('DEVICE_INPUT_LIMIT','输入过快，每秒最多64KiB。');
  s.driver.write(data);s.windowBytes+=bytes;s.input=seq;
 }
 resize(owner:string,id:string,generation:number,cols:number,rows:number){const s=this.get(owner,id);if(generation!==1)throw new AppError('IPC005','终端版本已改变。');if(!s.ended)s.driver?.resize(cols,rows);}
 cwd(owner:string,id:string){this.get(owner,id);return {path:null,reason:'本地和串口终端不提供远程 SFTP 目录跟随。'};}
 async close(owner:string,id:string){const s=this.sessions.get(id);if(!s)return;if(s.owner!==owner)throw new AppError('IPC005','无权关闭终端。');await this.finish(s);}
 private finish(s:Session,error?:string):Promise<void>{
  if(s.closing)return s.closing;
  // Defer cleanup so the promise is stored before synchronous driver callbacks.
  s.closing=Promise.resolve().then(async()=>{s.queue=[];s.queued=0;s.pending.clear();
   this.state(s,error?'failed':'closed',error);if(error)this.emit(s.owner,{type:'service.error',message:error});
   this.emit(s.owner,{type:'terminal.closed',terminalId:s.descriptor.terminalId});
   try{await s.driver?.close();}catch{this.emit(s.owner,{type:'service.error',message:'设备终端释放失败，请核对设备状态。'});}finally{this.sessions.delete(s.descriptor.terminalId);}
  });return s.closing;
 }
 async stop(){this.stopped=true;await Promise.all([...this.sessions.values()].map(s=>this.finish(s)));}
}
