import { randomUUID } from 'node:crypto';
import { lstatSync,realpathSync } from 'node:fs';
import { mkdtemp,mkdir,lstat,realpath,rm } from 'node:fs/promises';
import { basename,join } from 'node:path';
import type { TaskSnapshot } from '../../../packages/contracts';
import type { Backend } from './backend';
import { AppError } from '../../../packages/core/errors';
import { PathGrants } from '../../../packages/security/path-grants';

// Only verified files in this process's private temporary directory can leave
// through startDrag. A renderer never supplies the native local path.
export class FileDrags {
 private root?:Promise<string>;
 private ready=new Map<string,{sender:number;paths:string[]}>();
 private pending=new Map<number,number>();
 private stopped=false;
 constructor(private cache:string,private backend:Pick<Backend,'call'>,private tasks:Map<string,TaskSnapshot>,private senderAlive:(sender:number)=>boolean){}
 async prepare(sender:number,connectionId:string,files:{path:string;name:string}[]){
  if(this.stopped||!this.senderAlive(sender))throw new AppError('IPC005','文件视图已关闭。');
  if((this.pending.get(sender)??0)>=2)throw new AppError('FILE_LIMIT','请等待当前文件准备完成。');
  if(this.ready.size>=32)throw new AppError('FILE_LIMIT','拖出缓存已达上限，请重启软件后重试。');
  const names=new Set<string>();
  for(const file of files){if(file.name!==basename(file.name)||/[<>:"/\\|?*\x00-\x1f\x7f]/.test(file.name)||/[. ]$/.test(file.name)||/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(file.name)||names.has(file.name.toLowerCase()))throw new AppError('IPC002','文件名不适合拖到本地目录。');names.add(file.name.toLowerCase());}
  this.pending.set(sender,(this.pending.get(sender)??0)+1);
  let directory:string|undefined;const started:string[]=[];
  try{
   this.root??=(async()=>{await mkdir(this.cache,{recursive:true});return realpath(await mkdtemp(join(this.cache,'file-drag-')));})();
   directory=await mkdtemp(join(await this.root,'batch-'));
   const grants=new PathGrants(),paths:string[]=[];
   for(const file of files){const grant=await grants.create('local-user',join(directory,file.name),'download');paths.push(grant.path);
    const task=await this.backend.call<TaskSnapshot>('transfer.start',{connectionId,direction:'download',pathGrantId:grant.id,remotePath:file.path,idempotencyKey:randomUUID()},{localPath:grant.path,localParent:grant.parent});started.push(task.taskId);
   }
   const deadline=Date.now()+30*60*1000;
   while(true){
    if(this.stopped||!this.senderAlive(sender))throw new AppError('IPC005','文件视图已关闭。');
    const states=started.map(id=>this.tasks.get(id));
    const failed=states.find(task=>task&&['failed','conflict','cancelled','paused'].includes(task.state));
    if(failed)throw new AppError('FILE_CONFLICT',failed.error??'下载未完成，请重新准备拖出文件。');
    if(states.every(task=>task?.state==='succeeded'))break;
    if(Date.now()>deadline)throw new AppError('FILE_LIMIT','准备拖出文件超时。');
    await new Promise(resolve=>setTimeout(resolve,100));
   }
   for(const path of paths){const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||await realpath(path)!==path)throw new AppError('IPC005','拖出文件已改变。');}
   const token=randomUUID();this.ready.set(token,{sender,paths});return {token};
  }catch(error){
   for(const id of started){const task=this.tasks.get(id);if(task&&!['succeeded','failed','conflict','cancelled','committing'].includes(task.state))await this.backend.call('task.cancel',{taskId:id,expectedRevision:task.revision}).catch(()=>{});}
   // A cancelled task may still be unwinding its stream; cleanup is retried at exit.
   if(directory)await rm(directory,{recursive:true,force:true}).catch(()=>{});throw error;
  }finally{const count=(this.pending.get(sender)??1)-1;if(count)this.pending.set(sender,count);else this.pending.delete(sender);}
 }
 paths(sender:number,token:string){const item=this.ready.get(token);if(!item||item.sender!==sender||this.stopped||!this.senderAlive(sender))throw new AppError('IPC005','请先下载并准备拖出文件。');for(const path of item.paths){const info=lstatSync(path);if(!info.isFile()||info.isSymbolicLink()||realpathSync(path)!==path)throw new AppError('IPC005','拖出文件已改变。');}return [...item.paths];}
 async stop(){this.stopped=true;this.ready.clear();if(this.root)await rm(await this.root,{recursive:true,force:true,maxRetries:3,retryDelay:100}).catch(()=>{});}
}
