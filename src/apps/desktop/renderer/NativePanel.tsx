import { t as tr } from './i18n';
import { useEffect, useState } from 'react';
import { useStore } from './store';
import type { RdpConfig } from '../../../packages/contracts/native';
export function NativePanel(){
 const profiles=useStore(s=>s.profiles).filter(p=>(p.protocol??'ssh')==='ssh'),fail=useStore(s=>s.fail);
 const [profileId,setProfile]=useState(''),[host,setHost]=useState('127.0.0.1'),[port,setPort]=useState(5900),[busy,setBusy]=useState(false);
 const [rdp,setRdp]=useState<RdpConfig>({host:'',port:3389,username:'',domain:'',password:''}),[rdpReady,setRdpReady]=useState<boolean|null>(null),[rdpSessions,setRdpSessions]=useState<{id:string;state:string;reason?:number}[]>([]);
 useEffect(()=>{let live=true;const refresh=()=>void window.hornet.rdp.list().then(r=>{if(live)setRdpSessions(r);}).catch(fail);refresh();const timer=setInterval(refresh,2000);return()=>{live=false;clearInterval(timer);};},[]);
 async function run(action:()=>Promise<unknown>){setBusy(true);try{await action();}catch(e){fail(e);}finally{setBusy(false);}}
 const selected=profileId||profiles[0]?.profileId||'';
 const profileSelect=<label>{tr("SSH 主机")}<select aria-label={tr("图形 SSH 主机")} value={selected} onChange={e=>setProfile(e.target.value)}>{!profiles.length&&<option value="">{tr("请先创建 SSH 主机")}</option>}{profiles.map(p=><option value={p.profileId} key={p.profileId}>{p.name}</option>)}</select></label>;
 return <section className="tunnel-panel"><h2>{tr("远程桌面")}</h2><div className="native-section">
  <h3>{tr("VNC · 工作台内嵌")}</h3><p className="muted">{tr("通过所选 SSH 主机连接 VNC，目标地址由 SSH 服务器解析。剪贴板不自动同步。")}</p>
  <form className="tunnel-form" onSubmit={e=>{e.preventDefault();void run(async()=>{const desktop=await window.hornet.vnc.open(selected,host,port);const profile=profiles.find(p=>p.profileId===selected)!;useStore.getState().addView({id:crypto.randomUUID(),kind:'vnc',profile,desktop,connectionId:'',generation:1});});}}>
   {profileSelect}<label>{tr("VNC 目标")}<input aria-label={tr("VNC 目标")} required value={host} onChange={e=>setHost(e.target.value)}/></label><label>{tr("VNC 端口")}<input aria-label={tr("VNC 端口")} required type="number" min={1} max={65535} value={port} onChange={e=>setPort(Number(e.target.value))}/></label><button className="primary" disabled={busy||!selected}>{tr("打开 VNC 桌面")}</button>
  </form>
 </div><div className="native-section"><h3>{tr("RDP · 受管理独立窗口（实验）")}</h3><p className="muted">{tr("使用 Windows RDP 控件，尚非内嵌标签。要求服务器身份验证并启用 NLA；剪贴板、驱动器和打印重定向关闭。密码只用于本次连接。")}</p>
  <button disabled={busy} onClick={()=>void run(async()=>{const result=await window.hornet.rdp.probe();setRdpReady(result.available);const store=useStore.getState();store.setCapabilities(store.capabilities.map(c=>c.id==='rdp'?{...c,state:result.available?'experimental':'requires-setup'}:c));})}>{tr("检测 RDP 引擎")}</button><span className="muted"> {rdpReady===null?tr("尚未探测"):rdpReady?tr("系统控件可用"):tr("系统控件不可用")}</span>
  <form className="tunnel-form" onSubmit={e=>{e.preventDefault();const input={...rdp};setRdp({...rdp,password:''});void run(()=>window.hornet.rdp.open(input));}}>
   <label>{tr("RDP 主机")}<input required value={rdp.host} onChange={e=>setRdp({...rdp,host:e.target.value})}/></label><label>{tr("RDP 端口")}<input required type="number" min={1} max={65535} value={rdp.port} onChange={e=>setRdp({...rdp,port:Number(e.target.value)})}/></label><label>{tr("RDP 用户")}<input required value={rdp.username} onChange={e=>setRdp({...rdp,username:e.target.value})}/></label><label>{tr("域")}<input value={rdp.domain} onChange={e=>setRdp({...rdp,domain:e.target.value})}/></label><label>{tr("RDP 密码")}<input type="password" autoComplete="off" value={rdp.password} onChange={e=>setRdp({...rdp,password:e.target.value})}/></label><button className="primary" disabled={busy||!rdpReady}>{tr("打开 RDP 窗口")}</button>
  </form>{rdpSessions.map(s=><p key={s.id}>{s.state}{s.reason!==undefined?tr(" · 断开代码 ")+s.reason:''} <button onClick={()=>void run(()=>window.hornet.rdp.close(s.id))}>{tr("关闭 RDP")}</button></p>)}
 </div></section>;
}
