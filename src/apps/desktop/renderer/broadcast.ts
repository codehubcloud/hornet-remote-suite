import { create } from 'zustand';
export interface BroadcastTarget {viewId:string;terminalId:string;name:string}
export const useBroadcast=create<{targets:BroadcastTarget[];start:(targets:BroadcastTarget[])=>void;stop:()=>void;remove:(id:string)=>void}>(set=>({
 targets:[],start:targets=>{if(targets.length<2||targets.length>16||new Set(targets.map(t=>t.terminalId)).size!==targets.length)throw new Error('Select 2–16 distinct terminals');set({targets});},stop:()=>set({targets:[]}),
 remove:id=>set(s=>{const targets=s.targets.filter(t=>t.terminalId!==id);return {targets:targets.length>=2?targets:[]};}),
}));
