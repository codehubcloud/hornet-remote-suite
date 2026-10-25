import { SystemIcon } from './SystemIcon';
import { t as tr } from './i18n';
import { useState } from 'react';
import type { Profile } from '../../../packages/contracts';
import { useStore } from './store';
import { parseQuickAddress } from './quick-connect';
import { TunnelPanel } from './TunnelPanel';
import { NativePanel } from './NativePanel';
import { X11Panel } from './X11Panel';
import { PrintPanel } from './PrintPanel';

export const suiteTools = [
 {id:'tool:x11',name:'X11 图形应用',description:'启动预设、显示设置与 XDMCP'},
 {id:'tool:desktop',name:'远程桌面',description:'VNC 与 RDP 会话'},
 {id:'tool:print',name:'打印中心',description:'LPD 队列与打印任务'},
 {id:'tool:tunnels',name:'端口转发',description:'本地、远程与 SOCKS5'},
 {id:'tool:capabilities',name:'功能支持情况',description:'当前能力与尚未支持的功能'},
] as const;
export type SuiteTool = typeof suiteTools[number]['id'];

export function StartPage({recent,pending,create,connect,openTool}:{recent:string[];pending:boolean;create:(fields?:Partial<Profile>)=>void;connect:(p:Profile,kind:'terminal'|'files')=>void;openTool:(tool:SuiteTool)=>void}){
 const s=useStore(),[address,setAddress]=useState('');
 const sessions=recent.map(id=>s.profiles.find(p=>p.profileId===id)).filter((p):p is Profile=>Boolean(p));
 function quick(){try{const matches=s.profiles.filter(p=>p.name===address.trim());if(matches.length>1)throw new Error(tr("存在同名连接，请从主机列表选择。"));if(matches.length===1){connect(matches[0],'terminal');return;}const fields=parseQuickAddress(address);create({...fields,name:fields.host});}catch(e){s.fail(e);}}
 return <section className="start-page" aria-label={tr("快速开始")}>
  <div className="start-connect"><h1>{tr("快速连接")}</h1><form onSubmit={e=>{e.preventDefault();quick();}}><input autoComplete="off" aria-label={tr("开始页连接地址")} list="saved-session-names" placeholder={tr("主机、IP 地址或会话名称")} value={address} onChange={e=>setAddress(e.target.value)}/><button className="primary" disabled={pending||!address.trim()}>{tr("连接")}</button><button type="button" onClick={()=>create()}>{tr("新建会话")}</button></form><p className="muted">{tr("SSH / SFTP · Telnet · 本地和串口终端可从“文件”菜单打开")}</p></div>
  <div className="start-tools" aria-label={tr("工作区入口")}>{suiteTools.filter(t=>t.id!=='tool:capabilities').map(t=><button key={t.id} onClick={()=>openTool(t.id)}><strong>{tr(t.name)}</strong><small>{tr(t.description)}</small></button>)}</div>
  <section className="recent-sessions"><h2>{tr("最近会话")}</h2>{sessions.length?sessions.slice(0,8).map(p=><div className="recent-session" key={p.profileId}><button disabled={pending} onClick={()=>connect(p,'terminal')}><SystemIcon profile={p}/><strong>{p.name}</strong><small>{p.group} · {p.host}:{p.port}</small></button>{!p.session?.mosh&&!['telnet','rlogin','serial','local','rdp'].includes(p.protocol??'ssh')&&<button disabled={pending} onClick={()=>connect(p,'files')}>{tr("文件")}</button>}</div>):<p className="muted">{tr("从左侧会话树选择连接，或在上方输入地址。")}</p>}</section>
 </section>;
}

export function SuiteWorkspace({tool}:{tool:SuiteTool}){
 const capabilities=useStore(s=>s.capabilities);
 return <section className="suite-workspace" aria-label={tr(suiteTools.find(t=>t.id===tool)!.name)}>
  {tool==='tool:tunnels'&&<TunnelPanel/>}
  {tool==='tool:desktop'&&<NativePanel/>}
  {tool==='tool:x11'&&<><h2>{tr("X11 图形应用")}</h2><X11Panel/></>}
  {tool==='tool:print'&&<PrintPanel/>}
  {tool==='tool:capabilities'&&<><h2>{tr("功能支持情况")}</h2><p className="muted">{tr("下面是当前运行环境的能力检测。入口可见不代表完整兼容 Power Suite 8。")}</p><table><thead><tr><th>{tr("功能")}</th><th>{tr("状态")}</th><th>{tr("范围与限制")}</th></tr></thead><tbody>{capabilities.map(c=><tr key={c.id}><td>{tr(c.name)}</td><td>{{available:tr("可用"),unavailable:tr("尚未支持"),'requires-setup':tr("需配置"),experimental:tr("实验")}[c.state]}</td><td>{tr(c.reason)}</td></tr>)}</tbody></table><h3>{tr("仍需补齐的主要差距")}</h3><ul className="parity-gaps"><li>{tr("会话：SSH 跳板链、脚本自动化、日志回放与更多终端编码。")}</li><li>{tr("文件：FTP / FTPS、双向同步和完整覆盖冲突策略；当前目录同步仅补齐缺失文件。")}</li><li>{tr("图形：当前基于 VcXsrv 独立窗口；尚未覆盖 Xmanager 的全部显示配置和 XDMCP 发现方式。")}</li><li>{tr("打印：已支持多队列接收与手动提交，尚未覆盖全部文本处理及打印策略。")}</li><li>{tr("RDP 使用独立窗口，尚未内嵌；串口和实体打印机仍需设备验收。")}</li></ul></>}
 </section>;
}
