import { queueTransfer,type TransferBatch } from './transfer-queue';
import { ContextMenu,type MenuItem } from './MenuBar';
import { startFileDrag,endFileDrag,useFileDrop } from './file-drag';
import { FileDragButton } from './FileDragButton';
import { FileToolButton } from './FileToolbar';
import { pasteToRemote } from './paste-files';
import { useFileClipboard } from './file-clipboard';
import { DirectoryTree } from './DirectoryTree';
import { useWorkspacePreferences,useFileJournal } from './workspace-preferences';
import { t as tr,formatDate } from './i18n';
import { useWorkspaceCommands } from './workspace-commands';
import { useEffect,useRef,useState } from 'react';
import type { FileEntry,FilePage } from '../../../packages/contracts';
import { useStore,type View } from './store';
const emptyJournal:{at:number;message:string;failed?:boolean}[]=[];
export function FileView({view,compact=false,heading,followTarget,onDirectory,uploadSelected,downloadTo,downloadSelection,refreshKey=0}:{view:View;compact?:boolean;heading?:string;followTarget?:{terminalId:string;path:string};onDirectory?:(path:string|null)=>void;uploadSelected?:()=>Promise<void>;downloadTo?:(file:FileEntry,batch?:TransferBatch)=>Promise<void>;downloadSelection?:(files:FileEntry[])=>Promise<void>;refreshKey?:number}){
 const clipboard=useFileClipboard(state=>state.value);
 const preferences=useWorkspacePreferences(s=>s.value),journal=useFileJournal(s=>s.entries[view.id]??emptyJournal);
 const record=(message:string,failed=false)=>useFileJournal.getState().record(view.id,message,failed);
 const ftp=view.profile.protocol==='ftp',s3=!!view.profile.session?.s3;
 const [selected,setSelected]=useState<string[]>([]),[batch,setBatch]=useState(false);
 const [menu,setMenu]=useState<{file:FileEntry;x:number;y:number;anchor:HTMLElement}|null>(null);
 const request=useRef(0),wasFollowing=useRef(false),location=useRef('.'),listedPath=useRef('.');
 const [followError,setFollowError]=useState('');
 const [filter,setFilter]=useState(''),filterInput=useRef<HTMLInputElement>(null);
 const [filterOpen,setFilterOpen]=useState(false),toolbar=!!heading&&!compact;
 useEffect(()=>{if(filterOpen)filterInput.current?.focus();},[filterOpen]);
 const [page,setPage]=useState<FilePage>({path:'.',entries:[],truncated:false});
 const [path,setPath]=useState('.'),[busy,setBusy]=useState(false);
 const [operation,setOperation]=useState<{kind:'mkdir'|'rename'|'chmod';file?:FileEntry}|null>(null),[name,setName]=useState('');
 const fail=useStore(s=>s.fail);
 const drop=useFileDrop(!busy,value=>value.source==='local',async value=>{await pasteToRemote(value,view.connectionId,page.path);},async files=>{const destination=page.path;const grants=await window.hornet.fileDrag.dropped(files),batch:TransferBatch={};for(const grant of grants){if(batch.cancelled)break;await queueTransfer({connectionId:view.connectionId,direction:'upload',pathGrantId:grant.pathGrantId,remotePath:(destination==='/'?'':destination)+'/'+grant.name},batch);}},fail);
 const selectable=(file:FileEntry)=>file.kind==='file'||(!s3&&file.kind==='directory'&&!!downloadSelection);
 const chosen=selected.length===1?page.entries.find(file=>file.path===selected[0]):undefined;
 const identity=(s3?'AWS S3':ftp?(view.profile.ftpSecurity==='none'?'FTP':'FTPS'):'SFTP')+' · '+(s3?view.profile.host:view.profile.username+'@'+view.profile.host);
 const menuItems:MenuItem[]=menu?[
  {label:menu.file.kind==='directory'?'打开':'下载',action:()=>{if(menu.file.kind==='directory')void load(menu.file.path);else void download(menu.file);}},
  {label:'编辑',disabled:menu.file.kind!=='file'||ftp,action:()=>void edit(menu.file)},
  {label:'重命名',disabled:s3&&menu.file.kind!=='file',action:()=>{setName(menu.file.name);setOperation({kind:'rename',file:menu.file});}},
  {label:'权限',disabled:ftp||s3||menu.file.kind==='link',action:()=>{setName((menu.file.mode&0o777).toString(8).padStart(3,'0'));setOperation({kind:'chmod',file:menu.file});}},
  {label:'删除',action:()=>void remove(menu.file)}
 ]:[];
 async function load(path:string,quiet=false){const current=++request.current;location.current=path;onDirectory?.(null);setBusy(true);try{const p=await window.hornet.file.list(view.connectionId,path);record('LIST '+p.path);if(current===request.current){location.current=p.path;setPage(p);setPath(p.path);setSelected(old=>p.path===listedPath.current?old.filter(path=>p.entries.some(entry=>entry.path===path)):[]);listedPath.current=p.path;onDirectory?.(p.path);setFollowError('');}}catch(e){if(current===request.current){if(quiet)setFollowError(e instanceof Error?e.message:tr("无法跟随目录"));else {record(String(e),true);fail(e);}}}finally{if(current===request.current)setBusy(false);}}
 useEffect(()=>{setSelected([]);listedPath.current='.';void load(view.profile.session?.remoteDirectory??'.');return()=>{request.current++;};},[view.connectionId]);
 useEffect(()=>{if(followTarget)void load(followTarget.path,true);else if(wasFollowing.current){request.current++;location.current=page.path;setPath(page.path);setBusy(false);setFollowError('');onDirectory?.(page.path);}wasFollowing.current=Boolean(followTarget);},[followTarget?.path,followTarget?.terminalId]);
 useEffect(()=>window.hornet.onEvent(event=>{if(event.type==='task.state'&&event.task.profileId===view.profile.profileId&&['succeeded','failed','conflict','cancelled','paused'].includes(event.task.state)){record(event.task.direction.toUpperCase()+' '+event.task.name+' · '+event.task.state+(event.task.error?' · '+event.task.error:''),event.task.state==='failed'||event.task.state==='conflict');if(event.task.direction==='upload'&&event.task.state==='succeeded'&&compact)void load(location.current);}}),[view.profile.profileId,view.id,compact]);
 useEffect(()=>{if(refreshKey)void load(location.current);},[refreshKey]);
 async function downloadBatch(){setBatch(true);try{const items=page.entries.filter(f=>selected.includes(f.path));if(!s3&&items.some(f=>f.kind==='directory')&&downloadSelection){await downloadSelection(items);setSelected([]);return;}const transferBatch:TransferBatch={};for(const file of items.filter(f=>f.kind==='file'||(!s3&&f.kind==='directory'&&!!downloadSelection))){if(transferBatch.cancelled)break;if(downloadTo)await downloadTo(file,transferBatch);}setSelected([]);}catch(e){fail(e);}finally{setBatch(false);}}
 async function upload(){
  if(uploadSelected){await uploadSelected();return;}
  try{const grant=await window.hornet.file.choose('upload');if(!grant)return;
   const remote=(page.path==='/'?'':page.path)+'/'+grant.name;
   await queueTransfer({connectionId:view.connectionId,direction:'upload',pathGrantId:grant.pathGrantId,remotePath:remote});
  }catch(e){fail(e);}
 }
 async function download(file:FileEntry){try{if(downloadTo){await downloadTo(file);return;}const grant=await window.hornet.file.choose('download',file.name,true);if(grant)await queueTransfer({connectionId:view.connectionId,direction:'download',pathGrantId:grant.pathGrantId,remotePath:file.path});}catch(e){fail(e);}}
 async function mutate(){
  if(operation?.kind==='chmod'){if(!/^[0-7]{3}$/.test(name)){fail(new Error(tr("请输入三位八进制权限，例如 644。")));return;}try{await window.hornet.file.chmod(view.connectionId,operation.file!.path,parseInt(name,8));record('CHMOD '+operation.file!.path+' '+name);setOperation(null);await load(page.path);}catch(e){fail(e);}return;}
  if(!operation||!name||name==='.'||name==='..'||name.includes('/')||name.includes('\\')){fail(new Error(tr("请输入不包含目录分隔符的名称。")));return;}
  try{const target=(page.path==='/'?'':page.path)+'/'+name;
   if(operation.kind==='mkdir')await window.hornet.file.mkdir(view.connectionId,target);
   else await window.hornet.file.rename(view.connectionId,operation.file!.path,target);
   record(operation.kind.toUpperCase()+' '+target);setOperation(null);await load(page.path);
  }catch(e){fail(e);}
 }
 async function remove(file:FileEntry){if(!window.confirm(tr("从 ")+view.profile.name+tr(" 删除 ")+file.path+tr("？此操作不能撤销，目录仅允许为空。")))return;try{await window.hornet.file.remove(view.connectionId,file.path);record('DELETE '+file.path);await load(page.path);}catch(e){fail(e);}}
 async function edit(file:FileEntry){
  let lease:Awaited<ReturnType<typeof window.hornet.connection.open>>|undefined;
  try{lease=await window.hornet.connection.open(view.profile.profileId,'files');const data=await window.hornet.file.read(lease.connectionId,file.path);
   useStore.getState().addView({id:crypto.randomUUID(),kind:'editor',profile:view.profile,...lease,path:file.path,...data});
  }catch(e){if(lease)await window.hornet.connection.release(lease.leaseId);fail(e);}
 }
 useEffect(()=>{
  if(compact)return;
  const one=selected.length===1?page.entries.find(f=>f.path===selected[0]):undefined;
  useWorkspaceCommands.getState().publish(view.id,{
   copy:busy||!selected.length?undefined:()=>useFileClipboard.getState().set({source:'remote',connectionId:view.connectionId,files:page.entries.filter(file=>selected.includes(file.path))}),
   paste:busy||clipboard?.source!=='local'?undefined:()=>{void pasteToRemote(clipboard,view.connectionId,page.path).then(()=>load(page.path)).catch(fail);},
   refresh:busy?undefined:()=>void load(page.path),up:busy?undefined:()=>void load(page.path+'/..'),
   mkdir:busy?undefined:()=>{setName('');setOperation({kind:'mkdir'});},
   upload:busy?undefined:()=>void upload(),download:busy||batch||!selected.length?undefined:()=>void downloadBatch(),
   selectAll:busy?undefined:()=>setSelected(page.entries.filter(f=>f.kind==='file'||!s3&&f.kind==='directory'&&!!downloadSelection).map(f=>f.path)),
   search:()=>{setFilterOpen(true);filterInput.current?.focus();},
   rename:busy||!one?undefined:()=>{setName(one.name);setOperation({kind:'rename',file:one});},
   remove:busy||!one?undefined:()=>void remove(one),
   chmod:ftp||s3||busy||!one||one.kind==='link'?undefined:()=>{setName((one.mode&0o777).toString(8).padStart(3,'0'));setOperation({kind:'chmod',file:one});}
  });
 });
 useEffect(()=>()=>{if(!compact)useWorkspaceCommands.getState().remove(view.id);useFileJournal.getState().clear(view.id);},[view.id,compact]);
 return <div className={(compact?"files files-compact":"files")+drop.className} {...drop.handlers} onPointerDownCapture={()=>{if(!compact)useWorkspaceCommands.getState().focus(view.id,'remote');}} data-file-display={compact?'details':preferences.fileDisplay}>
  {toolbar&&<div className="file-panel-heading"><strong title={heading+' · '+identity}>{heading}</strong><span className="file-pane-meta" title={identity}>{busy?tr('正在读取…'):page.entries.length+tr(' 个条目')}{page.truncated?tr(' · 仅显示前10000项'):''}</span><div className="file-pane-actions">
   <FileToolButton icon="mkdir" label={tr('新建目录')} disabled={busy} onClick={()=>{setName('');setOperation({kind:'mkdir'});}}/>
   <FileToolButton icon="upload" label={tr('↑ 上传文件')} disabled={busy} onClick={()=>void upload()}/>
   {downloadTo&&<FileToolButton icon="download" label={tr('← 下载所选（')+selected.length+'）'} count={selected.length} className="primary" disabled={busy||batch||!selected.length} onClick={()=>void downloadBatch()}/>}
   {chosen?.kind==='file'&&<FileDragButton connectionId={view.connectionId} file={chosen} compact/>}
   <FileToolButton icon="filter" label={tr('筛选当前目录')} aria-expanded={filterOpen} aria-pressed={filterOpen} onClick={()=>{setFilterOpen(value=>!value);if(filterOpen)setFilter('');}}/>
  </div></div>}
  {!compact&&preferences.folderTree&&<DirectoryTree load={path=>window.hornet.file.list(view.connectionId,path)} navigate={path=>void load(path)} root={view.profile.session?.remoteDirectory??'/'}/>}
  {followError&&<div className="follow-status" role="alert">{followError}</div>}
  <p className="file-drag-hint">{tr(compact?'可拖入本地文件上传；下载到桌面请先点击“准备拖出”。':'可拖入本地文件上传；将远端文件拖到左侧下载。')}</p>
  <form className="filebar" onSubmit={e=>{e.preventDefault();void load(path);}}>
   {toolbar?<FileToolButton icon="up" label={tr('↑ 上级')} disabled={busy} onClick={()=>void load(page.path+'/..')}/>:<button type="button" onClick={()=>void load(page.path+'/..')}>{tr("↑ 上级")}</button>}
   <input aria-label={tr("远端路径")} value={path} onChange={e=>setPath(e.target.value)}/>
   {toolbar?<><FileToolButton icon="go" label={tr('转到')} type="submit" disabled={busy}/><FileToolButton icon="refresh" label={tr('刷新')} disabled={busy} onClick={()=>void load(page.path)}/></>:<><button disabled={busy}>{tr("转到")}</button><button type="button" onClick={()=>void load(page.path)}>{tr("刷新")}</button>
   <button type="button" onClick={()=>{setName('');setOperation({kind:'mkdir'});}}>{tr("新建目录")}</button>
   <button type="button" className="primary" onClick={()=>void upload()}>{tr("↑ 上传文件")}</button></>}
  </form>
  {!toolbar&&downloadTo&&<div className="file-batch"><button disabled={batch||!selected.length} onClick={()=>void downloadBatch()}>{tr("← 下载所选（")}{selected.length}）</button>{chosen?.kind==='file'&&<FileDragButton connectionId={view.connectionId} file={chosen}/>}</div>}
  {!toolbar&&<div className="file-summary"><span>{identity}</span><span>{busy?tr("正在读取…"):page.entries.length+tr(" 个条目")}{page.truncated?tr(" · 仅显示前10000项"):''}</span></div>}
  {(!toolbar||filterOpen)&&<input ref={filterInput} className="file-filter" aria-label={tr("筛选当前目录")} placeholder={tr("筛选当前目录…")} value={filter} onChange={e=>setFilter(e.target.value)} onKeyDown={event=>{if(toolbar&&event.key==='Escape'){event.stopPropagation();setFilter('');setFilterOpen(false);}}}/>}
  <div className="table-scroll"><table><thead><tr>{downloadTo&&<th><input type="checkbox" disabled={busy||batch} aria-label={tr("选择全部远端文件")} checked={page.entries.some(selectable)&&page.entries.filter(selectable).every(f=>selected.includes(f.path))} onChange={e=>setSelected(e.target.checked?page.entries.filter(selectable).map(f=>f.path):[])}/></th>}<th>{tr("名称")}</th><th>{tr("大小")}</th><th>{tr("修改时间")}</th><th>{tr("权限")}</th><th>{tr("操作")}</th></tr></thead><tbody>
   {page.entries.filter(file=>file.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase())).map(file=><tr key={file.path} aria-selected={selected.includes(file.path)} tabIndex={0} onClick={event=>{if(!compact&&!busy&&!batch&&!(event.target as HTMLElement).closest('button,input'))setSelected(old=>event.ctrlKey||event.metaKey?old.includes(file.path)?old.filter(path=>path!==file.path):[...old,file.path]:[file.path]);}} onContextMenu={event=>{event.preventDefault();if(!selected.includes(file.path))setSelected([file.path]);setMenu({file,x:event.clientX,y:event.clientY,anchor:event.currentTarget});}} onKeyDown={event=>{if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();const rect=event.currentTarget.getBoundingClientRect();setMenu({file,x:rect.left+40,y:rect.bottom,anchor:event.currentTarget});}}} draggable={file.kind==='file'||(!ftp&&!s3&&file.kind==='directory')} onDragStart={event=>{if((event.target as HTMLElement).closest('button,input')){event.preventDefault();return;}const files=selected.includes(file.path)?page.entries.filter(item=>selected.includes(item.path)&&(item.kind==='file'||!ftp&&!s3&&item.kind==='directory')):[file];startFileDrag(event,{source:'remote',connectionId:view.connectionId,files});}} onDragEnd={endFileDrag} onDoubleClick={()=>file.kind==='directory'?void load(file.path):file.kind==='file'?downloadTo?void download(file):!ftp?void edit(file):undefined:undefined}>
    {downloadTo&&<td>{selectable(file)&&<input type="checkbox" aria-label={tr("选择远端文件 ")+file.name} checked={selected.includes(file.path)} onChange={e=>setSelected(old=>e.target.checked?[...old,file.path]:old.filter(p=>p!==file.path))}/>}</td>}
    <td><span className={file.kind==='directory'?'folder-icon':'file-icon'}>{file.kind==='directory'?'▰':file.kind==='link'?'↗':'▤'}</span>{file.name}</td>
    <td>{file.kind==='directory'?'—':formatBytes(file.size)}</td><td>{file.modified?formatDate(file.modified):'—'}</td><td className="mono">{file.mode?(file.mode&0o777).toString(8):'—'}</td>
    <td className="file-row-actions">{!compact&&<button className="file-more-button" aria-label={tr('文件操作')+' '+file.name} onClick={event=>{const rect=event.currentTarget.getBoundingClientRect();if(!selected.includes(file.path))setSelected([file.path]);setMenu({file,x:rect.left,y:rect.bottom,anchor:event.currentTarget});}}>⋯</button>}{file.kind==='directory'?<><button onClick={()=>void load(file.path)}>{tr("打开")}</button>{!s3&&downloadSelection&&<button onClick={()=>void download(file)}>{tr("下载目录")}</button>}</>:file.kind==='file'?<><button onClick={()=>void download(file)}>{tr("下载")}</button><FileDragButton connectionId={view.connectionId} file={file}/>{!ftp&&<button onClick={()=>void edit(file)}>{tr("编辑")}</button>}</>:<span className="muted">{file.kind==='link'?tr("符号链接"):tr("特殊文件")}</span>}{(!s3||file.kind==='file')&&<button onClick={()=>{setName(file.name);setOperation({kind:'rename',file});}}>{tr("重命名")}</button>}<button onClick={()=>void remove(file)}>{tr("删除")}</button>{!ftp&&!s3&&file.kind!=='link'&&<button onClick={()=>{setName((file.mode&0o777).toString(8).padStart(3,'0'));setOperation({kind:'chmod',file});}}>{tr("权限")}</button>}</td>
   </tr>)}
  </tbody></table>{!busy&&!page.entries.length&&<div className="empty">{tr("此目录为空")}</div>}</div>
  <p className="footnote">{toolbar&&<span className="file-connection-identity">{identity}</span>}{s3?'S3 objects support upload, download, preview, rename, and delete. POSIX permissions and folder rename are not available.':ftp?tr("FTP 传输使用新文件名并校验内容；暂停后从头重传。服务器不保证并发重命名不覆盖，请勿并发修改同一目标。") : tr("传输进度显示在底部；同名文件会提示处理方式。双击文件进行传输，右键打开更多操作。")}</p>
  {!compact&&preferences.fileLog&&<section className="file-operation-log" aria-label={tr('会话日志')}><h3>{tr('会话日志')}</h3><ol>{journal.map((entry,index)=><li key={index} className={entry.failed?'error':''}>{formatDate(entry.at)} · {entry.message}</li>)}</ol><button onClick={()=>useFileJournal.getState().clear(view.id)}>{tr('清空日志')}</button></section>}
  {menu&&<ContextMenu label="文件操作" items={menuItems} x={menu.x} y={menu.y} anchor={menu.anchor} dismiss={()=>setMenu(null)}/>}
  {operation&&<div className="modal-backdrop"><form className="modal" onSubmit={e=>{e.preventDefault();void mutate();}}><h2>{operation.kind==='chmod'?tr("修改权限"):operation.kind==='mkdir'?tr("新建远端目录"):tr("重命名")}</h2>{operation.kind==='chmod'&&<p>{tr("三位八进制权限（000–777），会清除特殊权限位。路径在服务器端并发变化时无法保证原子性。")}</p>}<label>{operation.kind==='chmod'?tr("八进制权限"):tr("名称")}<input autoFocus required value={name} onChange={e=>setName(e.target.value)}/></label><div className="modal-actions"><button type="button" onClick={()=>setOperation(null)}>{tr("取消")}</button><button className="primary">{tr("确认")}</button></div></form></div>}
 </div>;
}
export function formatBytes(n:number){if(n<1024)return n+' B';if(n<1048576)return(n/1024).toFixed(1)+' KiB';if(n<1073741824)return(n/1048576).toFixed(1)+' MiB';return(n/1073741824).toFixed(2)+' GiB';}
export function EditorView({view}:{view:View}){
 const [content,setContent]=useState(view.content??''),[hash,setHash]=useState(view.hash??''),[saved,setSaved]=useState(view.content??''),[busy,setBusy]=useState(false);
 const save=async()=>{setBusy(true);try{const result=await window.hornet.file.save(view.connectionId,view.path!,content,hash);setHash(result.hash);setSaved(content);}catch(e){useStore.getState().fail(e);}finally{setBusy(false);}};
 useEffect(()=>{const listener=(e:BeforeUnloadEvent)=>{if(content!==saved){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',listener);return()=>window.removeEventListener('beforeunload',listener);},[content,saved]);
 return <div className="editor"><div className="filebar"><span className="mono">{view.path}{content!==saved?' ●':''}</span><button className="primary" disabled={busy||content===saved} onClick={()=>void save()}>{tr("保存到远端")}</button></div>
 <textarea aria-label={tr("远程文件编辑器")} spellCheck={false} value={content} onChange={e=>setContent(e.target.value)} onKeyDown={e=>{if(e.ctrlKey&&e.key==='s'){e.preventDefault();void save();}}}/>
 <p className="footnote">{tr("保存前检查内容版本；只在服务端支持原子替换时提交。与外部写入者之间仍可能存在竞争，请勿用于并发编辑同一文件。")}</p></div>;
}
