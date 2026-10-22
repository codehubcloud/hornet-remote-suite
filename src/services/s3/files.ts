import { CopyObjectCommand,DeleteObjectCommand,GetObjectCommand,ListObjectsV2Command,PutObjectCommand,HeadObjectCommand } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import type { FilePage } from '../../packages/contracts';
import { AppError } from '../../packages/core/errors';
import { treeName } from '../file/tree';
import { S3Connections } from './connections';

export function s3Path(path:string){
 if(!path||path.length>4096||/[\x00-\x1f\x7f\\]/.test(path))throw new AppError('IPC002','Invalid AWS S3 object path.');
 const normalized=posix.resolve('/',path);if(normalized.length>4096)throw new AppError('FILE_LIMIT','AWS S3 path is too long.');
 return normalized;
}
export function s3Key(path:string){return s3Path(path).replace(/^\//,'');}
const hash=(data:Buffer|string)=>createHash('sha256').update(data).digest('hex');
async function bodyBuffer(body:unknown,limit:number){
 if(!body||typeof (body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]!=='function')throw new AppError('FILE_CONFLICT','S3 returned an invalid object body.');
 const chunks:Buffer[]=[];let size=0;
 for await(const item of body as AsyncIterable<Uint8Array>){const chunk=Buffer.from(item);size+=chunk.length;if(size>limit)throw new AppError('FILE_LIMIT','Object exceeds the supported preview size.');chunks.push(chunk);}
 return Buffer.concat(chunks);
}
export class S3Files {
 constructor(private connections:S3Connections){}
 async list(owner:string,id:string,path:string):Promise<FilePage>{
  const normalized=s3Path(path),prefix=s3Key(normalized),folderPrefix=prefix?prefix.replace(/\/?$/,'/'):'',entries=new Map<string,FilePage['entries'][number]>();let token:string|undefined;
  do{
   const page=await this.connections.get(owner,id).client.send(new ListObjectsV2Command({Bucket:this.connections.get(owner,id).bucket,Prefix:folderPrefix,Delimiter:'/',ContinuationToken:token,MaxKeys:1000}));
   for(const item of page.CommonPrefixes??[]){const key=item.Prefix;if(!key)continue;const name=key.slice(folderPrefix.length).replace(/\/$/,'');if(!name||name.includes('/'))continue;treeName(name);entries.set(key,{name,path:posix.join(normalized,name),kind:'directory',size:0,modified:0,mode:0});}
   for(const item of page.Contents??[]){const key=item.Key;if(!key||key===folderPrefix)continue;let name=key.slice(folderPrefix.length);if(!name)continue;const directory=name.endsWith('/');if(directory)name=name.slice(0,-1);if(!name||name.includes('/'))continue;treeName(name);entries.set(key,{name,path:posix.join(normalized,name),kind:directory?'directory':'file',size:item.Size??0,modified:item.LastModified?.getTime()??0,mode:0});}
   token=page.IsTruncated?page.NextContinuationToken:undefined;
   if(entries.size>10000)throw new AppError('FILE_LIMIT','S3 directory contains more than 10000 items.');
  }while(token);
  return {path:normalized,entries:[...entries.values()].sort((a,b)=>(a.kind==='directory'?0:1)-(b.kind==='directory'?0:1)||a.name.localeCompare(b.name)),truncated:false};
 }
 async mkdir(owner:string,id:string,path:string){const c=this.connections.get(owner,id),key=s3Key(path);if(!key)throw new AppError('FILE_CONFLICT','Bucket root already exists.');await c.client.send(new PutObjectCommand({Bucket:c.bucket,Key:key.replace(/\/?$/,'/') ,Body:new Uint8Array()}));}
 async rename(owner:string,id:string,path:string,target:string){const c=this.connections.get(owner,id),from=s3Key(path),to=s3Key(target);if(!from||!to||from.endsWith('/')||to.endsWith('/'))throw new AppError('CAPABILITY_UNAVAILABLE','S3 folder rename is not supported; move objects individually.');if(await this.exists(owner,id,to))throw new AppError('FILE_CONFLICT','Target object already exists.');await c.client.send(new CopyObjectCommand({Bucket:c.bucket,Key:to,IfNoneMatch:'*',CopySource:`/${c.bucket}/${from.split('/').map(encodeURIComponent).join('/')}`}));await c.client.send(new DeleteObjectCommand({Bucket:c.bucket,Key:from}));}
 async remove(owner:string,id:string,path:string){const c=this.connections.get(owner,id),key=s3Key(path);if(!key)throw new AppError('FILE_CONFLICT','Bucket root cannot be deleted.');if(await this.exists(owner,id,key)){await c.client.send(new DeleteObjectCommand({Bucket:c.bucket,Key:key}));return;}const folderKey=key.replace(/\/?$/,'/'),children=await c.client.send(new ListObjectsV2Command({Bucket:c.bucket,Prefix:folderKey,MaxKeys:3}));if((children.Contents??[]).length){if((children.Contents??[]).some(item=>item.Key!==folderKey))throw new AppError('FILE_NOT_EMPTY','Only empty S3 folders can be removed.');await c.client.send(new DeleteObjectCommand({Bucket:c.bucket,Key:folderKey}));return;}throw new AppError('FILE_CONFLICT','S3 object no longer exists.');}
 private async textObject(owner:string,id:string,path:string){const c=this.connections.get(owner,id),key=s3Key(path),result=await c.client.send(new GetObjectCommand({Bucket:c.bucket,Key:key}));if((result.ContentLength??0)>131072)throw new AppError('FILE_LIMIT','Editor supports UTF-8 text objects up to 128 KiB.');const data=await bodyBuffer(result.Body,131072);if(data.includes(0))throw new AppError('FILE_BINARY','This S3 object is not a text file.');const content=data.toString('utf8');if(!Buffer.from(content,'utf8').equals(data))throw new AppError('FILE_ENCODING','S3 object is not valid UTF-8 text.');return {content,hash:hash(data),etag:result.ETag};}
 async read(owner:string,id:string,path:string){const {content,hash}=await this.textObject(owner,id,path);return {content,hash};}
 async save(owner:string,id:string,path:string,content:string,expectedHash:string){if(Buffer.byteLength(content)>131072)throw new AppError('FILE_LIMIT','Object content exceeds 128 KiB.');const current=await this.textObject(owner,id,path);if(current.hash!==expectedHash||!current.etag)throw new AppError('FILE_CONFLICT','S3 object changed since it was opened.');const c=this.connections.get(owner,id),data=Buffer.from(content,'utf8');try{await c.client.send(new PutObjectCommand({Bucket:c.bucket,Key:s3Key(path),IfMatch:current.etag,Body:data,ContentLength:data.length,ContentType:'text/plain; charset=utf-8'}));}catch(error){if((error as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode===412)throw new AppError('FILE_CONFLICT','S3 object changed while it was being saved.');throw error;}return {hash:hash(data)};}
 async exists(owner:string,id:string,key:string){const c=this.connections.get(owner,id);try{await c.client.send(new HeadObjectCommand({Bucket:c.bucket,Key:key}));return true;}catch(error){if((error as { $metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode===404)return false;throw error;}}
 chmod(..._args:unknown[]):never{throw new AppError('CAPABILITY_UNAVAILABLE','S3 objects do not have POSIX permissions.');}
 unsupported():never{throw new AppError('CAPABILITY_UNAVAILABLE','S3 does not support POSIX directory synchronization or permissions.');}
 tree(..._args:unknown[]):never{return this.unsupported();}treeHash(..._args:unknown[]):never{return this.unsupported();}treeMkdir(..._args:unknown[]):never{return this.unsupported();}
}
