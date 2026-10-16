import { useEffect,useLayoutEffect,useRef,useState } from 'react';
import { t as tr } from './i18n';
import { createPortal } from 'react-dom';
import { menuPosition } from './menu-position';
export type MenuItem={label:string;literal?:boolean;action?:()=>void;disabled?:boolean;unsupported?:boolean;shortcut?:string;children?:MenuItem[];separator?:boolean;checked?:boolean};
export type MenuGroup={label:string;access:string;items:MenuItem[]};
export function MenuBar({groups,reveal}:{groups:MenuGroup[];reveal?:()=>void}){
 const [open,setOpen]=useState<string|null>(null),root=useRef<HTMLElement>(null);
 const current=groups.find(g=>g.label===open);
 useEffect(()=>{const dismiss=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(null);};const keys=(e:KeyboardEvent)=>{
  if(document.querySelector('.modal-backdrop'))return;
  if(e.altKey&&!e.ctrlKey&&!e.shiftKey){const g=groups.find(g=>g.access.toLowerCase()===e.key.toLowerCase());if(g){e.preventDefault();e.stopImmediatePropagation();reveal?.();setOpen(old=>old===g.label?null:g.label);}}
  if(e.key==='Escape'&&open&&!(e.target instanceof HTMLElement&&e.target.closest('.nested-menu'))){e.preventDefault();setOpen(null);root.current?.querySelector<HTMLButtonElement>('[data-menu="'+open+'"]')?.focus();}
 };window.addEventListener('pointerdown',dismiss);window.addEventListener('keydown',keys,true);return()=>{window.removeEventListener('pointerdown',dismiss);window.removeEventListener('keydown',keys,true);};},[groups,open,reveal]);
 useEffect(()=>{if(open&&!current)setOpen(null);},[open,current]);
 return <nav ref={root} className="session-menubar reference-menubar" aria-label={tr('应用菜单')}>{groups.map((g,i)=><div className="session-menu" key={g.label}><button aria-label={tr(g.label)} data-menu={g.label} aria-haspopup="menu" aria-expanded={open===g.label} onClick={()=>setOpen(open===g.label?null:g.label)} onPointerEnter={()=>{if(open)setOpen(g.label);}} onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();setOpen(g.label);}if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();const next=groups[(i+(e.key==='ArrowRight'?1:groups.length-1))%groups.length];root.current?.querySelector<HTMLButtonElement>('[data-menu="'+next.label+'"]')?.focus();if(open)setOpen(next.label);}}}>{tr(g.label)}<span aria-hidden="true">({g.access})</span></button>{open===g.label&&<Popup items={g.items} label={g.label} dismiss={()=>setOpen(null)} move={direction=>setOpen(groups[(i+direction+groups.length)%groups.length].label)}/>}</div>)}</nav>;
}
export function ContextMenu({items,label,x,y,dismiss}:{items:MenuItem[];label:string;x:number;y:number;dismiss:()=>void}){
 const root=useRef<HTMLDivElement>(null);
 useEffect(()=>{const outside=(event:Event)=>{if(!root.current?.contains(event.target as Node))dismiss();},key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();dismiss();}};
  window.addEventListener('pointerdown',outside,true);window.addEventListener('scroll',outside,true);window.addEventListener('keydown',key);window.addEventListener('resize',dismiss);window.addEventListener('blur',dismiss);
  return()=>{window.removeEventListener('pointerdown',outside,true);window.removeEventListener('scroll',outside,true);window.removeEventListener('keydown',key);window.removeEventListener('resize',dismiss);window.removeEventListener('blur',dismiss);};
 },[dismiss]);
 return createPortal(<div ref={root} className="terminal-tab-menu" onContextMenu={event=>event.preventDefault()}><Popup items={items} label={label} dismiss={dismiss} point={{x,y}}/></div>,document.body);
}
function Popup({items,label,dismiss,back,move,point}:{items:MenuItem[];label:string;dismiss:()=>void;back?:()=>void;move?:(direction:number)=>void;point?:{x:number;y:number}}){
 const [child,setChild]=useState<number|null>(null),ref=useRef<HTMLDivElement>(null),[position,setPosition]=useState<{left:number;top:number}>();
 useLayoutEffect(()=>{const node=ref.current;if(!node)return;setPosition(menuPosition(node.parentElement!.getBoundingClientRect(),{width:node.offsetWidth,height:node.offsetHeight},{width:window.innerWidth,height:window.innerHeight},!!back,point));},[label,point?.x,point?.y]);
 useEffect(()=>{ref.current?.querySelector<HTMLButtonElement>(':scope > .menu-entry > button:not(:disabled)')?.focus();},[]);
 return <div ref={ref} style={position} role="menu" aria-label={tr(label)} className={'session-menu-popup reference-popup'+(back?' nested-menu':'')} onKeyDown={e=>{
  if((e.target as HTMLElement).closest('[role=menu]')!==e.currentTarget)return;
  const buttons=Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>(':scope > .menu-entry > button:not(:disabled)')),index=buttons.indexOf(document.activeElement as HTMLButtonElement);
  if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();e.stopPropagation();buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(e.key==='ArrowDown'?1:buttons.length-1))%buttons.length]?.focus();}
  if(e.key==='ArrowLeft'){e.preventDefault();e.stopPropagation();if(back)back();else move?.(-1);}
  if(e.key==='ArrowRight'&&!document.activeElement?.hasAttribute('aria-haspopup')){e.preventDefault();e.stopPropagation();if(!back)move?.(1);}
  if(e.key==='Escape'&&back){e.preventDefault();e.stopPropagation();back();}if(e.key==='Tab')dismiss();
 }}>{items.map((item,i)=><div className="menu-entry" key={item.label+i}>{item.separator&&<div role="separator" className="menu-separator"/>}<button role="menuitem" aria-label={item.literal?item.label:tr(item.label)} disabled={item.disabled} title={item.disabled?tr(item.unsupported?'尚未实现':'当前状态不可用'):undefined} aria-haspopup={item.children?'menu':undefined} aria-expanded={item.children?child===i:undefined} onPointerEnter={()=>setChild(item.children?i:null)} onKeyDown={e=>{if(e.key==='ArrowRight'&&item.children){e.preventDefault();e.stopPropagation();setChild(i);}}} onClick={()=>{if(item.children)setChild(i);else{dismiss();item.action?.();}}}><span className="menu-check" aria-hidden="true">{item.checked?'✓':''}</span><span>{item.literal?item.label:tr(item.label)}</span><kbd>{item.children?'›':item.shortcut??''}</kbd></button>{child===i&&item.children&&<Popup items={item.children} label={item.label} dismiss={dismiss} back={()=>{setChild(null);ref.current?.querySelectorAll<HTMLButtonElement>(':scope > .menu-entry > button')[i]?.focus();}}/>}</div>)}</div>;
}
