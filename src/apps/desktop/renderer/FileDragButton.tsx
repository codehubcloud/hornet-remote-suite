import { useEffect,useRef,useState } from 'react';
import type { FileEntry } from '../../../packages/contracts';
import { useStore } from './store';
import { t } from './i18n';
import { FileToolIcon } from './FileToolbar';
export function FileDragButton({connectionId,file,compact=false}:{connectionId:string;file:FileEntry;compact?:boolean}){
 const [token,setToken]=useState(''),[busy,setBusy]=useState(false),generation=useRef(0),working=useRef(false);
 useEffect(()=>{generation.current++;setToken('');setBusy(false);working.current=false;return()=>{generation.current++;};},[connectionId,file.path,file.size,file.modified]);
 async function prepare(){if(working.current||token)return;const current=generation.current;working.current=true;setBusy(true);try{const result=await window.hornet.fileDrag.prepare(connectionId,[{path:file.path,name:file.name}]);if(current===generation.current)setToken(result.token);}catch(error){if(current===generation.current)useStore.getState().fail(error);}finally{if(current===generation.current){working.current=false;setBusy(false);}}}
 const label=t(busy?'正在准备拖出…':token?'拖到桌面':'准备拖出');
 return <button className={'native-file-drag'+(compact?' file-tool-button':'')} aria-label={label} aria-busy={busy} disabled={busy} draggable={!!token} title={label+' · '+t('先下载并校验文件，再拖到桌面或资源管理器。')} onClick={()=>void prepare()} onDragStart={event=>{event.preventDefault();event.stopPropagation();if(token)window.hornet.fileDrag.start(token);}}>{compact?<FileToolIcon icon={token?'download':'export'}/>:label}</button>;
}
