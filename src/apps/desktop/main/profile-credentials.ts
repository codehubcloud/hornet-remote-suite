import type { Profile,ProfileCredential } from '../../../packages/contracts';
import { AppError } from '../../../packages/core/errors';
import type { Vault } from './vault';

export class ProfileCredentials {
 private queue:Promise<unknown>=Promise.resolve();
 constructor(private vault:Vault,private list:()=>Promise<Profile[]>,private save:(profile:Profile,revision:number)=>Promise<Profile>){}
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
