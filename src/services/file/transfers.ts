import { randomUUID,createHash } from 'node:crypto';
import { createReadStream,createWriteStream } from 'node:fs';
import { lstat,realpath,link,rename as localRename,utimes,chmod,unlink as localUnlink } from 'node:fs/promises';
import { dirname,basename,join,posix } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { SFTPWrapper } from 'ssh2';
import { Connections } from '../ssh/connections';
import { stat,unlink,rename,realpath as remoteRealpath } from './files';
import { Storage } from '../../packages/storage/database';
import type { TaskSnapshot,HornetEvent } from '../../packages/contracts';
import { AppError,safeError } from '../../packages/core/errors';

import type { TransferContext } from './tree-transfers';
import type { FtpTransfers } from '../ftp/transfers';
import { hashTransferStream,hashRemoteFile,type HashProgress } from './transfer-hash';

interface Plan { ftpText?:boolean; transport?:'ftp'|'s3';expectedTarget?:TransferContext['expectedTarget'];preserveModified?:boolean;expectedSource?:TransferContext['expectedSource'];remoteParent?:string; localPath:string; localParent:string; remotePath:string; temp:string; profileRevision:number; sourceHash?:string; sourceSize?:number; committing?:boolean }
export interface TransferTask { snapshot:TaskSnapshot;owner:string;key:string;hash:string;plan:Plan; abort?:AbortController; stop?:'paused'|'cancelled' }
type Task=TransferTask;
export class Transfers {
  private tasks=new Map<string,Task>();private running=new Set<string>();private stopped=false;
  constructor(private store:Storage,private connections:Connections,private emit:(owner:string,event:HornetEvent)=>void,private ftp?:FtpTransfers,private s3?:import('../s3/transfers').S3Transfers){
    for(const r of store.loadTasks()){
      const task:Task={snapshot:{...r.snapshot,verification:undefined},owner:r.owner,key:r.key,hash:r.hash,plan:r.detail as Plan};
      if(['queued','running','verifying','pausing','cancelling'].includes(task.snapshot.state))task.snapshot={...task.snapshot,state:'paused',revision:task.snapshot.revision+1,error:'应用已重启，恢复前会重新校验文件。'};
      if(task.snapshot.state==='committing')task.snapshot={...task.snapshot,state:'conflict',revision:task.snapshot.revision+1,error:'提交结果未知，请检查目标文件。禁止自动重复提交。'};
      this.tasks.set(task.snapshot.taskId,task);this.persist(task);
    }
  }
  list(owner:string){return [...this.tasks.values()].filter(t=>t.owner===owner).map(t=>t.snapshot).sort((a,b)=>b.updatedAt-a.updatedAt);}
  hasProfile(profileId:string){return [...this.tasks.values()].some(t=>t.snapshot.profileId===profileId&&!['succeeded','cancelled','failed','conflict'].includes(t.snapshot.state));}
  async start(owner:string,connectionId:string,direction:'upload'|'download',localPath:string,localParent:string,remotePath:string,key:string,context?:TransferContext){
    const isS3=this.s3?.connections.has(connectionId),isFtp=this.ftp?.connections.has(connectionId),c=isS3?this.s3!.connections.get(owner,connectionId):isFtp?this.ftp!.connections.get(owner,connectionId):this.connections.get(owner,connectionId);
    if(isS3)this.s3!.validate(remotePath,context);
    if(isFtp)this.ftp!.validate(remotePath,context);
    const ftpMode=isFtp?this.ftp!.connections.get(owner,connectionId).mode:undefined,ftpText=isFtp&&(ftpMode==='text'||ftpMode==='auto'&&/\.(txt|csv|tsv|json|xml|html?|css|js|ts|py|sh|ini|conf|cfg|md|log|yaml|yml)$/i.test(remotePath));
    const hash=createHash('sha256').update(JSON.stringify({ftpText,profileId:c.profile.profileId,direction,localPath,remotePath,expectedSource:context?.expectedSource,expectedTarget:context?.expectedTarget,preserveModified:context?.preserveModified,remoteParent:context?.remoteParent})).digest('hex');
    const previous=[...this.tasks.values()].find(t=>t.owner===owner&&t.key===key);
    if(previous){if(previous.hash!==hash)throw new AppError('TASK_STATE_CONFLICT','同一请求标识不能用于不同传输。');return previous.snapshot;}
    const id=randomUUID();
    const plan:Plan={ftpText,expectedTarget:context?.expectedTarget,preserveModified:context?.preserveModified,expectedSource:context?.expectedSource,remoteParent:context?.remoteParent,localPath,localParent,remotePath,profileRevision:c.profile.revision,temp:direction==='upload'?posix.join(posix.dirname(remotePath),'.hornet-'+id+'.part'):join(dirname(localPath),'.hornet-'+id+'.part')};
    if(isFtp)plan.transport='ftp';
    if(isS3)plan.transport='s3';
    const task:Task={owner,key,hash,plan,snapshot:{taskId:id,profileId:c.profile.profileId,direction,localPath,remotePath,createdAt:Date.now(),name:direction==='upload'?basename(localPath):posix.basename(remotePath),state:'queued',totalBytes:0,transferredBytes:0,revision:1,updatedAt:Date.now()}};
    this.tasks.set(id,task);this.persist(task);this.emit(owner,{type:'task.state',task:task.snapshot});this.pump();return task.snapshot;
  }
  private get(owner:string,id:string,revision:number){const t=this.tasks.get(id);if(!t||t.owner!==owner)throw new AppError('IPC005','无权访问任务。');if(t.snapshot.revision!==revision)throw new AppError('TASK_STATE_CONFLICT','任务状态已改变，请刷新。');return t;}
  pause(owner:string,id:string,revision:number){const t=this.get(owner,id,revision);if(!['running','queued','verifying'].includes(t.snapshot.state))throw new AppError('TASK_STATE_CONFLICT','当前阶段不能暂停。');if(this.running.has(id)){t.stop='paused';this.change(t,'pausing');t.abort?.abort();}else this.change(t,'paused');}
  cancel(owner:string,id:string,revision:number){const t=this.get(owner,id,revision);if(['succeeded','committing','cancelled'].includes(t.snapshot.state))throw new AppError('TASK_STATE_CONFLICT','任务已完成或正在提交，不能取消。');if(this.running.has(id)){t.stop='cancelled';this.change(t,'cancelling');t.abort?.abort();}else this.change(t,'cancelled');}
  resume(owner:string,id:string,revision:number){const t=this.get(owner,id,revision);if(!['paused','failed'].includes(t.snapshot.state)||t.plan.committing)throw new AppError('TASK_STATE_CONFLICT','此任务不能安全恢复。');t.stop=undefined;this.change(t,'queued');this.pump();}
  private change(t:Task,state:TaskSnapshot['state'],error?:string){t.snapshot={...t.snapshot,state,error,verification:undefined,revision:t.snapshot.revision+1,updatedAt:Date.now()};this.persist(t);this.emit(t.owner,{type:'task.state',task:t.snapshot});}
  private persist(t:Task){this.store.saveTask(t.snapshot,t.owner,t.key,t.hash,t.plan);}
  private destination(t:Task){return t.snapshot.direction==='upload'?'remote:'+t.snapshot.profileId+':'+posix.normalize(t.plan.remotePath):'local:'+(process.platform==='win32'?t.plan.localPath.toLowerCase():t.plan.localPath);}
  private pump(){
    if(this.stopped)return;
    for(const t of this.tasks.values()){
      if(this.running.size>=4)break;
      if(t.snapshot.state!=='queued')continue;
      if([...this.running].some(id=>this.destination(this.tasks.get(id)!)===this.destination(t)))continue;
      const active=[...this.running].filter(id=>this.tasks.get(id)?.snapshot.profileId===t.snapshot.profileId).length;
      if(active>=2)continue;
      this.running.add(t.snapshot.taskId);
      void this.run(t).finally(()=>{this.running.delete(t.snapshot.taskId);this.pump();});
    }
  }
  private async run(t:Task){
    let lease:Awaited<ReturnType<Connections['acquire']>>|undefined;
    const abort=new AbortController();t.abort=abort;const signal=abort.signal;const p=t.plan;
    const check=()=>{if(signal.aborted)throw new AppError('IPC006','任务已停止。');};
    try{
      t.snapshot.startedAt??=Date.now();this.change(t,'running');
      if(await realpath(dirname(p.localPath))!==p.localParent)throw new AppError('FILE_CONFLICT','本地目录身份已改变。');
      if(this.store.profile(t.snapshot.profileId).revision!==p.profileRevision)throw new AppError('FILE_CONFLICT','连接配置已改变，不能继续旧任务。');
      if(p.transport==='ftp'){
        if(!this.ftp)throw new AppError('CAPABILITY_UNAVAILABLE','FTP 传输服务不可用。');
        await this.ftp.run(t,signal,state=>this.change(t,state),()=>this.persist(t));return;
      }
      if(p.transport==='s3'){
        if(!this.s3)throw new AppError('CAPABILITY_UNAVAILABLE','AWS S3 transfer service is unavailable.');
        await this.s3.run(t,signal,state=>this.change(t,state));return;
      }
      lease=await this.connections.acquire(t.owner,t.snapshot.profileId);check();
      const sftp=await this.connections.sftp(t.owner,lease.connectionId),upload=t.snapshot.direction==='upload';
      if(p.remoteParent&&await remoteRealpath(sftp,posix.dirname(p.remotePath))!==p.remoteParent)throw new AppError('FILE_CONFLICT','远端父目录已改变。');
      const sourceStat=upload?await lstat(p.localPath):await stat(sftp,p.remotePath);
      if(!sourceStat.isFile()||sourceStat.isSymbolicLink())throw new AppError('FILE_CONFLICT','源必须为普通文件。');
      const modified='mtimeMs' in sourceStat?sourceStat.mtimeMs:sourceStat.mtime*1000;
      if(p.expectedSource&&(p.expectedSource.size!==sourceStat.size||p.expectedSource.modified!==modified))throw new AppError('FILE_CONFLICT','预览后源文件发生变化，请重新比较。');
      const size=sourceStat.size;if(!Number.isSafeInteger(size))throw new AppError('FILE_LIMIT','文件大小超出当前实现范围。');
      t.snapshot.totalBytes=size;
      let lastHashProgress=0;
      const progress:HashProgress=(bytes,totalBytes,method)=>{t.snapshot.verification={bytes,totalBytes,method};if(bytes===0||bytes===totalBytes||Date.now()-lastHashProgress>=150){lastHashProgress=Date.now();this.emit(t.owner,{type:'task.state',task:{...t.snapshot}});}};
      const localHash=(stream:Readable,total=size)=>hashTransferStream(stream,signal,total,progress);
      const remoteHash=async(path:string,total=size)=>{
        let canonical=path;
        if(!posix.isAbsolute(path)){
          try{canonical=await remoteRealpath(sftp,path);}catch{return localHash(sftp.createReadStream(path),total);}
        }
        check();
        return hashRemoteFile(this.connections.get(t.owner,lease!.connectionId).client,canonical,total,signal,()=>sftp.createReadStream(path),progress);
      };
      const readSource=(start=0,end?:number):Readable=>upload?createReadStream(p.localPath,{start,end,highWaterMark:1024*1024}):sftp.createReadStream(p.remotePath,{start,end});
      const sourceHash=upload?await localHash(readSource()):await remoteHash(p.remotePath);check();
      if((p.expectedSource?.hash&&p.expectedSource.hash!==sourceHash)||(p.sourceHash&&p.sourceHash!==sourceHash))throw new AppError('FILE_CONFLICT','源文件已改变，拒绝续传。');
      p.sourceHash=sourceHash;p.sourceSize=size;t.snapshot.totalBytes=size;this.persist(t);
      const verifyTarget=async()=>{
        if(!p.expectedTarget){try{upload?await stat(sftp,p.remotePath):await lstat(p.localPath);throw new AppError('FILE_CONFLICT','目标文件已存在，请另存。');}catch(e){if(!isMissing(e))throw e;}return undefined;}
        const expected=p.expectedTarget;
        if(!expected.hash||!/^[a-f0-9]{64}$/.test(expected.hash))throw new AppError('FILE_CONFLICT','覆盖操作缺少目标内容校验，请重新比较。');
        const current=upload?await stat(sftp,p.remotePath):await lstat(p.localPath);
        const mtime='mtimeMs' in current?current.mtimeMs:current.mtime*1000;
        if(!current.isFile()||current.isSymbolicLink()||current.size!==expected.size||mtime!==expected.modified)throw new AppError('FILE_CONFLICT','预览后目标文件发生变化，已拒绝覆盖。');
        const hash=upload?await remoteHash(p.remotePath,expected.size):await localHash(createReadStream(p.localPath),expected.size);
        if(hash!==expected.hash)throw new AppError('FILE_CONFLICT','预览后目标文件内容发生变化，已拒绝覆盖。');
        const after=upload?await stat(sftp,p.remotePath):await lstat(p.localPath);if(!after.isFile()||after.isSymbolicLink()||after.size!==expected.size||('mtimeMs' in after?after.mtimeMs:after.mtime*1000)!==expected.modified)throw new AppError('FILE_CONFLICT','校验期间目标文件发生变化。');
        return current;
      };
      const originalTarget=await verifyTarget();
      let offset=0,tempExists=false;
      try{const st=upload?await stat(sftp,p.temp):await lstat(p.temp);if(!st.isFile()||st.isSymbolicLink())throw new AppError('FILE_CONFLICT','临时文件类型不正确。');offset=st.size;tempExists=true;}catch(e){if(!isMissing(e))throw e;}
      if(offset>size)throw new AppError('FILE_CONFLICT','检查点超出源文件大小。');
      if(offset>0){
        const prefix=await localHash(readSource(0,offset-1),offset);
        const temporary=upload?await remoteHash(p.temp,offset):await localHash(createReadStream(p.temp),offset);
        if(prefix!==temporary)throw new AppError('FILE_CONFLICT','已传输内容校验失败。');
      }
      t.snapshot.verification=undefined;t.snapshot.transferredBytes=offset;check();
      if(offset<size||(!tempExists&&size===0)){
        let last=0;
        const meter=new Transform({transform:(chunk:Buffer,_encoding,callback)=>{t.snapshot.transferredBytes+=chunk.length;if(Date.now()-last>100){last=Date.now();this.emit(t.owner,{type:'task.state',task:{...t.snapshot}});}callback(null,chunk);}});
        const destination=upload?sftp.createWriteStream(p.temp,{flags:tempExists?'r+':'wx',start:offset,mode:0o600}):createWriteStream(p.temp,{flags:tempExists?'r+':'wx',start:offset,mode:0o600});
        await pipeline(readSource(offset),meter,destination,{signal});
      }
      check();this.change(t,'verifying');
      const targetHash=upload?await remoteHash(p.temp):await localHash(createReadStream(p.temp));
      if(targetHash!==sourceHash)throw new AppError('FILE_CONFLICT','传输内容校验不一致。');
      if((upload?await localHash(readSource()):await remoteHash(p.remotePath))!==sourceHash)throw new AppError('FILE_CONFLICT','传输期间源文件改变。');
      const afterSource=upload?await lstat(p.localPath):await stat(sftp,p.remotePath);
      if(!afterSource.isFile()||afterSource.isSymbolicLink()||afterSource.size!==size||('mtimeMs' in afterSource?afterSource.mtimeMs:afterSource.mtime*1000)!==modified)throw new AppError('FILE_CONFLICT','传输期间源文件改变。');
      if(p.preserveModified){
        if(upload)await new Promise<void>((resolve,reject)=>sftp.setstat(p.temp,{mtime:Math.floor(modified/1000),atime:Math.floor(modified/1000),...(originalTarget?{mode:originalTarget.mode&0o777}:{})},e=>e?reject(e):resolve()));
        else{await utimes(p.temp,modified/1000,modified/1000);if(originalTarget)await chmod(p.temp,originalTarget.mode&0o777);}
      }
      if(await realpath(dirname(p.localPath))!==p.localParent||p.remoteParent&&await remoteRealpath(sftp,posix.dirname(p.remotePath))!==p.remoteParent)throw new AppError('FILE_CONFLICT','提交前父目录发生变化。');
      await verifyTarget();check();p.committing=true;this.change(t,'committing');
      if(upload&&p.expectedTarget){
        try{await new Promise<void>((resolve,reject)=>{try{sftp.ext_openssh_rename(p.temp,p.remotePath,e=>e?reject((e as Error&{code?:number}).code===8?new AppError('CAPABILITY_UNAVAILABLE','服务端不支持原子覆盖，原文件保持不变。'):e):resolve());}catch{reject(new AppError('CAPABILITY_UNAVAILABLE','服务端不支持原子覆盖，原文件保持不变。'));}});}catch(e){if(e instanceof AppError&&e.code==='CAPABILITY_UNAVAILABLE')p.committing=false;throw e;}
      }else if(upload)await rename(sftp,p.temp,p.remotePath);
      else if(p.expectedTarget)await localRename(p.temp,p.localPath);
      else{await link(p.temp,p.localPath);await localUnlink(p.temp);}
      p.committing=false;t.snapshot.transferredBytes=size;this.change(t,'succeeded');
    }catch(e){
      const error=safeError(e);
      this.change(t,t.stop??(error.code==='FILE_CONFLICT'||p.committing?'conflict':'failed'),t.stop?undefined:p.committing?'提交结果未知，请手动核对目标。':error.message);
    }finally{
      t.abort=undefined;
      if(lease)this.connections.release(t.owner,lease.leaseId);
    }
  }
  async stop(){this.stopped=true;for(const t of this.tasks.values())if(this.running.has(t.snapshot.taskId)&&!t.plan.committing){t.stop='paused';t.abort?.abort();}while(this.running.size)await new Promise(r=>setTimeout(r,20));}
}
function isMissing(e:unknown){return (e as {code?:unknown})?.code==='ENOENT'||(e as {code?:unknown})?.code===2;}
