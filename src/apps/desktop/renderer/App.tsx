import { EncodingSelect } from './EncodingSelect';
import { t as tr } from './i18n';
import { challengeCopy } from './challenge-copy';
import { useAppearance } from './appearance';
import { useEffect,useState } from 'react';
import type { Profile,HornetEvent } from '../../../packages/contracts';
import { profileSchema } from '../../../packages/contracts';
import { useStore,refreshProfiles,openView,closeTerminalView,isTerminalClosed,type View } from './store';
import { ConnectionTree,GroupDialog,groupPath,groupPaths,readGroups } from './ConnectionTree';
import { SessionCommands } from './SessionCommands';
import { JumpRouteEditor } from './JumpRouteEditor';
import { SessionsDialog } from './SessionsDialog';
import { showStartupSessions } from './session-dialog-preferences';
import { TaskCenter } from './TaskCenter';
import { TerminalTitleMenu,showTerminalMenu } from './TerminalTitleMenu';
import { TerminalWorkspace } from './TerminalWorkspace';
import { layoutRects } from './terminal-layout';
import { tabGroup } from './terminal-tabs';
import { StartPage,SuiteWorkspace,suiteTools,type SuiteTool } from './SuiteWorkspace';
import { VncView } from './VncView';
import { FileWorkspace } from './FileWorkspace';
import { EditorView } from './FileView';
const fresh=():Profile=>({profileId:crypto.randomUUID(),name:'',host:'',port:22,username:'',group:'默认分组',authType:'password',revision:0});
export function App(){
 useAppearance(s=>s.value.language);
 const [collapsed,setCollapsed]=useState(()=>{try{return localStorage.getItem('hornet.chrome.collapsed')==='true';}catch{return false;}});
 function toggleChrome(){setCollapsed(value=>{try{localStorage.setItem('hornet.chrome.collapsed',String(!value));}catch{}return !value;});}
 const [toolTabs,setToolTabs]=useState<SuiteTool[]>([]);
 function openTool(tool:SuiteTool){setToolTabs(tabs=>tabs.includes(tool)?tabs:[...tabs,tool]);useStore.getState().setActive(tool);}
 function closeTool(tool:SuiteTool){setToolTabs(tabs=>tabs.filter(t=>t!==tool));if(useStore.getState().active===tool)useStore.getState().setActive('home');}
 const [sessionsOpen,setSessionsOpen]=useState(showStartupSessions),[profilesLoading,setProfilesLoading]=useState(true);
 const [connectOnSave,setConnectOnSave]=useState(false);
 const [revealGroup,setRevealGroup]=useState('');
 const [extraGroups,setExtraGroups]=useState(readGroups),[groupParent,setGroupParent]=useState<string|null>(null);
 const [showHosts,setShowHosts]=useState(false),[hostsHidden,setHostsHidden]=useState(false);
 const s=useStore();const [form,setForm]=useState<Profile|null>(null),[query,setQuery]=useState(''),[pending,setPending]=useState(false),[recent,setRecent]=useState<string[]>([]);
 useEffect(()=>{
  const stop=window.hornet.onEvent(event=>useStore.getState().event(event));
  void Promise.all([refreshProfiles().finally(()=>setProfilesLoading(false)),window.hornet.terminalLogs.list().then(s.setLogs),window.hornet.task.list().then(s.setTasks),window.hornet.capabilities().then(s.setCapabilities),window.hornet.layout.load().then(v=>setRecent(v.profileIds))]).catch(s.fail);
  return stop;
 },[]);
 async function connect(p:Profile,kind:'terminal'|'files'){setPending(true);try{await openView(p,kind);setRecent(ids=>[p.profileId,...ids.filter(id=>id!==p.profileId)].slice(0,20));}catch(e){s.fail(e);}finally{setPending(false);}}
 async function close(v:View):Promise<boolean>{
  if(v.kind==='terminal'){try{await closeTerminalView(v.id);return true;}catch(e){s.fail(e);return false;}}
  if(v.desktop){try{await window.hornet.vnc.close(v.desktop.desktopId);s.removeView(v.id);return true;}catch(e){s.fail(e);return false;}}
  if(v.kind==='editor'&&!window.confirm(tr("关闭编辑器？请先保存未提交的更改。")))return false;
  try{for(const id of v.terminalIds??(v.terminalId?[v.terminalId]:[]))await window.hornet.terminal.close(id);if(v.leaseId)await window.hornet.connection.release(v.leaseId);s.removeView(v.id);
   await window.hornet.layout.save({profileIds:[...new Set(useStore.getState().views.filter(v=>!v.source).map(v=>v.profile.profileId))]});return true;
  }catch(e){s.fail(e);return false;}
 }
 async function remove(p:Profile){if(!window.confirm(tr("删除连接配置 ")+p.name+'？'))return;try{await window.hornet.profiles.delete(p.profileId,p.revision);await refreshProfiles();}catch(e){s.fail(e);}}
 async function deleteGroup(path:string){
  const belongs=(value:string)=>value===path||value.startsWith(path+'/');
  const members=s.profiles.filter(p=>belongs(groupPath(p.group)));
  if(!window.confirm(tr("删除分组“")+path+tr("”及其全部子分组？")+(members.length?tr("其中 ")+members.length+tr(" 个连接配置也将一并删除，无法撤销。"):tr("分组中没有连接。"))))return;
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
 const hostsVisible=active?.kind==='terminal'?showHosts:!hostsHidden;
 const splitPanes=s.terminalLayout?layoutRects(s.terminalLayout).panes:null;
 const splitActive=active?.kind==='terminal'&&!!splitPanes?.has(active.id)&&splitPanes.size>1;
 // In split mode the same session tabs belong to their panes. Common workspace
 // tabs sit above the file browser, or in the first pane when it is hidden.
 function renderTabs(paneId?:string,common=true){return <nav className="tabs">
  {common&&<button className={s.active==='home'?'tab active':'tab'} onClick={()=>s.setActive('home')}>{tr("◈ 工作台")}</button>}
  {s.views.filter(v=>paneId===undefined||(v.kind==='terminal'?v.id===paneId||s.views.some(p=>p.id===paneId&&tabGroup(p)===tabGroup(v))||common&&!s.views.some(p=>splitPanes?.has(p.id)&&tabGroup(p)===tabGroup(v)):common)).map(v=><div className={s.active===v.id?'tab active':'tab'} key={v.id} data-tab-view-id={v.id} style={v.tabColor?{borderTopColor:v.tabColor,boxShadow:`inset 0 2px ${v.tabColor}`}:{}} onPointerDown={e=>{if(e.button===2&&v.kind==='terminal')showTerminalMenu(e,v.id);}} onContextMenu={e=>{if(v.kind==='terminal')showTerminalMenu(e,v.id);}}><button aria-label={(v.kind==='terminal'?'>_':v.kind==='files'?'▰':'▤')+' '+(v.title??v.profile.name)+' · '+(v.kind==='terminal'?tr("终端"):v.kind==='files'?tr("文件"):v.kind==='vnc'?'VNC':v.path?.split('/').pop())} onClick={()=>s.setActive(v.id)}>{v.kind==='terminal'&&s.tabDisplay.status&&<span className={'tab-state-icon'+(isTerminalClosed(v,s)?' disconnected':'')} aria-hidden="true">● </span>}{v.kind==='terminal'&&s.tabDisplay.numbers&&<span className="tab-number" aria-hidden="true">{s.views.filter(p=>p.kind==='terminal').findIndex(p=>p.id===v.id)+1} </span>}{v.kind==='terminal'?'>_':v.kind==='files'?'▰':'▤'} {s.tabDisplay.title&&v.kind==='terminal'&&v.terminalTitle?v.terminalTitle:v.title??v.profile.name} · {v.kind==='terminal'?tr("终端"):v.kind==='files'?tr("文件"):v.kind==='vnc'?'VNC':v.path?.split('/').pop()}{v.kind==='terminal'&&isTerminalClosed(v,s)&&<span className="terminal-tab-disconnected"> · {tr('已断开')}</span>}</button><button aria-label={tr("关闭 ")+(v.title??v.profile.name)} disabled={!!v.locked} title={v.locked?tr("标签已锁定，请先解锁。"):undefined} onClick={()=>void close(v)}>{v.locked?'🔒':'×'}</button></div>)}
  {common&&s.blankTabs.map(id=><div key={id} className={'tab'+(s.active===id?' active':'')}><button onClick={()=>s.setActive(id)}>{tr('新选项卡')}</button><button aria-label={tr('关闭当前标签')} onClick={()=>s.closeBlankTab(id)}>×</button></div>)}
  {common&&toolTabs.map(tool=><div className={s.active===tool?'tab active':'tab'} key={tool}><button onClick={()=>s.setActive(tool)}>{tr(suiteTools.find(t=>t.id===tool)!.name)}</button><button aria-label={tr("关闭 ")+tr(suiteTools.find(t=>t.id===tool)!.name)} onClick={()=>closeTool(tool)}>×</button></div>)}
  {common&&<button aria-label={tr('新选项卡')} onClick={s.newTab}>＋</button>}
  {common&&<button className="chrome-toggle" onClick={toggleChrome} aria-expanded={!collapsed} title={collapsed?tr("展开工具栏"):tr("折叠工具栏")} aria-label={collapsed?tr("展开工具栏"):tr("折叠工具栏")}>{collapsed?'⌄':'⌃'}</button>}
 </nav>;}
 return <div className={collapsed?"app-shell chrome-collapsed":"app-shell"}>
  <SessionCommands recent={recent} edit={p=>{setConnectOnSave(false);setForm(p);}} hostsVisible={hostsVisible} toggleHosts={()=>{if(active?.kind==='terminal')setShowHosts(!showHosts);else setHostsHidden(!hostsHidden);}} openTool={openTool} toolTabs={toolTabs} closeTool={closeTool} create={fields=>{setConnectOnSave(Boolean(fields));setForm({...fresh(),...fields});}} connect={p=>void connect(p,'terminal')} close={close} hosts={()=>setSessionsOpen(true)} toggleChrome={toggleChrome} collapsed={collapsed} pending={pending}/>
  <div className="app-body"><aside className="sidebar" style={{display:hostsVisible?'flex':'none'}}>
   <div className="section-heading"><span>{tr("连接管理")}</span><button title={tr("新建分组")} aria-label={tr("新建分组")} onClick={()=>setGroupParent('')}>⊞</button><button title={tr("新建连接")} aria-label={tr("新建连接")} onClick={()=>setForm(fresh())}>＋</button></div>
   <input className="search" aria-label={tr("搜索主机")} placeholder={tr("搜索名称、主机或分组…")} value={query} onChange={e=>setQuery(e.target.value)}/>
   <ConnectionTree revealGroup={revealGroup} profiles={s.profiles} groups={groups} query={query} pending={pending} onCreate={group=>setForm({...fresh(),group})} onGroup={setGroupParent} onDeleteGroup={path=>void deleteGroup(path)} onEdit={setForm} onClone={p=>setForm({...p,profileId:crypto.randomUUID(),revision:0,name:p.name+tr(" 副本")})} onRemove={p=>void remove(p)} onConnect={(p,kind)=>void connect(p,kind)}/>
   <div className="sidebar-bottom"><button onClick={()=>void window.hornet.profiles.import().then(refreshProfiles).catch(s.fail)}>{tr("导入配置")}</button><button onClick={()=>void window.hornet.profiles.export().catch(s.fail)}>{tr("导出配置")}</button></div>
  </aside>
  <main className="workspace">
   {!splitActive&&renderTabs()}
   {s.error&&<div className="error-banner" role="alert"><span>{s.error}</span><button onClick={s.clearError}>{tr("关闭")}</button></div>}
   <div className="content">
    {(s.active==='home'||s.blankTabs.includes(s.active))&&<StartPage recent={recent} pending={pending} create={fields=>{setConnectOnSave(Boolean(fields));setForm({...fresh(),...fields});}} connect={(p,kind)=>void connect(p,kind)} openTool={openTool}/>}
    {toolTabs.map(tool=><div key={tool} className="tool-view" hidden={s.active!==tool}><SuiteWorkspace tool={tool}/></div>)}
    <section className="view terminal-session-workspace" data-view-id={active?.kind==='terminal'?active.id:undefined} style={{display:active?.kind==='terminal'?'flex':'none'}}><TerminalWorkspace splitActive={splitActive} renderTabs={renderTabs}/></section>
    {s.views.filter(v=>v.kind!=='terminal').map(v=><section key={v.id} className="view" data-view-id={v.id} style={{display:s.active===v.id?'flex':'none'}}>{v.kind!=='terminal'&&<div className="view-meta"><span>{v.profile.name} / {v.profile.host}</span><span>{s.connectionStates[v.connectionId]==='closed'?tr("已断开"):v.profile.protocol==='ftp'?(v.profile.ftpSecurity==='none'?tr("FTP · 明文"):tr("FTPS · TLS 加密连接")):tr("SSH · 加密连接")}</span><button hidden={v.profile.protocol==='ftp'} disabled={pending} onClick={()=>void connect(v.profile,v.kind==='files'?'terminal':'files')}>{v.kind==='files'?tr("打开终端"):tr("打开文件")}</button></div>}{v.kind==='vnc'?<VncView view={v}/>:v.kind==='files'?<FileWorkspace view={v}/>:<EditorView view={v}/>}</section>)}
   </div>
   <TaskCenter activeId={s.active} quiet={!active}/>
  </main></div>
  <footer className="statusbar"><span><i className="status-dot"/>{tr("本地工作区")}</span><span>{active?(active.profile.username?active.profile.username+'@':'')+active.profile.host:tr("核心功能不依赖云账号")}</span><span>SSH / SFTP / FTP / FTPS / Telnet · Windows</span></footer>
  <TerminalTitleMenu/>
  {sessionsOpen&&<SessionsDialog profiles={s.profiles} groups={groups} pending={pending} loading={profilesLoading} suspended={Boolean(form)||groupParent!==null||Boolean(s.challenges[0])} error={s.error} close={()=>setSessionsOpen(false)} create={group=>{setConnectOnSave(false);setForm({...fresh(),group});}} edit={p=>{setConnectOnSave(false);setForm(p);}} clone={p=>{setConnectOnSave(false);setForm({...p,profileId:crypto.randomUUID(),revision:0,name:p.name+tr(' 副本')});}} remove={p=>void remove(p)} connect={p=>{setSessionsOpen(false);void connect(p,'terminal');}} newGroup={setGroupParent} refresh={()=>refreshProfiles().catch(s.fail)}/>}
  {form&&<ProfileDialog groups={groups} profile={form} connectOnSave={connectOnSave} saved={p=>{if(connectOnSave)void connect(p,'terminal');}} close={()=>{setForm(null);setConnectOnSave(false);}}/>}
  {groupParent!==null&&<GroupDialog parent={groupParent} groups={groups} close={()=>setGroupParent(null)} save={path=>{const next=[...extraGroups,path];try{localStorage.setItem('hornet.connection.groups',JSON.stringify(next));setExtraGroups(next);setRevealGroup(path);setGroupParent(null);setQuery('');}catch(e){s.fail(e);}}}/>}
  {s.challenges[0]&&<ChallengeDialog key={s.challenges[0].challengeId} challenge={s.challenges[0]}/>}
 </div>;
}
function ProfileDialog({profile,groups,close,saved,connectOnSave}:{profile:Profile;groups:string[];close:()=>void;saved:(profile:Profile)=>void;connectOnSave:boolean}){
 const profiles=useStore(s=>s.profiles);
 const [p,setP]=useState(profile),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [password,setPassword]=useState(''),[savePassword,setSavePassword]=useState(true),[passwordSaved,setPasswordSaved]=useState(false);
 useEffect(()=>{let active=true;if(profile.revision)void window.hornet.profiles.credentialStatus(profile.profileId).then(status=>{if(active)setPasswordSaved(status.saved);}).catch(()=>{});return()=>{active=false;};},[profile.profileId,profile.revision]);
 const field=(key:keyof Profile,value:string|number)=>setP({...p,[key]:value});
 async function save(){setBusy(true);try{const clean=profileSchema.parse({...p,group:groupPath(p.group)});const credential=clean.protocol==='telnet'||clean.authType!=='password'||!savePassword?{mode:'remove' as const}:password?{mode:'save' as const,password}:{mode:'keep' as const};const result=await window.hornet.profiles.save(clean,profile.revision,credential);setPassword('');await refreshProfiles();close();saved(result);}catch(e){setError(e instanceof Error?e.message:tr("无法保存"));}finally{setBusy(false);}}
 return <div className="modal-backdrop"><form className="modal profile-dialog" onSubmit={e=>{e.preventDefault();void save();}}><div className="modal-heading"><h2>{profile.revision?tr("编辑连接"):tr("新建连接")}</h2><button type="button" disabled={busy} onClick={close}>×</button></div><p className="muted">{tr("用户名保存在连接配置中，密码使用系统加密存储。")}</p>
  <label>{tr("协议")}<select aria-label={tr("连接协议")} value={p.protocol??'ssh'} onChange={e=>setP({...p,protocol:e.target.value as Profile['protocol'],ftpSecurity:e.target.value==='ftp'?'explicit':undefined,authType:e.target.value==='ftp'?'password':p.authType,jumpProfileIds:e.target.value==='ssh'?p.jumpProfileIds:[],port:[21,22,23,990].includes(p.port)?(e.target.value==='telnet'?23:e.target.value==='ftp'?21:22):p.port})}><option value="ssh">SSH / SFTP</option><option value="ftp">FTP / FTPS</option><option value="telnet">{tr("Telnet（明文）")}</option></select></label>
  <label>{tr("名称")}<input required autoFocus value={p.name} onChange={e=>field('name',e.target.value)}/></label>
  <div className="form-row"><label>{tr("主机")}<input required placeholder="192.168.1.10" value={p.host} onChange={e=>field('host',e.target.value)}/></label><label className="port">{tr("端口")}<input required type="number" min={1} max={65535} value={p.port} onChange={e=>field('port',Number(e.target.value))}/></label></div>
  <label>{p.protocol==='telnet'?tr("用户名备注（不自动登录）"):tr("用户名")}<input required={p.protocol!=='telnet'} value={p.username} onChange={e=>field('username',e.target.value)}/></label>
  <label>{tr("说明")}<input maxLength={2048} value={p.description??''} onChange={e=>field('description',e.target.value)}/></label>
  <label>{tr("分组")}<input list="connection-group-options" maxLength={128} placeholder={tr("例如：生产环境/北京/数据库")} value={p.group} onChange={e=>field('group',e.target.value)}/></label><datalist id="connection-group-options">{groups.map(path=><option key={path} value={path}/>)}</datalist><p className="muted">{tr("选择已有分组，或用 / 分隔创建多级子分组。")}</p>
  {p.protocol==='telnet'?<p className="muted">{tr("Telnet 使用明文连接；用户名和密码在远端登录提示中手动输入，不使用 SSH 凭据库。")}</p>:<label hidden={p.protocol==='ftp'}>{tr("认证方式")}<select value={p.authType} onChange={e=>field('authType',e.target.value)}><option value="password">{tr("密码 / 交互认证")}</option><option value="privateKey">{tr("私钥文件")}</option><option value="agent">{tr("系统 SSH Agent")}</option></select></label>}
  {p.protocol!=='telnet'&&p.authType==='password'&&<fieldset className="profile-credentials"><legend>{tr('用户身份验证')}</legend><label>{tr('密码')}<input aria-label={tr('连接密码')} type="password" maxLength={16384} autoComplete="new-password" disabled={!savePassword||busy} value={password} onChange={e=>setPassword(e.target.value)}/></label><label className="checkbox"><input type="checkbox" checked={savePassword} disabled={busy} onChange={e=>setSavePassword(e.target.checked)}/>{tr('保存密码')}</label><p className="muted">{passwordSaved?tr('已保存密码，留空保持不变。'):tr('密码留空时，在连接时询问。')}{tr('修改主机、端口或用户名后需重新输入密码。')}</p></fieldset>}
  {p.protocol==='ftp'?<><label>{tr('FTP 连接安全')}<select aria-label={tr('FTP 连接安全')} value={p.ftpSecurity??'explicit'} onChange={e=>setP({...p,ftpSecurity:e.target.value as Profile['ftpSecurity'],port:[21,990].includes(p.port)?(e.target.value==='implicit'?990:21):p.port})}><option value="explicit">{tr('FTPS · 显式 TLS（推荐）')}</option><option value="implicit">{tr('FTPS · 隐式 TLS')}</option><option value="none">{tr('FTP · 明文')}</option></select></label><p className="muted">{tr('被动模式，UTF-8 文件名。FTPS 严格校验证书；普通 FTP 的密码和文件均为明文。')}</p></>:<EncodingSelect value={p.encoding} change={encoding=>setP({...p,encoding})}/>} 
  {(p.protocol??'ssh')==='ssh'&&<JumpRouteEditor profile={p} profiles={profiles} change={jumpProfileIds=>setP({...p,jumpProfileIds})}/>}
  {error&&<p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" onClick={close}>{tr("取消")}</button><button className="primary" disabled={busy}>{connectOnSave?tr("保存并连接"):tr("保存配置")}</button></div>
 </form></div>;
}
function ChallengeDialog({challenge:c}:{challenge:Extract<HornetEvent,{type:'challenge'}>}){
 const copy=challengeCopy(c);
 const [secret,setSecret]=useState(''),[remember,setRemember]=useState(false),[busy,setBusy]=useState(false);
 async function respond(value:string){setBusy(true);try{if(c.kind==='trust')await window.hornet.auth.trust(c.challengeId,value==='accept'?'accept':'reject');else await window.hornet.auth.respond(c.challengeId,value,remember);setSecret('');}catch(e){useStore.getState().fail(e);}finally{setBusy(false);}}
 return <div className="modal-backdrop"><form className="modal" onSubmit={e=>{e.preventDefault();void respond(secret);}}><div className="modal-heading"><h2>{copy.title}</h2><button type="button" aria-label={tr("取消认证")} onClick={()=>void window.hornet.auth.cancel(c.challengeId).catch(useStore.getState().fail)}>×</button></div><pre className="challenge-info">{copy.message}</pre>
  {c.kind==='trust'?<div className="modal-actions"><button type="button" disabled={busy} onClick={()=>void respond('reject')}>{tr("拒绝连接")}</button><button type="button" className="primary" disabled={busy} onClick={()=>void respond('accept')}>{tr("已核对，信任此主机")}</button></div>:c.kind==='privateKey'?<button type="button" className="primary" onClick={()=>void window.hornet.auth.chooseKey(c.challengeId).catch(useStore.getState().fail)}>{tr("选择本地私钥文件")}</button>:<>
   <label>{c.kind==='passphrase'?tr("口令（可留空）"):tr("认证信息")}<input aria-label={tr("认证信息")} autoFocus type={c.echo?'text':'password'} value={secret} onChange={e=>setSecret(e.target.value)} autoComplete="off"/></label>
   {c.kind==='password'&&<label className="checkbox"><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/>{tr("认证成功后保存到系统保护的凭据库")}</label>}
   <div className="modal-actions"><button className="primary" disabled={busy}>{tr("继续连接")}</button></div>
  </>}
 </form></div>;
}
