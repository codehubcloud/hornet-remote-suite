import { Client } from 'basic-ftp';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { checkServerIdentity } from 'node:tls';
import type { HornetEvent,Lease,Profile } from '../../packages/contracts';
import type { Storage } from '../../packages/storage/database';
import { Challenges } from '../../packages/security/challenges';
import { AppError } from '../../packages/core/errors';

interface Session {mode?:'binary'|'text'|'auto';id:string;owner:string;profile:Profile;client:Client;secret:string;generation:number;leases:Set<string>;tail:Promise<unknown>}
export class FtpConnections {
 private items=new Map<string,Session>();
 private pending=new Map<AbortController,string>();
 private stopped=false;
 constructor(private store:Storage,private challenges:Challenges,private emit:(owner:string,event:HornetEvent)=>void,private cachedSecret:(owner:string,profile:Profile)=>Promise<string|undefined>=async()=>undefined){}
 has(id:string){return this.items.has(id);}
 hasLease(id:string){return [...this.items.values()].some(c=>c.leases.has(id));}
 hasProfile(id:string){return [...this.items.values()].some(c=>c.profile.profileId===id)||[...this.pending.values()].includes(id);}
 get(owner:string,id:string){const c=this.items.get(id);if(!c||c.owner!==owner)throw new AppError('IPC005','FTP 连接已关闭或无权访问。');return c;}
 async acquire(owner:string,profileId:string,signal?:AbortSignal):Promise<Lease>{
  if(this.stopped||signal?.aborted)throw new AppError('IPC006','FTP 连接已取消。');
  const profile=this.store.profile(profileId);
  if(profile.protocol!=='ftp')throw new AppError('CAPABILITY_UNAVAILABLE','需要 FTP / FTPS 配置。');
  if(this.items.size+this.pending.size>=32)throw new AppError('FILE_LIMIT','FTP 连接数已达上限。');
  const client=new Client(30000,{allowSeparateTransferHost:false,maxListingBytes:4*1024*1024});
  const controller=new AbortController(),cancel=()=>{controller.abort();client.close();};
  signal?.addEventListener('abort',cancel,{once:true});
  const timer=setTimeout(cancel,110000);this.pending.set(controller,profileId);
  const close=()=>client.close();controller.signal.addEventListener('abort',close,{once:true});
  try{
   const existing=[...this.items.values()].find(c=>c.owner===owner&&c.profile.profileId===profileId&&c.profile.revision===profile.revision&&!c.client.closed);
   const secret=existing?.secret??await this.cachedSecret(owner,profile)??await this.challenges.ask(owner,{kind:'password',profileId,title:'FTP 身份认证',message:profile.username+'@'+profile.host},controller.signal);
   if(controller.signal.aborted)throw new AppError('IPC006','FTP 连接已取消。');
   if(/[\r\n\0]/.test(secret))throw new AppError('IPC002','FTP 密码不能包含换行或空字符。');
   const secure=profile.ftpSecurity!=='none';
   await client.access({host:profile.host,port:profile.port,user:profile.username,password:secret,secure:secure?(profile.ftpSecurity==='implicit'?'implicit':true):false,
    secureOptions:{rejectUnauthorized:true,minVersion:'TLSv1.2',servername:isIP(profile.host)?undefined:profile.host,checkServerIdentity:(_name,cert)=>checkServerIdentity(profile.host,cert)}});
   // The library tolerates rejected PROT/PBSZ commands. This application must not.
   if(secure){await client.send('PBSZ 0');await client.send('PROT P');}
   if(controller.signal.aborted||this.stopped)throw new AppError('IPC006','FTP 连接已取消。');
   const id=randomUUID(),leaseId=randomUUID();
   this.items.set(id,{id,owner,profile,client,secret,generation:1,leases:new Set([leaseId]),tail:Promise.resolve()});
   this.emit(owner,{type:'connection.state',connectionId:id,profileId,generation:1,state:'ready'});
   return {connectionId:id,leaseId,generation:1};
  }catch(error){client.close();if(error instanceof AppError)throw error;throw new AppError('FTP_CONNECT','FTP 连接失败，请检查地址、凭据及 FTPS 证书；加密连接不会退回明文。');}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);controller.signal.removeEventListener('abort',close);this.pending.delete(controller);}
 }
 async use<T>(owner:string,id:string,action:(client:Client)=>Promise<T>):Promise<T>{
  const session=this.get(owner,id);
  const next=session.tail.then(()=>{this.get(owner,id);if(session.client.closed)throw new AppError('FTP_CLOSED','FTP 连接已断开，请重新打开会话。');return action(session.client);});
  session.tail=next.catch(()=>{});return next;
 }
 async configure(owner:string,id:string,mode?:'binary'|'text'|'auto'){const session=this.get(owner,id);if(mode)session.mode=mode;return session.mode??'binary';}
 async command(owner:string,id:string,command:string){
  if(!/^[A-Za-z]{3,5}(?: [^\r\n\x00]{0,2000})?$/.test(command))throw new AppError('IPC002','FTP 命令格式无效。');
  // Commands which change authentication, TLS, data endpoints or transfer state
  // cannot be mixed into a managed client. Actual file operations have dedicated APIs.
  if(!/^(NOOP|SYST|FEAT|HELP|STAT|PWD|SITE|CWD|CDUP|MKD|RMD|DELE)(?: |$)/i.test(command))throw new AppError('IPC002','此命令会改变连接或传输状态，请使用对应菜单。');
  return this.use(owner,id,async client=>(await client.send(command)).message);
 }
 release(owner:string,id:string){const session=[...this.items.values()].find(c=>c.leases.has(id));if(!session)return;if(session.owner!==owner)throw new AppError('IPC005','无权释放此连接。');session.leases.delete(id);if(!session.leases.size)this.close(owner,session.id,session.generation);}
 close(owner:string,id:string,generation:number){const session=this.get(owner,id);if(session.generation!==generation)throw new AppError('IPC005','连接版本已失效。');this.items.delete(id);session.secret='';session.client.close();this.emit(owner,{type:'connection.state',connectionId:id,profileId:session.profile.profileId,generation,state:'closed'});}
 stop(){this.stopped=true;for(const controller of this.pending.keys())controller.abort();for(const session of [...this.items.values()])this.close(session.owner,session.id,session.generation);}
}
