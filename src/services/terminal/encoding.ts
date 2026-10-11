import iconv from 'iconv-lite';
import { terminalEncodingSchema,type TerminalEncoding } from '../../packages/contracts/terminal-encoding';

// All downstream consumers (xterm, logs, scripts and recordings) receive UTF-8.
// Only the protocol edge handles the peer's encoding; decoders retain partial bytes.
export class TerminalCodec {
 private decoder?:TextDecoder;
 readonly encoding:TerminalEncoding;
 constructor(encoding:TerminalEncoding='utf8'){
  this.encoding=terminalEncodingSchema.parse(encoding);
  // ICU's streaming decoder preserves supplementary characters even when all
  // four GB18030 bytes arrive separately. ISO-8859-1 must stay literal Latin-1:
  // WHATWG TextDecoder aliases that label to Windows-1252 instead.
  if(this.encoding!=='iso-8859-1')this.decoder=new TextDecoder(this.encoding==='utf8'?'utf-8':this.encoding,{ignoreBOM:true});
 }
 decode(data:Buffer){return Buffer.from(this.decoder?this.decoder.decode(data,{stream:true}):data.toString('latin1'),'utf8');}
 end(){return Buffer.from(this.decoder?.decode()??'','utf8');}
 encode(text:string){return iconv.encode(text,this.encoding);}
}
