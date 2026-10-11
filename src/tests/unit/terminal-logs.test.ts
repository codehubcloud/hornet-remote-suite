import { it,expect } from 'vitest';
import { mkdtemp,readFile,rm,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TerminalLogs,TerminalText } from '../../services/terminal/logs';
const event=(id:string,buffer:Buffer)=>({type:'terminal.data' as const,terminalId:id,generation:1,seq:1,data:buffer});
it('strips fragmented control sequences while preserving split UTF-8 output',()=>{
 const text=new TerminalText(),input=Buffer.from('中文\x1b[31m红色\x1b[0m\r\n\x1b]0;secret-title\x07A\x1bPignored\x1b\\B\x1b(B\tend');
 const output=[...input].map(byte=>text.write(Buffer.from([byte]))).join('')+text.end();
 expect(output).toBe('中文红色\r\nAB\tend');
});
it('records separate text/raw transcripts, flushes on terminal close, checks owners and never overwrites',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hornet-log-')),logs=new TerminalLogs(()=>{});
 try{
  const plain=await logs.start('a','one',join(root,'plain.log'),'text'),raw=await logs.start('a','two',join(root,'raw.log'),'raw');
  await expect(logs.start('a','one',join(root,'duplicate.log'),'text')).rejects.toThrow('已有');
  const wire=Buffer.from('hello \x1b[32m世界\x1b[0m\r\n');
  logs.observe('other',event('one',Buffer.from('secret')));logs.observe('a',event('one',wire.subarray(0,14)));logs.observe('a',event('one',wire.subarray(14)));logs.observe('a',event('two',wire));
  expect(logs.list('other')).toEqual([]);await expect(logs.stop('other',plain.id)).rejects.toThrow();
  logs.observe('a',{type:'terminal.closed',terminalId:'one'});await logs.stop('a',plain.id);
  logs.observe('a',event('one',Buffer.from('late')));logs.observe('a',event('two',Buffer.from('tail')));await logs.stop('a',raw.id);
  expect(await readFile(join(root,'plain.log'),'utf8')).toBe('hello 世界\r\n');expect(await readFile(join(root,'raw.log'))).toEqual(Buffer.concat([wire,Buffer.from('tail')]));
  await writeFile(join(root,'existing.log'),'keep');await expect(logs.start('a','three',join(root,'existing.log'),'text')).rejects.toThrow('已存在');expect(await readFile(join(root,'existing.log'),'utf8')).toBe('keep');
 }finally{await logs.stopAll('a');await rm(root,{recursive:true,force:true});}
});
it('stops a full or slow log without throwing from terminal output delivery',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hornet-log-limit-')),logs=new TerminalLogs(()=>{},5,1024),slow=new TerminalLogs(()=>{},1024,4);
 try{
  const log=await logs.start('a','one',join(root,'limit.log'),'raw');logs.observe('a',event('one',Buffer.from('ab')));expect(()=>logs.observe('a',event('one',Buffer.from('cdef')))).not.toThrow();
  expect((await logs.stop('a',log.id)).state).toBe('failed');expect(await readFile(join(root,'limit.log'),'utf8')).toBe('ab');
  const other=await slow.start('a','two',join(root,'slow.log'),'raw');expect(()=>slow.observe('a',event('two',Buffer.from('too large')))).not.toThrow();expect((await slow.stop('a',other.id)).error).toContain('跟不上');
 }finally{await logs.stopAll('a');await slow.stopAll('a');await rm(root,{recursive:true,force:true});}
});
