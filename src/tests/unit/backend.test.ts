import { afterEach,it,expect,vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Backend } from '../../apps/desktop/main/backend';
import type { Vault } from '../../apps/desktop/main/vault';

vi.mock('electron',async()=>{
 const {EventEmitter}=await import('node:events');
 return {app:{isPackaged:false},powerMonitor:new EventEmitter(),utilityProcess:{fork:vi.fn()}};
});
import { powerMonitor,utilityProcess } from 'electron';
afterEach(()=>{vi.useRealTimers();powerMonitor.removeAllListeners();vi.clearAllMocks();});
async function fixture(){
 vi.useFakeTimers();
 const child=Object.assign(new EventEmitter(),{postMessage:vi.fn(),kill:vi.fn(),stderr:new EventEmitter()});
 vi.mocked(utilityProcess.fork).mockReturnValue(child as any);
 const emit=vi.fn(),backend=new Backend({get:vi.fn()} as unknown as Vault,emit);
 const starting=backend.start('temporary');child.emit('message',{type:'ready'});await starting;
 return {backend,child,emit};
}
it('keeps pending requests alive across suspend/resume and resolves the actual result',async()=>{
 const f=await fixture();
 try{
  const result=f.backend.call('x11.status',{},undefined,5000),sent=f.child.postMessage.mock.calls[0][0];
  await vi.advanceTimersByTimeAsync(2000);powerMonitor.emit('suspend');
  await vi.advanceTimersByTimeAsync(3600000);expect(f.child.kill).not.toHaveBeenCalled();
  powerMonitor.emit('resume');await vi.advanceTimersByTimeAsync(2000);
  f.child.emit('message',{type:'result',requestId:sent.requestId,result:{ok:true,data:{configured:false}}});
  expect(await result).toEqual({configured:false});
 }finally{f.child.emit('exit',0);}
});
it('probes a missing heartbeat before termination and rejects new requests immediately after exit',async()=>{
 const f=await fixture();
 await vi.advanceTimersByTimeAsync(30000);expect(f.child.postMessage).toHaveBeenCalledWith({type:'ping'});expect(f.child.kill).not.toHaveBeenCalled();
 f.child.emit('message',{type:'heartbeat'});await vi.advanceTimersByTimeAsync(29000);expect(f.child.kill).not.toHaveBeenCalled();
 f.child.emit('exit',1);await expect(f.backend.call('profile.list')).rejects.toThrow('后台服务已退出');
});
it('expires an unanswered request while the backend remains responsive',async()=>{
 const f=await fixture();
 try{
  const result=expect(f.backend.call('file.list',{},undefined,3000)).rejects.toThrow('请求超时');
  await vi.advanceTimersByTimeAsync(3000);await result;expect(f.child.kill).not.toHaveBeenCalled();
 }finally{f.child.emit('exit',0);}
});
it('forces shutdown without waiting for a reply and rejects outstanding requests once',async()=>{
 const f=await fixture();
 const pending=expect(f.backend.call('file.list')).rejects.toThrow('正在退出');
 f.backend.forceStop();f.backend.forceStop();await pending;
 expect(f.child.kill).toHaveBeenCalledTimes(1);expect(powerMonitor.listenerCount('resume')).toBe(0);
 await expect(f.backend.call('profile.list')).rejects.toThrow('后台服务已退出');f.child.emit('exit',0);
});
