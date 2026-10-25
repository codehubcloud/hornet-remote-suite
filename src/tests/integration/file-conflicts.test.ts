import { describe,it,expect } from 'vitest';
import { mkdtemp,writeFile,readFile,rm,lstat,mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { sshFixture } from '../fixtures/ssh-server';
import { Storage } from '../../packages/storage/database';
import { Connections } from '../../services/ssh/connections';
import { Challenges } from '../../packages/security/challenges';
import { Files } from '../../services/file/files';
import { Transfers } from '../../services/file/transfers';
import { FileTransfers } from '../../apps/desktop/main/file-transfers';
import { PathGrants } from '../../packages/security/path-grants';
import type { TransferContext } from '../../services/file/tree-transfers';
import type { TaskSnapshot } from '../../packages/contracts';
import type { TransferPreparation } from '../../packages/contracts/file-transfer';
async function harness(){
 const server=await sshFixture({atomicRename:true}),root=await mkdtemp(join(tmpdir(),'hornet-conflicts-')),store=new Storage(':memory:',resolve('packages/storage/schema.sql'));
 const profile=store.saveProfile({profileId:randomUUID(),name:'conflicts',host:'127.0.0.1',port:server.port,username:'tester',authType:'password',group:'',revision:0},0);
 const challenges=new Challenges((owner,event)=>{if(event.type==='challenge')queueMicrotask(()=>challenges.respond(owner,event.challengeId,event.kind==='trust'?'accept':'test-password',event.kind==='trust'));});
 const connections=new Connections(store,challenges,()=>{}),files=new Files(connections),transfers=new Transfers(store,connections,()=>{}),grants=new PathGrants();
 const backend={async call<T>(method:string,p:any,context?:TransferContext):Promise<T>{if(method==='file.transferInfo')return files.transferInfo('local-user',p.connectionId,p.path,p.withHash) as T;if(method==='transfer.start')return transfers.start('local-user',p.connectionId,p.direction,context!.localPath,context!.localParent,p.remotePath,p.idempotencyKey,context) as T;throw Error(method);}};
 const planner=new FileTransfers(grants,backend),lease=await connections.acquire('local-user',profile.profileId);
 async function done(result:TransferPreparation){expect(result.kind).toBe('started');if(result.kind!=='started')throw Error('not started');const id=result.task.taskId;const until=Date.now()+10000;while(Date.now()<until){const task=transfers.list('local-user').find(task=>task.taskId===id)!;if(['succeeded','failed','conflict'].includes(task.state))return task;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('transfer timeout');}
 return {server,root,grants,planner,lease,transfers,done,async close(){await transfers.stop();await connections.stop();store.close();await server.close();await rm(root,{recursive:true,force:true});}};
}
describe('reviewed single-file conflicts over real SFTP',()=>{
 it('validates custom upload names and transfers under the new name without renaming the source or replacing either existing target',async()=>{
  const h=await harness();try{
   const source=join(h.root,'source.txt');await writeFile(source,'CUSTOM CONTENT');h.server.files.set('/target.txt',Buffer.from('OLD TARGET'));h.server.files.set('/occupied.txt',Buffer.from('KEEP OCCUPIED'));
   const grant=await h.grants.create('local-user',source,'upload'),prepared=await h.planner.prepare(1,{connectionId:h.lease.connectionId,direction:'upload',pathGrantId:grant.id,remotePath:'/target.txt'});if(prepared.kind!=='conflict')throw Error('missing conflict');const id=prepared.conflict.id;
   await expect(h.planner.checkName(2,id,'custom.txt')).rejects.toThrow();await expect(h.planner.checkName(1,id,'../escape.txt')).rejects.toThrow();await expect(h.planner.checkName(1,id,'occupied.txt')).rejects.toThrow('该名称已存在');expect(h.transfers.list('local-user')).toHaveLength(0);
   await h.planner.checkName(1,id,'custom.txt');expect((await h.done(await h.planner.resolve(1,id,'rename','custom.txt'))).state).toBe('succeeded');expect(h.server.files.get('/custom.txt')!.toString()).toBe('CUSTOM CONTENT');expect(h.server.files.get('/target.txt')!.toString()).toBe('OLD TARGET');expect(h.server.files.get('/occupied.txt')!.toString()).toBe('KEEP OCCUPIED');expect(await readFile(source,'utf8')).toBe('CUSTOM CONTENT');
  }finally{await h.close();}
 });
 it('supports custom download names and rechecks a name that becomes occupied after validation',async()=>{
  const h=await harness();try{
   const target=join(h.root,'hello.txt');await writeFile(target,'ORIGINAL');const grant=await h.grants.create('local-user',target,'download','prompt');const request={connectionId:h.lease.connectionId,direction:'download' as const,pathGrantId:grant.id,remotePath:'/hello.txt'};
   let p=await h.planner.prepare(1,request);if(p.kind!=='conflict')throw Error('missing conflict');await h.planner.checkName(1,p.conflict.id,'renamed.txt');expect((await h.done(await h.planner.resolve(1,p.conflict.id,'rename','renamed.txt'))).state).toBe('succeeded');expect(await readFile(join(h.root,'renamed.txt'),'utf8')).toBe('hello 世界\n');expect(await readFile(target,'utf8')).toBe('ORIGINAL');
   p=await h.planner.prepare(1,request);if(p.kind!=='conflict')throw Error('missing conflict');await h.planner.checkName(1,p.conflict.id,'race.txt');await writeFile(join(h.root,'race.txt'),'CREATED AFTER CHECK');await expect(h.planner.resolve(1,p.conflict.id,'rename','race.txt')).rejects.toThrow('该名称已存在');expect(await readFile(join(h.root,'race.txt'),'utf8')).toBe('CREATED AFTER CHECK');expect(await readFile(target,'utf8')).toBe('ORIGINAL');
  }finally{await h.close();}
 });
 it('asks before overwriting, checks window ownership, and submits only one verified replacement',async()=>{
  const h=await harness();try{const source=join(h.root,'source.txt');await writeFile(source,'NEW CONTENT');h.server.files.set('/target.txt',Buffer.from('OLD CONTENT'));
   const grant=await h.grants.create('local-user',source,'upload'),prepared=await h.planner.prepare(1,{connectionId:h.lease.connectionId,direction:'upload',pathGrantId:grant.id,remotePath:'/target.txt'});
   expect(prepared.kind).toBe('conflict');expect(h.transfers.list('local-user')).toEqual([]);expect(h.server.files.get('/target.txt')!.toString()).toBe('OLD CONTENT');if(prepared.kind!=='conflict')throw Error('missing conflict');
   await expect(h.planner.resolve(2,prepared.conflict.id,'replace')).rejects.toThrow();
   const result=await h.planner.resolve(1,prepared.conflict.id,'replace');expect((await h.done(result)).state).toBe('succeeded');expect(h.server.files.get('/target.txt')!.toString()).toBe('NEW CONTENT');expect(await h.planner.resolve(1,prepared.conflict.id,'replace')).toEqual(result);expect(h.transfers.list('local-user')).toHaveLength(1);
  }finally{await h.close();}
 });
 it('offers skip, keep both and local replacement without removing the original before verification',async()=>{
  const h=await harness();try{const target=join(h.root,'hello.txt');await writeFile(target,'KEEP ORIGINAL');const grant=await h.grants.create('local-user',target,'download','prompt');
   const prepare=()=>h.planner.prepare(1,{connectionId:h.lease.connectionId,direction:'download',pathGrantId:grant.id,remotePath:'/hello.txt'});
   let p=await prepare();if(p.kind!=='conflict')throw Error('missing conflict');expect(await h.planner.resolve(1,p.conflict.id,'skip')).toEqual({kind:'skipped'});expect(await readFile(target,'utf8')).toBe('KEEP ORIGINAL');
   p=await prepare();if(p.kind!=='conflict')throw Error('missing conflict');expect((await h.done(await h.planner.resolve(1,p.conflict.id,'keep-both'))).state).toBe('succeeded');expect(await readFile(join(h.root,'hello (1).txt'),'utf8')).toBe('hello 世界\n');expect(await readFile(target,'utf8')).toBe('KEEP ORIGINAL');
   p=await prepare();if(p.kind!=='conflict')throw Error('missing conflict');expect((await h.done(await h.planner.resolve(1,p.conflict.id,'replace'))).state).toBe('succeeded');expect(await readFile(target,'utf8')).toBe('hello 世界\n');
  }finally{await h.close();}
 });
 it('refuses a changed target and skips newer destinations; a directory collision can keep both',async()=>{
  const h=await harness();try{const target=join(h.root,'hello.txt');await writeFile(target,'ORIGINAL');const grant=await h.grants.create('local-user',target,'download','prompt');const req={connectionId:h.lease.connectionId,direction:'download' as const,pathGrantId:grant.id,remotePath:'/hello.txt'};
   let p=await h.planner.prepare(1,req);if(p.kind!=='conflict')throw Error('missing conflict');await writeFile(target,'CHANGED CONTENT');await expect(h.planner.resolve(1,p.conflict.id,'replace')).rejects.toThrow('目标文件已变化');expect(await readFile(target,'utf8')).toBe('CHANGED CONTENT');
   p=await h.planner.prepare(1,req);if(p.kind!=='conflict')throw Error('missing conflict');if(p.conflict.source.modified<=p.conflict.target.modified)expect(await h.planner.resolve(1,p.conflict.id,'newer')).toEqual({kind:'skipped'});
   const directory=join(h.root,'collision.txt');await mkdir(directory);const dirGrant=await h.grants.create('local-user',directory,'download','prompt');p=await h.planner.prepare(1,{...req,pathGrantId:dirGrant.id});if(p.kind!=='conflict')throw Error('missing conflict');expect(p.conflict.canReplace).toBe(false);expect((await h.done(await h.planner.resolve(1,p.conflict.id,'keep-both'))).state).toBe('succeeded');expect((await lstat(directory)).isDirectory()).toBe(true);expect(await readFile(join(h.root,'collision (1).txt'),'utf8')).toBe('hello 世界\n');
  }finally{await h.close();}
 });
});
