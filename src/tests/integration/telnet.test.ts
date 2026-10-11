import { it,expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { TelnetTerminals } from '../../services/terminal/telnet';
import { telnetFixture } from '../fixtures/telnet-server';
import type { HornetEvent,Profile } from '../../packages/contracts';
async function wait(test:()=>boolean){const until=Date.now()+8000;while(!test()){if(Date.now()>until)throw new Error('Telnet fixture timeout');await new Promise(r=>setTimeout(r,10));}}
it('uses independent real TCP terminals, negotiates size/type and enforces input/owner isolation',async()=>{
 const server=await telnetFixture(),events:HornetEvent[]=[];
 const terminals=new TelnetTerminals((_owner,e)=>events.push(e));
 const profile:Profile={profileId:randomUUID(),name:'Telnet',host:'127.0.0.1',port:server.port,username:'',group:'',authType:'password',revision:1,protocol:'telnet'};
 try{
  const a=await terminals.open('a',profile,80,24),b=await terminals.open('a',profile,100,30);terminals.attach('a',a.terminalId);terminals.attach('a',b.terminalId);
  await wait(()=>server.peers.every(p=>p.terminalType==='XTERM-256COLOR'&&p.cols>0));expect(server.peers.map(p=>p.cols)).toEqual([80,100]);
  terminals.write('a',b.terminalId,1,1,'echo isolated\r');await wait(()=>server.peers[1].input.length>0);expect(server.peers[0].input.length).toBe(0);expect(server.peers[1].input.toString()).toBe('echo isolated\r');
  expect(()=>terminals.write('a',b.terminalId,1,1,'repeat')).toThrow('版本');expect(()=>terminals.write('other',b.terminalId,1,2,'bad')).toThrow();expect(()=>terminals.close('other',b.terminalId)).toThrow();
  terminals.resize('a',b.terminalId,1,255,40);await wait(()=>server.peers[1].cols===255);expect(server.peers[1].rows).toBe(40);
  terminals.close('a',a.terminalId);expect(terminals.has(b.terminalId)).toBe(true);expect(terminals.hasProfile(profile.profileId)).toBe(true);
  server.peers[1].socket.end('last line\r\n');await wait(()=>events.some(e=>e.type==='terminal.closed'&&e.terminalId===b.terminalId));
  const output=Buffer.concat(events.filter((e):e is Extract<HornetEvent,{type:'terminal.data'}>=>e.type==='terminal.data'&&e.terminalId===b.terminalId).map(e=>Buffer.from(e.data))).toString();expect(output).toContain('last line');expect(terminals.hasProfile(profile.profileId)).toBe(false);
  await expect(terminals.open('a',{...profile,protocol:'ssh'},80,24)).rejects.toThrow('Telnet');
 }finally{terminals.stop();await server.close();}
});
it('bounds unacknowledged output and resumes on ordered renderer acknowledgements',async()=>{
 const server=await telnetFixture(),events:Extract<HornetEvent,{type:'terminal.data'}>[]=[];
 const terminals=new TelnetTerminals((_owner,e)=>{if(e.type==='terminal.data')events.push(e);});
 try{
  const session=await terminals.open('a',{protocol:'telnet',profileId:randomUUID(),name:'Flow',host:'127.0.0.1',port:server.port,username:'',group:'',authType:'password',revision:1},80,24);
  terminals.attach('a',session.terminalId);await wait(()=>events.length>0);for(const e of [...events])terminals.ack('a',session.terminalId,e.seq);events.length=0;
  server.peers[0].socket.write(Buffer.from([255,252,1])); // Server disables remote echo.
  server.peers[0].socket.write(Buffer.alloc(1048576-40960,65));await wait(()=>events.reduce((sum,e)=>sum+e.data.length,0)===1048576-40960);
  // Local backspace rendering expands input to three bytes; it must share the
  // same outstanding-output budget and must not consume the rejected input seq.
  expect(()=>terminals.write('a',session.terminalId,1,1,'\b'.repeat(32768))).toThrow('输入过快');
  expect(server.peers[0].input.length).toBe(0);
  server.peers[0].socket.write(Buffer.alloc(1048576+40960,65));await wait(()=>events.reduce((sum,e)=>sum+e.data.length,0)>=1048564);expect(events.reduce((sum,e)=>sum+e.data.length,0)).toBeLessThanOrEqual(1048576);
  expect(()=>terminals.ack('a',session.terminalId,events[0].seq+1)).toThrow('序号');
  let acknowledged=0;await wait(()=>{while(acknowledged<events.length){const e=events[acknowledged++];terminals.ack('a',session.terminalId,e.seq);}return events.reduce((sum,e)=>sum+e.data.length,0)===2*1048576;});
  terminals.write('a',session.terminalId,1,1,'ok\r');await wait(()=>server.peers[0].input.toString()==='ok\r');
 }finally{terminals.stop();await server.close();}
});
