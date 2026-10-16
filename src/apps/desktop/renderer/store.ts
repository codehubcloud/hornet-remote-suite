import type { TerminalDisconnect } from '../../../packages/contracts/terminal-disconnect';
import type { DeviceTerminal } from '../../../packages/contracts/device-terminal';
import { tileTerminals,type SplitTree } from './terminal-layout';
import { tabGroup,selectTab,removeTab,createTabGroup,moveTab } from './terminal-tabs';
import type { TerminalLog } from '../../../packages/contracts/terminal-log';
import { create } from 'zustand';
import { useBroadcast } from './broadcast';
import type { HornetApi,Profile,TaskSnapshot,Capability,HornetEvent } from '../../../packages/contracts';
declare global {interface Window {hornet:HornetApi}}
export interface View {
 autoReconnectPaused?:boolean;
 tabGroupId?:string;locked?:boolean;tabColor?:string;terminalTitle?:string;
 source?:'local'|'serial';
 title?:string;id:string;kind:'terminal'|'files'|'editor'|'vnc';profile:Profile;connectionId:string;leaseId?:string;
 desktop?: { desktopId: string; url: string; token: string };
 terminalIds?:string[];terminalId?:string;generation:number;path?:string;content?:string;hash?:string;
}
interface State {
 blankTabs:string[];blankGroups:Record<string,string>;newTab():void;closeBlankTab(id:string):void;
 tabDisplay:{numbers:boolean;title:boolean;status:boolean};setTabDisplay(key:'numbers'|'title'|'status',value:boolean):void;
 updateTerminal(id:string,patch:Pick<View,'locked'|'tabColor'|'terminalTitle'>):void;
 createTabGroup(id:string,axis:'horizontal'|'vertical'):void;moveTab(id:string,groupId:string):void;
 terminalDisconnects:Record<string,TerminalDisconnect>;connectionDisconnects:Record<string,TerminalDisconnect & {generation:number}>;
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
 blankTabs:[],blankGroups:{},newTab:()=>set(s=>{const id='blank-'+crypto.randomUUID(),view=s.views.find(v=>v.id===s.active&&v.kind==='terminal');return {blankTabs:[...s.blankTabs,id],blankGroups:{...s.blankGroups,[id]:view?tabGroup(view):s.blankGroups[s.active]??'main'},active:id};}),closeBlankTab:id=>set(s=>{const blankGroups={...s.blankGroups};delete blankGroups[id];return {blankTabs:s.blankTabs.filter(tab=>tab!==id),blankGroups,active:s.active===id?'home':s.active};}),
 tabDisplay:readTabDisplay(),setTabDisplay:(key,value)=>set(s=>{const tabDisplay={...s.tabDisplay,[key]:value};try{localStorage.setItem('hornet.tabs.display',JSON.stringify(tabDisplay));}catch{}return {tabDisplay};}),
 updateTerminal:(id,patch)=>set(s=>({views:s.views.map(v=>v.id===id?{...v,...patch}:v)})),
 createTabGroup:(id,axis)=>set(s=>createTabGroup(s.views,s.terminalLayout,id,axis)),moveTab:(id,groupId)=>set(s=>({...moveTab(s.views,s.terminalLayout,id,groupId),active:id})),
 terminalDisconnects:{},connectionDisconnects:{},closedTerminals:{},reconnecting:{},
 replaceView:(id,view)=>set(s=>({views:s.views.map(v=>v.id===id?view:v)})),
 setReconnecting:(id,value)=>set(s=>({reconnecting:{...s.reconnecting,[id]:value}})),
 logs:[],setLogs:logs=>set({logs}),terminalLayout:null,terminalMenu:null,
 setTerminalLayout:terminalLayout=>set(s=>({terminalLayout,...(!terminalLayout?{views:s.views.map(v=>({...v,tabGroupId:undefined}))}:{})})),
 tileTerminals:axis=>set(s=>({views:s.views.map(v=>v.kind==='terminal'?{...v,tabGroupId:v.id}:v),terminalLayout:tileTerminals(s.views.filter(v=>v.kind==='terminal').map(v=>v.id),axis)})),
 renameTerminal:(id,title)=>set(s=>({views:s.views.map(v=>v.id===id&&v.kind==='terminal'?{...v,title}:v)})),
 setTerminalMenu:terminalMenu=>set({terminalMenu}),
 profiles:[],tasks:[],capabilities:[],views:[],active:'home',error:'',challenges:[],connectionStates:{},
 setProfiles:profiles=>set(s=>({profiles,views:s.views.map(v=>{const p=profiles.find(p=>p.profileId===v.profile.profileId);return p?{...v,profile:{...v.profile,name:p.name,description:p.description,session:p.session,revision:p.revision}}:v;})})),setTasks:tasks=>set({tasks}),setCapabilities:capabilities=>set({capabilities}),
 setTerminalIds:(id,ids)=>set(s=>({views:s.views.map(v=>v.id===id?{...v,terminalIds:ids}:v)})),
 addView:view=>set(s=>{const current=s.views.find(v=>v.id===s.active&&v.kind==='terminal'),next={...view,tabGroupId:view.tabGroupId??current?.tabGroupId??s.blankGroups[s.active]};const views=[...s.views,next],blankGroups={...s.blankGroups};delete blankGroups[s.active];return {views,blankGroups,blankTabs:s.blankTabs.filter(id=>id!==s.active),terminalLayout:selectTab(views,s.terminalLayout,next.id),active:view.id};}),
 removeView:id=>set(s=>{const view=s.views.find(v=>v.id===id),remaining=s.views.filter(v=>v.id!==id),next=view&&remaining.find(v=>v.kind==='terminal'&&tabGroup(v)===tabGroup(view));return {views:remaining,terminalLayout:removeTab(s.views,s.terminalLayout,id),active:s.active===id?(next?.id??remaining.find(v=>v.kind==='terminal')?.id??'home'):s.active};}),
 setActive:active=>set(s=>({active,terminalLayout:selectTab(s.views,s.terminalLayout,active)})),fail:e=>set({error:e instanceof Error?e.message:String(e)}),clearError:()=>set({error:''}),
 event:event=>set(s=>{
  if(event.type==='terminal.closed'){
   const view=s.views.find(v=>v.terminalId===event.terminalId);
   if(view&&event.generation!==undefined&&view.generation!==event.generation)return {};
   useBroadcast.getState().remove(event.terminalId);
   const connection=view?s.connectionDisconnects[view.connectionId]:undefined;
   const disconnect=s.terminalDisconnects[event.terminalId]??event.disconnect??(connection?.generation===view?.generation?connection:undefined)??{reason:view?.autoReconnectPaused?'user':'exit',at:Date.now()};
   return {closedTerminals:{...s.closedTerminals,[event.terminalId]:true},terminalDisconnects:{...s.terminalDisconnects,[event.terminalId]:disconnect}};
  }
  if(event.type==='challenge')return {challenges:[...s.challenges,event]};
  if(event.type==='challenge.closed')return {challenges:s.challenges.filter(c=>c.challengeId!==event.challengeId)};
  if(event.type==='terminal.log')return {logs:[event.log,...s.logs.filter(l=>l.id!==event.log.id)],error:event.log.state==='failed'?(event.log.error??'终端日志写入失败。'):s.error};
  if(event.type==='task.state')return {tasks:[event.task,...s.tasks.filter(t=>t.taskId!==event.task.taskId)]};
  if(event.type==='connection.state'){
   const closedTerminals={...s.closedTerminals},terminalDisconnects={...s.terminalDisconnects},connectionDisconnects={...s.connectionDisconnects};
   if(event.state==='closed'||event.state==='failed')connectionDisconnects[event.connectionId]??={...event.disconnect??{reason:event.error?'error':'remote',at:Date.now(),error:event.error},generation:event.generation};
   if(event.state==='closed'||event.state==='failed')for(const view of s.views)if(view.connectionId===event.connectionId&&view.generation===event.generation&&view.terminalId){closedTerminals[view.terminalId]=true;terminalDisconnects[view.terminalId]??=connectionDisconnects[event.connectionId];useBroadcast.getState().remove(view.terminalId);}
   return {connectionStates:{...s.connectionStates,[event.connectionId]:event.state},closedTerminals,terminalDisconnects,connectionDisconnects};
  }
  if(event.type==='service.error')return {error:event.message};
  return {};
 })
}));
function readTabDisplay(){try{const value=JSON.parse(localStorage.getItem('hornet.tabs.display')??'{}');return {numbers:value.numbers!==false,title:value.title===true,status:value.status!==false};}catch{return {numbers:true,title:false,status:true};}}
export async function refreshProfiles(){useStore.getState().setProfiles(await window.hornet.profiles.list());}
export function isTerminalClosed(view:View,state:Pick<State,'closedTerminals'|'connectionStates'>){return !!state.closedTerminals[view.terminalId??'']||['closed','failed'].includes(state.connectionStates[view.connectionId]);}
export async function openView(profile:Profile,kind:'terminal'|'files'){
 if(profile.protocol==='ftp')kind='files';
 const view=await createRemoteView(profile,kind);useStore.getState().addView(view);
 await window.hornet.layout.save({profileIds:[...new Set(useStore.getState().views.filter(v=>!v.source).map(v=>v.profile.profileId))],activeProfileId:profile.profileId}).catch(useStore.getState().fail);
}
async function createRemoteView(profile:Profile,kind:'terminal'|'files',options:{fresh?:boolean;connectionId?:string}={}):Promise<View>{
 const api=window.hornet;
 if(profile.protocol==='telnet'){
  if(kind!=='terminal')throw new Error('Telnet 不支持文件传输，请使用 SSH 配置。');
  const session=await api.telnet.open(profile.profileId,profile.session?.terminal?.cols??120,profile.session?.terminal?.rows??36);
  return {id:crypto.randomUUID(),kind,profile,...session,terminalIds:[session.terminalId]};
 }
 const lease=options.connectionId?await api.connection.retain(options.connectionId):await api.connection.open(profile.profileId,kind,options.fresh);
 try{
  if(kind==='terminal'){
   const terminal=await api.terminal.create(lease.connectionId,profile.session?.terminal?.cols??120,profile.session?.terminal?.rows??36,true);
   // Keep the view lease for its SFTP sidebar, independent of the shell lease.
   return {id:crypto.randomUUID(),kind,profile,...lease,...terminal,terminalIds:[terminal.terminalId],generation:lease.generation};
  }else return {id:crypto.randomUUID(),kind,profile,...lease};
 }catch(e){await api.connection.release(lease.leaseId);throw e;}
}

async function releaseTerminalView(view:View){
 for(const id of view.terminalIds??(view.terminalId?[view.terminalId]:[]))await window.hornet.terminal.close(id);
 if(view.leaseId)await window.hornet.connection.release(view.leaseId);
}
export async function closeTerminalView(id:string){
 const view=useStore.getState().views.find(v=>v.id===id&&v.kind==='terminal');if(!view)return;
 if(view.locked)return;
 await releaseTerminalView(view);useStore.getState().removeView(id);
 await window.hornet.layout.save({profileIds:[...new Set(useStore.getState().views.filter(v=>!v.source).map(v=>v.profile.profileId))]});
}
export async function closeTerminalTabs(ids:string[]){for(const id of ids)await closeTerminalView(id);}
export async function duplicateTerminal(id:string,channel=false){
 const s=useStore.getState(),view=s.views.find(v=>v.id===id&&v.kind==='terminal');if(!view)return;
 if(view.source==='local'){addDeviceView(await window.hornet.localTerminal.open({shell:/CMD/i.test(view.profile.name)?'cmd':'powershell',cwd:view.profile.host,cols:120,rows:36}),tabGroup(view));return;}
 if(view.source)return;
 if(channel&&(view.profile.protocol&&view.profile.protocol!=='ssh'||isTerminalClosed(view,s)))return;
 const next=await createRemoteView(view.profile,'terminal',channel?{connectionId:view.connectionId}:{fresh:true});
 useStore.getState().addView({...next,tabGroupId:tabGroup(view)});
}
export async function newTerminalGroup(id:string,axis:'horizontal'|'vertical'){
 const s=useStore.getState(),view=s.views.find(v=>v.id===id&&v.kind==='terminal');if(!view)return;
 if(s.views.some(v=>v.kind==='terminal'&&v.id!==id&&tabGroup(v)===tabGroup(view))){s.createTabGroup(id,axis);return;}
 const session=await window.hornet.localTerminal.open({shell:'powershell',cols:120,rows:36});
 addDeviceView(session,tabGroup(view));const next=useStore.getState().views.find(v=>v.terminalId===session.terminalId);
 if(next)useStore.getState().createTabGroup(next.id,axis);
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
  useStore.getState().replaceView(id,{...next,id,title:old.title,tabGroupId:old.tabGroupId,locked:old.locked,tabColor:old.tabColor});next=undefined;
 }finally{if(next)await releaseTerminalView(next).catch(useStore.getState().fail);useStore.getState().setReconnecting(id,false);}
}

export async function disconnectView(id:string){
 const s=useStore.getState(),view=s.views.find(v=>v.id===id);if(!view?.terminalId)return;
 s.replaceView(id,{...view,autoReconnectPaused:true});
 try{await window.hornet.terminal.close(view.terminalId);}catch(error){const current=useStore.getState().views.find(v=>v.id===id);if(current?.terminalId===view.terminalId)useStore.getState().replaceView(id,{...current,autoReconnectPaused:view.autoReconnectPaused});throw error;}
}

export const hasRemoteFiles=(view:View)=>!view.source&&view.profile.protocol!=='telnet';
export function addDeviceView(session:DeviceTerminal,tabGroupId?:string){
 const profile:Profile={profileId:session.connectionId,name:session.name,host:session.address,port:0,username:'',group:'',authType:'password',revision:0};
 useStore.getState().addView({id:crypto.randomUUID(),kind:'terminal',profile,...session,tabGroupId,terminalIds:[session.terminalId]});
}
