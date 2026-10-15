import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { Client,ClientChannel } from 'ssh2';
import { AppError } from '../../packages/core/errors';

export type HashProgress=(bytes:number,total:number,method:'stream'|'remote')=>void;
export async function hashTransferStream(stream:Readable,signal:AbortSignal,total:number,progress:HashProgress=()=>{}){
 const hash=createHash('sha256');let bytes=0;
 const abort=()=>stream.destroy(new AppError('IPC006','任务已停止。'));
 let timer:ReturnType<typeof setTimeout>;
 const touch=()=>{clearTimeout(timer);timer=setTimeout(()=>stream.destroy(new AppError('SSH004','文件校验长时间没有收到数据，请检查连接后恢复任务。')),60000);};
 signal.addEventListener('abort',abort,{once:true});
 try{
  if(signal.aborted)throw new AppError('IPC006','任务已停止。');
  touch();progress(0,total,'stream');
  for await(const chunk of stream){if(signal.aborted)throw new AppError('IPC006','任务已停止。');hash.update(chunk);bytes+=chunk.length;touch();progress(bytes,total,'stream');}
  return hash.digest('hex');
 }finally{clearTimeout(timer!);signal.removeEventListener('abort',abort);stream.destroy();}
}

const unavailable=new WeakSet<Client>();
// No pathname is interpreted as shell syntax. stdin redirection also makes
// sha256sum report '-' instead of an escaped/untrusted filename in its output.
export function remoteHashCommand(path:string){
 if(!path||path.includes('\0'))throw new AppError('IPC002','文件路径无效。');
 return "LC_ALL=C sha256sum < '"+path.replace(/'/g,"'\"'\"'")+"'";
}
export async function hashRemoteFile(client:Client,path:string,size:number,signal:AbortSignal,fallback:()=>Readable,progress:HashProgress=()=>{}){
 if(signal.aborted)throw new AppError('IPC006','任务已停止。');
 if(!unavailable.has(client)){
  progress(0,size,'remote');
  const hash=await new Promise<string|undefined>((resolve,reject)=>{
   let channel:ClientChannel|undefined,done=false,output='';
   let timer=setTimeout(()=>finish(),10000);
   const finish=(hash?:string,error?:Error)=>{if(done)return;done=true;clearTimeout(timer);signal.removeEventListener('abort',abort);channel?.destroy();error?reject(error):resolve(hash);};
   const abort=()=>finish(undefined,new AppError('IPC006','任务已停止。'));
   signal.addEventListener('abort',abort,{once:true});
   try{client.exec(remoteHashCommand(path),(error,stream)=>{
    if(done){stream?.on('error',()=>{});stream?.destroy();return;}
    if(error){finish();return;}
    channel=stream;clearTimeout(timer);
    // Disk hashing may take minutes for large files; opening a channel may not.
    timer=setTimeout(()=>finish(),Math.min(1800000,Math.max(30000,Math.ceil(size/(8*1024*1024))*1000)));
    stream.stderr.on('error',()=>finish());stream.stderr.resume();stream.on('error',()=>finish());
    stream.on('data',(data:Buffer)=>{output+=data.toString('utf8');if(output.length>65536)finish();});
    stream.once('close',(code:number|null)=>{const match=output.match(/(?:^|\n)([a-fA-F0-9]{64})[ \t]+-\r?(?:\n|$)/);finish(code===0&&match?match[1].toLowerCase():undefined);});
   });}catch{finish();}
   if(signal.aborted)abort();
  });
  if(hash){progress(size,size,'remote');return hash;}
  unavailable.add(client);
 }
 return hashTransferStream(fallback(),signal,size,progress);
}
