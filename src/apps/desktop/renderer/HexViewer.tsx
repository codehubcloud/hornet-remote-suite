import { useRef,useState } from 'react';
import { t as tr } from './i18n';
export function HexViewer({close}:{close:()=>void}){
 const [file,setFile]=useState<File|null>(null),[bytes,setBytes]=useState(new Uint8Array()),[page,setPage]=useState(0),[error,setError]=useState('');
 const generation=useRef(0),pages=Math.max(1,Math.ceil((file?.size??0)/4096));
 async function read(next:File|null,index:number){const id=++generation.current;setFile(next);setPage(index);setError('');setBytes(new Uint8Array());if(!next)return;try{const buffer=await next.slice(index*4096,(index+1)*4096).arrayBuffer();if(id===generation.current)setBytes(new Uint8Array(buffer));}catch(e){if(id===generation.current)setError(String(e));}}
 const lines=[];
 for(let i=0;i<bytes.length;i+=16){const row=bytes.slice(i,i+16);lines.push((page*4096+i).toString(16).padStart(8,'0')+'  '+Array.from(row,b=>b.toString(16).padStart(2,'0')).join(' ').padEnd(47,' ')+'  '+Array.from(row,b=>b>=32&&b<127?String.fromCharCode(b):'.').join(''));}
 return <div className="modal-backdrop"><section className="modal hex-viewer" role="dialog" aria-modal="true" aria-label={tr('十六进制查看器')}><h2>{tr('十六进制查看器')}</h2><label>{tr('打开文件')}<input type="file" onChange={e=>void read(e.target.files?.[0]??null,0)}/></label><p>{file?.name} {file?`${file.size.toLocaleString()} B`:''}</p>{error&&<p role="alert">{error}</p>}<pre style={{overflow:'auto',maxHeight:'55vh',whiteSpace:'pre',userSelect:'text',fontFamily:'monospace'}}>{lines.join('\n')}</pre><div className="modal-actions"><button disabled={page===0} onClick={()=>void read(file,page-1)}>{tr('上一个')}</button><span>{page+1} / {pages}</span><button disabled={page+1>=pages} onClick={()=>void read(file,page+1)}>{tr('下一个')}</button><button onClick={close}>{tr('关闭')}</button></div></section></div>;
}
