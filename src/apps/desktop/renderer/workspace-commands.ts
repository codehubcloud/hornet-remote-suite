import { create } from 'zustand';
/** Ephemeral commands from a mounted workspace. Never persisted or sent over IPC. */
export type WorkspaceCommands=Record<string,(()=>void)|undefined>;
export const useWorkspaceCommands=create<{
 flags:Record<string,Record<string,boolean>>;setFlags:(id:string,flags:Record<string,boolean>)=>void;
 focused:Record<string,'local'|'remote'>;focus:(id:string,side:'local'|'remote')=>void;
 entries:Record<string,WorkspaceCommands>;
 publish:(id:string,commands:WorkspaceCommands)=>void;
 remove:(id:string)=>void;
}>(set=>({
 flags:{},setFlags:(id,flags)=>set(state=>({flags:{...state.flags,[id]:flags}})),
 focused:{},focus:(id,side)=>set(old=>({focused:{...old.focused,[id]:side}})),
 entries:{},
 publish:(id,commands)=>set(state=>({entries:{...state.entries,[id]:commands}})),
 remove:id=>set(state=>{const entries={...state.entries};delete entries[id];const focused={...state.focused},flags={...state.flags};delete focused[id];delete flags[id];return {entries,focused,flags};})
}));
