import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
export const nativePath = () => join(__dirname, 'NativeHost.exe');
export function nativeCall(input: object, timeout = 15000): Promise<any> {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32' || !existsSync(nativePath())) { reject(new Error('Windows 原生辅助程序不可用。')); return; }
    const child = spawn(nativePath(), [], { windowsHide: true, stdio: 'pipe' });
    let output = ''; const timer = setTimeout(() => { child.kill(); reject(new Error('系统操作超时。')); }, timeout);
    child.stdin.on('error', () => {});child.stdout.on('data', data => { output += data.toString(); if(output.length > 65536)child.kill(); });
    child.stderr.resume(); child.once('error', e => { clearTimeout(timer); reject(e); });
    child.once('exit', code => { clearTimeout(timer); try { const value=JSON.parse(output.trim());if(code!==0||value.error)throw new Error('系统操作失败。');resolve(value); }catch(e){reject(e);} });
    child.stdin.end(JSON.stringify(input)+'\n');
  });
}
export class RdpService {
  private sessions=new Map<string,{child:ChildProcessWithoutNullStreams;state:string;reason?:number}>();
  async probe(){try{return await nativeCall({op:'rdpProbe'});}catch{return {available:false,presentation:'managed-native-window'};}}
  list(){return [...this.sessions].map(([id,s])=>({id,state:s.state,reason:s.reason}));}
  open(input:object){
    if(this.sessions.size>=8)throw new Error('请先关闭现有 RDP 会话。');
    const id=randomUUID(),child=spawn(nativePath(),[],{windowsHide:true,stdio:'pipe'}),session={child,state:'starting',reason:undefined as number|undefined};
    this.sessions.set(id,session);let buffer='';
    child.stdin.on('error',()=>{});child.stderr.resume();
    child.stdout.on('data',data=>{buffer+=data.toString();if(buffer.length>65536){child.kill();return;}let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);try{const value=JSON.parse(line);session.state=value.error?'failed':value.state??session.state;session.reason=value.reason;}catch{}}});
    child.once('error',()=>{session.state='failed';});child.once('exit',()=>{if(session.state!=='failed')session.state='disconnected';});
    child.stdin.write(JSON.stringify({...input,op:'rdp'})+'\n');return {id};
  }
  close(id:string){const session=this.sessions.get(id);if(!session)return;session.child.stdin.end('close\n');const timer=setTimeout(()=>session.child.kill(),2000);timer.unref();session.child.once('exit',()=>clearTimeout(timer));this.sessions.delete(id);}
  stop(){for(const id of this.sessions.keys())this.close(id);}
}
