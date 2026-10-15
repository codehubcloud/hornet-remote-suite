import { useLayoutEffect,useRef,type ReactNode } from 'react';
import { useAppearance } from './appearance';
import { useStore } from './store';

// Native caption buttons remain outside the draggable/menu content safe area.
export function TitleBar({children}:{children:ReactNode}){
 const root=useRef<HTMLElement>(null),appearance=useAppearance(s=>s.value);
 useLayoutEffect(()=>{
  const update=()=>{
   const node=root.current;if(!node)return;
   const rgb=(value:string)=>'#'+(value.match(/\d+/g)??[]).slice(0,3).map(n=>Number(n).toString(16).padStart(2,'0')).join('');
   const color=rgb(getComputedStyle(node).backgroundColor),symbolColor=rgb(getComputedStyle(node.querySelector('button')??node).color);
   void window.hornet.windowChrome.setColors({color,symbolColor}).catch(error=>useStore.getState().fail(error));
  };
  update();const observer=new MutationObserver(update);
  observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  return()=>observer.disconnect();
 },[appearance]);
 return <header ref={root} className="app-titlebar" data-platform={window.hornet.windowChrome.platform}>
  <div className="titlebar-content"><img className="titlebar-logo" src="./logo.png" alt="" aria-hidden="true" draggable={false}/>{children}<div className="titlebar-drag-space"/></div>
 </header>;
}
