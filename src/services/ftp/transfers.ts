import { asciiLines } from './ascii';
import { randomUUID } from 'node:crypto';
import { createReadStream,createWriteStream } from 'node:fs';
import { lstat,realpath,link,unlink,rename as localRename } from 'node:fs/promises';
import { dirname,join,posix } from 'node:path';
import { AppError } from '../../packages/core/errors';
import type { HornetEvent,TaskState } from '../../packages/contracts';
import type { TransferTask } from '../file/transfers';
import type { TransferContext } from '../file/tree-transfers';
import { hashTransferStream } from '../file/transfer-hash';
import { FtpConnections } from './connections';
import { ftpPath,ftpAbsent,ftpStat,ftpHash } from './files';

async function localAbsent(path:string){try{await lstat(path);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;throw e;}throw new AppError('FILE_CONFLICT','目标文件已存在，请另存。');}
export class FtpTransfers {
 constructor(public connections:FtpConnections,private emit:(owner:string,event:HornetEvent)=>void){}
 validate(path:string,context?:TransferContext){ftpPath(path);if(context?.remoteParent||context?.preserveModified)throw new AppError('CAPABILITY_UNAVAILABLE','FTP / FTPS 暂不支持目录同步。');}
 async run(task:TransferTask,signal:AbortSignal,change:(state:TaskState)=>void,persist:()=>void){
  const p=task.plan,upload=task.snapshot.direction==='upload';this.validate(p.remotePath,p);
  const check=()=>{if(signal.aborted)throw new AppError('IPC006','任务已停止。');};check();
  const lease=await this.connections.acquire(task.owner,task.snapshot.profileId,signal),client=this.connections.get(task.owner,lease.connectionId).client;
  const abort=()=>client.close();signal.addEventListener('abort',abort,{once:true});
  let localTempCreated=false;
  let size=0,lastProgress=0;
  const hashProgress=(bytes:number)=>{task.snapshot.verification={bytes,totalBytes:size,method:'stream'};if(bytes===0||bytes===size||Date.now()-lastProgress>=150){lastProgress=Date.now();this.emit(task.owner,{type:'task.state',task:{...task.snapshot}});}};
  const localHash=(path:string)=>{const source=createReadStream(path,{highWaterMark:1024*1024});const input=p.ftpText?source.pipe(asciiLines(true)):source;input.on('error',()=>source.destroy());source.on('error',error=>input.destroy(error));return hashTransferStream(input,signal,size,hashProgress);};
  const remoteHash=(path:string)=>ftpHash(client,path,hashProgress);
  const rawRemoteHash=async(path:string)=>{await client.send('TYPE I');try{return await ftpHash(client,path);}finally{await client.send(p.ftpText?'TYPE A':'TYPE I');}};
  try{
   check();await client.send(p.ftpText?'TYPE A':'TYPE I');
   const source=upload?await lstat(p.localPath):await ftpStat(client,p.remotePath);
   if(!source||!(typeof source.isFile==='function'?source.isFile():source.isFile)||(typeof source.isSymbolicLink==='function'?source.isSymbolicLink():source.isSymbolicLink))throw new AppError('FILE_CONFLICT','源必须为普通文件。');
   size=source.size;if(!Number.isSafeInteger(size)||size<0)throw new AppError('FILE_LIMIT','文件大小无效。');task.snapshot.totalBytes=size;
   const modified='mtimeMs' in source?source.mtimeMs:source.modifiedAt?.getTime()??0;
   if(p.expectedSource&&(p.expectedSource.size!==size||p.expectedSource.modified!==modified))throw new AppError('FILE_CONFLICT','源文件在确认后发生变化。');
   const verifyTarget=async()=>{
    if(!p.expectedTarget){if(upload)await ftpAbsent(client,p.remotePath);else await localAbsent(p.localPath);return;}
    const expected=p.expectedTarget,current=upload?await ftpStat(client,p.remotePath):await lstat(p.localPath);
    if(!expected.hash||!current||!(typeof current.isFile==='function'?current.isFile():current.isFile)||(typeof current.isSymbolicLink==='function'?current.isSymbolicLink():current.isSymbolicLink)||current.size!==expected.size||('mtimeMs' in current?current.mtimeMs:current.modifiedAt?.getTime()??0)!==expected.modified)throw new AppError('FILE_CONFLICT','目标文件在确认后发生变化。');
    const hash=upload?await rawRemoteHash(p.remotePath):await hashTransferStream(createReadStream(p.localPath),signal,expected.size);
    if(hash!==expected.hash)throw new AppError('FILE_CONFLICT','目标内容在确认后发生变化。');
   };
   const hash=upload?await localHash(p.localPath):await remoteHash(p.remotePath);check();
   if(p.sourceHash&&p.sourceHash!==hash)throw new AppError('FILE_CONFLICT','源文件已改变，拒绝恢复。');
   p.sourceHash=hash;p.sourceSize=size;task.snapshot.totalBytes=size;task.snapshot.transferredBytes=0;
   // Resume deliberately restarts into a fresh object; FTP does not offer exclusive STOR.
   p.temp=upload?posix.join(posix.dirname(p.remotePath),'.hornet-'+randomUUID()+'.part'):join(dirname(p.localPath),'.hornet-'+randomUUID()+'.part');persist();
   await verifyTarget();
   task.snapshot.verification=undefined;
   let last=0;client.trackProgress(info=>{if(info.type!==(upload?'upload':'download'))return;task.snapshot.transferredBytes=Math.min(size,info.bytes);if(Date.now()-last>100){last=Date.now();this.emit(task.owner,{type:'task.state',task:{...task.snapshot}});}});
   if(upload){
    await ftpAbsent(client,p.temp);const stream=createReadStream(p.localPath);const input=p.ftpText?stream.pipe(asciiLines(true)):stream;stream.on('error',error=>input.destroy(error));try{await client.uploadFrom(input,p.temp);}finally{input.destroy();stream.destroy();}
   }else{
    const stream=createWriteStream(p.temp,{flags:'wx',mode:0o600});stream.once('open',()=>{localTempCreated=true;});const output=p.ftpText?asciiLines(false):stream;const finished=import('node:stream/promises').then(({finished})=>finished(stream));if(p.ftpText){output.pipe(stream);output.on('error',error=>stream.destroy(error));stream.on('error',error=>output.destroy(error));}try{await client.downloadTo(output,p.remotePath);await finished;}finally{output.destroy();stream.destroy();await finished.catch(()=>{});}
   }
   client.trackProgress();check();change('verifying');
   const resultHash=upload?await remoteHash(p.temp):await localHash(p.temp);
   if(hash!==resultHash||hash!==(upload?await localHash(p.localPath):await remoteHash(p.remotePath)))throw new AppError('FILE_CONFLICT','传输内容不一致或源文件发生变化。');
   if(await realpath(dirname(p.localPath))!==p.localParent)throw new AppError('FILE_CONFLICT','本地父目录已改变。');
   await verifyTarget();
   check();p.committing=true;change('committing');
   if(upload&&p.expectedTarget){
    // Some FTP servers reject RNTO onto an existing file. Move the verified old
    // file aside first; retain it until the new file has been installed.
    const backup=posix.join(posix.dirname(p.remotePath),'.hornet-'+task.snapshot.taskId+'.backup');await ftpAbsent(client,backup);
    await client.rename(p.remotePath,backup);
    try{
     if(await rawRemoteHash(backup)!==p.expectedTarget.hash)throw new AppError('FILE_CONFLICT','目标内容在替换前发生变化。');
     await ftpAbsent(client,p.remotePath);check();await client.rename(p.temp,p.remotePath);
    }catch(error){
     try{await ftpAbsent(client,p.remotePath);await client.rename(backup,p.remotePath);p.committing=false;}
     catch{throw new AppError('FILE_CONFLICT','无法完成替换，请核对目标及备份：'+backup);}
     throw error;
    }
    await client.remove(backup);
   }else if(upload)await client.rename(p.temp,p.remotePath);
   else{if(p.expectedTarget)await localRename(p.temp,p.localPath);else{await link(p.temp,p.localPath);await unlink(p.temp);}localTempCreated=false;}
   p.committing=false;task.snapshot.transferredBytes=size;change('succeeded');
  }finally{
   signal.removeEventListener('abort',abort);this.connections.release(task.owner,lease.leaseId);
   if(localTempCreated&&!p.committing)await unlink(p.temp).catch(()=>{});
  }
 }
}
