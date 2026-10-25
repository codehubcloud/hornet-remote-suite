import { t as tr } from './i18n';
import { TransferTable } from './TransferTable';
import { useStore } from './store';
import { formatBytes } from './FileView';
const labels:Record<string,string>={queued:'排队',running:'传输中',verifying:'校验中',committing:'提交中',pausing:'正在暂停',paused:'已暂停',cancelling:'正在取消',cancelled:'已取消',succeeded:'已完成',failed:'失败',conflict:'冲突'};
export function TaskList({compact=false}:{compact?:boolean}){return compact?<CompactTasks/>:<TransferTable/>;}
function CompactTasks(){const s=useStore();return (   <div className="task-body">
    {!s.tasks.length?<div className="no-tasks">{tr("暂无传输任务。上传和下载会在此显示进度。")}</div>:<div className="task-list">{s.tasks.map(t=><div className="task" key={t.taskId}><span className="task-direction">{t.direction==='upload'?'↑':'↓'}</span><div className="task-detail"><strong>{t.name}</strong><div className="progress"><i style={{width:((t.verification?t.verification.totalBytes?Math.min(100,t.verification.bytes/t.verification.totalBytes*100):0:t.totalBytes?Math.min(100,t.transferredBytes/t.totalBytes*100):0))+'%'}}/></div><small>{t.error??(t.verification?tr('校验中')+' · SHA-256 · '+(t.verification.method==='remote'?tr('远端')+' · ':'')+formatBytes(t.verification.bytes)+' / '+formatBytes(t.verification.totalBytes):formatBytes(t.transferredBytes)+' / '+formatBytes(t.totalBytes))}</small></div><span className={'task-state '+t.state}>{tr(labels[t.verification?'verifying':t.state])}</span><div className="task-actions">
     {['queued','running','verifying'].includes(t.state)&&<button onClick={()=>void window.hornet.task.pause(t.taskId,t.revision).catch(s.fail)}>{tr("暂停")}</button>}
     {['paused','failed'].includes(t.state)&&<button onClick={()=>void window.hornet.task.resume(t.taskId,t.revision).catch(s.fail)}>{tr("恢复")}</button>}
     {!['succeeded','committing','cancelled'].includes(t.state)&&<button onClick={()=>void window.hornet.task.cancel(t.taskId,t.revision).catch(s.fail)}>{tr("取消")}</button>}
    </div></div>)}</div>}
   </div>);}
