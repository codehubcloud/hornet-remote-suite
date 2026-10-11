import { createServer,type Socket } from 'node:net';
export async function telnetFixture(){
 const peers:{socket:Socket;input:Buffer;terminalType:string;cols:number;rows:number}[]=[];
 const server=createServer(socket=>{
  const peer={socket,input:Buffer.alloc(0),terminalType:'',cols:0,rows:0};peers.push(peer);socket.setNoDelay(true);socket.on('error',()=>{});
  let state=0,command=0,sub:number[]=[];
  socket.on('data',(chunk:Buffer)=>{
   const payload:number[]=[];
   for(const b of chunk){
    if(state===0){if(b===255)state=1;else payload.push(b);}
    else if(state===1){if(b===255){payload.push(b);state=0;}else if(b===250){sub=[];state=3;}else if(b>=251&&b<=254){command=b;state=2;}else state=0;}
    else if(state===2){if(command===251&&b===24)socket.write(Buffer.from([255,250,24,1,255,240]));if(command===251&&b===3)socket.write(Buffer.from([255,253,3]));state=0;}
    else if(state===3){if(b===255)state=4;else sub.push(b);}
    else if(b===255){sub.push(255);state=3;}
    else{if(b===240&&sub[0]===24&&sub[1]===0)peer.terminalType=Buffer.from(sub.slice(2)).toString();if(b===240&&sub[0]===31&&sub.length===5){peer.cols=sub[1]*256+sub[2];peer.rows=sub[3]*256+sub[4];}state=0;}
   }
   if(payload.length){const data=Buffer.from(payload);peer.input=Buffer.concat([peer.input,data]);socket.write('echo:'+data.toString().replace(/\r/g,'\r\n'));}
  });
  socket.write(Buffer.from([255]));socket.write(Buffer.from([251,1,255,251,3,255,253,24,255,253,31,255,253,0,255,251,0]));
  socket.write('Telnet fixture ready\r\n');
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {peers,port:(server.address() as {port:number}).port,async close(){for(const p of peers)p.socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}
