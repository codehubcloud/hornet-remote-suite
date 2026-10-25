import { startFileDrag,endFileDrag,useFileDrop } from './file-drag';
import { pasteToLocal } from './paste-files';
import { useFileClipboard } from './file-clipboard';
import { useWorkspacePreferences } from './workspace-preferences';
import { t as tr,formatDate } from './i18n';
import { useWorkspaceCommands } from './workspace-commands';
import { useEffect,useRef,useState } from 'react';
import type { FileEntry } from '../../../packages/contracts';
import type { TreePreview,TreeRequest,SyncPolicy } from '../../../packages/contracts/file-tree';
import { TreeTransferDialog } from './TreeTransferDialog';
import type { LocalDirectory } from '../../../packages/contracts/local-files';
import { FileView,formatBytes } from './FileView';
import { useStore,type View } from './store';

export function FileWorkspace({view}:{view:View}){
 const [sync,setSync]=useState(false),[syncTarget,setSyncTarget]=useState<{terminalId:string;path:string}>();
 const [remotePath,setRemotePath]=useState<string|null>(null);
 const syncBase=useRef<{local:string;remote:string}|null>(null),expectedLocal=useRef<string|null>(null),expectedRemote=useRef<string|null>(null);
 const clipboard=useFileClipboard(state=>state.value),filterInput=useRef<HTMLInputElement>(null);
 const fileDisplay=useWorkspacePreferences(s=>s.value.fileDisplay);
 const ftp=view.profile.protocol==='ftp',s3=!!view.profile.session?.s3;
 const fail=useStore(s=>s.fail),[local,setLocal]=useState<LocalDirectory|null>(null),[path,setPath]=useState(''),[filter,setFilter]=useState('');
 const [selected,setSelected]=useState<string[]>([]),[busy,setBusy]=useState(false),[name,setName]=useState<string|null>(null),[remoteRefresh,setRemoteRefresh]=useState(0);
 const [preview,setPreview]=useState<TreePreview|null>(null),[notice,setNotice]=useState('');
 const [localOp,setLocalOp]=useState<'mkdir'|'rename'>('mkdir');
 const compared=useRef<TreeRequest|null>(null);
 const activePreview=useRef(preview);activePreview.current=preview;
 const current=useRef(local);current.current=local;
 const remote=useRef<string|null>(null),request=useRef(0),alive=useRef(true),working=useRef(false);
 const localDrop=useFileDrop(!!local&&!busy,value=>value.source==='remote',async value=>{const destination=current.current;if(destination)await run(async()=>{await pasteToLocal(value,destination);await load(destination.path);});},undefined,fail);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;request.current++;if(activePreview.current)void window.hornet.treeTransfer.discard(activePreview.current.planId).catch(()=>{});if(current.current)void window.hornet.localFiles.release(current.current.rootId).catch(()=>{});};},[]);
 useEffect(()=>window.hornet.onEvent(event=>{if(event.type==='task.state'&&event.task.state==='succeeded'&&event.task.profileId===view.profile.profileId){setRemoteRefresh(v=>v+1);const p=current.current;if(p)void load(p.path);}}),[]);
 async function load(value:string){
  const p=current.current;if(!p)return;const serial=++request.current;
  try{const next=await window.hornet.localFiles.list(p.rootId,value);if(alive.current&&serial===request.current){current.current=next;setLocal(next);setPath(next.path);setSelected([]);if(expectedLocal.current?.replaceAll('\\','/')===next.path.replaceAll('\\','/'))expectedLocal.current=null;else if(syncBase.current){const suffix=under(syncBase.current.local,next.path);if(suffix===null)stopSync();else{const destination=syncBase.current.remote.replace(/\/$/,'')+(suffix?'/'+suffix:'');expectedRemote.current=destination;setSyncTarget({terminalId:'file-sync',path:destination||'/'});}}}}catch(e){if(alive.current&&serial===request.current)fail(e);}
 }
 function under(base:string,path:string){base=base.replaceAll('\\','/').replace(/\/$/,'');path=path.replaceAll('\\','/').replace(/\/$/,'');return path===base?'':path.startsWith(base+'/')?path.slice(base.length+1):null;}
 function stopSync(){syncBase.current=null;expectedLocal.current=null;expectedRemote.current=null;setSync(false);setSyncTarget(undefined);}
 function toggleSync(){if(syncBase.current){stopSync();return;}if(current.current&&remote.current){syncBase.current={local:current.current.path,remote:remote.current};setSync(true);}}
 function remoteChanged(value:string|null){remote.current=value;setRemotePath(value);if(!value)return;if(expectedRemote.current===value){expectedRemote.current=null;return;}if(!syncBase.current)return;const suffix=under(syncBase.current.remote,value);if(suffix===null){stopSync();return;}const destination=[syncBase.current.local,suffix].filter(Boolean).join('/');if(current.current?.path.replaceAll('\\','/')!==destination){expectedLocal.current=destination;void load(destination);}}
 async function run(action:()=>Promise<void>){if(working.current)return;working.current=true;setBusy(true);try{await action();}catch(e){if(alive.current)fail(e);}finally{working.current=false;if(alive.current)setBusy(false);}}
 async function choose(){await run(async()=>{const next=await window.hornet.localFiles.choose();if(!next)return;if(!alive.current){await window.hornet.localFiles.release(next.rootId);return;}stopSync();request.current++;const previous=current.current;current.current=next;setLocal(next);setPath(next.path);setSelected([]);if(previous)await window.hornet.localFiles.release(previous.rootId);});}
 async function compare(direction:TreeRequest['direction'],names?:string[],policy:SyncPolicy='skip'){
  const p=current.current,destination=remote.current;if(!p||!destination)throw new Error(tr("请先选择本地目录并等待远端目录加载。"));
  setNotice(tr("正在扫描目录…"));
  try{const req:TreeRequest={connectionId:view.connectionId,rootId:p.rootId,localPath:p.path,remotePath:destination,direction,names,policy};const next=await window.hornet.treeTransfer.preview(req);compared.current=req;
   if(!alive.current){await window.hornet.treeTransfer.discard(next.planId);return;}
   if(activePreview.current)await window.hornet.treeTransfer.discard(activePreview.current.planId);activePreview.current=next;setPreview(next);
  }finally{if(alive.current)setNotice('');}
 }
 function closePreview(){if(activePreview.current)void window.hornet.treeTransfer.discard(activePreview.current.planId).catch(fail);activePreview.current=null;setPreview(null);}
 async function executePreview(){await run(async()=>{const p=activePreview.current;if(!p)return;const result=await window.hornet.treeTransfer.execute(p.planId);closePreview();setNotice(tr("已提交 {0} 个文件任务，创建 {1} 个目录，跳过 {2} 个条目。", {"0": result.taskIds.length, "1": result.directories, "2": result.skipped}));setRemoteRefresh(v=>v+1);if(current.current)await load(current.current.path);if(result.error)throw new Error(result.error);});}
 async function upload(){await run(async()=>{
  const p=current.current,destination=remote.current;if(!p||!destination)throw new Error(tr("请先选择本地目录并等待远端目录加载。"));
  const paths=[...selected];if(!paths.length)throw new Error(tr("请先勾选左侧要上传的文件或目录。"));
  const items=p.entries.filter(e=>paths.includes(e.path));
  if(items.some(e=>e.kind==='directory')){if(ftp||s3)throw new Error(ftp?tr('FTP 暂不支持目录传输，请选择普通文件。'):'AWS S3 transfer is limited to individual objects.'); await compare('upload',items.map(e=>e.name));return;}
  for(const path of paths){const entry=p.entries.find(e=>e.path===path&&(e.kind==='file'||e.kind==='directory'));if(!entry)continue;
   const grant=await window.hornet.localFiles.grant(p.rootId,entry.path,'upload');
   const task=await window.hornet.transfer.start(view.connectionId,'upload',grant.pathGrantId,(destination==='/'?'':destination)+'/'+entry.name,crypto.randomUUID());
   useStore.getState().event({type:'task.state',task});
  }
  setSelected([]);
 });}
 async function download(file:FileEntry){
  if(file.kind==='directory'){if(s3)throw new Error('AWS S3 transfer is limited to individual objects.');await run(()=>compare('download',[file.name]));return;}
  const p=local;if(!p)throw new Error(tr("请先选择左侧本地目录，作为下载位置。"));
  const grant=await window.hornet.localFiles.grant(p.rootId,p.path,'download',file.name);
  const task=await window.hornet.transfer.start(view.connectionId,'download',grant.pathGrantId,file.path,crypto.randomUUID());
  useStore.getState().event({type:'task.state',task});
 }
 useEffect(()=>{const one=local?.entries.find(entry=>selected.length===1&&entry.path===selected[0]);useWorkspaceCommands.getState().setFlags(view.id,{sync});useWorkspaceCommands.getState().publish(view.id+':local',{
  syncBrowse:local&&(sync||remotePath)&&!busy?toggleSync:undefined,
  refresh:local&&!busy?()=>void load(local.path):undefined,up:local?.path&&!busy?()=>void load(local.path.split(/[\\/]/).slice(0,-1).join('/')):undefined,
  copy:busy||!local||!selected.length?undefined:()=>useFileClipboard.getState().set({source:'local',rootId:local.rootId,paths:[...selected]}),
  paste:busy||!local||!clipboard?undefined:()=>void run(async()=>{await pasteToLocal(clipboard,local);await load(local.path);}),
  selectAll:local?()=>setSelected(local.entries.filter(entry=>entry.kind==='file'||entry.kind==='directory').map(entry=>entry.path)):undefined,search:()=>filterInput.current?.focus(),
  upload:busy||!local||!selected.length?undefined:()=>void upload(),
  mkdir:busy||!local?undefined:()=>{setLocalOp('mkdir');setName('');},
  rename:busy||!local||!one?undefined:()=>{setLocalOp('rename');setName(one.name);},
  remove:busy||!local||!one?undefined:()=>{if(window.confirm(tr('删除所选本地文件或空目录？')+' '+one.name))void run(async()=>{await window.hornet.localFiles.remove(local.rootId,one.path);await load(local.path);});},
  syncUpload:ftp||s3||busy||!local?undefined:()=>void run(()=>compare('upload')),
  syncBoth:ftp||s3||busy||!local?undefined:()=>void run(()=>compare('bidirectional',undefined,'newer')),
  syncDownload:ftp||s3||busy||!local?undefined:()=>void run(()=>compare('download'))
 });});
 useEffect(()=>()=>useWorkspaceCommands.getState().remove(view.id+':local'),[view.id]);
 const entries=local?.entries.filter(e=>e.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase()))??[];
 return <div className="file-workspace">
  <div className="directory-sync-bar" hidden={ftp||s3}><strong>{tr("目录比较 / 同步")}</strong><label><input type="checkbox" checked={sync} disabled={!local} onChange={toggleSync}/>{tr('同步浏览')}</label><button disabled={busy||!local} onClick={()=>void run(()=>compare('upload'))}>{tr("比较并补齐远端 →")}</button><button disabled={busy||!local} onClick={()=>void run(()=>compare('download'))}>{tr("← 比较并补齐本地")}</button><button disabled={busy||!local} onClick={()=>void run(()=>compare('bidirectional',undefined,'newer'))}>{tr("双向同步…")}</button><span role="status">{busy?tr("正在处理…"):notice}</span></div>
  <section onPointerDownCapture={()=>useWorkspaceCommands.getState().focus(view.id,'local')} data-file-display={fileDisplay} className={"local-file-pane"+localDrop.className} {...localDrop.handlers} aria-label={tr("本地文件")}>
   <div className="file-panel-heading"><strong>{tr("本地文件")}</strong><button disabled={busy} onClick={()=>void choose()}>{tr("选择本地目录")}</button></div>
   {local?<>
    <div className="file-summary" title={local.rootPath}>{local.rootPath}</div>
    <form className="local-filebar" onSubmit={e=>{e.preventDefault();void load(path);}}>
     <input aria-label={tr("本地相对路径")} placeholder={tr("所选目录内的相对路径")} value={path} onChange={e=>setPath(e.target.value)}/><button>{tr("转到")}</button>
     <button type="button" disabled={!local.path} onClick={()=>void load(local.path.split(/[\\/]/).slice(0,-1).join('/'))}>{tr("上级")}</button>
     <button type="button" onClick={()=>void load(local.path)}>{tr("刷新本地")}</button>
     <button type="button" onClick={()=>{setLocalOp('mkdir');setName('');}}>{tr("新建本地目录")}</button>
     <button type="button" className="primary" disabled={busy||!selected.length} onClick={()=>void upload()}>{tr("上传所选（")}{selected.length}）→</button>
    </form>
    <input ref={filterInput} className="file-filter" aria-label={tr("筛选本地文件")} placeholder={tr("筛选本地文件…")} value={filter} onChange={e=>setFilter(e.target.value)}/>
    <div className="table-scroll"><table><thead><tr><th><input type="checkbox" aria-label={tr("选择全部本地文件")} checked={entries.some(e=>(e.kind==='file'||e.kind==='directory'))&&entries.filter(e=>(e.kind==='file'||e.kind==='directory')).every(e=>selected.includes(e.path))} onChange={e=>setSelected(e.target.checked?entries.filter(e=>(e.kind==='file'||e.kind==='directory')).map(e=>e.path):[])}/></th><th>{tr("名称")}</th><th>{tr("大小")}</th><th>{tr("修改时间")}</th></tr></thead><tbody>
     {entries.map(file=><tr key={file.path} draggable={file.kind==='file'||file.kind==='directory'} onDragStart={event=>{if((event.target as HTMLElement).closest('input')){event.preventDefault();return;}const paths=selected.includes(file.path)?selected:[file.path];startFileDrag(event,{source:'local',rootId:local.rootId,paths});}} onDragEnd={endFileDrag} onDoubleClick={()=>{if(file.kind==='directory')void load(file.path);}}><td>{(file.kind==='file'||file.kind==='directory')&&<input type="checkbox" aria-label={tr("选择本地文件 ")+file.name} checked={selected.includes(file.path)} onChange={e=>setSelected(old=>e.target.checked?[...old,file.path]:old.filter(p=>p!==file.path))}/>}</td><td>{file.kind==='directory'?<button onClick={()=>void load(file.path)}>▰ {file.name}</button>:file.name}{file.kind==='link'?' ↗':''}</td><td>{file.kind==='file'?formatBytes(file.size):'—'}</td><td>{formatDate(file.modified)}</td></tr>)}
    </tbody></table>{!entries.length&&<p className="empty">{tr("此目录没有匹配文件")}</p>}</div>
    <p className="footnote">{local.entries.length}{tr(" 个条目")}{local.truncated?tr(" · 仅显示前 5000 项"):''}{tr("。文件传输进度显示在任务中心。")}</p>
   </>:<div className="empty">{tr("选择本地工作目录后，可浏览子目录、批量上传，并将右侧文件下载到当前目录。")}</div>}
  </section>
  <section className="remote-file-pane" aria-label={tr("远端文件")}><div className="file-panel-heading"><strong>{tr("远端文件 · ")}{view.profile.name}</strong></div><FileView view={view} followTarget={syncTarget} onDirectory={remoteChanged} uploadSelected={upload} downloadTo={download} downloadSelection={ftp||s3?undefined:files=>run(()=>compare('download',files.map(f=>f.name)))} refreshKey={remoteRefresh}/></section>
  {preview&&<TreeTransferDialog preview={preview} busy={busy} recompare={policy=>void run(()=>compare(compared.current!.direction,compared.current!.names,policy))} close={closePreview} execute={()=>void executePreview()}/>}
  {name!==null&&<div className="modal-backdrop"><form className="modal" onSubmit={e=>{e.preventDefault();void run(async()=>{const p=current.current;if(!p)return;if(localOp==='mkdir')await window.hornet.localFiles.mkdir(p.rootId,p.path,name);else await window.hornet.localFiles.rename(p.rootId,selected[0],name);setName(null);await load(p.path);});}}><h2>{tr(localOp==='mkdir'?"新建本地目录":"重命名")}</h2><label>{tr("名称")}<input autoFocus required value={name} onChange={e=>setName(e.target.value)}/></label><div className="modal-actions"><button type="button" onClick={()=>setName(null)}>{tr("取消")}</button><button disabled={busy}>{tr(localOp==='mkdir'?"创建目录":"保存")}</button></div></form></div>}
 </div>;
}
