import { useEffect,useRef,useState,type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from './store';

export function showTerminalMenu(event:MouseEvent,viewId:string){
 event.preventDefault();event.stopPropagation();
 useStore.getState().setActive(viewId);
 useStore.getState().setTerminalMenu({viewId,x:Math.max(0,Math.min(event.clientX,window.innerWidth-208)),y:Math.max(0,Math.min(event.clientY,window.innerHeight-190))});
}
export function TerminalTitleMenu(){
 const s=useStore(),menu=s.terminalMenu,view=s.views.find(v=>v.id===menu?.viewId);
 const element=useRef<HTMLDivElement>(null);
 const [rename,setRename]=useState<{id:string;title:string}|null>(null),[error,setError]=useState('');
 useEffect(()=>{
  if(!menu)return;
  element.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  const close=()=>useStore.getState().setTerminalMenu(null);
  const outside=(e:Event)=>{if(!element.current?.contains(e.target as Node))close();};
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape')close();};
  window.addEventListener('pointerdown',outside,true);window.addEventListener('scroll',outside,true);window.addEventListener('keydown',key);window.addEventListener('blur',close);window.addEventListener('resize',close);
  return()=>{window.removeEventListener('pointerdown',outside,true);window.removeEventListener('scroll',outside,true);window.removeEventListener('keydown',key);window.removeEventListener('blur',close);window.removeEventListener('resize',close);};
 },[menu]);
 useEffect(()=>{const open=()=>{const state=useStore.getState(),v=state.views.find(v=>v.id===state.active&&v.kind==='terminal');if(v){setError('');setRename({id:v.id,title:v.title??v.profile.name});}};window.addEventListener('hornet:terminal-rename',open);return()=>window.removeEventListener('hornet:terminal-rename',open);},[]);
 const canSplit=s.views.filter(v=>v.kind==='terminal').length>=2;
 const choose=(action:()=>void)=>{s.setTerminalMenu(null);action();};
 return <>
  {menu&&view&&createPortal(<div ref={element} role="menu" aria-label="终端标题菜单" className="group-context-menu" style={{left:menu.x,top:menu.y}} onContextMenu={e=>e.preventDefault()} onKeyDown={e=>{const buttons=Array.from(element.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')??[]);if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const index=buttons.indexOf(document.activeElement as HTMLButtonElement);buttons[(index+(e.key==='ArrowDown'?1:buttons.length-1))%buttons.length]?.focus();}else if(e.key==='Tab')s.setTerminalMenu(null);}}>
   <div className="group-context-title">{view.title??view.profile.name}</div>
   <button role="menuitem" disabled={!canSplit} onClick={()=>choose(()=>s.tileTerminals('horizontal'))}>水平分割</button>
   <button role="menuitem" disabled={!canSplit} onClick={()=>choose(()=>s.tileTerminals('vertical'))}>垂直分割</button>
   {s.terminalLayout?.kind==='split'&&<button role="menuitem" onClick={()=>choose(()=>s.setTerminalLayout(null))}>取消分屏</button>}
   <button role="menuitem" onClick={()=>choose(()=>{setError('');setRename({id:view.id,title:view.title??view.profile.name});})}>重命名终端</button>
  </div>,document.body)}
  {rename&&<div className="modal-backdrop"><form className="modal" onSubmit={e=>{e.preventDefault();const title=rename.title.trim();if(!title||title.length>80||/[\x00-\x1f\x7f]/.test(title)){setError('请输入 1–80 个字符的标题，不包含控制字符。');return;}s.renameTerminal(rename.id,title);setRename(null);}}>
   <h2>重命名终端</h2><label>终端标题<input autoFocus maxLength={80} required value={rename.title} onChange={e=>setRename({...rename,title:e.target.value})}/></label>{error&&<p role="alert" className="form-error">{error}</p>}<div className="modal-actions"><button type="button" onClick={()=>setRename(null)}>取消</button><button className="primary">保存标题</button></div>
  </form></div>}
 </>;
}
