import { useEffect,useRef,useState } from 'react';
import type { Profile } from '../../../packages/contracts';
import { t,formatDate } from './i18n';
import { groupPath } from './ConnectionTree';
import { showStartupSessions,startupSessionsKey } from './session-dialog-preferences';

type SortKey='name'|'host'|'username'|'protocol'|'port'|'description'|'updatedAt';
const columns:{key:SortKey;label:string}[]=[{key:'name',label:'名称'},{key:'host',label:'主机'},{key:'username',label:'用户名'},{key:'protocol',label:'协议'},{key:'port',label:'端口'},{key:'description',label:'说明'},{key:'updatedAt',label:'修改时间'}];
export function SessionsDialog({profiles,groups,pending,loading,suspended,error,close,create,edit,clone,remove,connect,newGroup,refresh}:{
 profiles:Profile[];groups:string[];pending:boolean;loading:boolean;suspended:boolean;error:string|null;
 close:()=>void;create:(group:string)=>void;edit:(p:Profile)=>void;clone:(p:Profile)=>void;remove:(p:Profile)=>void;connect:(p:Profile)=>void;newGroup:(parent:string)=>void;refresh:()=>Promise<void>;
}){
 const [query,setQuery]=useState(''),[folder,setFolder]=useState(''),[selected,setSelected]=useState('');
 const [sort,setSort]=useState<{key:SortKey;ascending:boolean}>({key:'name',ascending:true});
 const [startup,setStartup]=useState(showStartupSessions),[preferenceError,setPreferenceError]=useState(''),[refreshing,setRefreshing]=useState(false);
 const [newMenu,setNewMenu]=useState(false);
 const root=useRef<HTMLElement>(null),search=useRef<HTMLInputElement>(null),closeRef=useRef(close);closeRef.current=()=>{if(newMenu)setNewMenu(false);else close();};
 const currentFolder=groups.includes(folder)?folder:'';
 const needle=query.trim().toLocaleLowerCase();
 const rows=profiles.filter(p=>(!currentFolder||groupPath(p.group)===currentFolder||groupPath(p.group).startsWith(currentFolder+'/'))&&(!needle||[p.name,p.host,p.username,p.description??'',p.group].some(v=>v.toLocaleLowerCase().includes(needle)))).sort((a,b)=>{
  const av=a[sort.key]??(sort.key==='protocol'?'ssh':''),bv=b[sort.key]??(sort.key==='protocol'?'ssh':'');
  const order=typeof av==='number'&&typeof bv==='number'?av-bv:String(av).localeCompare(String(bv),undefined,{numeric:true});
  return (sort.ascending?order:-order)||a.profileId.localeCompare(b.profileId);
 });
 const chosen=rows.find(p=>p.profileId===selected),busy=pending||loading||refreshing;
 useEffect(()=>{
  if(suspended)return;
  const previous=document.activeElement as HTMLElement|null;
  search.current?.focus();
  const trap=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closeRef.current();return;}
   if(event.key!=='Tab')return;
   const focusable=[...(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')??[])].filter(e=>e.getClientRects().length);
   const first=focusable[0],last=focusable.at(-1);
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
   else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  };
  window.addEventListener('keydown',trap,true);
  return()=>{window.removeEventListener('keydown',trap,true);if(previous?.isConnected)previous.focus();};
 },[suspended]);
 async function reload(){setRefreshing(true);try{await refresh();}finally{setRefreshing(false);}}
 function chooseStartup(value:boolean){try{localStorage.setItem(startupSessionsKey,String(value));setStartup(value);setPreferenceError('');}catch{setPreferenceError(t('无法保存启动设置。'));}}
 return <div className="modal-backdrop sessions-backdrop" style={suspended?{display:'none'}:undefined}>
  <section ref={root} className="sessions-dialog" role="dialog" aria-modal="true" aria-label={t('会话')} onKeyDown={e=>{
   if(!e.altKey||e.ctrlKey||e.shiftKey)return;
   if(e.code==='KeyS'){e.preventDefault();chooseStartup(!startup);}
   if(e.code==='KeyC'){e.preventDefault();if(chosen&&!busy)connect(chosen);}
   if(e.code==='KeyN'){e.preventDefault();if(!busy)create(currentFolder||'默认分组');}
  }}>
   <header className="sessions-title"><span aria-hidden="true">▣</span><span>{t('会话')}</span><button aria-label={t('关闭会话窗口')} onClick={close}>×</button></header>
   <div className="sessions-toolbar" role="toolbar" aria-label={t('会话操作')}>
    <button disabled={busy} onClick={()=>create(currentFolder||'默认分组')}><span aria-hidden="true">▣＋</span> {t('新建')}</button>
    <div className="sessions-new-menu"><button aria-label={t('新建选项')} aria-expanded={newMenu} onClick={()=>setNewMenu(v=>!v)}>▾</button>{newMenu&&<div className="sessions-new-options"><button onClick={()=>{setNewMenu(false);create(currentFolder||'默认分组');}}>{t('新建连接')}</button><button onClick={()=>{setNewMenu(false);newGroup(currentFolder);}}>{currentFolder?t('新建子分组'):t('新建分组')}</button></div>}</div>
    <span className="toolbar-separator"/>
    <button title={t('复制会话')} aria-label={t('复制会话')} disabled={!chosen||busy} onClick={()=>chosen&&clone(chosen)}>▣</button>
    <button title={t('删除')} aria-label={t('删除')} disabled={!chosen||busy} onClick={()=>chosen&&remove(chosen)}>⌫</button>
    <button disabled={!chosen||busy} onClick={()=>chosen&&edit(chosen)}>⚙ {t('属性')}</button>
    <span className="toolbar-separator"/>
    <button title={t('新建分组')} aria-label={t('新建分组')} disabled={busy} onClick={()=>newGroup(currentFolder)}>⊞</button>
    <input ref={search} type="search" aria-label={t('搜索会话')} placeholder={t('搜索会话')} value={query} onChange={e=>setQuery(e.target.value)}/>
   </div>
   <div className="sessions-location"><select aria-label={t('会话分组')} value={currentFolder} onChange={e=>{setFolder(e.target.value);setSelected('');}}><option value="">{t('所有会话')}</option>{groups.map(g=><option key={g} value={g}>{g==='默认分组'?t('默认分组'):g}</option>)}</select><button title={t('上级')} aria-label={t('上级')} disabled={!currentFolder} onClick={()=>{setFolder(currentFolder.split('/').slice(0,-1).join('/'));setSelected('');}}>↰</button><button title={t('刷新')} aria-label={t('刷新')} disabled={busy} onClick={()=>void reload()}>⟳</button></div>
   {(error||preferenceError)&&<p className="form-error" role="alert">{preferenceError||error}</p>}
   <div className="sessions-list" tabIndex={0} aria-label={t('会话列表')} onKeyDown={e=>{
    if(e.target!==e.currentTarget)return;
    if(e.key==='Enter'&&chosen&&!busy){e.preventDefault();connect(chosen);}
    if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)&&rows.length){e.preventDefault();const index=rows.findIndex(p=>p.profileId===selected);const next=e.key==='Home'?0:e.key==='End'?rows.length-1:e.key==='ArrowDown'?Math.min(rows.length-1,index+1):Math.max(0,index-1);setSelected(rows[next].profileId);requestAnimationFrame(()=>root.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({block:'nearest'}));}
   }}>
    <table aria-label={t('已保存的会话')}><colgroup>{columns.map(c=><col key={c.key} className={'session-col-'+c.key}/>)}</colgroup><thead><tr>{columns.map(c=><th key={c.key} aria-sort={sort.key===c.key?(sort.ascending?'ascending':'descending'):'none'}><button onClick={()=>setSort({key:c.key,ascending:sort.key===c.key?!sort.ascending:true})}>{t(c.label)}{sort.key===c.key&&<span aria-hidden="true"> {sort.ascending?'▴':'▾'}</span>}</button></th>)}</tr></thead><tbody>{rows.map(p=><tr key={p.profileId} aria-selected={p.profileId===selected} onClick={()=>{setSelected(p.profileId);root.current?.querySelector<HTMLElement>('.sessions-list')?.focus();}} onDoubleClick={()=>{if(!busy)connect(p);}}>
     <td title={p.name}><span className="session-row-icon" aria-hidden="true">▣</span>{p.name}</td><td title={p.host}>{p.host}</td><td title={p.username}>{p.username}</td><td>{p.session?.mosh?'MOSH':(p.protocol==='ftp'&&p.ftpSecurity!=='none'?'ftps':p.protocol??'ssh').toUpperCase()}</td><td>{p.port}</td><td title={p.description}>{p.description??''}</td><td>{p.updatedAt?formatDate(p.updatedAt):'—'}</td>
    </tr>)}</tbody></table>
    {loading&&<p className="sessions-empty" role="status">{t('正在加载会话…')}</p>}{!loading&&!rows.length&&needle&&<p className="sessions-empty" role="status">{t('没有匹配的会话')}</p>}
   </div>
   <footer className="sessions-footer"><label><input type="checkbox" checked={startup} onChange={e=>chooseStartup(e.target.checked)}/>{t('启动时显示此对话框(S)')}</label><button className="sessions-connect" disabled={!chosen||busy} onClick={()=>chosen&&connect(chosen)}>{t('连接(C)')}</button><button className="sessions-close" onClick={close}>{t('关闭')}</button></footer>
  </section>
 </div>;
}
