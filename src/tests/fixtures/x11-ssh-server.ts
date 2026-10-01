import { Server,type Connection } from 'ssh2';
import { createServer,type Socket } from 'node:net';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { encodeAuthority } from '../../services/x11/engine';
export async function x11SshFixture(engineDirectory:string){
 const root=await mkdtemp(join(tmpdir(),'hornet-x11-ssh-')),key=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs1',format:'pem'},publicKeyEncoding:{type:'pkcs1',format:'pem'}}).privateKey;
 const clients=new Set<Connection>(),cleanups=new Set<()=>void>();let number=0;
 const server=new Server({hostKeys:[key]},client=>{
   clients.add(client);client.on('error',()=>{});client.on('close',()=>clients.delete(client));
   client.on('authentication',ctx=>ctx.method==='password'&&ctx.username==='tester'&&ctx.password==='test-password'?ctx.accept():ctx.reject(['password']));
   client.on('ready',()=>client.on('session',accept=>{
     const session=accept();let cookie:Buffer|undefined;
     session.on('x11',(accept,_reject,info)=>{cookie=Buffer.from(info.cookie.toString(),'hex');accept?.();});
     session.on('exec',(accept,reject,info)=>{
       if(info.command!=='xclock'||!cookie){reject();return;}
       const stream=accept(),sockets=new Set<Socket>(),index=++number;
       stream.on('error',()=>{});
       const listener=createServer(socket=>{
         sockets.add(socket);socket.on('error',()=>{});socket.once('close',()=>sockets.delete(socket));
         client.x11('127.0.0.1',socket.remotePort??0,(error,channel)=>{
           if(error){socket.destroy();return;}channel.on('error',()=>socket.destroy());channel.on('close',()=>socket.destroy());socket.on('close',()=>channel.destroy());socket.pipe(channel);channel.pipe(socket);
         });
       });
       let child:ReturnType<typeof spawn>|undefined,closed=false;
       const close=()=>{if(closed)return;closed=true;child?.kill();for(const socket of sockets)socket.destroy();listener.close();cleanups.delete(close);};cleanups.add(close);
       stream.on('close',close);client.once('close',close);
       listener.on('error',()=>{stream.exit(1);stream.end();close();});
       listener.listen(0,'127.0.0.1',()=>{void(async()=>{
         const display=(listener.address() as {port:number}).port-6000,authority=join(root,'authority-'+index);
         await writeFile(authority,encodeAuthority(display,cookie!),{mode:0o600});if(closed)return;
         child=spawn(join(engineDirectory,'xclock.exe'),['-display','127.0.0.1:'+display,'-title','Hornet SSH X11 '+index,'-geometry','200x200+'+(40+index*220)+'+80'],{env:{...process.env,XAUTHORITY:authority},windowsHide:true,stdio:'ignore'});
         child.on('error',()=>{stream.exit(1);stream.end();close();});child.on('exit',code=>{if(!closed){stream.exit(code??1);stream.end();}});
       })().catch(()=>{stream.exit(1);stream.end();close();});});
     });
   }));
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {port:(server.address() as {port:number}).port,async close(){for(const close of [...cleanups])close();for(const client of clients)client.end();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true});}};
}
