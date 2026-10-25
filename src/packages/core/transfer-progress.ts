import type { TaskSnapshot } from '../contracts';
export const activeTransferStates=new Set(['queued','running','verifying','committing','pausing','cancelling']);
export const transferStateLabels:Record<string,string>={queued:'排队',running:'传输中',verifying:'校验中',committing:'提交中',pausing:'正在暂停',paused:'已暂停',cancelling:'正在取消',cancelled:'已取消',succeeded:'已完成',failed:'失败',conflict:'冲突'};
interface Sample {at:number;bytes:number}
interface History {at:number;bytes:number;elapsed:number;active:boolean;samples:Sample[]}
export class TransferProgress {
 private history=new Map<string,History>();
 sample(task:TaskSnapshot,now:number){
  const active=activeTransferStates.has(task.state),moving=task.state==='running'&&!task.verification;
  let previous=this.history.get(task.taskId);
  if(!previous){const end=active?now:task.updatedAt;previous={at:now,bytes:task.transferredBytes,elapsed:task.startedAt?Math.max(0,end-task.startedAt):0,active,samples:[{at:now,bytes:task.transferredBytes}]};this.history.set(task.taskId,previous);}
  const elapsed=previous.elapsed+(previous.active?Math.max(0,now-previous.at):0);
  let samples=moving&&task.transferredBytes>=previous.bytes?previous.samples:[];
  samples=samples.filter(sample=>sample.at>=now-4000);samples.push({at:now,bytes:task.transferredBytes});if(samples.length>40)samples=samples.slice(-40);
  const first=samples[0],duration=now-first.at,speed=moving&&duration>=200?Math.max(0,(task.transferredBytes-first.bytes)*1000/duration):0;
  this.history.set(task.taskId,{at:now,bytes:task.transferredBytes,elapsed,active,samples});
  return {elapsedSeconds:Math.floor(elapsed/1000),speed,remainingSeconds:speed>0?Math.ceil(Math.max(0,task.totalBytes-task.transferredBytes)/speed):undefined,percent:task.state==='succeeded'?100:task.totalBytes?Math.min(100,task.transferredBytes/task.totalBytes*100):0};
 }
 prune(tasks:TaskSnapshot[]){const ids=new Set(tasks.map(task=>task.taskId));for(const id of this.history.keys())if(!ids.has(id))this.history.delete(id);}
}
export function transferDuration(seconds:number){const value=Math.max(0,Math.floor(seconds)),hours=Math.floor(value/3600),minutes=Math.floor(value%3600/60),rest=value%60;return (hours?String(hours)+':':'')+String(minutes).padStart(2,'0')+':'+String(rest).padStart(2,'0');}
