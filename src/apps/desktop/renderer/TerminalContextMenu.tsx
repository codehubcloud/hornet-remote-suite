import { useEffect,useLayoutEffect,useRef } from 'react';
import { createPortal } from 'react-dom';
import { t as tr } from './i18n';

export type TerminalContextAction='copy'|'paste'|'selectAll'|'clear'|'search';
export function TerminalContextMenu({x,y,canCopy,canPaste,choose,close}:{x:number;y:number;canCopy:boolean;canPaste:boolean;choose:(action:TerminalContextAction)=>void;close:(focus:boolean)=>void}){
 const element=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{const node=element.current;if(!node)return;node.style.left=Math.max(2,Math.min(x,window.innerWidth-node.offsetWidth-2))+'px';node.style.top=Math.max(2,Math.min(y,window.innerHeight-node.offsetHeight-2))+'px';},[x,y]);
 useEffect(()=>{
  element.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  const dismiss=()=>close(false),outside=(event:Event)=>{if(!element.current?.contains(event.target as Node))dismiss();};
  window.addEventListener('pointerdown',outside,true);window.addEventListener('scroll',outside,true);window.addEventListener('blur',dismiss);window.addEventListener('resize',dismiss);
  return()=>{window.removeEventListener('pointerdown',outside,true);window.removeEventListener('scroll',outside,true);window.removeEventListener('blur',dismiss);window.removeEventListener('resize',dismiss);};
 },[close]);
 return createPortal(<div ref={element} role="menu" aria-label={tr('终端内容菜单')} className="group-context-menu terminal-context-menu" style={{left:x,top:y}} onContextMenu={event=>event.preventDefault()} onKeyDown={event=>{
  const buttons=Array.from(element.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')??[]),index=buttons.indexOf(document.activeElement as HTMLButtonElement);
  if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();event.stopPropagation();buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:buttons.length-1))%buttons.length]?.focus();}
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);}else if(event.key==='Tab')close(false);
 }}>
  <button role="menuitem" aria-label={tr('复制')} disabled={!canCopy} onClick={()=>choose('copy')}>{tr('复制')}<kbd>Ctrl+Shift+C</kbd></button>
  <button role="menuitem" aria-label={tr('粘贴')} disabled={!canPaste} onClick={()=>choose('paste')}>{tr('粘贴')}<kbd>Ctrl+Shift+V</kbd></button>
  <div role="separator" className="menu-separator"/>
  <button role="menuitem" onClick={()=>choose('selectAll')}>{tr('全选')}</button>
  <button role="menuitem" aria-label={tr('清屏')} onClick={()=>choose('clear')}>{tr('清屏')}<kbd>Ctrl+Shift+L</kbd></button>
  <button role="menuitem" aria-label={tr('搜索终端')} onClick={()=>choose('search')}>{tr('搜索终端')}<kbd>Ctrl+Shift+F</kbd></button>
 </div>,document.body);
}
