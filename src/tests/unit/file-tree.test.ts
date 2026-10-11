import { it,expect } from 'vitest';
import { mkdtemp,mkdir,writeFile,rm,symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { LocalFiles } from '../../services/file/local-files';
import { PathGrants } from '../../packages/security/path-grants';
import { TreeTransfers } from '../../services/file/tree-transfers';
import { scanTree } from '../../services/file/tree';
import type { FileTree,TreeEntry } from '../../packages/contracts/file-tree';

const entry=(path:string,kind:TreeEntry['kind']='file'):TreeEntry=>({path,kind,size:1,modified:1000});
it('rejects incomplete, unsafe and unbounded directory listings',async()=>{
 await expect(scanTree('/',async()=>({entries:[],truncated:true}))).rejects.toThrow('完整');
 await expect(scanTree('/',async()=>({entries:[entry('../escape')],truncated:false}))).rejects.toThrow('文件名');
 await expect(scanTree('/',async()=>({entries:[entry('same'),entry('same')],truncated:false}))).rejects.toThrow('重复');
 await expect(scanTree('/',async()=>({entries:[entry('nested','directory')],truncated:false}))).rejects.toThrow('32');
 await expect(scanTree('/',async()=>({entries:Array.from({length:5001},(_,i)=>entry(String(i))),truncated:false}))).rejects.toThrow('5000');
});
it('previews links without following junctions, rejects stale plans and enforces plan ownership',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hornet-tree-')),grants=new PathGrants(),local=new LocalFiles(grants);
 const tree:FileTree={root:'/',entries:[]};
 const service=new TreeTransfers(local,grants,{async call<T>(){return structuredClone(tree) as T;}});
 try{
  await mkdir(join(root,'allowed'));await mkdir(join(root,'outside'));await writeFile(join(root,'outside','secret'),'secret');
  await symlink(join(root,'outside'),join(root,'allowed','escape'),'junction');
  await writeFile(join(root,'allowed','ok.txt'),'before');const chosen=await local.choose('a',join(root,'allowed'));
  const preview=await service.preview('a',{connectionId:randomUUID(),rootId:chosen.rootId,localPath:'',remotePath:'/',direction:'upload'});
  expect(preview.files).toBe(1);expect(preview.conflicts).toBe(1);expect(preview.actions.some(a=>a.path.includes('secret'))).toBe(false);
  expect(()=>service.execute('b',preview.planId)).toThrow('失效');service.discard('b',preview.planId);
  await writeFile(join(root,'allowed','ok.txt'),'after-change');
  const result=await service.execute('a',preview.planId);expect(result.taskIds).toEqual([]);expect(result.error).toContain('发生变化');
  expect(await service.execute('a',preview.planId)).toEqual(result);
  service.discard('a',preview.planId);expect(()=>service.execute('a',preview.planId)).toThrow('失效');
 }finally{await rm(root,{recursive:true,force:true});}
});
it('blocks colliding Windows names and descendants of conflicting directories',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hornet-tree-conflict-')),grants=new PathGrants(),local=new LocalFiles(grants);
 const entries=[entry('block','directory'),entry('block/child'),entry('new','directory'),entry('new/file'),entry('Case'),entry('case'),entry('NUL.txt')].sort((a,b)=>a.path<b.path?-1:1);
 const service=new TreeTransfers(local,grants,{async call<T>(){return {root:'/',entries} as T;}});
 try{
  await writeFile(join(root,'block'),'keep');const chosen=await local.choose('a',root);
  const preview=await service.preview('a',{connectionId:randomUUID(),rootId:chosen.rootId,localPath:'',remotePath:'/',direction:'download'});
  expect(preview.actions.find(a=>a.path==='block')?.action).toBe('conflict');expect(preview.actions.find(a=>a.path==='block/child')?.action).toBe('conflict');
  expect(preview.actions.find(a=>a.path==='new')?.action).toBe('mkdir');expect(preview.actions.find(a=>a.path==='new/file')?.action).toBe('copy');
  if(process.platform==='win32')for(const name of ['Case','case','NUL.txt'])expect(preview.actions.find(a=>a.path===name)?.action).toBe('conflict');
 }finally{await rm(root,{recursive:true,force:true});}
});
