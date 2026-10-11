import { z } from 'zod';
import { create } from 'zustand';

export const terminalPreferencesSchema=z.object({
 fontSize:z.number().int().min(8).max(32),font:z.enum(['cascadia','consolas','courier']),
 theme:z.enum(['hornet','light','solarized']),scrollback:z.number().int().min(1000).max(100000),
 cursorStyle:z.enum(['block','bar','underline']),cursorBlink:z.boolean(),
}).strict();
export type TerminalPreferences=z.infer<typeof terminalPreferencesSchema>;
export const terminalDefaults:TerminalPreferences={fontSize:14,font:'cascadia',theme:'hornet',scrollback:10000,cursorStyle:'block',cursorBlink:true};
export const terminalFonts={cascadia:'Cascadia Code, Consolas, monospace',consolas:'Consolas, monospace',courier:'Courier New, monospace'};
export const terminalThemes={
 hornet:{background:'#0b1220',foreground:'#d5e0ee',cursor:'#38d9c4',selectionBackground:'#29485d'},
 light:{background:'#fafafa',foreground:'#202020',cursor:'#156b9e',selectionBackground:'#b6d8f0'},
 solarized:{background:'#002b36',foreground:'#93a1a1',cursor:'#b58900',selectionBackground:'#264b55'},
};
export function readTerminalPreferences(value:string|null){try{return terminalPreferencesSchema.parse(JSON.parse(value??''));}catch{return {...terminalDefaults};}}
function initial(){try{return readTerminalPreferences(localStorage.getItem('hornet.terminal.preferences.v1'));}catch{return {...terminalDefaults};}}
export const useTerminalPreferences=create<{value:TerminalPreferences;save:(value:TerminalPreferences)=>void}>(set=>({value:initial(),save:value=>{const parsed=terminalPreferencesSchema.parse(value);localStorage.setItem('hornet.terminal.preferences.v1',JSON.stringify(parsed));set({value:parsed});}}));

export const quickCommandSchema=z.object({id:z.string().uuid(),name:z.string().trim().min(1).max(80),text:z.string().min(1).max(8192).refine(v=>!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v),'命令不能包含终端控制字符。')}).strict();
export type QuickCommand=z.infer<typeof quickCommandSchema>;
export function readQuickCommands(value:string|null):QuickCommand[]{try{return z.array(quickCommandSchema).max(100).parse(JSON.parse(value??''));}catch{return [];}}
export function saveQuickCommands(commands:QuickCommand[]){const parsed=z.array(quickCommandSchema).max(100).parse(commands);localStorage.setItem('hornet.terminal.commands.v1',JSON.stringify(parsed));}
export type TerminalAction={viewId:string;kind:'export'|'selectAll'|'clear'|'execute'|'copy'|'paste'|'reset'|'input';terminalId?:string;text?:string};
export function terminalAction(action:TerminalAction){window.dispatchEvent(new CustomEvent('hornet:terminal-action',{detail:action}));}
