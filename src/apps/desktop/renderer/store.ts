import type { DeviceTerminal } from '../../../packages/contracts/device-terminal';
import { removeLeaf,tileTerminals,type SplitTree } from './terminal-layout';
import type { TerminalLog } from '../../../packages/contracts/terminal-log';
import { create } from 'zustand';
import { useBroadcast } from './broadcast';
import type { HornetApi,Profile,TaskSnapshot,Capability,HornetEvent } from '../../../packages/contracts';
declare global {interface Window {hornet:HornetApi}}
export interface View {
 source?:'local'|'serial';
 title?:string;id:string;kind:'terminal'|'files'|'editor'|'vnc';profile:Profile;connectionId:string;leaseId?:string;
 desktop?: { desktopId: string; url: string; token: string };
 terminalIds?:string[];terminalId?:string;generation:number;path?:string;content?:string;hash?:string;
}
interface State {
 closedTerminals:Record<string,boolean>;reconnecting:Record<string,boolean>;
 replaceView(id:string,view:View):void;setReconnecting(id:string,value:boolean):void;
 logs:TerminalLog[];setLogs(logs:TerminalLog[]):void;
 terminalLayout:SplitTree|null;terminalMenu:{viewId:string;x:number;y:number}|null;
 setTerminalLayout(layout:SplitTree|null):void;tileTerminals(axis:'horizontal'|'vertical'):void;renameTerminal(id:string,title:string):void;setTerminalMenu(menu:{viewId:string;x:number;y:number}|null):void;
 profiles:Profile[];tasks:TaskSnapshot[];capabilities:Capability[];views:View[];active:string;
 error:string;challenges:Extract<HornetEvent,{type:'challenge'}>[];connectionStates:Record<string,string>;
 setProfiles(profiles:Profile[]):void;setTasks(tasks:TaskSnapshot[]):void;setCapabilities(capabilities:Capability[]):void;
 setTerminalIds(id:string,ids:string[]):void;addView(view:View):void;removeView(id:string):void;setActive(id:string):void;fail(e:unknown):void;
 event(event:HornetEvent):void;clearError():void;
}
export const useStore=create<State>((set)=>({
 closedTerminals:{},reconnecting:{},
 replaceView:(id,view)=>set(s=>({views:s.views.map(v=>v.id===id?view:v)})),
 setReconnecting:(id,value)=>set(s=>({reconnecting:{...s.reconnecting,[id]:value}})),
 logs:[],setLogs:logs=>set({logs}),terminalLayout:null,terminalMenu:null,
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
  if(event.type==='terminal.closed'){useBroadcast.getState().remove(event.terminalId);return {closedTerminals:{...s.closedTerminals,[event.terminalId]:true}};}
  if(event.type==='challenge')return {challenges:[...s.challenges,event]};
  if(event.type==='challenge.closed')return {challenges:s.challenges.filter(c=>c.challengeId!==event.challengeId)};
  if(event.type==='terminal.log')return {logs:[event.log,...s.logs.filter(l=>l.id!==event.log.id)],error:event.log.state==='failed'?(event.log.error??'终端日志写入失败。'):s.error};
  if(event.type==='task.state')return {tasks:[event.task,...s.tasks.filter(t=>t.taskId!==event.task.taskId)]};
  if(event.type==='connection.state')return {connectionStates:{...s.connectionStates,[event.connectionId]:event.state}};
  if(event.type==='service.error')return {error:event.message};
  return {};
 })
}));
export async function refreshProfiles(){useStore.getState().setProfiles(await window.hornet.profiles.list());}
export async function openView(profile:Profile,kind:'terminal'|'files'){
 if(profile.protocol==='ftp')kind='files';
 const view=await createRemoteView(profile,kind);useStore.getState().addView(view);
 await window.hornet.layout.save({profileIds:[...new Set(useStore.getState().views.filter(v=>!v.source).map(v=>v.profile.profileId))],activeProfileId:profile.profileId}).catch(useStore.getState().fail);
}
async function createRemoteView(profile:Profile,kind:'terminal'|'files'):Promise<View>{
 const api=window.hornet;
 if(profile.protocol==='telnet'){
  if(kind!=='terminal')throw new Error('Telnet 不支持文件传输，请使用 SSH 配置。');
  const session=await api.telnet.open(profile.profileId,120,36);
  return {id:crypto.randomUUID(),kind,profile,...session,terminalIds:[session.terminalId]};
 }
 const lease=await api.connection.open(profile.profileId,kind);
 try{
  if(kind==='terminal'){
   const terminal=await api.terminal.create(lease.connectionId,120,36,true);
   // Keep the view lease for its SFTP sidebar, independent of the shell lease.
   return {id:crypto.randomUUID(),kind,profile,...lease,...terminal,terminalIds:[terminal.terminalId],generation:lease.generation};
  }else return {id:crypto.randomUUID(),kind,profile,...lease};
 }catch(e){await api.connection.release(lease.leaseId);throw e;}
}

async function releaseTerminalView(view:View){
 for(const id of view.terminalIds??(view.terminalId?[view.terminalId]:[]))await window.hornet.terminal.close(id);
 if(view.leaseId)await window.hornet.connection.release(view.leaseId);
}
export async function reconnectView(id:string){
 const initial=useStore.getState(),old=initial.views.find(v=>v.id===id);
 if(!old||old.kind!=='terminal'||old.source||initial.reconnecting[id])return;
 initial.setReconnecting(id,true);
 let next:View|undefined;
 try{
  const profile=initial.profiles.find(p=>p.profileId===old.profile.profileId)??old.profile;
  next=await createRemoteView(profile,'terminal');
  // The user may close the tab while authentication is pending.
  if(useStore.getState().views.find(v=>v.id===id)?.terminalId!==old.terminalId){await releaseTerminalView(next);next=undefined;return;}
  await releaseTerminalView(old);
  useStore.getState().replaceView(id,{...next,id,title:old.title});next=undefined;
 }finally{if(next)await releaseTerminalView(next).catch(useStore.getState().fail);useStore.getState().setReconnecting(id,false);}
}

export const hasRemoteFiles=(view:View)=>!view.source&&view.profile.protocol!=='telnet';
export function addDeviceView(session:DeviceTerminal){
 const profile:Profile={profileId:session.connectionId,name:session.name,host:session.address,port:0,username:'',group:'',authType:'password',revision:0};
 useStore.getState().addView({id:crypto.randomUUID(),kind:'terminal',profile,...session,terminalIds:[session.terminalId]});
}
