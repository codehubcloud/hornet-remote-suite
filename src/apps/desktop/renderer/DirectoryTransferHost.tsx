import { useEffect,useState } from 'react';
import { create } from 'zustand';
import { TreeTransferDialog } from './TreeTransferDialog';
import type { TreeRequest,TreePreview,SyncPolicy } from '../../../packages/contracts/file-tree';
import { useTransferActivity } from './transfer-queue';
import { useStore } from './store';
interface Question {request:TreeRequest;preview:TreePreview;resolve:(executed:boolean)=>void;reject:(error:unknown)=>void}
const useDirectoryTransfers=create<{questions:Question[];add:(question:Question)=>void;remove:()=>void}>(set=>({questions:[],add:question=>set(state=>({questions:[...state.questions,question]})),remove:()=>set(state=>({questions:state.questions.slice(1)}))}));
export async function queueDirectoryTransfer(request:TreeRequest){
 useTransferActivity.getState().begin();try{const preview=await window.hornet.treeTransfer.preview(request);return await new Promise<boolean>((resolve,reject)=>useDirectoryTransfers.getState().add({request,preview,resolve,reject}));}finally{useTransferActivity.getState().end();}
}
export function DirectoryTransferHost(){const question=useDirectoryTransfers(state=>state.questions[0]);return question?<DirectoryQuestion key={question.preview.planId} question={question}/>:null;}
function DirectoryQuestion({question}:{question:Question}){
 const [preview,setPreview]=useState(question.preview),[busy,setBusy]=useState(false);
 const finish=(executed:boolean)=>{question.resolve(executed);useDirectoryTransfers.getState().remove();};
 const discard=(plan:TreePreview)=>window.hornet.treeTransfer.discard(plan.planId).catch(()=>{});
 async function recompare(policy:SyncPolicy){setBusy(true);try{const next=await window.hornet.treeTransfer.preview({...question.request,policy});await discard(preview);setPreview(next);}catch(error){useStore.getState().fail(error);}finally{setBusy(false);}}
 async function execute(){setBusy(true);try{const result=await window.hornet.treeTransfer.execute(preview.planId);if(result.error)throw new Error(result.error);await discard(preview);finish(true);}catch(error){useStore.getState().fail(error);}finally{setBusy(false);}}
 function close(){void discard(preview);finish(false);}
 useEffect(()=>{const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!busy){event.preventDefault();close();}};window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape);},[preview,busy]);
 return <TreeTransferDialog preview={preview} busy={busy} execute={()=>void execute()} close={close} recompare={policy=>void recompare(policy)}/>;
}
