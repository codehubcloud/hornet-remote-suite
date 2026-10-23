import { safeStorage } from 'electron';
import { utils } from 'ssh2';
import { randomUUID,createHash } from 'node:crypto';
import { readFileSync,writeFileSync,renameSync,existsSync,mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { AppError } from '../../../packages/core/errors';
import { identitySchema,type IdentityConfig,type ManagedKey } from '../../../packages/contracts/identities';
import type { Profile } from '../../../packages/contracts';
const keySchema=z.object({id:z.string().uuid(),name:z.string().min(1).max(80),algorithm:z.string(),fingerprint:z.string(),publicKey:z.string(),createdAt:z.number(),passphraseProtected:z.boolean(),ciphertext:z.string()}).strict();
const configSchema=z.object({identity:identitySchema,ciphertext:z.string().optional()}).strict();
const storeSchema=z.object({keys:z.array(keySchema).max(100),identities:z.array(configSchema).max(100)}).strict();
type Store=z.infer<typeof storeSchema>;
export class IdentityStore {
 private value:Store={keys:[],identities:[]};private locked=false;
 constructor(private file:string){if(existsSync(file))this.value=storeSchema.parse(JSON.parse(readFileSync(file,'utf8')));}
 private encrypt(text:string){if(!safeStorage.isEncryptionAvailable()||process.platform==='linux'&&safeStorage.getSelectedStorageBackend()==='basic_text')throw new AppError('VAULT_UNAVAILABLE','系统安全存储不可用。');return safeStorage.encryptString(text).toString('base64');}
 private decrypt(text:string){return safeStorage.decryptString(Buffer.from(text,'base64'));}
 private commit(next:Store){storeSchema.parse(next);mkdirSync(dirname(this.file),{recursive:true,mode:0o700});writeFileSync(this.file+'.tmp',JSON.stringify(next),{mode:0o600});renameSync(this.file+'.tmp',this.file);this.value=next;}
 keys():ManagedKey[]{return this.value.keys.map(({ciphertext,...metadata})=>metadata);}
 identities():IdentityConfig[]{return this.value.identities.map(entry=>({...entry.identity,hasPassword:!!entry.ciphertext}));}
 importKey(name:string,key:string,passphrase=''){
  if(this.value.keys.length>=100)throw new AppError('FILE_LIMIT','最多保存 100 个用户密钥。');
  z.string().trim().min(1).max(80).parse(name);z.string().max(65536).parse(key);
  const parsed=utils.parseKey(key,passphrase);if(parsed instanceof Error||Array.isArray(parsed)||!parsed.isPrivateKey())throw new AppError('KEY_INVALID','无法解析私钥，请检查格式和口令。');
  const publicBytes=parsed.getPublicSSH(),metadata:ManagedKey={id:randomUUID(),name,algorithm:parsed.type,fingerprint:'SHA256:'+createHash('sha256').update(publicBytes).digest('base64').replace(/=+$/,''),publicKey:parsed.type+' '+publicBytes.toString('base64')+' '+name.replace(/[\r\n]/g,''),createdAt:Date.now(),passphraseProtected:utils.parseKey(key) instanceof Error};
  const ciphertext=this.encrypt(key);this.commit({...this.value,keys:[...this.value.keys,{...metadata,ciphertext}]});return metadata;
 }
 async generate(name:string,algorithm:'ed25519'|'rsa'|'ecdsa',passphrase:string){
  const keys=await new Promise<{private:string;public:string}>((resolve,reject)=>{
   const callback=(error:Error|null,value:{private:string;public:string})=>error?reject(error):resolve(value);
   const options={comment:name,...(passphrase?{passphrase,cipher:'aes256-cbc' as const}:{})};
   if(algorithm==='rsa')utils.generateKeyPair('rsa',{...options,bits:3072},callback);
   else if(algorithm==='ecdsa')utils.generateKeyPair('ecdsa',{...options,bits:256},callback);
   else utils.generateKeyPair('ed25519',options,callback);
  });return this.importKey(name,keys.private,passphrase);
 }
 privateKey(id:string,explicit=false){if(this.locked&&!explicit)return undefined;const key=this.value.keys.find(entry=>entry.id===id);return key?this.decrypt(key.ciphertext):undefined;}
 removeKey(id:string){if(this.value.identities.some(entry=>entry.identity.keyId===id))throw new AppError('KEY_IN_USE','密钥正在被身份验证配置使用，请先修改对应配置。');this.commit({...this.value,keys:this.value.keys.filter(key=>key.id!==id)});}
 saveIdentity(input:unknown,password?:string,clearPassword=false){
  const identity=identitySchema.parse(input),previous=this.value.identities.find(entry=>entry.identity.id===identity.id);
  if(identity.authType==='privateKey'&&!this.value.keys.some(key=>key.id===identity.keyId))throw new AppError('KEY_INVALID','所选密钥不存在。');
  let ciphertext=identity.authType==='password'&&!clearPassword?previous?.ciphertext:undefined;
  if(identity.authType==='password'&&password!==undefined&&password!=='')ciphertext=this.encrypt(z.string().max(16384).parse(password));
  const entry={identity,ciphertext},next=[...this.value.identities.filter(value=>value.identity.id!==identity.id),entry];
  if(next.length>100)throw new AppError('FILE_LIMIT','最多保存 100 个身份验证配置。');this.commit({...this.value,identities:next});return {...identity,hasPassword:!!ciphertext};
 }
 removeIdentity(id:string){this.commit({...this.value,identities:this.value.identities.filter(entry=>entry.identity.id!==id)});}
 revealPassword(id:string){const entry=this.value.identities.find(entry=>entry.identity.id===id);return entry?.ciphertext?this.decrypt(entry.ciphertext):'';}
 secret(profile:Profile){
  if(this.locked)return undefined;
    try{
  const config=this.value.identities.find(entry=>entry.identity.id===profile.session?.identityId);
  if(config&&config.identity.username===profile.username&&config.identity.authType===profile.authType){if(profile.authType==='privateKey')return this.privateKey(config.identity.keyId!);if(profile.authType==='password'&&config.ciphertext)return this.decrypt(config.ciphertext);}
  if(profile.authType==='privateKey'&&profile.session?.keyId)return this.privateKey(profile.session.keyId);
    return undefined;
    }catch{return undefined;}
 }
 lock(){this.locked=true;}
}
