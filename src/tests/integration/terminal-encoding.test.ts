import { it,expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { resolve,join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp,rm } from 'node:fs/promises';
import { Storage } from '../../packages/storage/database';
import { Challenges } from '../../packages/security/challenges';
import { Connections } from '../../services/ssh/connections';
import { Terminals } from '../../services/terminal/terminals';
import { TelnetTerminals } from '../../services/terminal/telnet';
import { DeviceTerminals } from '../../services/terminal/devices';
import { openSerial } from '../../services/terminal/serial';
import { TerminalLogs } from '../../services/terminal/logs';
import { readRecording } from '../../services/terminal/recordings';
import { SerialPortMock } from 'serialport';
import { sshFixture } from '../fixtures/ssh-server';
import { telnetFixture } from '../fixtures/telnet-server';
import type { HornetEvent,Profile } from '../../packages/contracts';
const profile=(port:number):Profile=>({profileId:randomUUID(),name:'encoded',host:'127.0.0.1',port,username:'tester',group:'test',authType:'password',revision:0,encoding:'gbk'});
const output=(events:HornetEvent[],id:string)=>Buffer.concat(events.filter((e):e is Extract<HornetEvent,{type:'terminal.data'}>=>e.type==='terminal.data'&&e.terminalId===id).map(e=>Buffer.from(e.data))).toString();
it('uses saved SSH encoding on both directions, isolates runtime changes and records UTF-8',async()=>{
 const server=await sshFixture(),db=new Storage(':memory:',resolve('packages/storage/schema.sql')),dir=await mkdtemp(join(tmpdir(),'hornet-encoding-')),events:HornetEvent[]=[],logs=new TerminalLogs(()=>{});
 const challenges=new Challenges((owner,e)=>{if(e.type==='challenge')queueMicrotask(()=>challenges.respond(owner,e.challengeId,e.kind==='trust'?'accept':'test-password',e.kind==='trust'));});
 const connections=new Connections(db,challenges,()=>{}),terminals=new Terminals(connections,(owner,e)=>{events.push(e);logs.observe(owner,e);});
 try{
  const p=db.saveProfile(profile(server.port),0);expect(db.profile(p.profileId).encoding).toBe('gbk');db.importProfiles([p]);expect(db.profiles().every(p=>p.encoding==='gbk')).toBe(true);
  const c=await connections.acquire('a',p.profileId),a=await terminals.create('a',c.connectionId,80,24),b=await terminals.create('a',c.connectionId,80,24);
  terminals.attach('a',a.terminalId);terminals.attach('a',b.terminalId);
  const log=await logs.start('a',a.terminalId,join(dir,'encoding.hrec'),'recording');
  terminals.write('a',a.terminalId,a.generation,1,'中文\r');
  await expect.poll(()=>output(events,a.terminalId)).toContain('echo:中文');expect(server.shellBytes[0][1]).toEqual(Buffer.from('d6d0cec40d','hex'));
  expect(()=>terminals.encoding('other',a.terminalId,a.generation,'utf8')).toThrow('无权');expect(()=>terminals.encoding('a',a.terminalId,999,'utf8')).toThrow('版本');
  terminals.encoding('a',a.terminalId,a.generation,'utf8');expect(terminals.encoding('a',b.terminalId,b.generation)).toBe('gbk');expect(db.profile(p.profileId).encoding).toBe('gbk');
  terminals.write('a',a.terminalId,a.generation,2,'切换\r');await expect.poll(()=>output(events,a.terminalId)).toContain('echo:切换');
  await logs.stop('a',log.id);const recording=await readRecording(log.path);expect(Buffer.concat(recording.frames.filter(f=>f[1]==='o').map(f=>Buffer.from(f[2] as string,'base64'))).toString()).toContain('中文');
 }finally{terminals.stop();await connections.stop();db.close();await server.close();await rm(dir,{recursive:true,force:true});}
});
it('accepts late flow acknowledgements and resize only for a known closed SSH terminal owned by the caller',async()=>{
 const server=await sshFixture(),db=new Storage(':memory:',resolve('packages/storage/schema.sql')),events:HornetEvent[]=[];
 const challenges=new Challenges((owner,e)=>{if(e.type==='challenge')queueMicrotask(()=>challenges.respond(owner,e.challengeId,e.kind==='trust'?'accept':'test-password',e.kind==='trust'));});
 const connections=new Connections(db,challenges,()=>{}),terminals=new Terminals(connections,(_owner,event)=>events.push(event));
 try{
  const p=db.saveProfile({...profile(server.port),encoding:'utf8'},0),connection=await connections.acquire('a',p.profileId),terminal=await terminals.create('a',connection.connectionId,80,24);
  const {terminalId:id,generation}=terminal;terminals.attach('a',id);await expect.poll(()=>output(events,id)).toContain('fixture ready');
  expect(()=>terminals.ack('a',id,999)).toThrow('确认序号');
  server.disconnect();await expect.poll(()=>events.some(e=>e.type==='terminal.closed'&&e.terminalId===id)).toBe(true);
  for(const event of events)if(event.type==='terminal.data'&&event.terminalId===id)expect(()=>terminals.ack('a',id,event.seq)).not.toThrow();
  expect(()=>terminals.resize('a',id,generation,120,36)).not.toThrow();
  expect(()=>terminals.ack('other',id,1)).toThrow('无权');expect(()=>terminals.ack('a',randomUUID(),1)).toThrow('无权');
  expect(()=>terminals.resize('other',id,generation,120,36)).toThrow('无权');expect(()=>terminals.resize('a',id,generation+1,120,36)).toThrow('无权');
  expect(()=>terminals.write('a',id,generation,1,'must not send')).toThrow('已关闭');expect(()=>terminals.attach('a',id)).toThrow('已关闭');
 }finally{terminals.stop();await connections.stop();db.close();await server.close();}
});
it('decodes Telnet legacy bytes after negotiation and encodes/escapes input with per-session isolation',async()=>{
 const server=await telnetFixture(),events:HornetEvent[]=[],terminals=new TelnetTerminals((_owner,e)=>events.push(e));
 try{
  const a=await terminals.open('a',{...profile(server.port),protocol:'telnet'},80,24),b=await terminals.open('a',{...profile(server.port),protocol:'telnet',encoding:'utf8'},80,24);terminals.attach('a',a.terminalId);terminals.attach('a',b.terminalId);
  await expect.poll(()=>server.peers.every(p=>p.terminalType==='XTERM-256COLOR')).toBe(true);
  for(const byte of Buffer.from('d6d0cec4','hex'))server.peers[0].socket.write(Buffer.from([byte]));await expect.poll(()=>output(events,a.terminalId)).toContain('中文');
  terminals.write('a',a.terminalId,1,1,'中文\r');await expect.poll(()=>server.peers[0].input.toString('hex')).toBe('d6d0cec40d');
  terminals.encoding('a',a.terminalId,1,'windows-1252');terminals.write('a',a.terminalId,1,2,'ÿ');await expect.poll(()=>server.peers[0].input.at(-1)).toBe(255);
  expect(terminals.encoding('a',b.terminalId,1)).toBe('utf8');expect(()=>terminals.encoding('b',a.terminalId,1,'utf8')).toThrow('无权');
 }finally{terminals.stop();await server.close();}
});
it('encodes serial bytes, preserves Unicode local echo and switches streaming decoders',async()=>{
 const binding=SerialPortMock.binding;binding.reset();binding.createPort('COM109',{record:true,maxReadSize:1});let port!:SerialPortMock;
 const events:HornetEvent[]=[],terminals=new DeviceTerminals((_owner,e)=>events.push(e));
 try{
  const s=await openSerial(terminals,'a',{path:'COM109',baudRate:115200,dataBits:8,stopBits:1,parity:'none',flowControl:'none',newline:'crlf',localEcho:true,cols:80,rows:24,encoding:'gbk'},c=>port=new SerialPortMock({path:c.path,baudRate:c.baudRate,autoOpen:false}));
  terminals.attach('a',s.terminalId);terminals.write('a',s.terminalId,1,1,'中文\r');await expect.poll(()=>port.port!.recording.toString('hex')).toBe('d6d0cec40d0a');
  port.port!.emitData(Buffer.from('d6d0cec4','hex'));await expect.poll(()=>output(events,s.terminalId)).toBe('中文\r\n中文');
  terminals.encoding('a',s.terminalId,1,'utf8');port.port!.emitData(Buffer.from('切换'));await expect.poll(()=>output(events,s.terminalId)).toContain('切换');
 }finally{await terminals.stop();binding.reset();}
});
it('keeps expanded replacement characters inside the Telnet output budget and resumes after ACK',async()=>{
 const server=await telnetFixture(),events:Extract<HornetEvent,{type:'terminal.data'}>[]=[],terminals=new TelnetTerminals((_owner,e)=>{if(e.type==='terminal.data')events.push(e);});
 try{
  const a=await terminals.open('a',{...profile(server.port),protocol:'telnet',encoding:'utf8'},80,24);terminals.attach('a',a.terminalId);
  await expect.poll(()=>events.length).toBeGreaterThan(0);for(const e of [...events])terminals.ack('a',a.terminalId,e.seq);events.length=0;
  const size=()=>events.reduce((n,e)=>n+e.data.length,0);
  server.peers[0].socket.write(Buffer.alloc(450000,0x80));await expect.poll(size).toBeGreaterThanOrEqual(1048564);expect(size()).toBeLessThanOrEqual(1048576);
  let acked=0;await expect.poll(()=>{while(acked<events.length)terminals.ack('a',a.terminalId,events[acked++].seq);return size();}).toBe(1350000);
  expect(Buffer.concat(events.map(e=>Buffer.from(e.data))).toString()).toBe('�'.repeat(450000));
 }finally{terminals.stop();await server.close();}
});
