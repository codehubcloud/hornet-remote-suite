import { TerminalCodec } from './encoding';
import type { SerialPortStream } from '@serialport/stream';
import { serialTerminalSchema,type SerialTerminalConfig,type SerialDevice } from '../../packages/contracts/device-terminal';
import type { DeviceTerminals,DriverEvents,TerminalDriver } from './devices';
import { AppError } from '../../packages/core/errors';
// Structural type keeps the test binding out of production code.
type Port=Pick<SerialPortStream<any>,'open'|'close'|'write'|'on'|'pause'|'resume'|'isOpen'|'writableLength'>;
export type SerialFactory=(config:SerialTerminalConfig)=>Port;
export async function serialDevices():Promise<SerialDevice[]>{
 if(process.platform!=='win32')return [];
 const {SerialPort}=await import('serialport');return (await SerialPort.list()).map(({path,manufacturer,serialNumber})=>({path,manufacturer,serialNumber}));
}
export async function openSerial(terminals:DeviceTerminals,owner:string,input:SerialTerminalConfig,factory?:SerialFactory){
 const config=serialTerminalSchema.parse(input);
 if(process.platform!=='win32'&&!factory)throw new AppError('SERIAL_UNAVAILABLE','当前串口适配仅支持 Windows。');
 return terminals.open(owner,{name:config.path+' · 串口',address:config.path+' · '+config.baudRate,source:'serial',key:config.path},async events=>{
  const create=factory??(config=>{const {SerialPort}=require('serialport') as typeof import('serialport');return new SerialPort({path:config.path,baudRate:config.baudRate,dataBits:config.dataBits,stopBits:config.stopBits,parity:config.parity,rtscts:config.flowControl==='rtscts',xon:config.flowControl==='xonxoff',xoff:config.flowControl==='xonxoff',autoOpen:false,highWaterMark:65536});});
  return serialDriver(create(config),config,events);
 });
}
async function serialDriver(port:Port,config:SerialTerminalConfig,events:DriverEvents):Promise<TerminalDriver>{
 let codec=new TerminalCodec(config.encoding);
 let closed=false,opening=true,timedOut=false;
 port.on('data',(data:Buffer)=>events.data(codec.decode(data)));port.on('error',(error:Error)=>events.end('串口错误：'+error.message));port.on('close',()=>{events.data(codec.end());events.end();});port.pause();
 await new Promise<void>((resolve,reject)=>{
  const timer=setTimeout(()=>{timedOut=true;reject(new AppError('SERIAL_TIMEOUT','打开串口超时。'));},10000);
  port.open(error=>{opening=false;clearTimeout(timer);if(timedOut){if(port.isOpen)port.close(()=>{});return;}if(error)reject(new AppError('SERIAL_OPEN','无法打开 '+config.path+'：'+error.message));else resolve();});
 });
 return {encoding(encoding){if(encoding&&encoding!==codec.encoding){events.data(codec.end());codec=new TerminalCodec(encoding);}return codec.encoding;},write(value){
  if(closed||!port.isOpen)throw new AppError('SERIAL_CLOSED','串口已关闭。');
  const ending=config.newline==='cr'?'\r':config.newline==='lf'?'\n':'\r\n',data=codec.encode(value.replace(/\r\n|\r|\n/g,ending));
  if(port.writableLength+data.length>65536)throw new AppError('SERIAL_INPUT_LIMIT','串口发送缓冲区已满。');
  port.write(data,error=>{if(error)events.end('串口发送失败：'+error.message);});
  if(config.localEcho)events.data(Buffer.from(value.replace(/\r\n|\r|\n/g,'\r\n').replace(/[\x08\x7f]/g,'\b \b')));
 },resize(){},pause:()=>port.pause(),resume:()=>port.resume(),async close(){
  if(closed)return;closed=true;if(!port.isOpen||opening)return;
  await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('关闭串口超时。')),3000);port.close(error=>{clearTimeout(timer);error?reject(error):resolve();});});
 }};
}
