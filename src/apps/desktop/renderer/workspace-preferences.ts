import { z } from 'zod';
import { create } from 'zustand';
const schema=z.object({statusBar:z.boolean(),transferQueue:z.boolean(),folderTree:z.boolean(),fileLog:z.boolean(),fileDisplay:z.enum(['large','small','list','details'])}).strict();
export type WorkspacePreferences=z.infer<typeof schema>;
const defaults:WorkspacePreferences={statusBar:true,transferQueue:true,folderTree:false,fileLog:false,fileDisplay:'details'};
function read(){try{return schema.parse({...defaults,...JSON.parse(localStorage.getItem('hornet.workspace.preferences.v1')??'{}')});}catch{return {...defaults};}}
export const useWorkspacePreferences=create<{value:WorkspacePreferences;change:(patch:Partial<WorkspacePreferences>)=>void}>(set=>({value:read(),change:patch=>set(old=>{const value=schema.parse({...old.value,...patch});localStorage.setItem('hornet.workspace.preferences.v1',JSON.stringify(value));return {value};})}));
type JournalEntry={at:number;message:string;failed?:boolean};
export const useFileJournal=create<{entries:Record<string,JournalEntry[]>;record:(viewId:string,message:string,failed?:boolean)=>void;clear:(viewId:string)=>void}>(set=>({entries:{},record:(viewId,message,failed)=>set(old=>({entries:{...old.entries,[viewId]:[...(old.entries[viewId]??[]),{at:Date.now(),message:message.slice(0,2048),failed}].slice(-500)}})),clear:viewId=>set(old=>{const entries={...old.entries};delete entries[viewId];return {entries};})}));
