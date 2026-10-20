import type { Profile,ProfileCredential } from '../../../packages/contracts';
import { AppError } from '../../../packages/core/errors';
import type { Vault } from './vault';

export class ProfileCredentials {
 private queue:Promise<unknown>=Promise.resolve();
 constructor(private vault:Vault,private list:()=>Promise<Profile[]>,private save:(profile:Profile,revision:number)=>Promise<Profile>){}
 revealPassword(profileId:string,expectedRevision:number):Promise<{password:string}>{
  const operation=this.queue.then(async()=>{
   const profile=(await this.list()).find(p=>p.profileId===profileId);
   if(!profile||profile.revision!==expectedRevision)throw new AppError('PROFILE_CONFLICT','配置已被修改，请刷新后重试。');
   const password=this.vault.get(profile);
   if(password===undefined)throw new AppError('VAULT_UNAVAILABLE','无法读取已保存密码，请解锁凭据库或重新输入密码。');
   return {password};
  });
  // Do not retain the decrypted result in the serialization queue.
  this.queue=operation.then(()=>undefined,()=>undefined);return operation;
 }
 saveProfile(profile:Profile,expectedRevision:number,credential:ProfileCredential={mode:'keep'}):Promise<Profile>{
  const operation=this.queue.then(async()=>{
   const previous=(await this.list()).find(p=>p.profileId===profile.profileId);
   if((previous?.revision??0)!==expectedRevision)throw new AppError('PROFILE_CONFLICT','配置已被修改，请刷新后重试。');
   const rollback=this.vault.stageProfile(previous,{...profile,revision:expectedRevision+1},credential);
   try{return await this.save(profile,expectedRevision);}catch(e){rollback();throw e;}
  });
  this.queue=operation.catch(()=>{});return operation;
 }
}
