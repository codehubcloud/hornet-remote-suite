import { it,expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp,mkdir,writeFile,readFile,rm,stat,utimes } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { sshFixture } from '../fixtures/ssh-server';
import { Storage } from '../../packages/storage/database';
import { Challenges } from '../../packages/security/challenges';
import { PathGrants } from '../../packages/security/path-grants';
import { Connections } from '../../services/ssh/connections';
import { Files } from '../../services/file/files';
import { LocalFiles } from '../../services/file/local-files';
import { Transfers } from '../../services/file/transfers';
import { TreeTransfers,type TransferContext } from '../../services/file/tree-transfers';
import type { TreeRequest } from '../../packages/contracts/file-tree';
async function fixture(atomicRename=true,writeDelay=0){
 const server=await sshFixture({atomicRename,writeDelay}),root=await mkdtemp(join(tmpdir(),'hornet-sync-')),dir=join(root,'files');await mkdir(dir);server.directories.add('/sync');
 const db=new Storage(':memory:',resolve('packages/storage/schema.sql')),p=db.saveProfile({profileId:randomUUID(),name:'sync',host:'127.0.0.1',port:server.port,username:'tester',group:'',authType:'password',revision:0},0);
 const challenges=new Challenges((owner,e)=>{if(e.type==='challenge')queueMicrotask(()=>challenges.respond(owner,e.challengeId,e.kind==='trust'?'accept':'test-password',e.kind==='trust'));});
 const connections=new Connections(db,challenges,()=>{}),files=new Files(connections),transfers=new Transfers(db,connections,()=>{}),grants=new PathGrants(),local=new LocalFiles(grants);
 const connection=await connections.acquire('a',p.profileId),selected=await local.choose('a',dir);
 const batch=new TreeTransfers(local,grants,{async call<T>(method:string,raw?:unknown,context?:TransferContext){const p=raw as any;
  if(method==='file.tree')return await files.tree('a',p.connectionId,p.path) as T;
  if(method==='file.tree.hash')return await files.treeHash('a',p.connectionId,p.root,p.path) as T;
  if(method==='file.tree.mkdir')return await files.treeMkdir('a',p.connectionId,p.root,p.path) as T;
  if(method==='transfer.start')return await transfers.start('a',p.connectionId,p.direction,context!.localPath,context!.localParent,p.remotePath,p.idempotencyKey,context) as T;
  throw new Error(method);
 }});
 const request:TreeRequest={connectionId:connection.connectionId,rootId:selected.rootId,localPath:'',remotePath:'/sync',direction:'bidirectional',policy:'newer'};
 return {server,dir,local,batch,request,transfers,async localFile(name:string,text:string,time=1700000020){await writeFile(join(dir,name),text);await utimes(join(dir,name),time,time);},remoteFile(name:string,text:string,time=1700000000){server.files.set('/sync/'+name,Buffer.from(text));server.mtimes.set('/sync/'+name,time);},async done(ids:string[]){await expect.poll(()=>ids.every(id=>['succeeded','failed','conflict','cancelled'].includes(transfers.list('a').find(t=>t.taskId===id)!.state)),{timeout:20000}).toBe(true);return transfers.list('a').filter(t=>ids.includes(t.taskId));},async close(){await transfers.stop();await connections.stop();db.close();await server.close();await rm(root,{recursive:true,force:true});}};
}
it('syncs both ways with negotiated atomic upload, local replacement and preserved modification times',async()=>{
 const f=await fixture();try{
  await f.localFile('up','local');f.remoteFile('up','older');await f.localFile('down','older',1700000000);f.remoteFile('down','remote',1700000030);
  await f.localFile('left','only local');f.remoteFile('right','only remote');await f.localFile('same','equal');f.remoteFile('same','equal');
  await mkdir(join(f.dir,'empty'));f.server.directories.add('/sync/remote-empty');
  const preview=await f.batch.preview('a',f.request);expect(preview.files).toBe(4);expect(preview.conflicts).toBe(0);expect(preview.directories).toBe(2);
  const result=await f.batch.execute('a',preview.planId);expect(result.error).toBeUndefined();expect((await f.done(result.taskIds)).every(t=>t.state==='succeeded')).toBe(true);
  expect(f.server.files.get('/sync/up')?.toString()).toBe('local');expect(await readFile(join(f.dir,'down'),'utf8')).toBe('remote');expect(f.server.files.get('/sync/left')?.toString()).toBe('only local');expect(await readFile(join(f.dir,'right'),'utf8')).toBe('only remote');
  expect(f.server.mtimes.get('/sync/up')).toBe(1700000020);expect((await stat(join(f.dir,'down'))).mtimeMs).toBe(1700000030000);
  const repeat=await f.batch.preview('a',f.request);expect(repeat.files).toBe(0);expect(repeat.conflicts).toBe(0);
 }finally{await f.close();}
},30000);
it('detects same-size same-time changes after preview and refuses unsupported remote replacement',async()=>{
 const f=await fixture(false);try{
  await f.localFile('a','new!');f.remoteFile('a','old!');
  const preview=await f.batch.preview('a',f.request);f.remoteFile('a','race'); // same metadata, different hash
  let result=await f.batch.execute('a',preview.planId),tasks=await f.done(result.taskIds);expect(tasks[0].state).toBe('conflict');expect(f.server.files.get('/sync/a')?.toString()).toBe('race');
  const again=await f.batch.preview('a',f.request);result=await f.batch.execute('a',again.planId);tasks=await f.done(result.taskIds);expect(tasks[0].state).toBe('failed');expect(tasks[0].error).toContain('不支持原子覆盖');expect(f.server.files.get('/sync/a')?.toString()).toBe('race');
 }finally{await f.close();}
},30000);
it('keeps both copies without overwriting either original',async()=>{
 const f=await fixture();try{await f.localFile('a.txt','LOCAL');f.remoteFile('a.txt','REMOTE');const preview=await f.batch.preview('a',{...f.request,policy:'keep-both'});const result=await f.batch.execute('a',preview.planId);expect(result.error).toBeUndefined();expect((await f.done(result.taskIds)).every(t=>t.state==='succeeded')).toBe(true);expect(await readFile(join(f.dir,'a.txt'),'utf8')).toBe('LOCAL');expect(f.server.files.get('/sync/a.txt')?.toString()).toBe('REMOTE');expect(await readFile(join(f.dir,'a (remote).txt'),'utf8')).toBe('REMOTE');expect(f.server.files.get('/sync/a (local).txt')?.toString()).toBe('LOCAL');}finally{await f.close();}
});
it('cancels a replacement before commit without modifying the original target',async()=>{
 const f=await fixture(true,25);try{await f.localFile('large','N'.repeat(4*1024*1024));f.remoteFile('large','original');const preview=await f.batch.preview('a',f.request),result=await f.batch.execute('a',preview.planId),id=result.taskIds[0];await expect.poll(()=>f.transfers.list('a').find(t=>t.taskId===id)?.state).toBe('running');const current=f.transfers.list('a').find(t=>t.taskId===id)!;f.transfers.cancel('a',id,current.revision);expect((await f.done([id]))[0].state).toBe('cancelled');expect(f.server.files.get('/sync/large')?.toString()).toBe('original');}finally{await f.close();}
},30000);
it('detects an external target edit during the upload before atomic replacement',async()=>{
 const f=await fixture(true,15);try{
  await f.localFile('changing','N'.repeat(1024*1024));f.remoteFile('changing','ORIGINAL');
  const preview=await f.batch.preview('a',f.request),result=await f.batch.execute('a',preview.planId),id=result.taskIds[0];
  await expect.poll(()=>f.transfers.list('a').find(t=>t.taskId===id)?.transferredBytes??0).toBeGreaterThan(0);
  f.remoteFile('changing','CHANGED!');
  const tasks=await f.done([id]);expect(tasks[0].state).toBe('conflict');expect(tasks[0].error).toContain('内容发生变化');expect(f.server.files.get('/sync/changing')?.toString()).toBe('CHANGED!');
 }finally{await f.close();}
},30000);
