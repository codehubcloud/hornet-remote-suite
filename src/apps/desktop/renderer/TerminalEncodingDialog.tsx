import { useEffect,useState } from 'react';
import type { TerminalEncoding } from '../../../packages/contracts/terminal-encoding';
import type { View } from './store';
import { EncodingSelect } from './EncodingSelect';
import { getScriptRunner } from './script-runner';
import { t as tr } from './i18n';
export function TerminalEncodingDialog({view,close}:{view:View;close:()=>void}){
 const [value,setValue]=useState<TerminalEncoding>('utf8'),[busy,setBusy]=useState(true),[error,setError]=useState('');
 useEffect(()=>{let cancelled=false;void window.hornet.terminal.encoding(view.terminalId!,view.generation).then(value=>{if(!cancelled)setValue(value);}).catch(e=>{if(!cancelled)setError(e.message);}).finally(()=>{if(!cancelled)setBusy(false);});return()=>{cancelled=true;};},[view.terminalId,view.generation]);
 async function apply(){setBusy(true);try{if(getScriptRunner(view.terminalId!)?.running)throw new Error(tr('请先停止脚本，再切换编码。'));await window.hornet.terminal.encoding(view.terminalId!,view.generation,value);close();}catch(e){setError(e instanceof Error?e.message:String(e));setBusy(false);}}
 return <div className="modal-backdrop"><form className="modal" role="dialog" aria-modal="true" aria-label={tr('终端编码')} onSubmit={e=>{e.preventDefault();void apply();}}><h2>{tr('终端编码')}</h2><p>{view.title??view.profile.name}</p><fieldset disabled={busy}><EncodingSelect value={value} change={setValue}/></fieldset><p>{tr('仅影响此终端后续收发；历史内容不重新解码。重连使用会话属性中的编码。')}</p>{error&&<p role="alert" className="error">{error}</p>}<div className="modal-actions"><button type="button" disabled={busy} onClick={close}>{tr('取消')}</button><button disabled={busy} className="primary">{tr('应用设置')}</button></div></form></div>;
}
