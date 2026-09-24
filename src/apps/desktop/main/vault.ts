import { safeStorage } from 'electron';
import { readFileSync,writeFileSync,renameSync,existsSync,mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Profile } from '../../../packages/contracts';
import { AppError } from '../../../packages/core/errors';
export class Vault {
  private locked=false;
  private entries:Record<string,string>={};
  constructor(private file:string){
    if(existsSync(file)){try{this.entries=JSON.parse(readFileSync(file,'utf8'));}catch{throw new AppError('VAULT_INVALID','凭据文件损坏，已停止加载。');}}
  }
  private available(){return safeStorage.isEncryptionAvailable()&&(process.platform!=='linux'||safeStorage.getSelectedStorageBackend()!=='basic_text');}
  get(profile:Profile){if(this.locked||!this.available())return undefined;const value=this.entries[profile.profileId+':'+profile.revision];if(!value)return undefined;try{return safeStorage.decryptString(Buffer.from(value,'base64'));}catch{return undefined;}}
  save(profile:Profile,secret:string){
    if(!this.available())throw new AppError('VAULT_UNAVAILABLE','系统安全存储不可用，密码仅用于本次连接。');
    this.locked=false;
    this.entries[profile.profileId+':'+profile.revision]=safeStorage.encryptString(secret).toString('base64');
    this.flush();
  }
  remove(profileId:string){for(const key of Object.keys(this.entries))if(key.startsWith(profileId+':'))delete this.entries[key];this.flush();}
  lock(){this.locked=true;}
  private flush(){mkdirSync(dirname(this.file),{recursive:true});writeFileSync(this.file+'.tmp',JSON.stringify(this.entries),{mode:0o600});renameSync(this.file+'.tmp',this.file);}
}
