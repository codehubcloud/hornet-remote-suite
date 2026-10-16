import { afterEach,it,expect,vi } from 'vitest';
import { mkdtempSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../../apps/desktop/main/vault';
import { ProfileCredentials } from '../../apps/desktop/main/profile-credentials';
import { profileSchema,type Profile } from '../../packages/contracts';
vi.mock('electron',()=>({safeStorage:{isEncryptionAvailable:vi.fn(()=>true),getSelectedStorageBackend:vi.fn(()=>'test-keyring'),encryptString:vi.fn((text:string)=>Buffer.from(text).map(byte=>byte^0xa5)),decryptString:vi.fn((bytes:Buffer)=>Buffer.from(bytes).map(byte=>byte^0xa5).toString())}}));
import { safeStorage } from 'electron';
const roots:string[]=[];
afterEach(()=>{vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'hornet-credential-'));roots.push(root);const file=join(root,'vault.json'),vault=new Vault(file);
 let saved:Profile|undefined;const save=vi.fn(async(profile:Profile,revision:number)=>saved={...profile,revision:revision+1});
 const manager=new ProfileCredentials(vault,async()=>saved?[saved]:[],save);
 const profile:Profile={profileId:'22222222-2222-4222-8222-222222222222',name:'Test',host:'localhost',port:22,username:'alice',group:'',authType:'password',revision:0};
 return {file,vault,manager,profile,save};
}
it('saves encrypted passwords separately from profiles, survives restart and keeps a password on cosmetic edits',async()=>{
 const h=fixture(),saved=await h.manager.saveProfile(h.profile,0,{mode:'save',password:'private-password'});
 expect(saved.username).toBe('alice');expect(saved).not.toHaveProperty('password');expect(readFileSync(h.file,'utf8')).not.toContain('private-password');
 expect(new Vault(h.file).get(saved)).toBe('private-password');
 const renamed=await h.manager.saveProfile({...saved,name:'Renamed'},1);expect(h.vault.get(renamed)).toBe('private-password');expect(h.vault.get(saved)).toBeUndefined();
 const changed=await h.manager.saveProfile({...renamed,username:'bob'},2);expect(h.vault.has(changed)).toBe(false);
 expect(()=>profileSchema.parse({...saved,password:'must-not-export'})).toThrow();
});
it('does not create a profile when secure storage is unavailable and rolls credentials back on backend failure',async()=>{
 const h=fixture();vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);
 await expect(h.manager.saveProfile(h.profile,0,{mode:'save',password:'secret'})).rejects.toThrow('系统安全存储不可用');expect(h.save).not.toHaveBeenCalled();
 vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);const saved=await h.manager.saveProfile(h.profile,0,{mode:'save',password:'original'});
 h.save.mockRejectedValueOnce(new Error('PROFILE_BUSY'));
 await expect(h.manager.saveProfile({...saved,name:'Blocked'},1,{mode:'save',password:'replacement'})).rejects.toThrow('PROFILE_BUSY');
 expect(h.vault.get(saved)).toBe('original');expect(new Vault(h.file).get(saved)).toBe('original');
 const removed=await h.manager.saveProfile(saved,1,{mode:'remove'});expect(h.vault.has(removed)).toBe(false);expect(Object.keys(JSON.parse(readFileSync(h.file,'utf8')))).toEqual([]);
});
it('serializes competing saves and retains a locked credential across safe edits without unlocking it',async()=>{
 const h=fixture(),saved=await h.manager.saveProfile(h.profile,0,{mode:'save',password:'original'});h.vault.lock();
 const results=await Promise.allSettled([h.manager.saveProfile({...saved,name:'First'},1),h.manager.saveProfile({...saved,name:'Second'},1,{mode:'remove'})]);
 expect(results.map(r=>r.status)).toEqual(['fulfilled','rejected']);if(results[0].status!=='fulfilled')throw new Error('save failed');
 expect(h.vault.has(results[0].value)).toBe(true);expect(h.vault.get(results[0].value)).toBeUndefined();expect(new Vault(h.file).get(results[0].value)).toBe('original');
});
it('binds staged credentials to the endpoint and accepts legacy encrypted entries',async()=>{
 const h=fixture(),saved=await h.manager.saveProfile(h.profile,0,{mode:'save',password:'original'});
 const next={...saved,revision:2,host:'candidate'},rollback=h.vault.stageProfile(saved,next,{mode:'save',password:'candidate-password'});
 const restored=new Vault(h.file);expect(restored.get(next)).toBe('candidate-password');expect(restored.get({...next,host:'another-host'})).toBeUndefined();rollback();
 const entries=JSON.parse(readFileSync(h.file,'utf8'));entries[saved.profileId+':1']=entries[saved.profileId+':1'].value;
 const {writeFileSync}=await import('node:fs');writeFileSync(h.file,JSON.stringify(entries));expect(new Vault(h.file).get(saved)).toBe('original');
});
