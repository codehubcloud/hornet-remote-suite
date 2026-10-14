import { describe,it,expect } from 'vitest';
import { randomUUID,createHash } from 'node:crypto';
import { mkdtemp,readFile,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { Storage } from '../../packages/storage/database';
import { profileSchema,schemas } from '../../packages/contracts';
import { Connections } from '../../services/ssh/connections';
import { Challenges } from '../../packages/security/challenges';
const profile=()=>({profileId:randomUUID(),name:'server',host:'localhost',port:22,username:'tester',group:'test',authType:'password' as const,revision:0});
describe('persistent model and untrusted input',()=>{
 it('opens LF/CRLF schema variants and migrates only legacy line-ending checksums without losing profiles',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'hornet-schema-'));
  const schema=(await readFile('packages/storage/schema.sql','utf8')).replace(/\r\n/g,'\n');
  const canonical=createHash('sha256').update(schema).digest('hex');
  const windows=createHash('sha256').update(schema.replace(/\n/g,'\r\n')).digest('hex');
  try{
   for(const eol of ['lf','crlf']) for(const oldChecksum of [canonical,windows]){
    const schemaPath=join(directory,'schema-'+eol+'.sql'),dbPath=join(directory,eol+'-'+oldChecksum+'.db');
    await writeFile(schemaPath,eol==='lf'?schema:schema.replace(/\n/g,'\r\n'));
    let db=new Storage(dbPath,schemaPath);
    const saved=db.saveProfile(profile(),0);
    db.db.prepare('UPDATE schema_migration SET checksum=? WHERE version=1').run(oldChecksum);db.close();
    db=new Storage(dbPath,schemaPath);
    expect(db.profile(saved.profileId)).toEqual(saved);
    expect(db.db.prepare('SELECT checksum FROM schema_migration WHERE version=1').get()!.checksum).toBe(canonical);
    expect(db.db.prepare('PRAGMA user_version').get()!.user_version).toBe(1);
    db.db.prepare('UPDATE schema_migration SET checksum=? WHERE version=1').run('0'.repeat(64));db.close();
    expect(()=>new Storage(dbPath,schemaPath)).toThrow('数据库版本不兼容');
   }
  }finally{await rm(directory,{recursive:true,force:true});}
 });
 it('validates jump references, prevents dangling routes and remaps imported chains atomically',()=>{
  const db=new Storage(':memory:',resolve('packages/storage/schema.sql'));
  try{
   const hop=db.saveProfile(profile(),0),destination=db.saveProfile({...profile(),group:'target',jumpProfileIds:[hop.profileId]},0);
   expect(db.profile(destination.profileId).jumpProfileIds).toEqual([hop.profileId]);
   expect(()=>db.deleteProfile(hop.profileId,hop.revision)).toThrow('跳板');expect(()=>db.removeGroup('test',[hop])).toThrow('跳板');
   expect(()=>db.saveProfile({...hop,protocol:'telnet'},hop.revision)).toThrow('直连 SSH');expect(db.profile(hop.profileId).protocol).toBeUndefined();
   expect(()=>db.importProfiles([destination])).toThrow('缺少跳板');expect(db.profiles()).toHaveLength(2);
   db.importProfiles([destination,hop]);const copied=db.profiles().find(p=>p.profileId!==destination.profileId&&p.jumpProfileIds?.length)!;
   expect(copied.jumpProfileIds).not.toContain(hop.profileId);expect(db.profile(copied.jumpProfileIds![0]).name).toBe(hop.name);
   expect(()=>db.saveProfile({...profile(),jumpProfileIds:[randomUUID()]},0)).toThrow();expect(db.profiles()).toHaveLength(4);
  }finally{db.close();}
 });
 it('round-trips session descriptions without changing the schema or trusting client timestamps',()=>{
  const db=new Storage(':memory:',resolve('packages/storage/schema.sql'));
  try{
   const before=Date.now(),legacy=db.saveProfile(profile(),0);
   expect(legacy.updatedAt).toBeGreaterThanOrEqual(before);expect(legacy.description).toBeUndefined();
   db.db.prepare('UPDATE connection_profile SET options_json=? WHERE id=?').run(JSON.stringify({other:'preserved'}),legacy.profileId);
   const saved=db.saveProfile({...legacy,description:'生产服务器',updatedAt:1},legacy.revision);
   expect(saved.updatedAt).toBeGreaterThanOrEqual(before);expect(db.profile(saved.profileId)).toEqual(saved);
   expect(JSON.parse(String(db.db.prepare('SELECT options_json FROM connection_profile WHERE id=?').get(saved.profileId)!.options_json))).toEqual({other:'preserved',encoding:'utf8',description:'生产服务器',jumpProfileIds:[]});
   expect(db.importProfiles([saved])).toBe(1);expect(db.profiles().every(p=>p.description==='生产服务器')).toBe(true);
   const cleared=db.saveProfile({...saved,description:''},saved.revision);expect(db.profile(cleared.profileId).description).toBeUndefined();
   expect(db.db.prepare('PRAGMA user_version').get()!.user_version).toBe(1);
  }finally{db.close();}
 });
 it('persists Telnet protocol edits/imports and blocks SSH authentication for Telnet profiles',async()=>{
  const db=new Storage(':memory:',resolve('packages/storage/schema.sql'));let asked=false;
  const challenges=new Challenges(()=>{asked=true;}),connections=new Connections(db,challenges,()=>{},async()=>{asked=true;return 'must-not-use';});
  try{
   const ssh=db.saveProfile(profile(),0);
   const telnet=db.saveProfile({...ssh,protocol:'telnet',port:23,username:''},ssh.revision);
   expect(db.profile(telnet.profileId)).toEqual(telnet);expect(db.importProfiles([telnet])).toBe(1);expect(db.profiles().every(p=>p.protocol==='telnet')).toBe(true);
   await expect(connections.acquire('a',telnet.profileId)).rejects.toThrow('需要 SSH');await expect(connections.acquireIsolated('a',telnet.profileId)).rejects.toThrow('需要 SSH');expect(asked).toBe(false);
   expect(()=>db.saveProfile({...telnet,protocol:'ssh'},telnet.revision)).toThrow();
   db.saveProfile({...telnet,protocol:'ssh',username:'tester'},telnet.revision);expect(db.profile(telnet.profileId).protocol??'ssh').toBe('ssh');
  }finally{await connections.stop();db.close();}
 });
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
