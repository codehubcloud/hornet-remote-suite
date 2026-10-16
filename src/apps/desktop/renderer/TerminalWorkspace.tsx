import { t as tr } from './i18n';
import { useBroadcast } from './broadcast';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore,openView,hasRemoteFiles,isTerminalClosed } from './store';
import { FileView } from './FileView';
import { QuickCommandSurface } from './QuickCommandWorkspace';
import { useQuickCommands } from './quick-commands-store';
import { TerminalView } from './TerminalView';
import { layoutRects,setRatio } from './terminal-layout';

export function TerminalWorkspace({splitActive,renderTabs}:{splitActive:boolean;renderTabs:(paneId?:string,common?:boolean)=>ReactNode}) {
 const broadcast=useBroadcast();
 const s=useStore(),panes=s.views.filter(v=>v.kind==='terminal');
 const view=panes.find(v=>v.id===s.active)??panes[0],active=view?.id??'';
 const disconnected=view?isTerminalClosed(view,s):false;
 const commands=useQuickCommands();
 const [requests,setRequests]=useState<Record<string,number>>({});
 const [follow,setFollow]=useState(false),[followStatus,setFollowStatus]=useState(''),[target,setTarget]=useState<{terminalId:string;path:string}>();
 useEffect(()=>{const search=()=>{const id=useStore.getState().active;setRequests(r=>({...r,[id]:(r[id]??0)+1}));};window.addEventListener('hornet:terminal-search',search);return()=>window.removeEventListener('hornet:terminal-search',search);},[]);
 const grid=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  if(!follow||!view||s.active!==view.id||!hasRemoteFiles(view))return;
  if(disconnected){setFollowStatus(tr('已断开'));setTarget(undefined);return;}
  let cancelled=false,timer:ReturnType<typeof setTimeout>;
  setFollowStatus(tr("正在获取目录…"));setTarget(undefined);
  const id=view.terminalId!;
  const poll=async()=>{try{
   const result=await window.hornet.terminal.cwd(id);
   if(cancelled)return;
   if(result.path){setTarget(old=>old?.terminalId===id&&old.path===result.path?old:{terminalId:id,path:result.path!});setFollowStatus(tr("跟随当前终端"));}
   else setFollowStatus(result.reason??tr("目录不可用"));
  }catch(e){if(!cancelled)setFollowStatus(e instanceof Error?e.message:tr("目录不可用"));}
   finally{if(!cancelled)timer=setTimeout(poll,800);}
  };
  void poll();return()=>{cancelled=true;clearTimeout(timer);};
 },[follow,active,s.active,view?.terminalId,disconnected]);
 function changeRatio(id:string,ratio:number){const tree=useStore.getState().terminalLayout;if(tree)s.setTerminalLayout(setRatio(tree,id,ratio));}
 const host=useRef<HTMLDivElement>(null),[visible,setVisible]=useState(true);
 const [width,setWidth]=useState(()=>{try{const saved=Number(localStorage.getItem('hornet.fileSidebar.width'));return saved>=240&&saved<=520?saved:300;}catch{return 300;}});
 const drag=useRef<{x:number;width:number}|null>(null);
 function resize(value:number){const next=Math.round(Math.max(240,Math.min(520,(host.current?.clientWidth??1000)-320,value)));setWidth(next);try{localStorage.setItem('hornet.fileSidebar.width',String(next));}catch{}}
 if(!view)return null;
 const layout=s.terminalLayout?layoutRects(s.terminalLayout):null;
 const geometry=layout?.panes.has(active)?layout:layoutRects({kind:'leaf',id:active});
 const filesVisible=visible&&hasRemoteFiles(view),firstPane=geometry.panes.keys().next().value;
 return <div className="terminal-workspace" ref={host}>
  <aside className="terminal-files" aria-label={tr("终端远程文件")} style={{width,display:filesVisible?'flex':'none'}}>
   {splitActive&&filesVisible&&renderTabs('')}
   <div className="terminal-files-heading"><strong>{tr("远程文件 · SFTP")}</strong><button aria-pressed={follow} title={tr("跟随当前选中的终端目录（Linux）")} onClick={()=>{setFollow(!follow);if(follow)setTarget(undefined);}}>{tr("跟随终端")}</button><button onClick={()=>setVisible(false)} aria-label={tr("隐藏远程文件")}>‹</button></div>
   {follow&&<div className="follow-status" role="status">{followStatus}</div>}
   <div className="workspace-file-views">{panes.filter(p=>hasRemoteFiles(p)).map(p=><div key={p.id+":"+p.connectionId} className="terminal-file-view" style={{display:p.id===active?'flex':'none'}}><FileView view={p} compact followTarget={follow&&p.id===active&&target?.terminalId===p.terminalId?target:undefined}/></div>)}</div>{hasRemoteFiles(view)&&<div className="task-dock-slot"/>}
  </aside>
  {visible&&hasRemoteFiles(view)&&<div className="file-splitter" role="separator" aria-label={tr("调整文件栏宽度")} aria-orientation="vertical" aria-valuemin={240} aria-valuemax={520} aria-valuenow={width} tabIndex={0}
   onPointerDown={e=>{drag.current={x:e.clientX,width};e.currentTarget.setPointerCapture(e.pointerId);e.preventDefault();}}
   onPointerMove={e=>{if(drag.current)resize(drag.current.width+e.clientX-drag.current.x);}}
   onPointerUp={e=>{drag.current=null;e.currentTarget.releasePointerCapture(e.pointerId);}}
   onPointerCancel={()=>{drag.current=null;}}
   onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();resize(width+(e.key==='ArrowLeft'?-20:20));}}}/>}
  <div className="terminal-pane">
   <div className="terminal-grid" ref={grid}>
    {panes.map(p=>{const rect=geometry.panes.get(p.id),title=p.title??p.profile.name,state=s.connectionStates[p.connectionId],recording=s.logs.find(l=>l.terminalId===p.terminalId&&['starting','recording','stopping'].includes(l.state));return <section key={p.id} aria-label={tr("终端 ")+title} data-terminal-id={p.terminalId} className={'terminal-cell'+(active===p.id?' selected':'')} style={{display:rect?'flex':'none',left:(rect?.x??0)+'%',top:(rect?.y??0)+'%',width:(rect?.width??100)+'%',height:(rect?.height??100)+'%'}} onPointerDown={()=>s.setActive(p.id)} onFocusCapture={()=>s.setActive(p.id)}>
     {splitActive&&rect&&renderTabs(p.id,!filesVisible&&p.id===firstPane)}
     <div className="terminal-tools"><button disabled={!hasRemoteFiles(p)} onClick={()=>setVisible(!visible)}>{visible?tr("隐藏文件栏"):tr("显示文件栏")}</button><span className="terminal-address" title={(p.profile.username?p.profile.username+'@':'')+p.profile.host}>{p.profile.username?p.profile.username+'@':''}{p.profile.host} · {state==='closed'||state==='failed'||!!s.closedTerminals[p.terminalId??'']?tr("已断开"):p.source==='local'?tr("本地终端"):p.source==='serial'?tr("串口 · UTF-8"):p.profile.protocol==='telnet'?tr("Telnet · 明文连接"):'SSH'}</span>{recording&&<button className="recording-indicator" title={recording.path} aria-label={tr("停止终端日志")} disabled={recording.state==='stopping'} onClick={()=>void window.hornet.terminalLogs.stop(recording.id).catch(s.fail)}>{tr("● 日志")}</button>}<button onClick={()=>setRequests(r=>({...r,[p.id]:(r[p.id]??0)+1}))}>{tr("搜索终端")}</button><button disabled={!hasRemoteFiles(p)} onClick={()=>void openView(p.profile,'files').catch(useStore.getState().fail)}>{tr("打开文件")}</button></div>
     <TerminalView key={p.id} view={p} searchRequested={requests[p.id]??0}/>
    </section>;})}
    {geometry.dividers.map(({node,rect})=>{const vertical=node.axis==='vertical';return <div key={node.id} className={'terminal-divider '+(vertical?'vertical':'horizontal')} role="separator" aria-label={tr("调整终端分屏")} aria-orientation={vertical?'vertical':'horizontal'} aria-valuemin={20} aria-valuemax={80} aria-valuenow={Math.round(node.ratio*100)} tabIndex={0}
     style={vertical?{left:(rect.x+rect.width*node.ratio)+'%',top:rect.y+'%',height:rect.height+'%'}:{top:(rect.y+rect.height*node.ratio)+'%',left:rect.x+'%',width:rect.width+'%'}}
     onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);e.preventDefault();}}
     onPointerMove={e=>{if(!e.currentTarget.hasPointerCapture(e.pointerId))return;const box=grid.current!.getBoundingClientRect();const offset=vertical?(e.clientX-box.left)/box.width*100:(e.clientY-box.top)/box.height*100;changeRatio(node.id,(offset-(vertical?rect.x:rect.y))/(vertical?rect.width:rect.height));}}
     onPointerUp={e=>e.currentTarget.releasePointerCapture(e.pointerId)}
     onKeyDown={e=>{if(['ArrowLeft','ArrowUp','ArrowRight','ArrowDown'].includes(e.key)){e.preventDefault();changeRatio(node.id,node.ratio+(['ArrowLeft','ArrowUp'].includes(e.key)?-0.05:0.05));}}}/>;})}
   </div>
   {broadcast.targets.length>1&&<div className="broadcast-banner" role="status"><strong>{tr("键盘广播已开启")}</strong><span>{broadcast.targets.map(t=>t.name).join(" · ")}</span><button onClick={broadcast.stop}>{tr("停止广播")}</button></div>}
   {commands.pane&&<QuickCommandSurface view={view} mode="pane"/>}
   {commands.bar&&<QuickCommandSurface view={view} mode="bar"/>}
  </div>
 </div>;
}
