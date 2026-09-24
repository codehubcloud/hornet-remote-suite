import { randomUUID,createHash } from 'node:crypto';
import { createReadStream,createWriteStream } from 'node:fs';
import { lstat,realpath,link,unlink as localUnlink } from 'node:fs/promises';
import { dirname,basename,join,posix } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { SFTPWrapper } from 'ssh2';
import { Connections } from '../ssh/connections';
import { stat,unlink,rename } from './files';
import { Storage } from '../../packages/storage/database';
import type { TaskSnapshot,HornetEvent } from '../../packages/contracts';
import { AppError,safeError } from '../../packages/core/errors';

interface Plan { localPath:string; localParent:string; remotePath:string; temp:string; profileRevision:number; sourceHash?:string; sourceSize?:number; committing?:boolean }
interface Task { snapshot:TaskSnapshot;owner:string;key:string;hash:string;plan:Plan; abort?:AbortController; stop?:'paused'|'cancelled' }
export class Transfers {
  private tasks=new Map<string,Task>();private running=new Set<string>();private stopped=false;
  constructor(private store:Storage,private connections:Connections,private emit:(owner:string,event:HornetEvent)=>void){
    for(const r of store.loadTasks()){
      const task:Task={snapshot:r.snapshot,owner:r.owner,key:r.key,hash:r.hash,plan:r.detail as Plan};
      if(['queued','running','verifying','pausing','cancelling'].includes(task.snapshot.state))task.snapshot={...task.snapshot,state:'paused',revision:task.snapshot.revision+1,error:'应用已重启，恢复前会重新校验文件。'};
      if(task.snapshot.state==='committing')task.snapshot={...task.snapshot,state:'conflict',revision:task.snapshot.revision+1,error:'提交结果未知，请检查目标文件。禁止自动重复提交。'};
      this.tasks.set(task.snapshot.taskId,task);this.persist(task);
    }
  }
  list(owner:string){return [...this.tasks.values()].filter(t=>t.owner===owner).map(t=>t.snapshot).sort((a,b)=>b.updatedAt-a.updatedAt);}
  hasProfile(profileId:string){return [...this.tasks.values()].some(t=>t.snapshot.profileId===profileId&&!['succeeded','cancelled','failed','conflict'].includes(t.snapshot.state));}
  async start(owner:string,connectionId:string,direction:'upload'|'download',localPath:string,localParent:string,remotePath:string,key:string){
    const c=this.connections.get(owner,connectionId);
    const hash=createHash('sha256').update(JSON.stringify({profileId:c.profile.profileId,direction,localPath,remotePath})).digest('hex');
    const previous=[...this.tasks.values()].find(t=>t.owner===owner&&t.key===key);
    if(previous){if(previous.hash!==hash)throw new AppError('TASK_STATE_CONFLICT','同一请求标识不能用于不同传输。');return previous.snapshot;}
    const id=randomUUID();
    const plan:Plan={localPath,localParent,remotePath,profileRevision:c.profile.revision,temp:direction==='upload'?posix.join(posix.dirname(remotePath),'.hornet-'+id+'.part'):join(dirname(localPath),'.hornet-'+id+'.part')};
    const task:Task={owner,key,hash,plan,snapshot:{taskId:id,profileId:c.profile.profileId,direction,name:direction==='upload'?basename(localPath):posix.basename(remotePath),state:'queued',totalBytes:0,transferredBytes:0,revision:1,updatedAt:Date.now()}};
    this.tasks.set(id,task);this.persist(task);this.emit(owner,{type:'task.state',task:task.snapshot});this.pump();return task.snapshot;
  }
  private get(owner:string,id:string,revision:number){const t=this.tasks.get(id);if(!t||t.owner!==owner)throw new AppError('IPC005','无权访问任务。');if(t.snapshot.revision!==revision)throw new AppError('TASK_STATE_CONFLICT','任务状态已改变，请刷新。');return t;}
  pause(owner:string,id:string,revision:number){const t=this.get(owner,id,revision);if(!['running','queued','verifying'].includes(t.snapshot.state))throw new AppError('TASK_STATE_CONFLICT','当前阶段不能暂停。');if(this.running.has(id)){t.stop='paused';this.change(t,'pausing');t.abort?.abort();}else this.change(t,'paused');}
  cancel(owner:string,id:string,revision:number){const t=this.get(owner,id,revision);if(['succeeded','committing','cancelled'].includes(t.snapshot.state))throw new AppError('TASK_STATE_CONFLICT','任务已完成或正在提交，不能取消。');if(this.running.has(id)){t.stop='cancelled';this.change(t,'cancelling');t.abort?.abort();}else this.change(t,'cancelled');}
  resume(owner:string,id:string,revision:number){const t=this.get(owner,id,revision);if(!['paused','failed'].includes(t.snapshot.state)||t.plan.committing)throw new AppError('TASK_STATE_CONFLICT','此任务不能安全恢复。');t.stop=undefined;this.change(t,'queued');this.pump();}
  private change(t:Task,state:TaskSnapshot['state'],error?:string){t.snapshot={...t.snapshot,state,error,revision:t.snapshot.revision+1,updatedAt:Date.now()};this.persist(t);this.emit(t.owner,{type:'task.state',task:t.snapshot});}
  private persist(t:Task){this.store.saveTask(t.snapshot,t.owner,t.key,t.hash,t.plan);}
  private pump(){
    if(this.stopped)return;
    for(const t of this.tasks.values()){
      if(this.running.size>=4)break;
      if(t.snapshot.state!=='queued')continue;
      const active=[...this.running].filter(id=>this.tasks.get(id)?.snapshot.profileId===t.snapshot.profileId).length;
      if(active>=2)continue;
      this.running.add(t.snapshot.taskId);
      void this.run(t).finally(()=>{this.running.delete(t.snapshot.taskId);this.pump();});
    }
  }
  private async hashStream(stream:Readable,signal:AbortSignal):Promise<string>{
    const hash=createHash('sha256');const abort=()=>stream.destroy(new AppError('IPC006','已停止。'));signal.addEventListener('abort',abort,{once:true});
    try{if(signal.aborted)throw new AppError('IPC006','已停止。');for await(const chunk of stream){if(signal.aborted)throw new AppError('IPC006','已停止。');hash.update(chunk);}return hash.digest('hex');}
    finally{signal.removeEventListener('abort',abort);stream.destroy();}
  }
  private async run(t:Task){
    let lease:Awaited<ReturnType<Connections['acquire']>>|undefined;
    const abort=new AbortController();t.abort=abort;const signal=abort.signal;const p=t.plan;
    const check=()=>{if(signal.aborted)throw new AppError('IPC006','任务已停止。');};
    try{
      this.change(t,'running');
      if(await realpath(dirname(p.localPath))!==p.localParent)throw new AppError('FILE_CONFLICT','本地目录身份已改变。');
      if(this.store.profile(t.snapshot.profileId).revision!==p.profileRevision)throw new AppError('FILE_CONFLICT','连接配置已改变，不能继续旧任务。');
      lease=await this.connections.acquire(t.owner,t.snapshot.profileId);check();
      const sftp=await this.connections.sftp(t.owner,lease.connectionId),upload=t.snapshot.direction==='upload';
      const sourceStat=upload?await lstat(p.localPath):await stat(sftp,p.remotePath);
      if(!sourceStat.isFile()||sourceStat.isSymbolicLink())throw new AppError('FILE_CONFLICT','源必须为普通文件。');
      const size=sourceStat.size;if(!Number.isSafeInteger(size))throw new AppError('FILE_LIMIT','文件大小超出当前实现范围。');
      const readSource=(start=0,end?:number):Readable=>upload?createReadStream(p.localPath,{start,end}):sftp.createReadStream(p.remotePath,{start,end});
      const sourceHash=await this.hashStream(readSource(),signal);check();
      if(p.sourceHash&&p.sourceHash!==sourceHash)throw new AppError('FILE_CONFLICT','源文件已改变，拒绝续传。');
      p.sourceHash=sourceHash;p.sourceSize=size;t.snapshot.totalBytes=size;this.persist(t);
      // Never overwrite an existing final destination.
      try{upload?await stat(sftp,p.remotePath):await lstat(p.localPath);throw new AppError('FILE_CONFLICT','目标文件已存在，请另存。');}
      catch(e){if(!isMissing(e))throw e;}
      let offset=0,tempExists=false;
      try{const st=upload?await stat(sftp,p.temp):await lstat(p.temp);if(!st.isFile()||st.isSymbolicLink())throw new AppError('FILE_CONFLICT','临时文件类型不正确。');offset=st.size;tempExists=true;}catch(e){if(!isMissing(e))throw e;}
      if(offset>size)throw new AppError('FILE_CONFLICT','检查点超出源文件大小。');
      if(offset>0){
        const readTemp=upload?sftp.createReadStream(p.temp):createReadStream(p.temp);
        if(await this.hashStream(readSource(0,offset-1),signal)!==await this.hashStream(readTemp,signal))throw new AppError('FILE_CONFLICT','已传输内容校验失败。');
      }
      t.snapshot.transferredBytes=offset;check();
      if(offset<size||(!tempExists&&size===0)){
        let last=0;
        const meter=new Transform({transform:(chunk:Buffer,_encoding,callback)=>{t.snapshot.transferredBytes+=chunk.length;if(Date.now()-last>100){last=Date.now();this.emit(t.owner,{type:'task.state',task:{...t.snapshot}});}callback(null,chunk);}});
        const destination=upload?sftp.createWriteStream(p.temp,{flags:tempExists?'r+':'wx',start:offset,mode:0o600}):createWriteStream(p.temp,{flags:tempExists?'r+':'wx',start:offset,mode:0o600});
        await pipeline(readSource(offset),meter,destination,{signal});
      }
      check();this.change(t,'verifying');
      const targetHash=await this.hashStream(upload?sftp.createReadStream(p.temp):createReadStream(p.temp),signal);
      if(targetHash!==sourceHash)throw new AppError('FILE_CONFLICT','传输内容校验不一致。');
      if(await this.hashStream(readSource(),signal)!==sourceHash)throw new AppError('FILE_CONFLICT','传输期间源文件改变。');
      check();p.committing=true;this.change(t,'committing');
      if(upload)await rename(sftp,p.temp,p.remotePath);
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
