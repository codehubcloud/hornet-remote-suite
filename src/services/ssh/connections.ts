import { Client, type SFTPWrapper,type ClientChannel } from 'ssh2';
import { randomUUID, createHash } from 'node:crypto';
import type { Storage } from '../../packages/storage/database';
import type { Profile, HornetEvent, Lease } from '../../packages/contracts';
import { AppError } from '../../packages/core/errors';
import { Challenges } from '../../packages/security/challenges';

interface Connection {
  upstream?:Lease;socket?:ClientChannel;
  isolated?:boolean;
  id:string; owner:string; profile:Profile; client:Client; generation:number;
  leases:Set<string>; sftp?:Promise<SFTPWrapper>; idle?:ReturnType<typeof setTimeout>;
}
export class Connections {
  private items=new Map<string,Connection>();
  private opening=new Map<string,Promise<Connection>>();
  private leases=new Map<string,{owner:string;connectionId:string}>();
  private stopped=false;
  private routingProfiles=new Map<string,number>();
  private reservedHops=0;
  private controllers=new Map<AbortController,string>();
  constructor(private store:Storage,public challenges:Challenges,private emit:(owner:string,event:HornetEvent)=>void, private cachedSecret:(owner:string,profile:Profile)=>Promise<string|undefined> = async()=>undefined, private idleMs=60000,private connectTimeoutMs=110000) {}
  private key(owner:string,p:Profile) { return owner+':'+p.profileId+':'+p.revision; }
  async acquire(owner:string,profileId:string):Promise<Lease> {
    if(this.stopped) throw new AppError('IPC006','服务正在停止。');
    const p=this.store.profile(profileId), key=this.key(owner,p);
    let c=[...this.items.values()].find(v=>!v.isolated&&this.key(v.owner,v.profile)===key);
    if(!c) {
      let pending=this.opening.get(key);
      if(!pending) {
        if(this.items.size+this.opening.size>=32) throw new AppError('SSH004','连接数已达上限。');
        pending=this.connect(owner,p);this.opening.set(key,pending);
        void pending.finally(()=>this.opening.delete(key)).catch(()=>{});
      }
      c=await pending;
    }
    return this.retain(owner,c.id);
  }
  async acquireIsolated(owner:string,profileId:string):Promise<Lease>{
    if(this.stopped)throw new AppError('IPC006','服务正在停止。');
    if(this.items.size+this.opening.size>=32)throw new AppError('SSH004','连接数已达上限。');
    const profile=this.store.profile(profileId),key=this.key(owner,profile)+':x11:'+randomUUID();
    const pending=this.connect(owner,profile,true);this.opening.set(key,pending);
    try{const connection=await pending;return this.retain(owner,connection.id);}finally{this.opening.delete(key);}
  }
  retain(owner:string,id:string):Lease {
    const c=this.get(owner,id);
    if(c.leases.size>=32) throw new AppError('SSH004','连接资源数已达上限。');
    clearTimeout(c.idle); const leaseId=randomUUID();
    c.leases.add(leaseId);this.leases.set(leaseId,{owner,connectionId:id});
    return {connectionId:id,leaseId,generation:c.generation};
  }
  get(owner:string,id:string):Connection {
    const c=this.items.get(id);if(!c||c.owner!==owner) throw new AppError('SSH006','连接已断开或无权访问。');return c;
  }
  release(owner:string,id:string) {
    const lease=this.leases.get(id);
    if(!lease) return;
    if(lease.owner!==owner) throw new AppError('IPC005','无权释放此连接。');
    this.leases.delete(id); const c=this.items.get(lease.connectionId);
    if(c) { c.leases.delete(id); if(c.leases.size===0){if(c.isolated)this.close(owner,c.id,c.generation);else c.idle=setTimeout(()=>this.close(owner,c.id,c.generation),this.idleMs);} }
  }
  close(owner:string,id:string,generation:number) {
    const c=this.get(owner,id);
    if(c.generation!==generation) throw new AppError('IPC005','连接版本已失效。');
    this.drop(c);c.client.end();
  }
  hasProfile(id:string) {return this.routingProfiles.has(id)||[...this.items.values()].some(c=>c.profile.profileId===id)||[...this.opening.keys()].some(k=>k.includes(id));}
  private drop(c:Connection) {
    if(!this.items.has(c.id)) return;
    clearTimeout(c.idle);this.items.delete(c.id);
    for(const id of c.leases)this.leases.delete(id);
    this.emit(c.owner,{type:'connection.state',connectionId:c.id,profileId:c.profile.profileId,generation:c.generation,state:'closed'});
    c.socket?.destroy();if(c.upstream)this.release(c.owner,c.upstream.leaseId);
  }
  async sftp(owner:string,id:string):Promise<SFTPWrapper> {
    const c=this.get(owner,id);
    if(!c.sftp)c.sftp=new Promise((resolve,reject)=>c.client.sftp((err,sftp)=>err?reject(new AppError('SSH004','SFTP 子系统不可用。')):resolve(sftp)));
    try{return await c.sftp;}catch(e){c.sftp=undefined;throw e;}
  }
  async stop(owner?:string) {
    this.stopped=!owner;
    for(const [controller,target] of this.controllers)if(!owner||target===owner)controller.abort();
    if(owner)this.challenges.cancelOwner(owner);
    for(const c of [...this.items.values()])if(!owner||c.owner===owner){this.drop(c);c.client.destroy();}
  }
  private async connect(owner:string,p:Profile,isolated=false):Promise<Connection> {
    const hops=(p.jumpProfileIds??[]).map(id=>this.store.profile(id));
    if(hops.some(h=>(h.protocol??'ssh')!=='ssh'||h.jumpProfileIds?.length)||hops.some(h=>h.profileId===p.profileId)||new Set(hops.map(h=>h.profileId)).size!==hops.length)throw new AppError('PROFILE_ROUTE','跳板链必须按顺序列出不同的直连 SSH 配置。');
    if(this.items.size+this.opening.size+this.reservedHops+hops.length>=32)throw new AppError('SSH004','跳板链所需连接数超过上限。');
    this.reservedHops+=hops.length;
    const controller=new AbortController(),signal=controller.signal;
    this.controllers.set(controller,owner);const timeout=setTimeout(()=>controller.abort(),this.connectTimeoutMs);
    const ids=[p.profileId,...hops.map(h=>h.profileId)];for(const id of ids)this.routingProfiles.set(id,(this.routingProfiles.get(id)??0)+1);
    let upstream:Lease|undefined;
    try{
      for(const profile of [...hops,p]){
        if(signal.aborted)throw new AppError('SSH005','SSH 连接已取消或超时。');
        let socket:ClientChannel|undefined;
        if(upstream){const parent=this.get(owner,upstream.connectionId);socket=await new Promise<ClientChannel>((resolve,reject)=>{
          let ended=false;const cleanup=()=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);};
          const cancel=()=>{if(ended)return;ended=true;cleanup();reject(new AppError('SSH005','跳板转发已取消或超时。'));};
          const timer=setTimeout(cancel,30000);signal.addEventListener('abort',cancel,{once:true});
          try{parent.client.forwardOut('127.0.0.1',0,profile.host,profile.port,(error,channel)=>{cleanup();if(ended){channel?.destroy();return;}ended=true;if(error)reject(new AppError('SSH001','跳板无法连接下一跳：'+profile.name));else{channel.on('error',()=>{});resolve(channel);}});}catch(e){ended=true;cleanup();reject(e);}
        });}
        let connection:Connection;
        try{connection=await this.connectDirect(owner,profile,signal,profile===p?isolated:true,upstream,socket);}catch(e){socket?.destroy();throw e;}
        // The new connection now owns the upstream lease.
        upstream=undefined;
        if(profile===p)return connection;
        upstream=this.retain(owner,connection.id);
      }
      throw new AppError('PROFILE_ROUTE','跳板链无效。');
    }finally{
      clearTimeout(timeout);controller.abort();this.controllers.delete(controller);
      this.reservedHops-=hops.length;
      if(upstream)this.release(owner,upstream.leaseId);
      for(const id of ids){const n=(this.routingProfiles.get(id)??1)-1;if(n)this.routingProfiles.set(id,n);else this.routingProfiles.delete(id);}
    }
  }
  private async connectDirect(owner:string,p:Profile,signal:AbortSignal,isolated=false,upstream?:Lease,socket?:ClientChannel):Promise<Connection> {
    if((p.protocol??'ssh')!=='ssh')throw new AppError('CAPABILITY_UNAVAILABLE','此功能需要 SSH 连接。');
    const id=randomUUID(), client=new Client();
    const state=(state:string)=>this.emit(owner,{type:'connection.state',connectionId:id,profileId:p.profileId,generation:1,state});
    state('authenticating');
    let password:string|undefined, privateKey:string|undefined, passphrase:string|undefined;
    if(p.authType==='password') password=await abortable(this.cachedSecret(owner,p),signal)??await this.challenges.ask(owner,{kind:'password',profileId:p.profileId,title:'SSH 身份认证',message:p.username+'@'+p.host},signal);
    if(p.authType==='privateKey') {
      privateKey=await this.challenges.ask(owner,{kind:'privateKey',profileId:p.profileId,title:'选择 SSH 私钥',message:'私钥仅在本次认证中使用，不写入连接配置。'},signal);
      passphrase=await this.challenges.ask(owner,{kind:'passphrase',profileId:p.profileId,title:'私钥口令',message:'无口令的密钥可留空。'},signal);
    }
    state('connecting');
    return new Promise((resolve,reject)=>{
      let settled=false, rejectedTrust=false;
      const c:Connection={id,owner,profile:p,client,generation:1,leases:new Set(),isolated,upstream,socket};
      const fail=(error:AppError)=>{if(!settled){settled=true;clearTimeout(deadline);signal.removeEventListener('abort',cancel);client.destroy();state('failed');reject(error);}};
      const cancel=()=>fail(new AppError('SSH005','SSH 连接已取消或超时。'));
      const deadline=setTimeout(()=>fail(new AppError('SSH005','SSH 连接或认证超时。')),120000);
      signal.addEventListener('abort',cancel,{once:true});
      client.on('error',(err:Error & {level?:string})=>{
        if(!settled)fail(new AppError(rejectedTrust?'SSH003':err.level==='client-authentication'?'SSH002':'SSH001',rejectedTrust?'主机密钥未通过验证。':err.level==='client-authentication'?'SSH 认证失败。':'无法建立 SSH 连接。'));
        else this.drop(c);
      });
      client.on('close',()=>{ if(!settled)fail(new AppError('SSH006','SSH 连接提前关闭。'));else this.drop(c); });
      client.on('keyboard-interactive',(_name,_instructions,_lang,prompts,finish)=>{
        void (async()=>{const replies:string[]=[];for(const prompt of prompts)replies.push(await this.challenges.ask(owner,{kind:'keyboard',profileId:p.profileId,title:'SSH 交互认证',message:prompt.prompt.slice(0,1000),echo:prompt.echo},signal));finish(replies);})().catch(()=>fail(new AppError('IPC006','交互认证取消。')));
      });
      client.once('ready',()=>{
        if(settled)return;
        settled=true;clearTimeout(deadline);signal.removeEventListener('abort',cancel);password=undefined;privateKey=undefined;passphrase=undefined;
        if(this.stopped){client.destroy();reject(new AppError('IPC006','服务已停止。'));return;}
        this.items.set(id,c);state('ready');resolve(c);
      });
      try {
        if(signal.aborted){cancel();return;}
        client.connect({
          host:p.host,port:p.port,username:p.username,password,privateKey,passphrase,sock:socket,
          agent:p.authType==='agent'?(process.platform==='win32'?'\\\\.\\pipe\\openssh-ssh-agent':process.env.SSH_AUTH_SOCK):undefined,
          tryKeyboard:true,readyTimeout:120000,keepaliveInterval:15000,keepaliveCountMax:3,
          hostVerifier:(key:Buffer,verify:(valid:boolean)=>void)=>{
            state('verifying');
            void (async()=>{
              const fingerprint='SHA256:'+createHash('sha256').update(key).digest('base64').replace(/=+$/,'');
              const known=this.store.trust(p.host,p.port);
              if(known.length){const valid=known.includes(fingerprint);rejectedTrust=!valid;verify(valid);return;}
              const answer=await this.challenges.ask(owner,{kind:'trust',profileId:p.profileId,title:'首次连接：核对主机指纹',message:p.host+':'+p.port+'\n'+fingerprint+'\n请通过可信渠道核对，接受后保存。'},signal);
              if(answer!=='accept'){rejectedTrust=true;verify(false);return;}
              this.store.rememberHost(p.host,p.port,key);verify(true);state('authenticating');
            })().catch(()=>{rejectedTrust=true;verify(false);});
          }
        });
      }catch{fail(new AppError('SSH002','密钥格式、口令或认证配置无效。'));}
    });
  }
}
function abortable<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{
 return new Promise((resolve,reject)=>{
  const cancel=()=>{signal.removeEventListener('abort',cancel);reject(new AppError('SSH005','SSH 连接已取消或超时。'));};
  signal.addEventListener('abort',cancel,{once:true});
  promise.then(value=>{signal.removeEventListener('abort',cancel);resolve(value);},error=>{signal.removeEventListener('abort',cancel);reject(error);});
  if(signal.aborted)cancel();
 });
}
