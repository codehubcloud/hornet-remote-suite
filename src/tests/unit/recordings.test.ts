import { it,expect,vi } from 'vitest';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TerminalLogs } from '../../services/terminal/logs';
import { parseRecording,readRecording } from '../../services/terminal/recordings';
const header=JSON.stringify({kind:'hornet-terminal-recording',version:1,cols:120,rows:36});
it('records byte-exact fragmented output, timing and resize events, even before the file opens',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hornet-recording-')),logs=new TerminalLogs(()=>{});
 let now=100;const clock=vi.spyOn(performance,'now').mockImplementation(()=>now);
 try{
  const started=logs.start('owner','terminal',join(root,'test.hrec'),'recording',90,28);
  const data=Buffer.from('中文\x1b[31mred\x1b[0m\r\n');
  logs.observe('owner',{type:'terminal.data',terminalId:'terminal',generation:1,seq:1,data:data.subarray(0,2)});
  const log=await started;now=150;logs.resize('owner','terminal',100,30);now=400;
  logs.observe('owner',{type:'terminal.data',terminalId:'terminal',generation:1,seq:2,data:data.subarray(2)});
  await logs.stop('owner',log.id);const recording=await readRecording(log.path);
  expect(recording.header).toMatchObject({cols:90,rows:28});expect(recording.frames.some(f=>f[1]==='r'&&f[2]===100&&f[3]===30)).toBe(true);
  expect(Buffer.concat(recording.frames.filter(f=>f[1]==='o').map(f=>Buffer.from(f[2],'base64')))).toEqual(data);expect(recording.frames.map(f=>f[0])).toEqual(recording.frames.map(f=>f[0]).sort((a,b)=>a-b));
  expect(recording.frames.map(f=>f[0])).toEqual([0,50,300]);expect(recording.duration).toBe(300);
 }finally{clock.mockRestore();await logs.stopAll('owner');await rm(root,{recursive:true,force:true});}
});
it('rejects malformed, unsorted, out-of-bounds and executable event types',()=>{
 for(const frames of [[[1,'i','echo bad']],[[1,'o','bad base64']],[[2,'o','YQ=='],[1,'o','Yg==']],[[0,'r',1000000,36]],[[Infinity,'o','YQ==']]])expect(()=>parseRecording(header+'\n'+frames.map(f=>JSON.stringify(f)).join('\n'))).toThrow();
 expect(()=>parseRecording('not a recording')).toThrow();expect(()=>parseRecording(JSON.stringify({kind:'hornet-terminal-recording',version:2,cols:80,rows:24}))).toThrow();
 expect(parseRecording(header).frames).toEqual([]);
});
