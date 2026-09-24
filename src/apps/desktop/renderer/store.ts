import { removeLeaf,tileTerminals,type SplitTree } from './terminal-layout';
import { create } from 'zustand';
import type { HornetApi,Profile,TaskSnapshot,Capability,HornetEvent } from '../../../packages/contracts';
declare global {interface Window {hornet:HornetApi}}
export interface View {
 title?:string;id:string;kind:'terminal'|'files'|'editor'|'vnc';profile:Profile;connectionId:string;leaseId?:string;
 desktop?: { desktopId: string; url: string; token: string };
 terminalIds?:string[];terminalId?:string;generation:number;path?:string;content?:string;hash?:string;
}
interface State {
 terminalLayout:SplitTree|null;terminalMenu:{viewId:string;x:number;y:number}|null;
 setTerminalLayout(layout:SplitTree|null):void;tileTerminals(axis:'horizontal'|'vertical'):void;renameTerminal(id:string,title:string):void;setTerminalMenu(menu:{viewId:string;x:number;y:number}|null):void;
 profiles:Profile[];tasks:TaskSnapshot[];capabilities:Capability[];views:View[];active:string;
 error:string;challenges:Extract<HornetEvent,{type:'challenge'}>[];connectionStates:Record<string,string>;
 setProfiles(profiles:Profile[]):void;setTasks(tasks:TaskSnapshot[]):void;setCapabilities(capabilities:Capability[]):void;
 setTerminalIds(id:string,ids:string[]):void;addView(view:View):void;removeView(id:string):void;setActive(id:string):void;fail(e:unknown):void;
 event(event:HornetEvent):void;clearError():void;
}
export const useStore=create<State>((set)=>({
 terminalLayout:null,terminalMenu:null,
 setTerminalLayout:terminalLayout=>set({terminalLayout}),
 tileTerminals:axis=>set(s=>({terminalLayout:tileTerminals(s.views.filter(v=>v.kind==='terminal').map(v=>v.id),axis)})),
 renameTerminal:(id,title)=>set(s=>({views:s.views.map(v=>v.id===id&&v.kind==='terminal'?{...v,title}:v)})),
 setTerminalMenu:terminalMenu=>set({terminalMenu}),
 profiles:[],tasks:[],capabilities:[],views:[],active:'home',error:'',challenges:[],connectionStates:{},
 setProfiles:profiles=>set({profiles}),setTasks:tasks=>set({tasks}),setCapabilities:capabilities=>set({capabilities}),
 setTerminalIds:(id,ids)=>set(s=>({views:s.views.map(v=>v.id===id?{...v,terminalIds:ids}:v)})),
 addView:view=>set(s=>({views:[...s.views,view],active:view.id})),
 removeView:id=>set(s=>({views:s.views.filter(v=>v.id!==id),terminalLayout:s.terminalLayout?removeLeaf(s.terminalLayout,id):null,active:s.active===id?(s.views.find(v=>v.id!==id&&v.kind==='terminal')?.id??'home'):s.active})),
 setActive:active=>set({active}),fail:e=>set({error:e instanceof Error?e.message:String(e)}),clearError:()=>set({error:''}),
 event:event=>set(s=>{
  if(event.type==='challenge')return {challenges:[...s.challenges,event]};
  if(event.type==='challenge.closed')return {challenges:s.challenges.filter(c=>c.challengeId!==event.challengeId)};
  if(event.type==='task.state')return {tasks:[event.task,...s.tasks.filter(t=>t.taskId!==event.task.taskId)]};
  if(event.type==='connection.state')return {connectionStates:{...s.connectionStates,[event.connectionId]:event.state}};
  if(event.type==='service.error')return {error:event.message};
  return {};
 })
}));
export async function refreshProfiles(){useStore.getState().setProfiles(await window.hornet.profiles.list());}
export async function openView(profile:Profile,kind:'terminal'|'files'){
 const api=window.hornet;const lease=await api.connection.open(profile.profileId,kind);
 try{
  if(kind==='terminal'){
   const terminal=await api.terminal.create(lease.connectionId,120,36,true);
   // Keep the view lease for its SFTP sidebar, independent of the shell lease.
   useStore.getState().addView({id:crypto.randomUUID(),kind,profile,...lease,...terminal,terminalIds:[terminal.terminalId],generation:lease.generation});
  }else useStore.getState().addView({id:crypto.randomUUID(),kind,profile,...lease});
  const views=useStore.getState().views;
  await api.layout.save({profileIds:[...new Set(views.map(v=>v.profile.profileId))],activeProfileId:profile.profileId}).catch(useStore.getState().fail);
 }catch(e){await api.connection.release(lease.leaseId);throw e;}
}
