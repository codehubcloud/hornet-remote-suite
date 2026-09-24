import { useEffect,useState } from 'react';
import type { Profile,HornetEvent } from '../../../packages/contracts';
import { profileSchema } from '../../../packages/contracts';
import { useStore,refreshProfiles,openView,type View } from './store';
import { ConnectionTree,GroupDialog,groupPath,groupPaths,readGroups } from './ConnectionTree';
import { SessionCommands } from './SessionCommands';
import { TaskCenter } from './TaskCenter';
import { TerminalTitleMenu,showTerminalMenu } from './TerminalTitleMenu';
import { TerminalWorkspace } from './TerminalWorkspace';
import { TunnelPanel } from './TunnelPanel';
import { NativePanel } from './NativePanel';
import { VncView } from './VncView';
import { FileView,EditorView } from './FileView';
const fresh=():Profile=>({profileId:crypto.randomUUID(),name:'',host:'',port:22,username:'',group:'默认分组',authType:'password',revision:0});
export function App(){
 const [collapsed,setCollapsed]=useState(()=>{try{return localStorage.getItem('hornet.chrome.collapsed')==='true';}catch{return false;}});
 function toggleChrome(){setCollapsed(value=>{try{localStorage.setItem('hornet.chrome.collapsed',String(!value));}catch{}return !value;});}
 const [connectOnSave,setConnectOnSave]=useState(false);
 const [revealGroup,setRevealGroup]=useState('');
 const [extraGroups,setExtraGroups]=useState(readGroups),[groupParent,setGroupParent]=useState<string|null>(null);
 const [showHosts,setShowHosts]=useState(false);
 const s=useStore();const [form,setForm]=useState<Profile|null>(null),[query,setQuery]=useState(''),[pending,setPending]=useState(false),[recent,setRecent]=useState<string[]>([]);
 useEffect(()=>{
  const stop=window.hornet.onEvent(event=>useStore.getState().event(event));
  void Promise.all([refreshProfiles(),window.hornet.task.list().then(s.setTasks),window.hornet.capabilities().then(s.setCapabilities),window.hornet.layout.load().then(v=>setRecent(v.profileIds))]).catch(s.fail);
  return stop;
 },[]);
 async function connect(p:Profile,kind:'terminal'|'files'){setPending(true);try{await openView(p,kind);}catch(e){s.fail(e);}finally{setPending(false);}}
 async function close(v:View){
  if(v.desktop){try{await window.hornet.vnc.close(v.desktop.desktopId);s.removeView(v.id);}catch(e){s.fail(e);}return;}
  if(v.kind==='editor'&&!window.confirm('关闭编辑器？请先保存未提交的更改。'))return;
  try{for(const id of v.terminalIds??(v.terminalId?[v.terminalId]:[]))await window.hornet.terminal.close(id);if(v.leaseId)await window.hornet.connection.release(v.leaseId);s.removeView(v.id);
   await window.hornet.layout.save({profileIds:[...new Set(useStore.getState().views.map(v=>v.profile.profileId))]});
  }catch(e){s.fail(e);}
 }
 async function remove(p:Profile){if(!window.confirm('删除连接配置 '+p.name+'？'))return;try{await window.hornet.profiles.delete(p.profileId,p.revision);await refreshProfiles();}catch(e){s.fail(e);}}
 async function deleteGroup(path:string){
  const belongs=(value:string)=>value===path||value.startsWith(path+'/');
  const members=s.profiles.filter(p=>belongs(groupPath(p.group)));
  if(!window.confirm('删除分组“'+path+'”及其全部子分组？'+(members.length?'其中 '+members.length+' 个连接配置也将一并删除，无法撤销。':'分组中没有连接。')))return;
  try{
   await window.hornet.profiles.removeGroup(path,members.map(p=>({profileId:p.profileId,revision:p.revision})));
   const next=extraGroups.filter(p=>!belongs(p));
   // Keep ancestors even when their last child is removed.
   const parts=path.split('/');for(let i=1;i<parts.length;i++)next.push(parts.slice(0,i).join('/'));
   const remaining=[...new Set(next)];localStorage.setItem('hornet.connection.groups',JSON.stringify(remaining));setExtraGroups(remaining);setRevealGroup('');
   await refreshProfiles();
  }catch(e){s.fail(e);await refreshProfiles().catch(s.fail);}
 }
 const groups=groupPaths(s.profiles,extraGroups);
 const active=s.views.find(v=>v.id===s.active);
 const activeTasks=s.tasks.filter(t=>['queued','running','verifying','committing','pausing'].includes(t.state)).length;
 return <div className={collapsed?"app-shell chrome-collapsed":"app-shell"}>
  <header className="app-header"><div className="brand"><div className="brand-mark">H</div><strong>HORNET<span>REMOTE SUITE</span></strong></div>{active?.kind==='terminal'&&<button aria-pressed={showHosts} onClick={()=>setShowHosts(!showHosts)}>主机列表</button>}<span className="version">0.1.0 · 开发版</span><button onClick={()=>void window.hornet.auth.lock().then(()=>s.fail('凭据库已锁定；已连接的会话不会断开。')).catch(s.fail)}>锁定凭据</button></header>
  <SessionCommands create={fields=>{setConnectOnSave(Boolean(fields));setForm({...fresh(),...fields});}} connect={p=>void connect(p,'terminal')} close={v=>void close(v)} hosts={()=>setShowHosts(true)} toggleChrome={toggleChrome} collapsed={collapsed} pending={pending}/>
  <div className="app-body"><aside className="sidebar" style={{display:active?.kind==='terminal'&&!showHosts?'none':'flex'}}>
   <div className="section-heading"><span>连接管理</span><button title="新建分组" aria-label="新建分组" onClick={()=>setGroupParent('')}>⊞</button><button title="新建连接" aria-label="新建连接" onClick={()=>setForm(fresh())}>＋</button></div>
   <input className="search" aria-label="搜索主机" placeholder="搜索名称、主机或分组…" value={query} onChange={e=>setQuery(e.target.value)}/>
   <ConnectionTree revealGroup={revealGroup} profiles={s.profiles} groups={groups} query={query} pending={pending} onCreate={group=>setForm({...fresh(),group})} onGroup={setGroupParent} onDeleteGroup={path=>void deleteGroup(path)} onEdit={setForm} onRemove={p=>void remove(p)} onConnect={(p,kind)=>void connect(p,kind)}/>
   <div className="sidebar-bottom"><button onClick={()=>void window.hornet.profiles.import().then(refreshProfiles).catch(s.fail)}>导入配置</button><button onClick={()=>void window.hornet.profiles.export().catch(s.fail)}>导出配置</button></div>
  </aside>
  <main className="workspace">
   <nav className="tabs"><button className={s.active==='home'?'tab active':'tab'} onClick={()=>s.setActive('home')}>◈ 工作台</button>
    {s.views.map(v=><div className={s.active===v.id?'tab active':'tab'} key={v.id} onContextMenu={e=>{if(v.kind==='terminal')showTerminalMenu(e,v.id);}}><button onClick={()=>s.setActive(v.id)}>{v.kind==='terminal'?'>_':v.kind==='files'?'▰':'▤'} {v.title??v.profile.name} · {v.kind==='terminal'?'终端':v.kind==='files'?'文件':v.kind==='vnc'?'VNC':v.path?.split('/').pop()}</button><button aria-label={'关闭 '+(v.title??v.profile.name)} onClick={()=>void close(v)}>×</button></div>)}
    <button className="chrome-toggle" onClick={toggleChrome} aria-expanded={!collapsed} title={collapsed?'展开工具栏':'折叠工具栏'} aria-label={collapsed?'展开工具栏':'折叠工具栏'}>{collapsed?'⌄':'⌃'}</button>
   </nav>
   {s.error&&<div className="error-banner" role="alert"><span>{s.error}</span><button onClick={s.clearError}>关闭</button></div>}
   <div className="content">
    {s.active==='home'&&<section className="dashboard"><div className="eyebrow">YOUR REMOTE WORKSPACE</div><h1>连接主机，专注工作。</h1><p className="intro">终端、文件与后台任务，共享一个工作台。</p>
     <div className="stats"><div><strong>{s.profiles.length}</strong><span>已保存主机</span></div><div><strong>{s.views.length}</strong><span>打开的视图</span></div><div><strong>{activeTasks}</strong><span>活动传输</span></div></div>
     <div className="dashboard-heading"><h2>开始使用</h2><button className="primary" onClick={()=>setForm(fresh())}>＋ 新建连接</button></div>
     <div className="quick-start"><p>创建 SSH 连接后，可分别打开终端和文件视图。关闭终端不会中断后台传输。</p>{recent.length>0&&<div><span className="muted">上次工作区 · 当前未连接</span>{s.profiles.filter(p=>recent.includes(p.profileId)).map(p=><button key={p.profileId} disabled={pending} onClick={()=>void connect(p,'terminal')}>{p.name} ↗</button>)}</div>}</div>
     <h2>功能状态</h2><div className="capabilities">{s.capabilities.map(c=><article key={c.id}><div><span className={c.state==='available'?'status-dot':'status-dot off'}/><strong>{c.name}</strong><span className="badge">{{available:'可用',unavailable:'待实现','requires-setup':'需配置',experimental:'实验'}[c.state]}</span></div><p>{c.reason}</p></article>)}</div>
     <TunnelPanel/>
     <NativePanel/>
    </section>}
    <section className="view terminal-session-workspace" data-view-id={active?.kind==='terminal'?active.id:undefined} style={{display:active?.kind==='terminal'?'flex':'none'}}><TerminalWorkspace onClose={v=>void close(v)}/></section>
    {s.views.filter(v=>v.kind!=='terminal').map(v=><section key={v.id} className="view" data-view-id={v.id} style={{display:s.active===v.id?'flex':'none'}}>{v.kind!=='terminal'&&<div className="view-meta"><span>{v.profile.name} / {v.profile.host}</span><span>{s.connectionStates[v.connectionId]==='closed'?'已断开':'SSH · 加密连接'}</span><button disabled={pending} onClick={()=>void connect(v.profile,v.kind==='files'?'terminal':'files')}>{v.kind==='files'?'打开终端':'打开文件'}</button></div>}{v.kind==='vnc'?<VncView view={v}/>:v.kind==='files'?<FileView view={v}/>:<EditorView view={v}/>}</section>)}
   </div>
   <TaskCenter activeId={s.active}/>
  </main></div>
  <footer className="statusbar"><span><i className="status-dot"/>本地工作区</span><span>{active?active.profile.username+'@'+active.profile.host:'核心功能不依赖云账号'}</span><span>SSH / SFTP · Windows</span></footer>
  <TerminalTitleMenu/>
  {form&&<ProfileDialog groups={groups} profile={form} connectOnSave={connectOnSave} saved={p=>{if(connectOnSave)void connect(p,'terminal');}} close={()=>{setForm(null);setConnectOnSave(false);}}/>}
  {groupParent!==null&&<GroupDialog parent={groupParent} groups={groups} close={()=>setGroupParent(null)} save={path=>{const next=[...extraGroups,path];try{localStorage.setItem('hornet.connection.groups',JSON.stringify(next));setExtraGroups(next);setRevealGroup(path);setGroupParent(null);setQuery('');}catch(e){s.fail(e);}}}/>}
  {s.challenges[0]&&<ChallengeDialog key={s.challenges[0].challengeId} challenge={s.challenges[0]}/>}
 </div>;
}
function ProfileDialog({profile,groups,close,saved,connectOnSave}:{profile:Profile;groups:string[];close:()=>void;saved:(profile:Profile)=>void;connectOnSave:boolean}){
 const [p,setP]=useState(profile),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const field=(key:keyof Profile,value:string|number)=>setP({...p,[key]:value});
 async function save(){setBusy(true);try{const clean=profileSchema.parse({...p,group:groupPath(p.group)});const result=await window.hornet.profiles.save(clean,profile.revision);await refreshProfiles();close();saved(result);}catch(e){setError(e instanceof Error?e.message:'无法保存');}finally{setBusy(false);}}
 return <div className="modal-backdrop"><form className="modal" onSubmit={e=>{e.preventDefault();void save();}}><div className="modal-heading"><h2>{profile.revision?'编辑连接':'新建 SSH 连接'}</h2><button type="button" onClick={close}>×</button></div><p className="muted">连接资料保存在本机，密码在连接时输入。</p>
  <label>名称<input required autoFocus value={p.name} onChange={e=>field('name',e.target.value)}/></label>
  <div className="form-row"><label>主机<input required placeholder="192.168.1.10" value={p.host} onChange={e=>field('host',e.target.value)}/></label><label className="port">端口<input required type="number" min={1} max={65535} value={p.port} onChange={e=>field('port',Number(e.target.value))}/></label></div>
  <label>用户名<input required value={p.username} onChange={e=>field('username',e.target.value)}/></label>
  <label>分组<input list="connection-group-options" maxLength={128} placeholder="例如：生产环境/北京/数据库" value={p.group} onChange={e=>field('group',e.target.value)}/></label><datalist id="connection-group-options">{groups.map(path=><option key={path} value={path}/>)}</datalist><p className="muted">选择已有分组，或用 / 分隔创建多级子分组。</p>
  <label>认证方式<select value={p.authType} onChange={e=>field('authType',e.target.value)}><option value="password">密码 / 交互认证</option><option value="privateKey">私钥文件</option><option value="agent">系统 SSH Agent</option></select></label>
  {error&&<p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" onClick={close}>取消</button><button className="primary" disabled={busy}>{connectOnSave?'保存并连接':'保存配置'}</button></div>
 </form></div>;
}
function ChallengeDialog({challenge:c}:{challenge:Extract<HornetEvent,{type:'challenge'}>}){
 const [secret,setSecret]=useState(''),[remember,setRemember]=useState(false),[busy,setBusy]=useState(false);
 async function respond(value:string){setBusy(true);try{if(c.kind==='trust')await window.hornet.auth.trust(c.challengeId,value==='accept'?'accept':'reject');else await window.hornet.auth.respond(c.challengeId,value,remember);setSecret('');}catch(e){useStore.getState().fail(e);}finally{setBusy(false);}}
 return <div className="modal-backdrop"><form className="modal" onSubmit={e=>{e.preventDefault();void respond(secret);}}><div className="modal-heading"><h2>{c.title}</h2><button type="button" aria-label="取消认证" onClick={()=>void window.hornet.auth.cancel(c.challengeId).catch(useStore.getState().fail)}>×</button></div><pre className="challenge-info">{c.message}</pre>
  {c.kind==='trust'?<div className="modal-actions"><button type="button" disabled={busy} onClick={()=>void respond('reject')}>拒绝连接</button><button type="button" className="primary" disabled={busy} onClick={()=>void respond('accept')}>已核对，信任此主机</button></div>:c.kind==='privateKey'?<button type="button" className="primary" onClick={()=>void window.hornet.auth.chooseKey(c.challengeId).catch(useStore.getState().fail)}>选择本地私钥文件</button>:<>
   <label>{c.kind==='passphrase'?'口令（可留空）':'认证信息'}<input aria-label="认证信息" autoFocus type={c.echo?'text':'password'} value={secret} onChange={e=>setSecret(e.target.value)} autoComplete="off"/></label>
   {c.kind==='password'&&<label className="checkbox"><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/>认证成功后保存到系统保护的凭据库</label>}
   <div className="modal-actions"><button className="primary" disabled={busy}>继续连接</button></div>
  </>}
 </form></div>;
}
