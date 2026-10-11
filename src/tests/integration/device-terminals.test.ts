import { it,expect } from 'vitest';
import { SerialPortMock } from 'serialport';
const MockBinding=SerialPortMock.binding;
import { DeviceTerminals } from '../../services/terminal/devices';
import { openSerial } from '../../services/terminal/serial';
import { openLocal } from '../../services/terminal/local';
import type { SerialTerminalConfig } from '../../packages/contracts/device-terminal';
import type { HornetEvent } from '../../packages/contracts';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
async function wait(test:()=>boolean){const until=Date.now()+12000;while(!test()){if(Date.now()>until)throw new Error('Device terminal timeout');await new Promise(r=>setTimeout(r,20));}}
it('opens a serial stream with the mock hardware binding, converts input and releases on unplug',async()=>{
 MockBinding.reset();MockBinding.createPort('COM101',{record:true,maxReadSize:3});
 const events:HornetEvent[]=[],terminals=new DeviceTerminals((_owner,e)=>events.push(e));let port!:SerialPortMock;
 const config:SerialTerminalConfig={path:'COM101',baudRate:57600,dataBits:7,stopBits:2,parity:'even',flowControl:'rtscts',newline:'crlf',localEcho:true,cols:80,rows:24};
 const factory=(c:SerialTerminalConfig)=>port=new SerialPortMock({path:c.path,baudRate:c.baudRate,dataBits:c.dataBits,stopBits:c.stopBits,parity:c.parity,rtscts:c.flowControl==='rtscts',autoOpen:false});
 try{
  const s=await openSerial(terminals,'a',config,factory);terminals.attach('a',s.terminalId);expect(port.port?.openOptions).toMatchObject({baudRate:57600,dataBits:7,stopBits:2,parity:'even',rtscts:true});
  await expect(openSerial(terminals,'b',config,factory)).rejects.toThrow('已在');
  terminals.write('a',s.terminalId,1,1,'hello\r世界\n');await wait(()=>!!port.port?.recording.length);expect(port.port?.recording.toString()).toBe('hello\r\n世界\r\n');
  const output=()=>Buffer.concat(events.filter((e):e is Extract<HornetEvent,{type:'terminal.data'}>=>e.type==='terminal.data').map(e=>Buffer.from(e.data))).toString();
  port.port!.emitData(Buffer.from('返回中文\r\n'));await wait(()=>output().includes('返回中文'));expect(output()).toContain('hello\r\n世界\r\n');
  port.emit('error',new Error('device removed'));await wait(()=>!terminals.has(s.terminalId));expect(port.isOpen).toBe(false);expect(events.some(e=>e.type==='service.error'&&e.message.includes('removed'))).toBe(true);
  const replacement=await openSerial(terminals,'a',config,factory);await terminals.close('a',replacement.terminalId);expect(port.isOpen).toBe(false);
 }finally{await terminals.stop();MockBinding.reset();}
});
it.skipIf(process.platform!=='win32')('runs real ConPTY shells, reports dimensions and preserves independent lifecycle',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'hornet-local-')),events:HornetEvent[]=[];
 const terminals=new DeviceTerminals((_owner,e)=>{events.push(e);if(e.type==='terminal.data')queueMicrotask(()=>{try{terminals.ack('a',e.terminalId,e.seq);}catch{}});});
 const output=(id:string)=>Buffer.concat(events.filter((e):e is Extract<HornetEvent,{type:'terminal.data'}>=>e.type==='terminal.data'&&e.terminalId===id).map(e=>Buffer.from(e.data))).toString();
 try{
  const ps=await openLocal(terminals,'a',{shell:'powershell',cwd:directory,cols:100,rows:30}),cmd=await openLocal(terminals,'a',{shell:'cmd',cwd:directory,cols:80,rows:24});
  terminals.attach('a',ps.terminalId);terminals.attach('a',cmd.terminalId);await wait(()=>output(ps.terminalId).includes('PS ')&&output(cmd.terminalId).includes(directory));
  terminals.resize('a',ps.terminalId,1,101,35);terminals.write('a',ps.terminalId,1,1,"Write-Output ('HORNET_SIZE_'+[Console]::WindowWidth+'x'+[Console]::WindowHeight); Write-Output ('DIR_'+(Get-Location).Path)\r");
  await wait(()=>output(ps.terminalId).includes('HORNET_SIZE_101x35'));expect(output(ps.terminalId)).toContain(directory);expect(output(cmd.terminalId)).not.toContain('HORNET_SIZE');
  terminals.write('a',cmd.terminalId,1,1,'exit\r');await wait(()=>!terminals.has(cmd.terminalId));expect(terminals.has(ps.terminalId)).toBe(true);
  terminals.write('a',ps.terminalId,1,2,"Write-Output ('STILL_'+'RUNNING')\r");await wait(()=>output(ps.terminalId).includes('STILL_RUNNING'));await terminals.close('a',ps.terminalId);expect(terminals.has(ps.terminalId)).toBe(false);
  await expect(openLocal(terminals,'a',{shell:'cmd',cwd:join(directory,'missing'),cols:80,rows:24})).rejects.toThrow('绝对目录');
 }finally{await terminals.stop();await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
});
