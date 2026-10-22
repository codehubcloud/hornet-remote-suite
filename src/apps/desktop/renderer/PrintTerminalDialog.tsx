import { useState } from 'react';
import { t as tr } from './i18n';
import { useStore } from './store';
export function PrintTerminalDialog({text,title,close}:{text:string;title:string;close:()=>void}){
 const [landscape,setLandscape]=useState(false),[pageSize,setPageSize]=useState<'A4'|'Letter'>('A4'),[busy,setBusy]=useState(false);
 return <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label={tr('打印预览')}><h2>{tr('打印预览')}</h2><p>{title}</p><label>A4 / Letter<select value={pageSize} onChange={e=>setPageSize(e.target.value as 'A4'|'Letter')}><option>A4</option><option>Letter</option></select></label><label className="check"><input type="checkbox" checked={landscape} onChange={e=>setLandscape(e.target.checked)}/>{tr('横向')}</label><pre style={{maxHeight:'50vh',overflow:'auto',whiteSpace:'pre-wrap',userSelect:'text'}}>{text}</pre><div className="modal-actions"><button disabled={busy} onClick={()=>{setBusy(true);void window.hornet.documents.print({text,title,landscape,pageSize}).catch(useStore.getState().fail).finally(()=>setBusy(false));}}>{tr('打印…')}</button><button disabled={busy} onClick={close}>{tr('关闭')}</button></div></section></div>;
}
