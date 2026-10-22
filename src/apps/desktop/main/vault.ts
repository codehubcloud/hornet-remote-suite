import { safeStorage } from 'electron';
import { readFileSync,writeFileSync,renameSync,existsSync,mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import type { Profile,ProfileCredential } from '../../../packages/contracts';
import { AppError } from '../../../packages/core/errors';
export class Vault {
  private locked=false;
  private entries:Record<string,string|{identity:string;value:string}>={};
  constructor(private file:string){
    if(existsSync(file)){try{this.entries=JSON.parse(readFileSync(file,'utf8'));}catch{throw new AppError('VAULT_INVALID','凭据文件损坏，已停止加载。');}}
  }
  private available(){return safeStorage.isEncryptionAvailable()&&(process.platform!=='linux'||safeStorage.getSelectedStorageBackend()!=='basic_text');}
  private entry(profile:Profile){const entry=this.entries[profile.profileId+':'+profile.revision];return typeof entry==='string'?entry:entry?.identity===credentialIdentity(profile)?entry.value:undefined;}
  get(profile:Profile){if(this.locked||!this.available())return undefined;const value=this.entry(profile);if(!value)return undefined;try{return safeStorage.decryptString(Buffer.from(value,'base64'));}catch{return undefined;}}
  has(profile:Profile){return !!this.entry(profile);}
  /** Stage only encrypted data before committing SQLite. Caller serializes saves. */
  stageProfile(previous:Profile|undefined,next:Profile,credential:ProfileCredential){
    const prefix=next.profileId+':',key=prefix+next.revision;
    const snapshot=Object.fromEntries(Object.entries(this.entries).filter(([id])=>id.startsWith(prefix)));
    const wasLocked=this.locked;
    let value:string|undefined;
    if(credential.mode==='save'){
      if(next.authType!=='password'||next.protocol==='telnet'||next.protocol==='rlogin')throw new AppError('VAULT_INVALID','此连接不支持保存密码。');
      if(!this.available())throw new AppError('VAULT_UNAVAILABLE','系统安全存储不可用，无法保存密码。');
      value=safeStorage.encryptString(credential.password).toString('base64');
    }else if(credential.mode==='keep'&&previous&&sameCredentialIdentity(previous,next))value=this.entry(previous);
    const restore=()=>{this.locked=wasLocked;for(const id of Object.keys(this.entries))if(id.startsWith(prefix))delete this.entries[id];Object.assign(this.entries,snapshot);};
    for(const id of Object.keys(snapshot))delete this.entries[id];if(value)this.entries[key]={identity:credentialIdentity(next),value};
    if(credential.mode==='save')this.locked=false;
    try{this.flush();}catch(e){restore();throw e;}
    return ()=>{restore();this.flush();};
  }
  save(profile:Profile,secret:string){
    if(!this.available())throw new AppError('VAULT_UNAVAILABLE','系统安全存储不可用，密码仅用于本次连接。');
    this.locked=false;
    this.entries[profile.profileId+':'+profile.revision]={identity:credentialIdentity(profile),value:safeStorage.encryptString(secret).toString('base64')};
    this.flush();
  }
  remove(profileId:string){for(const key of Object.keys(this.entries))if(key.startsWith(profileId+':'))delete this.entries[key];this.flush();}
  lock(){this.locked=true;}
  private flush(){mkdirSync(dirname(this.file),{recursive:true});writeFileSync(this.file+'.tmp',JSON.stringify(this.entries),{mode:0o600});renameSync(this.file+'.tmp',this.file);}
}
function sameCredentialIdentity(a:Profile,b:Profile){return a.profileId===b.profileId&&a.host===b.host&&a.port===b.port&&a.username===b.username&&(a.protocol??'ssh')===(b.protocol??'ssh')&&a.authType===b.authType&&a.ftpSecurity===b.ftpSecurity;}
function credentialIdentity(p:Profile){return createHash('sha256').update(JSON.stringify([p.protocol??'ssh',p.host,p.port,p.username,p.authType,p.ftpSecurity??''])).digest('hex');}
