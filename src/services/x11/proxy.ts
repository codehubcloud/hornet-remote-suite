import { timingSafeEqual } from 'node:crypto';
import type { Duplex } from 'node:stream';
import { createConnection } from 'node:net';
export function rewriteSetup(input: Buffer, fake: Buffer, real: Buffer): Buffer | undefined {
  if(input.length<12)return;
  if(input[0]!==0x6c&&input[0]!==0x42)throw new Error('X11 字节序无效。');
  const word=(at:number)=>input[0]===0x6c?input.readUInt16LE(at):input.readUInt16BE(at);
  if(word(2)!==11)throw new Error('不支持的 X11 协议版本。');
  const nameLength=word(6),dataLength=word(8),padded=(n:number)=>(n+3)&~3;
  if(nameLength!==18||dataLength!==16)throw new Error('X11 cookie 认证格式无效。');
  const offset=12+padded(nameLength),length=offset+padded(dataLength);
  if(input.length<length)return;
  if(input.subarray(12,12+nameLength).toString('ascii')!=='MIT-MAGIC-COOKIE-1'||!timingSafeEqual(input.subarray(offset,offset+16),fake))throw new Error('X11 cookie 被拒绝。');
  const output=Buffer.from(input);real.copy(output,offset);return output;
}
export function proxyX11(channel: Duplex, fake: Buffer, real: Buffer, port: number, finished: () => void) {
  let buffer=Buffer.alloc(0),local:ReturnType<typeof createConnection>|undefined,closed=false;
  const close=()=>{if(closed)return;closed=true;clearTimeout(timer);channel.destroy();local?.destroy();finished();};
  const timer=setTimeout(close,10000);channel.on('error',close);channel.once('close',close);
  const read=(data:Buffer)=>{
    if(buffer.length+data.length>65536){close();return;}buffer=Buffer.concat([buffer,data]);
    try{
      const setup=rewriteSetup(buffer,fake,real);if(!setup)return;
      channel.pause();channel.removeListener('data',read);
      local=createConnection({host:'127.0.0.1',port,allowHalfOpen:true});local.on('error',close);local.once('close',close);
      local.once('connect',()=>{clearTimeout(timer);local!.write(setup);channel.pipe(local!);local!.pipe(channel);});
    }catch{close();}
  };
  channel.on('data',read);
  return close;
}
export function authorityCookie(data:Buffer, display:number):Buffer {
  let offset=0;
  while(offset<data.length){
    if(offset+2>data.length)break;offset+=2;
    const fields:Buffer[]=[];
    for(let i=0;i<4;i++){if(offset+2>data.length)throw new Error('Xauthority 文件损坏。');const size=data.readUInt16BE(offset);offset+=2;if(offset+size>data.length)throw new Error('Xauthority 文件损坏。');fields.push(data.subarray(offset,offset+size));offset+=size;}
    if(fields[1].toString()===String(display)&&fields[2].toString()==='MIT-MAGIC-COOKIE-1'&&fields[3].length===16)return Buffer.from(fields[3]);
  }
  throw new Error('Xauthority 中没有此显示号的 MIT-MAGIC-COOKIE-1。');
}
