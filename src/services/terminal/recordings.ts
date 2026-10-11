import { open } from 'node:fs/promises';
import { basename } from 'node:path';
import { z } from 'zod';
import { recordingLimit,recordingFrameLimit,type TerminalRecording } from '../../packages/contracts/terminal-recording';
import { AppError } from '../../packages/core/errors';
const cols=z.number().int().min(2).max(500),rows=z.number().int().min(1).max(200);
const header=z.object({kind:z.literal('hornet-terminal-recording'),version:z.literal(1),cols,rows}).strict();
const time=z.number().int().min(0).max(7*24*3600*1000);
const frame=z.union([z.tuple([time,z.literal('o'),z.string().max(87384).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)]),z.tuple([time,z.literal('r'),cols,rows])]);
export function parseRecording(text:string,name='recording'):TerminalRecording{
 if(Buffer.byteLength(text)>recordingLimit)throw new Error('录制文件超过 16 MiB。');
 const lines=text.trimEnd().split('\n');if(lines.length>recordingFrameLimit+1)throw new Error('录制事件过多。');
 const meta=header.parse(JSON.parse(lines.shift()??''));let previous=0;
 const frames=lines.map(line=>{const value=frame.parse(JSON.parse(line));if(value[0]<previous)throw new Error('录制时间顺序无效。');previous=value[0];return value;});
 return {name,header:meta,frames,duration:previous};
}
export async function readRecording(path:string){
 const file=await open(path,'r');
 try{
  const info=await file.stat();if(!info.isFile()||info.size>recordingLimit)throw new Error('请选择不超过 16 MiB 的录制文件。');
  const chunks:Buffer[]=[];let size=0;
  while(size<=recordingLimit){const buffer=Buffer.alloc(Math.min(65536,recordingLimit+1-size));const {bytesRead}=await file.read(buffer,0,buffer.length,null);if(!bytesRead)break;chunks.push(buffer.subarray(0,bytesRead));size+=bytesRead;}
  if(size>recordingLimit)throw new Error('录制文件超过 16 MiB。');
  try{return parseRecording(Buffer.concat(chunks).toString('utf8'),basename(path));}catch(e){
   if(e instanceof SyntaxError||e instanceof z.ZodError)throw new AppError('LOG_FORMAT','录制文件格式无效或不完整；请选择 Hornet .hrec 文件。');throw e;
  }
 }finally{await file.close();}
}
