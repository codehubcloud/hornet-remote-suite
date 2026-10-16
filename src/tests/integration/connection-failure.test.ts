import { it,expect } from 'vitest';
import { createServer,type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Storage } from '../../packages/storage/database';
import { Challenges } from '../../packages/security/challenges';
import { Connections } from '../../services/ssh/connections';
import { sshFixture } from '../fixtures/ssh-server';
import type { HornetEvent } from '../../packages/contracts';

function setup(port:number,options:{timeout?:number;answerDelay?:number;secret?:boolean}={}){
 const db=new Storage(':memory:',resolve('packages/storage/schema.sql')),events:HornetEvent[]=[];
 const challenges=new Challenges((owner,event)=>{
  events.push(event);
  if(event.type==='challenge'&&options.answerDelay!==undefined)setTimeout(()=>challenges.respond(owner,event.challengeId,event.kind==='trust'?'accept':'test-password',event.kind==='trust'),options.answerDelay);
 });
 const connections=new Connections(db,challenges,(_owner,event)=>events.push(event),async()=>options.secret?'test-password':undefined,60000,5000,options.timeout??10000);
 const profile=db.saveProfile({profileId:randomUUID(),name:'connection failure',host:'127.0.0.1',port,username:'tester',authType:'password',group:'test',revision:0},0);
 return {db,events,connections,profile,async close(){await connections.stop();db.close();}};
}
it('reports a refused port immediately, before asking for credentials, and frees the pending connection',async()=>{
 const server=createServer();await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const port=(server.address() as {port:number}).port;await new Promise<void>(resolve=>server.close(()=>resolve()));
 const h=setup(port),start=Date.now();
 try{
  await expect(h.connections.acquire('owner',h.profile.profileId)).rejects.toThrow(`${port} · 服务器拒绝连接`);
  expect(Date.now()-start).toBeLessThan(3000);expect(h.events.some(e=>e.type==='challenge')).toBe(false);
  expect(h.events.filter(e=>e.type==='connection.state'&&e.state==='failed')).toEqual([expect.objectContaining({error:expect.stringContaining('拒绝连接')})]);
  expect(h.connections.hasProfile(h.profile.profileId)).toBe(false);
 }finally{await h.close();}
});
it('bounds a silent SSH endpoint and can retry without retaining sockets or pending entries',async()=>{
 const sockets=new Set<Socket>(),server=createServer(socket=>{sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));socket.resume();});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const h=setup((server.address() as {port:number}).port,{timeout:200,secret:true});
 try{
  for(let i=0;i<2;i++){
   const start=Date.now();await expect(h.connections.acquire('owner',h.profile.profileId)).rejects.toThrow('服务器未响应');
   expect(Date.now()-start).toBeLessThan(2000);expect(h.connections.hasProfile(h.profile.profileId)).toBe(false);
   await expect.poll(()=>sockets.size).toBe(0);
  }
 }finally{await h.close();for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
it('allows credential and host-key prompts to take longer than the network deadline',async()=>{
 const server=await sshFixture(),h=setup(server.port,{timeout:500,answerDelay:650});
 try{
  const lease=await h.connections.acquire('owner',h.profile.profileId);
  expect(h.connections.get('owner',lease.connectionId)).toBeDefined();expect(server.authCount).toBe(1);
  expect(h.events.filter(e=>e.type==='challenge').map(e=>e.kind)).toEqual(['password','trust']);
 }finally{await h.close();await server.close();}
},10000);
it('cancels a silent endpoint promptly when the owner closes',async()=>{
 const sockets=new Set<Socket>(),server=createServer(socket=>{sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));socket.resume();});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const h=setup((server.address() as {port:number}).port,{secret:true});
 try{
  const pending=h.connections.acquire('owner',h.profile.profileId),rejected=expect(pending).rejects.toThrow('取消');
  await expect.poll(()=>sockets.size).toBe(1);await h.connections.stop('owner');await rejected;
  expect(h.connections.hasProfile(h.profile.profileId)).toBe(false);await expect.poll(()=>sockets.size).toBe(0);
 }finally{await h.close();for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
