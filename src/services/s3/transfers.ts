import { CopyObjectCommand,DeleteObjectCommand,GetObjectCommand,HeadObjectCommand,PutObjectCommand } from '@aws-sdk/client-s3';
import { createReadStream,createWriteStream } from 'node:fs';
import { lstat,realpath,link,unlink } from 'node:fs/promises';
import { dirname,posix } from 'node:path';
import { Readable,Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { HornetEvent,TaskState } from '../../packages/contracts';
import { AppError } from '../../packages/core/errors';
import type { TransferTask } from '../file/transfers';
import type { TransferContext } from '../file/tree-transfers';
import { hashTransferStream } from '../file/transfer-hash';
import { s3Key,s3Path } from './files';
import { S3Connections } from './connections';

const maxSingleCopy=5_000_000_000;
export class S3Transfers {
 constructor(public connections:S3Connections,private emit:(owner:string,event:HornetEvent)=>void){}
 validate(path:string,context?:TransferContext){const normalized=s3Path(path);if(!s3Key(normalized)||path.endsWith('/'))throw new AppError('FILE_CONFLICT','An S3 bucket folder cannot be transferred as a file.');if(context?.expectedSource||context?.expectedTarget||context?.remoteParent||context?.preserveModified)throw new AppError('CAPABILITY_UNAVAILABLE','S3 transfers do not support directory synchronization overwrite policies.');}
 private async remoteHash(owner:string,id:string,key:string,size:number,signal:AbortSignal,progress:(bytes:number,total:number)=>void){
  const c=this.connections.get(owner,id),result=await c.client.send(new GetObjectCommand({Bucket:c.bucket,Key:key}),{abortSignal:signal});
  if(!result.Body)throw new AppError('FILE_CONFLICT','S3 object has no content stream.');
  const stream=result.Body instanceof Readable?result.Body:Readable.from(result.Body as AsyncIterable<Uint8Array>);
  return hashTransferStream(stream,signal,size,bytes=>progress(bytes,size));
 }
 async run(task:TransferTask,signal:AbortSignal,change:(state:TaskState)=>void){
  const p=task.plan,upload=task.snapshot.direction==='upload',owner=task.owner,remoteKey=s3Key(p.remotePath);this.validate(p.remotePath);
  const check=()=>{if(signal.aborted)throw new AppError('IPC006','Transfer was cancelled or paused.');};
  const lease=await this.connections.acquire(owner,task.snapshot.profileId,signal),c=this.connections.get(owner,lease.connectionId);let localTemp=false,remoteTemp=false;
  const progress=(bytes:number,total:number)=>{task.snapshot.transferredBytes=Math.min(bytes,total);task.snapshot.verification={bytes,totalBytes:total,method:'stream'};this.emit(owner,{type:'task.state',task:{...task.snapshot}});};
  const localHash=async(path:string,size:number)=>hashTransferStream(createReadStream(path,{highWaterMark:1024*1024}),signal,size,bytes=>progress(bytes,size));
  const head=async(key:string)=>{try{return await c.client.send(new HeadObjectCommand({Bucket:c.bucket,Key:key}),{abortSignal:signal});}catch(error){if((error as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode===404)return undefined;throw error;}};
  let last=0;const meter=new Transform({transform:(chunk:Buffer,_encoding,done)=>{task.snapshot.transferredBytes+=chunk.length;if(Date.now()-last>100){last=Date.now();this.emit(owner,{type:'task.state',task:{...task.snapshot}});}done(null,chunk);}});
  try{
   check();
   if(await realpath(dirname(p.localPath))!==p.localParent)throw new AppError('FILE_CONFLICT','Local destination directory changed.');
   let size:number;
   if(upload){const source=await lstat(p.localPath);if(!source.isFile()||source.isSymbolicLink())throw new AppError('FILE_CONFLICT','Transfer source is not a regular file.');size=source.size;}
   else{const source=await head(remoteKey);if(!source)throw new AppError('FILE_CONFLICT','S3 transfer source does not exist.');size=source.ContentLength??0;}
   if(!Number.isSafeInteger(size)||size<0||size>maxSingleCopy)throw new AppError('FILE_LIMIT','S3 single-object transfer limit is 5 GB.');
   task.snapshot.totalBytes=size;task.snapshot.transferredBytes=0;task.snapshot.verification=undefined;
   const sourceHash=upload?await localHash(p.localPath,size):await this.remoteHash(owner,lease.connectionId,remoteKey,size,signal,progress);check();
   if(p.sourceHash&&p.sourceHash!==sourceHash)throw new AppError('FILE_CONFLICT','Transfer source changed since the task was created.');p.sourceHash=sourceHash;p.sourceSize=size;
   if(upload){
    if(await head(remoteKey))throw new AppError('FILE_CONFLICT','S3 destination object already exists.');
    const tempKey=`${posix.dirname(remoteKey)==='.'?'':posix.dirname(remoteKey)+'/'}\.hornet-${task.snapshot.taskId}.part`;p.temp=tempKey;remoteTemp=true;
    await c.client.send(new PutObjectCommand({Bucket:c.bucket,Key:tempKey,Body:createReadStream(p.localPath).pipe(meter),ContentLength:size}),{abortSignal:signal});check();change('verifying');
    if(await this.remoteHash(owner,lease.connectionId,tempKey,size,signal,progress)!==sourceHash||await localHash(p.localPath,size)!==sourceHash)throw new AppError('FILE_CONFLICT','S3 upload verification failed or the local source changed.');
    if(await head(remoteKey))throw new AppError('FILE_CONFLICT','S3 destination object was created by another operation.');
    check();p.committing=true;change('committing');
    await c.client.send(new CopyObjectCommand({Bucket:c.bucket,Key:remoteKey,IfNoneMatch:'*',CopySource:`/${c.bucket}/${tempKey.split('/').map(encodeURIComponent).join('/')}`}));
    const copied=await this.remoteHash(owner,lease.connectionId,remoteKey,size,signal,progress);if(copied!==sourceHash)throw new AppError('FILE_CONFLICT','Copied S3 object did not match the verified source.');
    await c.client.send(new DeleteObjectCommand({Bucket:c.bucket,Key:tempKey}));remoteTemp=false;
   }else{
    const tempLocal=dirname(p.localPath)+'/.hornet-'+task.snapshot.taskId+'.part';p.temp=tempLocal;
    if(await lstat(p.localPath).catch(()=>undefined))throw new AppError('FILE_CONFLICT','Local destination file already exists.');
    const result=await c.client.send(new GetObjectCommand({Bucket:c.bucket,Key:remoteKey}),{abortSignal:signal});if(!result.Body)throw new AppError('FILE_CONFLICT','S3 object has no content stream.');
    const body=result.Body instanceof Readable?result.Body:Readable.from(result.Body as AsyncIterable<Uint8Array>);const output=createWriteStream(tempLocal,{flags:'wx',mode:0o600});output.once('open',()=>{localTemp=true;});
    await pipeline(body,meter,output,{signal});check();change('verifying');
    if(await localHash(tempLocal,size)!==sourceHash||await this.remoteHash(owner,lease.connectionId,remoteKey,size,signal,progress)!==sourceHash)throw new AppError('FILE_CONFLICT','S3 download verification failed or the remote object changed.');
    if(await realpath(dirname(p.localPath))!==p.localParent||await lstat(p.localPath).then(()=>true,()=>false))throw new AppError('FILE_CONFLICT','Local destination changed or already exists.');
    check();p.committing=true;change('committing');await link(tempLocal,p.localPath);await unlink(tempLocal);localTemp=false;
   }
   p.committing=false;task.snapshot.transferredBytes=size;change('succeeded');
  }finally{
   void meter.destroy();
   if(remoteTemp)await c.client.send(new DeleteObjectCommand({Bucket:c.bucket,Key:p.temp})).catch(()=>{});
   if(localTemp)await unlink(p.temp).catch(()=>{});
   this.connections.release(owner,lease.leaseId);
  }
 }
}
