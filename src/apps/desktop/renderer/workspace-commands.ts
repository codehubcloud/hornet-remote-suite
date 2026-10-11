import { create } from 'zustand';
/** Ephemeral commands from a mounted workspace. Never persisted or sent over IPC. */
export type WorkspaceCommands=Record<string,(()=>void)|undefined>;
export const useWorkspaceCommands=create<{
 entries:Record<string,WorkspaceCommands>;
 publish:(id:string,commands:WorkspaceCommands)=>void;
 remove:(id:string)=>void;
}>(set=>({
 entries:{},
 publish:(id,commands)=>set(state=>({entries:{...state.entries,[id]:commands}})),
 remove:id=>set(state=>{const entries={...state.entries};delete entries[id];return {entries};})
}));
