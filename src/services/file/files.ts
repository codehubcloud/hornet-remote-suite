import { createHash,randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import { Connections } from '../ssh/connections';
import { AppError } from '../../packages/core/errors';
import type { FilePage } from '../../packages/contracts';
import type { SFTPWrapper,Stats } from 'ssh2';
export function stat(sftp:SFTPWrapper,path:string):Promise<Stats>{return new Promise((resolve,reject)=>sftp.lstat(path,(e,s)=>e?reject(e):resolve(s)));}
export function realpath(sftp:SFTPWrapper,path:string):Promise<string>{return new Promise((resolve,reject)=>sftp.realpath(path,(e,p)=>e?reject(e):resolve(p)));}
export function unlink(sftp:SFTPWrapper,path:string):Promise<void>{return new Promise((resolve,reject)=>sftp.unlink(path,e=>e?reject(e):resolve()));}
export function rename(sftp:SFTPWrapper,from:string,to:string):Promise<void>{return new Promise((resolve,reject)=>sftp.rename(from,to,e=>e?reject(e):resolve()));}
export function hashBuffer(data:Buffer|string){return createHash('sha256').update(data).digest('hex');}
export class Files {
  constructor(private connections:Connections) {}
  async list(owner:string,id:string,path:string):Promise<FilePage> {
    const sftp=await this.connections.sftp(owner,id), normalized=await realpath(sftp,path);
    const handle=await new Promise<Buffer>((resolve,reject)=>sftp.opendir(normalized,(e,h)=>e?reject(e):resolve(h)));
    const list:import('ssh2').FileEntryWithStats[]=[];
    try {
      while(list.length<=10000){
        const batch=await new Promise<import('ssh2').FileEntryWithStats[]|false>((resolve,reject)=>sftp.readdir(handle,(e,items)=>e?((e as Error & {code?:number}).code===1?resolve(false):reject(e)):resolve(items)));
        if(!batch||!batch.length)break;
        list.push(...batch.filter(e=>e.filename!=='.'&&e.filename!=='..'));
      }
    } finally { await new Promise<void>(resolve=>sftp.close(handle,()=>resolve())); }
    return {path:normalized,truncated:list.length>10000,entries:list.slice(0,10000).map(e=>({name:e.filename,path:posix.join(normalized,e.filename),kind:e.attrs.isDirectory()?'directory' as const:e.attrs.isSymbolicLink()?'link' as const:'file' as const,size:e.attrs.size,modified:e.attrs.mtime*1000,mode:e.attrs.mode})).sort((a,b)=>(a.kind==='directory'?0:1)-(b.kind==='directory'?0:1)||a.name.localeCompare(b.name))};
  }
  async mkdir(owner:string,id:string,path:string){
    const sftp=await this.connections.sftp(owner,id);
    await new Promise<void>((resolve,reject)=>sftp.mkdir(path,{mode:0o755},e=>e?reject(e):resolve()));
  }
  async rename(owner:string,id:string,path:string,target:string){
    const sftp=await this.connections.sftp(owner,id);
    try{await stat(sftp,target);throw new AppError('FILE_CONFLICT','目标名称已存在。');}
    catch(e){if((e as {code?:unknown}).code!==2)throw e;}
    await rename(sftp,path,target);
  }
  async chmod(owner:string,id:string,path:string,mode:number){
    if(!Number.isInteger(mode)||mode<0||mode>0o777)throw new AppError('FILE_LIMIT','权限必须是 000–777。');
    const sftp=await this.connections.sftp(owner,id),metadata=await stat(sftp,path);
    if(metadata.isSymbolicLink()||(!metadata.isFile()&&!metadata.isDirectory()))throw new AppError('FILE_LIMIT','仅支持普通文件或目录的权限修改。');
    await new Promise<void>((resolve,reject)=>sftp.chmod(path,mode,e=>e?reject(e):resolve()));
  }
  async remove(owner:string,id:string,path:string){
    const sftp=await this.connections.sftp(owner,id),metadata=await stat(sftp,path);
    if(metadata.isDirectory())await new Promise<void>((resolve,reject)=>sftp.rmdir(path,e=>e?reject(new AppError('FILE_NOT_EMPTY','目录不是空目录或无权删除。')):resolve()));
    else await unlink(sftp,path);
  }
  async read(owner:string,id:string,path:string) {
    const sftp=await this.connections.sftp(owner,id),st=await stat(sftp,path);
    if(!st.isFile()||st.size>131072)throw new AppError('FILE_LIMIT','编辑器仅支持不超过128KiB的普通UTF-8文本文件。');
    const chunks:Buffer[]=[];let bytes=0;
    const stream=sftp.createReadStream(path);
    try {for await(const chunk of stream){bytes+=chunk.length;if(bytes>131072)throw new AppError('FILE_LIMIT','文件已超出编辑上限。');chunks.push(Buffer.from(chunk));}}
    finally{stream.destroy();}
    const data=Buffer.concat(chunks);
    if(data.includes(0))throw new AppError('FILE_BINARY','此文件不是文本文件。');
    const content=data.toString('utf8');
    if(!Buffer.from(content,'utf8').equals(data))throw new AppError('FILE_ENCODING','文件不是有效UTF-8，无法安全编辑。');
    return {content,hash:hashBuffer(data)};
  }
  async save(owner:string,id:string,path:string,content:string,expectedHash:string){
    if(Buffer.byteLength(content)>131072)throw new AppError('FILE_LIMIT','文件内容超过128KiB。');
    const sftp=await this.connections.sftp(owner,id);
    const original=await this.read(owner,id,path);
    if(original.hash!==expectedHash)throw new AppError('FILE_CONFLICT','远端文件已改变，请重新打开后比较。');
    const metadata=await stat(sftp,path),temp=posix.join(posix.dirname(path),'.hornet-edit-'+randomUUID());
    try{
      await new Promise<void>((resolve,reject)=>sftp.writeFile(temp,content,{flag:'wx',mode:metadata.mode&0o777},e=>e?reject(e):resolve()));
      if((await this.read(owner,id,path)).hash!==expectedHash)throw new AppError('FILE_CONFLICT','保存期间远端文件发生变化。');
      await new Promise<void>((resolve,reject)=>sftp.ext_openssh_rename(temp,path,e=>e?reject(new AppError('CAPABILITY_UNAVAILABLE','服务端不支持已验证的原子覆盖，原文件保持不变。')):resolve()));
      return {hash:hashBuffer(content)};
    }finally{await unlink(sftp,temp).catch(()=>{});}
  }
}
