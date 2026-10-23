import { afterEach,expect,it,vi } from 'vitest';
import { mkdtempSync,readFileSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { utils } from 'ssh2';
import { IdentityStore } from '../../apps/desktop/main/identity-store';
import type { Profile } from '../../packages/contracts';
import { resolve } from 'node:path';
import { sshFixture } from '../fixtures/ssh-server';
import { Storage } from '../../packages/storage/database';
import { Connections } from '../../services/ssh/connections';
import { Challenges } from '../../packages/security/challenges';
vi.mock('electron',()=>({safeStorage:{isEncryptionAvailable:vi.fn(()=>true),getSelectedStorageBackend:vi.fn(()=>'test-keyring'),encryptString:vi.fn((text:string)=>Buffer.from(text).map(byte=>byte^0xa5)),decryptString:vi.fn((bytes:Buffer)=>Buffer.from(bytes).map(byte=>byte^0xa5).toString())}}));
const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(){const root=mkdtempSync(join(tmpdir(),'hornet-keys-'));roots.push(root);const file=join(root,'identities.json');return {file,store:new IdentityStore(file)};}
it('generates usable passphrase-protected keys, stores only ciphertext and exports metadata without the private key',async()=>{
 const {store,file}=fixture(),key=await store.generate('fixture','ed25519','test-passphrase');
 const privateKey=store.privateKey(key.id)!;expect(utils.parseKey(privateKey)).toBeInstanceOf(Error);expect(utils.parseKey(privateKey,'test-passphrase')).not.toBeInstanceOf(Error);
 expect(key).not.toHaveProperty('ciphertext');expect(key.publicKey).toMatch(/^ssh-ed25519 /);expect(readFileSync(file,'utf8')).not.toContain(privateKey);expect(readFileSync(file,'utf8')).not.toContain('test-passphrase');
 expect(new IdentityStore(file).privateKey(key.id)).toBe(privateKey);store.lock();expect(store.privateKey(key.id)).toBeUndefined();expect(store.privateKey(key.id,true)).toBe(privateKey);
});
it('keeps reusable identity passwords encrypted, preserves untouched secrets and isolates authentication modes',async()=>{
 const {store,file}=fixture(),id=randomUUID(),identity={id,name:'login',username:'tester',authType:'password' as const};
 const saved=store.saveIdentity(identity,'secret-token');expect(saved.hasPassword).toBe(true);expect(saved).not.toHaveProperty('ciphertext');expect(readFileSync(file,'utf8')).not.toContain('secret-token');
 const profile:Profile={profileId:randomUUID(),name:'session',host:'localhost',port:22,username:'tester',group:'',authType:'password',revision:1,session:{identityId:id}};
 expect(store.secret(profile)).toBe('secret-token');store.saveIdentity({...identity,name:'renamed'});expect(store.secret(profile)).toBe('secret-token');expect(store.secret({...profile,username:'other'})).toBeUndefined();
 store.lock();expect(store.secret(profile)).toBeUndefined();expect(store.revealPassword(id)).toBe('secret-token');
 store.saveIdentity(identity,undefined,true);expect(store.revealPassword(id)).toBe('');
});
it('imports private keys and refuses deleting keys referenced by reusable identities',async()=>{
 const {store}=fixture(),key=await store.generate('fixture','ed25519',''),raw=store.privateKey(key.id)!;const imported=store.importKey('imported',raw);
 expect(imported.fingerprint).toBe(key.fingerprint);const identity={id:randomUUID(),name:'key-login',username:'tester',authType:'privateKey' as const,keyId:key.id};store.saveIdentity(identity);
 expect(()=>store.removeKey(key.id)).toThrow('身份验证配置');store.removeIdentity(identity.id);store.removeKey(key.id);expect(store.keys().some(value=>value.id===key.id)).toBe(false);
});
it('authenticates against an SSH server with an encrypted managed private key and verifies its signature',async()=>{
 const {store,file}=fixture(),key=await store.generate('login','ed25519','fixture-passphrase'),server=await sshFixture({authorizedKey:key.publicKey});
 const db=new Storage(resolve(file,'..','test.db'),resolve('packages/storage/schema.sql'));
 const profile=db.saveProfile({profileId:randomUUID(),name:'managed',host:'127.0.0.1',port:server.port,username:'tester',authType:'privateKey',group:'',revision:0,session:{keyId:key.id}},0);
 const seen:string[]=[];const challenges=new Challenges((owner,event)=>{if(event.type==='challenge'){seen.push(event.kind);queueMicrotask(()=>challenges.respond(owner,event.challengeId,event.kind==='trust'?'accept':'fixture-passphrase',event.kind==='trust'));}});
 const connections=new Connections(db,challenges,()=>{},async(_owner,profile)=>store.secret(profile));
 try{const lease=await connections.acquire('a',profile.profileId);expect(lease.connectionId).toBeTruthy();expect(server.authCount).toBe(1);expect(seen).not.toContain('privateKey');expect(seen).toContain('passphrase');}finally{await connections.stop();db.close();await server.close();}
});
