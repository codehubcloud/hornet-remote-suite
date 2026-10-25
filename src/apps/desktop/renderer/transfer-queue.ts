import { create } from 'zustand';
import type { ConflictAction,TransferConflict,TransferRequest } from '../../../packages/contracts/file-transfer';
import { useStore } from './store';
export interface TransferBatch {policy?:ConflictAction;cancelled?:boolean}
export const useTransferActivity=create<{requests:number;pending:number;begin:()=>void;end:()=>void}>(set=>({requests:0,pending:0,begin:()=>set(state=>({requests:state.requests+1,pending:state.pending+1})),end:()=>set(state=>({pending:Math.max(0,state.pending-1)}))}));
interface Choice {action:ConflictAction;all:boolean;name?:string}
interface Question {conflict:TransferConflict;answer:(choice:Choice)=>void}
export const useTransferConflicts=create<{questions:Question[];ask:(conflict:TransferConflict)=>Promise<Choice>;answer:(choice:Choice)=>void}>((set,get)=>({
 questions:[],ask:conflict=>new Promise(resolve=>set(state=>({questions:[...state.questions,{conflict,answer:resolve}]}))),
 answer:choice=>{const question=get().questions[0];if(!question)return;set(state=>({questions:state.questions.slice(1)}));question.answer(choice);}
}));
export async function queueTransfer(request:TransferRequest,batch:TransferBatch={}){
 if(batch.cancelled)return null;
 useTransferActivity.getState().begin();try{
 let result=await window.hornet.transfer.prepare(request);
 if(result.kind==='conflict'){
  const conflict=result.conflict,canApply=batch.policy&&(!['replace','newer'].includes(batch.policy)||conflict.canReplace);
  const choice:Choice=canApply?{action:batch.policy!,all:true}:await useTransferConflicts.getState().ask(conflict);
  if(choice.all)batch.policy=choice.action;
  result=await window.hornet.transfer.resolve(conflict.id,choice.action,choice.name);
 }
 if(result.kind==='cancelled')batch.cancelled=true;
 if(result.kind==='started'){useStore.getState().event({type:'task.state',task:result.task});return result.task;}
 return null;
 }finally{useTransferActivity.getState().end();}
}
