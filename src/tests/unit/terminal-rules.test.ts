import { expect,it } from 'vitest';
import { TerminalTriggers,decodeKeyInput,keyChord,terminalRulesSchema } from '../../apps/desktop/renderer/terminal-rules';
const rule={id:'d8f981d9-c9dc-49de-8bb8-62d7791ee8d4',name:'prompt',enabled:true,text:'准备完毕',action:'send' as const,output:'pwd\\r',cooldown:1000};
it('matches fragmented Unicode output and ignores terminal control payloads',()=>{
 const engine=new TerminalTriggers(),data=Buffer.from('准备完毕');expect(engine.feed(data.subarray(0,2),[rule],0)).toEqual([]);expect(engine.feed(data.subarray(2),[rule],0)).toEqual([rule]);
 expect(engine.feed(Buffer.from('准备完毕'),[rule],2000)).toEqual([]);
 expect(engine.feed(Buffer.from('\r\n\x1b]0;准备完毕\x07'),[rule],3000)).toEqual([]);
 expect(engine.feed(Buffer.from('\x1b[31m准备完毕\x1b[0m'),[rule],3000)).toEqual([rule]);
});
it('enforces cooldown, disabled state and a global trigger budget',()=>{
 const engine=new TerminalTriggers();expect(engine.feed(Buffer.from('准备完毕\n'),[{...rule,enabled:false}],0)).toEqual([]);
 expect(engine.feed(Buffer.from('准备完毕\n'),[rule],0)).toEqual([rule]);expect(engine.feed(Buffer.from('准备完毕\n'),[rule],1)).toEqual([]);
 for(let i=1;i<20;i++)expect(engine.feed(Buffer.from('准备完毕\n'),[rule],i*1000)).toHaveLength(1);
 expect(engine.feed(Buffer.from('准备完毕\n'),[rule],21000)).toEqual([]);expect(engine.feed(Buffer.from('准备完毕\n'),[rule],61001)).toHaveLength(1);
});
it('decodes explicit key bytes without evaluating expressions and bounds rule input',()=>{
 expect(decodeKeyInput('\\e[2~\\r\\n\\t\\x7f')).toBe('\x1b[2~\r\n\t\x7f');expect(decodeKeyInput('${process.exit()}')).toBe('${process.exit()}');
 expect(keyChord({code:'KeyJ',ctrlKey:false,altKey:true,shiftKey:false,metaKey:false})).toBe('Alt+KeyJ');
 expect(terminalRulesSchema.safeParse({keys:[],highlights:[],triggers:[{...rule,cooldown:0}]}).success).toBe(false);
});
