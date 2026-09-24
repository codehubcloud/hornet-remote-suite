import { randomUUID } from 'node:crypto';
import type { Client,ClientChannel,SFTPWrapper } from 'ssh2';

// Bound subsystem startup as well as the request. A late reply cannot enable a
// different terminal or leave an auxiliary command channel running.
export function sftpDirectoryLink(getSftp:()=>Promise<SFTPWrapper>,path:string):Promise<string|null>{
 return new Promise(resolve=>{
  let done=false;
  const finish=(value:string|null)=>{if(done)return;done=true;clearTimeout(timer);resolve(value);};
  const timer=setTimeout(()=>finish(null),8000);
  void getSftp().then(sftp=>{if(!done)sftp.readlink(path,(error,value)=>finish(error?null:value));}).catch(()=>finish(null));
 });
}

export function execDirectoryLink(client:Client,path:string):Promise<string|null>{
 // Only service-generated proc paths may enter a command. Never interpolate a
 // user command, hostname or a remotely reported working directory here.
 if(!/^\/proc\/(?:self|[1-9][0-9]{0,9}\/cwd)$/.test(path))return Promise.resolve(null);
 const marker='HornetDirectory-'+randomUUID()+':';
 return new Promise(resolve=>{
  let done=false,channel:ClientChannel|undefined,output='';
  const finish=(value:string|null)=>{if(done)return;done=true;clearTimeout(timer);channel?.destroy();resolve(value);};
  const timer=setTimeout(()=>finish(null),8000);
  try{client.exec("printf '"+marker+"'; readlink "+path,(error,stream)=>{
   if(done){stream?.destroy();return;}
   if(error){finish(null);return;}
   channel=stream;
   stream.setEncoding('utf8');
   stream.on('data',(data:string)=>{output+=data;if(Buffer.byteLength(output)>16384)finish(null);});
   stream.stderr.on('data',()=>{});
   stream.on('error',()=>finish(null));
   stream.on('close',(code:number)=>{
    const offset=output.indexOf(marker);
    finish(code===0&&offset>=0?output.slice(offset+marker.length).replace(/\r?\n$/,''):null);
   });
  });}catch{finish(null);}
 });
}
