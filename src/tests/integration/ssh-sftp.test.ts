import { describe,it,expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp,writeFile,readFile,rm,mkdir,realpath } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { sshFixture } from '../fixtures/ssh-server';
import { Storage } from '../../packages/storage/database';
import { Challenges } from '../../packages/security/challenges';
import { Connections } from '../../services/ssh/connections';
import { Terminals } from '../../services/terminal/terminals';
import { Files } from '../../services/file/files';
import { TreeTransfers,type TransferContext } from '../../services/file/tree-transfers';
import { LocalFiles } from '../../services/file/local-files';
import { PathGrants } from '../../packages/security/path-grants';
import { Transfers } from '../../services/file/transfers';
import type { HornetEvent } from '../../packages/contracts';
async function waitFor(test:()=>boolean,timeout=12000){const end=Date.now()+timeout;while(!test()){if(Date.now()>end)throw new Error('Timed out waiting for condition');await new Promise(r=>setTimeout(r,15));}}
async function harness(writeDelay=0,directoryTracking=true,options:Parameters<typeof sshFixture>[0]={}){
 const server=await sshFixture({writeDelay,directoryTracking,...options}),root=await realpath(await mkdtemp(join(tmpdir(),'hornet-it-')));
 const db=new Storage(join(root,'test.db'),resolve('packages/storage/schema.sql'));
 const profile=db.saveProfile({profileId:randomUUID(),name:'fixture',host:'127.0.0.1',port:server.port,username:'tester',authType:'password',group:'test',revision:0},0);
 const events:HornetEvent[]=[];
 const emit=(owner:string,e:HornetEvent)=>{events.push(e);if(e.type==='challenge')queueMicrotask(()=>challenges.respond(owner,e.challengeId,e.kind==='trust'?'accept':'test-password',e.kind==='trust'));};
 const challenges=new Challenges(emit),connections=new Connections(db,challenges,emit,undefined,30),terminals=new Terminals(connections,emit),files=new Files(connections),transfers=new Transfers(db,connections,emit);
 return {server,root,db,profile,events,connections,terminals,files,transfers,async close(){await transfers.stop();terminals.stop();await connections.stop();db.close();await server.close();await rm(root,{recursive:true,force:true});}};
}
describe('real loopback SSH / SFTP',()=>{
 it('closes every shell once on remote transport shutdown, including unattached shells, and can reconnect',async()=>{
  const h=await harness();
  try{
   const lease=await h.connections.acquire('a',h.profile.profileId);
   const first=await h.terminals.create('a',lease.connectionId,80,24),background=await h.terminals.create('a',lease.connectionId,80,24);
   h.terminals.attach('a',first.terminalId);h.server.disconnect();
   await waitFor(()=>h.events.filter(e=>e.type==='terminal.closed').length===2);
   for(const id of [first.terminalId,background.terminalId]){
    expect(h.events.filter(e=>e.type==='terminal.closed'&&e.terminalId===id)).toEqual([expect.objectContaining({disconnect:{reason:'remote',at:expect.any(Number)}})]);
    expect(()=>h.terminals.write('a',id,1,1,'must not execute')).toThrow();
   }
   expect(h.events.some(e=>e.type==='connection.state'&&e.connectionId===lease.connectionId&&e.state==='closed')).toBe(true);
   const next=await h.connections.acquire('a',h.profile.profileId);expect(next.connectionId).not.toBe(lease.connectionId);
   const terminal=await h.terminals.create('a',next.connectionId,80,24);h.terminals.attach('a',terminal.terminalId);
   await waitFor(()=>h.events.some(e=>e.type==='terminal.data'&&e.terminalId===terminal.terminalId));
  }finally{await h.close();}
 });
 it('closes paused shells immediately on a ready transport error without waiting for individual channel close events',async()=>{
  const h=await harness();
  try{
   const lease=await h.connections.acquire('a',h.profile.profileId),terminal=await h.terminals.create('a',lease.connectionId,80,24);
   const client=h.connections.get('a',lease.connectionId).client;
   expect(()=>client.emit('error',new Error('Keepalive timeout'))).not.toThrow();
   expect(h.events.filter(e=>e.type==='terminal.closed'&&e.terminalId===terminal.terminalId)).toEqual([
    expect.objectContaining({generation:1,disconnect:{reason:'error',at:expect.any(Number),error:'Keepalive timeout'}})
   ]);
   expect(()=>h.terminals.inspect('a',terminal.terminalId)).toThrow();
   expect(()=>h.connections.get('a',lease.connectionId)).toThrow();
  }finally{await h.close();}
 });
 it('distinguishes a manual shell disconnect while keeping another shell alive',async()=>{
  const h=await harness();try{
   const lease=await h.connections.acquire('a',h.profile.profileId),first=await h.terminals.create('a',lease.connectionId,80,24),second=await h.terminals.create('a',lease.connectionId,80,24);
   h.terminals.close('a',first.terminalId);h.terminals.close('a',first.terminalId);
   expect(h.events.filter(e=>e.type==='terminal.closed'&&e.terminalId===first.terminalId)).toEqual([expect.objectContaining({disconnect:{reason:'user',at:expect.any(Number)}})]);
   expect(h.terminals.inspect('a',second.terminalId)).toEqual({generation:1});
  }finally{await h.close();}
 });
 it('verifies uploads remotely without downloading the uploaded bytes and downloads only once',async()=>{
  const h=await harness(0,true,{remoteHash:'supported'});
  try{
   const lease=await h.connections.acquire('a',h.profile.profileId),source=join(h.root,'large.bin'),data=Buffer.alloc(2*1024*1024,0x71);
   await writeFile(source,data);
   const task=await h.transfers.start('a',lease.connectionId,'upload',source,h.root,"/large 'quoted;$.bin",randomUUID());
   await waitFor(()=>['succeeded','failed','conflict'].includes(h.transfers.list('a').find(t=>t.taskId===task.taskId)!.state));
   expect(h.transfers.list('a').find(t=>t.taskId===task.taskId)?.state).toBe('succeeded');
   expect(h.server.files.get("/large 'quoted;$.bin")).toEqual(data);
   expect([...h.server.readBytes.values()].reduce((a,b)=>a+b,0)).toBe(0);
   expect(h.server.remoteHashes).toHaveLength(1);
   expect(h.events.some(e=>e.type==='task.state'&&e.task.verification?.method==='remote')).toBe(true);
   const download=await h.transfers.start('a',lease.connectionId,'download',join(h.root,'down.bin'),h.root,"/large 'quoted;$.bin",randomUUID());
   await waitFor(()=>['succeeded','failed','conflict'].includes(h.transfers.list('a').find(t=>t.taskId===download.taskId)!.state));
   expect(h.transfers.list('a').find(t=>t.taskId===download.taskId)?.state).toBe('succeeded');
   expect(await readFile(join(h.root,'down.bin'))).toEqual(data);expect(h.server.readBytes.get("/large 'quoted;$.bin")).toBe(data.length);
   const relative=await h.transfers.start('a',lease.connectionId,'upload',source,h.root,'relative.bin',randomUUID());
   await waitFor(()=>['succeeded','failed','conflict'].includes(h.transfers.list('a').find(t=>t.taskId===relative.taskId)!.state));
   expect(h.transfers.list('a').find(t=>t.taskId===relative.taskId)?.state).toBe('succeeded');expect(h.server.files.get('/relative.bin')).toEqual(data);
   expect([...h.server.readBytes.values()].reduce((a,b)=>a+b,0)).toBe(data.length);
  }finally{await h.close();}
 },40000);
 it('refuses a mismatched server checksum and leaves the destination absent',async()=>{
  const h=await harness(0,true,{remoteHash:'corrupt'});
  try{
   const lease=await h.connections.acquire('a',h.profile.profileId),source=join(h.root,'source');await writeFile(source,'unchanged');
   const task=await h.transfers.start('a',lease.connectionId,'upload',source,h.root,'/not-committed',randomUUID());
   await waitFor(()=>h.transfers.list('a').find(t=>t.taskId===task.taskId)?.state==='conflict');expect(h.server.files.has('/not-committed')).toBe(false);
  }finally{await h.close();}
 });
 it('handles a subsystem error without terminating SSH and replaces only the failed SFTP channel',async()=>{
  const h=await harness();
  try{
   const lease=await h.connections.acquire('a',h.profile.profileId),first=await h.connections.sftp('a',lease.connectionId);
   expect(()=>first.emit('error',new Error('fixture subsystem failure'))).not.toThrow();
   const second=await h.connections.sftp('a',lease.connectionId);expect(second).not.toBe(first);
   first.emit('close');expect(await h.connections.sftp('a',lease.connectionId)).toBe(second);
   expect((await h.files.list('a',lease.connectionId,'/')).entries.some(e=>e.name==='hello.txt')).toBe(true);
  }finally{await h.close();}
 });
 it('recursively uploads and downloads folders, preserves empty directories and refuses changed sources',async()=>{
  const h=await harness();
  try{
   const lease=await h.connections.acquire('a',h.profile.profileId),grants=new PathGrants(),local=new LocalFiles(grants);
   const root=join(h.root,'local');await mkdir(join(root,'bundle','nested'),{recursive:true});await mkdir(join(root,'bundle','empty'));
   await writeFile(join(root,'bundle','nested','中文.txt'),'nested payload');
   const chosen=await local.choose('a',root);
   const batch=new TreeTransfers(local,grants,{async call<T>(method:string,raw?:unknown,context?:TransferContext):Promise<T>{
    const p=raw as {connectionId:string;path:string;root:string;direction:'upload'|'download';remotePath:string;idempotencyKey:string};
    if(method==='file.tree')return await h.files.tree('a',p.connectionId,p.path) as T;
    if(method==='file.tree.mkdir')return await h.files.treeMkdir('a',p.connectionId,p.root,p.path) as T;
    if(method==='transfer.start')return await h.transfers.start('a',p.connectionId,p.direction,context!.localPath,context!.localParent,p.remotePath,p.idempotencyKey,context) as T;
    throw new Error('unexpected method');
   }});
   const request={connectionId:lease.connectionId,rootId:chosen.rootId,localPath:'',remotePath:'/',direction:'upload' as const,names:['bundle']};
   const preview=await batch.preview('a',request);expect(preview.files).toBe(1);expect(preview.directories).toBe(3);
   const submitted=await batch.execute('a',preview.planId);expect(submitted.error).toBeUndefined();expect(submitted.taskIds).toHaveLength(1);
   expect(await batch.execute('a',preview.planId)).toEqual(submitted);
   await waitFor(()=>h.transfers.list('a').find(t=>t.taskId===submitted.taskIds[0])?.state==='succeeded');
   expect(h.server.files.get('/bundle/nested/中文.txt')?.toString()).toBe('nested payload');expect(h.server.directories.has('/bundle/empty')).toBe(true);
   const repeat=await batch.preview('a',request);expect(repeat.files).toBe(0);expect(repeat.conflicts).toBe(1);
   await mkdir(join(root,'download'));
   const download=await batch.preview('a',{...request,localPath:'download',direction:'download'});
   const queued=await batch.execute('a',download.planId);expect(queued.error).toBeUndefined();
   await waitFor(()=>h.transfers.list('a').find(t=>t.taskId===queued.taskIds[0])?.state==='succeeded');
   expect(await readFile(join(root,'download','bundle','nested','中文.txt'),'utf8')).toBe('nested payload');
   expect((await local.list('a',chosen.rootId,'download/bundle')).entries.some(e=>e.name==='empty'&&e.kind==='directory')).toBe(true);
   await expect(h.files.treeMkdir('a',lease.connectionId,'/','../escape')).rejects.toThrow();
   const changed=await h.transfers.start('a',lease.connectionId,'upload',join(root,'bundle','nested','中文.txt'),join(root,'bundle','nested'),'/changed.txt',randomUUID(),{localPath:'',localParent:'',remoteParent:'/',expectedSource:{size:999,modified:0}});
   await waitFor(()=>h.transfers.list('a').find(t=>t.taskId===changed.taskId)?.state==='conflict');expect(h.server.files.has('/changed.txt')).toBe(false);
  }finally{await h.close();}
 },40000);

 it('isolates managed X11 transports from shared SSH views and closes only the released isolated lease',async()=>{
  const h=await harness();
  try{
   const shared=await h.connections.acquire('a',h.profile.profileId);
   const first=await h.connections.acquireIsolated('a',h.profile.profileId),second=await h.connections.acquireIsolated('a',h.profile.profileId);
   expect(new Set([shared.connectionId,first.connectionId,second.connectionId]).size).toBe(3);
   const reused=await h.connections.acquire('a',h.profile.profileId);expect(reused.connectionId).toBe(shared.connectionId);
   h.connections.release('a',first.leaseId);expect(()=>h.connections.get('a',first.connectionId)).toThrow();
   expect((await h.files.list('a',shared.connectionId,'/')).entries.some(entry=>entry.name==='hello.txt')).toBe(true);
   expect((await h.files.list('a',second.connectionId,'/')).entries.some(entry=>entry.name==='hello.txt')).toBe(true);
   expect(h.server.authCount).toBe(3);
  }finally{await h.close();}
 });
 it.each([{procReadlink:false},{procProbeDelayMs:2200}])('tracks cwd despite SFTP discovery restrictions or latency: %j',async options=>{
  const h=await harness(0,true,options);
  try{
   const lease=await h.connections.acquire('a',h.profile.profileId);
   const session=await h.terminals.create('a',lease.connectionId,80,24,true);h.terminals.attach('a',session.terminalId);
   await waitFor(()=>h.events.some(e=>e.type==='terminal.data'&&Buffer.from(e.data).toString().includes('fixture ready')));
   expect(await h.terminals.cwd('a',session.terminalId)).toEqual({path:'/'});
   h.terminals.write('a',session.terminalId,session.generation,1,"cd '/tmp/space dir'\r");
   await waitFor(()=>h.server.shellPaths[0]==='/tmp/space dir');
   expect(await h.terminals.cwd('a',session.terminalId)).toEqual({path:'/tmp/space dir'});
   expect(h.server.shellCount).toBe(1);
  }finally{await h.close();}
 });
 it('keeps an interactive shell usable when tracking exec is rejected',async()=>{
  const h=await harness(0,true,{rejectTrackingExec:true});try{
   const lease=await h.connections.acquire('a',h.profile.profileId);
   const session=await h.terminals.create('a',lease.connectionId,80,24,true);h.terminals.attach('a',session.terminalId);
   h.terminals.write('a',session.terminalId,session.generation,1,'hello\r');
   await waitFor(()=>h.events.some(e=>e.type==='terminal.data'&&Buffer.from(e.data).toString().includes('echo:')));
   expect((await h.terminals.cwd('a',session.terminalId)).path).toBeNull();
  }finally{await h.close();}
 });

 it('opens a normal terminal when remote proc discovery is unavailable',async()=>{
  const h=await harness(0,false);try{const lease=await h.connections.acquire('a',h.profile.profileId);
   const session=await h.terminals.create('a',lease.connectionId,80,24,true);h.terminals.attach('a',session.terminalId);
   h.terminals.write('a',session.terminalId,session.generation,1,'hello\r');
   await waitFor(()=>h.events.some(e=>e.type==='terminal.data'&&Buffer.from(e.data).toString().includes('echo:')));
   expect((await h.terminals.cwd('a',session.terminalId)).path).toBeNull();
  }finally{await h.close();}
 });
 it('tracks separate shell directories through SFTP and keeps sibling shells alive',async()=>{
  const h=await harness();try{
   const lease=await h.connections.acquire('a',h.profile.profileId);
   const a=await h.terminals.create('a',lease.connectionId,80,24,true),b=await h.terminals.create('a',lease.connectionId,80,24,true);
   h.terminals.attach('a',a.terminalId);h.terminals.attach('a',b.terminalId);
   await waitFor(()=>h.events.filter(e=>e.type==='terminal.data').length>=2);
   expect(await h.terminals.cwd('a',a.terminalId)).toEqual({path:'/'});
   h.terminals.write('a',a.terminalId,a.generation,1,"cd '/tmp/space dir'\r");
   await waitFor(()=>h.events.some(e=>e.type==='terminal.data'&&e.terminalId===a.terminalId&&Buffer.from(e.data).toString().includes('echo:')));
   expect(await h.terminals.cwd('a',a.terminalId)).toEqual({path:'/tmp/space dir'});
   expect(await h.terminals.cwd('a',b.terminalId)).toEqual({path:'/'});
   await expect(h.terminals.cwd('b',a.terminalId)).rejects.toThrow();
   h.terminals.close('a',a.terminalId);
   await expect(h.terminals.cwd('a',a.terminalId)).rejects.toThrow();
   expect(await h.terminals.cwd('a',b.terminalId)).toEqual({path:'/'});
   expect(h.server.authCount).toBe(1);
  }finally{await h.close();}
 });
 it('changes remote permissions and rejects invalid modes and other owners',async()=>{
  const h=await harness();try{const lease=await h.connections.acquire('a',h.profile.profileId);
   await h.files.chmod('a',lease.connectionId,'/hello.txt',0o600);
   expect((await h.files.list('a',lease.connectionId,'.')).entries.find(e=>e.name==='hello.txt')!.mode&0o777).toBe(0o600);
   await expect(h.files.chmod('a',lease.connectionId,'/hello.txt',0o4777)).rejects.toThrow();
   await expect(h.files.chmod('b',lease.connectionId,'/hello.txt',0o777)).rejects.toThrow();
   await expect(h.files.chmod('a',lease.connectionId,'/missing',0o600)).rejects.toThrow();
  }finally{await h.close();}
 });
 it('resumes an unchanged file after reloading persisted tasks and transfers empty files',async()=>{
  const h=await harness(4);let restored:Transfers|undefined;
  try{
   const lease=await h.connections.acquire('a',h.profile.profileId);
   const source=join(h.root,'resume.bin'),data=Buffer.alloc(2000000,0x71);
   await writeFile(source,data);
   const key=randomUUID(),created=await h.transfers.start('a',lease.connectionId,'upload',source,h.root,'/resumed.bin',key);
   await waitFor(()=>h.transfers.list('a').some(t=>t.taskId===created.taskId&&t.transferredBytes>0));
   const running=h.transfers.list('a').find(t=>t.taskId===created.taskId)!;
   h.transfers.pause('a',running.taskId,running.revision);
   await waitFor(()=>h.transfers.list('a').find(t=>t.taskId===created.taskId)?.state==='paused');
   await h.transfers.stop();
   restored=new Transfers(h.db,h.connections,()=>{});
   const paused=restored.list('a').find(t=>t.taskId===created.taskId)!;
   const same=await restored.start('a',lease.connectionId,'upload',source,h.root,'/resumed.bin',key);
   expect(same.taskId).toBe(created.taskId);
   restored.resume('a',paused.taskId,paused.revision);
   await waitFor(()=>restored!.list('a').find(t=>t.taskId===created.taskId)?.state==='succeeded');
   expect(h.server.files.get('/resumed.bin')).toEqual(data);
   const empty=join(h.root,'empty.txt');await writeFile(empty,'');
   const zero=await restored.start('a',lease.connectionId,'upload',empty,h.root,'/empty.txt',randomUUID());
   await waitFor(()=>restored!.list('a').find(t=>t.taskId===zero.taskId)?.state==='succeeded');
   expect(h.server.files.get('/empty.txt')?.length).toBe(0);
  }finally{await restored?.stop();await h.close();}
 // Multiple real SFTP round trips, restart verification and Windows cleanup can
 // exceed the suite's 20-second limit; each phase still has its own deadline.
 },40000);
 it('shares authentication, keeps SFTP alive after terminal closes, and enforces stream ownership',async()=>{
  const h=await harness();
  try{
   const [a,b]=await Promise.all([h.connections.acquire('a',h.profile.profileId),h.connections.acquire('a',h.profile.profileId)]);
   expect(a.connectionId).toBe(b.connectionId);expect(a.leaseId).not.toBe(b.leaseId);expect(h.server.authCount).toBe(1);
   expect(()=>h.connections.release('b',a.leaseId)).toThrow();
   const terminal=await h.terminals.create('a',a.connectionId,80,24);h.terminals.attach('a',terminal.terminalId);
   h.terminals.write('a',terminal.terminalId,1,1,'hello\r');
   await waitFor(()=>h.events.some(e=>e.type==='terminal.data'&&Buffer.from(e.data).toString().includes('echo:')));
   h.terminals.close('a',terminal.terminalId);h.connections.release('a',a.leaseId);
   expect((await h.files.list('a',b.connectionId,'.')).entries.some(e=>e.name==='hello.txt')).toBe(true);
   expect((await h.files.read('a',b.connectionId,'/hello.txt')).content).toContain('世界');
   h.connections.release('a',b.leaseId);
   await waitFor(()=>!h.connections.hasProfile(h.profile.profileId));
  }finally{await h.close();}
 });
 it('blocks a changed host key before authentication is sent',async()=>{
  const h=await harness();let evil:Awaited<ReturnType<typeof sshFixture>>|undefined;
  try{
   // Store a different host key at the fixture endpoint before connecting.
   evil=await sshFixture();
   const parsed=(await import('ssh2')).utils.parseKey(evil.key);if(Array.isArray(parsed)||parsed instanceof Error)throw new Error('bad key');
   h.db.rememberHost('127.0.0.1',h.server.port,parsed.getPublicSSH());
   await expect(h.connections.acquire('a',h.profile.profileId)).rejects.toThrow('主机密钥');
   expect(h.server.authCount).toBe(0);
  }finally{await evil?.close();await h.close();}
 });
 it('transfers actual bytes, deduplicates creation, refuses overwrite and detects changed source on resume',async()=>{
  const h=await harness(3);
  try{
   const lease=await h.connections.acquire('a',h.profile.profileId);
   const path=join(h.root,'upload.bin'),data=Buffer.alloc(700000,0x5a);await writeFile(path,data);
   const key=randomUUID(),task=await h.transfers.start('a',lease.connectionId,'upload',path,h.root,'/upload.bin',key);
   const repeated=await h.transfers.start('a',lease.connectionId,'upload',path,h.root,'/upload.bin',key);
   expect(repeated.taskId).toBe(task.taskId);
   await waitFor(()=>h.transfers.list('a').find(t=>t.taskId===task.taskId)?.state==='succeeded');
   expect(h.server.files.get('/upload.bin')).toEqual(data);
   const dest=join(h.root,'download.bin'),download=await h.transfers.start('a',lease.connectionId,'download',dest,h.root,'/upload.bin',randomUUID());
   await waitFor(()=>h.transfers.list('a').find(t=>t.taskId===download.taskId)?.state==='succeeded');
   expect(await readFile(dest)).toEqual(data);
   const conflict=await h.transfers.start('a',lease.connectionId,'upload',path,h.root,'/upload.bin',randomUUID());
   await waitFor(()=>h.transfers.list('a').find(t=>t.taskId===conflict.taskId)?.state==='conflict');
   expect(h.server.files.get('/upload.bin')).toEqual(data);
   const big=join(h.root,'big.bin');await writeFile(big,Buffer.alloc(3000000,1));
   const paused=await h.transfers.start('a',lease.connectionId,'upload',big,h.root,'/big.bin',randomUUID());
   await waitFor(()=>h.transfers.list('a').some(t=>t.taskId===paused.taskId&&t.transferredBytes>0));
   let current=h.transfers.list('a').find(t=>t.taskId===paused.taskId)!;h.transfers.pause('a',current.taskId,current.revision);
   await waitFor(()=>h.transfers.list('a').find(t=>t.taskId===paused.taskId)?.state==='paused');
   await writeFile(big,Buffer.alloc(3000000,2));current=h.transfers.list('a').find(t=>t.taskId===paused.taskId)!;h.transfers.resume('a',current.taskId,current.revision);
   await waitFor(()=>h.transfers.list('a').find(t=>t.taskId===paused.taskId)?.state==='conflict');
   expect(h.server.files.has('/big.bin')).toBe(false);
  }finally{await h.close();}
 });
});
