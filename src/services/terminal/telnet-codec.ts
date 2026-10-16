import { AppError } from '../../packages/core/errors';
const IAC=255,DO=253,DONT=254,WILL=251,WONT=252,SB=250,SE=240;
const BINARY=0,ECHO=1,SGA=3,TTYPE=24,NAWS=31;
const escape=(data:Buffer)=>Buffer.from([...data].flatMap(byte=>byte===IAC?[IAC,IAC]:[byte]));

// Streaming RFC 854 parser. Option state is independent in each direction;
// duplicate positive acknowledgements do not produce negotiation loops.
export class TelnetCodec {
 private state:'data'|'iac'|'option'|'sub'|'sub-iac'='data';private command=0;
 private local=new Set<number>();private remote=new Set<number>();private offered=new Set<number>();
 private sub:number[]=[];private afterCR=false;
 constructor(private send:(data:Buffer)=>void,private cols:number,private rows:number,private terminalType='XTERM-256COLOR'){}
 get remoteEcho(){return this.remote.has(ECHO);}
 start(){for(const option of [TTYPE,NAWS,BINARY,SGA]){this.offered.add(option);this.send(Buffer.from([IAC,WILL,option]));}}
 private negotiate(command:number,option:number){
  if(command===DO){
   if(![BINARY,SGA,TTYPE,NAWS].includes(option)){this.send(Buffer.from([IAC,WONT,option]));return;}
   if(this.local.has(option))return;
   this.local.add(option);if(!this.offered.delete(option))this.send(Buffer.from([IAC,WILL,option]));
   if(option===NAWS)this.size();
  }else if(command===DONT){const active=this.local.delete(option),pending=this.offered.delete(option);if(active&&!pending)this.send(Buffer.from([IAC,WONT,option]));}
  else if(command===WILL){
   if(![BINARY,ECHO,SGA].includes(option)){this.send(Buffer.from([IAC,DONT,option]));return;}
   if(!this.remote.has(option)){this.remote.add(option);this.send(Buffer.from([IAC,DO,option]));}
  }else if(command===WONT){if(this.remote.delete(option))this.send(Buffer.from([IAC,DONT,option]));}
 }
 private subnegotiation(){
  if(this.sub.length===2&&this.sub[0]===TTYPE&&this.sub[1]===1&&this.local.has(TTYPE))
   this.send(Buffer.concat([Buffer.from([IAC,SB,TTYPE,0]),Buffer.from(this.terminalType.toUpperCase(),'ascii'),Buffer.from([IAC,SE])]));
  this.sub=[];
 }
 feed(chunk:Buffer):Buffer{
  const output:number[]=[];
  const data=(byte:number)=>{if(!this.remote.has(BINARY)&&this.afterCR&&byte===0){this.afterCR=false;return;}this.afterCR=byte===13;output.push(byte);};
  for(const byte of chunk){
   if(this.state==='data'){if(byte===IAC)this.state='iac';else data(byte);}
   else if(this.state==='iac'){
    if(byte===IAC){data(byte);this.state='data';}
    else if([DO,DONT,WILL,WONT].includes(byte)){this.command=byte;this.state='option';}
    else if(byte===SB){this.sub=[];this.state='sub';}
    else this.state='data'; // NOP, GA and other single-byte commands.
   }else if(this.state==='option'){this.negotiate(this.command,byte);this.state='data';}
   else if(this.state==='sub'){if(byte===IAC)this.state='sub-iac';else this.sub.push(byte);}
   else if(byte===SE){this.subnegotiation();this.state='data';}
   else if(byte===IAC){this.sub.push(IAC);this.state='sub';}
   else throw new AppError('TELNET_PROTOCOL','Telnet 子协商格式无效。');
   if(this.sub.length>4096)throw new AppError('TELNET_PROTOCOL','Telnet 子协商超过大小上限。');
  }
  return Buffer.from(output);
 }
 encode(text:string,encode:(text:string)=>Buffer=text=>Buffer.from(text,'utf8')){
  // xterm sends CR for Enter. In NVT mode it denotes a complete input line.
  const bytes=encode(this.local.has(BINARY)?text:text.replace(/\r\n|\r|\n/g,'\r\n'));
  return escape(bytes);
 }
 resize(cols:number,rows:number){this.cols=cols;this.rows=rows;this.size();}
 private size(){if(!this.local.has(NAWS))return;const data=Buffer.alloc(4);data.writeUInt16BE(this.cols,0);data.writeUInt16BE(this.rows,2);this.send(Buffer.concat([Buffer.from([IAC,SB,NAWS]),escape(data),Buffer.from([IAC,SE])]));}
}
