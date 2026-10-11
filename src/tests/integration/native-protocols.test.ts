import { it, expect } from 'vitest';
import { createServer, createConnection, type Socket } from 'node:net';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { once } from 'node:events';
import { LpdService } from '../../services/print/lpd';
import { VncService } from '../../services/desktop/vnc';
import { Storage } from '../../packages/storage/database';
import { Connections } from '../../services/ssh/connections';
import { Challenges } from '../../packages/security/challenges';
import { sshFixture } from '../fixtures/ssh-server';
import type { HornetEvent } from '../../packages/contracts';

class Client {
 socket:Socket; private iterator:AsyncIterator<Buffer>;private buffer=Buffer.alloc(0);
 constructor(port:number){this.socket=createConnection({host:'127.0.0.1',port});this.socket.setTimeout(3000,()=>this.socket.destroy(new Error('Test timeout')));this.iterator=this.socket[Symbol.asyncIterator]();}
 async ack(){while(!this.buffer.length){const part=await this.iterator.next();if(part.done)throw new Error('Unexpected EOF');this.buffer=Buffer.concat([this.buffer,part.value]);}const value=this.buffer[0];this.buffer=this.buffer.subarray(1);return value;}
 send(value:Buffer|string){this.socket.write(value);}
 close(){this.socket.destroy();}
}
const config={bindHost:'127.0.0.1',port:0,queue:'hornet',printer:'fixture',mode:'text' as const,allowedSources:['127.0.0.1']};
async function sendJob(port:number,dataFirst:boolean,queue='hornet'){
 const client=new Client(port),body=Buffer.from('hello 世界\n'),control=Buffer.from('Hfixture\nPuser\nJexample\nfdfA001host\nUdfA001host\n');
 try{client.send(Buffer.from([2]));client.send(queue+'\n');expect(await client.ack()).toBe(0);
  const parts=[{code:2,name:'cfA001host',body:control},{code:3,name:'dfA001host',body}];if(dataFirst)parts.reverse();
  for(const part of parts){client.send(Buffer.concat([Buffer.from([part.code]),Buffer.from(`${part.body.length} ${part.name}\n`)]));expect(await client.ack()).toBe(0);for(const byte of part.body)client.send(Buffer.from([byte]));client.send(Buffer.from([0]));expect(await client.ack()).toBe(0);}
 }finally{client.close();}return body;
}
for(const dataFirst of [true,false])it(`LPD accepts fragmented files (${dataFirst?'data':'control'} first), persists before submit, never auto prints`,async()=>{
 const root=await mkdtemp(join(tmpdir(),'hornet-lpd-'));let submitted=0;
 const lpd=new LpdService(root,async(job,path)=>{submitted++;expect((await readFile(path)).length).toBe(job.bytes);return 42;});
 try{const status=await lpd.start(config);const body=await sendJob(status.config!.port,dataFirst);const job=lpd.status().jobs[0];expect(job.state).toBe('held');expect(submitted).toBe(0);expect(await readFile(join(root,job.jobId+'.spool'))).toEqual(body);
  const first=lpd.print(job.jobId);await expect(lpd.print(job.jobId)).rejects.toThrow();expect((await first).state).toBe('submitted');expect(submitted).toBe(1);await expect(lpd.print(job.jobId)).rejects.toThrow();
  await lpd.stop();const restored=new LpdService(root,async()=>undefined);expect(restored.status().jobs[0].osJobId).toBe(42);await restored.shutdown();
 }finally{await lpd.shutdown();await rm(root,{recursive:true,force:true});}
});
it('LPD rejects paths, excessive lengths and remote deletion; interrupted data never enters queue',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hornet-lpd-')),lpd=new LpdService(root,async()=>undefined);
 try{const status=await lpd.start(config),port=status.config!.port;
  for(const command of ['\x031 ../escape\n','\x0310485761 dfA001host\n']){const c=new Client(port);try{c.send('\x02hornet\n');expect(await c.ack()).toBe(0);c.send(command);expect(await c.ack()).toBe(1);}finally{c.close();}}
  const c=new Client(port);try{c.send('\x05hornet root\n');expect(await c.ack()).toBe(1);}finally{c.close();}
  expect(lpd.status().jobs).toEqual([]);
  await sendJob(port,true);const job=lpd.status().jobs[0];lpd.cancel(job.jobId);expect(lpd.status().jobs[0].state).toBe('cancelled');
 }finally{await lpd.shutdown();await rm(root,{recursive:true,force:true});}
});
it('LPD crash recovery marks ambiguous submissions unknown and refuses replay',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hornet-lpd-'));const id=randomUUID();
 try{await writeFile(join(root,'jobs.json'),JSON.stringify([{jobId:id,queue:'hornet',printer:'fixture',mode:'raw',source:'127.0.0.1',name:'test',bytes:1,state:'submitting',createdAt:Date.now()}]));
  const service=new LpdService(root,async()=>{throw new Error('Must not submit');});expect(service.status().jobs[0].state).toBe('unknown');await expect(service.print(id)).rejects.toThrow();await service.shutdown();
 }finally{await rm(root,{recursive:true,force:true});}
});
it('VNC bridge requires correct Origin and single-use token, carries TCP over SSH and releases its lease',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hornet-vnc-')),ssh=await sshFixture();const db=new Storage(join(root,'test.db'),resolve('packages/storage/schema.sql'));
 const p=db.saveProfile({profileId:randomUUID(),name:'VNC',host:'127.0.0.1',port:ssh.port,username:'tester',authType:'password',group:'',revision:0},0);
 const emit=(owner:string,e:HornetEvent)=>{if(e.type==='challenge')queueMicrotask(()=>challenges.respond(owner,e.challengeId,e.kind==='trust'?'accept':'test-password',e.kind==='trust'));};
 const challenges=new Challenges(emit),connections=new Connections(db,challenges,emit,undefined,10),vnc=new VncService(connections);
 const sockets=new Set<Socket>();const echo=createServer(socket=>{sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));socket.pipe(socket);});await new Promise<void>(r=>echo.listen(0,'127.0.0.1',r));let ws:WebSocket|undefined;
 try{const session=await vnc.open('a',p.profileId,'127.0.0.1',(echo.address() as {port:number}).port);
  const denied=(origin:string,token:string)=>new Promise<number>((resolve,reject)=>{const w=new WebSocket(session.url,['binary',token],{origin,handshakeTimeout:2000});w.on('error',()=>{});w.on('open',()=>{w.terminate();reject(new Error('Unexpected authorization'));});w.on('unexpected-response',(_req,res)=>{res.resume();resolve(res.statusCode!);w.terminate();});});
  expect(await denied('https://evil.invalid',session.token)).toBe(403);expect(await denied('app://hornet','invalid')).toBe(403);
  ws=new WebSocket(session.url,['binary',session.token],{origin:'app://hornet'});await once(ws,'open');const message=once(ws,'message');ws.send(Buffer.from('VNC transport'));expect(Buffer.from((await message)[0]).toString()).toBe('VNC transport');
  expect(await denied('app://hornet',session.token)).toBe(403);expect(()=>vnc.close('b',session.desktopId)).toThrow();const closed=once(ws,'close');vnc.close('a',session.desktopId);await closed;
 }finally{ws?.terminate();vnc.stop();await connections.stop();db.close();await ssh.close();for(const s of sockets)s.destroy();await new Promise<void>(r=>echo.close(()=>r()));await rm(root,{recursive:true,force:true});}
});

it('routes multiple LPD queues on one listener, persists mapping and keeps staged printer snapshots',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hornet-multi-lpd-')),submitted:string[]=[];
 const lpd=new LpdService(root,async job=>{submitted.push(job.printer);return 99;});
 try{
  lpd.saveQueue({queue:'finance',printer:'accounts-printer',mode:'raw',enabled:true});
  const started=await lpd.start(config);
  await sendJob(started.config!.port,false,'finance');
  await sendJob(started.config!.port,true);
  const jobs=lpd.status().jobs;
  expect(jobs.map(j=>[j.queue,j.printer,j.owner,j.host])).toEqual([['finance','accounts-printer','user','fixture'],['hornet','fixture','user','fixture']]);
  expect(()=>lpd.removeQueue('finance')).toThrow('待提交');
  lpd.saveQueue({queue:'finance',printer:'new-printer',mode:'text',enabled:false});
  const paused=new Client(started.config!.port);
  try{paused.send('\x02finance\n');expect(await paused.ack()).toBe(1);}finally{paused.close();}
  expect(lpd.status().jobs).toHaveLength(2);
  await lpd.print(jobs[0].jobId);expect(submitted).toEqual(['accounts-printer']);
  await lpd.stop();
  const restored=new LpdService(root,async()=>undefined);
  expect(restored.status().listening).toBe(false);
  expect(restored.status().queues.find(q=>q.queue==='finance')).toEqual({queue:'finance',printer:'new-printer',mode:'text',enabled:false});
  restored.removeQueue('finance');expect(restored.status().jobs[0].queue).toBe('finance');
  await restored.shutdown();
 }finally{await lpd.shutdown();await rm(root,{recursive:true,force:true});}
});
