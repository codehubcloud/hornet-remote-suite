import { describe,it,expect,vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { Client } from 'ssh2';
import { detectRemoteSystem,parseRemoteSystem } from '../../services/ssh/remote-system';
import { Storage } from '../../packages/storage/database';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
describe('remote system detection',()=>{
 it('falls back to Windows when Unix commands are denied, and abandons an unresponsive exec channel',async()=>{
  const commands:string[]=[];
  const client={exec(command:string,reply:Function){commands.push(command);if(command.startsWith('uname')){reply(new Error('denied'));return;}const stream=Object.assign(new EventEmitter(),{stderr:new EventEmitter(),destroy:vi.fn()});reply(null,stream);queueMicrotask(()=>{stream.emit('data',Buffer.from('Microsoft Windows [Version 10]'));stream.emit('close');});}} as unknown as Client;
  expect(await detectRemoteSystem(client)).toBe('windows');expect(commands).toEqual(['uname -s; cat /etc/os-release 2>/dev/null','cmd /c ver']);
  vi.useFakeTimers();try{const stream=Object.assign(new EventEmitter(),{stderr:new EventEmitter(),destroy:vi.fn()});const hanging={exec(_command:string,reply:Function){reply(null,stream);}} as unknown as Client;const pending=detectRemoteSystem(hanging);await vi.advanceTimersByTimeAsync(5000);expect(await pending).toBeUndefined();expect(stream.destroy).toHaveBeenCalledTimes(2);}finally{vi.useRealTimers();}
 });
 it('recognizes os-release without evaluating remote shell content and falls back to the kernel',()=>{
  for(const [output,expected] of [['Linux\nID="ubuntu"\n','ubuntu'],['Linux\nID=debian\n','debian'],['Linux\nID="rocky"\n','rocky'],['Linux\nID=opensuse-leap\n','suse'],['Linux\nID=__proto__\n','linux'],['Darwin\n','macos'],['Microsoft Windows [Version 10.0.1]','windows'],['FreeBSD\n','freebsd'],['Linux\nID="$(anything)"','linux'],['command not found',undefined]])expect(parseRemoteSystem(output!)).toBe(expected);
 });
 it('preserves detected metadata on cosmetic edits without changing credential revision, and invalidates it when the host changes',()=>{
  const db=new Storage(':memory:',resolve('packages/storage/schema.sql'));
  try{
   const p=db.saveProfile({profileId:randomUUID(),name:'server',host:'localhost',port:22,username:'test',group:'',authType:'password',revision:0},0);
   expect(db.rememberSystem(p,'ubuntu')).toBe(true);expect(db.profile(p.profileId)).toEqual({...p,remoteSystem:'ubuntu'});
   const renamed=db.saveProfile({...p,name:'renamed'},p.revision);expect(renamed.remoteSystem).toBe('ubuntu');
   const moved=db.saveProfile({...renamed,host:'other'},renamed.revision);expect(moved.remoteSystem).toBeUndefined();
   expect(db.rememberSystem(p,'windows')).toBe(false);expect(db.profile(p.profileId).remoteSystem).toBeUndefined();
  }finally{db.close();}
 });
});
