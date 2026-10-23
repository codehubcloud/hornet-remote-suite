import { z } from 'zod';
import { create } from 'zustand';
import { TerminalText } from '../../../packages/core/terminal-text';
const base={id:z.string().uuid(),name:z.string().trim().min(1).max(80),enabled:z.boolean()};
const keySchema=z.object({...base,shortcut:z.string().max(80).regex(/^(?:(?:Ctrl|Alt|Shift|Meta)\+)*(?:Key[A-Z]|Digit[0-9]|F[1-9]|F1[0-2]|Arrow(?:Up|Down|Left|Right)|Home|End|PageUp|PageDown|Insert|Delete|Backspace|Enter|Tab|Space)$/).refine(value=>!['F1','F3','Shift+F3','F11','Ctrl+Shift+KeyC','Ctrl+Shift+KeyV','Ctrl+Shift+KeyF','Ctrl+Shift+KeyL','Ctrl+Shift+F4','Alt+KeyN','Alt+KeyO','Alt+KeyP','Alt+KeyS','Alt+KeyD','Alt+ArrowRight','Alt+ArrowLeft','Alt+Shift+KeyN'].includes(value),'Reserved application shortcut'),output:z.string().min(1).max(8192)}).strict();
const highlightSchema=z.object({...base,text:z.string().min(1).max(255),foreground:z.string().regex(/^#[0-9a-f]{6}$/i),background:z.string().regex(/^#[0-9a-f]{6}$/i)}).strict();
const triggerSchema=z.object({...base,text:z.string().min(1).max(255),action:z.enum(['notify','send']),output:z.string().max(8192),cooldown:z.number().int().min(1000).max(3600000)}).strict();
export const terminalRulesSchema=z.object({keys:z.array(keySchema).max(100),highlights:z.array(highlightSchema).max(50),triggers:z.array(triggerSchema).max(50)}).strict();
export type TerminalRules=z.infer<typeof terminalRulesSchema>;
export type TriggerRule=TerminalRules['triggers'][number];
export function decodeKeyInput(text:string){return text.replace(/\\(e|r|n|t|\\|x[0-9a-f]{2})/gi,(_match,token:string)=>token==='e'?'\x1b':token==='r'?'\r':token==='n'?'\n':token==='t'?'\t':token==='\\'?'\\':String.fromCharCode(parseInt(token.slice(1),16)));}
export function keyChord(e:Pick<KeyboardEvent,'code'|'ctrlKey'|'altKey'|'shiftKey'|'metaKey'>){return [e.ctrlKey?'Ctrl':'',e.altKey?'Alt':'',e.shiftKey?'Shift':'',e.metaKey?'Meta':'',e.code].filter(Boolean).join('+');}
function read():TerminalRules{try{return terminalRulesSchema.parse(JSON.parse(localStorage.getItem('hornet.terminal.rules.v1')??''));}catch{return {keys:[],highlights:[],triggers:[]};}}
export const useTerminalRules=create<{value:TerminalRules;save:(value:TerminalRules)=>void}>(set=>({value:read(),save:value=>{const parsed=terminalRulesSchema.parse(value);const shortcuts=parsed.keys.filter(r=>r.enabled).map(r=>r.shortcut);if(new Set(shortcuts).size!==shortcuts.length)throw new Error('Duplicate keyboard shortcut');localStorage.setItem('hornet.terminal.rules.v1',JSON.stringify(parsed));set({value:parsed});}}));
// Match streaming plain text, never escape sequences or unbounded regexes.
// A rule fires at most once per logical output line, with a global rate limit.
export class TerminalTriggers {
 private text=new TerminalText();private line='';private seen=new Set<string>();private last=new Map<string,number>();private times:number[]=[];
 feed(data:Uint8Array,rules:TriggerRule[],now=Date.now()){
  const matches:TriggerRule[]=[];this.times=this.times.filter(time=>now-time<60000);
  for(const piece of this.text.write(data).split(/(\r|\n)/)){
   if(piece==='\r'||piece==='\n'){this.line='';this.seen.clear();continue;}
   this.line=(this.line+piece).slice(-8192);
   for(const rule of rules){if(!rule.enabled||this.seen.has(rule.id)||!this.line.includes(rule.text))continue;this.seen.add(rule.id);if(now-(this.last.get(rule.id)??-Infinity)<rule.cooldown||this.times.length>=20)continue;this.last.set(rule.id,now);this.times.push(now);matches.push(rule);}
  }
  return matches;
 }
}
