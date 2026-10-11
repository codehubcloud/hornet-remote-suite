import { it,expect } from 'vitest';
import { TelnetCodec } from '../../services/terminal/telnet-codec';
it('handles every byte boundary, NVT CR, escaped IAC and suppresses duplicate negotiations',()=>{
 const sent:Buffer[]=[],codec=new TelnetCodec(data=>sent.push(data),80,24);
 const wire=Buffer.from([65,13,0,66,13,10,255,251,1,255,251,1,255,255,67]);
 const output=Buffer.concat([...wire].map(byte=>codec.feed(Buffer.from([byte]))));
 expect(output).toEqual(Buffer.from([65,13,66,13,10,255,67]));expect(sent).toEqual([Buffer.from([255,253,1])]);expect(codec.remoteEcho).toBe(true);
 codec.feed(Buffer.from([255,252,1,255,252,1]));expect(sent.at(-1)).toEqual(Buffer.from([255,254,1]));expect(sent).toHaveLength(2);expect(codec.remoteEcho).toBe(false);
 expect(codec.encode('a\rb\nc\r\n')).toEqual(Buffer.from('a\r\nb\r\nc\r\n'));
});
it('negotiates terminal type, independent binary directions and escaped window sizes',()=>{
 const sent:Buffer[]=[],codec=new TelnetCodec(data=>sent.push(data),255,256);codec.start();sent.length=0;
 codec.feed(Buffer.from([255,253,31]));expect(sent).toEqual([Buffer.from([255,250,31,0,255,255,1,0,255,240])]);
 codec.feed(Buffer.from([255,253,24,255,250,24,1,255,240]));expect(sent.at(-1)).toEqual(Buffer.concat([Buffer.from([255,250,24,0]),Buffer.from('XTERM-256COLOR'),Buffer.from([255,240])]));
 codec.feed(Buffer.from([255,253,0]));expect(codec.encode('a\r')).toEqual(Buffer.from('a\r'));
 expect(codec.feed(Buffer.from([13,0]))).toEqual(Buffer.from([13]));codec.feed(Buffer.from([255,251,0]));expect(codec.feed(Buffer.from([13,0]))).toEqual(Buffer.from([13,0]));
 codec.feed(Buffer.from([255,254,31]));sent.length=0;codec.resize(120,40);expect(sent).toEqual([]);
 codec.feed(Buffer.from([255,253,99,255,251,100]));expect(sent).toEqual([Buffer.from([255,252,99]),Buffer.from([255,254,100])]);
});
it('rejects unbounded or malformed subnegotiation instead of buffering forever',()=>{
 const codec=new TelnetCodec(()=>{},80,24);codec.feed(Buffer.from([255,250,24]));
 expect(()=>codec.feed(Buffer.alloc(4097,65))).toThrow('大小');
 const other=new TelnetCodec(()=>{},80,24);expect(()=>other.feed(Buffer.from([255,250,24,255,241]))).toThrow('格式');
});
