import { useEffect, useState } from 'react';
import { useStore } from './store';
import { X11Panel } from './X11Panel';
import type { PrintStatus, RdpConfig } from '../../../packages/contracts/native';
export function NativePanel(){
 const profiles=useStore(s=>s.profiles),fail=useStore(s=>s.fail);
 const [profileId,setProfile]=useState(''),[host,setHost]=useState('127.0.0.1'),[port,setPort]=useState(5900),[busy,setBusy]=useState(false);
 const [rdp,setRdp]=useState<RdpConfig>({host:'',port:3389,username:'',domain:'',password:''}),[rdpReady,setRdpReady]=useState<boolean|null>(null),[rdpSessions,setRdpSessions]=useState<{id:string;state:string;reason?:number}[]>([]);
 const [print,setPrint]=useState<PrintStatus>({listening:false,jobs:[]}),[printers,setPrinters]=useState<string[]>([]),[printer,setPrinter]=useState(''),[queue,setQueue]=useState('hornet'),[printPort,setPrintPort]=useState(515),[mode,setMode]=useState<'text'|'raw'>('text');
 const [listen,setListen]=useState('127.0.0.1'),[sources,setSources]=useState('127.0.0.1');
 useEffect(()=>{let live=true;const refresh=()=>void Promise.all([window.hornet.print.status(),window.hornet.rdp.list()]).then(([p,r])=>{if(live){setPrint(p);setRdpSessions(r);}}).catch(fail);refresh();const timer=setInterval(refresh,2000);return()=>{live=false;clearInterval(timer);};},[]);
 async function run(action:()=>Promise<unknown>){setBusy(true);try{await action();}catch(e){fail(e);}finally{setBusy(false);}}
 const selected=profileId||profiles[0]?.profileId||'';
 const profileSelect=<label>SSH 主机<select aria-label="图形 SSH 主机" value={selected} onChange={e=>setProfile(e.target.value)}>{!profiles.length&&<option value="">请先创建 SSH 主机</option>}{profiles.map(p=><option value={p.profileId} key={p.profileId}>{p.name}</option>)}</select></label>;
 return <section className="tunnel-panel"><h2>图形桌面与打印</h2><div className="native-section">
  <h3>VNC · 工作台内嵌</h3><p className="muted">通过所选 SSH 主机连接 VNC，目标地址由 SSH 服务器解析。剪贴板不自动同步。</p>
  <form className="tunnel-form" onSubmit={e=>{e.preventDefault();void run(async()=>{const desktop=await window.hornet.vnc.open(selected,host,port);const profile=profiles.find(p=>p.profileId===selected)!;useStore.getState().addView({id:crypto.randomUUID(),kind:'vnc',profile,desktop,connectionId:'',generation:1});});}}>
   {profileSelect}<label>VNC 目标<input aria-label="VNC 目标" required value={host} onChange={e=>setHost(e.target.value)}/></label><label>VNC 端口<input aria-label="VNC 端口" required type="number" min={1} max={65535} value={port} onChange={e=>setPort(Number(e.target.value))}/></label><button className="primary" disabled={busy||!selected}>打开 VNC 桌面</button>
  </form>
 </div><X11Panel/><div className="native-section"><h3>RDP · 受管理独立窗口（实验）</h3><p className="muted">使用 Windows RDP 控件，尚非内嵌标签。要求服务器身份验证并启用 NLA；剪贴板、驱动器和打印重定向关闭。密码只用于本次连接。</p>
  <button disabled={busy} onClick={()=>void run(async()=>{const result=await window.hornet.rdp.probe();setRdpReady(result.available);const store=useStore.getState();store.setCapabilities(store.capabilities.map(c=>c.id==='rdp'?{...c,state:result.available?'experimental':'requires-setup'}:c));})}>检测 RDP 引擎</button><span className="muted"> {rdpReady===null?'尚未探测':rdpReady?'系统控件可用':'系统控件不可用'}</span>
  <form className="tunnel-form" onSubmit={e=>{e.preventDefault();const input={...rdp};setRdp({...rdp,password:''});void run(()=>window.hornet.rdp.open(input));}}>
   <label>RDP 主机<input required value={rdp.host} onChange={e=>setRdp({...rdp,host:e.target.value})}/></label><label>RDP 端口<input required type="number" min={1} max={65535} value={rdp.port} onChange={e=>setRdp({...rdp,port:Number(e.target.value)})}/></label><label>RDP 用户<input required value={rdp.username} onChange={e=>setRdp({...rdp,username:e.target.value})}/></label><label>域<input value={rdp.domain} onChange={e=>setRdp({...rdp,domain:e.target.value})}/></label><label>RDP 密码<input type="password" autoComplete="off" value={rdp.password} onChange={e=>setRdp({...rdp,password:e.target.value})}/></label><button className="primary" disabled={busy||!rdpReady}>打开 RDP 窗口</button>
  </form>{rdpSessions.map(s=><p key={s.id}>{s.state}{s.reason!==undefined?' · 断开代码 '+s.reason:''} <button onClick={()=>void run(()=>window.hornet.rdp.close(s.id))}>关闭 RDP</button></p>)}
 </div><div className="native-section"><h3>LPD 打印中心</h3><p className="muted">默认关闭接收。收到的任务先暂存，点击提交后才进入 Windows 打印队列；“已提交”不代表纸张已输出。仅支持单个数据文件，单任务上限10MiB，总配额100MiB。</p>
  <button disabled={busy} onClick={()=>void run(async()=>{const p=await window.hornet.print.printers();setPrinters(p);setPrinter(p[0]??'');})}>读取系统打印机</button>
  <form className="tunnel-form" onSubmit={e=>{e.preventDefault();void run(async()=>setPrint(await window.hornet.print.start({bindHost:listen,port:printPort,queue,printer,mode,allowedSources:sources.split(/[,，\s]+/).filter(Boolean)})));}}>
   <label>监听接口<input required value={listen} onChange={e=>setListen(e.target.value)}/></label><label>来源 IP 白名单<input required value={sources} onChange={e=>setSources(e.target.value)}/></label><label>LPD 端口<input required type="number" min={0} max={65535} value={printPort} onChange={e=>setPrintPort(Number(e.target.value))}/></label>
   <label>队列名<input required pattern="[A-Za-z0-9_-]{1,64}" value={queue} onChange={e=>setQueue(e.target.value)}/></label><label>系统打印机<select aria-label="系统打印机" required value={printer} onChange={e=>setPrinter(e.target.value)}><option value="">请选择</option>{printers.map(p=><option key={p}>{p}</option>)}</select></label><label>格式<select value={mode} onChange={e=>setMode(e.target.value as 'text'|'raw')}><option value="text">UTF-8 文本</option><option value="raw">RAW（打印机须支持该数据）</option></select></label><button disabled={busy||print.listening||!printer}>启动 LPD 接收</button><button type="button" disabled={busy||!print.listening} onClick={()=>void run(()=>window.hornet.print.stop())}>停止接收</button>
  </form><p>{print.listening?'监听 '+print.config?.bindHost+':'+print.config?.port+' / '+print.config?.queue:'LPD 未监听'}</p>
  <div className="tunnel-list">{print.jobs.map(j=><article className="tunnel-row" key={j.jobId}><div><strong>{j.name}</strong><p>{j.queue} · {j.bytes} 字节 · {j.state}{j.osJobId?' · 系统作业 '+j.osJobId:''}</p>{j.error&&<p>{j.error}</p>}</div><button disabled={busy||j.state!=='held'} onClick={()=>void run(()=>window.hornet.print.submit(j.jobId))}>提交打印</button><button disabled={busy||j.state!=='held'} onClick={()=>void run(()=>window.hornet.print.cancel(j.jobId))}>取消任务</button></article>)}</div>
 </div></section>;
}
