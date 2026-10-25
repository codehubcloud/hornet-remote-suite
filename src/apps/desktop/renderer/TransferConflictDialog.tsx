import { useEffect,useId,useRef,useState } from 'react';
import { useTransferConflicts } from './transfer-queue';
import type { TransferConflict,TransferFile } from '../../../packages/contracts/file-transfer';
import { t,formatDate } from './i18n';
import { useAppearance } from './appearance';
import { formatBytes } from './FileView';
export function TransferConflictHost(){const question=useTransferConflicts(state=>state.questions[0]);return question?<ConflictDialog key={question.conflict.id} conflict={question.conflict}/>:null;}
function ConflictDialog({conflict:c}:{conflict:TransferConflict}){
 const [all,setAll]=useState(false),[action,setAction]=useState<'replace'|'skip'|'rename'>(c.canReplace?'replace':'skip');
 const [name,setName]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const root=useRef<HTMLFormElement>(null),sequence=useRef(0),actionId=useId(),nameId=useId();
 const language=useAppearance(state=>state.value.language),fileName=c.target.path.split(/[\\/]/).pop()??c.target.path;
 function cancel(){sequence.current++;useTransferConflicts.getState().answer({action:'cancel',all:false});}
 async function submit(){
  if(busy)return;const current=++sequence.current,newName=name.trim();setError('');
  if(action==='rename'&&newName){
   if(newName==='.'||newName==='..'||/[\\/\x00-\x1f\x7f]/.test(newName)){setError(t('请输入有效的文件名，不要包含目录分隔符。'));return;}
   setBusy(true);try{await window.hornet.transfer.checkName(c.id,newName);}catch(reason){if(current===sequence.current){const message=String(reason);setError(message.includes('FILE_NAME_EXISTS')?t('该名称已存在，请输入其他名称。'):message.includes('FILE_NAME_INVALID')?t('请输入有效的文件名，不要包含目录分隔符。'):message);}return;}finally{if(current===sequence.current)setBusy(false);}
  }
  if(current===sequence.current)useTransferConflicts.getState().answer({action,all,...(action==='rename'&&newName?{name:newName}:{})});
 }
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null;root.current?.querySelector<HTMLSelectElement>('select')?.focus({preventScroll:true});
  const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();cancel();}else if(event.key==='Tab'){const controls=[...root.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)')],index=controls.indexOf(document.activeElement as HTMLElement);if(event.shiftKey&&index===0){event.preventDefault();controls.at(-1)?.focus();}else if(!event.shiftKey&&index===controls.length-1){event.preventDefault();controls[0]?.focus();}}};
  window.addEventListener('keydown',key,true);return()=>{sequence.current++;window.removeEventListener('keydown',key,true);previous?.focus({preventScroll:true});};
 },[]);
 function details(file:TransferFile,label:string){return <section className="conflict-detail" aria-label={label}><h3>{label}:</h3><div className="conflict-detail-body"><FileSymbol file={file}/><div><div className="conflict-file-path" title={file.path}>{file.path}</div><div>{file.kind==='file'?t('{size}（{bytes} 字节）',{size:formatBytes(file.size),bytes:new Intl.NumberFormat(language).format(file.size)}):t(file.kind==='directory'?'目录':'符号链接')}</div><time>{file.modified?formatDate(file.modified):'—'}</time></div></div></section>;}
 return <div className="modal-backdrop transfer-conflict-backdrop"><form ref={root} className="modal transfer-conflict-dialog conflict-dialog-classic" role="dialog" aria-modal="true" aria-label={t('目标文件已存在')} onSubmit={event=>{event.preventDefault();void submit();}}>
  <div className="conflict-warning"><span aria-hidden="true">!</span><p>{t('此文件夹已包含以下名称的对象。')}<br/>{t('请选择要执行的操作。')}</p></div>
  <div className="conflict-name"><span>{t('名称')}:</span><strong>{fileName}</strong></div><hr/>
  {details(c.target,t('目标'))}{details(c.source,t('源'))}<hr/>
  {!c.canReplace&&<p className="muted">{t('此目标不支持覆盖，请选择跳过或重命名。')}</p>}
  <div className="conflict-operation"><label htmlFor={actionId}>{t('操作')}:</label><select id={actionId} aria-label={t('操作')} value={action} disabled={busy} onChange={event=>{setAction(event.target.value as typeof action);setError('');}}><option value="replace" disabled={!c.canReplace}>{t('覆盖')}</option><option value="skip">{t('跳过')}</option><option value="rename">{t('重命名')}</option></select><label className="checkbox"><input type="checkbox" checked={all} disabled={busy} onChange={event=>setAll(event.target.checked)}/>{t('全部应用')}</label></div>
  {action==='rename'&&<div className="conflict-rename"><label htmlFor={nameId}>{t('新名称')}:</label><input id={nameId} aria-label={t('新名称')} value={name} maxLength={255} disabled={busy} placeholder={t('留空时自动生成不重名的名称')} onChange={event=>{setName(event.target.value);setError('');}}/>{all&&name.trim()&&<small>{t('后续文件将自动生成不重名的名称。')}</small>}</div>}
  {error&&<p className="form-error" role="alert">{error}</p>}
  <div className="modal-actions conflict-confirm"><button className="primary" disabled={busy}>{busy?t('正在处理…'):t('确定')}</button><button type="button" onClick={cancel}>{t('取消')}</button></div>
 </form></div>;
}
function FileSymbol({file}:{file:TransferFile}){const extension=file.path.split('.').pop()?.toUpperCase()??'';const badge=/^DOCX?$/.test(extension)?'W':/^XLSX?$/.test(extension)?'X':/^PPTX?$/.test(extension)?'P':extension==='PDF'?'PDF':'';return <span className="conflict-file-symbol" aria-hidden="true"><svg viewBox="0 0 32 40"><path d="M6 1h16l9 9v28H6z" fill="var(--c-0b1220)" stroke="currentColor"/><path d="M22 1v10h9M11 18h14M11 23h14M11 28h14" fill="none" stroke="currentColor"/></svg>{badge&&<b data-kind={badge}>{badge}</b>}</span>;}
