import { t as tr } from './i18n';
import { useEffect,useRef,useState,type MouseEvent,type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Profile } from '../../../packages/contracts';

export function groupPath(value:string){return value.split('/').map(s=>s.trim()).filter(Boolean).join('/')||'默认分组';}
export function readGroups():string[]{try{const value=JSON.parse(localStorage.getItem('hornet.connection.groups')??'[]');return Array.isArray(value)?value.filter((v):v is string=>typeof v==='string'&&v.length<=128).map(groupPath):[];}catch{return [];}}
export function groupPaths(profiles:Profile[],extra:string[]){
 const paths=new Set<string>(['默认分组']);
 for(const path of [...extra,...profiles.map(p=>p.group)]){const parts=groupPath(path).split('/');for(let i=1;i<=parts.length;i++)paths.add(parts.slice(0,i).join('/'));}
 return [...paths].sort((a,b)=>a.localeCompare(b));
}
interface Group {path:string;name:string;groups:Map<string,Group>;profiles:Profile[]}
export function ConnectionTree({profiles,groups,query,pending,revealGroup,currentProfileId,onCreate,onGroup,onDeleteGroup,onEdit,onClone,onRemove,onConnect}:{
 profiles:Profile[];groups:string[];query:string;pending:boolean;revealGroup?:string;currentProfileId?:string;
 onCreate:(group:string)=>void;onGroup:(parent:string)=>void;onDeleteGroup:(path:string)=>void;onEdit:(p:Profile)=>void;onClone:(p:Profile)=>void;onRemove:(p:Profile)=>void;onConnect:(p:Profile,kind:'terminal'|'files')=>void;
}){
 const [closed,setClosed]=useState<string[]>(()=>{try{const v=JSON.parse(localStorage.getItem('hornet.connection.closedGroups')??'[]');return Array.isArray(v)?v.filter(x=>typeof x==='string'):[];}catch{return [];}});
 const [menu,setMenu]=useState<{x:number;y:number;group:string|null;allowDelete:boolean;profile?:Profile}|null>(null);
 const [selected,setSelected]=useState('');
 useEffect(()=>{if(currentProfileId)setSelected(currentProfileId);},[currentProfileId]);
 const menuRef=useRef<HTMLDivElement>(null),origin=useRef<HTMLElement|null>(null);
 const listRef=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!revealGroup)return;setClosed(old=>{const next=old.filter(path=>path!==revealGroup&&!revealGroup.startsWith(path+'/'));try{localStorage.setItem('hornet.connection.closedGroups',JSON.stringify(next));}catch{}return next;});
  const frame=requestAnimationFrame(()=>{Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-group-path]')??[]).find(el=>el.dataset.groupPath===revealGroup)?.scrollIntoView({block:'nearest'});});return()=>cancelAnimationFrame(frame);
 },[revealGroup]);
 useEffect(()=>{if(!menu)return;
  menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
  const dismiss=(event:Event)=>{if(!menuRef.current?.contains(event.target as Node))setMenu(null);};
  const escape=(event:globalThis.KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();setMenu(null);origin.current?.focus();}};
  const close=()=>setMenu(null);
  window.addEventListener('pointerdown',dismiss,true);window.addEventListener('scroll',dismiss,true);window.addEventListener('keydown',escape);window.addEventListener('resize',close);window.addEventListener('blur',close);
  return()=>{window.removeEventListener('pointerdown',dismiss,true);window.removeEventListener('scroll',dismiss,true);window.removeEventListener('keydown',escape);window.removeEventListener('resize',close);window.removeEventListener('blur',close);};
 },[menu]);
 function context(event:MouseEvent|KeyboardEvent,allowDelete=true){event.preventDefault();event.stopPropagation();const target=event.target as HTMLElement,node=target.closest<HTMLElement>('[data-group-path]');origin.current=node?.querySelector<HTMLButtonElement>('.group-toggle')??listRef.current;
  const rect=target.getBoundingClientRect(),pointer='clientX' in event&&(event.clientX!==0||event.clientY!==0);
  setMenu({x:Math.max(0,Math.min(pointer?(event as MouseEvent).clientX:rect.left+12,window.innerWidth-208)),y:Math.max(0,Math.min(pointer?(event as MouseEvent).clientY:rect.bottom,window.innerHeight-190)),group:node?.dataset.groupPath??null,allowDelete});
 }
 function profileContext(event:MouseEvent|KeyboardEvent,p:Profile){event.preventDefault();event.stopPropagation();setSelected(p.profileId);const node=(event.target as HTMLElement).closest<HTMLElement>('.host')!;origin.current=node;const rect=node.getBoundingClientRect(),pointer='clientX' in event&&(event.clientX!==0||event.clientY!==0);setMenu({x:Math.max(0,Math.min(pointer?event.clientX:rect.left+12,window.innerWidth-208)),y:Math.max(0,Math.min(pointer?event.clientY:rect.bottom,window.innerHeight-245)),group:null,allowDelete:false,profile:p});}
 function choose(action:()=>void){setMenu(null);action();}
 const root:Group={path:'',name:'',groups:new Map(),profiles:[]};
 function ensure(path:string){let node=root;const parts=groupPath(path).split('/');parts.forEach((name,i)=>{const path=parts.slice(0,i+1).join('/');if(!node.groups.has(name))node.groups.set(name,{path,name,groups:new Map(),profiles:[]});node=node.groups.get(name)!;});return node;}
 groups.forEach(ensure);profiles.forEach(p=>ensure(p.group).profiles.push(p));
 const term=query.trim().toLocaleLowerCase();
 const matches=(p:Profile)=>(p.name+' '+p.host+' '+groupPath(p.group)).toLocaleLowerCase().includes(term);
 function count(node:Group):number{return node.profiles.length+[...node.groups.values()].reduce((n,g)=>n+count(g),0);}
 function visible(node:Group):boolean{return !term||node.path.toLocaleLowerCase().includes(term)||node.profiles.some(matches)||[...node.groups.values()].some(visible);}
 function toggle(path:string){setClosed(old=>{const next=old.includes(path)?old.filter(p=>p!==path):[...old,path];try{localStorage.setItem('hornet.connection.closedGroups',JSON.stringify(next));}catch{}return next;});}
 function render(node:Group){const open=Boolean(term)||!closed.includes(node.path);
  return <li key={node.path} className="connection-group" data-group-path={node.path}>
   <div className="group-heading"><button className="group-toggle" aria-label={tr("分组 ")+node.path} aria-expanded={open} title={node.path} onClick={()=>toggle(node.path)} onKeyDown={e=>{if(!term&&((e.key==='ArrowLeft'&&open)||(e.key==='ArrowRight'&&!open))){e.preventDefault();toggle(node.path);}}}><span>{open?'▾':'▸'}</span><span className="group-folder">▰</span><span className="group-name">{node.path==='默认分组'?tr('默认分组'):node.name}</span><small>{count(node)}</small></button><button title={tr("新建子分组")} aria-label={tr("在 ")+node.path+tr(" 下新建子分组")} onClick={()=>onGroup(node.path)}>⊞</button><button title={tr("新建子分组或连接")} aria-label={tr("在 ")+node.path+tr(" 下新建")} aria-haspopup="menu" aria-expanded={menu?.group===node.path} onClick={e=>{context(e,false);origin.current=e.currentTarget;}}>＋</button></div>
   {open&&<ul className="group-children">
    {[...node.groups.values()].sort((a,b)=>a.name.localeCompare(b.name)).filter(visible).map(render)}
    {node.profiles.filter(matches).map(p=><li className={'host'+(selected===p.profileId?' selected':'')} key={p.profileId} tabIndex={0} aria-label={tr("会话 ")+p.name} title={p.name+' · '+p.host+':'+p.port+(p.protocol==='ftp'?tr(' · 双击打开文件'):tr(' · 双击打开终端'))} onClick={()=>setSelected(p.profileId)} onDoubleClick={e=>{if(!pending&&!(e.target as HTMLElement).closest('button'))onConnect(p,'terminal');}} onContextMenu={e=>profileContext(e,p)} onKeyDown={e=>{if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10'))profileContext(e,p);else if(e.target===e.currentTarget&&e.key==='Enter'&&!pending){e.preventDefault();onConnect(p,'terminal');}}}>
     <div className="host-top"><span className="host-symbol">›_</span><div><strong>{p.name}</strong><small>{p.protocol==='telnet'?'Telnet · ':p.username+'@'}{p.host}:{p.port}</small></div><button title={tr("会话操作")} aria-label={tr("操作 ")+p.name} onClick={e=>profileContext(e,p)}>⋯</button></div>
    </li>)}
    {!term&&!node.groups.size&&!node.profiles.length&&<li className="group-empty">{tr("暂无连接，点击 ＋ 添加")}</li>}
   </ul>}
  </li>;
 }
 const roots=[...root.groups.values()].sort((a,b)=>a.name.localeCompare(b.name)).filter(visible);
 return <div className="host-list" ref={listRef} tabIndex={-1} onContextMenu={context} onKeyDown={e=>{if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10'))context(e);}}><ul className="connection-tree" aria-label={tr("连接分组")}>{roots.map(render)}</ul>{!roots.length&&<p className="empty-sidebar">{tr("没有匹配的主机或分组。")}</p>}
  {menu&&createPortal(<div ref={menuRef} role="menu" aria-label={menu.profile?tr("会话操作"):tr("连接分组操作")} className="group-context-menu" style={{left:menu.x,top:menu.y}} onContextMenu={e=>e.preventDefault()} onKeyDown={e=>{const buttons=Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')??[]),index=buttons.indexOf(document.activeElement as HTMLButtonElement);if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();buttons[(index+(e.key==='ArrowDown'?1:buttons.length-1))%buttons.length]?.focus();}else if(e.key==='Home'||e.key==='End'){e.preventDefault();buttons[e.key==='Home'?0:buttons.length-1]?.focus();}else if(e.key==='Tab')setMenu(null);}}>
   <div className="group-context-title">{menu.profile?.name??menu.group??tr("连接管理")}</div>
   {menu.profile?<><button role="menuitem" disabled={pending||menu.profile.protocol==='ftp'} onClick={()=>choose(()=>onConnect(menu.profile!,'terminal'))}>{tr("打开终端")}</button><button role="menuitem" disabled={pending||menu.profile.protocol==='telnet'} onClick={()=>choose(()=>onConnect(menu.profile!,'files'))}>{tr("打开文件")}</button><button role="menuitem" onClick={()=>choose(()=>onEdit(menu.profile!))}>{tr("编辑连接")}</button><button role="menuitem" onClick={()=>choose(()=>onClone(menu.profile!))}>{tr("复制连接")}</button><button role="menuitem" onClick={()=>choose(()=>onRemove(menu.profile!))}>{tr("删除连接")}</button></>:<>
   {menu.group===null&&<button role="menuitem" onClick={()=>choose(()=>onGroup(''))}>{tr("新建分组")}</button>}
   {menu.group!==null&&<><button role="menuitem" onClick={()=>choose(()=>onGroup(menu.group!))}>{tr("新建子分组")}</button></>}
   <button role="menuitem" onClick={()=>choose(()=>onCreate(menu.group??'默认分组'))}>{tr("新建连接")}</button>
   {menu.group!==null&&menu.allowDelete&&<button role="menuitem" disabled={menu.group==='默认分组'} title={menu.group==='默认分组'?tr("系统默认分组不能删除"):undefined} onClick={()=>choose(()=>onDeleteGroup(menu.group!))}>{tr("删除分组")}</button>}
   </>}
  </div>,document.body)}
 </div>;
}

export function GroupDialog({parent,groups,save,close}:{parent:string;groups:string[];save:(path:string)=>void;close:()=>void}){
 const [selected,setSelected]=useState(parent),[name,setName]=useState(''),[error,setError]=useState('');
 return <div className="modal-backdrop"><form className="modal" onSubmit={e=>{e.preventDefault();const segment=name.trim(),path=selected?selected+'/'+segment:segment;
  if(!segment||/[\/\x00-\x1f\x7f]/.test(segment)||segment==='.'||segment==='..'){setError(tr("请输入分组名称，不包含 / 或控制字符。"));return;}
  if(path.length>128){setError(tr("完整分组路径不能超过 128 个字符。"));return;}
  if(groups.includes(path)){setError(tr("该分组已存在。"));return;}save(path);
 }}><h2>{parent?tr("新建子分组"):tr("新建分组")}</h2><label>{tr("上级分组")}<select disabled={Boolean(parent)} aria-label={tr("上级分组")} value={selected} onChange={e=>setSelected(e.target.value)}><option value="">{tr("根目录")}</option>{groups.map(path=><option key={path} value={path}>{path}</option>)}</select></label><label>{tr("分组名称")}<input autoFocus required maxLength={128} value={name} onChange={e=>setName(e.target.value)}/></label>{error&&<p role="alert" className="form-error">{error}</p>}<div className="modal-actions"><button type="button" onClick={close}>{tr("取消")}</button><button className="primary">{tr("创建分组")}</button></div></form></div>;
}
