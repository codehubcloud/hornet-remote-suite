import { it,expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { rewriteSetup,authorityCookie } from '../../services/x11/proxy';
import { proxyX11 } from '../../services/x11/proxy';
import { createServer,createConnection,type Socket } from 'node:net';
import { once } from 'node:events';
for(const little of [true,false])it(`X11 validates and replaces cookies in ${little?'little':'big'} endian setup`,()=>{
 const fake=randomBytes(16),real=randomBytes(16),packet=Buffer.alloc(48);packet[0]=little?0x6c:0x42;
 const put=(n:number,at:number)=>little?packet.writeUInt16LE(n,at):packet.writeUInt16BE(n,at);
 put(11,2);put(18,6);put(16,8);packet.write('MIT-MAGIC-COOKIE-1',12);fake.copy(packet,32);
 expect(rewriteSetup(packet.subarray(0,30),fake,real)).toBeUndefined();expect(rewriteSetup(packet,fake,real)!.subarray(32)).toEqual(real);
 expect(()=>rewriteSetup(packet,randomBytes(16),real)).toThrow();packet[0]=0;expect(()=>rewriteSetup(packet,fake,real)).toThrow();
});
it('Xauthority selects matching display cookie and rejects truncated input',()=>{
 const real=randomBytes(16),fields=[Buffer.alloc(0),Buffer.from('3'),Buffer.from('MIT-MAGIC-COOKIE-1'),real];
 const bytes=Buffer.concat([Buffer.from([255,255]),...fields.flatMap(v=>{const size=Buffer.alloc(2);size.writeUInt16BE(v.length);return [size,v];})]);
 expect(authorityCookie(bytes,3)).toEqual(real);expect(()=>authorityCookie(bytes,4)).toThrow();expect(()=>authorityCookie(bytes.subarray(0,bytes.length-2),3)).toThrow();
});
it('X11 proxy handles split setup before forwarding to the local display and cleans both streams',async()=>{
 const fake=randomBytes(16),real=randomBytes(16),sockets=new Set<Socket>();let received=Buffer.alloc(0);
 const local=createServer(socket=>{sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));socket.on('data',data=>{received=Buffer.concat([received,Buffer.from(data)]);if(received.length>=48)socket.write('accepted');});});
 await new Promise<void>(r=>local.listen(0,'127.0.0.1',r));
 const proxy=createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));proxyX11(socket,fake,real,(local.address() as {port:number}).port,()=>{});});await new Promise<void>(r=>proxy.listen(0,'127.0.0.1',r));
 const client=createConnection({host:'127.0.0.1',port:(proxy.address() as {port:number}).port});client.on('error',()=>{});
 try{await once(client,'connect');const setup=Buffer.alloc(48);setup[0]=0x6c;setup.writeUInt16LE(11,2);setup.writeUInt16LE(18,6);setup.writeUInt16LE(16,8);setup.write('MIT-MAGIC-COOKIE-1',12);fake.copy(setup,32);
  const response=once(client,'data');client.write(setup.subarray(0,8));await new Promise(r=>setTimeout(r,10));client.write(setup.subarray(8));expect((await response)[0].toString()).toBe('accepted');expect(received.subarray(32,48)).toEqual(real);
 }finally{client.destroy();for(const s of sockets)s.destroy();await Promise.all([new Promise<void>(r=>proxy.close(()=>r())),new Promise<void>(r=>local.close(()=>r()))]);}
});
