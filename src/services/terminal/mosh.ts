import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import type { Profile } from '../../packages/contracts';
import type { DeviceTerminals } from './devices';
import { AppError } from '../../packages/core/errors';

export function moshExecutable():string|undefined{
 const command=process.platform==='win32'?'mosh.exe':'mosh';
 const result=spawnSync(process.platform==='win32'?'where.exe':'which',[command],{encoding:'utf8',windowsHide:true,timeout:1500});
 return result.status===0?result.stdout.split(/\r?\n/).map(s=>s.trim()).find(Boolean):undefined;
}

export async function openMosh(terminals:DeviceTerminals,owner:string,profile:Profile,cols:number,rows:number){
 if((profile.protocol??'ssh')!=='ssh'||!profile.session?.mosh)throw new AppError('MOSH_PROFILE','Choose a Mosh session.');
 const executable=moshExecutable();
 if(!executable)throw new AppError('MOSH_UNAVAILABLE','Mosh is not installed or is missing from PATH. Install the Mosh client and ensure the server has mosh-server.');
 if(!/^[a-zA-Z0-9._:-]+$/.test(profile.host)||!/^[a-zA-Z0-9._-]+$/.test(profile.username))throw new AppError('MOSH_PROFILE','Mosh requires a valid host name and Unix user name.');
 return terminals.open(owner,{name:'Mosh',address:`${profile.username}@${profile.host}:${profile.port}`,source:'mosh'},async events=>{
  const {spawn}=await import('node-pty');
  const env={...process.env,TERM:'xterm-256color',COLORTERM:'truecolor'};
  for(const key of Object.keys(env))if(/^(ELECTRON_|NODE_OPTIONS$|NODE_INSPECT_RESUME_ON_START$|HORNET_)/i.test(key))delete env[key as keyof typeof env];
  const args=[`--ssh=ssh -p ${profile.port}`,`${profile.username}@${profile.host}`];
  const child=spawn(executable,args,{name:'xterm-256color',cols,rows,cwd:homedir(),env,...(process.platform==='win32'?{useConpty:true,useConptyDll:true,conptyInheritCursor:false}:{})});
  let exited=false,closed=false;let resolveExit!:()=>void;
  const exit=new Promise<void>(resolve=>{resolveExit=resolve;});
  const data=child.onData(value=>events.data(Buffer.from(value,'utf8')));
  const end=child.onExit(({exitCode})=>{exited=true;resolveExit();events.end(exitCode?'Mosh client exited with code '+exitCode:undefined);});
  child.pause();
  return {write:(value:string)=>child.write(value),resize:(width:number,height:number)=>child.resize(width,height),pause:()=>{if(!exited)child.pause();},resume:()=>{if(!exited)child.resume();},async close(){if(closed)return;closed=true;try{child.resume();child.kill();if(!exited){let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([exit,new Promise<void>(resolve=>{timer=setTimeout(resolve,3000);})]);}finally{clearTimeout(timer);}}}finally{data.dispose();end.dispose();}}};
 });
}
