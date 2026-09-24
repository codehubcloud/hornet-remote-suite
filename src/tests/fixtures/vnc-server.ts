import { createServer, type Socket } from 'node:net';
export async function vncFixture(){
 const sockets=new Set<Socket>();let keys=0,pointers=0;
 const server=createServer(socket=>{
  sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));socket.write('RFB 003.008\n');let state=0,buffer=Buffer.alloc(0);
  socket.on('data',chunk=>{
   buffer=Buffer.concat([buffer,Buffer.from(chunk)]);
   while(buffer.length){
    if(state===0){if(buffer.length<12)return;buffer=buffer.subarray(12);socket.write(Buffer.from([1,1]));state=1;}
    else if(state===1){if(buffer[0]!==1){socket.destroy();return;}buffer=buffer.subarray(1);socket.write(Buffer.alloc(4));state=2;}
    else if(state===2){buffer=buffer.subarray(1);const name=Buffer.from('Hornet VNC fixture'),init=Buffer.alloc(24);init.writeUInt16BE(64,0);init.writeUInt16BE(48,2);init[4]=32;init[5]=24;init[7]=1;init.writeUInt16BE(255,8);init.writeUInt16BE(255,10);init.writeUInt16BE(255,12);init[14]=16;init[15]=8;init.writeUInt32BE(name.length,20);socket.write(Buffer.concat([init,name]));state=3;}
    else {
     let size=0;
     if(buffer[0]===0)size=20;
     else if(buffer[0]===2){if(buffer.length<4)return;size=4+buffer.readUInt16BE(2)*4;}
     else if(buffer[0]===3)size=10;
     else if(buffer[0]===4)size=8;
     else if(buffer[0]===5)size=6;
     else if(buffer[0]===6){if(buffer.length<8)return;size=8+buffer.readUInt32BE(4);}
     else {socket.destroy();return;}
     if(size>1024*1024){socket.destroy();return;}if(buffer.length<size)return;
     const type=buffer[0];buffer=buffer.subarray(size);
     if(type===4)keys++;if(type===5)pointers++;
     if(type===3){const header=Buffer.alloc(16);header.writeUInt16BE(1,2);header.writeUInt16BE(64,8);header.writeUInt16BE(48,10);const pixels=Buffer.alloc(64*48*4);for(let i=0;i<pixels.length;i+=4)pixels[i+1]=200;socket.write(Buffer.concat([header,pixels]));}
    }
   }
  });
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 return {port:(server.address() as {port:number}).port,get keys(){return keys;},get pointers(){return pointers;},async close(){for(const socket of sockets)socket.destroy();await new Promise<void>(r=>server.close(()=>r()));}};
}
