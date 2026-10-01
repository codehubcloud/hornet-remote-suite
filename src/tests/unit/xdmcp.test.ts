import { expect,it } from 'vitest';
import { createSocket } from 'node:dgram';
import { once } from 'node:events';
import { parseReply,queryXdmcp,validateEndpoint } from '../../services/x11/xdmcp';
import { xdmcpConfigSchema,xServerOptionsSchema } from '../../packages/contracts/native';
function reply(opcode=5,fields=['','fixture','Ready']){
 const body=Buffer.concat(fields.map(value=>{const text=Buffer.from(value),length=Buffer.alloc(2);length.writeUInt16BE(text.length);return Buffer.concat([length,text]);}));
 const header=Buffer.alloc(6);header.writeUInt16BE(1);header.writeUInt16BE(opcode,2);header.writeUInt16BE(body.length,4);return Buffer.concat([header,body]);
}
it('strictly decodes willing and unwilling messages and strips control characters',()=>{
 expect(parseReply(reply(),'127.0.0.1')).toEqual({host:'127.0.0.1',willing:true,hostname:'fixture',status:'Ready'});
 expect(parseReply(reply(6,['server','Denied\0\n']),'127.0.0.1')).toMatchObject({willing:false,status:'Denied  '});
 const valid=reply();for(let length=0;length<valid.length;length++)expect(parseReply(valid.subarray(0,length),'x')).toBeUndefined();
 expect(parseReply(Buffer.concat([valid,Buffer.from([0])]),'x')).toBeUndefined();
 expect(parseReply(reply(5,['unsupported-auth','host','ready']),'x')).toBeUndefined();
 expect(parseReply(reply(8),'x')).toBeUndefined();
});
it('requires explicit network consent and a local interface, rejecting public and multicast destinations',()=>{
 expect(()=>xServerOptionsSchema.parse({mode:'multiWindow',dpi:96})).toThrow();
 expect(()=>xdmcpConfigSchema.parse({host:'127.0.0.1',localAddress:'127.0.0.1',display:20,port:177,allowNetworkListener:true})).toThrow();
 for(const host of ['8.8.8.8','224.0.0.1','255.255.255.255','192.168.0.255','127.0.0.999'])expect(()=>validateEndpoint(host,'127.0.0.1')).toThrow();
 expect(()=>validateEndpoint('127.0.0.1','192.0.2.1')).toThrow();
});
it('sends a real unicast Query, ignores malformed/spoofed replies, and accepts the selected server response',async()=>{
 const server=createSocket('udp4'),other=createSocket('udp4');server.bind(0,'127.0.0.1');await once(server,'listening');other.bind(0,'127.0.0.1');await once(other,'listening');
 let seen:Buffer|undefined;
 server.on('message',(packet,remote)=>{seen=packet;other.send(reply(6,['spoofed','Denied']),remote.port,remote.address);server.send(Buffer.from([0]),remote.port,remote.address);setTimeout(()=>server.send(reply(),remote.port,remote.address),20);});
 try{expect(await queryXdmcp('127.0.0.1','127.0.0.1',server.address().port)).toMatchObject({willing:true,hostname:'fixture'});expect(seen).toEqual(Buffer.from([0,1,0,2,0,1,0]));}
 finally{server.close();other.close();}
});
it('cancels a pending UDP query promptly without leaving a listener',async()=>{
 const server=createSocket('udp4');server.bind(0,'127.0.0.1');await once(server,'listening');
 try{const abort=new AbortController(),query=queryXdmcp('127.0.0.1','127.0.0.1',server.address().port,abort.signal);abort.abort();await expect(query).rejects.toMatchObject({code:'IPC006'});}
 finally{server.close();}
});
