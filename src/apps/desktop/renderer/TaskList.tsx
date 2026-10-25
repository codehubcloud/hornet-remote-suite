import { t as tr } from './i18n';
import { TransferTable } from './TransferTable';
import { useStore } from './store';
import { formatBytes } from './FileView';
import { useEffect,useRef,useState } from 'react';
import { TransferProgress,transferDuration } from '../../../packages/core/transfer-progress';
const labels:Record<string,string>={queued:'排队',running:'传输中',verifying:'校验中',committing:'提交中',pausing:'正在暂停',paused:'已暂停',cancelling:'正在取消',cancelled:'已取消',succeeded:'已完成',failed:'失败',conflict:'冲突'};
export function TaskList({compact=false}:{compact?:boolean}){return compact?<CompactTasks/>:<TransferTable/>;}
function CompactTasks(){const s=useStore(),[,tick]=useState(0),progress=useRef(new TransferProgress());useEffect(()=>{const timer=setInterval(()=>tick(value=>value+1),500);return()=>clearInterval(timer);},[]);progress.current.prune(s.tasks);return (   <div className="task-body">
    {!s.tasks.length?<div className="no-tasks">{tr("暂无传输任务。上传和下载会在此显示进度。")}</div>:<div className="task-list">{s.tasks.map(t=>{const m=progress.current.sample(t,Date.now());return <div className="task" key={t.taskId} data-task-id={t.taskId}><span className="task-direction">{t.direction==='upload'?'↑':'↓'}</span><div className="task-detail"><strong title={[t.name,t.localPath,t.remotePath].filter(Boolean).join('\n')}>{t.name}</strong><div className="progress" role="progressbar" aria-label={tr('传输进度')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(m.percent)}><i style={{width:m.percent+'%'}}/></div><small title={t.error}>{t.error??(t.verification?tr('校验中')+' · SHA-256 · '+(t.verification.method==='remote'?tr('远端')+' · ':'')+formatBytes(t.verification.bytes)+' / '+formatBytes(t.verification.totalBytes):formatBytes(t.transferredBytes)+' / '+formatBytes(t.totalBytes))}</small><small className="compact-transfer-metrics"><span>{m.percent.toFixed(1)}%</span><span title={tr('速度')}>{m.speed>0?formatBytes(m.speed)+'/s':'—'}</span><span>{tr('剩余时间：{time}',{time:t.state==='succeeded'?'00:00':m.remainingSeconds===undefined?'—':transferDuration(m.remainingSeconds)})}</span></small></div><span className={'task-state '+t.state}>{tr(labels[t.verification?'verifying':t.state])}</span><div className="task-actions">
     {['queued','running','verifying'].includes(t.state)&&<button onClick={()=>void window.hornet.task.pause(t.taskId,t.revision).catch(s.fail)}>{tr("暂停")}</button>}
     {['paused','failed'].includes(t.state)&&<button onClick={()=>void window.hornet.task.resume(t.taskId,t.revision).catch(s.fail)}>{tr("恢复")}</button>}
     {!['succeeded','committing','cancelled'].includes(t.state)&&<button onClick={()=>void window.hornet.task.cancel(t.taskId,t.revision).catch(s.fail)}>{tr("取消")}</button>}
    </div></div>;})}</div>}
   </div>);}
