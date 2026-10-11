import { useState } from 'react';
import { t } from './i18n';
import { useStore } from './store';
import { useBroadcast } from './broadcast';
export function BroadcastDialog({close}:{close:()=>void}){
 const s=useStore(),broadcast=useBroadcast();
 const available=s.views.filter(v=>v.kind==='terminal'&&v.terminalId&&!s.closedTerminals[v.terminalId]&&!s.reconnecting[v.id]);
 const [selected,setSelected]=useState(broadcast.targets.map(v=>v.terminalId));
 const chosen=available.filter(v=>selected.includes(v.terminalId!));
 return <div className="modal-backdrop"><section className="modal broadcast-dialog" role="dialog" aria-modal="true" aria-label={t('发送键输入到')}>
  <h2>{t('发送键输入到')}</h2><p>{t('勾选 2–16 个终端后开启键盘和粘贴广播。快捷命令仍只发送到当前终端。')}</p>
  <div className="broadcast-targets">{available.map(v=><label className="checkbox" key={v.terminalId}><input type="checkbox" checked={selected.includes(v.terminalId!)} onChange={e=>setSelected(ids=>e.target.checked?[...ids,v.terminalId!]:ids.filter(id=>id!==v.terminalId))}/><span>{v.title??v.profile.name} · {v.profile.username? v.profile.username+'@':''}{v.profile.host} <small>{v.terminalId!.slice(0,8)}</small></span></label>)}</div>
  <p className="muted">{t('仅勾选的现有会话接收输入；关闭或重连后自动移除，新打开的会话不会加入。')}</p>
  <div className="modal-actions"><button onClick={()=>{broadcast.stop();close();}}>{t('停止广播')}</button><button onClick={close}>{t('取消')}</button><button className="primary" disabled={chosen.length<2||chosen.length>16} onClick={()=>{broadcast.start(chosen.map(v=>({viewId:v.id,terminalId:v.terminalId!,name:v.title??v.profile.name})));close();}}>{t('开启广播')}</button></div>
 </section></div>;
}
