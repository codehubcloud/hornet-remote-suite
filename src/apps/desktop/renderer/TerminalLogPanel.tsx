import { t as tr,formatDate } from './i18n';
import { useStore } from './store';
import { formatBytes } from './FileView';
import type { TerminalRecording } from '../../../packages/contracts/terminal-recording';
import { useState } from 'react';
import { RecordingPlayback } from './RecordingPlayback';
const labels={starting:'准备中',recording:'正在记录',stopping:'正在写完',stopped:'已停止',failed:'记录失败'};
export function TerminalLogPanel({close}:{close:()=>void}){
 const {logs,views,fail}=useStore();
 const [recording,setRecording]=useState<TerminalRecording|null>(null);
 if(recording)return <RecordingPlayback recording={recording} close={()=>setRecording(null)}/>;
 return <div className="modal-backdrop"><section className="modal terminal-log-dialog" role="dialog" aria-modal="true" aria-label={tr("终端日志管理")}><h2>{tr("终端日志")}</h2>
  <p>{tr("从点击开始后记录终端输出，切换标签不影响写入。文本日志去除显示控制序列；原始日志保留控制序列。所有日志和录制统一为 UTF-8，不是网络原始字节。日志可能包含敏感内容。")}</p>
  <div className="table-scroll"><table><thead><tr><th>{tr("终端 / 开始时间")}</th><th>{tr("格式 / 状态")}</th><th>{tr("文件 / 已接收大小")}</th><th>{tr("操作")}</th></tr></thead><tbody>{[...logs].sort((a,b)=>b.startedAt-a.startedAt).map(log=><tr key={log.id}>
   <td>{views.find(v=>v.terminalId===log.terminalId)?.title??views.find(v=>v.terminalId===log.terminalId)?.profile.name??tr("已关闭的终端")}<br/>{formatDate(log.startedAt)}</td><td>{log.format==='recording'?tr('会话录制'):log.format==='text'?tr("文本"):tr("原始")} · {tr(labels[log.state])}</td><td className="mono">{log.path}<br/>{formatBytes(log.bytes)}{log.error&&<p role="status">{log.error}</p>}</td><td>{['starting','recording'].includes(log.state)&&<button onClick={()=>void window.hornet.terminalLogs.stop(log.id).catch(fail)}>{tr("停止记录")}</button>}{log.format==='recording'&&['stopped','failed'].includes(log.state)&&<button onClick={()=>void window.hornet.terminalLogs.openRecording(log.id).then(setRecording).catch(fail)}>{tr('回放')}</button>}</td>
  </tr>)}</tbody></table>{!logs.length&&<p className="empty">{tr("尚未开始记录。在“编辑”菜单中开始当前终端的日志。")}</p>}</div>
  <p className="footnote">{tr("文本和原始日志最多 100 MiB；带时间的会话录制最多 16 MiB / 10 万事件。回放只支持 .hrec，不包含录制开始前的滚屏。")}</p><div className="modal-actions"><button onClick={()=>void window.hornet.terminalLogs.openRecording().then(setRecording).catch(fail)}>{tr('回放录制文件…')}</button><button onClick={close}>{tr("关闭日志管理")}</button></div>
 </section></div>;
}
