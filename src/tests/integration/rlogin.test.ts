import { describe,it,expect } from 'vitest';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { RloginTerminals } from '../../services/terminal/rlogin';
import { profileSchema,type HornetEvent } from '../../packages/contracts';

async function server(onClient:(socket:import('node:net').Socket)=>void){
 const value=createServer(onClient);value.listen(0,'127.0.0.1');await once(value,'listening');
 return {server:value,port:(value.address() as import('node:net').AddressInfo).port,close:()=>new Promise<void>(resolve=>value.close(()=>resolve()))};
}
const config=(port:number)=>profileSchema.parse({profileId:randomUUID(),name:'rlogin test',protocol:'rlogin',host:'127.0.0.1',port,username:'remote-user',group:'',authType:'agent',revision:0});

describe('RLOGIN terminal transport',()=>{
 it('sends the RFC 1282 user handshake, opens an interactive terminal, and closes cleanly',async()=>{
  let handshake=Buffer.alloc(0);
  let acceptPeer:(socket:import('node:net').Socket)=>void=()=>{};const peerPromise=new Promise<import('node:net').Socket>(resolve=>{acceptPeer=resolve;});
  const fixture=await server(socket=>{
   socket.on('data',data=>{handshake=Buffer.concat([handshake,Buffer.isBuffer(data)?data:Buffer.from(data)]);const fields=handshake.toString('utf8').split('\0');if(fields.length>=4){acceptPeer(socket);socket.write(Buffer.from('\0welcome\r\n$ '));socket.removeAllListeners('data');}});
  });
  const events:HornetEvent[]=[],terminals=new RloginTerminals((_owner,event)=>events.push(event));
  try{
   const session=await terminals.open('test',config(fixture.port),80,24),peer=await peerPromise;
   expect(handshake[0]).toBe(0);expect(handshake.toString('utf8').split('\0').slice(1,4)).toEqual([expect.any(String),'remote-user','xterm-256color/38400']);
   terminals.attach('test',session.terminalId);
   expect(events.some(e=>e.type==='connection.state'&&e.state==='ready')).toBe(true);
   const input=new Promise<Buffer>(resolve=>peer.once('data',chunk=>resolve(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk))));terminals.write('test',session.terminalId,1,1,'echo ok\r');expect((await input).toString()).toBe('echo ok\r');
   terminals.close('test',session.terminalId);expect(events.some(e=>e.type==='terminal.closed')).toBe(true);
  }finally{terminals.stop();await fixture.close();}
 });

 it('surfaces a server trust rejection and never reports it as connected',async()=>{
  const fixture=await server(socket=>socket.once('data',()=>socket.write(Buffer.from('\x01Permission denied\r\n'))));
  const events:HornetEvent[]=[],terminals=new RloginTerminals((_owner,event)=>events.push(event));
  try{
   await expect(terminals.open('test',config(fixture.port),80,24)).rejects.toThrow('Permission denied');
   expect(events.some(e=>e.type==='connection.state'&&e.state==='ready')).toBe(false);
   expect(events.some(e=>e.type==='connection.state'&&e.state==='failed')).toBe(true);
  }finally{terminals.stop();await fixture.close();}
 });
});
