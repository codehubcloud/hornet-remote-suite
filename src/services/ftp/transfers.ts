import { randomUUID } from 'node:crypto';
import { createReadStream,createWriteStream } from 'node:fs';
import { lstat,realpath,link,unlink } from 'node:fs/promises';
import { dirname,join,posix } from 'node:path';
import { AppError } from '../../packages/core/errors';
import type { HornetEvent,TaskState } from '../../packages/contracts';
import type { TransferTask } from '../file/transfers';
import type { TransferContext } from '../file/tree-transfers';
import { hashFile } from '../file/hash-file';
import { FtpConnections } from './connections';
import { ftpPath,ftpAbsent,ftpStat,ftpHash } from './files';

async function localAbsent(path:string){try{await lstat(path);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;throw e;}throw new AppError('FILE_CONFLICT','目标文件已存在，请另存。');}
export class FtpTransfers {
 constructor(public connections:FtpConnections,private emit:(owner:string,event:HornetEvent)=>void){}
 validate(path:string,context?:TransferContext){ftpPath(path);if(context?.expectedSource||context?.expectedTarget||context?.remoteParent||context?.preserveModified)throw new AppError('CAPABILITY_UNAVAILABLE','FTP / FTPS 暂不支持目录同步或覆盖策略。');}
 async run(task:TransferTask,signal:AbortSignal,change:(state:TaskState)=>void,persist:()=>void){
  const p=task.plan,upload=task.snapshot.direction==='upload';this.validate(p.remotePath,p);
  const check=()=>{if(signal.aborted)throw new AppError('IPC006','任务已停止。');};check();
  const lease=await this.connections.acquire(task.owner,task.snapshot.profileId,signal),client=this.connections.get(task.owner,lease.connectionId).client;
  const abort=()=>client.close();signal.addEventListener('abort',abort,{once:true});
  let localTempCreated=false;
  const localHash=async(path:string)=>{const stream=createReadStream(path),stop=()=>stream.destroy(new AppError('IPC006','任务已停止。'));signal.addEventListener('abort',stop,{once:true});try{check();return await hashFile(stream,300000);}finally{signal.removeEventListener('abort',stop);stream.destroy();}};
  try{
   check();
   const source=upload?await lstat(p.localPath):await ftpStat(client,p.remotePath);
   if(!source||!(typeof source.isFile==='function'?source.isFile():source.isFile)||(typeof source.isSymbolicLink==='function'?source.isSymbolicLink():source.isSymbolicLink))throw new AppError('FILE_CONFLICT','源必须为普通文件。');
   const size=source.size;if(!Number.isSafeInteger(size)||size<0)throw new AppError('FILE_LIMIT','文件大小无效。');
   const hash=upload?await localHash(p.localPath):await ftpHash(client,p.remotePath);check();
   if(p.sourceHash&&p.sourceHash!==hash)throw new AppError('FILE_CONFLICT','源文件已改变，拒绝恢复。');
   p.sourceHash=hash;p.sourceSize=size;task.snapshot.totalBytes=size;task.snapshot.transferredBytes=0;
   // Resume deliberately restarts into a fresh object; FTP does not offer exclusive STOR.
   p.temp=upload?posix.join(posix.dirname(p.remotePath),'.hornet-'+randomUUID()+'.part'):join(dirname(p.localPath),'.hornet-'+randomUUID()+'.part');persist();
   if(upload)await ftpAbsent(client,p.remotePath);else await localAbsent(p.localPath);
   let last=0;client.trackProgress(info=>{if(info.type!==(upload?'upload':'download'))return;task.snapshot.transferredBytes=Math.min(size,info.bytes);if(Date.now()-last>100){last=Date.now();this.emit(task.owner,{type:'task.state',task:{...task.snapshot}});}});
   if(upload){
    await ftpAbsent(client,p.temp);const stream=createReadStream(p.localPath);try{await client.uploadFrom(stream,p.temp);}finally{stream.destroy();}
   }else{
    const stream=createWriteStream(p.temp,{flags:'wx',mode:0o600});stream.once('open',()=>{localTempCreated=true;});try{await client.downloadTo(stream,p.remotePath);}finally{stream.destroy();}
   }
   client.trackProgress();check();change('verifying');
   const resultHash=upload?await ftpHash(client,p.temp):await localHash(p.temp);
   if(hash!==resultHash||hash!==(upload?await localHash(p.localPath):await ftpHash(client,p.remotePath)))throw new AppError('FILE_CONFLICT','传输内容不一致或源文件发生变化。');
   if(await realpath(dirname(p.localPath))!==p.localParent)throw new AppError('FILE_CONFLICT','本地父目录已改变。');
   if(upload)await ftpAbsent(client,p.remotePath);else await localAbsent(p.localPath);
   check();p.committing=true;change('committing');
   if(upload)await client.rename(p.temp,p.remotePath);
   else{await link(p.temp,p.localPath);await unlink(p.temp);localTempCreated=false;}
   p.committing=false;task.snapshot.transferredBytes=size;change('succeeded');
  }finally{
   signal.removeEventListener('abort',abort);this.connections.release(task.owner,lease.leaseId);
   if(localTempCreated&&!p.committing)await unlink(p.temp).catch(()=>{});
  }
 }
}
