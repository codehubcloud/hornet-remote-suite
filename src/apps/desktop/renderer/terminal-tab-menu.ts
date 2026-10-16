import { disconnectView } from './store';
import { t as tr } from './i18n';
import type { MenuItem } from './MenuBar';
import { closeTerminalTabs,duplicateTerminal,isTerminalClosed,newTerminalGroup,reconnectView,useStore,type View } from './store';
import { tabGroup } from './terminal-tabs';

export const tabColors=[['默认',''],['红色','#d85858'],['橙色','#d68938'],['黄色','#c3a838'],['绿色','#36a76b'],['蓝色','#3999db'],['紫色','#a06ad4']] as const;
export function terminalTabItems(view:View):MenuItem[]{
 const s=useStore.getState(),terminals=s.views.filter(v=>v.kind==='terminal'),peers=terminals.filter(v=>tabGroup(v)===tabGroup(view)),groups=[...new Set(terminals.map(tabGroup))];
 const run=(operation:()=>Promise<unknown>)=>()=>void operation().catch(useStore.getState().fail);
 const batch=(views:View[])=>run(()=>closeTerminalTabs(views.filter(v=>!v.locked).map(v=>v.id)));
 const closeItem=(label:string,views:View[],extra:Partial<MenuItem>={},blanks:string[]=[]):MenuItem=>({label:tr(label),disabled:!views.some(v=>!v.locked)&&!blanks.length,action:run(async()=>{await closeTerminalTabs(views.filter(v=>!v.locked).map(v=>v.id));for(const id of blanks)useStore.getState().closeBlankTab(id);}),...extra});
 const splits:MenuItem[]=[{label:tr('水平分割'),disabled:terminals.length<2,action:()=>s.tileTerminals('horizontal')},{label:tr('垂直分割'),disabled:terminals.length<2,action:()=>s.tileTerminals('vertical')},{label:tr('取消分屏'),disabled:!s.terminalLayout,action:()=>s.setTerminalLayout(null)}];
 return [
  {label:tr('新选项卡'),shortcut:'Shift+Alt+N',action:s.newTab},
  {label:tr('新选项卡组'),children:[{label:tr('水平分割'),disabled:peers.length<2&&window.hornet.windowChrome.platform!=='win32',action:run(()=>newTerminalGroup(view.id,'horizontal'))},{label:tr('垂直分割'),disabled:peers.length<2&&window.hornet.windowChrome.platform!=='win32',action:run(()=>newTerminalGroup(view.id,'vertical'))},...groups.filter(id=>id!==tabGroup(view)).map(id=>({label:tr('移动到选项卡组 {number}',{number:groups.indexOf(id)+1}),action:()=>s.moveTab(view.id,id)}))]},
  {label:tr('排列'),children:splits},
  {label:tr('将标签移动到窗口'),separator:true,disabled:true,unsupported:true},
  ...splits.slice(0,2).reverse(),
  ...(s.terminalLayout?[splits[2]]:[]),
  {label:tr('复制会话'),separator:true,disabled:!!view.source&&view.source!=='local'||!!s.reconnecting[view.id],action:run(()=>duplicateTerminal(view.id))},
  {label:tr('复制SSH渠道'),disabled:!!view.source||(view.profile.protocol??'ssh')!=='ssh'||isTerminalClosed(view,s)||!!s.reconnecting[view.id],action:run(()=>duplicateTerminal(view.id,true))},
  {label:tr('关闭'),shortcut:'Ctrl+Shift+F4',separator:true,disabled:!!view.locked,action:batch([view])},
  {label:tr('锁'),checked:!!view.locked,separator:true,action:()=>s.updateTerminal(view.id,{locked:!view.locked})},
  closeItem('关闭此选项卡组',peers,{disabled:groups.length<2||!peers.some(v=>!v.locked)},s.blankTabs.filter(id=>s.blankGroups[id]===tabGroup(view))),
  closeItem('关闭右侧标签页',peers.slice(peers.findIndex(v=>v.id===view.id)+1),{},s.blankTabs.filter(id=>s.blankGroups[id]===tabGroup(view))),
  closeItem('关闭所有本地标签',terminals.filter(v=>v.source==='local')),
  closeItem('关闭其他选项卡',terminals.filter(v=>v.id!==view.id),{},s.blankTabs),
  closeItem('关闭所有选项卡',terminals,{},s.blankTabs),
  {label:tr('重命名终端'),separator:true,action:()=>window.dispatchEvent(new CustomEvent('hornet:terminal-rename',{detail:{viewId:view.id}}))},
  ...(['numbers','title','status'] as const).map((key,index)=>({label:tr(['显示编号','显示终端标题','显示状态图标'][index]),checked:s.tabDisplay[key],separator:index===0,action:()=>s.setTabDisplay(key,!s.tabDisplay[key])})),
  {label:tr('设置颜色'),separator:true,children:tabColors.map(([label,color])=>({label:tr(label),checked:(view.tabColor??'')===color,action:()=>s.updateTerminal(view.id,{tabColor:color||undefined})}))},
  {label:tr('断开'),separator:true,disabled:isTerminalClosed(view,s)||!!s.reconnecting[view.id],action:run(()=>disconnectView(view.id))},
  {label:tr('重新连接'),disabled:!!view.source||!!s.reconnecting[view.id],action:run(()=>reconnectView(view.id))}
 ];
}
