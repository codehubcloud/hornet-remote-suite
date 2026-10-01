import { randomUUID,randomBytes,createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir,readFile,writeFile,stat,rm } from 'node:fs/promises';
import { join,isAbsolute,basename } from 'node:path';
import { createServer,createConnection } from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { AppError } from '../../packages/core/errors';
import type { XServerEngine,XServerOptions,XdmcpConfig } from '../../packages/contracts/native';
import { nativeCall,nativePath } from '../native/host';

export function encodeAuthority(display:number,cookie:Buffer){
  if(cookie.length!==16)throw new AppError('X11_COOKIE_REJECTED','Cookie 长度无效。');
  return Buffer.concat([Buffer.from([255,255]),...[Buffer.alloc(0),Buffer.from(String(display)),Buffer.from('MIT-MAGIC-COOKIE-1'),cookie].flatMap(value=>{
    const length=Buffer.alloc(2);length.writeUInt16BE(value.length);return [length,value];
  })]);
}
export function setupPacket(cookie:Buffer){
  const packet=Buffer.alloc(48);packet[0]=0x6c;packet.writeUInt16LE(11,2);packet.writeUInt16LE(18,6);packet.writeUInt16LE(16,8);packet.write('MIT-MAGIC-COOKIE-1',12);cookie.copy(packet,32);return packet;
}
export async function probeDisplay(port:number,cookie:Buffer,signal?:AbortSignal):Promise<boolean>{
  return new Promise((resolve,reject)=>{
    const socket=createConnection({host:'127.0.0.1',port});let data=Buffer.alloc(0),settled=false;
    const finish=(error?:Error,accepted=false)=>{if(settled)return;settled=true;signal?.removeEventListener('abort',abort);socket.destroy();error?reject(error):resolve(accepted);};
    const abort=()=>finish(new AppError('IPC006','X Server 启动已取消。'));
    socket.setTimeout(1000,()=>finish(new AppError('X11_ENGINE_MISSING','X Server 握手超时。')));
    socket.on('error',()=>finish(new AppError('X11_ENGINE_MISSING','X Server 尚未就绪。')));
    socket.on('close',()=>finish(new AppError('X11_ENGINE_MISSING','X Server 提前断开。')));
    socket.on('connect',()=>socket.write(setupPacket(cookie)));
    socket.on('data',chunk=>{data=Buffer.concat([data,Buffer.from(chunk)]);if(data.length>=8)finish(undefined,data[0]===1&&data.readUInt16LE(2)===11);});
    if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  });
}
async function digest(path:string){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
async function available(port:number){
  return new Promise<boolean>(resolve=>{const server=createServer();server.once('error',()=>resolve(false));server.listen({host:'0.0.0.0',port,exclusive:true},()=>server.close(()=>resolve(true)));});
}
export interface ManagedDisplay {display:number;port:number;cookie:Buffer;stop():Promise<void>}
export class XServers {
  private config:XServerEngine={configured:false};
  private instances=new Map<number,ManagedDisplay>();
  private reserved=new Set<number>();
  private stopped=false;
  private loaded:Promise<void>;
  constructor(private root:string){
    this.loaded=readFile(join(root,'engine.json'),'utf8').then(raw=>{
      const value=JSON.parse(raw) as XServerEngine;
      if(value.configured&&typeof value.path==='string'&&isAbsolute(value.path)&&typeof value.sha256==='string'&&/^[a-f0-9]{64}$/.test(value.sha256))this.config=value;
    }).catch(()=>{});
  }
  async status(){await this.loaded;return {...this.config};}
  async configure(path:string){
    await this.loaded;
    if(this.reserved.size)throw new AppError('X11_DISPLAY_BUSY','请先停止全部受管理的图形会话。');
    if(process.platform!=='win32'||!isAbsolute(path)||basename(path).toLowerCase()!=='vcxsrv.exe'||!(await stat(path)).isFile())throw new AppError('X11_ENGINE_MISSING','请选择 Windows VcXsrv 的 vcxsrv.exe。');
    const info=await nativeCall({op:'xserverProbe',executable:path});
    const config:XServerEngine={configured:true,path,version:String(info.version).match(/[0-9]+(?:\.[0-9]+)+/)?.[0]??'unknown',sha256:await digest(path)};
    await mkdir(this.root,{recursive:true});await writeFile(join(this.root,'engine.json'),JSON.stringify(config),{mode:0o600});this.config=config;return this.status();
  }
  async start(options:XServerOptions,signal:AbortSignal,onExit:(error:AppError)=>void,xdmcp?:XdmcpConfig):Promise<ManagedDisplay>{
    await this.loaded;
    if(this.stopped||signal.aborted)throw new AppError('IPC006','X Server 启动已取消。');
    if(!options.allowNetworkListener)throw new AppError('IPC005','需明确启用 X Server 网络监听。');
    const config={...this.config};
    if(!config.path||!config.sha256)throw new AppError('X11_ENGINE_MISSING','请先选择 VcXsrv 引擎。');
    if(await digest(config.path)!==config.sha256)throw new AppError('X11_ENGINE_CHANGED','X Server 程序已改变，请重新选择并确认引擎。');
    if(this.reserved.size>=8)throw new AppError('X11_DISPLAY_BUSY','最多允许 8 个独立显示实例。');
    let display=-1;
    for(const candidate of xdmcp?[xdmcp.display]:Array.from({length:90},(_,i)=>i+10)){
      if(this.reserved.has(candidate))continue;this.reserved.add(candidate);
      if(await available(6000+candidate)){display=candidate;break;}this.reserved.delete(candidate);
    }
    if(display<0)throw new AppError('X11_DISPLAY_BUSY','显示端口已占用或没有可用显示号。');
    if(this.stopped||signal.aborted){this.reserved.delete(display);throw new AppError('IPC006','X Server 启动已取消。');}
    const cookie=randomBytes(16),folder=join(this.root,'session-'+randomUUID());
    let intentional=false,ended=false,buffer='',stopPromise:Promise<void>|undefined;
    const child=spawn(nativePath(),[],{windowsHide:true,stdio:'pipe'});
    const exited=new Promise<void>(resolve=>child.once('close',()=>{ended=true;this.instances.delete(display);this.reserved.delete(display);cookie.fill(0);void rm(folder,{recursive:true,force:true}).catch(()=>{}).then(resolve);if(!intentional)onExit(new AppError('X11_ENGINE_EXITED','X Server 已退出，所属图形会话已停止。'));}));
    child.stdin.on('error',()=>{});child.stderr.resume();
    let startError:AppError|undefined;
    child.on('error',()=>{startError=new AppError('X11_ENGINE_MISSING','无法启动 X Server 原生辅助程序。');});
    child.stdout.on('data',chunk=>{buffer+=chunk.toString();if(buffer.length>65536){startError=new AppError('X11_ENGINE_FAILED','X Server 辅助进程响应过大。');child.kill();return;}
      let at;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);try{if(JSON.parse(line).error)startError=new AppError('X11_ENGINE_FAILED','X Server 初始化失败，请检查引擎与目录权限。');}catch{startError=new AppError('X11_ENGINE_FAILED','X Server 辅助进程响应无效。');}}
    });
    const stop=()=>stopPromise??=(async()=>{intentional=true;signal.removeEventListener('abort',abort);child.stdin.end('stop\n');const kill=setTimeout(()=>child.kill(),2000);try{await exited;}finally{clearTimeout(kill);await rm(folder,{recursive:true,force:true}).catch(()=>{});}})();
    const abort=()=>{void stop();};signal.addEventListener('abort',abort,{once:true});
    const instance:ManagedDisplay={display,port:6000+display,cookie,stop};this.instances.set(display,instance);
    const authority=encodeAuthority(display,cookie);
    // Keep stdin open: its EOF is the helper's parent-death signal.
    child.stdin.write(JSON.stringify({op:'xserver',executable:config.path,folder,display,dpi:options.dpi,mode:options.mode,authority:authority.toString('base64'),...(xdmcp?{host:xdmcp.host,localAddress:xdmcp.localAddress,port:xdmcp.port}:{})})+'\n');authority.fill(0);
    try{
      if(signal.aborted||this.stopped)throw new AppError('IPC006','X Server 启动已取消。');
      const deadline=Date.now()+15000;
      while(Date.now()<deadline){
        if(startError)throw startError;if(ended)throw new AppError('X11_ENGINE_FAILED','X Server 启动失败或提前退出。');signal.throwIfAborted();
        // In XDMCP mode the display manager supplies authorization after negotiation.
        if(xdmcp){await delay(500,undefined,{signal});if(!ended&&!startError)return instance;}
        else try{
          if(await probeDisplay(instance.port,cookie,signal)){
            if(await probeDisplay(instance.port,randomBytes(16),signal))throw new AppError('X11_AUTHORITY_INVALID','X Server 接受了错误 cookie，已停止不安全的显示实例。');
            return instance;
          }
        }catch(error){if(error instanceof AppError&&error.code==='X11_AUTHORITY_INVALID')throw error;}
        await delay(150,undefined,{signal});
      }
      throw new AppError('X11_ENGINE_FAILED','X Server 在 15 秒内未通过认证就绪检查。');
    }catch(error){await stop();throw error;}
  }
  async stop(){this.stopped=true;await Promise.all([...this.instances.values()].map(instance=>instance.stop()));}
}
