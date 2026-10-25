import { useEffect,useRef,useState } from 'react';
import { t as tr } from './i18n';
import { useStore } from './store';
import { formatBytes } from './FileView';
import { TransferProgress,transferDuration,transferStateLabels } from '../../../packages/core/transfer-progress';
export function TransferTable(){
 const s=useStore(),[,tick]=useState(0),progress=useRef(new TransferProgress());
 useEffect(()=>{const timer=setInterval(()=>tick(value=>value+1),500);return()=>clearInterval(timer);},[]);
 const now=Date.now();progress.current.prune(s.tasks);
 if(!s.tasks.length)return <div className="task-body"><div className="no-tasks">{tr('暂无传输任务。上传和下载会在此显示进度。')}</div></div>;
 return <div className="task-body"><div className="transfer-table-scroll"><table className="transfer-table" aria-label={tr('文件传输列表')}><thead><tr>{['名称','状态','进度','大小','本地路径','方向','远程路径','速度','预计剩余时间','经过时间','操作'].map(label=><th key={label}>{tr(label)}</th>)}</tr></thead><tbody>{s.tasks.map(task=>{
  const m=progress.current.sample(task,now);
  return <tr className="task" key={task.taskId} data-task-id={task.taskId}>
   <td title={task.name}><strong>{task.name}</strong></td>
   <td className={'task-state '+task.state}>{tr(transferStateLabels[task.verification?'verifying':task.state])}{task.verification&&<small className="task-verification">SHA-256 · {task.verification.method==='remote'?tr('远端')+' · ':''}{formatBytes(task.verification.bytes)} / {formatBytes(task.verification.totalBytes)}</small>}{task.error&&<small className="transfer-error" title={task.error}>{task.error}</small>}</td>
   <td className="transfer-progress-cell"><span>{m.percent.toFixed(1)}%</span><div className="progress" role="progressbar" aria-label={tr('传输进度')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(m.percent)}><i style={{width:m.percent+'%'}}/></div><small>{formatBytes(task.transferredBytes)} / {formatBytes(task.totalBytes)}</small></td>
   <td>{formatBytes(task.transferredBytes)} / {formatBytes(task.totalBytes)}</td><td className="transfer-path" title={task.localPath}>{task.localPath??'—'}</td><td className="task-direction" title={tr(task.direction==='upload'?'本地 → 远端':'远端 → 本地')}>{task.direction==='upload'?'→':'←'}</td><td className="transfer-path" title={task.remotePath}>{task.remotePath??'—'}</td>
   <td>{m.speed>0?formatBytes(m.speed)+'/s':'—'}</td><td>{task.state==='succeeded'?'00:00':m.remainingSeconds===undefined?'—':transferDuration(m.remainingSeconds)}</td><td>{transferDuration(m.elapsedSeconds)}</td>
   <td><div className="task-actions">{['queued','running','verifying'].includes(task.state)&&<button onClick={()=>void window.hornet.task.pause(task.taskId,task.revision).catch(s.fail)}>{tr('暂停')}</button>}{['paused','failed'].includes(task.state)&&<button onClick={()=>void window.hornet.task.resume(task.taskId,task.revision).catch(s.fail)}>{tr('恢复')}</button>}{!['succeeded','committing','cancelled'].includes(task.state)&&<button onClick={()=>void window.hornet.task.cancel(task.taskId,task.revision).catch(s.fail)}>{tr('取消')}</button>}</div></td>
  </tr>;
 })}</tbody></table></div></div>;
}
