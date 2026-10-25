import { startFileDrag,endFileDrag,useFileDrop } from './file-drag';
import { pasteToLocal } from './paste-files';
import { useEffect,useRef,useState } from 'react';
import { t as tr,formatDate } from './i18n';
import type { LocalDirectory } from '../../../packages/contracts/local-files';
import { useStore,type View } from './store';
import { useWorkspaceCommands } from './workspace-commands';
import { useFileClipboard } from './file-clipboard';
import { useWorkspacePreferences } from './workspace-preferences';
import { DirectoryTree } from './DirectoryTree';
import { formatBytes } from './FileView';
export function newLocalFileTab(){const id=crypto.randomUUID();useStore.getState().addView({id,kind:'localFiles',source:'local',profile:{profileId:crypto.randomUUID(),protocol:'local',name:tr('本地文件'),host:'localhost',port:1,username:'',authType:'password',group:'',revision:0},connectionId:'',generation:1});}
export function LocalFileBrowser({view}:{view:View}){
 const [directory,setDirectory]=useState<LocalDirectory|null>(null),[path,setPath]=useState(''),[filter,setFilter]=useState(''),[selected,setSelected]=useState<string[]>([]),[busy,setBusy]=useState(false),[operation,setOperation]=useState<'mkdir'|'rename'|null>(null),[name,setName]=useState('');
 const prefs=useWorkspacePreferences(s=>s.value),clipboard=useFileClipboard(s=>s.value),input=useRef<HTMLInputElement>(null),current=useRef(directory);current.current=directory;
 const request=useRef(0),alive=useRef(true),working=useRef(false);
 const drop=useFileDrop(!!directory&&!busy,()=>true,async value=>{const destination=current.current;if(destination)await run(async()=>{await pasteToLocal(value,destination);await load(destination.path);});},undefined,useStore.getState().fail);
 async function run(fn:()=>Promise<unknown>){if(working.current)return;working.current=true;setBusy(true);try{await fn();}catch(error){useStore.getState().fail(error);}finally{working.current=false;if(alive.current)setBusy(false);}}
 async function load(value:string){const directory=current.current;if(!directory)return;const serial=++request.current;const next=await window.hornet.localFiles.list(directory.rootId,value);if(alive.current&&serial===request.current){current.current=next;setDirectory(next);setPath(next.path);setSelected([]);}}
 async function choose(){await run(async()=>{const next=await window.hornet.localFiles.choose();if(!next)return;if(!alive.current){await window.hornet.localFiles.release(next.rootId);return;}const previous=current.current;current.current=next;setDirectory(next);setPath(next.path);setSelected([]);if(previous)await window.hornet.localFiles.release(previous.rootId);});}
 async function paste(){const directory=current.current;if(!directory||!clipboard)return;
  await pasteToLocal(clipboard,directory);
  await load(directory.path);
 }
 useEffect(()=>window.hornet.onEvent(event=>{if(event.type==='task.state'&&event.task.state==='succeeded'&&current.current)void load(current.current.path).catch(useStore.getState().fail);}),[]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;request.current++;useWorkspaceCommands.getState().remove(view.id);if(current.current)void window.hornet.localFiles.release(current.current.rootId).catch(()=>{});};},[view.id]);
 useEffect(()=>{const one=selected.length===1?directory?.entries.find(entry=>entry.path===selected[0]):undefined;useWorkspaceCommands.getState().publish(view.id,{
  choose:()=>void choose(),refresh:directory&&!busy?()=>void run(()=>load(directory.path)):undefined,up:directory?.path&&!busy?()=>void run(()=>load(directory.path.split(/[\\/]/).slice(0,-1).join('/'))):undefined,
  copy:directory&&selected.length?()=>useFileClipboard.getState().set({source:'local',rootId:directory.rootId,paths:[...selected]}):undefined,
  paste:directory&&clipboard&&!busy?()=>void run(paste):undefined,
  selectAll:directory?()=>setSelected(directory.entries.filter(entry=>(entry.kind==='file'||entry.kind==='directory')).map(entry=>entry.path)):undefined,search:()=>input.current?.focus(),
  mkdir:directory&&!busy?()=>{setOperation('mkdir');setName('');}:undefined,
  rename:one&&!busy?()=>{setOperation('rename');setName(one.name);}:undefined,
  remove:one&&!busy?()=>{if(window.confirm(tr('删除所选本地文件或空目录？')+' '+one.name))void run(async()=>{await window.hornet.localFiles.remove(directory!.rootId,one.path);await load(directory!.path);});}:undefined
 });});
 const entries=directory?.entries.filter(entry=>entry.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase()))??[];
 return <section className={"files local-file-browser"+drop.className} {...drop.handlers} data-file-display={prefs.fileDisplay}><div className="filebar"><button onClick={()=>void choose()} disabled={busy}>{tr('选择本地目录')}</button><strong>{directory?.rootPath??tr('本地文件')}</strong></div>{directory&&<>{prefs.folderTree&&<DirectoryTree root="" load={path=>window.hornet.localFiles.list(directory.rootId,path)} navigate={path=>void run(()=>load(path))}/>}<form className="filebar" onSubmit={event=>{event.preventDefault();void run(()=>load(path));}}><input aria-label={tr('本地相对路径')} value={path} onChange={event=>setPath(event.target.value)}/><button disabled={busy}>{tr('转到')}</button></form><input ref={input} className="file-filter" aria-label={tr('筛选本地文件')} value={filter} onChange={event=>setFilter(event.target.value)}/><div className="table-scroll"><table><thead><tr><th/><th>{tr('名称')}</th><th>{tr('大小')}</th><th>{tr('修改时间')}</th></tr></thead><tbody>{entries.map(entry=><tr key={entry.path} draggable={entry.kind==='file'||entry.kind==='directory'} onDragStart={event=>{if((event.target as HTMLElement).closest('input')){event.preventDefault();return;}startFileDrag(event,{source:'local',rootId:directory.rootId,paths:selected.includes(entry.path)?selected:[entry.path]});}} onDragEnd={endFileDrag} onDoubleClick={()=>{if(entry.kind==='directory')void run(()=>load(entry.path));}}><td>{(entry.kind==='file'||entry.kind==='directory')&&<input type="checkbox" aria-label={entry.name} checked={selected.includes(entry.path)} onChange={event=>setSelected(old=>event.target.checked?[...old,entry.path]:old.filter(path=>path!==entry.path))}/>}</td><td>{entry.kind==='directory'?<button onClick={()=>void run(()=>load(entry.path))}>▰ {entry.name}</button>:<span>▤ {entry.name}</span>}</td><td>{entry.kind==='file'?formatBytes(entry.size):'—'}</td><td>{formatDate(entry.modified)}</td></tr>)}</tbody></table></div></>}{operation&&directory&&<div className="modal-backdrop"><form className="modal" role="dialog" aria-modal="true" aria-label={tr(operation==='mkdir'?'新建目录':'重命名')} onSubmit={event=>{event.preventDefault();void run(async()=>{if(operation==='mkdir')await window.hornet.localFiles.mkdir(directory.rootId,directory.path,name);else await window.hornet.localFiles.rename(directory.rootId,selected[0],name);setOperation(null);await load(directory.path);});}}><h2>{tr(operation==='mkdir'?'新建目录':'重命名')}</h2><input aria-label={tr('名称')} required value={name} onChange={event=>setName(event.target.value)}/><div className="modal-actions"><button type="button" onClick={()=>setOperation(null)}>{tr('取消')}</button><button disabled={busy}>{tr('保存')}</button></div></form></div>}</section>;
}
