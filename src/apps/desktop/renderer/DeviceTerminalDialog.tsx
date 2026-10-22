import { EncodingSelect } from './EncodingSelect';
import { t as tr } from './i18n';
import { useEffect,useState } from 'react';
import { localTerminalSchema,serialTerminalSchema,type LocalTerminalConfig,type SerialTerminalConfig,type SerialDevice } from '../../../packages/contracts/device-terminal';
import { addDeviceView } from './store';
const defaultLocal:LocalTerminalConfig={shell:'powershell',cwd:'',cols:120,rows:36};
const defaultSerial:SerialTerminalConfig={path:'COM1',baudRate:115200,dataBits:8,stopBits:1,parity:'none',flowControl:'none',newline:'cr',localEcho:false,cols:120,rows:36};
function remembered<T>(key:string,schema:{parse(value:unknown):T},fallback:T):T{try{return schema.parse(JSON.parse(localStorage.getItem(key)??''));}catch{return fallback;}}
export function DeviceTerminalDialog({kind,close}:{kind:'local'|'serial';close:()=>void}){
 const [local,setLocal]=useState(()=>remembered('hornet.localTerminal',localTerminalSchema,defaultLocal));
 const [serial,setSerial]=useState(()=>remembered('hornet.serialTerminal',serialTerminalSchema,defaultSerial));
 const [shells,setShells]=useState<{id:LocalTerminalConfig['shell'];name:string}[]>([]),[ports,setPorts]=useState<SerialDevice[]>([]);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
 async function refresh(){setLoading(true);setError('');try{setPorts(await window.hornet.serialTerminal.list());}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setLoading(false);}}
 useEffect(()=>{let cancelled=false;const load=kind==='local'?window.hornet.localTerminal.shells().then(value=>{if(!cancelled)setShells(value);}):window.hornet.serialTerminal.list().then(value=>{if(!cancelled)setPorts(value);});void load.catch(e=>{if(!cancelled)setError(e instanceof Error?e.message:String(e));}).finally(()=>{if(!cancelled)setLoading(false);});return()=>{cancelled=true;};},[kind]);
 async function submit(){setBusy(true);setError('');try{
  const config=kind==='local'?localTerminalSchema.parse(local):serialTerminalSchema.parse(serial);
  const session=kind==='local'?await window.hornet.localTerminal.open(config as LocalTerminalConfig):await window.hornet.serialTerminal.open(config as SerialTerminalConfig);
  addDeviceView(session);try{localStorage.setItem(kind==='local'?'hornet.localTerminal':'hornet.serialTerminal',JSON.stringify(config));}catch{}
  close();
 }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
 return <div className="modal-backdrop"><form className="modal device-terminal-dialog" role="dialog" aria-modal="true" aria-label={kind==='local'?tr("本地终端"):tr("串口终端")} onSubmit={e=>{e.preventDefault();void submit();}}>
  <h2>{kind==='local'?tr("打开本地终端"):tr("打开串口终端")}</h2>
  <fieldset disabled={busy||loading}>
  {kind==='local'?<>
   <label>{tr("本地 Shell")}<select value={local.shell} onChange={e=>setLocal({...local,shell:e.target.value as LocalTerminalConfig['shell']})}>{shells.map(shell=><option key={shell.id} value={shell.id}>{tr(shell.name)}</option>)}</select></label>
   <label>{tr("起始目录")}<input placeholder={tr("留空使用当前用户目录")} value={local.cwd??''} onChange={e=>setLocal({...local,cwd:e.target.value})}/></label>
   <p className="muted">{tr("使用当前 Windows 账户启动独立交互终端。关闭标签会结束此终端及其控制台进程；不会加载 PowerShell 配置文件或 CMD AutoRun。")}</p>
   {!loading&&!shells.length&&<p role="status">{tr("未找到可用的 Windows ConPTY Shell。")}</p>}
  </>:<>
   <div className="serial-port-row"><label>{tr("串口端口")}<input required list="hornet-serial-ports" pattern="[Cc][Oo][Mm][1-9][0-9]{0,4}" value={serial.path} onChange={e=>setSerial({...serial,path:e.target.value.toUpperCase()})}/><datalist id="hornet-serial-ports">{ports.map(port=><option key={port.path} value={port.path}>{port.manufacturer??tr("串口设备")}</option>)}</datalist></label><button type="button" onClick={()=>void refresh()}>{tr("刷新端口")}</button></div>
   <p className="muted">{ports.length?tr("检测到：")+ports.map(p=>p.path+(p.manufacturer?'（'+p.manufacturer+'）':'')).join('、'):tr("未检测到端口，可手动输入 COM 编号。")}</p>
   <div className="device-settings-grid">
    <label>{tr("波特率")}<input type="number" required min={50} max={4000000} list="serial-baud-rates" value={serial.baudRate} onChange={e=>setSerial({...serial,baudRate:Number(e.target.value)})}/><datalist id="serial-baud-rates">{[9600,19200,38400,57600,115200,230400,460800,921600].map(v=><option key={v} value={v}/>)}</datalist></label>
    <label>{tr("数据位")}<select aria-label={tr("数据位")} value={serial.dataBits} onChange={e=>setSerial({...serial,dataBits:Number(e.target.value) as SerialTerminalConfig['dataBits']})}>{[5,6,7,8].map(v=><option key={v}>{v}</option>)}</select></label>
    <label>{tr("停止位")}<select aria-label={tr("停止位")} value={serial.stopBits} onChange={e=>setSerial({...serial,stopBits:Number(e.target.value) as SerialTerminalConfig['stopBits']})}>{[1,1.5,2].map(v=><option key={v}>{v}</option>)}</select></label>
    <label>{tr("校验位")}<select aria-label={tr("校验位")} value={serial.parity} onChange={e=>setSerial({...serial,parity:e.target.value as SerialTerminalConfig['parity']})}>{[['none',tr("无")],['even',tr("偶校验")],['odd',tr("奇校验")],['mark',tr("标记")],['space',tr("空格")]].map(([v,label])=><option key={v} value={v}>{label}</option>)}</select></label>
    <label>{tr("流控")}<select aria-label={tr("流控")} value={serial.flowControl} onChange={e=>setSerial({...serial,flowControl:e.target.value as SerialTerminalConfig['flowControl']})}><option value="none">{tr("无")}</option><option value="rtscts">RTS/CTS</option><option value="xonxoff">XON/XOFF</option></select></label>
    <label>{tr("发送换行")}<select aria-label={tr("发送换行")} value={serial.newline} onChange={e=>setSerial({...serial,newline:e.target.value as SerialTerminalConfig['newline']})}><option value="cr">CR</option><option value="lf">LF</option><option value="crlf">CRLF</option></select></label>
   </div>
   <EncodingSelect value={serial.encoding} change={encoding=>setSerial({...serial,encoding})}/>
   <label className="device-echo"><input type="checkbox" checked={serial.localEcho} onChange={e=>setSerial({...serial,localEcho:e.target.checked})}/>{tr("本地回显")}</label>
   <p className="muted">{tr("字符编码、换行和回显需与设备一致。断开后不会自动重连或重发命令。")}</p>
  </>}
  </fieldset>
  {error&&<p className="error" role="alert">{error}</p>}
  <div className="modal-actions"><button type="button" disabled={busy} onClick={close}>{tr("取消")}</button><button className="primary" disabled={busy||loading||kind==='local'&&!shells.some(s=>s.id===local.shell)}>{busy?tr("正在打开…"):tr("打开终端")}</button></div>
 </form></div>;
}
