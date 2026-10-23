import Zmodem from 'zmodem.js';
import { randomUUID } from 'node:crypto';
import { lstatSync,realpathSync,openSync,closeSync,writeSync,linkSync,unlinkSync,readSync } from 'node:fs';
import { basename,join,dirname } from 'node:path';
export interface BinaryTerminal {begin(consume:(data:Buffer)=>void,close:()=>void):void;write(data:Buffer):Promise<void>;output(data:Buffer):void;end():void}
export interface ZmodemStatus {id:string;terminalId:string;direction:'send'|'receive';state:'waiting'|'transferring'|'completed'|'failed'|'cancelled';name:string;bytes:number;total:number;files:number;error?:string}
/** Only instantiated after an explicit menu action and native file/folder consent. */
export class ZmodemTransfers {
 private jobs=new Map<string,{status:ZmodemStatus;cancel:()=>void}>();
 list(){return [...this.jobs.values()].map(job=>({...job.status}));}
 cancel(id:string){this.jobs.get(id)?.cancel();}
 start(terminalId:string,direction:'send'|'receive',path:string,parent:string,terminal:BinaryTerminal){
  if([...this.jobs.values()].some(job=>job.status.terminalId===terminalId&&['waiting','transferring'].includes(job.status.state)))throw new Error('此终端已有 ZMODEM 传输。');
  if(this.jobs.size>=100){const done=[...this.jobs].find(([,job])=>!['waiting','transferring'].includes(job.status.state));if(done)this.jobs.delete(done[0]);else throw new Error('ZMODEM 传输过多。');}
  if(direction==='receive'&&(realpathSync(path)!==path||!lstatSync(path).isDirectory()||lstatSync(path).isSymbolicLink()))throw new Error('接收目录无效。');
  const status:ZmodemStatus={id:randomUUID(),terminalId,direction,state:'waiting',name:'',bytes:0,total:0,files:0};
  let session:ZmodemSession|undefined,finished=false,outbound=Promise.resolve(),timer:ReturnType<typeof setTimeout>,fd:number|undefined,temp:string|undefined,receiving=false;
  const clean=()=>{if(fd!==undefined){closeSync(fd);fd=undefined;}if(temp){try{unlinkSync(temp);}catch{}temp=undefined;}};
  const end=(state:ZmodemStatus['state'],error?:unknown)=>{if(finished)return;finished=true;clearTimeout(timer);status.state=state;if(error)status.error=error instanceof Error?error.message:String(error);if(state!=='completed')try{session?.abort();}catch{}clean();terminal.end();};
  const resetTimer=()=>{clearTimeout(timer);timer=setTimeout(()=>end('failed','ZMODEM 等待超时，请确认远端已运行 rz / sz。'),60000);timer.unref();};
  const send=(octets:number[])=>{outbound=outbound.then(()=>terminal.write(Buffer.from(octets)));void outbound.catch(error=>end('failed',error));};
  const receive=(offer:ZmodemOffer)=>{
   try{
    if(receiving||++status.files>100)throw new Error('ZMODEM 接收超过文件上限。');
    const info=offer.get_details(),name=info.name;
    if(!name||name==='.'||name==='..'||name.length>255||/[<>:"/\\|?*\x00-\x1f\x7f]/.test(name)||/[. ]$/.test(name)||/^(con|prn|aux|nul|com\d|lpt\d)(?:\.|$)/i.test(name))throw new Error('远端文件名不安全。');
    if(!Number.isSafeInteger(info.size)||info.size<0||info.size>512*1024**2||status.total+info.size>1024**3)throw new Error('ZMODEM 接收大小超过上限。');
    if(realpathSync(path)!==path||lstatSync(path).isSymbolicLink())throw new Error('接收目录已改变。');
    const target=join(path,name);try{lstatSync(target);throw new Error('目标文件已存在，禁止覆盖。');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    temp=join(path,'.hornet-zmodem-'+randomUUID()+'.part');fd=openSync(temp,'wx',0o600);receiving=true;status.state='transferring';status.name=name;status.total+=info.size;let received=0;
    void offer.accept({on_input:octets=>{if(finished||fd===undefined)throw new Error('传输已取消。');received+=octets.length;if(received>info.size)throw new Error('接收字节超过声明大小。');const data=Buffer.from(octets);let offset=0;while(offset<data.length)offset+=writeSync(fd,data,offset);status.bytes+=data.length;}}).then(()=>{
      if(finished)return;if(received!==info.size)throw new Error('接收文件大小不一致。');closeSync(fd!);fd=undefined;
      if(realpathSync(path)!==path||lstatSync(path).isSymbolicLink())throw new Error('接收目录已改变。');linkSync(temp!,target);unlinkSync(temp!);temp=undefined;receiving=false;
    }).catch(error=>end('failed',error));
   }catch(error){end('failed',error);}
  };
  const upload=async()=>{
   try{
    const info=lstatSync(path);if(!info.isFile()||info.isSymbolicLink()||realpathSync(dirname(path))!==parent)throw new Error('发送文件或目录已改变。');
    status.state='transferring';status.name=basename(path);status.total=info.size;
    const transfer=await session!.send_offer({name:basename(path),size:info.size,mtime:Math.floor(info.mtimeMs/1000),files_remaining:1});if(!transfer)throw new Error('远端拒绝接收文件。');
    fd=openSync(path,'r');const buffer=Buffer.alloc(16384);let offset=0;
    while(!finished&&offset<info.size){const length=readSync(fd,buffer,0,Math.min(buffer.length,info.size-offset),offset);if(!length)throw new Error('源文件读取中断。');transfer.send([...buffer.subarray(0,length)]);await outbound;offset+=length;status.bytes=offset;}
    if(finished)return;closeSync(fd);fd=undefined;const after=lstatSync(path);if(after.isSymbolicLink()||after.size!==info.size||after.mtimeMs!==info.mtimeMs)throw new Error('发送期间源文件改变。');
    await transfer.end();await session!.close();await outbound;status.files=1;end('completed');
   }catch(error){end('failed',error);}
  };
  const sentry=new Zmodem.Sentry({to_terminal:octets=>terminal.output(Buffer.from(octets)),sender:send,on_retract:()=>{},on_detect:detection=>{
    if(finished)return;const expected=direction==='send'?'send':'receive';if(detection.get_session_role()!==expected){detection.deny();end('failed','远端传输方向与所选操作不一致。');return;}
    session=detection.confirm();session.on('session_end',()=>{if(direction==='receive')queueMicrotask(()=>{if(!receiving)end('completed');else end('failed','文件尚未完整提交。');});});
    if(direction==='receive'){session.on('offer',receive);session.start();}else void upload();
  }});
  terminal.begin(data=>{if(finished)return;resetTimer();try{sentry.consume([...data]);}catch(error){end('failed',error);}},()=>end('failed','终端已断开。'));
  resetTimer();this.jobs.set(status.id,{status,cancel:()=>end('cancelled')});return {...status};
 }
}
