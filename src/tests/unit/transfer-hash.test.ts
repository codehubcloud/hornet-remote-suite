import { it,expect,vi,afterEach } from 'vitest';
import { PassThrough,Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import type { Client,ClientChannel } from 'ssh2';
import { hashRemoteFile,hashTransferStream,remoteHashCommand } from '../../services/file/transfer-hash';
const digest=createHash('sha256').update('payload').digest('hex');
afterEach(()=>vi.useRealTimers());
function client(){return {exec:vi.fn()} as unknown as Client;}
function stream(){return Object.assign(new PassThrough(),{stderr:new PassThrough()}) as unknown as ClientChannel;}
it('hashes remotely without reading the SFTP fallback and quotes every pathname character',async()=>{
 const c=client(),s=stream(),fallback=vi.fn(()=>Readable.from(['payload'])),progress=vi.fn();
 vi.mocked(c.exec).mockImplementation((_command:any,cb:any)=>{cb(undefined,s);queueMicrotask(()=>{s.write('login banner\n'+digest+'  -\n');s.emit('close',0);});return c;});
 expect(remoteHashCommand("/tmp/a'$(touch unsafe);\n-x")).toBe("LC_ALL=C sha256sum < '/tmp/a'\"'\"'$(touch unsafe);\n-x'");
 expect(await hashRemoteFile(c,'/tmp/file',7,new AbortController().signal,fallback,progress)).toBe(digest);
 expect(fallback).not.toHaveBeenCalled();expect(progress).toHaveBeenLastCalledWith(7,7,'remote');
});
it('falls back on unsupported exec or malformed hash, caching support per SSH connection',async()=>{
 const c=client(),fallback=vi.fn(()=>Readable.from(['payload']));
 vi.mocked(c.exec).mockImplementation((_command:any,cb:any)=>cb(new Error('SFTP only')));
 for(let i=0;i<2;i++)expect(await hashRemoteFile(c,'/file',7,new AbortController().signal,fallback)).toBe(digest);
 expect(c.exec).toHaveBeenCalledTimes(1);expect(fallback).toHaveBeenCalledTimes(2);
 const other=client(),s=stream();vi.mocked(other.exec).mockImplementation((_command:any,cb:any)=>{cb(undefined,s);queueMicrotask(()=>{s.write('wrong hash');s.emit('close',0);});return other;});
 expect(await hashRemoteFile(other,'/file',7,new AbortController().signal,fallback)).toBe(digest);
});
it('cancels a remote hash without starting a fallback or killing the SSH connection',async()=>{
 const c=client(),s=stream(),abort=new AbortController(),fallback=vi.fn();
 vi.mocked(c.exec).mockImplementation((_command:any,cb:any)=>cb(undefined,s));
 const result=hashRemoteFile(c,'/file',7,abort.signal,fallback);abort.abort();
 await expect(result).rejects.toThrow('停止');expect(s.destroyed).toBe(true);expect(fallback).not.toHaveBeenCalled();
});
it('reports streamed verification bytes and times out a stalled stream',async()=>{
 const progress=vi.fn();expect(await hashTransferStream(Readable.from(['pay','load']),new AbortController().signal,7,progress)).toBe(digest);
 expect(progress).toHaveBeenLastCalledWith(7,7,'stream');
 vi.useFakeTimers();const s=new PassThrough();const result=expect(hashTransferStream(s,new AbortController().signal,7)).rejects.toThrow('没有收到数据');
 await vi.advanceTimersByTimeAsync(60000);await result;
});
it('bounds channel opening and disposes a late channel after falling back',async()=>{
 vi.useFakeTimers();const c=client();let callback:any;
 vi.mocked(c.exec).mockImplementation((_command:any,cb:any)=>{callback=cb;return c;});
 const result=hashRemoteFile(c,'/file',7,new AbortController().signal,()=>Readable.from(['payload']));
 await vi.advanceTimersByTimeAsync(10000);expect(await result).toBe(digest);
 const late=stream();callback(undefined,late);expect(late.destroyed).toBe(true);
});
