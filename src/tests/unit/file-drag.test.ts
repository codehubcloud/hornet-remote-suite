import { describe,it,expect } from 'vitest';
import { FileDrags } from '../../apps/desktop/main/file-drag';
import { mkdtemp,writeFile,readFile,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { TaskSnapshot } from '../../packages/contracts';
import type { Backend } from '../../apps/desktop/main/backend';
describe('native file drag authorization',()=>{
 it('only exposes completed downloads to the originating window, and cleans up its private cache',async()=>{
  const cache=await mkdtemp(join(tmpdir(),'hornet-drag-unit-')),tasks=new Map<string,TaskSnapshot>();let alive=true;
  const backend={call:async(_method:string,p:{remotePath:string},context:{localPath:string})=>{await writeFile(context.localPath,p.remotePath);const task:TaskSnapshot={taskId:randomUUID(),profileId:randomUUID(),name:'file',direction:'download',state:'succeeded',totalBytes:1,transferredBytes:1,revision:1,updatedAt:Date.now()};tasks.set(task.taskId,task);return task;}} as unknown as Pick<Backend,'call'>;
  const drags=new FileDrags(cache,backend,tasks,()=>alive);
  try{
   expect(()=>drags.paths(1,randomUUID())).toThrow();
   const result=await drags.prepare(1,randomUUID(),[{path:'/source',name:'result.txt'}]);const [path]=drags.paths(1,result.token);expect(await readFile(path,'utf8')).toBe('/source');expect(()=>drags.paths(2,result.token)).toThrow();
   await expect(drags.prepare(1,randomUUID(),[{path:'/source',name:'../escape'}])).rejects.toThrow();
   alive=false;await expect(drags.prepare(1,randomUUID(),[{path:'/source',name:'result2.txt'}])).rejects.toThrow();
   await drags.stop();await expect(readFile(path)).rejects.toThrow();
  }finally{await drags.stop();await rm(cache,{recursive:true,force:true});}
 });
 it('does not issue a native drag token for failed or conflicting downloads',async()=>{
  const cache=await mkdtemp(join(tmpdir(),'hornet-drag-unit-')),tasks=new Map<string,TaskSnapshot>();
  const backend={call:async()=>{const task:TaskSnapshot={taskId:randomUUID(),profileId:randomUUID(),name:'file',direction:'download',state:'conflict',error:'source changed',totalBytes:1,transferredBytes:0,revision:2,updatedAt:Date.now()};tasks.set(task.taskId,task);return task;}} as unknown as Pick<Backend,'call'>;
  const drags=new FileDrags(cache,backend,tasks,()=>true);try{await expect(drags.prepare(1,randomUUID(),[{path:'/source',name:'result.txt'}])).rejects.toThrow('source changed');}finally{await drags.stop();await rm(cache,{recursive:true,force:true});}
 });
});
