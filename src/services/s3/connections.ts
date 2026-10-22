import { HeadBucketCommand,S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import type { HornetEvent,Lease,Profile } from '../../packages/contracts';
import type { Storage } from '../../packages/storage/database';
import { AppError } from '../../packages/core/errors';
import { Challenges } from '../../packages/security/challenges';

interface Session {id:string;owner:string;profile:Profile;client:S3Client;bucket:string;generation:number;leases:Set<string>}
export class S3Connections {
 private items=new Map<string,Session>();private pending=new Set<string>();private stopped=false;
 constructor(private store:Storage,private challenges:Challenges,private emit:(owner:string,event:HornetEvent)=>void,private cachedSecret:(owner:string,profile:Profile)=>Promise<string|undefined>=async()=>undefined){}
 has(id:string){return this.items.has(id);}
 hasLease(id:string){return [...this.items.values()].some(c=>c.leases.has(id));}
 hasProfile(id:string){return [...this.items.values()].some(c=>c.profile.profileId===id)||this.pending.has(id);}
 get(owner:string,id:string){const c=this.items.get(id);if(!c||c.owner!==owner)throw new AppError('IPC005','AWS S3 connection is closed or not owned by this caller.');return c;}
 async acquire(owner:string,profileId:string,signal?:AbortSignal):Promise<Lease>{
  if(this.stopped||signal?.aborted)throw new AppError('IPC006','AWS S3 service is stopping.');
  const profile=this.store.profile(profileId);
  if(!profile.session?.s3)throw new AppError('CAPABILITY_UNAVAILABLE','Choose an AWS S3 connection profile.');
  if(this.items.size+this.pending.size>=32)throw new AppError('FILE_LIMIT','AWS S3 connection limit reached.');
  const existing=[...this.items.values()].find(c=>c.owner===owner&&c.profile.profileId===profileId&&c.profile.revision===profile.revision);
  if(existing){const leaseId=randomUUID();existing.leases.add(leaseId);return {connectionId:existing.id,leaseId,generation:existing.generation};}
  this.pending.add(profileId);let client:S3Client|undefined;
  try{
   const secret=await this.cachedSecret(owner,profile)??await this.challenges.ask(owner,{kind:'password',profileId,title:'AWS S3 secret access key',message:`${profile.username}@${profile.host}`},signal);
   if(!profile.username||!secret)throw new AppError('S3_CREDENTIALS','Enter an AWS access key ID and secret access key.');
   client=new S3Client({region:profile.session.s3Region??'us-east-1',credentials:{accessKeyId:profile.username,secretAccessKey:secret},maxAttempts:2});
   await client.send(new HeadBucketCommand({Bucket:profile.host}),signal?{abortSignal:signal}:undefined);
   if(this.stopped||signal?.aborted)throw new AppError('IPC006','AWS S3 service is stopping.');
   const id=randomUUID(),leaseId=randomUUID();this.items.set(id,{id,owner,profile,client,bucket:profile.host,generation:1,leases:new Set([leaseId])});
   this.emit(owner,{type:'connection.state',connectionId:id,profileId,generation:1,state:'ready'});return {connectionId:id,leaseId,generation:1};
  }catch(error){client?.destroy();if(error instanceof AppError)throw error;throw new AppError('S3_CONNECT','Could not access the S3 bucket. Check the bucket, region, credentials, and IAM permissions.');}
  finally{this.pending.delete(profileId);}
 }
 retain(owner:string,id:string):Lease{const s=this.get(owner,id),leaseId=randomUUID();s.leases.add(leaseId);return {connectionId:id,leaseId,generation:s.generation};}
 release(owner:string,leaseId:string){const s=[...this.items.values()].find(c=>c.leases.has(leaseId));if(!s)return;if(s.owner!==owner)throw new AppError('IPC005','AWS S3 lease is not owned by this caller.');s.leases.delete(leaseId);if(!s.leases.size)this.close(owner,s.id,s.generation);}
 close(owner:string,id:string,generation:number){const s=this.get(owner,id);if(s.generation!==generation)throw new AppError('IPC005','AWS S3 connection generation expired.');this.items.delete(id);s.client.destroy();this.emit(owner,{type:'connection.state',connectionId:id,profileId:s.profile.profileId,generation,state:'closed'});}
 stop(){this.stopped=true;for(const s of [...this.items.values()])this.close(s.owner,s.id,s.generation);}
}
