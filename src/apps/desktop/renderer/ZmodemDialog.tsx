import { useEffect,useState } from 'react';
import type { ZmodemStatus } from '../../../services/terminal/zmodem';
import { useStore,type View } from './store';
import { t as tr } from './i18n';
import { formatBytes } from './FileView';
export function ZmodemDialog({view,direction,close}:{view:View;direction:'send'|'receive';close:()=>void}){
 const [jobs,setJobs]=useState<ZmodemStatus[]>([]),[busy,setBusy]=useState(false);
 const refresh=()=>window.hornet.zmodem.list().then(setJobs);
 useEffect(()=>{void refresh().catch(useStore.getState().fail);const timer=setInterval(()=>void refresh().catch(()=>{}),500);return()=>clearInterval(timer);},[]);
 async function run(action:()=>Promise<unknown>){setBusy(true);try{await action();await refresh();}catch(error){useStore.getState().fail(error);}finally{setBusy(false);}}
 const active=jobs.some(job=>job.terminalId===view.terminalId&&['waiting','transferring'].includes(job.state));
 return <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label={tr(direction==='send'?'发送 ZMODEM…':'接收 ZMODEM…')}><h2>{tr(direction==='send'?'发送 ZMODEM…':'接收 ZMODEM…')}</h2><p>{tr('先在远端运行 rz（接收）或 sz 文件名（发送），再选择本地文件或接收目录并开始。传输期间暂停终端键盘输入。')}</p><button disabled={busy||active} onClick={()=>void run(()=>window.hornet.zmodem.start(view.terminalId!,direction))}>{tr('选择文件并开始')}</button>{jobs.filter(job=>job.terminalId===view.terminalId).map(job=><article key={job.id}><strong>{job.name} · {tr(job.state)}</strong><p>{formatBytes(job.bytes)} / {formatBytes(job.total)} {job.error}</p>{['waiting','transferring'].includes(job.state)&&<button disabled={busy} onClick={()=>void run(()=>window.hornet.zmodem.cancel(job.id))}>{tr('取消传输')}</button>}</article>)}<div className="modal-actions"><button onClick={close}>{tr('关闭')}</button></div></section></div>;
}
