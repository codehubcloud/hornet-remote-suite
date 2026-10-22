import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { homedir,release } from 'node:os';
import { join,isAbsolute } from 'node:path';
import type { LocalTerminalConfig } from '../../packages/contracts/device-terminal';
import { localTerminalSchema } from '../../packages/contracts/device-terminal';
import type { DeviceTerminals,DriverEvents,TerminalDriver } from './devices';
import { AppError } from '../../packages/core/errors';

export function localShells(){
 if(process.platform!=='win32'||Number(release().split('.')[2])<18309)return [];
 const system=join(process.env.SystemRoot??'C:\\Windows','System32');
 return [{id:'powershell' as const,name:'Windows PowerShell',path:join(system,'WindowsPowerShell','v1.0','powershell.exe')},{id:'cmd' as const,name:'命令提示符 CMD',path:join(system,'cmd.exe')},{id:'wsl' as const,name:'WSL',path:join(system,'wsl.exe')}].filter(s=>existsSync(s.path));
}
export async function openLocal(terminals:DeviceTerminals,owner:string,input:LocalTerminalConfig){
 const config=localTerminalSchema.parse(input),shell=localShells().find(s=>s.id===config.shell);
 if(!shell)throw new AppError('LOCAL_UNAVAILABLE','本地终端需要 Windows 10 1903 或更新版本及对应系统 Shell。');
 const isWsl=config.shell==='wsl',cwd=config.cwd?.trim()||(isWsl?'~':homedir());
 if(!isWsl&&(!isAbsolute(cwd)||!(await stat(cwd).catch(()=>null))?.isDirectory()))throw new AppError('LOCAL_DIRECTORY','请选择存在的绝对目录路径。');
 return terminals.open(owner,{name:shell.name,address:isWsl?(config.distribution||'default')+' · '+cwd:cwd,source:'local'},async events=>{
  // Keep native module loading lazy; a missing adapter must not stop SSH.
  const {spawn}=await import('node-pty');
  const env={...process.env,TERM:'xterm-256color',COLORTERM:'truecolor'};
  for(const key of Object.keys(env))if(/^(ELECTRON_|NODE_OPTIONS$|NODE_INSPECT_RESUME_ON_START$|HORNET_)/i.test(key))delete env[key as keyof typeof env];
  const args=config.shell==='cmd'?['/d','/k','chcp 65001>nul']:config.shell==='powershell'?['-NoLogo','-NoProfile']:[...(config.distribution?['--distribution',config.distribution]:[]),'--cd',cwd];
  const child=spawn(shell.path,args,{name:'xterm-256color',cols:config.cols,rows:config.rows,cwd:isWsl?homedir():cwd,env,useConpty:true,useConptyDll:true,conptyInheritCursor:false});
  return ptyDriver(child,events);
 });
}
function ptyDriver(child:import('node-pty').IPty,events:DriverEvents):TerminalDriver{
 let exited=false,closed=false;let resolveExit!:()=>void;
 const exit=new Promise<void>(resolve=>{resolveExit=resolve;});
 const data=child.onData(value=>events.data(Buffer.from(value,'utf8')));
 const end=child.onExit(({exitCode})=>{exited=true;resolveExit();events.end(exitCode?'本地 Shell 已退出，退出码 '+exitCode:undefined);});
 child.pause();
 return {write:value=>child.write(value),resize:(cols,rows)=>child.resize(cols,rows),pause:()=>{if(!exited)child.pause();},resume:()=>{if(!exited)child.resume();},async close(){
  if(closed)return;closed=true;
  try{child.resume();child.kill();if(!exited){let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([exit,new Promise<void>(resolve=>{timer=setTimeout(resolve,3000);})]);}finally{clearTimeout(timer);}}}finally{data.dispose();end.dispose();}
 }};
}
