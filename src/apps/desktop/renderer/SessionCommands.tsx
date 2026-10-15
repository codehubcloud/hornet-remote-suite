import { ScriptDialog } from './ScriptDialog';
import { TerminalEncodingDialog } from './TerminalEncodingDialog';
import { t as tr } from './i18n';
import { RecordingPlayback } from './RecordingPlayback';
import type { TerminalRecording } from '../../../packages/contracts/terminal-recording';
import { BroadcastDialog } from './BroadcastDialog';
import { useWorkspaceCommands } from './workspace-commands';
import { MenuBar,type MenuGroup,type MenuItem } from './MenuBar';
import { AppearanceDialog,themeLabels } from './AppearanceDialog';
import { useAppearance,themes } from './appearance';
import { suiteTools,type SuiteTool } from './SuiteWorkspace';
import { DeviceTerminalDialog } from './DeviceTerminalDialog';
import { useEffect,useRef,useState } from 'react';
import { useStore,refreshProfiles,openView,reconnectView,hasRemoteFiles,type View } from './store';
import type { Profile } from '../../../packages/contracts';
import { TerminalLogPanel } from './TerminalLogPanel';
import { TerminalSettings } from './TerminalSettings';
import { terminalAction } from './terminal-preferences';
import { parseQuickAddress } from './quick-connect';

export function SessionCommands({recent,toggleHosts,hostsVisible,openTool,toolTabs,closeTool,create,connect,edit,close,hosts,toggleChrome,collapsed,pending}:{recent:string[];toggleHosts:()=>void;hostsVisible:boolean;openTool:(tool:SuiteTool)=>void;toolTabs:SuiteTool[];closeTool:(tool:SuiteTool)=>void;create:(fields?:Partial<Profile>)=>void;connect:(p:Profile)=>void;edit:(p:Profile)=>void;close:(v:View)=>Promise<boolean>;hosts:()=>void;toggleChrome:()=>void;collapsed:boolean;pending:boolean}){
 const s=useStore(),active=s.views.find(v=>v.id===s.active),terminal=active?.kind==='terminal';
 const workspaceActions=useWorkspaceCommands(s=>s.entries),actions=workspaceActions[s.active]??{},localActions=workspaceActions[s.active+':local']??{};
 const workspaceItem=(label:string,kind:string):MenuItem=>({label,disabled:!actions[kind],action:actions[kind]});
 const recentProfiles=recent.map(id=>s.profiles.find(p=>p.profileId===id)).filter((p):p is Profile=>!!p);
 const appearance=useAppearance(),[appearanceOpen,setAppearanceOpen]=useState(false);
 const [scriptView,setScriptView]=useState<View|null>(null),[encodingView,setEncodingView]=useState<View|null>(null);
 const terminalReady=terminal&&!!active?.terminalId&&!s.closedTerminals[active.terminalId]&&!s.reconnecting[active.id];
 const [recording,setRecording]=useState<TerminalRecording|null>(null);
 const [broadcastOpen,setBroadcastOpen]=useState(false),[batchBusy,setBatchBusy]=useState(false);
 async function closeBatch(others:boolean){if(batchBusy)return;setBatchBusy(true);try{const keep=others?s.active:null;for(const view of [...s.views])if(view.id!==keep&&!await close(view))return;for(const tool of [...toolTabs])if(tool!==keep)closeTool(tool);}finally{setBatchBusy(false);}}
 async function reconnectBatch(){if(batchBusy)return;setBatchBusy(true);try{for(const view of [...s.views])if(view.kind==='terminal'&&!view.source)await reconnectView(view.id);}catch(e){s.fail(e);}finally{setBatchBusy(false);}}
 const [device,setDevice]=useState<'local'|'serial'|null>(null);
 const [settings,setSettings]=useState(false),[logPanel,setLogPanel]=useState(false),[logBusy,setLogBusy]=useState(false);
 const activeLog=s.logs.find(l=>l.terminalId===active?.terminalId&&['starting','recording','stopping'].includes(l.state));
 async function startLog(format:'text'|'raw'|'recording'){if(!active?.terminalId||logBusy)return;setLogBusy(true);try{await window.hornet.terminalLogs.start(active.terminalId,format);}catch(e){s.fail(e);}finally{setLogBusy(false);}}
 const [address,setAddress]=useState(''),[help,setHelp]=useState(false),[about,setAbout]=useState(false);
 const input=useRef<HTMLInputElement>(null);
 const search=()=>window.dispatchEvent(new Event('hornet:terminal-search'));
 const rename=()=>window.dispatchEvent(new Event('hornet:terminal-rename'));
 function quick(){try{
  const matches=s.profiles.filter(p=>p.name===address.trim());
  if(matches.length>1)throw new Error(tr("存在同名连接，请从主机列表选择。"));
  if(matches.length===1){connect(matches[0]);return;}
  const fields=parseQuickAddress(address);create({...fields,name:fields.host});
 }catch(e){s.fail(e);}}
 function cycle(direction:number){const ids=['home',...s.views.map(v=>v.id),...toolTabs],index=ids.indexOf(s.active);s.setActive(ids[(index+direction+ids.length)%ids.length]);}
 const unavailable=(label:string):MenuItem=>({label,disabled:true,unsupported:true});
 const command=(kind:'copy'|'paste'|'selectAll'|'clear'|'export'|'reset')=>{if(active)terminalAction({viewId:active.id,kind});};
 const closeCurrent=()=>{if(active)close(active);else if(toolTabs.includes(s.active as SuiteTool))closeTool(s.active as SuiteTool);};
 const canClose=Boolean(active)||toolTabs.includes(s.active as SuiteTool);
 const split=(direction:'horizontal'|'vertical')=>{s.tileTerminals(direction);s.setActive(s.views.find(v=>v.kind==='terminal')!.id);};
 const logs:MenuItem[]=[{label:tr("开始会话录制"),disabled:!terminal||logBusy||!!activeLog,action:()=>void startLog('recording')},{label:tr("回放录制文件…"),action:()=>void window.hornet.terminalLogs.openRecording().then(setRecording).catch(s.fail)},{label:tr("开始持续文本日志"),disabled:!terminal||logBusy||!!activeLog,action:()=>void startLog('text')},{label:tr("开始原始终端日志"),disabled:!terminal||logBusy||!!activeLog,action:()=>void startLog('raw')},{label:tr("停止当前日志"),disabled:!activeLog,action:()=>{if(activeLog)void window.hornet.terminalLogs.stop(activeLog.id).catch(s.fail);}},{label:tr("终端日志管理"),action:()=>setLogPanel(true)}];
 const fileItems:MenuItem[]=[
  {label:tr("新建…"),shortcut:'Alt+N',action:()=>create()},{label:tr("打开…"),shortcut:'Alt+O',action:hosts},
  {label:tr("断开"),separator:true,disabled:!terminal,action:()=>{if(active?.terminalId)void window.hornet.terminal.close(active.terminalId).catch(s.fail);}},
  {label:tr("重新连接"),disabled:!terminal||!!active?.source||pending||batchBusy||!!s.reconnecting[active?.id??''],action:()=>{if(active)void reconnectView(active.id).catch(s.fail);}},{label:tr("重新连接所有"),disabled:batchBusy||pending||Object.values(s.reconnecting).some(Boolean)||!s.views.some(v=>v.kind==='terminal'&&!v.source),action:()=>void reconnectBatch()},
  {label:tr("将活动会话另存为…"),separator:true,disabled:!active||!!active.source,action:()=>{if(active)edit({...active.profile,profileId:crypto.randomUUID(),revision:0,name:active.profile.name+tr(" 副本")});}},
  {label:tr("导入…"),action:()=>void window.hornet.profiles.import().then(refreshProfiles).catch(s.fail)},{label:tr("导出…"),action:()=>void window.hornet.profiles.export().catch(s.fail)},
  {...unavailable(tr("打印…")),separator:true},unavailable(tr("打印预览")),unavailable(tr("页面设置…")),
  {label:tr("传输"),separator:true,children:[{label:tr("打开文件"),disabled:!active||!hasRemoteFiles(active),action:()=>{if(active)void openView(active.profile,'files').catch(s.fail);}},unavailable(tr("发送 ZMODEM…")),unavailable(tr("接收 ZMODEM…"))]},
  {label:tr("日志"),children:logs},
  {label:tr("当前会话属性"),separator:true,disabled:!active||!!active.source,action:()=>{if(active)edit(active.profile);}},{label:tr("默认会话属性"),action:()=>setSettings(true)},
  {label:tr("最近的会话"),separator:true,children:recentProfiles.length?recentProfiles.slice(0,10).map(p=>({label:p.name,literal:true,action:()=>connect(p)})):[{label:tr("暂无会话"),disabled:true}]},
  {label:tr("本地终端"),separator:true,action:()=>setDevice('local')},{label:tr("串口终端"),action:()=>setDevice('serial')},
  {label:tr("关闭当前标签"),disabled:!canClose,shortcut:'Ctrl+Shift+F4',action:closeCurrent},{label:tr("退出"),separator:true,action:()=>window.close()}
 ];
 const editItems:MenuItem[]=[{label:tr("复制"),disabled:!terminal,shortcut:'Ctrl+Shift+C',action:()=>command('copy')},unavailable(tr("复制为RTF格式")),{label:tr("粘贴"),disabled:!terminal,shortcut:'Ctrl+Shift+V',action:()=>command('paste')},unavailable(tr("粘贴选择内容")),{label:tr("全选"),separator:true,disabled:!terminal,action:()=>command('selectAll')},unavailable(tr("选择屏幕")),{label:tr("到文本编辑器"),children:[{label:tr("导出终端文本"),disabled:!terminal,action:()=>command('export')}]},{label:tr("查找…"),separator:true,disabled:!terminal,shortcut:'Ctrl+Shift+F',action:search},unavailable(tr("查找下一个")),unavailable(tr("查找上一个")),{label:tr("重置终端"),separator:true,disabled:!terminal,action:()=>command('reset')},{label:tr("清屏"),disabled:!terminal,shortcut:'Ctrl+Shift+L',action:()=>command('clear')},...logs.map((item,i)=>({...item,separator:i===0})),{label:tr("重命名终端"),disabled:!terminal,action:rename}];
 const viewItems:MenuItem[]=[{label:tr("工具栏"),children:[{label:collapsed?tr("展开工具栏"):tr("折叠工具栏"),action:toggleChrome}]},{label:tr("会话管理器"),checked:hostsVisible,action:toggleHosts},{label:tr("快速命令"),disabled:!terminal,action:()=>window.dispatchEvent(new Event('hornet:quick-commands'))},{label:tr("隧道窗格"),action:()=>openTool('tool:tunnels')},unavailable(tr("十六进制查看器")),{label:tr("文件管理器"),disabled:!active||!hasRemoteFiles(active),action:()=>{if(active)void openView(active.profile,'files').catch(s.fail);}},{label:tr("脚本管理器"),disabled:!terminalReady,action:()=>setScriptView(active!)},{label:tr("主题"),separator:true,children:themes.map(theme=>({label:themeLabels[theme],checked:appearance.value.theme===theme,action:()=>{try{appearance.save({...appearance.value,theme});}catch(e){s.fail(e);}}}))},{label:tr("简单"),shortcut:'Alt+S',action:toggleChrome},{label:tr("全屏"),action:()=>{void (document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen()).catch(s.fail);}},{label:tr("工作台"),separator:true,action:()=>s.setActive('home')}];
 const toolsItems:MenuItem[]=[{label:tr("发送键输入到"),disabled:s.views.filter(v=>v.kind==='terminal'&&v.terminalId&&!s.closedTerminals[v.terminalId]).length<2,action:()=>setBroadcastOpen(true)},unavailable(tr("Sun (Solaris) 快捷键")),{...unavailable(tr("主机密钥管理者…")),separator:true},unavailable(tr("用户密钥管理者…")),unavailable(tr("新建用户密钥生成向导…")),unavailable(tr("身份验证配置文件…")),{label:tr("配色方案…"),separator:true,action:()=>setSettings(true)},unavailable(tr("按键对应…")),unavailable(tr("突出显示集…")),unavailable(tr("触发器…")),{label:tr("快速命令管理器"),disabled:!terminal,action:()=>window.dispatchEvent(new Event('hornet:quick-commands'))},{label:tr("终端编码"),disabled:!terminalReady||active?.source==='local',action:()=>setEncodingView(active!)},{label:tr("脚本"),separator:true,disabled:!terminalReady,action:()=>setScriptView(active!)},{label:tr("更改语言…"),separator:true,action:()=>setAppearanceOpen(true)},{label:tr("选项…"),action:()=>setSettings(true)},...suiteTools.filter(t=>t.id!=='tool:capabilities').map((t,i)=>({label:t.name,separator:i===0,action:()=>openTool(t.id)})),{label:tr("锁定凭据库"),action:()=>void window.hornet.auth.lock().catch(s.fail)}];
 const tabItems:MenuItem[]=[{label:tr("新选项卡"),action:()=>s.setActive('home')},unavailable(tr("新选项卡组")),{label:tr("排列"),children:[{label:tr("水平分割"),disabled:s.views.filter(v=>v.kind==='terminal').length<2,action:()=>split('horizontal')},{label:tr("垂直分割"),disabled:s.views.filter(v=>v.kind==='terminal').length<2,action:()=>split('vertical')},{label:tr("取消分屏"),disabled:!s.terminalLayout,action:()=>s.setTerminalLayout(null)}]},{...unavailable(tr("将标签移动到窗口")),separator:true},{label:tr("关闭"),shortcut:'Ctrl+Shift+F4',disabled:!canClose,action:closeCurrent},unavailable(tr("锁")),{label:tr("重命名"),separator:true,disabled:!terminal,action:rename},{label:tr("上一个标签"),separator:true,disabled:!s.views.length&&!toolTabs.length,action:()=>cycle(-1)},{label:tr("下一个标签"),disabled:!s.views.length&&!toolTabs.length,action:()=>cycle(1)}];
 const windowItems:MenuItem[]=[unavailable(tr("新建窗口")),{label:tr("全部关闭"),disabled:batchBusy||(!s.views.length&&!toolTabs.length),action:()=>void closeBatch(false)},{label:tr("除此之外全部关闭"),disabled:batchBusy||!s.views.some(v=>v.id!==s.active)&&!toolTabs.some(id=>id!==s.active),action:()=>void closeBatch(true)},{label:tr("下一步"),separator:true,action:()=>cycle(1)},{label:tr("前一页"),action:()=>cycle(-1)},{...unavailable(tr("层叠")),separator:true},{label:tr("水平分割"),disabled:s.views.filter(v=>v.kind==='terminal').length<2,action:()=>split('horizontal')},{label:tr("垂直分割"),disabled:s.views.filter(v=>v.kind==='terminal').length<2,action:()=>split('vertical')},{label:tr("取消分屏"),disabled:!s.terminalLayout,action:()=>s.setTerminalLayout(null)},...s.views.map(v=>({label:v.title??v.profile.name,literal:true,checked:s.active===v.id,action:()=>s.setActive(v.id)}))];
 const helpItems:MenuItem[]=[{label:tr("Hornet 帮助"),action:()=>setHelp(true)},unavailable(tr("打开帮助PDF")),unavailable(tr("检查更新…")),{label:tr("功能支持情况"),separator:true,action:()=>openTool('tool:capabilities')},{label:tr("关于 Hornet"),action:()=>setAbout(true)}];
 const fileMode=active?.kind==='files',printMode=s.active==='tool:print',x11Mode=s.active==='tool:x11';
 const commonTools:MenuItem[]=[{label:'更改语言…',action:()=>setAppearanceOpen(true)},...suiteTools.filter(t=>t.id!=='tool:capabilities').map((t,i)=>({label:t.name,separator:i===0,action:()=>openTool(t.id)})),{label:'锁定凭据库',action:()=>void window.hornet.auth.lock().catch(s.fail)}];
 const ftpFile:MenuItem[]=[{label:'新建…',shortcut:'Ctrl+N',action:()=>create()},unavailable('新建本地选项卡'),{label:'打开…',separator:true,shortcut:'Ctrl+O',action:hosts},{label:'关闭',disabled:!canClose,action:closeCurrent},...fileItems.filter(i=>['导入…','导出…','当前会话属性','最近的会话','退出'].map(label=>tr(label)).includes(i.label)).map(i=>({...i,separator:true}))];
 const ftpEdit:MenuItem[]=[unavailable('复制'),unavailable('粘贴'),{...workspaceItem('全选','selectAll'),separator:true,shortcut:'Ctrl+A'},{...workspaceItem('查找…','search'),shortcut:'Ctrl+F'}];
 const ftpView:MenuItem[]=[viewItems[0],unavailable('状态栏'),unavailable('传输队列'),unavailable('文件夹树'),viewItems[1],unavailable('会话日志'),viewItems.find(i=>i.label===tr('主题'))!,{...unavailable('大图标'),separator:true},unavailable('小图标'),unavailable('列表'),{label:'详细信息',checked:true,disabled:true},{...workspaceItem('刷新','refresh'),separator:true,shortcut:'F5'}];
 const ftpCommands:MenuItem[]=[{label:'向右传输',disabled:!localActions.upload,action:localActions.upload},workspaceItem('向左传输','download'),{...unavailable('迁移类型'),separator:true},{label:'新建',separator:true,children:[{label:'本地目录',disabled:!localActions.mkdir,action:localActions.mkdir},workspaceItem('远端目录','mkdir')]},workspaceItem('重命名','rename'),workspaceItem('删除','remove'),workspaceItem('更改权限…','chmod'),{...unavailable('FTP命令'),separator:true},unavailable('同步浏览'),{...workspaceItem('上级','up'),separator:true}];
 const ftpTools:MenuItem[]=[unavailable('主机密钥管理者…'),unavailable('用户密钥管理者…'),unavailable('新建用户密钥生成向导…'),unavailable('身份验证配置文件…'),{...unavailable('传输预订'),separator:true},{label:'同步文件夹…',children:[{label:'比较并补齐远端 →',disabled:!localActions.syncUpload,action:localActions.syncUpload},{label:'← 比较并补齐本地',disabled:!localActions.syncDownload,action:localActions.syncDownload},{label:'双向同步…',disabled:!localActions.syncBoth,action:localActions.syncBoth}]},...commonTools];
 const printFile:MenuItem[]=[workspaceItem('新建队列','new'),workspaceItem('删除队列','remove'),{...unavailable('另存为'),separator:true},{...unavailable('打印…'),separator:true},unavailable('打印全部挂起的作业'),{label:'退出',separator:true,action:()=>window.close()}];
 const printView:MenuItem[]=[viewItems[0],unavailable('状态栏'),workspaceItem('所有队列','all'),{...workspaceItem('刷新','refresh'),shortcut:'F5'},viewItems.find(i=>i.label===tr('主题'))!];
 const printQueues:MenuItem[]=[workspaceItem('启用 / 暂停','toggle'),unavailable('设置为默认队列'),{...unavailable('删除所有作业'),separator:true},unavailable('删除全部已完成的作业'),{...workspaceItem('属性','properties'),separator:true}];
 const printTools:MenuItem[]=[unavailable('日志查看器'),workspaceItem('查找','search'),{...workspaceItem('选项','settings'),separator:true},{...workspaceItem('停止接收','stop'),separator:true},...commonTools];
 const x11File:MenuItem[]=[workspaceItem('新建…','new'),workspaceItem('保存启动预设','save'),workspaceItem('另存预设','saveAs'),{...workspaceItem('属性','settings'),separator:true},{label:'关闭当前标签',action:closeCurrent},...fileItems.filter(i=>[tr('本地终端'),tr('串口终端'),tr('退出')].includes(i.label))];
 const x11View:MenuItem[]=[viewItems[0],workspaceItem('图形应用','applications'),workspaceItem('XDMCP 桌面','desktops'),workspaceItem('显示设置','settings'),workspaceItem('刷新','refresh'),viewItems.find(i=>i.label===tr('主题'))!];
 const x11Tools:MenuItem[]=[workspaceItem('显示设置','settings'),workspaceItem('图形应用','applications'),...commonTools];
 const groups:MenuGroup[]=[
  {label:'文件',access:'F',items:printMode?printFile:fileMode?ftpFile:x11Mode?x11File:fileItems},
  ...(!printMode?[{label:'编辑',access:'E',items:fileMode?ftpEdit:x11Mode?[unavailable('复制'),unavailable('粘贴')]:editItems}]:[]),
  {label:'查看',access:'V',items:printMode?printView:fileMode?ftpView:x11Mode?x11View:viewItems},
  ...(fileMode?[{label:'命令',access:'C',items:ftpCommands}]:[]),
  ...(printMode?[{label:'队列',access:'Q',items:printQueues}]:[]),
  {label:'工具',access:'T',items:printMode?printTools:fileMode?ftpTools:x11Mode?x11Tools:toolsItems},
  ...(!printMode&&!fileMode?[{label:'选项卡',access:'B',items:tabItems}]:[]),
  ...(!printMode&&!x11Mode?[{label:'窗口',access:'W',items:windowItems}]:[]),
  {label:'帮助',access:'H',items:helpItems}
 ];
 useEffect(()=>{const key=(event:KeyboardEvent)=>{
  if(event.key==='Escape'){setHelp(false);setAbout(false);return;}
  if(document.querySelector('.modal-backdrop'))return;
  let action:(()=>void)|undefined;
  if(event.altKey&&!event.ctrlKey&&!event.shiftKey){if(event.code==='KeyN')action=()=>create();if(event.code==='KeyO')action=hosts;if(event.code==='KeyS')action=toggleChrome;if(event.code==='KeyD')action=()=>{if(collapsed)toggleChrome();requestAnimationFrame(()=>input.current?.focus());};if(event.code==='ArrowRight')action=()=>cycle(1);if(event.code==='ArrowLeft')action=()=>cycle(-1);}
  if(event.ctrlKey&&event.shiftKey&&!event.altKey){if(event.code==='F4'&&canClose)action=closeCurrent;if(terminal){if(event.code==='KeyC')action=()=>command('copy');if(event.code==='KeyV')action=()=>command('paste');if(event.code==='KeyL')action=()=>command('clear');if(event.code==='KeyF')action=search;}}
  if(event.code==='F5'&&(fileMode||printMode))action=actions.refresh;
  if(fileMode&&event.ctrlKey&&!event.shiftKey&&!event.altKey){if(event.code==='KeyN')action=()=>create();if(event.code==='KeyO')action=hosts;if(!(event.target instanceof HTMLInputElement)&&!(event.target instanceof HTMLTextAreaElement)){if(event.code==='KeyA')action=actions.selectAll;if(event.code==='KeyF')action=actions.search;}}
  if(action){event.preventDefault();event.stopImmediatePropagation();action();}
 };window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true);});
 return <div className="session-commands">
  <MenuBar groups={groups} reveal={collapsed?toggleChrome:undefined}/>
  <div className="standard-toolbar" role="toolbar" aria-label={tr('标准按钮')}>
   <button type="button" title={tr("新建会话")} aria-label={tr("新建会话")} onClick={()=>create()}>＋</button>
   <button type="button" title={tr("打开会话")} aria-label={tr("打开会话")} onClick={hosts}>▱</button>
   <button type="button" title={tr("显示或隐藏主机列表")} aria-label={tr("主机列表")} aria-pressed={hostsVisible} onClick={toggleHosts}>▤</button>
   <span className="toolbar-separator"/><button title={tr('断开')} aria-label={tr('断开')} disabled={!terminal} onClick={()=>{if(active?.terminalId)void window.hornet.terminal.close(active.terminalId).catch(s.fail);}}>⏏</button><button title={tr('重新连接')} aria-label={tr('重新连接')} disabled={!terminal||!!active?.source||pending||batchBusy||!!s.reconnecting[active?.id??'']} onClick={()=>{if(active)void reconnectView(active.id).catch(s.fail);}}>↻</button>
   <span className="toolbar-separator"/><button title={tr('查找终端内容')} aria-label={tr('查找终端内容')} disabled={!terminal} onClick={search}>⌕</button><button title={tr('终端设置')} aria-label={tr('终端设置')} onClick={()=>setSettings(true)}>Aa</button><button title={tr('语言与主题')} aria-label={tr('语言与主题')} onClick={()=>setAppearanceOpen(true)}>◎</button>
   <span className="toolbar-separator"/><button title={tr('打开文件')} aria-label={tr('打开文件管理器')} disabled={!active||!hasRemoteFiles(active)} onClick={()=>{if(active)void openView(active.profile,'files').catch(s.fail);}}>▤</button><button title={tr('本地终端')} aria-label={tr('本地终端')} onClick={()=>setDevice('local')}>›_</button><button title={tr('锁定凭据库')} aria-label={tr('锁定凭据库')} onClick={()=>void window.hornet.auth.lock().catch(s.fail)}>♙</button>
  </div>
  <form className="quick-connect-bar" onSubmit={e=>{e.preventDefault();quick();}}>
   <input ref={input} aria-label={tr("快速连接地址")} list="saved-session-names" placeholder={tr("会话名称或 user@host:port · Alt+D")} value={address} onChange={e=>setAddress(e.target.value)}/>
   <datalist id="saved-session-names">{s.profiles.map(p=><option key={p.profileId} value={p.name}>{p.username}@{p.host}:{p.port}</option>)}</datalist>
   <button disabled={pending||!address.trim()}>{tr("连接")}</button>
  </form>
  {scriptView&&<ScriptDialog view={scriptView} close={()=>setScriptView(null)}/>}
  {encodingView&&<TerminalEncodingDialog view={encodingView} close={()=>setEncodingView(null)}/>}
  {recording&&<RecordingPlayback recording={recording} close={()=>setRecording(null)}/>}
  {broadcastOpen&&<BroadcastDialog close={()=>setBroadcastOpen(false)}/>}
  {appearanceOpen&&<AppearanceDialog close={()=>setAppearanceOpen(false)}/>}
  {device&&<DeviceTerminalDialog kind={device} close={()=>setDevice(null)}/>}
  {logPanel&&<TerminalLogPanel close={()=>setLogPanel(false)}/>}
  {settings&&<TerminalSettings close={()=>setSettings(false)}/>}
  {about&&<div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label={tr('关于 Hornet')}><img src="./logo.png" alt="Hornet Remote Suite" width="72" height="72" style={{display:'block',borderRadius:12,marginBottom:16}}/><h2>Hornet Remote Suite</h2><p>{__APP_VERSION__} · {tr('开发版')}</p><p>{tr('统一远程工作台')}</p><p className="muted">{tr('功能支持范围请查看“功能支持情况”。')}</p><div className="modal-actions"><button onClick={()=>{setAbout(false);openTool('tool:capabilities');}}>{tr('功能支持情况')}</button><button onClick={()=>setAbout(false)}>{tr('关闭')}</button></div></section></div>}
  {help&&<div className="modal-backdrop"><div className="modal" role="dialog" aria-label={tr("快速连接使用说明")}><h2>{tr("快速连接")}</h2><p>{tr("输入已保存的会话名称可直接连接。输入主机、user@host:port 或 ssh://user@host:port、telnet://host:port 会打开预填的连接配置，补充认证设置后保存并连接。IPv6 使用 [地址]:端口。")}</p><p>{tr("Alt+D：聚焦快速连接。Ctrl+Shift+F：搜索终端。右键终端标题：重命名或排列已有终端。")}</p><button onClick={()=>setHelp(false)}>{tr("关闭说明")}</button></div></div>}
 </div>;
}
