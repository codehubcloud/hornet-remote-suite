import { t as tr,formatDate } from './i18n';
import { useWorkspaceCommands } from './workspace-commands';
import { useEffect,useRef,useState } from 'react';
import type { FileEntry,FilePage } from '../../../packages/contracts';
import { useStore,type View } from './store';
export function FileView({view,compact=false,followTarget,onDirectory,uploadSelected,downloadTo,downloadSelection,refreshKey=0}:{view:View;compact?:boolean;followTarget?:{terminalId:string;path:string};onDirectory?:(path:string|null)=>void;uploadSelected?:()=>Promise<void>;downloadTo?:(file:FileEntry)=>Promise<void>;downloadSelection?:(files:FileEntry[])=>Promise<void>;refreshKey?:number}){
 const ftp=view.profile.protocol==='ftp';
 const [selected,setSelected]=useState<string[]>([]),[batch,setBatch]=useState(false);
 const request=useRef(0),wasFollowing=useRef(false),location=useRef('.');
 const [followError,setFollowError]=useState('');
 const [filter,setFilter]=useState(''),filterInput=useRef<HTMLInputElement>(null);
 const [page,setPage]=useState<FilePage>({path:'.',entries:[],truncated:false});
 const [path,setPath]=useState('.'),[busy,setBusy]=useState(false);
 const [operation,setOperation]=useState<{kind:'mkdir'|'rename'|'chmod';file?:FileEntry}|null>(null),[name,setName]=useState('');
 const fail=useStore(s=>s.fail);
 async function load(path:string,quiet=false){const current=++request.current;location.current=path;onDirectory?.(null);setBusy(true);try{const p=await window.hornet.file.list(view.connectionId,path);if(current===request.current){location.current=p.path;setPage(p);setPath(p.path);setSelected([]);onDirectory?.(p.path);setFollowError('');}}catch(e){if(current===request.current){if(quiet)setFollowError(e instanceof Error?e.message:tr("无法跟随目录"));else fail(e);}}finally{if(current===request.current)setBusy(false);}}
 useEffect(()=>{void load('.');return()=>{request.current++;};},[view.connectionId]);
 useEffect(()=>{if(followTarget)void load(followTarget.path,true);else if(wasFollowing.current){request.current++;setBusy(false);setFollowError('');}wasFollowing.current=Boolean(followTarget);},[followTarget?.path,followTarget?.terminalId]);
 useEffect(()=>{if(refreshKey)void load(location.current);},[refreshKey]);
 async function downloadBatch(){setBatch(true);try{const items=page.entries.filter(f=>selected.includes(f.path));if(items.some(f=>f.kind==='directory')&&downloadSelection){await downloadSelection(items);setSelected([]);return;}for(const file of items.filter(f=>(f.kind==='file'||(f.kind==='directory'&&!!downloadSelection)))){if(downloadTo)await downloadTo(file);}setSelected([]);}catch(e){fail(e);}finally{setBatch(false);}}
 async function upload(){
  if(uploadSelected){await uploadSelected();return;}
  try{const grant=await window.hornet.file.choose('upload');if(!grant)return;
   const remote=(page.path==='/'?'':page.path)+'/'+grant.name;
   await window.hornet.transfer.start(view.connectionId,'upload',grant.pathGrantId,remote,crypto.randomUUID());
  }catch(e){fail(e);}
 }
 async function download(file:FileEntry){try{if(downloadTo){await downloadTo(file);return;}const grant=await window.hornet.file.choose('download',file.name);if(grant)await window.hornet.transfer.start(view.connectionId,'download',grant.pathGrantId,file.path,crypto.randomUUID());}catch(e){fail(e);}}
 async function mutate(){
  if(operation?.kind==='chmod'){if(!/^[0-7]{3}$/.test(name)){fail(new Error(tr("请输入三位八进制权限，例如 644。")));return;}try{await window.hornet.file.chmod(view.connectionId,operation.file!.path,parseInt(name,8));setOperation(null);await load(page.path);}catch(e){fail(e);}return;}
  if(!operation||!name||name==='.'||name==='..'||name.includes('/')||name.includes('\\')){fail(new Error(tr("请输入不包含目录分隔符的名称。")));return;}
  try{const target=(page.path==='/'?'':page.path)+'/'+name;
   if(operation.kind==='mkdir')await window.hornet.file.mkdir(view.connectionId,target);
   else await window.hornet.file.rename(view.connectionId,operation.file!.path,target);
   setOperation(null);await load(page.path);
  }catch(e){fail(e);}
 }
 async function remove(file:FileEntry){if(!window.confirm(tr("从 ")+view.profile.name+tr(" 删除 ")+file.path+tr("？此操作不能撤销，目录仅允许为空。")))return;try{await window.hornet.file.remove(view.connectionId,file.path);await load(page.path);}catch(e){fail(e);}}
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
   refresh:busy?undefined:()=>void load(page.path),up:busy?undefined:()=>void load(page.path+'/..'),
   mkdir:busy?undefined:()=>{setName('');setOperation({kind:'mkdir'});},
   upload:busy?undefined:()=>void upload(),download:busy||batch||!selected.length?undefined:()=>void downloadBatch(),
   selectAll:busy?undefined:()=>setSelected(page.entries.filter(f=>f.kind==='file'||f.kind==='directory'&&!!downloadSelection).map(f=>f.path)),
   search:()=>filterInput.current?.focus(),
   rename:busy||!one?undefined:()=>{setName(one.name);setOperation({kind:'rename',file:one});},
   remove:busy||!one?undefined:()=>void remove(one),
   chmod:ftp||busy||!one||one.kind==='link'?undefined:()=>{setName((one.mode&0o777).toString(8).padStart(3,'0'));setOperation({kind:'chmod',file:one});}
  });
 });
 useEffect(()=>()=>{if(!compact)useWorkspaceCommands.getState().remove(view.id);},[view.id,compact]);
 return <div className={compact?"files files-compact":"files"}>
  {followError&&<div className="follow-status" role="alert">{followError}</div>}
  <form className="filebar" onSubmit={e=>{e.preventDefault();void load(path);}}>
   <button type="button" onClick={()=>void load(page.path+'/..')}>{tr("↑ 上级")}</button>
   <input aria-label={tr("远端路径")} value={path} onChange={e=>setPath(e.target.value)}/>
   <button disabled={busy}>{tr("转到")}</button><button type="button" onClick={()=>void load(page.path)}>{tr("刷新")}</button>
   <button type="button" onClick={()=>{setName('');setOperation({kind:'mkdir'});}}>{tr("新建目录")}</button>
   <button type="button" className="primary" onClick={()=>void upload()}>{tr("↑ 上传文件")}</button>
  </form>
  {downloadTo&&<div className="file-batch"><button disabled={batch||!selected.length} onClick={()=>void downloadBatch()}>{tr("← 下载所选（")}{selected.length}）</button></div>}
  <div className="file-summary"><span>{ftp?(view.profile.ftpSecurity==='none'?'FTP':'FTPS'):'SFTP'} · {view.profile.username}@{view.profile.host}</span><span>{busy?tr("正在读取…"):page.entries.length+tr(" 个条目")}{page.truncated?tr(" · 仅显示前10000项"):''}</span></div>
  <input ref={filterInput} className="file-filter" aria-label={tr("筛选当前目录")} placeholder={tr("筛选当前目录…")} value={filter} onChange={e=>setFilter(e.target.value)}/>
  <div className="table-scroll"><table><thead><tr>{downloadTo&&<th><input type="checkbox" aria-label={tr("选择全部远端文件")} checked={page.entries.some(f=>(f.kind==='file'||(f.kind==='directory'&&!!downloadSelection)))&&page.entries.filter(f=>(f.kind==='file'||(f.kind==='directory'&&!!downloadSelection))).every(f=>selected.includes(f.path))} onChange={e=>setSelected(e.target.checked?page.entries.filter(f=>(f.kind==='file'||(f.kind==='directory'&&!!downloadSelection))).map(f=>f.path):[])}/></th>}<th>{tr("名称")}</th><th>{tr("大小")}</th><th>{tr("修改时间")}</th><th>{tr("权限")}</th><th>{tr("操作")}</th></tr></thead><tbody>
   {page.entries.filter(file=>file.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase())).map(file=><tr key={file.path} onDoubleClick={()=>file.kind==='directory'?void load(file.path):file.kind==='file'&&!ftp?void edit(file):undefined}>
    {downloadTo&&<td>{(file.kind==='file'||(file.kind==='directory'&&!!downloadSelection))&&<input type="checkbox" aria-label={tr("选择远端文件 ")+file.name} checked={selected.includes(file.path)} onChange={e=>setSelected(old=>e.target.checked?[...old,file.path]:old.filter(p=>p!==file.path))}/>}</td>}
    <td><span className={file.kind==='directory'?'folder-icon':'file-icon'}>{file.kind==='directory'?'▰':file.kind==='link'?'↗':'▤'}</span>{file.name}</td>
    <td>{file.kind==='directory'?'—':formatBytes(file.size)}</td><td>{file.modified?formatDate(file.modified):'—'}</td><td className="mono">{file.mode?(file.mode&0o777).toString(8):'—'}</td>
    <td>{file.kind==='directory'?<><button onClick={()=>void load(file.path)}>{tr("打开")}</button>{downloadSelection&&<button onClick={()=>void download(file)}>{tr("下载目录")}</button>}</>:file.kind==='file'?<><button onClick={()=>void download(file)}>{tr("下载")}</button>{!ftp&&<button onClick={()=>void edit(file)}>{tr("编辑")}</button>}</>:<span className="muted">{file.kind==='link'?tr("符号链接"):tr("特殊文件")}</span>}<button onClick={()=>{setName(file.name);setOperation({kind:'rename',file});}}>{tr("重命名")}</button><button onClick={()=>void remove(file)}>{tr("删除")}</button>{!ftp&&file.kind!=='link'&&<button onClick={()=>{setName((file.mode&0o777).toString(8).padStart(3,'0'));setOperation({kind:'chmod',file});}}>{tr("权限")}</button>}</td>
   </tr>)}
  </tbody></table>{!busy&&!page.entries.length&&<div className="empty">{tr("此目录为空")}</div>}</div>
  <p className="footnote">{ftp?tr("FTP 传输使用新文件名并校验内容；暂停后从头重传。服务器不保证并发重命名不覆盖，请勿并发修改同一目标。") : tr("传输在后台继续。上传与下载均使用新文件名，不覆盖已有目标；双击小型 UTF-8 文本可编辑。")}</p>
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
