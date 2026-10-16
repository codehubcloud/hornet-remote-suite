import { t as tr } from './i18n';
import { useEffect,useRef,useState } from 'react';
import { quickCommandSchema,type QuickCommand } from './terminal-preferences';
import { canSendCommand,commandSet,quickLibrarySchema,sendQuickCommand,useQuickCommands } from './quick-commands-store';
import { useStore,type View } from './store';
import { QuickCommandAppearanceEditor } from './QuickCommandAppearanceEditor';
import { quickCommandStyle,type QuickCommandAppearance } from './quick-command-appearance';

const setLabel=(id:string,name:string)=>id==='default'&&name==='默认命令集'?tr('默认命令集'):name;
export function QuickCommandSurface({view,mode}:{view:View;mode:'bar'|'pane'}){
 const q=useQuickCommands(),s=useStore(),setId=commandSet(view),commands=q.library.commands.filter(c=>(c.setId??'default')===setId);
 const drag=useRef('');
 function move(target:string){if(!drag.current||drag.current===target)return;const next=[...q.library.commands],from=next.findIndex(c=>c.id===drag.current),to=next.findIndex(c=>c.id===target);if(from<0||to<0)return;const [item]=next.splice(from,1);next.splice(to,0,item);try{q.persist({...q.library,commands:next});}catch(e){s.fail(e);}drag.current='';}
 return <section className={'quick-command-surface '+mode} aria-label={tr(mode==='bar'?'快速命令栏':'快速命令窗格')}>
  <div className="quick-command-surface-heading"><strong>{tr(mode==='bar'?'快速命令栏':'快速命令窗格')}</strong><select aria-label={tr('命令集')} value={setId} onChange={e=>q.select(view.id,e.target.value)}>{q.library.sets.map(set=><option key={set.id} value={set.id}>{setLabel(set.id,set.name)}</option>)}</select><button aria-label={tr('快速命令管理器')} title={tr('快速命令管理器')} onClick={()=>q.show('manager',true)}>⚙</button><button aria-label={tr(mode==='bar'?'关闭快速命令栏':'关闭快速命令窗格')} onClick={()=>q.show(mode,false)}>×</button></div>
  <div className="quick-command-buttons">{commands.map((command,index)=><button key={command.id} className={command.appearance?'quick-command-colored':undefined} style={quickCommandStyle(command.appearance)} onContextMenu={event=>{event.preventDefault();event.stopPropagation();q.openEditor(command.id);}} draggable title={(command.description?command.description+'\n':'')+command.text+(index<12?' · Ctrl+F'+(index+1):'')+'\n'+tr('右键编辑命令和按钮外观')} disabled={!canSendCommand(view)} onDragStart={()=>{drag.current=command.id;}} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();move(command.id);}} onClick={()=>sendQuickCommand(command,view)}>{command.name}</button>)}<button onClick={()=>q.show('manager',true)} title={tr('新建命令')}>＋</button></div>
 </section>;
}
export function QuickCommandHost(){
 const q=useQuickCommands(),s=useStore(),view=s.views.find(v=>v.id===s.active&&v.kind==='terminal');
 useEffect(()=>{const show=()=>q.show('manager',true),key=(event:KeyboardEvent)=>{
  if(!event.ctrlKey||event.altKey||event.shiftKey||!/^F([1-9]|1[0-2])$/.test(event.code)||document.querySelector('.modal-backdrop'))return;
  const state=useStore.getState(),current=state.views.find(v=>v.id===state.active&&v.kind==='terminal');if(current?.profile.session?.disableQuickShortcuts||!canSendCommand(current))return;
  const commands=useQuickCommands.getState().library.commands.filter(c=>(c.setId??'default')===commandSet(current)),command=commands[Number(event.code.slice(1))-1];if(command){event.preventDefault();event.stopImmediatePropagation();sendQuickCommand(command,current);}
 };window.addEventListener('hornet:quick-commands',show);window.addEventListener('keydown',key,true);return()=>{window.removeEventListener('hornet:quick-commands',show);window.removeEventListener('keydown',key,true);};},[q.show]);
 return q.manager?<QuickCommandManager view={view} close={()=>q.show('manager',false)}/>:null;
}
function QuickCommandManager({view,close}:{view:View|undefined;close:()=>void}){
 const q=useQuickCommands(),fail=useStore(s=>s.fail),initial=q.library.commands.find(command=>command.id===q.editingId),[selectedSetId,setSelectedSetId]=useState(()=>initial?.setId??(initial?'default':commandSet(view)));
 const currentSet=q.library.sets.find(s=>s.id===selectedSetId)??q.library.sets[0],commands=q.library.commands.filter(c=>(c.setId??'default')===currentSet.id);
 const [id,setId]=useState(initial?.id??''),[name,setName]=useState(initial?.name??''),[text,setText]=useState(initial?.text??''),[description,setDescription]=useState(initial?.description??''),[enter,setEnter]=useState(initial?.enter!==false),[newSetName,setNewSetName]=useState('');
 const [appearance,setAppearance]=useState<QuickCommandAppearance|undefined>(initial?.appearance);
 const file=useRef<HTMLInputElement>(null);
 function choose(command?:QuickCommand){setId(command?.id??'');setName(command?.name??'');setText(command?.text??'');setDescription(command?.description??'');setEnter(command?.enter!==false);setAppearance(command?.appearance);}
 function persist(operation:()=>void){try{operation();}catch(e){fail(e);}}
 function save(){persist(()=>{const item=quickCommandSchema.parse({id:id||crypto.randomUUID(),name,text,description,enter,appearance,setId:currentSet.id});const index=q.library.commands.findIndex(c=>c.id===id),next=[...q.library.commands];if(index<0)next.push(item);else next[index]=item;q.persist({...q.library,commands:next});setId(item.id);});}
 function remove(){if(!id)return;persist(()=>{q.persist({...q.library,commands:q.library.commands.filter(c=>c.id!==id)});choose();});}
 function setOperation(kind:'add'|'rename'|'delete'){persist(()=>{
  if(kind==='delete'){if(q.library.sets.length===1||!window.confirm(tr('删除命令集及其中的全部命令？')))return;const sets=q.library.sets.filter(s=>s.id!==currentSet.id);q.persist({...q.library,sets,commands:q.library.commands.filter(c=>(c.setId??'default')!==currentSet.id)});setSelectedSetId(sets[0].id);choose();return;}
  const nextName=newSetName.trim();if(!nextName)return;const next=kind==='add'?{id:crypto.randomUUID(),name:nextName}:{...currentSet,name:nextName};q.persist({...q.library,sets:kind==='add'?[...q.library.sets,next]:q.library.sets.map(s=>s.id===currentSet.id?next:s)});setSelectedSetId(next.id);setNewSetName('');choose();
 });}
 function move(direction:number){persist(()=>{const index=commands.findIndex(c=>c.id===id),other=commands[index+direction];if(!other)return;const next=[...q.library.commands],a=next.findIndex(c=>c.id===id),b=next.findIndex(c=>c.id===other.id);[next[a],next[b]]=[next[b],next[a]];q.persist({...q.library,commands:next});});}
 async function importFile(selected:File){try{if(selected.size>1048576)throw new Error(tr('命令库超过 1 MiB'));const imported=quickLibrarySchema.parse(JSON.parse(await selected.text())),map=new Map(imported.sets.map(set=>[set.id,crypto.randomUUID()]));const sets=imported.sets.map(set=>({...set,id:map.get(set.id)!})),commands=imported.commands.map(command=>({...command,id:crypto.randomUUID(),setId:map.get(command.setId??'default')!}));q.persist({...q.library,sets:[...q.library.sets,...sets],commands:[...q.library.commands,...commands]});setSelectedSetId(sets[0].id);choose();}catch(e){fail(e);}}
 function exportFile(){const url=URL.createObjectURL(new Blob([JSON.stringify(q.library,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='hornet-quick-commands.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 return <div className="modal-backdrop"><section className="modal quick-command-manager" role="dialog" aria-modal="true" aria-label={tr('快速命令管理器')}><section aria-label={tr('快速命令')}>
  <div className="modal-heading"><h2>{tr('快速命令管理器')}</h2><button aria-label={tr('关闭快速命令')} onClick={close}>×</button></div>
  <p className="muted">{tr('发送到：')}{view?(view.title??view.profile.name):tr('暂无活动终端')}</p>
  <div className="quick-set-toolbar"><select aria-label={tr('命令集')} value={currentSet.id} onChange={e=>{setSelectedSetId(e.target.value);choose();}}>{q.library.sets.map(set=><option key={set.id} value={set.id}>{setLabel(set.id,set.name)}</option>)}</select><input aria-label={tr('命令集名称')} placeholder={tr('命令集名称')} maxLength={80} value={newSetName} onChange={e=>setNewSetName(e.target.value)}/><button disabled={!newSetName.trim()} onClick={()=>setOperation('add')}>{tr('新建命令集')}</button><button disabled={!newSetName.trim()} onClick={()=>setOperation('rename')}>{tr('重命名')}</button><button disabled={q.library.sets.length===1} onClick={()=>setOperation('delete')}>{tr('删除命令集')}</button></div>
  <div className="quick-command-editor"><div className="quick-command-list"><select size={9} aria-label={tr('已保存命令')} value={id} onChange={e=>choose(commands.find(c=>c.id===e.target.value))}><option value="">{tr('新建 / 临时命令')}</option>{commands.map(command=><option key={command.id} value={command.id}>{command.name}</option>)}</select><div><button disabled={!id||commands[0]?.id===id} onClick={()=>move(-1)}>{tr('上移')}</button><button disabled={!id||commands.at(-1)?.id===id} onClick={()=>move(1)}>{tr('下移')}</button><button onClick={()=>choose()}>{tr('新建命令')}</button></div></div>
   <div><label>{tr('命令名称')}<input aria-label={tr('命令名称')} value={name} maxLength={80} onChange={e=>setName(e.target.value)}/></label><label>{tr('说明')}<input aria-label={tr('命令说明')} maxLength={2048} value={description} onChange={e=>setDescription(e.target.value)}/></label><label>{tr('快速命令内容')}<textarea aria-label={tr('快速命令内容')} maxLength={8192} value={text} onChange={e=>setText(e.target.value)} spellCheck={false}/></label><label className="checkbox"><input type="checkbox" checked={enter} onChange={e=>setEnter(e.target.checked)}/>{tr('发送后回车')}</label><QuickCommandAppearanceEditor value={appearance} name={name} change={setAppearance}/><div className="modal-actions"><button disabled={!id} onClick={remove}>{tr('删除命令')}</button><button disabled={!name.trim()||!text} onClick={save}>{tr('保存命令')}</button><button className="primary" disabled={!text||!canSendCommand(view)} onClick={()=>persist(()=>sendQuickCommand(quickCommandSchema.parse({id:id||crypto.randomUUID(),name:name||tr('临时命令'),text,enter}),view))}>{tr('发送并执行')}</button></div></div>
  </div><p className="muted">{tr('命令保存在本机。命令按钮和 Ctrl+F1～F12 只发送到当前活动终端。')}</p>
  <div className="modal-actions"><input hidden ref={file} type="file" accept="application/json,.json" onChange={e=>{const selected=e.target.files?.[0];if(selected)void importFile(selected);e.target.value='';}}/><button onClick={()=>file.current?.click()}>{tr('导入命令')}</button><button onClick={exportFile}>{tr('导出命令')}</button><button onClick={close}>{tr('关闭')}</button></div>
 </section></section></div>;
}
