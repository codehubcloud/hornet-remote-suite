import { it,expect,vi } from 'vitest';
import { mkdtemp,realpath,writeFile,readFile,mkdir,rm,symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { asciiLines } from '../../services/ftp/ascii';
import { LocalFiles } from '../../services/file/local-files';
import { PathGrants } from '../../packages/security/path-grants';
import { TransferSchedules } from '../../apps/desktop/main/transfer-schedules';
it('normalizes split ASCII line endings while preserving all other bytes',async()=>{
 const input=[Buffer.from([0,255,65,13]),Buffer.from([10,66,10,67,13])];
 const collect=async(crlf:boolean)=>{const chunks:Buffer[]=[];for await(const chunk of Readable.from(input).pipe(asciiLines(crlf)))chunks.push(chunk);return Buffer.concat(chunks);};
 expect(await collect(true)).toEqual(Buffer.from([0,255,65,13,10,66,13,10,67,13,10]));expect(await collect(false)).toEqual(Buffer.from([0,255,65,10,66,10,67,10]));
});
it('copies nested approved directories without overwriting, escaping or copying links',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'hornet-copy-'))),files=new LocalFiles(new PathGrants());
 try{await mkdir(join(root,'from'));await mkdir(join(root,'to'));await mkdir(join(root,'from','child'));await writeFile(join(root,'from','child','data.bin'),Buffer.from([0,255,13,10]));const grant=await files.choose('a',root);
  await files.copy('a',grant.rootId,'from',grant.rootId,'to');expect(await readFile(join(root,'to','from','child','data.bin'))).toEqual(Buffer.from([0,255,13,10]));
  await expect(files.copy('a',grant.rootId,'from',grant.rootId,'from/child')).rejects.toThrow('内部');await expect(files.copy('a',grant.rootId,'from',grant.rootId,'to')).rejects.toThrow();
  await symlink(join(root,'to'),join(root,'from','escape'),'junction');await mkdir(join(root,'other'));await expect(files.copy('a',grant.rootId,'from',grant.rootId,'other')).rejects.toThrow();expect((await files.list('a',grant.rootId,'other')).entries).toEqual([]);
  await expect(files.rename('a',grant.rootId,'from','to')).rejects.toThrow();await files.rename('a',grant.rootId,'other','renamed');await files.remove('a',grant.rootId,'renamed');
 }finally{await rm(root,{recursive:true,force:true});}
});
it('persists schedules, requires approval for overdue startup work, and does not automatically repeat failed submissions',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hornet-schedule-')),file=join(root,'jobs.json');let scheduler:TransferSchedules|undefined;
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
 try{const execute=vi.fn(async()=>randomUUID());scheduler=new TransferSchedules(file,execute);const job=scheduler.add({profileId:randomUUID(),direction:'upload',remotePath:'/file',at:Date.now()+2000},1,'fixture','/approved/file','/approved');scheduler.stop();
  vi.setSystemTime(Date.now()+3000);scheduler=new TransferSchedules(file,execute);expect(scheduler.list()[0].state).toBe('waiting');await vi.advanceTimersByTimeAsync(2000);expect(execute).not.toHaveBeenCalled();await scheduler.run(job.id);expect(execute).toHaveBeenCalledTimes(1);await expect(scheduler.run(job.id)).rejects.toThrow('重复');scheduler.stop();
  const failing=vi.fn(async()=>{throw new Error('unknown commit');});scheduler=new TransferSchedules(file,failing);const second=scheduler.add({profileId:randomUUID(),direction:'download',remotePath:'/other',at:Date.now()+2000},1,'fixture','/approved/other','/approved');await vi.advanceTimersByTimeAsync(4000);expect(scheduler.list().find(value=>value.id===second.id)?.state).toBe('failed');await vi.advanceTimersByTimeAsync(5000);expect(failing).toHaveBeenCalledTimes(1);
 }finally{scheduler?.stop();vi.useRealTimers();await rm(root,{recursive:true,force:true});}
});
