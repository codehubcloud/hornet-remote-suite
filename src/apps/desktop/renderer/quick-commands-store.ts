import { create } from 'zustand';
import { z } from 'zod';
import { quickCommandSchema,readQuickCommands,terminalAction,type QuickCommand } from './terminal-preferences';
import { isTerminalClosed,useStore,type View } from './store';
const setSchema=z.object({id:z.string().min(1).max(80),name:z.string().trim().min(1).max(80)}).strict();
export const quickLibrarySchema=z.object({version:z.literal(2),sets:z.array(setSchema).min(1).max(100),commands:z.array(quickCommandSchema).max(500)}).strict().refine(v=>new Set(v.sets.map(s=>s.id)).size===v.sets.length&&new Set(v.commands.map(c=>c.id)).size===v.commands.length&&v.commands.every(c=>v.sets.some(s=>s.id===(c.setId??'default')))).refine(v=>new TextEncoder().encode(JSON.stringify(v,null,2)).length<=1048576,'Command library exceeds 1 MiB');
export type QuickLibrary=z.infer<typeof quickLibrarySchema>;
const key='hornet.terminal.commands.v2';
export function readQuickLibrary(current:string|null,legacy:string|null):QuickLibrary{
 if(current){try{return quickLibrarySchema.parse(JSON.parse(current));}catch{/* Keep a corrupt v2 library intact until an explicit save. */}}
 return {version:2,sets:[{id:'default',name:'默认命令集'}],commands:readQuickCommands(legacy)};
}
function initial(){try{return readQuickLibrary(localStorage.getItem(key),localStorage.getItem('hornet.terminal.commands.v1'));}catch{return readQuickLibrary(null,null);}}
function visible(){try{return z.object({bar:z.boolean().optional(),pane:z.boolean().optional()}).parse(JSON.parse(localStorage.getItem('hornet.quick.visible')??'{}'));}catch{return {};}}
export const useQuickCommands=create<{library:QuickLibrary;bar:boolean;pane:boolean;manager:boolean;editingId:string|null;openEditor:(commandId:string)=>void;selected:Record<string,string>;persist:(library:QuickLibrary)=>void;show:(kind:'bar'|'pane'|'manager',value:boolean)=>void;select:(viewId:string,setId:string)=>void}>(set=>({
 library:initial(),bar:visible().bar===true,pane:visible().pane===true,manager:false,editingId:null,openEditor:editingId=>set({editingId,manager:true}),selected:{},
 persist:library=>{const parsed=quickLibrarySchema.parse(library);localStorage.setItem(key,JSON.stringify(parsed));set({library:parsed});},
 show:(kind,value)=>set(s=>{const next={bar:s.bar,pane:s.pane,[kind]:value};localStorage.setItem('hornet.quick.visible',JSON.stringify({bar:next.bar,pane:next.pane}));return {[kind]:value,...(kind==='manager'?{editingId:null}:{})};}),
 select:(viewId,setId)=>set(s=>({selected:{...s.selected,[viewId]:setId}})),
}));
export function commandSet(view:View|undefined){const s=useQuickCommands.getState(),id=view?s.selected[view.id]??view.profile.session?.quickCommandSetId:'default';return s.library.sets.some(set=>set.id===id)?id!:(s.library.sets[0]?.id??'default');}
export function canSendCommand(view:View|undefined){const s=useStore.getState();return !!view?.terminalId&&view.kind==='terminal'&&!isTerminalClosed(view,s)&&!s.reconnecting[view.id];}
export function sendQuickCommand(command:QuickCommand,view:View|undefined){if(!canSendCommand(view))return;terminalAction({viewId:view!.id,terminalId:view!.terminalId,kind:'execute',text:command.text,enter:command.enter!==false});}
