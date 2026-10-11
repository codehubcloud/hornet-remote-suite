import { createHash,randomUUID } from 'node:crypto';
import { join,posix } from 'node:path';
import type { FileTree,TreeAction,TreePreview,TreeRequest,TreeResult } from '../../packages/contracts/file-tree';
import type { TaskSnapshot } from '../../packages/contracts';
import { AppError } from '../../packages/core/errors';
import { LocalFiles } from './local-files';
import { PathGrants } from '../../packages/security/path-grants';
import { treeName } from './tree';
import { planSync } from './sync-plan';

export interface FileSnapshot {size:number;modified:number;hash?:string}
export interface TransferContext { expectedTarget?:FileSnapshot;preserveModified?:boolean; localPath:string;localParent:string;remoteParent?:string;expectedSource?:FileSnapshot }
interface Backend { call<T>(method:string,payload?:unknown,context?:TransferContext):Promise<T> }
interface Plan { owner:string;request:TreeRequest;preview:TreePreview;trees:FileTree[];fingerprint:string;run?:Promise<TreeResult> }
const fingerprint=(trees:FileTree[])=>createHash('sha256').update(JSON.stringify(trees.map(t=>({...t,entries:t.entries.map(({hash,...entry})=>entry)})))).digest('hex');

// Plans stay in the main process. Renderer-supplied paths or edited preview rows
// cannot substitute the reviewed source/destination at execution time.
export class TreeTransfers {
 private plans=new Map<string,Plan>();private executing=false;private previews=0;
 constructor(private local:LocalFiles,private grants:PathGrants,private backend:Backend){}
 private async trees(owner:string,r:TreeRequest){
  const results=await Promise.allSettled([
   this.local.tree(owner,r.rootId,r.localPath),
   this.backend.call<FileTree>('file.tree',{connectionId:r.connectionId,path:r.remotePath}),
  ]);
  // Keep the scan slot until both sides settle, even if one fails early.
  return results.map(result=>{if(result.status==='rejected')throw result.reason;return result.value;});
 }
 async preview(owner:string,request:TreeRequest):Promise<TreePreview>{
  if(this.previews>=2)throw new AppError('FILE_LIMIT','已有目录扫描正在进行，请稍后重试。');
  this.previews++;
  try{
   for(const [id,p] of this.plans)if(p.preview.expiresAt<Date.now()&&!p.run)this.plans.delete(id);
   if(this.plans.size>=8)throw new AppError('FILE_LIMIT','请关闭其他目录预览后再试。');
   for(const name of request.names??[])treeName(name);
   const trees=await this.trees(owner,request);
   const selected=new Set(request.names),source=request.direction==='download'?trees[1]:trees[0];
   for(const name of selected)if(!source.entries.some(e=>e.path===name))throw new AppError('FILE_CONFLICT','选择的条目已改变，请刷新：'+name);
   if(request.direction==='bidirectional'||request.policy&&request.policy!=='skip'){
    const targets=new Map(trees[1].entries.map(e=>[e.path,e])),deadline=Date.now()+75000;
    for(const left of trees[0].entries){
     if(selected.size&&!selected.has(left.path.split('/')[0]))continue;
     const right=targets.get(left.path);if(left.kind!=='file'||right?.kind!=='file')continue;
     if(Date.now()>deadline)throw new AppError('FILE_LIMIT','目录内容比较超时，请缩小范围。');
     const hashes=await Promise.allSettled([this.local.hash(owner,request.rootId,join(request.localPath,left.path)),this.backend.call<FileSnapshot>('file.tree.hash',{connectionId:request.connectionId,root:request.remotePath,path:right.path})]);
     for(let i=0;i<2;i++){const result=hashes[i];if(result.status==='rejected')throw result.reason;const entry=i===0?left:right;if(entry.size!==result.value.size||entry.modified!==result.value.modified)throw new AppError('FILE_CONFLICT','比较期间文件发生变化。');entry.hash=result.value.hash;}
    }
   }
   const actions=planSync(trees[0],trees[1],request);
   const files=actions.filter(a=>a.action==='copy'||a.action==='replace'),bytes=files.reduce((sum,a)=>sum+a.size,0);
   if(!Number.isSafeInteger(bytes))throw new AppError('FILE_LIMIT','传输总大小超出支持范围。');
   const preview:TreePreview={planId:randomUUID(),direction:request.direction,policy:request.policy??'skip',localPath:trees[0].root,remotePath:trees[1].root,expiresAt:Date.now()+10*60*1000,actions,files:files.length,directories:actions.filter(a=>a.action==='mkdir').length,bytes,conflicts:actions.filter(a=>a.action==='conflict').length};
   this.plans.set(preview.planId,{owner,request:structuredClone(request),preview,trees,fingerprint:fingerprint(trees)});
   return structuredClone(preview);
  }finally{this.previews--;}
 }
 execute(owner:string,id:string):Promise<TreeResult>{
  const plan=this.plans.get(id);
  if(!plan||plan.owner!==owner)throw new AppError('IPC005','目录预览已失效。');
  if(plan.run)return plan.run;
  if(plan.preview.expiresAt<Date.now())throw new AppError('FILE_CONFLICT','目录预览已过期，请重新比较。');
  if(this.executing)throw new AppError('TASK_STATE_CONFLICT','另一批目录任务正在加入队列。');
  this.executing=true;
  plan.run=this.run(plan).finally(()=>{this.executing=false;});
  return plan.run;
 }
 private async run(plan:Plan):Promise<TreeResult>{
  const {owner,request:r,preview}=plan;
  const result:TreeResult={taskIds:[],directories:0,skipped:preview.actions.filter(a=>a.action==='conflict'||a.action==='skip').length};
  try{
   if(fingerprint(await this.trees(owner,r))!==plan.fingerprint)throw new AppError('FILE_CONFLICT','预览后目录内容发生变化，请重新比较。尚未提交本批任务。');
   for(const action of preview.actions.filter(a=>a.action==='mkdir').sort((a,b)=>a.path.split('/').length-b.path.split('/').length)){
    if(action.direction==='upload')await this.backend.call('file.tree.mkdir',{connectionId:r.connectionId,root:r.remotePath,path:action.path});
    else await this.local.mkdir(owner,r.rootId,join(r.localPath,posix.dirname(action.path)),posix.basename(action.path));
    result.directories++;
   }
   for(const action of preview.actions.filter(a=>a.action==='copy'||a.action==='replace')){
    const direction=action.direction!,sourcePath=action.sourcePath??action.path;
    const localPath=join(r.localPath,direction==='upload'?sourcePath:action.path),remotePath=posix.join(r.remotePath,direction==='upload'?action.path:sourcePath);
    const grantId=await this.local.grant(owner,r.rootId,direction==='upload'?localPath:join(r.localPath,posix.dirname(action.path)),direction,posix.basename(action.path),action.action==='replace');
    const grant=await this.grants.get(owner,grantId.pathGrantId,direction);
    const source=plan.trees[direction==='upload'?0:1].entries.find(e=>e.path===sourcePath)!;
    const target=plan.trees[direction==='upload'?1:0].entries.find(e=>e.path===action.path);
    const snapshot=(e:typeof source):FileSnapshot=>({size:e.size,modified:e.modified,hash:e.hash});
    const task=await this.backend.call<TaskSnapshot>('transfer.start',{connectionId:r.connectionId,direction,pathGrantId:grant.id,remotePath,idempotencyKey:randomUUID()},
     {localPath:grant.path,localParent:grant.parent,remoteParent:posix.dirname(remotePath),expectedSource:snapshot(source),expectedTarget:action.action==='replace'?snapshot(target!):undefined,preserveModified:true});
    result.taskIds.push(task.taskId);
   }
  }catch(e){result.error=e instanceof Error?e.message:'目录操作失败。';}
  return result;
 }
 discard(owner:string,id:string){if(this.plans.get(id)?.owner===owner)this.plans.delete(id);}
}
