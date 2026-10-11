import { t as tr } from './i18n';
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from './store';
import { TaskList } from './TaskList';

type Dock = 'left' | 'bottom' | 'floating';
type Layout = {dock:Dock;x:number;y:number;width:number;height:number;collapsed:boolean};
const key='hornet.tasks.layout';
const defaults:Layout={dock:'left',x:360,y:160,width:420,height:180,collapsed:false};
function fit(layout:Layout):Layout {
 const width=Math.max(260,Math.min(layout.width,window.innerWidth));
 const height=Math.max(80,Math.min(layout.height,window.innerHeight-64));
 return {...layout,width,height,x:Math.max(0,Math.min(layout.x,window.innerWidth-width)),y:Math.max(0,Math.min(layout.y,window.innerHeight-(layout.collapsed?30:height)-25))};
}
function restore():Layout {
 try{const value=JSON.parse(localStorage.getItem(key)??'null');
  if(value&&['left','bottom','floating'].includes(value.dock)&&['x','y','width','height'].every(k=>typeof value[k]==='number'&&Number.isFinite(value[k]))&&typeof value.collapsed==='boolean')return fit(value);
 }catch{}
 return fit(defaults);
}
export function TaskCenter({activeId,quiet=false}:{activeId:string;quiet?:boolean}) {
 const [layout,setLayout]=useState(restore),[slot,setSlot]=useState<HTMLElement|null>(null),[target,setTarget]=useState<Dock|null>(null);
 const current=useRef(layout);current.current=layout;
 const panel=useRef<HTMLElement>(null);
 const gesture=useRef<{kind:'move'|'resize';x:number;y:number;layout:Layout;original:Layout;floating:boolean}|null>(null);
 const tasks=useStore(s=>s.tasks),active=tasks.filter(t=>['queued','running','verifying','committing','pausing'].includes(t.state)).length;
 useLayoutEffect(()=>{
  const view=Array.from(document.querySelectorAll<HTMLElement>('.view')).find(el=>el.dataset.viewId===activeId);
  setSlot(view?.querySelector<HTMLElement>('.task-dock-slot')??null);
 },[activeId]);
 useEffect(()=>{try{localStorage.setItem(key,JSON.stringify(layout));}catch{}},[layout]);
 useEffect(()=>{
  function dropAt(x:number,y:number):Dock|null {
   const files=Array.from(document.querySelectorAll<HTMLElement>('.terminal-files')).find(el=>el.getBoundingClientRect().width>0);
   const left=files?.getBoundingClientRect();
   if(left&&x>=left.left&&x<=left.right&&y>=left.top+left.height/2&&y<=left.bottom)return 'left';
   const work=document.querySelector('.workspace')?.getBoundingClientRect();
   if(work&&x>=work.left&&x<=work.right&&y>=work.bottom-70&&y<=work.bottom)return 'bottom';
   return null;
  }
  function move(e:globalThis.PointerEvent){const g=gesture.current;if(!g)return;
   const dx=e.clientX-g.x,dy=e.clientY-g.y;
   if(g.kind==='move'){
    setLayout(fit({...g.layout,dock:'floating',x:g.layout.x+dx,y:g.layout.y+dy}));setTarget(dropAt(e.clientX,e.clientY));
   }else setLayout(fit({...g.layout,width:g.floating?g.layout.width+dx:g.layout.width,height:g.layout.height+(g.floating?dy:-dy)}));
  }
  function finish(e:globalThis.PointerEvent){const g=gesture.current;if(!g)return;gesture.current=null;setTarget(null);
   if(g.kind==='move'){const dock=dropAt(e.clientX,e.clientY);if(dock)setLayout(s=>({...s,dock}));}
  }
  function cancel(){if(gesture.current)setLayout(gesture.current.original);gesture.current=null;setTarget(null);}
  function escape(e:KeyboardEvent){if(e.key==='Escape')cancel();}
  function resize(){setLayout(fit);}
  window.addEventListener('pointermove',move);window.addEventListener('pointerup',finish);window.addEventListener('pointercancel',cancel);window.addEventListener('blur',cancel);window.addEventListener('keydown',escape);window.addEventListener('resize',resize);
  return()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',finish);window.removeEventListener('pointercancel',cancel);window.removeEventListener('blur',cancel);window.removeEventListener('keydown',escape);window.removeEventListener('resize',resize);};
 },[]);
 function begin(e:PointerEvent,kind:'move'|'resize'){
  if(e.button!==0)return;
  const rect=panel.current!.getBoundingClientRect(),original=current.current;
  const initial=kind==='move'?fit({...original,x:rect.x,y:rect.y,width:Math.max(300,rect.width)}):{...original,height:rect.height,width:original.dock==='floating'?rect.width:original.width};
  gesture.current={kind,x:e.clientX,y:e.clientY,layout:initial,original,floating:original.dock==='floating'};
  e.preventDefault();
 }
 if(quiet&&!tasks.length)return null;
 const floating=layout.dock==='floating';
 const content=<section ref={panel} aria-label={tr("任务中心")} data-dock={layout.dock} className={'tasks dockable-tasks'+(floating?' floating-tasks':'')+(layout.collapsed?' tasks-collapsed':'')}
  style={{height:layout.collapsed?30:layout.height,...(floating?{left:layout.x,top:layout.y,width:layout.width}: {})}}>
  {!floating&&!layout.collapsed&&<div className="task-height-grip" role="separator" aria-label={tr("调整任务中心高度")} aria-orientation="horizontal" aria-valuenow={layout.height} tabIndex={0} onPointerDown={e=>begin(e,'resize')} onKeyDown={e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();setLayout(s=>fit({...s,height:s.height+(e.key==='ArrowUp'?20:-20)}));}}}/>}
  <div className="task-heading">
   <button className="task-drag" title={tr("拖动任务中心；拖到文件栏下半部或工作区底部可停靠")} aria-label={tr("拖动任务中心")} onPointerDown={e=>begin(e,'move')}>⠿ <strong>{tr("任务中心")}</strong> <span>{active}</span></button>
   <button aria-label={tr("刷新任务")} title={tr("刷新任务")} onClick={()=>void window.hornet.task.list().then(useStore.getState().setTasks).catch(useStore.getState().fail)}>↻</button>
   <select aria-label={tr("任务中心位置")} value={layout.dock} onChange={e=>setLayout(s=>fit({...s,dock:e.target.value as Dock}))}><option value="left">{tr("左侧")}</option><option value="bottom">{tr("底部")}</option><option value="floating">{tr("浮动")}</option></select>
   <button aria-label={layout.collapsed?tr("展开任务中心"):tr("折叠任务中心")} aria-expanded={!layout.collapsed} onClick={()=>setLayout(s=>fit({...s,collapsed:!s.collapsed}))}>{layout.collapsed?'＋':'−'}</button>
  </div>
  {!layout.collapsed&&<TaskList/>}
  {target&&<div className="task-drop-hint">{tr("松开停靠到")}{target==='left'?tr("文件列表下方"):tr("工作区底部")}{tr("· Esc 取消")}</div>}
  {floating&&!layout.collapsed&&<div className="task-size-grip" role="separator" aria-label={tr("调整浮动任务中心大小")} tabIndex={0} onPointerDown={e=>begin(e,'resize')} onKeyDown={e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();setLayout(s=>fit({...s,width:s.width+(e.key==='ArrowRight'?20:e.key==='ArrowLeft'?-20:0),height:s.height+(e.key==='ArrowDown'?20:e.key==='ArrowUp'?-20:0)}));}}}/>}
 </section>;
 return floating?createPortal(content,document.body):layout.dock==='left'&&slot?createPortal(content,slot):content;
}
