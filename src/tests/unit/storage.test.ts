import { describe,it,expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Storage } from '../../packages/storage/database';
import { profileSchema,schemas } from '../../packages/contracts';
const profile=()=>({profileId:randomUUID(),name:'server',host:'localhost',port:22,username:'tester',group:'test',authType:'password' as const,revision:0});
describe('persistent model and untrusted input',()=>{
 it('deletes group connections and rejects stale membership atomically',()=>{
  const db=new Storage(':memory:',resolve('packages/storage/schema.sql'));
  try{
   const a=db.saveProfile({...profile(),group:'prod'},0),b=db.saveProfile({...profile(),group:'prod/db'},0),other=db.saveProfile({...profile(),group:'production'},0);
   expect(()=>db.removeGroup('prod',[a])).toThrow('连接已变化');
   expect(db.profile(a.profileId).group).toBe('prod');
   expect(()=>db.removeGroup('prod',[a,{...b,revision:99}])).toThrow('连接已变化');
   expect(db.profile(a.profileId).group).toBe('prod');
   db.removeGroup('prod',[a,b]);
   expect(db.profiles()).toHaveLength(1);
   expect(()=>db.profile(a.profileId)).toThrow('不存在');
   expect(()=>db.profile(b.profileId)).toThrow('不存在');
   expect(db.db.prepare('SELECT id FROM host_profile WHERE id=?').get(a.profileId)).toBeUndefined();
   expect(db.db.prepare('SELECT id FROM credential_profile WHERE id=?').get(b.profileId)).toBeUndefined();
   expect(db.profile(other.profileId)).toEqual(other);
   expect(()=>db.removeGroup('默认分组',[])).toThrow('不能删除');
  }finally{db.close();}
 });
 it('validates profile secrets, protocol options and port',()=>{
  expect(()=>profileSchema.parse({...profile(),password:'secret'})).toThrow();
  expect(()=>profileSchema.parse({...profile(),port:0})).toThrow();
  expect(()=>schemas['terminal.create'].parse({connectionId:randomUUID(),cols:2000,rows:24})).toThrow();
 });
 it('rejects stale revisions and imports as new identities',()=>{
  const db=new Storage(':memory:',resolve('packages/storage/schema.sql'));
  try{
   const p=profile(),saved=db.saveProfile(p,0);expect(saved.revision).toBe(1);
   expect(()=>db.saveProfile({...p,name:'stale'},0)).toThrow('配置已被修改');
   expect(db.importProfiles([saved])).toBe(1);expect(db.profiles()).toHaveLength(2);
   expect(new Set(db.profiles().map(p=>p.profileId)).size).toBe(2);
   expect(JSON.stringify(db.profiles())).not.toContain('secret_ref');
  }finally{db.close();}
 });
 it('isolates identical paths by profile and enforces foreign keys',()=>{
  const db=new Storage(':memory:',resolve('packages/storage/schema.sql'));
  try{
   const a=db.saveProfile(profile(),0),b=db.saveProfile(profile(),0);
   const insert=db.db.prepare('INSERT INTO file_cache(id,profile_id,identity_revision,remote_path,cache_object_id,source_size) VALUES (?,?,1,?,?,1)');
   insert.run('a',a.profileId,'/same','a');insert.run('b',b.profileId,'/same','b');
   expect(()=>insert.run('c','unknown','/same','c')).toThrow();
   expect(()=>insert.run('d',a.profileId,'/same','d')).toThrow();
  }finally{db.close();}
 });
});
