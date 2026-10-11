import { Server,utils,type Connection,type SFTPWrapper } from 'ssh2';
import { generateKeyPairSync } from 'node:crypto';
import { posix } from 'node:path';
import { createServer,createConnection,type Socket,type Server as TcpServer } from 'node:net';
interface Handle { path:string;directory?:boolean;read?:boolean }
export async function sshFixture(options:{atomicRename?:boolean;password?:string;writeDelay?:number;key?:string;directoryTracking?:boolean;procReadlink?:boolean;procProbeDelayMs?:number;rejectTrackingExec?:boolean}={}){
 const key=options.key??generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs1',format:'pem'},publicKeyEncoding:{type:'pkcs1',format:'pem'}}).privateKey;
 const directories=new Set(['/','/tmp','/tmp/space dir']);const shellCwds=new Map<number,string>(),shellInputs=new Map<number,string>();
 const shellBytes=new Map<number,Buffer>();
 const modes=new Map<string,number>(),mtimes=new Map<string,number>();
 const files=new Map<string,Buffer>([['/hello.txt',Buffer.from('hello 世界\n')]]);const clients=new Set<Connection>();let authCount=0,shellCount=0;
 const server=new Server({hostKeys:[key]},client=>{
  clients.add(client);client.on('error',()=>{});client.on('close',()=>clients.delete(client));
  client.on('authentication',ctx=>{if(ctx.method==='password'&&ctx.username==='tester'&&ctx.password===(options.password??'test-password')){authCount++;ctx.accept();}else ctx.reject(['password']);});
  const listeners=new Map<number,TcpServer>(),sockets=new Set<Socket>();
  client.on('close',()=>{for(const listener of listeners.values())listener.close();for(const socket of sockets)socket.destroy();});
  client.on('tcpip',(accept,reject,info)=>{
   if(!['127.0.0.1','fixture.internal'].includes(info.destIP)){reject();return;}
   const socket=createConnection({host:'127.0.0.1',port:info.destPort,allowHalfOpen:true});
   sockets.add(socket);socket.on('close',()=>sockets.delete(socket));
   socket.once('error',()=>reject());
   socket.once('connect',()=>{
    socket.removeAllListeners('error');const channel=accept();
    socket.on('error',()=>channel.destroy());channel.on('error',()=>socket.destroy());
    socket.on('close',()=>channel.destroy());channel.on('close',()=>socket.destroy());
    socket.pipe(channel);channel.pipe(socket);
   });
  });
  client.on('request',(accept,reject,name,info)=>{
   if(!accept||!reject)return;
   if(name==='tcpip-forward'){
    if(info.bindAddr!=='127.0.0.1'){reject();return;}
    const listener=createServer({pauseOnConnect:true,allowHalfOpen:true},socket=>{
     sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));
     const port=(listener.address() as {port:number}).port;
     client.forwardOut(info.bindAddr,port,socket.remoteAddress??'127.0.0.1',socket.remotePort??0,(error,channel)=>{
      if(error||socket.destroyed){socket.destroy();channel?.destroy();return;}
      channel.on('error',()=>socket.destroy());socket.on('error',()=>channel.destroy());
      channel.on('close',()=>socket.destroy());socket.on('close',()=>channel.destroy());
      // ssh2 server-side .end() closes the entire channel. Send SSH EOF only,
      // after queued writes, so the forwarded peer can still return a response.
      socket.pipe(channel,{end:false});channel.pipe(socket);
      socket.once('end',()=>channel.write(Buffer.alloc(0),()=>channel.eof()));
     });
    });
    listener.once('error',()=>reject());
    listener.listen(info.bindPort,info.bindAddr,()=>{const port=(listener.address() as {port:number}).port;listeners.set(port,listener);accept(port);});
   }else if(name==='cancel-tcpip-forward'){
    const listener=listeners.get(info.bindPort);
    if(!listener){reject();return;}
    listener.close();listeners.delete(info.bindPort);accept();
   }else reject();
  });
  client.on('ready',()=>client.on('session',accept=>{
   const session=accept();session.on('pty',accept=>accept?.());session.on('window-change',accept=>accept?.());
   const startShell=(stream:import('ssh2').ServerChannel,token?:string)=>{
    const pid=1000+(++shellCount);shellCwds.set(pid,'/');let input='';
    if(token)stream.write('\x1b]1337;HornetPID='+token+';'+pid+'\x07');
    stream.write('fixture ready\r\n$ ');
    stream.on('data',(data:Buffer)=>{shellBytes.set(pid,Buffer.concat([shellBytes.get(pid)??Buffer.alloc(0),data]).subarray(-65536));shellInputs.set(pid,((shellInputs.get(pid)??'')+data.toString()).slice(-65536));stream.write(Buffer.concat([Buffer.from('echo:'),data]));input+=data.toString();const lines=input.split(/[\r\n]/);input=lines.pop()??'';for(const line of lines){if(line.startsWith('cd ')){let path=line.slice(3).trim().replace(/^['"]|['"]$/g,'');path=posix.resolve(shellCwds.get(pid)??'/',path);if(directories.has(path))shellCwds.set(pid,path);}}});
    stream.on('close',()=>shellCwds.delete(pid));
   };
   session.on('shell',accept=>startShell(accept()));
   session.on('exec',(accept,reject,info)=>{
    const marker=/HornetDirectory-[a-f0-9-]{36}:/.exec(info.command)?.[0];
    if(marker){const path=/readlink (\/proc\/(?:self|[0-9]+\/cwd))$/.exec(info.command)?.[1];
     const value=options.directoryTracking===false?undefined:path==='/proc/self'?'999':shellCwds.get(Number(path?.split('/')[2]));
     const stream=accept();stream.write('login banner\n'+marker+(value??'')+'\n');stream.exit(value?0:1);stream.end();return;
    }
    if(options.rejectTrackingExec){reject();return;}
    const token=/HornetPID=([a-f0-9-]{36});/.exec(info.command)?.[1];if(!token){reject();return;}startShell(accept(),token);});
   session.on('sftp',accept=>serve(accept()));
  }));
 });
 function serve(sftp:SFTPWrapper){
  if(options.atomicRename){
   // ssh2's server API advertises no extensions. Extend the fixture VERSION
   // frame on this channel so the real client negotiates posix-rename normally.
   const channel=sftp as any,protocol=channel._protocol,send=protocol.channelData;
   protocol.channelData=function(id:number,data:Buffer){if(id===channel.outgoing.id&&data.length===9&&data[4]===2){const name=Buffer.from('posix-rename@openssh.com'),value=Buffer.from('1'),extra=Buffer.alloc(8+name.length+value.length);extra.writeUInt32BE(name.length);name.copy(extra,4);extra.writeUInt32BE(value.length,4+name.length);value.copy(extra,8+name.length);data=Buffer.concat([data,extra]);data.writeUInt32BE(data.length-4);}return send.call(this,id,data);};
   sftp.on('EXTENDED',(id:number,name:string,data:Buffer)=>{if(name!=='posix-rename@openssh.com')return sftp.status(id,8);const length=data.readUInt32BE(0),a=data.subarray(4,4+length).toString(),n=data.readUInt32BE(4+length),b=data.subarray(8+length,8+length+n).toString();if(!files.has(a))return sftp.status(id,2);files.set(b,files.get(a)!);files.delete(a);if(mtimes.has(a)){mtimes.set(b,mtimes.get(a)!);mtimes.delete(a);}sftp.status(id,0);});
  }

  const handles=new Map<string,Handle>();let next=0;
  const normalized=(p:string)=>posix.resolve('/',p);
  const attrs=(path:string)=>({mode:modes.get(path)??(directories.has(path)?0o40755:0o100644),uid:1000,gid:1000,size:files.get(path)?.length??0,atime:1700000000,mtime:mtimes.get(path)??1700000000});
  const status=(id:number,code=0)=>sftp.status(id,code);
  const exists=(path:string)=>directories.has(path)||files.has(path);
  const handle=(id:number,value:Handle)=>{const key=String(++next);handles.set(key,value);sftp.handle(id,Buffer.from(key));};
  sftp.on('REALPATH',(id:number,path:string)=>{const p=normalized(path);exists(p)?sftp.name(id,[{filename:p,longname:p,attrs:attrs(p)}]):status(id,2);});
  const stat=(id:number,path:string)=>{const p=normalized(path);exists(p)?sftp.attrs(id,attrs(p)):status(id,2);};
  sftp.on('STAT',stat).on('LSTAT',stat);
  sftp.on('FSTAT',(id:number,h:Buffer)=>{const v=handles.get(h.toString());v?sftp.attrs(id,attrs(v.path)):status(id,4);});
  sftp.on('OPENDIR',(id:number,path:string)=>directories.has(normalized(path))?handle(id,{path:normalized(path),directory:true}):status(id,2));
  sftp.on('READLINK',(id:number,path:string)=>{const pid=Number(/^\/proc\/(\d+)\/cwd$/.exec(path)?.[1]),cwd=options.directoryTracking===false||options.procReadlink===false?undefined:path==='/proc/self'?'999':shellCwds.get(pid);const reply=()=>{cwd?sftp.name(id,[{filename:cwd,longname:cwd,attrs:attrs(cwd)}]):status(id,2);};if(path==='/proc/self'&&options.procProbeDelayMs)setTimeout(reply,options.procProbeDelayMs);else reply();});
  sftp.on('READDIR',(id:number,h:Buffer)=>{const v=handles.get(h.toString());if(!v)return status(id,4);if(v.read)return status(id,1);v.read=true;const entries=[...files.keys(),...directories].filter(path=>path!==v.path&&posix.dirname(path)===v.path).map(path=>({filename:posix.basename(path),longname:posix.basename(path),attrs:attrs(path)}));entries.length?sftp.name(id,entries):status(id,1);});
  sftp.on('MKDIR',(id:number,path:string)=>{const p=normalized(path);if(exists(p)||!directories.has(posix.dirname(p)))return status(id,4);directories.add(p);status(id);});
  sftp.on('OPEN',(id:number,path:string,flags:number)=>{
   const p=normalized(path),mode=utils.sftp.flagsToString(flags);
   if(!mode)return status(id,4);
   if(directories.has(p)||!directories.has(posix.dirname(p)))return status(id,4);
   if((flags&32)&&files.has(p))return status(id,4);
   if(!files.has(p)&&!(flags&8))return status(id,2);
   if(!files.has(p)||(flags&16))files.set(p,Buffer.alloc(0));
   handle(id,{path:p});
  });
  sftp.on('READ',(id:number,h:Buffer,offset:number,length:number)=>{const v=handles.get(h.toString()),data=v&&files.get(v.path);if(!data)return status(id,4);if(offset>=data.length)return status(id,1);sftp.data(id,data.subarray(offset,Math.min(data.length,offset+length)));});
  sftp.on('WRITE',(id:number,h:Buffer,offset:number,data:Buffer)=>{
   const run=()=>{const v=handles.get(h.toString());if(!v)return status(id,4);const prev=files.get(v.path)??Buffer.alloc(0);const updated=Buffer.alloc(Math.max(prev.length,offset+data.length));prev.copy(updated);data.copy(updated,offset);files.set(v.path,updated);status(id);};
   options.writeDelay?setTimeout(run,options.writeDelay):run();
  });
  sftp.on('CLOSE',(id:number,h:Buffer)=>{handles.delete(h.toString());status(id);});
  sftp.on('REMOVE',(id:number,path:string)=>files.delete(normalized(path))?status(id):status(id,2));
  sftp.on('RENAME',(id:number,a:string,b:string)=>{a=normalized(a);b=normalized(b);if(!files.has(a))return status(id,2);if(files.has(b))return status(id,4);files.set(b,files.get(a)!);files.delete(a);if(mtimes.has(a)){mtimes.set(b,mtimes.get(a)!);mtimes.delete(a);}status(id);});
  sftp.on('SETSTAT',(id:number,path:string,attrs:{mode?:number;mtime?:number})=>{path=normalized(path);if(!exists(path))return status(id,2);if(attrs.mtime!==undefined)mtimes.set(path,attrs.mtime);if(attrs.mode!==undefined)modes.set(path,(path==='/'?0o40000:0o100000)|(attrs.mode&0o7777));status(id);});
  sftp.on('FSETSTAT',(id:number)=>status(id));
  sftp.on('error',()=>{});
 }
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const port=(server.address() as {port:number}).port;
 return {port,key,files,directories,mtimes,get shellBytes(){return [...shellBytes.entries()];},get shellInputs(){return [...shellInputs.entries()];},get shellPaths(){return [...shellCwds.values()];},get authCount(){return authCount;},get shellCount(){return shellCount;},disconnect(){for(const c of clients)c.end();},async close(){for(const c of clients)c.end();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}
