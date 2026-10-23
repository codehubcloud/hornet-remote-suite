import { createReadStream } from 'node:fs';
import { hashFile } from './hash-file';
import { randomUUID } from 'node:crypto';
import { lstat,realpath,opendir,mkdir,rename,unlink,rmdir,copyFile } from 'node:fs/promises';
import { constants } from 'node:fs';
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
  async rename(owner:string,id:string,value:string,name:string){
    this.name(name);const source=await this.path(owner,id,value);if(!source.rel)throw new AppError('IPC005','不能重命名授权根目录。');
    const destination=join(source.root.path,source.rel.split(sep).slice(0,-1).join(sep),name);
    try{await lstat(destination);throw new AppError('FILE_CONFLICT','目标名称已存在。');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    await rename(source.path,destination);
  }
  async remove(owner:string,id:string,value:string){
    const source=await this.path(owner,id,value);if(!source.rel)throw new AppError('IPC005','不能删除授权根目录。');
    const info=await lstat(source.path);if(info.isDirectory())await rmdir(source.path);else if(info.isFile())await unlink(source.path);else throw new AppError('IPC005','仅支持普通文件或空目录。');
  }
  async copy(owner:string,sourceId:string,value:string,targetId:string,parent:string){
    const source=await this.path(owner,sourceId,value),target=await this.path(owner,targetId,parent),name=source.rel.split(sep).at(-1);if(!name)throw new AppError('IPC005','不能复制授权根目录。');
    this.name(name);const destination=join(target.path,name),nested=relative(source.path,destination);
    if(!nested||(!nested.startsWith('..'+sep)&&nested!=='..'&&!isAbsolute(nested)))throw new AppError('FILE_CONFLICT','不能复制到源目录内部。');
    const created:{path:string;directory:boolean}[]=[];let count=0,bytes=0;
    const visit=async(from:string,to:string,depth:number):Promise<void>=>{
      if(++count>10000||depth>32)throw new AppError('FILE_LIMIT','复制目录超过条目或深度上限。');
      const checked=await this.path(owner,sourceId,from),info=await lstat(checked.path);
      await this.path(owner,targetId,to,true);
      if(info.isDirectory()){
        await mkdir(join(target.root.path,to));created.push({path:join(target.root.path,to),directory:true});
        const dir=await opendir(checked.path);for await(const entry of dir){this.name(entry.name);await visit(join(from,entry.name),join(to,entry.name),depth+1);}
      }else if(info.isFile()){
        bytes+=info.size;if(bytes>5*1024**3)throw new AppError('FILE_LIMIT','单次复制超过 5 GiB。');
        const path=join(target.root.path,to);await copyFile(checked.path,path,constants.COPYFILE_EXCL);created.push({path,directory:false});
        const after=await lstat(checked.path);if(after.isSymbolicLink()||after.size!==info.size||after.mtimeMs!==info.mtimeMs)throw new AppError('FILE_CONFLICT','复制期间源文件改变。');
      }else throw new AppError('IPC005','复制目录不能包含链接或特殊文件。');
    };
    try{await visit(source.rel,join(target.rel,name),0);}catch(error){
      for(const entry of created.reverse())try{await this.path(owner,targetId,relative(target.root.path,entry.path));if(entry.directory)await rmdir(entry.path);else await unlink(entry.path);}catch{/* Preserve anything that changed since creation. */}
      throw error;
    }
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
