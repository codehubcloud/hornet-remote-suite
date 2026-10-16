import { t as tr } from './i18n';
import { useCallback,useEffect,useState,type MouseEvent } from 'react';
import { useStore } from './store';
import { ContextMenu } from './MenuBar';
import { terminalTabItems } from './terminal-tab-menu';

export function showTerminalMenu(event:MouseEvent,viewId:string){
 event.preventDefault();event.stopPropagation();
 useStore.getState().setActive(viewId);
 useStore.getState().setTerminalMenu({viewId,x:Math.max(0,Math.min(event.clientX,window.innerWidth-208)),y:Math.max(0,Math.min(event.clientY,window.innerHeight-190))});
}
export function TerminalTitleMenu(){
 const s=useStore(),menu=s.terminalMenu,view=s.views.find(v=>v.id===menu?.viewId);
 const dismiss=useCallback(()=>useStore.getState().setTerminalMenu(null),[]);
 const [rename,setRename]=useState<{id:string;title:string}|null>(null),[error,setError]=useState('');
 useEffect(()=>{const open=(event:Event)=>{const state=useStore.getState(),id=(event as CustomEvent<{viewId?:string}>).detail?.viewId??state.active,v=state.views.find(v=>v.id===id&&v.kind==='terminal');if(v){setError('');setRename({id:v.id,title:v.title??v.profile.name});}};window.addEventListener('hornet:terminal-rename',open);return()=>window.removeEventListener('hornet:terminal-rename',open);},[]);
 return <>
  {menu&&view&&<ContextMenu items={terminalTabItems(view)} label="终端标题菜单" x={menu.x} y={menu.y} dismiss={dismiss}/>}
  {rename&&<div className="modal-backdrop"><form className="modal" onSubmit={e=>{e.preventDefault();const title=rename.title.trim();if(!title||title.length>80||/[\x00-\x1f\x7f]/.test(title)){setError(tr("请输入 1–80 个字符的标题，不包含控制字符。"));return;}s.renameTerminal(rename.id,title);setRename(null);}}>
   <h2>{tr("重命名终端")}</h2><label>{tr("终端标题")}<input autoFocus maxLength={80} required value={rename.title} onChange={e=>setRename({...rename,title:e.target.value})}/></label>{error&&<p role="alert" className="form-error">{error}</p>}<div className="modal-actions"><button type="button" onClick={()=>setRename(null)}>{tr("取消")}</button><button className="primary">{tr("保存标题")}</button></div>
  </form></div>}
 </>;
}
