import { useEffect,useRef,useState } from 'react';
import type { FileEntry,FilePage } from '../../../packages/contracts';
import { useStore,type View } from './store';
export function FileView({view,compact=false,followTarget}:{view:View;compact?:boolean;followTarget?:{terminalId:string;path:string}}){
 const request=useRef(0),wasFollowing=useRef(false);
 const [followError,setFollowError]=useState('');
 const [filter,setFilter]=useState('');
 const [page,setPage]=useState<FilePage>({path:'.',entries:[],truncated:false});
 const [path,setPath]=useState('.'),[busy,setBusy]=useState(false);
 const [operation,setOperation]=useState<{kind:'mkdir'|'rename'|'chmod';file?:FileEntry}|null>(null),[name,setName]=useState('');
 const fail=useStore(s=>s.fail);
 async function load(path:string,quiet=false){const current=++request.current;setBusy(true);try{const p=await window.hornet.file.list(view.connectionId,path);if(current===request.current){setPage(p);setPath(p.path);setFollowError('');}}catch(e){if(current===request.current){if(quiet)setFollowError(e instanceof Error?e.message:'无法跟随目录');else fail(e);}}finally{if(current===request.current)setBusy(false);}}
 useEffect(()=>{void load('.');return()=>{request.current++;};},[view.connectionId]);
 useEffect(()=>{if(followTarget)void load(followTarget.path,true);else if(wasFollowing.current){request.current++;setBusy(false);setFollowError('');}wasFollowing.current=Boolean(followTarget);},[followTarget?.path,followTarget?.terminalId]);
 async function upload(){
  try{const grant=await window.hornet.file.choose('upload');if(!grant)return;
   const remote=(page.path==='/'?'':page.path)+'/'+grant.name;
   await window.hornet.transfer.start(view.connectionId,'upload',grant.pathGrantId,remote,crypto.randomUUID());
  }catch(e){fail(e);}
 }
 async function download(file:FileEntry){try{const grant=await window.hornet.file.choose('download',file.name);if(grant)await window.hornet.transfer.start(view.connectionId,'download',grant.pathGrantId,file.path,crypto.randomUUID());}catch(e){fail(e);}}
 async function mutate(){
  if(operation?.kind==='chmod'){if(!/^[0-7]{3}$/.test(name)){fail(new Error('请输入三位八进制权限，例如 644。'));return;}try{await window.hornet.file.chmod(view.connectionId,operation.file!.path,parseInt(name,8));setOperation(null);await load(page.path);}catch(e){fail(e);}return;}
  if(!operation||!name||name==='.'||name==='..'||name.includes('/')||name.includes('\\')){fail(new Error('请输入不包含目录分隔符的名称。'));return;}
  try{const target=(page.path==='/'?'':page.path)+'/'+name;
   if(operation.kind==='mkdir')await window.hornet.file.mkdir(view.connectionId,target);
   else await window.hornet.file.rename(view.connectionId,operation.file!.path,target);
   setOperation(null);await load(page.path);
  }catch(e){fail(e);}
 }
 async function remove(file:FileEntry){if(!window.confirm('从 '+view.profile.name+' 删除 '+file.path+'？此操作不能撤销，目录仅允许为空。'))return;try{await window.hornet.file.remove(view.connectionId,file.path);await load(page.path);}catch(e){fail(e);}}
 async function edit(file:FileEntry){
  let lease:Awaited<ReturnType<typeof window.hornet.connection.open>>|undefined;
  try{lease=await window.hornet.connection.open(view.profile.profileId,'files');const data=await window.hornet.file.read(lease.connectionId,file.path);
   useStore.getState().addView({id:crypto.randomUUID(),kind:'editor',profile:view.profile,...lease,path:file.path,...data});
  }catch(e){if(lease)await window.hornet.connection.release(lease.leaseId);fail(e);}
 }
 return <div className={compact?"files files-compact":"files"}>
  {followError&&<div className="follow-status" role="alert">{followError}</div>}
  <form className="filebar" onSubmit={e=>{e.preventDefault();void load(path);}}>
   <button type="button" onClick={()=>void load(page.path+'/..')}>↑ 上级</button>
   <input aria-label="远端路径" value={path} onChange={e=>setPath(e.target.value)}/>
   <button disabled={busy}>转到</button><button type="button" onClick={()=>void load(page.path)}>刷新</button>
   <button type="button" onClick={()=>{setName('');setOperation({kind:'mkdir'});}}>新建目录</button>
   <button type="button" className="primary" onClick={()=>void upload()}>↑ 上传文件</button>
  </form>
  <div className="file-summary"><span>SFTP · {view.profile.username}@{view.profile.host}</span><span>{busy?'正在读取…':page.entries.length+' 个条目'}{page.truncated?' · 仅显示前10000项':''}</span></div>
  <input className="file-filter" aria-label="筛选当前目录" placeholder="筛选当前目录…" value={filter} onChange={e=>setFilter(e.target.value)}/>
  <div className="table-scroll"><table><thead><tr><th>名称</th><th>大小</th><th>修改时间</th><th>权限</th><th>操作</th></tr></thead><tbody>
   {page.entries.filter(file=>file.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase())).map(file=><tr key={file.path} onDoubleClick={()=>file.kind==='directory'?void load(file.path):file.kind==='file'?void edit(file):undefined}>
    <td><span className={file.kind==='directory'?'folder-icon':'file-icon'}>{file.kind==='directory'?'▰':file.kind==='link'?'↗':'▤'}</span>{file.name}</td>
    <td>{file.kind==='directory'?'—':formatBytes(file.size)}</td><td>{new Date(file.modified).toLocaleString()}</td><td className="mono">{(file.mode&0o777).toString(8)}</td>
    <td>{file.kind==='directory'?<button onClick={()=>void load(file.path)}>打开</button>:file.kind==='file'?<><button onClick={()=>void download(file)}>下载</button><button onClick={()=>void edit(file)}>编辑</button></>:<span className="muted">符号链接</span>}<button onClick={()=>{setName(file.name);setOperation({kind:'rename',file});}}>重命名</button><button onClick={()=>void remove(file)}>删除</button>{file.kind!=='link'&&<button onClick={()=>{setName((file.mode&0o777).toString(8).padStart(3,'0'));setOperation({kind:'chmod',file});}}>权限</button>}</td>
   </tr>)}
  </tbody></table>{!busy&&!page.entries.length&&<div className="empty">此目录为空</div>}</div>
  <p className="footnote">传输在后台继续。上传与下载均使用新文件名，不覆盖已有目标；双击小型 UTF-8 文本可编辑。</p>
  {operation&&<div className="modal-backdrop"><form className="modal" onSubmit={e=>{e.preventDefault();void mutate();}}><h2>{operation.kind==='chmod'?'修改权限':operation.kind==='mkdir'?'新建远端目录':'重命名'}</h2>{operation.kind==='chmod'&&<p>三位八进制权限（000–777），会清除特殊权限位。路径在服务器端并发变化时无法保证原子性。</p>}<label>{operation.kind==='chmod'?'八进制权限':'名称'}<input autoFocus required value={name} onChange={e=>setName(e.target.value)}/></label><div className="modal-actions"><button type="button" onClick={()=>setOperation(null)}>取消</button><button className="primary">确认</button></div></form></div>}
 </div>;
}
export function formatBytes(n:number){if(n<1024)return n+' B';if(n<1048576)return(n/1024).toFixed(1)+' KiB';if(n<1073741824)return(n/1048576).toFixed(1)+' MiB';return(n/1073741824).toFixed(2)+' GiB';}
export function EditorView({view}:{view:View}){
 const [content,setContent]=useState(view.content??''),[hash,setHash]=useState(view.hash??''),[saved,setSaved]=useState(view.content??''),[busy,setBusy]=useState(false);
 const save=async()=>{setBusy(true);try{const result=await window.hornet.file.save(view.connectionId,view.path!,content,hash);setHash(result.hash);setSaved(content);}catch(e){useStore.getState().fail(e);}finally{setBusy(false);}};
 useEffect(()=>{const listener=(e:BeforeUnloadEvent)=>{if(content!==saved){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',listener);return()=>window.removeEventListener('beforeunload',listener);},[content,saved]);
 return <div className="editor"><div className="filebar"><span className="mono">{view.path}{content!==saved?' ●':''}</span><button className="primary" disabled={busy||content===saved} onClick={()=>void save()}>保存到远端</button></div>
 <textarea aria-label="远程文件编辑器" spellCheck={false} value={content} onChange={e=>setContent(e.target.value)} onKeyDown={e=>{if(e.ctrlKey&&e.key==='s'){e.preventDefault();void save();}}}/>
 <p className="footnote">保存前检查内容版本；只在服务端支持原子替换时提交。与外部写入者之间仍可能存在竞争，请勿用于并发编辑同一文件。</p></div>;
}
