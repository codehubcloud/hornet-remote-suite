import { it, expect, vi } from 'vitest';
import { createServer, type Socket } from 'node:net';
import { once } from 'node:events';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { Client, Server, type Connection, type ServerChannel } from 'ssh2';
import { X11Service } from '../../services/x11/sessions';
import type { Connections } from '../../services/ssh/connections';
async function within<T>(work:Promise<T>,stage:string):Promise<T>{
 let timer:ReturnType<typeof setTimeout>;
 try{return await Promise.race([work,new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error('Timed out: '+stage)),3000);})]);}
 finally{clearTimeout(timer!);}
}

it('negotiates X11 over real SSH, replaces the cookie, retains an existing channel after command exit, and releases only its lease',async()=>{
  const real=randomBytes(16),sockets=new Set<Socket>();
  let received=Buffer.alloc(0);
  const local=createServer(socket=>{
    sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));
    socket.on('data',data=>{received=Buffer.concat([received,Buffer.from(data)]);if(received.length>=48)socket.write('display-reply');});
  });
  // Display ports are constrained by the public API. Skip occupied displays.
  let display=99;
  for(;display>=80;display--){
    try{await new Promise<void>((resolve,reject)=>{
      const error=(e:Error)=>{local.removeListener('listening',ready);reject(e);};
      const ready=()=>{local.removeListener('error',error);resolve();};
      local.once('error',error);local.once('listening',ready);local.listen(6000+display,'127.0.0.1');
    });break;}catch(error){if((error as NodeJS.ErrnoException).code!=='EADDRINUSE')throw error;}
  }
  if(display<80)throw new Error('No free fixture X11 display');
  const key=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs1',format:'pem'},publicKeyEncoding:{type:'pkcs1',format:'pem'}}).privateKey;
  let peer:Connection|undefined,command:ServerChannel|undefined,cookie='';
  const server=new Server({hostKeys:[key]},connection=>{
    peer=connection;connection.on('error',()=>{});
    connection.on('authentication',ctx=>ctx.accept());
    connection.on('ready',()=>connection.on('session',accept=>{
      const session=accept();
      // ssh2 1.17 returns a Buffer here despite the declared string type.
      session.on('x11',(accept,_reject,info)=>{cookie=info.cookie.toString();accept?.();});
      session.on('exec',accept=>{command=accept();});
    }));
  });
  const client=new Client();client.on('error',()=>{});
  const release=vi.fn();
  const connections={acquire:async()=>({connectionId:'fixture',leaseId:'x11-lease',generation:1}),get:()=>({client}),release};
  const service=new X11Service(connections as unknown as Connections);
  let forwarded:ServerChannel|undefined;
  try{
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    const ready=once(client,'ready');
    client.connect({host:'127.0.0.1',port:(server.address() as {port:number}).port,username:'fixture',hostVerifier:()=>true});
    await within(ready,'SSH ready');
    const authority=Buffer.concat([Buffer.from([255,255]),...[Buffer.alloc(0),Buffer.from(String(display)),Buffer.from('MIT-MAGIC-COOKIE-1'),real].flatMap(field=>{
      const length=Buffer.alloc(2);length.writeUInt16BE(field.length);return [length,field];
    })]);
    service.configure(display,authority);
    const {id}=await within(service.launch('owner','profile','fixture-x-app'),'launch');
    expect(cookie).toHaveLength(32);expect(cookie).not.toBe(real.toString('hex'));
    forwarded=await within(new Promise<ServerChannel>((resolve,reject)=>peer!.x11('127.0.0.1',6000,(error,channel)=>error?reject(error):resolve(channel))),'forward channel');
    forwarded.on('error',()=>{});
    const setup=Buffer.alloc(48);setup[0]=0x6c;setup.writeUInt16LE(11,2);setup.writeUInt16LE(18,6);setup.writeUInt16LE(16,8);setup.write('MIT-MAGIC-COOKIE-1',12);Buffer.from(cookie,'hex').copy(setup,32);
    const reply=once(forwarded,'data');forwarded.write(setup.subarray(0,8));forwarded.write(setup.subarray(8));
    expect((await within(reply,'display handshake'))[0].toString()).toBe('display-reply');
    expect(received.subarray(32,48)).toEqual(real);
    expect(service.status('owner').sessions[0]).toMatchObject({state:'running',activeChannels:1});
    command!.exit(0);command!.end();
    await vi.waitFor(()=>expect(service.status('owner').sessions[0].state).toBe('command-exited'));
    expect(release).not.toHaveBeenCalled();
    const extra=once(forwarded,'data');forwarded.write('still-open');
    expect((await within(extra,'existing channel after exit'))[0].toString()).toBe('display-reply');
    const closed=once(forwarded,'close');service.close('owner',id);await within(closed,'forward close');
    expect(release).toHaveBeenCalledExactlyOnceWith('owner','x11-lease');
    expect(client.listenerCount('x11')).toBe(0);
    await within(new Promise<void>((resolve,reject)=>client.exec('shared-connection-check',(error,stream)=>{
      if(error){reject(error);return;}stream.on('error',()=>{});stream.destroy();resolve();
    })),'shared connection remains usable');
  }finally{
    service.stop();forwarded?.destroy();client.destroy();peer?.end();
    for(const socket of sockets)socket.destroy();
    await Promise.all([new Promise<void>(r=>local.close(()=>r())),new Promise<void>(r=>server.close(()=>r()))]);
  }
},15000);
