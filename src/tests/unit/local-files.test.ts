import { it,expect } from 'vitest';
import { mkdtemp,mkdir,writeFile,rm,symlink,realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalFiles } from '../../services/file/local-files';
import { PathGrants } from '../../packages/security/path-grants';
it('browses an approved root, creates children and grants files without escaping or overwriting',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'hornet-local-'))),grants=new PathGrants(),files=new LocalFiles(grants);
 try{
  await writeFile(join(root,'中文.txt'),'hello');await mkdir(join(root,'child'));
  const directory=await files.choose('a',root);
  expect(directory.entries.map(e=>e.name)).toEqual(['child','中文.txt']);
  await expect(files.list('b',directory.rootId,'')).rejects.toThrow();
  await expect(files.list('a',directory.rootId,'..')).rejects.toThrow();
  await expect(files.grant('a',directory.rootId,'','download','../escape')).rejects.toThrow();
  await expect(files.grant('a',directory.rootId,'','download','NUL.txt')).rejects.toThrow();
  await expect(files.grant('a',directory.rootId,'','download','file:stream')).rejects.toThrow();
  await expect(files.grant('a',directory.rootId,'','download','中文.txt')).rejects.toThrow('已存在');
  const upload=await files.grant('a',directory.rootId,'中文.txt','upload');expect((await grants.get('a',upload.pathGrantId,'upload')).path).toBe(join(root,'中文.txt'));
  await files.mkdir('a',directory.rootId,'child','new');
  expect((await files.list('a',directory.rootId,'child')).entries[0].name).toBe('new');
  const download=await files.grant('a',directory.rootId,'child','download','new.txt');expect((await grants.get('a',download.pathGrantId,'download')).parent).toBe(join(root,'child'));
  files.release('a',directory.rootId);await expect(files.list('a',directory.rootId,'')).rejects.toThrow();
 }finally{await rm(root,{recursive:true,force:true});}
});
it('refuses directory junctions pointing outside the approved tree',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hornet-local-links-')),files=new LocalFiles(new PathGrants());
 try{await mkdir(join(root,'allowed'));await mkdir(join(root,'outside'));await writeFile(join(root,'outside','secret'),'private');await symlink(join(root,'outside'),join(root,'allowed','escape'),'junction');
  const directory=await files.choose('a',join(root,'allowed'));expect(directory.entries[0].kind).toBe('link');
  await expect(files.list('a',directory.rootId,'escape')).rejects.toThrow();
  await expect(files.grant('a',directory.rootId,'escape/secret','upload')).rejects.toThrow();
 }finally{await rm(root,{recursive:true,force:true});}
});
