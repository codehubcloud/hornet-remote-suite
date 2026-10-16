import { createConnection,type Socket } from 'node:net';
import { AppError } from '../../packages/core/errors';

// Bound DNS + TCP establishment independently from user authentication prompts.
export const networkConnectTimeoutMs=10000;
export function connectionError(error:unknown,host:string,port:number):AppError{
 const code=(error as NodeJS.ErrnoException)?.code;
 const reason=code==='ECONNREFUSED'?'服务器拒绝连接，请检查端口和 SSH 服务。'
  :code==='ENOTFOUND'||code==='EAI_AGAIN'?'无法解析服务器地址，请检查主机名和 DNS。'
  :code==='EHOSTUNREACH'||code==='ENETUNREACH'?'服务器或网络不可达，请检查网络和 VPN。'
  :code==='ETIMEDOUT'?'连接超时，服务器未响应，请检查网络、端口和防火墙。'
  :code==='ECONNRESET'?'服务器重置了连接，请检查 SSH 服务。'
  :'无法建立 SSH 连接，请检查服务器、端口和网络。';
 return new AppError('SSH001',`${host}:${port} · ${reason}`,true);
}
export function connectSocket(host:string,port:number,signal:AbortSignal,timeoutMs=networkConnectTimeoutMs):Promise<Socket>{
 return new Promise((resolve,reject)=>{
  if(signal.aborted){reject(new AppError('SSH005','SSH 连接已取消或超时。'));return;}
  const socket=createConnection({host,port});
  const cleanup=()=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);socket.off('connect',connected);socket.off('error',failed);};
  const fail=(error:AppError)=>{cleanup();socket.destroy();reject(error);};
  const failed=(error:Error)=>fail(connectionError(error,host,port));
  const cancel=()=>fail(new AppError('SSH005','SSH 连接已取消或超时。'));
  const connected=()=>{cleanup();resolve(socket);};
  const timer=setTimeout(()=>fail(connectionError({code:'ETIMEDOUT'},host,port)),timeoutMs);
  socket.once('connect',connected);socket.once('error',failed);signal.addEventListener('abort',cancel,{once:true});
  // The socket remains alive while the user supplies credentials. Retain a
  // harmless error listener until ssh2 installs its own transport listeners.
  socket.on('error',()=>{});
 });
}
