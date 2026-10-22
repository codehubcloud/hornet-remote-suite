import { describe,it,expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Storage } from '../../packages/storage/database';
import { sameTransport } from '../../packages/core/profile-settings';
import { profileSchema } from '../../packages/contracts';
import { readQuickLibrary,quickLibrarySchema } from '../../apps/desktop/renderer/quick-commands-store';
import { quickCommandAppearanceSchema,quickCommandStyle,commandTextColor } from '../../apps/desktop/renderer/quick-command-appearance';

describe('session settings and quick command migration',()=>{
 const profile=()=>profileSchema.parse({profileId:randomUUID(),name:'server',host:'localhost',port:22,username:'tester',group:'test',authType:'password',revision:0});
 it('round-trips settings through save/import and clears removed overrides without discarding unrelated options',()=>{
  const db=new Storage(':memory:',resolve('packages/storage/schema.sql'));
  try{
   const first=db.saveProfile({...profile(),session:{appearance:{fontSize:18,theme:'nord'},terminal:{type:'vt100',backspace:'bs'},keepAlive:{intervalSeconds:5,maxMissed:1},remoteDirectory:'/tmp'}},0);
   expect(db.profile(first.profileId)).toEqual(first);db.importProfiles([first]);expect(db.profiles().every(p=>p.session?.terminal?.type==='vt100')).toBe(true);
   db.db.prepare("UPDATE connection_profile SET options_json=json_set(options_json,'$.unrelated',42) WHERE id=?").run(first.profileId);
   const next=db.saveProfile({...first,session:{appearance:{fontSize:20}}},first.revision);expect(db.profile(next.profileId).session).toEqual({appearance:{fontSize:20}});
   const cleared=db.saveProfile({...next,session:undefined},next.revision);expect(db.profile(cleared.profileId).session).toBeUndefined();expect(JSON.parse(String(db.db.prepare('SELECT options_json FROM connection_profile WHERE id=?').get(first.profileId)!.options_json)).unrelated).toBe(42);
   expect(db.db.prepare('PRAGMA user_version').get()!.user_version).toBe(2);
  }finally{db.close();}
 });
 it('allows active session styling while preserving transport identity and strict option boundaries',()=>{
  const p=profile();expect(sameTransport(p,{...p,session:{appearance:{fontSize:18}},name:'renamed'})).toBe(true);
  for(const edit of [{host:'other'},{port:23},{username:'other'},{authType:'agent' as const},{protocol:'telnet' as const},{jumpProfileIds:[randomUUID()]}])expect(sameTransport(p,{...p,...edit})).toBe(false);
  for(const session of [{remoteDirectory:'/tmp\0bad'},{keepAlive:{intervalSeconds:0,maxMissed:1}},{appearance:{password:'secret'}},{reconnect:{enabled:true,intervalSeconds:1,limitMinutes:-1}}])expect(()=>profileSchema.parse({...p,session})).toThrow();
 });
 it('persists Mosh as an SSH-backed terminal option without accepting unknown fields',()=>{
  const db=new Storage(':memory:',resolve('packages/storage/schema.sql'));
  try{const saved=db.saveProfile({...profile(),session:{mosh:true}},0);expect(db.profile(saved.profileId).session?.mosh).toBe(true);expect(()=>profileSchema.parse({...saved,session:{mosh:true,arbitrary:'value'}})).toThrow();}
  finally{db.close();}
 });
 it('validates AWS S3 as an isolated file-only SSH-backed profile option',()=>{
  const p=profile(),s3=profileSchema.parse({...p,host:'example-bucket',port:443,username:'AKIAEXAMPLE',session:{s3:true,s3Region:'us-east-1'}});
  expect(s3.session?.s3).toBe(true);expect(sameTransport(s3,{...s3,session:{...s3.session,s3Region:'eu-west-1'}})).toBe(false);
  expect(()=>profileSchema.parse({...s3,jumpProfileIds:[randomUUID()]})).toThrow();
  expect(()=>profileSchema.parse({...s3,authType:'agent'})).toThrow();
  expect(()=>profileSchema.parse({...s3,port:22})).toThrow();
  expect(()=>profileSchema.parse({...s3,host:'Invalid_Bucket'})).toThrow();
 });
 it('keeps old commands intact, preserves ordering and rejects dangling or ambiguous imported sets',()=>{
  const old=[{id:randomUUID(),name:'A',text:'pwd'},{id:randomUUID(),name:'B',text:'ls'}],library=readQuickLibrary(null,JSON.stringify(old));
  expect(library.commands).toEqual(old);expect(library.sets).toEqual([{id:'default',name:'默认命令集'}]);expect(readQuickLibrary(JSON.stringify(library),null)).toEqual(library);
  expect(()=>quickLibrarySchema.parse({...library,commands:[{...old[0],setId:'missing'}]})).toThrow();expect(()=>quickLibrarySchema.parse({...library,commands:[old[0],old[0]]})).toThrow();expect(()=>quickLibrarySchema.parse({...library,commands:[{...old[0],text:'\x1b[31m'}]})).toThrow();
  expect(quickLibrarySchema.parse({...library,commands:[{...old[0],enter:false,description:'Insert without executing'}]}).commands[0].enter).toBe(false);
 });
 it('round-trips individual command colors and rejects imported CSS or unsupported style fields',()=>{
  const library=readQuickLibrary(null,JSON.stringify([{id:randomUUID(),name:'Default',text:'pwd'}]));expect(quickCommandStyle(library.commands[0].appearance)).toBeUndefined();
  const styles=[{kind:'solid' as const,color:'#dc2626'},{kind:'linear' as const,from:'#2563eb',to:'#7c3aed',angle:90,textColor:'#ffffff'},{kind:'radial' as const,from:'#ffffff',to:'#e2e8f0'}];
  for(const appearance of styles){const data={...library,commands:[{...library.commands[0],appearance}]};expect(readQuickLibrary(JSON.stringify(data),null).commands[0].appearance).toEqual(appearance);}
  for(const appearance of [{kind:'solid',color:'url(https://invalid.example/image)'},{kind:'linear',from:'#ffffff',to:'#000000',angle:361},{kind:'radial',from:'#ffffff',to:'#000000',backgroundImage:'url(x)'},{kind:'solid',color:'#ffffff',textColor:'red; display:none'}])expect(()=>quickCommandAppearanceSchema.parse(appearance)).toThrow();
  expect(commandTextColor({kind:'solid',color:'#ffffff'})).toBe('#111827');expect(commandTextColor({kind:'solid',color:'#000000'})).toBe('#ffffff');
  expect(quickCommandStyle(styles[1])?.backgroundImage).toContain('linear-gradient(90deg');expect(quickCommandStyle(styles[2])?.backgroundImage).toContain('radial-gradient');
 });
});
