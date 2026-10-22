import { describe,it,expect,vi } from 'vitest';
import { Readable } from 'node:stream';
import { CopyObjectCommand,DeleteObjectCommand,HeadObjectCommand,ListObjectsV2Command,PutObjectCommand } from '@aws-sdk/client-s3';
import { S3Files,s3Key,s3Path } from '../../services/s3/files';
import { S3Transfers } from '../../services/s3/transfers';
import type { S3Connections } from '../../services/s3/connections';

function fixture(send:ReturnType<typeof vi.fn>){
 const connection={bucket:'example-bucket',client:{send}};
 const connections={get:vi.fn(()=>connection)} as unknown as S3Connections;
 return {files:new S3Files(connections),connection};
}

describe('AWS S3 paths and object operations',()=>{
 it('normalizes safe POSIX object paths and rejects traversal or control characters',()=>{
  expect(s3Path('/logs/../app.log')).toBe('/app.log');expect(s3Key('/a/b.txt')).toBe('a/b.txt');expect(s3Key('/')).toBe('');
  expect(()=>s3Path('/bad\\key')).toThrow();expect(()=>s3Path('/bad\0key')).toThrow();
 });
 it('copies an object conditionally before removing the old key',async()=>{
  const send=vi.fn(async(command:any)=>{if(command instanceof HeadObjectCommand)throw Object.assign(new Error('missing'),{$metadata:{httpStatusCode:404}});return {}; }),{files}=fixture(send);
  await files.rename('owner','connection','/dir/a #1.txt','/dir/b #1.txt');
  expect(send.mock.calls[0][0]).toBeInstanceOf(HeadObjectCommand);
  expect(send.mock.calls[1][0]).toBeInstanceOf(CopyObjectCommand);
  expect(send.mock.calls[1][0].input).toMatchObject({Bucket:'example-bucket',Key:'dir/b #1.txt',IfNoneMatch:'*'});
  expect(send.mock.calls[2][0]).toBeInstanceOf(DeleteObjectCommand);
 });
 it('deletes an object with folder-like children and only removes empty folder markers',async()=>{
  const send=vi.fn(async(command:any)=>{
   if(command instanceof HeadObjectCommand)return {ETag:'"etag"'};
   if(command instanceof ListObjectsV2Command)return {Contents:[{Key:'notes/today.txt'}]};
   return {};
  }),{files}=fixture(send);
  await files.remove('owner','connection','/notes');
  expect(send.mock.calls.at(-1)?.[0]).toBeInstanceOf(DeleteObjectCommand);
  send.mockReset().mockImplementation(async(command:any)=>{if(command instanceof HeadObjectCommand)throw Object.assign(new Error('missing'),{$metadata:{httpStatusCode:404}});return command instanceof ListObjectsV2Command?{Contents:[{Key:'notes/'}]}:{};});
  await files.remove('owner','connection','/notes');
  expect(send.mock.calls.at(-1)?.[0]).toBeInstanceOf(DeleteObjectCommand);
  send.mockReset().mockImplementation(async(command:any)=>{if(command instanceof HeadObjectCommand)throw Object.assign(new Error('missing'),{$metadata:{httpStatusCode:404}});return command instanceof ListObjectsV2Command?{Contents:[{Key:'notes/child.txt'}]}:{};});
  await expect(files.remove('owner','connection','/notes')).rejects.toMatchObject({code:'FILE_NOT_EMPTY'});
 });
 it('uses an ETag precondition when saving an edited object',async()=>{
  const send=vi.fn(async(command:any)=>{
   if(command.constructor.name==='GetObjectCommand')return {Body:Readable.from([Buffer.from('old')]),ContentLength:3,ETag:'"old-etag"'};
   return {};
  }),{files}=fixture(send);
  const opened=await files.read('owner','connection','/app.txt');
  await files.save('owner','connection','/app.txt','new',opened.hash);
  const put=send.mock.calls.at(-1)?.[0];expect(put).toBeInstanceOf(PutObjectCommand);expect(put.input.IfMatch).toBe('"old-etag"');
 });
 it('rejects directory synchronization and folder keys as object transfers',()=>{
  const {files}=fixture(vi.fn()),transfers=new S3Transfers({} as S3Connections,vi.fn());
  expect(()=>transfers.validate('/folder/')).toThrow();
  expect(()=>transfers.validate('/file.txt',{remoteParent:'/'} as any)).toThrow();
  expect(()=>files.tree()).toThrow();
 });
});
