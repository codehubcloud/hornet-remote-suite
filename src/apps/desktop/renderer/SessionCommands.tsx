import { useEffect,useRef,useState } from 'react';
import { useStore,refreshProfiles,openView,type View } from './store';
import type { Profile } from '../../../packages/contracts';
import { parseQuickAddress } from './quick-connect';

export function SessionCommands({create,connect,close,hosts,toggleChrome,collapsed,pending}:{create:(fields?:Partial<Profile>)=>void;connect:(p:Profile)=>void;close:(v:View)=>void;hosts:()=>void;toggleChrome:()=>void;collapsed:boolean;pending:boolean}){
 const s=useStore(),active=s.views.find(v=>v.id===s.active),terminal=active?.kind==='terminal';
 const [address,setAddress]=useState(''),[menu,setMenu]=useState<string|null>(null),[help,setHelp]=useState(false);
 const root=useRef<HTMLDivElement>(null),input=useRef<HTMLInputElement>(null);
 const run=(action:()=>void)=>{setMenu(null);action();};
 useEffect(()=>{if(menu)root.current?.querySelector<HTMLButtonElement>('[role=menu] button:not(:disabled)')?.focus();},[menu]);
 const search=()=>window.dispatchEvent(new Event('hornet:terminal-search'));
 const rename=()=>window.dispatchEvent(new Event('hornet:terminal-rename'));
 function quick(){try{
  const matches=s.profiles.filter(p=>p.name===address.trim());
  if(matches.length>1)throw new Error('存在同名连接，请从主机列表选择。');
  if(matches.length===1){connect(matches[0]);return;}
  const fields=parseQuickAddress(address);create({...fields,name:fields.host});
 }catch(e){s.fail(e);}}
 function cycle(direction:number){const ids=['home',...s.views.map(v=>v.id)],index=ids.indexOf(s.active);s.setActive(ids[(index+direction+ids.length)%ids.length]);}
 useEffect(()=>{
  const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setMenu(null);};
  const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){setMenu(null);setHelp(false);}if(event.ctrlKey&&event.shiftKey&&event.code==='KeyL'){event.preventDefault();input.current?.focus();}};
  window.addEventListener('pointerdown',outside);window.addEventListener('keydown',key);
  return()=>{window.removeEventListener('pointerdown',outside);window.removeEventListener('keydown',key);};
 },[]);
 const groups:{label:string;items:{label:string;disabled?:boolean;action:()=>void}[]}[]=[
  {label:'文件',items:[{label:'新建会话',action:()=>create()},{label:'打开会话列表',action:hosts},{label:'导入会话配置',action:()=>void window.hornet.profiles.import().then(refreshProfiles).catch(s.fail)},{label:'导出会话配置',action:()=>void window.hornet.profiles.export().catch(s.fail)},{label:'关闭当前标签',disabled:!active,action:()=>{if(active)close(active);}}]},
  {label:'编辑',items:[{label:'查找终端内容',disabled:!terminal,action:search},{label:'重命名终端',disabled:!terminal,action:rename}]},
  {label:'查看',items:[{label:'主机列表',action:hosts},{label:'工作台',action:()=>s.setActive('home')},{label:collapsed?'展开工具栏':'折叠工具栏',action:toggleChrome}]},
  {label:'工具',items:[{label:'打开当前连接文件',disabled:!terminal||pending,action:()=>{if(active)void openView(active.profile,'files').catch(s.fail);}},{label:'端口转发',action:()=>{s.setActive('home');setTimeout(()=>document.querySelector('.tunnel-panel')?.scrollIntoView({block:'start'}),0);}},{label:'X11 / 远程桌面 / 打印',action:()=>{s.setActive('home');setTimeout(()=>document.querySelector('.native-section')?.scrollIntoView({block:'start'}),0);}},{label:'锁定凭据库',action:()=>void window.hornet.auth.lock().catch(s.fail)}]},
  {label:'选项卡',items:[{label:'上一个标签',disabled:!s.views.length,action:()=>cycle(-1)},{label:'下一个标签',disabled:!s.views.length,action:()=>cycle(1)},{label:'重命名终端',disabled:!terminal,action:rename}]},
  {label:'窗口',items:[{label:'水平分割',disabled:s.views.filter(v=>v.kind==='terminal').length<2,action:()=>{s.tileTerminals('horizontal');s.setActive(s.views.find(v=>v.kind==='terminal')!.id);}},{label:'垂直分割',disabled:s.views.filter(v=>v.kind==='terminal').length<2,action:()=>{s.tileTerminals('vertical');s.setActive(s.views.find(v=>v.kind==='terminal')!.id);}},{label:'取消分屏',disabled:!s.terminalLayout,action:()=>s.setTerminalLayout(null)}]},
  {label:'帮助',items:[{label:'快速连接使用说明',action:()=>setHelp(true)}]}
 ];
 return <div className="session-commands" ref={root}>
  <nav className="session-menubar" aria-label="应用菜单">{groups.map(group=><div className="session-menu" key={group.label}><button aria-haspopup="menu" aria-expanded={menu===group.label} onClick={()=>setMenu(menu===group.label?null:group.label)}>{group.label}</button>{menu===group.label&&<div role="menu" aria-label={group.label} className="session-menu-popup" onKeyDown={e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const items=Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')),index=items.indexOf(document.activeElement as HTMLButtonElement);items[(index+(e.key==='ArrowDown'?1:items.length-1))%items.length]?.focus();}}}>{group.items.map(item=><button role="menuitem" key={item.label} disabled={item.disabled} onClick={()=>run(item.action)}>{item.label}</button>)}</div>}</div>)}</nav>
  <form className="quick-connect-bar" onSubmit={e=>{e.preventDefault();quick();}}>
   <button type="button" title="新建会话" aria-label="新建会话" onClick={()=>create()}>＋</button>
   <button type="button" title="打开会话列表" aria-label="打开会话列表" onClick={hosts}>▤</button>
   <input ref={input} aria-label="快速连接地址" list="saved-session-names" placeholder="会话名称或 user@host:port · Ctrl+Shift+L" value={address} onChange={e=>setAddress(e.target.value)}/>
   <datalist id="saved-session-names">{s.profiles.map(p=><option key={p.profileId} value={p.name}>{p.username}@{p.host}:{p.port}</option>)}</datalist>
   <button disabled={pending||!address.trim()}>连接</button>
  </form>
  {help&&<div className="modal-backdrop"><div className="modal" role="dialog" aria-label="快速连接使用说明"><h2>快速连接</h2><p>输入已保存的会话名称可直接连接。输入主机、user@host:port 或 ssh://user@host:port 会打开预填的连接配置，补充认证设置后保存并连接。IPv6 使用 [地址]:端口。</p><p>Ctrl+Shift+L：聚焦快速连接。Ctrl+Shift+F：搜索终端。右键终端标题：重命名或排列已有终端。</p><button onClick={()=>setHelp(false)}>关闭说明</button></div></div>}
 </div>;
}
