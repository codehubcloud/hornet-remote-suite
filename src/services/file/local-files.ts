import { createReadStream } from 'node:fs';
import { hashFile } from './hash-file';
import { randomUUID } from 'node:crypto';
import { lstat,realpath,opendir,mkdir } from 'node:fs/promises';
import { resolve,relative,isAbsolute,sep,join } from 'node:path';
import { AppError } from '../../packages/core/errors';
import { PathGrants } from '../../packages/security/path-grants';
import type { LocalDirectory } from '../../packages/contracts/local-files';
import { scanTree } from './tree';

// Roots originate exclusively in the OS directory picker. The renderer passes
// an opaque root ID and relative paths; junctions cannot widen that grant.
export class LocalFiles {
 private roots=new Map<string,{owner:string;path:string}>();
 constructor(private grants:PathGrants){}
 async choose(owner:string,path:string){
  const info=await lstat(path);
  if(!info.isDirectory()||info.isSymbolicLink())throw new AppError('IPC005','请选择普通目录。');
  if(this.roots.size>=64)throw new AppError('IPC005','已打开过多本地目录，请关闭不用的文件视图。');
  const id=randomUUID();this.roots.set(id,{owner,path:await realpath(path)});
  try{return await this.list(owner,id,'');}catch(e){this.roots.delete(id);throw e;}
 }
 private async path(owner:string,id:string,value:string,allowNew=false){
  const root=this.roots.get(id);
  if(!root||root.owner!==owner)throw new AppError('IPC005','本地目录授权已失效，请重新选择目录。');
  if(isAbsolute(value)||value.includes(':')||/[\x00-\x1f\x7f]/.test(value))throw new AppError('IPC005','本地路径无效。');
  const path=resolve(root.path,value),rel=relative(root.path,path);
  if(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))throw new AppError('IPC005','不能访问所选目录以外的位置。');
  if(await realpath(root.path)!==root.path||(await lstat(root.path)).isSymbolicLink())throw new AppError('IPC005','所选目录已改变。');
  let current=root.path;const parts=rel?rel.split(sep):[];
  for(let i=0;i<parts.length;i++){
   current=join(current,parts[i]);
   try{if((await lstat(current)).isSymbolicLink())throw new AppError('IPC005','不能进入符号链接或目录联接。');}
   catch(e){if(allowNew&&i===parts.length-1&&(e as NodeJS.ErrnoException).code==='ENOENT')break;throw e;}
  }
  return {root,path,rel};
 }
 async list(owner:string,id:string,value:string):Promise<LocalDirectory>{
  const {root,path,rel}=await this.path(owner,id,value);
  const entries:LocalDirectory['entries']=[];let truncated=false;
  const dir=await opendir(path);
  for await(const item of dir){
   if(entries.length>=5000){truncated=true;break;}
   try{const info=await lstat(join(path,item.name));entries.push({name:item.name,path:relative(root.path,join(path,item.name)),kind:info.isSymbolicLink()?'link':info.isDirectory()?'directory':info.isFile()?'file':'other',size:info.size,modified:info.mtimeMs});}
   catch{/* Entries removed during enumeration are omitted. */}
  }
  entries.sort((a,b)=>Number(b.kind==='directory')-Number(a.kind==='directory')||a.name.localeCompare(b.name));
  return {rootId:id,rootPath:root.path,path:rel,entries,truncated};
 }
 async mkdir(owner:string,id:string,parent:string,name:string){
  this.name(name);const p=await this.path(owner,id,parent);await mkdir(join(p.path,name));
 }
 async tree(owner:string,id:string,value:string){
  const base=await this.path(owner,id,value);
  return scanTree(base.path,async relative=>{
   const page=await this.list(owner,id,join(base.rel,relative));
   return {truncated:page.truncated,entries:page.entries.map(e=>({...e,path:e.name}))};
  });
 }
 async hash(owner:string,id:string,value:string){const {path}=await this.path(owner,id,value);const before=await lstat(path);if(!before.isFile())throw new AppError('FILE_CONFLICT','源必须为普通文件。');const hash=await hashFile(createReadStream(path));const after=await lstat(path);if(!after.isFile()||after.isSymbolicLink()||before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw new AppError('FILE_CONFLICT','比较期间文件发生变化。');return {size:after.size,modified:after.mtimeMs,hash};}
 private name(name:string){if(!name||name.length>255||/[<>:"/\\|?*\x00-\x1f\x7f]/.test(name)||/[. ]$/.test(name)||/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name))throw new AppError('IPC005','本地文件名无效。');}
 async grant(owner:string,id:string,value:string,direction:'upload'|'download',name?:string,replace=false){
  if(direction==='download'){this.name(name??'');const parent=await this.path(owner,id,value);value=join(parent.rel,name!);}
  const {path}=await this.path(owner,id,value,direction==='download');
  const grant=await this.grants.create(owner,path,direction,replace);return {pathGrantId:grant.id};
 }
 release(owner:string,id:string){if(this.roots.get(id)?.owner===owner)this.roots.delete(id);}
}
