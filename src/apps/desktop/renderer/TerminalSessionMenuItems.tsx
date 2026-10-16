import { disconnectView } from './store';
import { t as tr } from './i18n';
import { closeTerminalView,isTerminalClosed,reconnectView,useStore,type View } from './store';

/** Both menus act on the clicked pane, even when another pane had focus. */
export function TerminalSessionMenuItems({view,choose}:{view:View;choose:(action:()=>void)=>void}){
 const s=useStore(),closed=isTerminalClosed(view,s),busy=!!s.reconnecting[view.id];
 const run=(operation:()=>Promise<unknown>)=>choose(()=>void operation().catch(useStore.getState().fail));
 return <>
  <button role="menuitem" disabled={closed||busy||!view.terminalId} onClick={()=>run(()=>disconnectView(view.id))}>{tr('断开')}</button>
  <button role="menuitem" disabled={!!view.source||busy} onClick={()=>run(()=>reconnectView(view.id))}>{tr('重新连接')}</button>
  <button role="menuitem" onClick={()=>choose(()=>window.dispatchEvent(new CustomEvent('hornet:terminal-rename',{detail:{viewId:view.id}})))}>{tr('重命名终端')}</button>
  <button role="menuitem" disabled={!!view.locked} onClick={()=>run(()=>closeTerminalView(view.id))}>{tr('关闭当前标签')}</button>
 </>;
}
