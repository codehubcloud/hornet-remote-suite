import { useEffect,useRef } from 'react';
import { t as tr } from './i18n';
import { isTerminalClosed,reconnectView,useStore,type View } from './store';
export function AutoReconnect(){const s=useStore();return <>{s.views.filter(v=>v.kind==='terminal'&&!v.source&&(v.profile.protocol??'ssh')==='ssh').map(view=><ReconnectSession key={view.id} view={view}/>)}</>;}
function ReconnectSession({view}:{view:View}){
 const s=useStore(),options=view.profile.session?.reconnect,closed=isTerminalClosed(view,s),transportClosed=['closed','failed'].includes(s.connectionStates[view.connectionId]);
 const enabled=!!options?.enabled&&closed&&transportClosed&&!view.autoReconnectPaused,start=useRef(0),reported=useRef(false);
 useEffect(()=>{
  if(!enabled){start.current=0;reported.current=false;return;}
  if(!start.current)start.current=Date.now();if(s.reconnecting[view.id])return;
  const interval=options!.intervalSeconds*1000,deadline=options!.limitMinutes?start.current+options!.limitMinutes*60000:Infinity;
  if(Date.now()+interval>deadline){if(!reported.current){reported.current=true;s.fail(new Error(tr('自动重连已达到时限。')));}return;}
  const timer=setTimeout(()=>{const state=useStore.getState(),current=state.views.find(v=>v.id===view.id);if(current&&current.terminalId===view.terminalId&&!current.autoReconnectPaused)void reconnectView(view.id).catch(state.fail);},interval);
  return()=>clearTimeout(timer);
 },[enabled,options?.intervalSeconds,options?.limitMinutes,s.reconnecting[view.id],view.terminalId]);
 return null;
}
