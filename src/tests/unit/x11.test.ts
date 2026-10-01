import { it,expect,vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { rewriteSetup,authorityCookie } from '../../services/x11/proxy';
import { proxyX11 } from '../../services/x11/proxy';
import { createServer,createConnection,type Socket } from 'node:net';
import { once } from 'node:events';
function setupPacket(cookie:Buffer){
 const packet=Buffer.alloc(48);packet[0]=0x6c;packet.writeUInt16LE(11,2);packet.writeUInt16LE(18,6);packet.writeUInt16LE(16,8);packet.write('MIT-MAGIC-COOKIE-1',12);cookie.copy(packet,32);return packet;
}
it('rejects invalid cookie sizes and non-ASCII authentication names without mutating the packet',()=>{
 const fake=randomBytes(16),real=randomBytes(16),packet=setupPacket(fake),copy=Buffer.from(packet);
 expect(()=>rewriteSetup(packet,fake,Buffer.alloc(15))).toThrow('长度');
 expect(()=>rewriteSetup(packet,Buffer.alloc(15),real)).toThrow('长度');
 expect(packet).toEqual(copy);
 packet[12]|=0x80;
 expect(()=>rewriteSetup(packet,fake,real)).toThrow('拒绝');
});
it('reports rejected cookies once and destroys the unauthenticated channel',()=>{
 const channel=new PassThrough(),finished=vi.fn();
 const stop=proxyX11(channel,randomBytes(16),randomBytes(16),6000,finished);
 channel.write(setupPacket(randomBytes(16)));
 expect(channel.destroyed).toBe(true);expect(finished).toHaveBeenCalledWith(expect.objectContaining({code:'X11_COOKIE_REJECTED'}));
 stop();expect(finished).toHaveBeenCalledTimes(1);
});
it('closes a truncated handshake on EOF even when the transport allows half-open streams',async()=>{
 const channel=new PassThrough({allowHalfOpen:true}),finished=vi.fn();
 proxyX11(channel,randomBytes(16),randomBytes(16),6000,finished);
 const closed=once(channel,'close');channel.end(Buffer.from([0x6c]));await closed;
 expect(finished).toHaveBeenCalledOnce();expect(finished).toHaveBeenCalledWith(expect.objectContaining({code:'X11_FORWARD_DENIED'}));
});
it('expires incomplete handshakes and clears their deadline on explicit stop',async()=>{
 vi.useFakeTimers();
 const channel=new PassThrough(),finished=vi.fn();
 const stop=proxyX11(channel,randomBytes(16),randomBytes(16),6000,finished);
 try{await vi.advanceTimersByTimeAsync(10000);expect(channel.destroyed).toBe(true);expect(finished).toHaveBeenCalledOnce();stop();await vi.advanceTimersByTimeAsync(10000);expect(finished).toHaveBeenCalledOnce();}
 finally{stop();vi.useRealTimers();}
});
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
