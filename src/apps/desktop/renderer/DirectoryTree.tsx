import { useState } from 'react';
import { t as tr } from './i18n';
type Directory={name:string;path:string};
export function DirectoryTree({load,navigate,root='/'}:{load:(path:string)=>Promise<{path:string;entries:{name:string;path:string;kind:string}[]}>;navigate:(path:string)=>void;root?:string}){
 return <aside className="directory-tree" aria-label={tr('文件夹树')}><TreeNode path={root} name={root||'/'} depth={0} load={load} navigate={navigate}/></aside>;
}
function TreeNode({path,name,depth,load,navigate}:{path:string;name:string;depth:number;load:(path:string)=>Promise<{path:string;entries:{name:string;path:string;kind:string}[]}>;navigate:(path:string)=>void}){
 const [children,setChildren]=useState<Directory[]>([]),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function expand(){if(open){setOpen(false);return;}if(busy)return;setBusy(true);setError('');try{const page=await load(path);setChildren(page.entries.filter(entry=>entry.kind==='directory').slice(0,1000));setOpen(true);}catch(e){setError(String(e));}finally{setBusy(false);}}
 return <div style={{paddingLeft:depth?14:0}}><div className="directory-tree-row"><button disabled={busy||depth>=31} aria-label={tr('展开目录')+' '+name} aria-expanded={open} onClick={()=>void expand()}>{busy?'…':open?'−':'+'}</button><button title={path} onClick={()=>navigate(path)}>▰ {name}</button></div>{error&&<p role="alert">{error}</p>}{open&&children.map(child=><TreeNode key={child.path} {...child} depth={depth+1} load={load} navigate={navigate}/>)}</div>;
}
