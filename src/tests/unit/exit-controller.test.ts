import { afterEach,it,expect,vi } from 'vitest';
import { ExitController } from '../../apps/desktop/main/exit-controller';
afterEach(()=>vi.useRealTimers());
it('prompts immediately, coalesces repeated close clicks and allows cancellation',async()=>{
 let resolve!:(value:boolean)=>void;
 const confirm=vi.fn(()=>new Promise<boolean>(r=>{resolve=r;})),cleanup=vi.fn(),finish=vi.fn();
 const exit=new ExitController(confirm,cleanup,finish);
 const first=exit.request();await exit.request();expect(confirm).toHaveBeenCalledTimes(1);
 resolve(false);await first;expect(cleanup).not.toHaveBeenCalled();expect(finish).not.toHaveBeenCalled();
 const next=exit.request();expect(confirm).toHaveBeenCalledTimes(2);resolve(true);await next;expect(finish).toHaveBeenCalledTimes(1);
});
it('exits within five seconds even when both backend and log cleanup never respond',async()=>{
 vi.useFakeTimers();const finish=vi.fn(),exit=new ExitController(async()=>true,()=>new Promise(()=>{}),finish);
 const result=exit.request();await vi.advanceTimersByTimeAsync(4999);expect(finish).not.toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(1);await result;expect(finish).toHaveBeenCalledTimes(1);
 await exit.request();expect(finish).toHaveBeenCalledTimes(1);
});
it('finishes early on successful cleanup and also exits if cleanup fails',async()=>{
 vi.useFakeTimers();
 for(const cleanup of [async()=>{},async()=>{throw new Error('backend gone');}]){
  const finish=vi.fn();await new ExitController(async()=>true,cleanup,finish).request();expect(finish).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
 }
});
