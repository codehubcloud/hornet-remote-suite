import { it,expect } from 'vitest';
import { TerminalCodec } from '../../services/terminal/encoding';
import { TelnetCodec } from '../../services/terminal/telnet-codec';
import { terminalEncodingSchema,type TerminalEncoding } from '../../packages/contracts/terminal-encoding';
it.each<[TerminalEncoding,string,string]>([
 ['utf8','中文','e4b8ade69687'],['gbk','中文','d6d0cec4'],['gb18030','😀','9439fc36'],['big5','中文','a4a4a4e5'],
 ['shift_jis','日本','93fa967b'],['euc-kr','한국','c7d1b1b9'],['windows-1251','Привет','cff0e8e2e5f2'],['windows-1252','€ÿ','80ff'],['iso-8859-1','éÿ','e9ff'],
 ])('streams %s without losing fragmented characters and encodes input', (encoding,text,hex)=>{
 const codec=new TerminalCodec(encoding),data=Buffer.from(hex,'hex');
 expect(codec.encode(text).toString('hex')).toBe(hex);
 expect(Buffer.concat([...data].map(byte=>codec.decode(Buffer.from([byte]))).concat(codec.end())).toString()).toBe(text);
});
it('escapes encoded Telnet IAC and preserves NVT line endings',()=>{
 const codec=new TerminalCodec('windows-1252'),telnet=new TelnetCodec(()=>{},80,24);
 expect(telnet.encode('ÿ\r',text=>codec.encode(text))).toEqual(Buffer.from([255,255,13,10]));
 expect(codec.decode(telnet.feed(Buffer.from([255,255]))).toString()).toBe('ÿ');
 expect(terminalEncodingSchema.safeParse('utf16').success).toBe(false);
});
it('flushes an incomplete character without carrying bytes into a new codec',()=>{
 const codec=new TerminalCodec('gbk');expect(codec.decode(Buffer.from([0xd6])).length).toBe(0);expect(codec.end().toString()).toBe('�');
 expect(new TerminalCodec('utf8').decode(Buffer.from('ok')).toString()).toBe('ok');
});
