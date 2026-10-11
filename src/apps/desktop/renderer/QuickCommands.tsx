import { t as tr } from './i18n';
import { useState } from 'react';
import { quickCommandSchema,readQuickCommands,saveQuickCommands,terminalAction,type QuickCommand } from './terminal-preferences';
import { useStore,type View } from './store';

export function QuickCommands({view,close}:{view:View;close:()=>void}){
 const [commands,setCommands]=useState<QuickCommand[]>(()=>{try{return readQuickCommands(localStorage.getItem('hornet.terminal.commands.v1'));}catch{return [];}});
 const [id,setId]=useState(''),[name,setName]=useState(''),[text,setText]=useState('');
 const closed=useStore(s=>!!s.closedTerminals[view.terminalId??'']);
 const fail=useStore(s=>s.fail),state=useStore(s=>s.connectionStates[view.connectionId]);
 function save(){try{const item=quickCommandSchema.parse({id:id||crypto.randomUUID(),name,text});const next=[...commands.filter(c=>c.id!==item.id),item];saveQuickCommands(next);setCommands(next);setId(item.id);}catch(e){fail(e);}}
 function remove(){try{const next=commands.filter(c=>c.id!==id);saveQuickCommands(next);setCommands(next);setId('');setName('');setText('');}catch(e){fail(e);}}
 function execute(){try{const command=quickCommandSchema.parse({id:id||crypto.randomUUID(),name:name||tr("临时命令"),text});terminalAction({viewId:view.id,kind:'execute',text:command.text});}catch(e){fail(e);}}
 return <section className="quick-command-panel" aria-label={tr("快速命令")}>
  <div className="quick-command-toolbar"><strong>{tr("快速命令")}</strong><span>{tr("发送到：")}{view.title??view.profile.name} · {view.profile.username?view.profile.username+'@':''}{view.profile.host}</span><button onClick={close} aria-label={tr("关闭快速命令")}>×</button></div>
  <div className="quick-command-toolbar"><select aria-label={tr("已保存命令")} value={id} onChange={e=>{setId(e.target.value);const item=commands.find(c=>c.id===e.target.value);setName(item?.name??'');setText(item?.text??'');}}><option value="">{tr("新建 / 临时命令")}</option>{commands.map(command=><option key={command.id} value={command.id}>{command.name}</option>)}</select><input aria-label={tr("命令名称")} placeholder={tr("命令名称")} maxLength={80} value={name} onChange={e=>setName(e.target.value)}/><button disabled={!name.trim()||!text} onClick={save}>{tr("保存命令")}</button><button disabled={!id} onClick={remove}>{tr("删除命令")}</button></div>
  <textarea aria-label={tr("快速命令内容")} placeholder={tr("输入要执行的命令（支持多行）")} maxLength={8192} value={text} onChange={e=>setText(e.target.value)} spellCheck={false}/>
  <div className="quick-command-toolbar"><span>{tr("命令保存于本机；点击执行会发送全部行并回车。")}</span><button className="primary" disabled={!text||closed||state==='closed'||state==='failed'} onClick={execute}>{tr("发送并执行")}</button></div>
 </section>;
}
