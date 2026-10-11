import { t as tr } from './i18n';
import { useWorkspaceCommands } from './workspace-commands';
import { useEffect,useState } from 'react';
import { readX11Presets,writeX11Presets,x11PresetSchema } from './x11-presets';
import { useStore } from './store';
import type { X11Status,X11Session,XServerEngine,XdmcpSession } from '../../../packages/contracts/native';
const labels:Record<X11Session['state'],string>={preparing:'准备显示',startingServer:'启动独立 X Server',connecting:'连接 SSH',launching:'启动命令',running:'运行中','command-exited':'命令已退出，已有转发保留',failed:'已失败'};
const xdmcpLabels:Record<XdmcpSession['state'],string>={querying:'查询服务器',starting:'启动桌面窗口','awaiting-login':'请在独立窗口登录',closed:'已关闭',failed:'已失败'};
export function X11Panel(){
 const [page,setPage]=useState<'applications'|'desktops'|'settings'>('applications');
 const [presets,setPresets]=useState(readX11Presets),[presetId,setPresetId]=useState(''),[presetName,setPresetName]=useState('');
 const profiles=useStore(s=>s.profiles).filter(p=>(p.protocol??'ssh')==='ssh'),fail=useStore(s=>s.fail);
 const [x,setX]=useState<X11Status>({configured:false,display:0,sessions:[]}),[engine,setEngine]=useState<XServerEngine>({configured:false}),[desktops,setDesktops]=useState<XdmcpSession[]>([]);
 const [interfaces,setInterfaces]=useState<{name:string;address:string}[]>([]),[busy,setBusy]=useState(false);
 const [kind,setKind]=useState('managed'),[network,setNetwork]=useState(false),[profileId,setProfile]=useState(''),[command,setCommand]=useState('xclock'),[display,setDisplay]=useState(0),[dpi,setDpi]=useState(96),[mode,setMode]=useState<'multiWindow'|'singleWindow'>('multiWindow');
 const [host,setHost]=useState(''),[localAddress,setLocal]=useState(''),[port,setPort]=useState(177),[desktopDisplay,setDesktopDisplay]=useState(20),[unencrypted,setUnencrypted]=useState(false),[query,setQuery]=useState('');
 const selected=profiles.some(p=>p.profileId===profileId)?profileId:profileId?'':profiles[0]?.profileId??'';
 const local=interfaces.some(i=>i.address===localAddress)?localAddress:interfaces.find(i=>i.address!=='127.0.0.1')?.address??interfaces[0]?.address??'';
 const active=x.sessions.filter(s=>s.state!=='failed'),externalActive=active.some(s=>!s.managed);
 const refresh=async()=>{const [status,engine,desktops]=await Promise.all([window.hornet.x11.status(),window.hornet.x11.engine(),window.hornet.xdmcp.list()]);setX(status);setEngine(engine);setDesktops(desktops);};
 useEffect(()=>{
   let live=true,timer:ReturnType<typeof setTimeout>;
   const poll=async()=>{try{const [status,engine,desktops,interfaces]=await Promise.all([window.hornet.x11.status(),window.hornet.x11.engine(),window.hornet.xdmcp.list(),window.hornet.xdmcp.interfaces()]);if(live){setX(status);setEngine(engine);setDesktops(desktops);setInterfaces(interfaces);}}catch(error){if(live)fail(error);}finally{if(live)timer=setTimeout(poll,1500);}};
   void poll();return()=>{live=false;clearTimeout(timer);};
 },[]);
 async function run(action:()=>Promise<unknown>){setBusy(true);try{await action();}catch(error){fail(error);}finally{await refresh().catch(fail);setBusy(false);}}
 function savePreset(copy=false){try{const value=x11PresetSchema.parse({id:copy||!presetId?crypto.randomUUID():presetId,name:presetName,profileId:selected,command,kind,display,dpi,mode});const next=[...presets.filter(p=>p.id!==value.id),value];writeX11Presets(next);setPresets(next);setPresetId(value.id);}catch(e){fail(e);}}
 function choosePreset(id:string){setPresetId(id);const p=presets.find(p=>p.id===id);if(p){setPresetName(p.name);setProfile(p.profileId);setCommand(p.command);setKind(p.kind);setDisplay(p.display);setDpi(p.dpi);setMode(p.mode);setNetwork(false);}}
 useEffect(()=>{useWorkspaceCommands.getState().publish('tool:x11',{
  new:()=>{setPage('applications');setPresetId('');setPresetName('');},
  save:!selected||!presetName.trim()?undefined:()=>savePreset(),saveAs:!selected||!presetName.trim()?undefined:()=>savePreset(true),
  settings:()=>setPage('settings'),applications:()=>setPage('applications'),desktops:()=>setPage('desktops'),refresh:()=>void refresh().catch(fail)
 });});
 useEffect(()=>()=>useWorkspaceCommands.getState().remove('tool:x11'),[]);
 const engineBusy=active.length>0||desktops.some(s=>s.state!=='failed'&&s.state!=='closed');
 return <>
 <nav className="tool-subnav" aria-label={tr("X11 页面")}><button aria-pressed={page==='applications'} onClick={()=>setPage('applications')}>{tr("图形应用")}</button><button aria-pressed={page==='desktops'} onClick={()=>setPage('desktops')}>{tr("XDMCP 桌面")}</button><button aria-pressed={page==='settings'} onClick={()=>setPage('settings')}>{tr("显示设置")}</button></nav>
 <div className="x11-engine-summary"><span aria-label={tr("X Server 引擎状态")}>{engine.configured?tr("已配置 VcXsrv ")+engine.version:tr("尚未配置受管理引擎")}</span><button onClick={()=>setPage('settings')}>{tr("配置引擎")}</button></div>
 <label className="x11-listener"><input type="checkbox" checked={network} onChange={e=>setNetwork(e.target.checked)}/>{tr("允许 VcXsrv 网络监听（本机 IPv4 接口，cookie 认证）")}</label>
 <div className="native-section" hidden={page!=='settings'}><h3>{tr("X Server 引擎 · 独立显示")}</h3>
  <p className="muted">{tr("受管理模式自动启动 VcXsrv，为每个会话分配独立进程、显示号与认证 cookie，关闭时回收。剪贴板关闭，最多 8 个显示；图形窗口独立于工作台。")}</p>
  <button disabled={busy||engineBusy} onClick={()=>void run(async()=>{const value=await window.hornet.x11.chooseEngine();if(value){setEngine(value);useStore.getState().setCapabilities(await window.hornet.capabilities());}})}>{tr("选择 VcXsrv 引擎")}</button>
  {engine.path&&<p className="muted">{engine.path}</p>}
  <p className="muted">{tr("VcXsrv 无法仅绑定回环接口。请用系统防火墙限制来源；程序不会修改防火墙。不同显示的 cookie 不通用。")}</p>
 </div>
 <div className="native-section" hidden={page!=='applications'}><h3>{tr("SSH X11 · 图形应用")}</h3>
  <div className="tunnel-form"><label>{tr("启动预设")}<select aria-label={tr("X11 启动预设")} value={presetId} onChange={e=>choosePreset(e.target.value)}><option value="">{tr("未选择预设")}</option>{presets.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>{tr("预设名称")}<input aria-label={tr("X11 预设名称")} maxLength={80} value={presetName} onChange={e=>setPresetName(e.target.value)}/></label><div><button disabled={!selected||!presetName.trim()} onClick={()=>savePreset()}>{tr("保存启动预设")}</button><button disabled={!presetId||!presetName.trim()} onClick={()=>savePreset(true)}>{tr("另存预设")}</button><button disabled={!presetId} onClick={()=>{try{const next=presets.filter(p=>p.id!==presetId);writeX11Presets(next);setPresets(next);setPresetId('');}catch(e){fail(e);}}}>{tr("删除预设")}</button></div></div>
  {presetId&&!profiles.some(p=>p.profileId===presets.find(p=>p.id===presetId)?.profileId)&&<p role="alert">{tr("预设对应的 SSH 连接已删除，请重新选择主机并保存。")}</p>}
  <div className="tunnel-form"><label>{tr("显示管理")}<select aria-label={tr("X11 显示管理")} value={kind} onChange={e=>setKind(e.target.value)}><option value="managed">{tr("自动管理 · 独立显示")}</option><option value="external">{tr("外部 X Server · 手动配置")}</option></select></label>
  {kind==='managed'?<><label>{tr("窗口模式")}<select aria-label={tr("X11 窗口模式")} value={mode} onChange={e=>setMode(e.target.value as typeof mode)}><option value="multiWindow">{tr("多窗口")}</option><option value="singleWindow">{tr("单窗口")}</option></select></label><label>DPI<input aria-label="X11 DPI" type="number" min={72} max={240} value={dpi} onChange={e=>setDpi(Number(e.target.value))}/></label></>:
  <><label>{tr("本地显示号")}<input aria-label={tr("本地显示号")} type="number" min={0} max={99} disabled={engineBusy} value={display} onChange={e=>setDisplay(Number(e.target.value))}/></label><button disabled={busy||engineBusy} onClick={()=>void run(async()=>{await window.hornet.x11.configure(display);useStore.getState().setCapabilities(await window.hornet.capabilities());})}>{tr("选择 Xauthority")}</button><span>{x.configured?tr("已配置显示 :")+x.display+(x.display!==display?tr("；请为选定显示重新选择 Xauthority"):''):tr("尚未配置外部显示认证")}</span></>}
  </div>
  <form className="tunnel-form" onSubmit={e=>{e.preventDefault();void run(()=>window.hornet.x11.launch(selected,command,kind==='managed'?{mode,dpi,allowNetworkListener:true}:undefined));}}>
   <label>{tr("SSH 主机")}<select aria-label={tr("X11 SSH 主机")} value={selected} onChange={e=>setProfile(e.target.value)}>{!profiles.length&&<option value="">{tr("请先创建 SSH 主机")}</option>}{profiles.map(p=><option value={p.profileId} key={p.profileId}>{p.name}</option>)}</select></label>
   <label>{tr("远端启动命令")}<input aria-label={tr("X11 启动命令")} required maxLength={4096} value={command} onChange={e=>setCommand(e.target.value)}/></label>
   <button className="primary" disabled={busy||!selected||active.length>=8||(kind==='managed'?(!engine.configured||!network):(!x.configured||x.display!==display||externalActive))}>{tr("执行命令并转发 X11")}</button>
  </form>
  <div className="tunnel-list" aria-label={tr("X11 会话")}>{x.sessions.map(s=><article className="tunnel-row" key={s.id}><div><strong>{profiles.find(p=>p.profileId===s.profileId)?.name??s.profileId}</strong><p>{s.command}</p><p>{tr(labels[s.state])} · {s.managed?tr("独立显示"):tr("外部显示")} {s.display===undefined?tr("分配中"):':'+s.display} · {s.activeChannels}{tr("个活动通道")}{s.exitCode!==undefined?tr(" · 退出码 ")+s.exitCode:''}{s.signal?tr(" · 信号 ")+s.signal:''}</p>{s.error&&<p role="status">{s.error}</p>}</div><button onClick={()=>{void window.hornet.x11.stop(s.id).then(refresh).catch(fail);}}>{s.state==='failed'?tr("移除记录"):tr("停止 X11 会话")}</button></article>)}</div>
 </div>
 <div className="native-section" hidden={page!=='desktops'}><h3>{tr("XDMCP · 局域网桌面（实验）")}</h3>
  <p className="muted">{tr("指定一个私网 IPv4 显示管理器，先查询再打开独立桌面窗口。XDMCP 不经过 SSH、流量未加密；需要服务器启用 XDMCP，并允许服务器回连所选显示端口。查询响应不表示登录成功。")}</p>
  <form className="tunnel-form" onSubmit={e=>{e.preventDefault();void run(()=>window.hornet.xdmcp.open({host,localAddress:local,port,display:desktopDisplay,dpi,allowUnencrypted:true,allowNetworkListener:true}));}}>
   <label>{tr("服务器 IPv4")}<input aria-label={tr("XDMCP 服务器")} required value={host} onChange={e=>{setHost(e.target.value);setQuery('');}}/></label>
   <label>{tr("本地接口")}<select aria-label={tr("XDMCP 本地接口")} required value={local} onChange={e=>{setLocal(e.target.value);setQuery('');}}>{interfaces.map(i=><option key={i.name+i.address} value={i.address}>{i.name} · {i.address}</option>)}</select></label>
   <label>{tr("UDP 端口")}<input aria-label={tr("XDMCP UDP 端口")} type="number" min={1} max={65535} required value={port} onChange={e=>setPort(Number(e.target.value))}/></label>
   <label>{tr("桌面显示号")}<input aria-label={tr("XDMCP 显示号")} type="number" min={10} max={99} required value={desktopDisplay} onChange={e=>setDesktopDisplay(Number(e.target.value))}/></label>
   <button type="button" disabled={busy||!host||!local} onClick={()=>void run(async()=>{setQuery('');const reply=await window.hornet.xdmcp.query(host,local,port);setQuery((reply.willing?tr("服务器可接受请求"):tr("服务器拒绝请求"))+' · '+reply.hostname+' · '+reply.status);})}>{tr("查询 XDMCP")}</button>
   <button className="primary" disabled={busy||!engine.configured||!network||!unencrypted||!local}>{tr("打开 XDMCP 桌面")}</button>
  </form>
  <label><input type="checkbox" checked={unencrypted} onChange={e=>setUnencrypted(e.target.checked)}/>{tr("我确认使用可信局域网或 VPN，允许未加密 XDMCP 直连")}</label>
  {query&&<p role="status">{query}</p>}
  <div className="tunnel-list" aria-label={tr("XDMCP 会话")}>{desktops.map(s=><article className="tunnel-row" key={s.id}><div><strong>{s.host}{tr("· 显示 :")}{s.display}</strong><p>{tr(xdmcpLabels[s.state])}</p>{s.error&&<p role="status">{s.error}</p>}</div><button onClick={()=>void window.hornet.xdmcp.close(s.id).then(refresh).catch(fail)}>{tr("停止 XDMCP 会话")}</button></article>)}</div>
 </div></>;
}
