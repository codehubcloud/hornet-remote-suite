import { Transform } from 'node:stream';
/** Convert only line endings; preserve split CRLF pairs and every other byte. */
export function asciiLines(crlf:boolean){
 let cr=false;
 const convert=(data:Buffer,final=false)=>{
  const output:number[]=[];for(const byte of data){if(cr){output.push(...(crlf?[13,10]:[10]));cr=false;if(byte===10)continue;}if(byte===13)cr=true;else if(byte===10)output.push(...(crlf?[13,10]:[10]));else output.push(byte);}
  if(final&&cr){output.push(...(crlf?[13,10]:[10]));cr=false;}return Buffer.from(output);
 };
 return new Transform({transform(chunk,_encoding,done){done(null,convert(Buffer.from(chunk)));},flush(done){done(null,convert(Buffer.alloc(0),true));}});
}
