import { createSocket } from 'node:dgram';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { spawn,type ChildProcess } from 'node:child_process';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { encodeAuthority } from '../../services/x11/engine';

export function xdmcpPacket(opcode:number,parts:Buffer[]){
 const body=Buffer.concat(parts),header=Buffer.alloc(6);header.writeUInt16BE(1);header.writeUInt16BE(opcode,2);header.writeUInt16BE(body.length,4);return Buffer.concat([header,body]);
}
function field(value:string|Buffer){const data=typeof value==='string'?Buffer.from(value):value,length=Buffer.alloc(2);length.writeUInt16BE(data.length);return Buffer.concat([length,data]);}
// A test display manager: real wire negotiation, followed by a real X client (no login authentication).
export async function xdmcpFixture(engineDirectory:string){
 const socket=createSocket('udp4'),cookie=randomBytes(16),root=await mkdtemp(join(tmpdir(),'hornet-xdmcp-fixture-'));
 const sessionId=Buffer.from([0,0,0,1]),opcodes:number[]=[];let display:number|undefined,client:ChildProcess|undefined,managed=false,error:string|undefined;
 socket.on('error',e=>{error=e.message;});
 socket.on('message',(data,peer)=>{
   if(data.length<6||data.readUInt16BE(0)!==1||data.readUInt16BE(4)!==data.length-6)return;
   const send=(op:number,fields:Buffer[])=>socket.send(xdmcpPacket(op,fields),peer.port,peer.address);
   const opcode=data.readUInt16BE(2);
   opcodes.push(opcode);
   if(opcode===2)send(5,[field(''),field('Hornet fixture'),field('Ready for protocol test')]);
   if(opcode===7&&data.length>=8){display=data.readUInt16BE(6);send(8,[sessionId,field(''),field(''),field('MIT-MAGIC-COOKIE-1'),field(cookie)]);}
   if(opcode===10&&display!==undefined&&!managed){
     managed=true;const number=display;
     void (async()=>{
       const authority=join(root,'authority');await writeFile(authority,encodeAuthority(number,cookie),{mode:0o600});
       client=spawn(join(engineDirectory,'xclock.exe'),['-display',peer.address+':'+number,'-title','Hornet XDMCP smoke','-geometry','220x220+40+40'],{env:{...process.env,XAUTHORITY:authority},stdio:'ignore',windowsHide:true});
       client.on('error',e=>{error=e.message;});
     })().catch(e=>{error=String(e);});
   }
   if(opcode===13)send(14,[Buffer.from([1]),sessionId]);
 });
 socket.bind(0,'127.0.0.1');await once(socket,'listening');
 return {port:socket.address().port,cookie,opcodes,get display(){return display;},get managed(){return managed;},get error(){return error;},authority:join(root,'authority'),async close(){socket.close();if(client&&client.exitCode===null&&client.signalCode===null){const exited=once(client,'exit');client.kill();await exited;}cookie.fill(0);await rm(root,{recursive:true,force:true});}};
}
