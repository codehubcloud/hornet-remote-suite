import { createServer,type Socket,type Server } from 'node:net';
import { posix } from 'node:path';
export async function ftpFixture(){
 let failCommit=false;
 const files=new Map<string,Buffer>(),commands:string[]=[],sockets=new Set<Socket>(),passives=new Set<Server>();
 const server=createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});socket.write('220 fixture\r\n');let input='',cwd='/',ascii=false,renameFrom='',pending:Promise<Socket>|undefined;
  const reply=(text:string)=>socket.write(text+'\r\n');
  async function command(line:string){commands.push(line);const index=line.indexOf(' '),verb=(index<0?line:line.slice(0,index)).toUpperCase(),arg=index<0?'':line.slice(index+1),path=posix.resolve(cwd,arg);
   if(verb==='USER')reply('331 Password');else if(verb==='PASS')reply('230 Logged in');else if(verb==='FEAT')reply('211-Features\r\n UTF8\r\n MLST type*;size*;modify*;\r\n211 End');else if(['OPTS','STRU','MODE','NOOP'].includes(verb))reply('200 OK');else if(verb==='SYST')reply('215 UNIX Type: L8');else if(verb==='TYPE'){ascii=arg==='A';reply('200 OK');}else if(verb==='PWD')reply('257 "'+cwd+'"');else if(verb==='CWD'){cwd=path;reply('250 Directory changed');}
   else if(verb==='EPSV'){
    const dataServer=createServer();passives.add(dataServer);pending=new Promise(resolve=>dataServer.once('connection',data=>{sockets.add(data);data.on('error',()=>{});data.on('close',()=>sockets.delete(data));dataServer.close();passives.delete(dataServer);resolve(data);}));await new Promise<void>(resolve=>dataServer.listen(0,'127.0.0.1',resolve));reply('229 Entering Extended Passive Mode (|||'+(dataServer.address() as {port:number}).port+'|)');
   }else if(['MLSD','LIST','STOR','RETR'].includes(verb)){
    if(!pending){reply('425 No data connection');return;}const data=await pending;pending=undefined;reply('150 Opening data');
    if(verb==='MLSD'||verb==='LIST'){const listing=[...files].filter(([name])=>posix.dirname(name)===path).map(([name,body])=>'type=file;size='+body.length+';modify=20260101000000; '+posix.basename(name)+'\r\n').join('');data.end(listing,()=>reply('226 Complete'));}
    else if(verb==='RETR'){let body=files.get(path);if(!body){data.destroy();reply('550 Missing');return;}if(ascii)body=Buffer.from(body.toString('utf8').replace(/\r\n|\r|\n/g,'\r\n'));data.end(body,()=>reply('226 Complete'));}
    else{const chunks:Buffer[]=[];data.on('data',chunk=>chunks.push(Buffer.from(chunk)));data.on('end',()=>{let body=Buffer.concat(chunks);if(ascii)body=Buffer.from(body.toString('utf8').replace(/\r\n/g,'\n'));files.set(path,body);data.end();reply('226 Complete');});}
   }else if(verb==='RNFR'){renameFrom=path;reply('350 Rename');}else if(verb==='RNTO'){if(failCommit&&renameFrom.endsWith('.part')){failCommit=false;reply('550 Simulated commit failure');return;}const body=files.get(renameFrom);if(body&&!files.has(path)){files.set(path,body);files.delete(renameFrom);reply('250 Renamed');}else reply('550 Conflict');}else if(verb==='DELE'){files.delete(path);reply('250 Deleted');}else if(verb==='QUIT'){reply('221 Bye');socket.end();}else reply('502 Unsupported');
  }
  let queue=Promise.resolve();socket.on('data',data=>{input+=data.toString();for(let index;(index=input.indexOf('\r\n'))>=0;){const line=input.slice(0,index);input=input.slice(index+2);queue=queue.then(()=>command(line)).catch(()=>{socket.destroy();});}});
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));return {port:(server.address() as {port:number}).port,files,commands,failNextCommit(){failCommit=true;},async close(){for(const socket of sockets)socket.destroy();for(const passive of passives)passive.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}
