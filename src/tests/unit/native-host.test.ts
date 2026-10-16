import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { nativeCall,RdpService } from '../../services/native/host';
vi.mock('node:child_process',()=>({spawn:vi.fn()}));
vi.mock('node:fs',async importOriginal=>({...await importOriginal<typeof import('node:fs')>(),existsSync:()=>true}));
const platform=Object.getOwnPropertyDescriptor(process,'platform')!;
function child(){return Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill:vi.fn()});}
beforeEach(()=>{Object.defineProperty(process,'platform',{...platform,value:'win32'});vi.useFakeTimers();});
afterEach(()=>{Object.defineProperty(process,'platform',platform);vi.useRealTimers();vi.clearAllMocks();});
describe('native helper process completion',()=>{
 it('waits for stdout to drain after exit before parsing the response',async()=>{
  const proc=child();vi.mocked(spawn).mockReturnValue(proc as never);
  let finished=false;const result=nativeCall({op:'rdpProbe'}).then(value=>{finished=true;return value;});
  proc.emit('exit',0);await Promise.resolve();expect(finished).toBe(false);
  proc.stdout.write('{"available":true}\n');proc.emit('close',0);await expect(result).resolves.toEqual({available:true});expect(vi.getTimerCount()).toBe(0);
 });
 it('allows a cold RDP probe to finish within its bounded startup deadline',async()=>{
  const proc=child();vi.mocked(spawn).mockReturnValue(proc as never);const result=new RdpService().probe();
  await vi.advanceTimersByTimeAsync(20000);expect(proc.kill).not.toHaveBeenCalled();proc.stdout.write('{"available":true,"presentation":"managed-native-window"}\n');proc.emit('close',0);await expect(result).resolves.toMatchObject({available:true});
 });
 it('ends an unresponsive probe at 30 seconds and reports a controlled reason',async()=>{
  const proc=child();vi.mocked(spawn).mockReturnValue(proc as never);const result=new RdpService().probe();
  await vi.advanceTimersByTimeAsync(30000);expect(proc.kill).toHaveBeenCalledOnce();await expect(result).resolves.toMatchObject({available:false,reason:'系统操作超时。'});
 });
});
