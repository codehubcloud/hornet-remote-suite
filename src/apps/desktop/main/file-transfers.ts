import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { basename,dirname,extname,join,posix } from 'node:path';
import type { TaskSnapshot } from '../../../packages/contracts';
import type { TransferRequest,TransferInfo,TransferFile,TransferPreparation,TransferConflict,ConflictAction } from '../../../packages/contracts/file-transfer';
import type { TransferContext } from '../../../services/file/tree-transfers';
import { hashFile } from '../../../services/file/hash-file';
import { treeName } from '../../../services/file/tree';
import { PathGrants,type PathGrant } from '../../../packages/security/path-grants';
import { AppError } from '../../../packages/core/errors';
interface Backend {call<T>(method:string,payload?:unknown,context?:TransferContext):Promise<T>}
interface Pending {sender:number;request:TransferRequest;grant:PathGrant;info:TransferInfo;conflict:TransferConflict;expires:number;run?:Promise<TransferPreparation>}
const same=(a:TransferFile,b:TransferFile)=>a.kind===b.kind&&a.size===b.size&&a.modified===b.modified;
async function localInfo(path:string,withHash=false):Promise<TransferFile|undefined>{
 let info;try{info=await lstat(path);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
 const file:TransferFile={path,kind:info.isSymbolicLink()?'link':info.isFile()?'file':info.isDirectory()?'directory':'other',size:info.size,modified:info.mtimeMs};
 if(withHash&&file.kind==='file'){file.hash=await hashFile(createReadStream(path));const after=await lstat(path);if(!after.isFile()||after.isSymbolicLink()||after.size!==info.size||after.mtimeMs!==info.mtimeMs)throw new AppError('FILE_CONFLICT','目标文件在比较期间发生变化。');}return file;
}
export class FileTransfers {
 private pending=new Map<string,Pending>();
 constructor(private grants:PathGrants,private backend:Backend){}
 private remote(request:TransferRequest,withHash=false){return this.backend.call<TransferInfo>('file.transferInfo',{connectionId:request.connectionId,path:request.remotePath,withHash});}
 async prepare(sender:number,request:TransferRequest):Promise<TransferPreparation>{
  for(const [id,item]of this.pending)if(item.expires<Date.now())this.pending.delete(id);
  if([...this.pending.values()].filter(item=>!item.run).length>=64)throw new AppError('FILE_LIMIT','请先处理已有的文件冲突。');
  const grant=await this.grants.get('local-user',request.pathGrantId,request.direction),info=await this.remote(request),local=await localInfo(grant.path);
  const upload=request.direction==='upload',source=upload?local:info.file,target=upload?info.file:local;
  if(source?.kind!=='file')throw new AppError('FILE_CONFLICT','源必须为普通文件。');
  if(upload&&info.transport!=='s3'&&posix.resolve(info.path)!==info.path)throw new AppError('FILE_CONFLICT','远端目录无效。');
  request={...request,remotePath:info.path};
  if(!target)return this.start(request,grant,info,source);
  const conflict:TransferConflict={id:randomUUID(),direction:request.direction,source,target,canReplace:target.kind==='file'&&info.transport!=='s3'};
  this.pending.set(conflict.id,{sender,request,grant,info,conflict,expires:Date.now()+10*60*1000});return {kind:'conflict',conflict};
 }
 private pendingFor(sender:number,id:string){const pending=this.pending.get(id);if(!pending||pending.sender!==sender||pending.expires<Date.now())throw new AppError('IPC005','文件冲突确认已过期，请重新传输。');return pending;}
 private async renamed(p:Pending,name:string){
  try{treeName(name,p.request.direction==='download'&&process.platform==='win32');}catch{throw new AppError('FILE_NAME_INVALID','请输入有效的文件名，不要包含目录分隔符。');}
  const upload=p.request.direction==='upload',remotePath=upload?posix.join(posix.dirname(p.request.remotePath),name):p.request.remotePath,localPath=upload?p.grant.path:join(p.grant.parent,name);
  await this.grants.get('local-user',p.request.pathGrantId,p.request.direction);
  const target=upload?(await this.remote({...p.request,remotePath})).file:await localInfo(localPath);
  if(target)throw new AppError('FILE_NAME_EXISTS','该名称已存在，请输入其他名称。');
  return {remotePath,localPath};
 }
 async checkName(sender:number,id:string,name:string){const pending=this.pendingFor(sender,id);if(pending.run)throw new AppError('IPC005','文件冲突已经处理。');await this.renamed(pending,name);}
 resolve(sender:number,id:string,action:ConflictAction,name?:string):Promise<TransferPreparation>{
  const pending=this.pending.get(id);if(!pending||pending.sender!==sender||pending.expires<Date.now())return Promise.reject(new AppError('IPC005','文件冲突确认已过期，请重新传输。'));
  if(pending.run)return pending.run;
  pending.run=this.decide(pending,action,name).finally(()=>{pending.expires=Date.now()+60000;});return pending.run;
 }
 private async decide(p:Pending,action:ConflictAction,newName?:string):Promise<TransferPreparation>{
  if(action==='cancel'||action==='skip')return {kind:action==='cancel'?'cancelled':'skipped'};
  const {request:r,conflict:c}=p,upload=r.direction==='upload';await this.grants.get('local-user',r.pathGrantId,r.direction);
  if(action==='newer'&&c.source.modified<=c.target.modified)return {kind:'skipped'};
  if(action==='rename'&&newName){
   const paths=await this.renamed(p,newName),grant=upload?p.grant:await this.grants.create('local-user',paths.localPath,'download');
   return this.start({...r,remotePath:paths.remotePath,pathGrantId:grant.id},grant,p.info,c.source);
  }
  if(action==='keep-both'||action==='rename'){
   const original=upload?r.remotePath:p.grant.path,name=upload?posix.basename(original):basename(original),extension=extname(name),stem=name.slice(0,name.length-extension.length);
   for(let index=1;index<=1000;index++){const nextName=stem+' ('+index+')'+extension,remotePath=upload?posix.join(posix.dirname(r.remotePath),nextName):r.remotePath;
    const target=upload?(await this.remote({...r,remotePath})).file:await localInfo(join(p.grant.parent,nextName));if(target)continue;
    const grant=upload?p.grant:await this.grants.create('local-user',join(p.grant.parent,nextName),'download');
    return this.start({...r,remotePath,pathGrantId:grant.id},grant,p.info,c.source);
   }throw new AppError('FILE_CONFLICT','无法生成未使用的文件名。');
  }
  if(!c.canReplace)throw new AppError('CAPABILITY_UNAVAILABLE','此目标不支持替换，请保留双方或跳过。');
  const target=upload?(await this.remote(r,true)).file:await localInfo(p.grant.path,true);
  if(!target||!same(target,c.target)||!target.hash)throw new AppError('FILE_CONFLICT','目标文件已变化，请重新传输并确认。');
  return this.start(r,p.grant,p.info,c.source,target);
 }
 private async start(request:TransferRequest,grant:PathGrant,info:TransferInfo,source:TransferFile,target?:TransferFile):Promise<TransferPreparation>{
  const context:TransferContext={localPath:grant.path,localParent:grant.parent,...(info.transport!=='s3'?{expectedSource:{size:source.size,modified:source.modified},...(target?{expectedTarget:{size:target.size,modified:target.modified,hash:target.hash}}:{}),...(info.transport==='ssh'?{remoteParent:posix.dirname(request.remotePath),preserveModified:true}:{})}:{})};
  const task=await this.backend.call<TaskSnapshot>('transfer.start',{...request,idempotencyKey:randomUUID()},context);return {kind:'started',task};
 }
}
