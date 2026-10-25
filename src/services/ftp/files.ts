import type { Client,FileInfo } from 'basic-ftp';
import { posix } from 'node:path';
import { createHash } from 'node:crypto';
import { Writable } from 'node:stream';
import type { FilePage } from '../../packages/contracts';
import { AppError } from '../../packages/core/errors';
import { treeName } from '../file/tree';
import { FtpConnections } from './connections';

export function ftpPath(path:string,absolute=true){
 if(!path||path.length>4096||/[\x00-\x1f\x7f\\]/.test(path)||(absolute&&!posix.isAbsolute(path)))throw new AppError('IPC002','FTP 路径无效。');
 return posix.normalize(path);
}
export async function ftpList(client:Client,path:string):Promise<FileInfo[]>{
 const list=await client.list(ftpPath(path));
 if(list.length>10000)throw new AppError('FILE_LIMIT','FTP 目录超过 10000 项，请选择较小的目录。');
 const seen=new Set<string>();
 for(const entry of list){treeName(entry.name);if(seen.has(entry.name)||!Number.isSafeInteger(entry.size)||entry.size<0)throw new AppError('FILE_CONFLICT','FTP 目录包含重复名称或无效元数据。');seen.add(entry.name);}
 return list;
}
export async function ftpStat(client:Client,path:string){path=ftpPath(path);return (await ftpList(client,posix.dirname(path))).find(e=>e.name===posix.basename(path));}
export async function ftpAbsent(client:Client,path:string){if(await ftpStat(client,path))throw new AppError('FILE_CONFLICT','目标名称已存在，请另存。');}
export async function ftpHash(client:Client,path:string,progress:(bytes:number)=>void=()=>{}){
 const hash=createHash('sha256');let bytes=0;progress(0);await client.downloadTo(new Writable({write(chunk,_encoding,done){hash.update(chunk);bytes+=chunk.length;progress(bytes);done();}}),ftpPath(path));return hash.digest('hex');
}
export class FtpFiles {
 constructor(private connections:FtpConnections){}
 transferInfo(owner:string,id:string,path:string,withHash=false):Promise<import('../../packages/contracts/file-transfer').TransferInfo>{path=ftpPath(path);return this.connections.use(owner,id,async client=>{const info=await ftpStat(client,path);if(!info)return {transport:'ftp',path};const file:import('../../packages/contracts/file-transfer').TransferFile={path,kind:info.isSymbolicLink?'link':info.isFile?'file':info.isDirectory?'directory':'other',size:info.size,modified:info.modifiedAt?.getTime()??0};if(withHash&&file.kind==='file'){await client.send('TYPE I');file.hash=await ftpHash(client,path);const after=await ftpStat(client,path);if(!after?.isFile||after.isSymbolicLink||after.size!==file.size||(after.modifiedAt?.getTime()??0)!==file.modified)throw new AppError('FILE_CONFLICT','目标文件在比较期间发生变化。');}return {transport:'ftp',path,file};});}
 list(owner:string,id:string,path:string):Promise<FilePage>{
  ftpPath(path,false);
  return this.connections.use(owner,id,async client=>{
   await client.cd(path);const current=ftpPath(await client.pwd());
   const entries=await ftpList(client,current);
   return {path:current,truncated:false,entries:entries.map(e=>({name:e.name,path:posix.join(current,e.name),kind:e.isSymbolicLink?'link' as const:e.isDirectory?'directory' as const:e.isFile?'file' as const:'other' as const,size:e.size,modified:e.modifiedAt?.getTime()??0,mode:e.permissions?(e.permissions.user<<6)|(e.permissions.group<<3)|e.permissions.world:0})).sort((a,b)=>(a.kind==='directory'?0:1)-(b.kind==='directory'?0:1)||a.name.localeCompare(b.name))};
  });
 }
 mkdir(owner:string,id:string,path:string){path=ftpPath(path);return this.connections.use(owner,id,async client=>{await ftpAbsent(client,path);await client.send('MKD '+path);});}
 rename(owner:string,id:string,path:string,target:string){path=ftpPath(path);target=ftpPath(target);return this.connections.use(owner,id,async client=>{await ftpAbsent(client,target);await client.rename(path,target);});}
 remove(owner:string,id:string,path:string){path=ftpPath(path);return this.connections.use(owner,id,async client=>{const entry=await ftpStat(client,path);if(!entry)throw new AppError('FILE_CONFLICT','文件已不存在。');if(entry.isDirectory)await client.send('RMD '+path);else await client.remove(path);});}
 // FTP has no portable lstat/realpath or atomic compare-and-replace operation.
 // Do not silently substitute its commands for the SFTP synchronization contract.
 unsupported():never{throw new AppError('CAPABILITY_UNAVAILABLE','FTP / FTPS 暂不支持目录同步、在线编辑和权限修改；可浏览目录并传输普通文件。');}
 tree(..._args:unknown[]):never{return this.unsupported();}
 treeHash(..._args:unknown[]):never{return this.unsupported();}
 treeMkdir(..._args:unknown[]):never{return this.unsupported();}
 read(..._args:unknown[]):never{return this.unsupported();}
 save(..._args:unknown[]):never{return this.unsupported();}
 chmod(..._args:unknown[]):never{return this.unsupported();}
}
