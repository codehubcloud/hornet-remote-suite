import { it,expect,vi,afterEach } from 'vitest';
import { ScriptRunner,registerScriptRunner,getScriptRunner } from '../../apps/desktop/renderer/script-runner';
import { terminalScriptSchema,type TerminalScript } from '../../packages/contracts/terminal-script';
const script=(steps:TerminalScript['steps']):TerminalScript=>({version:1,name:'test',steps});
afterEach(()=>vi.useRealTimers());
it('captures synchronous replies, strips split controls, decodes split UTF-8 and consumes each match once',async()=>{
 const sent:string[]=[];
 const runner=new ScriptRunner(async text=>{sent.push(text);for(const byte of Buffer.from('\x1b[31m中文\x1b[0m>'))runner.feed(Uint8Array.of(byte));});
 const result=await runner.run(script([{kind:'send',text:'pwd\n',enter:false},{kind:'wait',text:'中文>',timeoutMs:100},{kind:'send',text:'done',enter:true},{kind:'wait',text:'中文>',timeoutMs:100}]),()=>{});
 expect(result.state).toBe('completed');expect(sent).toEqual(['pwd\r','done\r']);
 const empty=new ScriptRunner(async()=>{});const timed=await empty.run(script([{kind:'wait',text:'old output',timeoutMs:100}]),()=>{});expect(timed.error).toBe('SCRIPT_TIMEOUT');
});
it('does not reuse a consumed match and stops all later sends on timeout',async()=>{
 vi.useFakeTimers();const send=vi.fn(async()=>runner.feed(Buffer.from('prompt>'))),runner=new ScriptRunner(send);
 const task=runner.run(script([{kind:'send',text:'one',enter:true},{kind:'wait',text:'prompt>',timeoutMs:100},{kind:'wait',text:'prompt>',timeoutMs:100},{kind:'send',text:'must not run',enter:true}]),()=>{});
 await vi.advanceTimersByTimeAsync(110);expect((await task).error).toBe('SCRIPT_TIMEOUT');expect(send).toHaveBeenCalledTimes(1);
});
it('cancels waits and delays, rejects concurrent runs and unregisters only its own physical terminal',async()=>{
 const send=vi.fn(async()=>{}),runner=new ScriptRunner(send),remove=registerScriptRunner('old-id',runner);
 const task=runner.run(script([{kind:'delay',ms:10000},{kind:'send',text:'never',enter:true}]),()=>{});
 await expect(runner.run(script([{kind:'delay',ms:0}]),()=>{})).rejects.toThrow('SCRIPT_BUSY');remove();expect((await task).state).toBe('cancelled');expect(send).not.toHaveBeenCalled();expect(getScriptRunner('old-id')).toBeUndefined();
 await expect(runner.run(script([{kind:'delay',ms:0}]),()=>{})).rejects.toThrow('SCRIPT_CLOSED');
});
it('cancels while a send is pending and never executes later steps',async()=>{
 let finish!:()=>void;const send=vi.fn(()=>new Promise<void>(r=>{finish=r;})),runner=new ScriptRunner(send);
 const task=runner.run(script([{kind:'send',text:'one',enter:true},{kind:'send',text:'two',enter:true}]),()=>{});
 await Promise.resolve();runner.cancel();expect((await task).state).toBe('cancelled');finish();await Promise.resolve();expect(send).toHaveBeenCalledTimes(1);
});
it('bounds output, limits total duration and rejects executable/unknown script fields',async()=>{
 const runner=new ScriptRunner(async()=>{});const task=runner.run(script([{kind:'wait',text:'never',timeoutMs:1000}]),()=>{});runner.feed(Buffer.alloc(131073,65));expect((await task).error).toBe('SCRIPT_OUTPUT_LIMIT');
 vi.useFakeTimers();const long=runner.run(script(Array.from({length:7},()=>({kind:'delay',ms:300000}))),()=>{});await vi.advanceTimersByTimeAsync(1800001);expect((await long).error).toBe('SCRIPT_DEADLINE');
 expect(terminalScriptSchema.safeParse({...script([]),code:'eval()'}).success).toBe(false);
});
