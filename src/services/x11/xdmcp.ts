import { createSocket } from 'node:dgram';
import { networkInterfaces } from 'node:os';
import { randomUUID } from 'node:crypto';
import { AppError,safeError } from '../../packages/core/errors';
import type { XdmcpConfig,XdmcpHost,XdmcpSession } from '../../packages/contracts/native';
import type { XServers } from './engine';

export function localInterfaces(){
  return Object.entries(networkInterfaces()).flatMap(([name,addresses])=>(addresses??[]).filter(a=>a.family==='IPv4').map(a=>({name,address:a.address})));
}
export function validateEndpoint(host:string,localAddress:string){
  const octets=host.split('.').map(Number);
  const lan=octets[0]===10||octets[0]===127||(octets[0]===172&&octets[1]>=16&&octets[1]<=31)||(octets[0]===192&&octets[1]===168)||(octets[0]===169&&octets[1]===254);
  if(octets.length!==4||octets.some(n=>!Number.isInteger(n)||n<0||n>255)||!lan||octets[3]===255)throw new AppError('XDMCP_ADDRESS','XDMCP 当前只支持明确的局域网、VPN 私网或回环 IPv4 地址。');
  if(!localInterfaces().some(i=>i.address===localAddress))throw new AppError('XDMCP_INTERFACE','请选择当前可用的本地 IPv4 接口。');
}
export function parseReply(data:Buffer,host:string):XdmcpHost|undefined{
  if(data.length<6||data.length>8192||data.readUInt16BE(0)!==1||data.readUInt16BE(4)!==data.length-6)return;
  const opcode=data.readUInt16BE(2);if(opcode!==5&&opcode!==6)return;
  let offset=6;
  const field=()=>{if(offset+2>data.length)throw new Error();const length=data.readUInt16BE(offset);offset+=2;if(offset+length>data.length)throw new Error();const value=data.subarray(offset,offset+length);offset+=length;return value;};
  const text=(value:Buffer)=>value.toString('utf8').replace(/[\x00-\x1f\x7f]/g,' ').slice(0,512);
  try{
    if(opcode===5&&field().length!==0)return; // This adapter negotiates no XDMCP authentication extension.
    const hostname=text(field()),status=text(field());if(offset!==data.length)return;
    return {host,willing:opcode===5,hostname,status};
  }catch{return;}
}
export function queryXdmcp(host:string,localAddress:string,port:number,signal?:AbortSignal):Promise<XdmcpHost>{
  validateEndpoint(host,localAddress);
  return new Promise((resolve,reject)=>{
    const socket=createSocket('udp4');let settled=false;
    const finish=(error?:AppError,result?:XdmcpHost)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);socket.close();error?reject(error):resolve(result!);};
    const abort=()=>finish(new AppError('IPC006','XDMCP 查询已取消。'));
    const timer=setTimeout(()=>finish(new AppError('XDMCP_TIMEOUT','XDMCP 未响应；请检查 UDP 端口和服务器显示管理器配置。')),3000);
    socket.on('error',()=>finish(new AppError('XDMCP_NETWORK','XDMCP 网络查询失败。')));
    socket.on('message',(data,remote)=>{if(remote.address!==host||remote.port!==port)return;const reply=parseReply(data,host);if(reply)finish(undefined,reply);});
    socket.bind(0,localAddress,()=>{if(!settled)socket.send(Buffer.from([0,1,0,2,0,1,0]),port,host,error=>{if(error&&!settled)finish(new AppError('XDMCP_NETWORK','无法发送 XDMCP 查询。'));});});
    if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  });
}
interface Session {owner:string;snapshot:XdmcpSession;abort:AbortController;stop?:()=>Promise<void>}
export class XdmcpService {
  private sessions=new Map<string,Session>();
  private queries=new Set<string>();
  constructor(private engines:XServers){}
  list(owner:string){return [...this.sessions.values()].filter(s=>s.owner===owner).map(s=>({...s.snapshot}));}
  async query(owner:string,host:string,localAddress:string,port:number){
    if(this.queries.has(owner))throw new AppError('XDMCP_BUSY','请等待当前查询完成。');this.queries.add(owner);
    try{return await queryXdmcp(host,localAddress,port);}finally{this.queries.delete(owner);}
  }
  async open(owner:string,config:XdmcpConfig){
    validateEndpoint(config.host,config.localAddress);
    if([...this.sessions.values()].filter(s=>!s.abort.signal.aborted).length>=8)throw new AppError('XDMCP_BUSY','请先停止现有 XDMCP 会话。');
    while(this.sessions.size>=20){const old=[...this.sessions.values()].find(s=>s.abort.signal.aborted);if(!old)break;this.sessions.delete(old.snapshot.id);}
    const id=randomUUID(),s:Session={owner,snapshot:{id,host:config.host,localAddress:config.localAddress,display:config.display,state:'querying'},abort:new AbortController()};this.sessions.set(id,s);
    try{
      const response=await queryXdmcp(config.host,config.localAddress,config.port,s.abort.signal);
      if(!response.willing)throw new AppError('XDMCP_UNWILLING','服务器拒绝 XDMCP：'+response.status);
      s.abort.signal.throwIfAborted();s.snapshot.state='starting';
      const engine=await this.engines.start({mode:'singleWindow',dpi:config.dpi,allowNetworkListener:config.allowNetworkListener},s.abort.signal,error=>{if(s.abort.signal.aborted)return;s.snapshot.state='failed';s.snapshot.error=error.message;s.abort.abort();},config);
      s.stop=()=>engine.stop();s.abort.signal.throwIfAborted();s.snapshot.state='awaiting-login';return {id};
    }catch(error){if(!s.abort.signal.aborted){s.snapshot.state='failed';s.snapshot.error=safeError(error).message;s.abort.abort();}await s.stop?.();throw error;}
  }
  async close(owner:string,id:string){const s=this.sessions.get(id);if(!s)return;if(s.owner!==owner)throw new AppError('IPC005','无权关闭 XDMCP 会话。');s.abort.abort(new AppError('IPC006','XDMCP 会话已停止。'));await s.stop?.();this.sessions.delete(id);}
  async stop(){await Promise.all([...this.sessions.values()].map(s=>this.close(s.owner,s.snapshot.id)));}
}
