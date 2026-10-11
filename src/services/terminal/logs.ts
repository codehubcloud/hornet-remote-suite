import { createWriteStream,type WriteStream } from 'node:fs';
import { TerminalText } from '../../packages/core/terminal-text';
export { TerminalText } from '../../packages/core/terminal-text';
import { randomUUID } from 'node:crypto';
import type { HornetEvent } from '../../packages/contracts';
import type { TerminalLog,TerminalLogFormat } from '../../packages/contracts/terminal-log';
import { AppError } from '../../packages/core/errors';
import { recordingLimit,recordingFrameLimit,type RecordingFrame } from '../../packages/contracts/terminal-recording';

// Strip display control sequences across chunk boundaries without accumulating
// arbitrary OSC/DCS strings in memory. This is an output transcript, not a VT
// screen emulator: CR/newline/tab retain their original stream order.
interface Record {owner:string;snapshot:TerminalLog;stream:WriteStream;text:TerminalText;done:Promise<void>;last:number;clock:number;frames:number;timer?:ReturnType<typeof setTimeout>}
export class TerminalLogs {
 private records=new Map<string,Record>();
 constructor(private emit:(owner:string,log:TerminalLog)=>void,private maxBytes=100*1024*1024,private maxBuffered=1024*1024){}
 list(owner:string){return [...this.records.values()].filter(r=>r.owner===owner).map(r=>({...r.snapshot}));}
 private publish(r:Record){r.last=Date.now();this.emit(r.owner,{...r.snapshot});}
 async start(owner:string,terminalId:string,path:string,format:TerminalLogFormat,cols=120,rows=36){
  const active=[...this.records.values()].filter(r=>['starting','recording','stopping'].includes(r.snapshot.state));
  if(active.some(r=>r.snapshot.terminalId===terminalId&&r.owner===owner))throw new AppError('LOG_ACTIVE','此终端已有日志正在写入。');
  if(active.length>=32)throw new AppError('LOG_LIMIT','最多同时记录32个终端。');
  while(this.records.size>=100){const old=[...this.records.values()].find(r=>!['starting','recording','stopping'].includes(r.snapshot.state));if(!old)break;this.records.delete(old.snapshot.id);}
  const stream=createWriteStream(path,{flags:'wx',mode:0o600});
  let done!:()=>void;const r:Record={owner,stream,text:new TerminalText(),snapshot:{id:randomUUID(),terminalId,path,format,state:'starting',bytes:0,startedAt:Date.now()},done:new Promise<void>(resolve=>{done=resolve;}),last:0,clock:performance.now(),frames:0};
  this.records.set(r.snapshot.id,r);
  const ready=new Promise<void>((resolve,reject)=>{stream.once('open',()=>{if(r.snapshot.state==='starting'){r.snapshot.state='recording';this.publish(r);}resolve();});stream.once('error',reject);});
  stream.on('error',error=>{r.snapshot.state='failed';r.snapshot.error=(error as NodeJS.ErrnoException).code==='EEXIST'?'日志文件已存在，请选择新文件名。':'日志写入失败：'+error.message;this.publish(r);});
  stream.once('close',()=>{clearTimeout(r.timer);if(r.snapshot.state!=='failed')r.snapshot.state='stopped';this.publish(r);done();});
  if(format==='recording')this.append(r,Buffer.from(JSON.stringify({kind:'hornet-terminal-recording',version:1,cols:Math.min(500,Math.max(2,cols)),rows:Math.min(200,Math.max(1,rows))})+'\n'));
  this.publish(r);
  try{await ready;}catch{throw new AppError('LOG_WRITE',r.snapshot.error??'无法创建日志文件。');}
  return {...r.snapshot};
 }
 observe(owner:string,event:HornetEvent){
  if(event.type!=='terminal.data'&&event.type!=='terminal.closed')return;
  for(const r of this.records.values()){
   if(r.owner!==owner||r.snapshot.terminalId!==event.terminalId||!['starting','recording'].includes(r.snapshot.state))continue;
   if(event.type==='terminal.closed'){void this.stop(owner,r.snapshot.id);continue;}
   if(r.snapshot.format==='recording')this.frame(r,[this.elapsed(r),'o',Buffer.from(event.data).toString('base64')]);
   else this.append(r,r.snapshot.format==='raw'?Buffer.from(event.data):Buffer.from(r.text.write(Buffer.from(event.data))));
  }
 }
 private elapsed(r:Record){return Math.floor(performance.now()-r.clock);}
 private frame(r:Record,frame:RecordingFrame){
  if(++r.frames>recordingFrameLimit||frame[0]>7*24*3600*1000){r.snapshot.state='failed';r.snapshot.error='会话录制达到事件或时长上限。';this.publish(r);r.stream.end();this.deadline(r);return;}
  this.append(r,Buffer.from(JSON.stringify(frame)+'\n'));
 }
 resize(owner:string,terminalId:string,cols:number,rows:number){
  for(const r of this.records.values())if(r.owner===owner&&r.snapshot.terminalId===terminalId&&r.snapshot.format==='recording'&&r.snapshot.state==='recording')this.frame(r,[this.elapsed(r),'r',Math.min(500,Math.max(2,cols)),Math.min(200,Math.max(1,rows))]);
 }
 private append(r:Record,data:Buffer){
  if(!data.length)return;
  const limit=r.snapshot.format==='recording'?Math.min(this.maxBytes,recordingLimit):this.maxBytes;
  if(r.snapshot.bytes+data.length>limit||r.stream.writableLength+data.length>this.maxBuffered){
   r.snapshot.state='failed';r.snapshot.error=r.snapshot.bytes+data.length>limit?'日志达到大小上限，已停止记录。':'日志磁盘写入跟不上输出，已停止记录。';this.publish(r);r.stream.end();this.deadline(r);return;
  }
  r.stream.write(data);r.snapshot.bytes+=data.length;if(Date.now()-r.last>250)this.publish(r);
 }
 private deadline(r:Record){if(!r.timer)r.timer=setTimeout(()=>{r.snapshot.state='failed';r.snapshot.error='日志文件关闭超时，尾部内容可能未写入。';r.stream.destroy();},5000);}
 async stop(owner:string,id:string){
  const r=this.records.get(id);if(!r||r.owner!==owner)throw new AppError('IPC005','无权访问日志。');
  if(['starting','recording'].includes(r.snapshot.state)){
   if(r.snapshot.format==='text')this.append(r,Buffer.from(r.text.end()));
   if(r.snapshot.state!=='failed'){r.snapshot.state='stopping';this.publish(r);r.stream.end();}this.deadline(r);
  }
  await r.done;return {...r.snapshot};
 }
 async stopAll(owner:string){await Promise.all([...this.records.values()].filter(r=>r.owner===owner).map(r=>this.stop(owner,r.snapshot.id)));}
}
