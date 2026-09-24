import { describe,it,expect } from 'vitest';
import { Challenges } from '../../packages/security/challenges';
import { PathGrants } from '../../packages/security/path-grants';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { HornetEvent } from '../../packages/contracts';
describe('resource boundaries',()=>{
 it('binds challenge to owner, kind and single use',async()=>{
  const events:HornetEvent[]=[];const c=new Challenges((_owner,e)=>events.push(e));
  const result=c.ask('window-a',{kind:'trust',profileId:'p',title:'test',message:'fingerprint'});
  const event=events[0];if(event.type!=='challenge')throw new Error('missing challenge');
  expect(()=>c.respond('window-b',event.challengeId,'accept',true)).toThrow();
  expect(()=>c.respond('window-a',event.challengeId,'accept',false)).toThrow();
  c.respond('window-a',event.challengeId,'accept',true);expect(await result).toBe('accept');
  expect(()=>c.respond('window-a',event.challengeId,'accept',true)).toThrow();
 });
 it('cancels pending challenges without leaving an auth loop',async()=>{
  const c=new Challenges(()=>{}),promise=c.ask('a',{kind:'password',profileId:'p',title:'',message:''});
  const rejected=expect(promise).rejects.toThrow('认证已取消');c.cancelOwner('a');await rejected;
 });
 it('does not let other windows use selected paths or overwrite an existing download',async()=>{
  const root=await mkdtemp(join(tmpdir(),'hornet-grants-'));
  try{const file=join(root,'test.txt');await writeFile(file,'test');const g=new PathGrants(),grant=await g.create('a',file,'upload');
   await expect(g.get('b',grant.id,'upload')).rejects.toThrow();
   await expect(g.get('a',grant.id,'download')).rejects.toThrow();
   await expect(g.create('a',file,'download')).rejects.toThrow('已存在');
  }finally{await rm(root,{recursive:true,force:true});}
 });
});
