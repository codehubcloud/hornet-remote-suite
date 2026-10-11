import { it,expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { utils } from 'ssh2';
import { resolve } from 'node:path';
import { sshFixture } from '../fixtures/ssh-server';
import { Storage } from '../../packages/storage/database';
import { Challenges } from '../../packages/security/challenges';
import { Connections } from '../../services/ssh/connections';
import { Files } from '../../services/file/files';
import type { HornetEvent } from '../../packages/contracts';
it('authenticates and verifies every hop, shares only the destination, forwards SFTP and releases the chain',async()=>{
 const servers=await Promise.all([sshFixture(),sshFixture(),sshFixture()]),db=new Storage(':memory:',resolve('packages/storage/schema.sql')),events:HornetEvent[]=[];
 const challenges=new Challenges((owner,event)=>{events.push(event);if(event.type==='challenge')queueMicrotask(()=>challenges.respond(owner,event.challengeId,event.kind==='trust'?'accept':'test-password',event.kind==='trust'));});
 const connections=new Connections(db,challenges,(_owner,event)=>events.push(event));
 try{
  const make=(index:number)=>db.saveProfile({profileId:randomUUID(),name:'hop-'+index,host:index===0?'127.0.0.1':'fixture.internal',port:servers[index].port,username:'tester',group:'test',authType:'password',revision:0},0);
  const a=make(0),b=make(1),destination=make(2),target=db.saveProfile({...destination,jumpProfileIds:[a.profileId,b.profileId]},1);
  const first=await connections.acquire('a',target.profileId),second=await connections.acquire('a',target.profileId);
  expect(second.connectionId).toBe(first.connectionId);expect(servers.map(s=>s.authCount)).toEqual([1,1,1]);
  expect(events.filter(e=>e.type==='challenge'&&e.kind==='trust')).toHaveLength(3);
  expect(connections.hasProfile(a.profileId)).toBe(true);expect(connections.hasProfile(b.profileId)).toBe(true);
  expect((await new Files(connections).list('a',first.connectionId,'/')).entries.some(f=>f.name==='hello.txt')).toBe(true);
  connections.release('a',first.leaseId);expect(connections.get('a',second.connectionId)).toBeDefined();
  connections.close('a',second.connectionId,second.generation);
  await expect.poll(()=>connections.hasProfile(a.profileId)||connections.hasProfile(b.profileId)).toBe(false);
 }finally{await connections.stop();db.close();await Promise.all(servers.map(s=>s.close()));}
},20000);
it('rejects a changed destination key through a jump host and releases the upstream hop',async()=>{
 const a=await sshFixture(),b=await sshFixture(),db=new Storage(':memory:',resolve('packages/storage/schema.sql'));
 const challenges=new Challenges((owner,event)=>{if(event.type==='challenge')queueMicrotask(()=>challenges.respond(owner,event.challengeId,event.kind==='trust'?'accept':'test-password',event.kind==='trust'));});
 const connections=new Connections(db,challenges,()=>{});
 try{
  const hop=db.saveProfile({profileId:randomUUID(),name:'hop',host:'127.0.0.1',port:a.port,username:'tester',group:'test',authType:'password',revision:0},0);
  const target=db.saveProfile({...hop,profileId:randomUUID(),name:'target',host:'fixture.internal',port:b.port,revision:0,jumpProfileIds:[hop.profileId]},0);
  const wrong=utils.parseKey(a.key);if(wrong instanceof Error||Array.isArray(wrong))throw new Error('Invalid fixture key');db.rememberHost(target.host,target.port,wrong.getPublicSSH());
  await expect(connections.acquire('a',target.profileId)).rejects.toThrow('主机密钥');expect(b.authCount).toBe(0);expect(connections.hasProfile(hop.profileId)).toBe(false);
 }finally{await connections.stop();db.close();await a.close();await b.close();}
},20000);
it('cancels the authentication prompt before the outer IPC deadline and creates no late connection',async()=>{
 const db=new Storage(':memory:',resolve('packages/storage/schema.sql')),events:HornetEvent[]=[];
 const challenges=new Challenges((_owner,event)=>events.push(event)),connections=new Connections(db,challenges,()=>{},undefined,1000,30);
 try{
  const p=db.saveProfile({profileId:randomUUID(),name:'no-auth',host:'127.0.0.1',port:22,username:'tester',group:'test',authType:'password',revision:0},0);
  await expect(connections.acquire('owner',p.profileId)).rejects.toThrow('取消');expect(events.filter(e=>e.type==='challenge.closed')).toHaveLength(1);expect(connections.hasProfile(p.profileId)).toBe(false);
 }finally{await connections.stop();db.close();}
});
it('fails closed when an intermediate hop rejects authentication and frees upstream resources',async()=>{
 const a=await sshFixture(),b=await sshFixture({password:'different'}),db=new Storage(':memory:',resolve('packages/storage/schema.sql'));
 const challenges=new Challenges((owner,event)=>{if(event.type==='challenge')queueMicrotask(()=>challenges.respond(owner,event.challengeId,event.kind==='trust'?'accept':'test-password',event.kind==='trust'));});
 const connections=new Connections(db,challenges,()=>{});
 try{
  const hop=db.saveProfile({profileId:randomUUID(),name:'hop',host:'127.0.0.1',port:a.port,username:'tester',group:'test',authType:'password',revision:0},0);
  const target=db.saveProfile({...hop,profileId:randomUUID(),name:'target',host:'fixture.internal',port:b.port,revision:0,jumpProfileIds:[hop.profileId]},0);
  await expect(connections.acquire('a',target.profileId)).rejects.toThrow('认证失败');
  await expect.poll(()=>connections.hasProfile(hop.profileId)||connections.hasProfile(target.profileId)).toBe(false);
 }finally{await connections.stop();db.close();await a.close();await b.close();}
},20000);
