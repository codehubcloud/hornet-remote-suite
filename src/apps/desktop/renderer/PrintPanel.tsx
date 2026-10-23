import { t as tr,formatDate } from './i18n';
import { useWorkspaceCommands } from './workspace-commands';
import { useEffect,useRef,useState } from 'react';
import type { PrintQueue,PrintStatus,PrintJob } from '../../../packages/contracts/native';
import { useStore } from './store';
import { formatBytes } from './FileView';
const labels:Record<PrintJob['state'],string>={held:'待提交',submitting:'提交中',submitted:'已提交系统',failed:'失败',unknown:'结果待核实',cancelled:'已取消'};
export function PrintPanel(){
 const [settings,setSettings]=useState(false),[selectedJob,setSelectedJob]=useState(''),[showLog,setShowLog]=useState(false);
 const fail=useStore(s=>s.fail),[status,setStatus]=useState<PrintStatus>({listening:false,jobs:[]}),[busy,setBusy]=useState(false);
 const [draft,setDraft]=useState<PrintQueue>({queue:'hornet',printer:'',mode:'text',enabled:true}),[printers,setPrinters]=useState<string[]>([]),[editing,setEditing]=useState(false);
 const [bind,setBind]=useState('127.0.0.1'),[port,setPort]=useState(515),[sources,setSources]=useState('127.0.0.1'),[startup,setStartup]=useState('');
 const [selected,setSelected]=useState(''),[filter,setFilter]=useState(''),[state,setState]=useState('all');
 const searchInput=useRef<HTMLInputElement>(null);
 const live=useRef(true),running=useRef(false),revision=useRef(0);
 const refresh=async()=>{const n=++revision.current;const value=await window.hornet.print.status();if(live.current&&n===revision.current)setStatus(value);};
 useEffect(()=>{live.current=true;let timer:ReturnType<typeof setTimeout>;const poll=async()=>{try{await refresh();}catch(e){if(live.current)fail(e);}finally{if(live.current)timer=setTimeout(poll,2000);}};void poll();return()=>{live.current=false;clearTimeout(timer);};},[]);
 async function run(action:()=>Promise<unknown>){if(running.current)return;running.current=true;setBusy(true);try{await action();await refresh();}catch(e){fail(e);}finally{running.current=false;if(live.current)setBusy(false);}}
 const queues=status.queues??[],primary=queues.find(q=>q.queue===startup)??queues.find(q=>q.queue===status.defaultQueue)??queues[0];
 const jobs=status.jobs.filter(j=>(!selected||j.queue===selected)&&(state==='all'||j.state===state)&&[j.name,j.queue,j.source,j.owner??'',j.host??''].some(v=>v.toLocaleLowerCase().includes(filter.toLocaleLowerCase()))).sort((a,b)=>b.createdAt-a.createdAt);
 useEffect(()=>{
  const queue=queues.find(q=>q.queue===selected),job=status.jobs.find(j=>j.jobId===selectedJob);
  const pending=status.jobs.filter(j=>(!selected||j.queue===selected)&&j.state==='held');
  const removable=status.jobs.filter(j=>(!selected||j.queue===selected)&&j.state!=='submitting');
  const completed=removable.filter(j=>['submitted','cancelled','failed'].includes(j.state));
  const removeJobs=(jobs:PrintJob[])=>{if(window.confirm(tr('删除所选打印作业记录和暂存文件？不会取消已提交给系统的打印。')))void run(()=>window.hornet.print.removeJobs(jobs.map(j=>j.jobId)));};
  useWorkspaceCommands.getState().publish('tool:print',{
   export:busy||!job||job.state==='cancelled'?undefined:()=>void run(()=>window.hornet.print.exportJob(job.jobId)),
   print:busy||job?.state!=='held'?undefined:()=>void run(()=>window.hornet.print.submit(job.jobId)),
   submitAll:busy||!pending.length?undefined:()=>{if(window.confirm(tr('提交所有待打印作业？')+' '+pending.length))void run(async()=>{for(const item of pending){const result=await window.hornet.print.submit(item.jobId) as PrintJob;if(result.state!=='submitted')throw new Error(tr('打印结果不确定，已停止后续提交。'));}});},
   setDefault:busy||!queue?undefined:()=>void run(()=>window.hornet.print.setDefault(queue.queue)),
   removeAll:busy||!removable.length?undefined:()=>removeJobs(removable),removeCompleted:busy||!completed.length?undefined:()=>removeJobs(completed),logs:()=>setShowLog(value=>!value),
   new:busy?undefined:()=>{setSettings(true);setEditing(false);setDraft({queue:'',printer:'',mode:'text',enabled:true});},
   settings:()=>setSettings(true),properties:!queue?undefined:()=>{setSettings(true);setEditing(true);setDraft(queue);},
   toggle:busy||!queue?undefined:()=>void run(()=>window.hornet.print.saveQueue({...queue,enabled:!queue.enabled})),
   remove:busy||!queue?undefined:()=>{if(window.confirm(tr('删除打印队列 ')+queue.queue+tr('？已有历史作业保留。')))void run(async()=>{await window.hornet.print.removeQueue(queue.queue);setSelected('');});},
   refresh:()=>void refresh().catch(fail),all:()=>setSelected(''),search:()=>searchInput.current?.focus(),
   stop:busy||!status.listening?undefined:()=>void run(()=>window.hornet.print.stop())
  });
 });
 useEffect(()=>()=>useWorkspaceCommands.getState().remove('tool:print'),[]);
 return <section className="native-section print-center" aria-label={tr("LPD 打印中心")}><h3>{tr("LPD 打印中心")}</h3>
  <p className="muted">{tr("多个队列共用一个监听端口，可分别设置打印机、格式和接收状态。作业暂存后手动提交，“已提交系统”不代表纸张已输出。")}</p>
  <div className="print-queues" role="group" aria-label={tr("打印队列筛选")}><button aria-pressed={!selected} onClick={()=>setSelected('')}>{tr("所有队列（")}{status.jobs.length}）</button>{queues.map(q=><button key={q.queue} aria-pressed={selected===q.queue} onClick={()=>setSelected(q.queue)}>{q.queue}（{status.jobs.filter(j=>j.queue===q.queue&&j.state==='held').length}）{q.enabled?'':tr(" · 暂停")}</button>)}</div>
  <button aria-expanded={settings} onClick={()=>setSettings(!settings)}>{settings?tr("收起队列与监听设置"):tr("队列与监听设置")}</button>
  <div hidden={!settings}><div className="print-queue-list">{queues.map(q=><div className="print-queue-row" key={q.queue}><span><strong>{q.queue}</strong> → {q.printer} · {q.mode==='text'?tr("UTF-8 文本"):'RAW'}</span><button disabled={busy} onClick={()=>{setDraft(q);setEditing(true);}}>{tr("编辑队列 ")}{q.queue}</button><button disabled={busy} onClick={()=>void run(()=>window.hornet.print.saveQueue({...q,enabled:!q.enabled}))}>{tr(q.enabled?'暂停接收 {name}':'恢复接收 {name}',{name:q.queue})}</button><button disabled={busy} onClick={()=>{if(window.confirm(tr("删除打印队列 ")+q.queue+tr("？已有历史作业保留。")))void run(async()=>{await window.hornet.print.removeQueue(q.queue);if(selected===q.queue)setSelected('');});}}>{tr("删除队列 ")}{q.queue}</button></div>)}</div>
  <form className="tunnel-form" onSubmit={e=>{e.preventDefault();void run(async()=>{await window.hornet.print.saveQueue(draft);setEditing(false);});}}>
   <label>{tr("队列名")}<input aria-label={tr("打印队列名")} required disabled={editing} pattern="[A-Za-z0-9_-]{1,64}" value={draft.queue} onChange={e=>setDraft({...draft,queue:e.target.value})}/></label>
   <label>{tr("系统打印机")}<input aria-label={tr("队列打印机")} required list="print-devices" value={draft.printer} onChange={e=>setDraft({...draft,printer:e.target.value})}/></label><datalist id="print-devices">{printers.map(p=><option key={p} value={p}/>)}</datalist>
   <label>{tr("作业格式")}<select aria-label={tr("打印格式")} value={draft.mode} onChange={e=>setDraft({...draft,mode:e.target.value as 'raw'|'text'})}><option value="text">{tr("UTF-8 文本")}</option><option value="raw">RAW</option></select></label>
   <button disabled={busy} className="primary">{tr("保存打印队列")}</button><button type="button" disabled={busy} onClick={()=>{setEditing(false);setDraft({queue:'',printer:'',mode:'text',enabled:true});}}>{tr("新建打印队列")}</button><button type="button" disabled={busy} onClick={()=>void run(async()=>setPrinters(await window.hornet.print.printers()))}>{tr("读取系统打印机")}</button>
  </form>
  <form className="tunnel-form" onSubmit={e=>{e.preventDefault();if(primary){setStartup(primary.queue);void run(()=>window.hornet.print.start({bindHost:bind,port,allowedSources:sources.split(/[,，\s]+/).filter(Boolean),queue:primary.queue,printer:primary.printer,mode:primary.mode}));}}}>
   <label>{tr("监听接口")}<input aria-label={tr("LPD 监听接口")} required disabled={status.listening} value={bind} onChange={e=>setBind(e.target.value)}/></label><label>{tr("LPD 端口")}<input aria-label={tr("LPD 端口")} type="number" min={0} max={65535} required disabled={status.listening} value={port} onChange={e=>setPort(Number(e.target.value))}/></label><label>{tr("来源 IP 白名单")}<input aria-label={tr("LPD 来源白名单")} required disabled={status.listening} value={sources} onChange={e=>setSources(e.target.value)}/></label>
   <label>{tr("启动队列")}<select aria-label={tr("LPD 启动队列")} disabled={status.listening} value={primary?.queue??''} onChange={e=>setStartup(e.target.value)}>{!queues.length&&<option value="">{tr("请先保存打印队列")}</option>}{queues.map(q=><option key={q.queue}>{q.queue}</option>)}</select></label><button disabled={busy||status.listening||!primary}>{tr("启动 LPD 接收")}</button><button type="button" disabled={busy||!status.listening} onClick={()=>void run(()=>window.hornet.print.stop())}>{tr("停止接收")}</button>
  </form>
  </div>
  <p aria-label={tr("LPD 监听状态")}>{status.listening?tr("监听 ")+status.config?.bindHost+':'+status.config?.port:tr("LPD 未监听")}</p>
  <div className="print-filter"><input ref={searchInput} aria-label={tr("搜索打印作业")} placeholder={tr("搜索文件、队列、主机或用户…")} value={filter} onChange={e=>setFilter(e.target.value)}/><select aria-label={tr("打印作业状态")} value={state} onChange={e=>setState(e.target.value)}><option value="all">{tr("全部状态")}</option>{Object.entries(labels).map(([key,label])=><option key={key} value={key}>{tr(label)}</option>)}</select></div>
  <div className="table-scroll"><table><thead><tr><th>{tr("时间")}</th><th>{tr("状态")}</th><th>{tr("文件名")}</th><th>{tr("大小")}</th><th>{tr("队列 / 打印机")}</th><th>{tr("主机 / 用户")}</th><th>{tr("操作")}</th></tr></thead><tbody>{jobs.map(j=><tr key={j.jobId} className={selectedJob===j.jobId?'selected':''} onClick={()=>setSelectedJob(j.jobId)}><td><input type="radio" aria-label={tr('选择打印作业')+j.name} checked={selectedJob===j.jobId} onChange={()=>setSelectedJob(j.jobId)}/>{formatDate(j.createdAt)}</td><td title={j.error}>{tr(labels[j.state])}{j.osJobId!==undefined?' #'+j.osJobId:''}{j.error&&<p>{j.error}</p>}</td><td title={j.jobId}>{j.name}</td><td>{formatBytes(j.bytes)}</td><td>{j.queue}<br/>{j.printer}</td><td>{j.source}<br/>{j.host} / {j.owner}</td><td><button disabled={busy||j.state!=='held'} onClick={()=>void run(()=>window.hornet.print.submit(j.jobId))}>{tr("提交打印")}</button><button disabled={busy||j.state!=='held'} onClick={()=>void run(()=>window.hornet.print.cancel(j.jobId))}>{tr("取消任务")}</button></td></tr>)}</tbody></table>{!jobs.length&&<p className="empty">{tr("没有匹配的打印作业")}</p>}</div>
  {showLog&&<section className="print-event-log" aria-label={tr('日志查看器')}><h3>{tr('日志查看器')}</h3><button onClick={()=>setShowLog(false)}>{tr('关闭')}</button><ol>{(status.events??[]).map((event,index)=><li key={index}>{formatDate(event.at)} · {event.message}</li>)}</ol></section>}
 </section>;
}
