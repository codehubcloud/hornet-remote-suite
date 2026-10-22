import { it,expect,vi } from 'vitest';
import { DeviceTerminals,type DriverEvents,type TerminalDriver } from '../../services/terminal/devices';
import { localTerminalSchema,serialTerminalSchema } from '../../packages/contracts/device-terminal';
import type { HornetEvent } from '../../packages/contracts';
const info={name:'Test',address:'COM100',source:'serial' as const,key:'COM100'};
function fixture(){let sink!:DriverEvents;const events:HornetEvent[]=[];const driver:TerminalDriver={write:vi.fn(),resize:vi.fn(),pause:vi.fn(),resume:vi.fn(),close:vi.fn(async()=>{})};const terminals=new DeviceTerminals((_owner,event)=>events.push(event));return {terminals,driver,events,async open(){return terminals.open('a',info,async events=>{sink=events;return driver;});},get sink(){return sink;}};}
it('holds pre-attach data, bounds output with ACKs, and preserves tail before exit',async()=>{
 const f=fixture(),s=await f.open();
 f.sink.data(Buffer.from('before attach'));expect(f.events.some(e=>e.type==='terminal.data')).toBe(false);f.terminals.attach('a',s.terminalId);
 let data=f.events.filter((e):e is Extract<HornetEvent,{type:'terminal.data'}>=>e.type==='terminal.data');expect(Buffer.from(data[0].data).toString()).toBe('before attach');f.terminals.ack('a',s.terminalId,1);
 f.sink.data(Buffer.alloc(800000,65));data=f.events.filter((e):e is Extract<HornetEvent,{type:'terminal.data'}>=>e.type==='terminal.data');expect(data.slice(1).reduce((n,e)=>n+e.data.length,0)).toBe(524288);expect(f.driver.pause).toHaveBeenCalled();
 expect(()=>f.terminals.ack('a',s.terminalId,3)).toThrow('序号');f.sink.end();expect(f.events.some(e=>e.type==='terminal.closed')).toBe(false);
 let index=1;while(!f.events.some(e=>e.type==='terminal.closed')){data=f.events.filter((e):e is Extract<HornetEvent,{type:'terminal.data'}>=>e.type==='terminal.data');if(index<data.length)f.terminals.ack('a',s.terminalId,data[index++].seq);await Promise.resolve();}
 expect(Buffer.concat(f.events.filter((e):e is Extract<HornetEvent,{type:'terminal.data'}>=>e.type==='terminal.data').map(e=>Buffer.from(e.data))).length).toBe(800013);await f.terminals.stop();expect(f.driver.close).toHaveBeenCalledTimes(1);
});
it('isolates owners and serial reservations, limits input, and releases devices on stop',async()=>{
 const f=fixture(),s=await f.open();await expect(f.open()).rejects.toThrow('已在');
 expect(()=>f.terminals.attach('other',s.terminalId)).toThrow('无权');await expect(f.terminals.close('other',s.terminalId)).rejects.toThrow('无权');
 f.terminals.write('a',s.terminalId,1,1,'one');expect(()=>f.terminals.write('a',s.terminalId,1,1,'duplicate')).toThrow('版本');expect(f.driver.write).toHaveBeenCalledOnce();
 expect(()=>f.terminals.write('a',s.terminalId,1,2,'x'.repeat(32769))).toThrow('输入过快');f.terminals.write('a',s.terminalId,1,2,'two');
 f.terminals.resize('a',s.terminalId,1,101,35);expect(f.driver.resize).toHaveBeenCalledWith(101,35);
 await f.terminals.close('a',s.terminalId);const next=await f.open();expect(next.terminalId).not.toBe(s.terminalId);await f.terminals.stop();await expect(f.open()).rejects.toThrow('停止');
});
it('closes a driver that exceeds its output ceiling and cleans late startup on shutdown',async()=>{
 const f=fixture(),s=await f.open();f.sink.data(Buffer.alloc(1048577));await f.terminals.close('a',s.terminalId);expect(f.events.some(e=>e.type==='service.error'&&e.message.includes('缓冲上限'))).toBe(true);
 let release!:(driver:TerminalDriver)=>void;const pending=f.terminals.open('a',info,()=>new Promise(resolve=>{release=resolve;}));await f.terminals.stop();release(f.driver);await expect(pending).rejects.toThrow('取消');expect(f.driver.close).toHaveBeenCalledTimes(2);
});
it('rejects arbitrary executables, file paths and incompatible serial settings',()=>{
 expect(localTerminalSchema.safeParse({shell:'arbitrary.exe',cols:80,rows:24}).success).toBe(false);
 expect(localTerminalSchema.parse({shell:'wsl',distribution:'Ubuntu-24.04',cwd:'~/work',cols:120,rows:36})).toMatchObject({shell:'wsl',distribution:'Ubuntu-24.04',cwd:'~/work'});
 expect(localTerminalSchema.safeParse({shell:'powershell',distribution:'Ubuntu',cols:80,rows:24}).success).toBe(false);
 expect(localTerminalSchema.safeParse({shell:'wsl',distribution:'Ubuntu;id',cols:80,rows:24}).success).toBe(false);
 const config={path:'COM1',baudRate:115200,dataBits:8,stopBits:1,parity:'none',flowControl:'none',newline:'cr',localEcho:false,cols:80,rows:24};
 expect(serialTerminalSchema.parse({...config,path:'com4'}).path).toBe('COM4');
 for(const invalid of [{path:'C:\\file.txt'},{baudRate:0},{stopBits:1.5},{flowControl:'invalid'}])expect(serialTerminalSchema.safeParse({...config,...invalid}).success).toBe(false);
});
