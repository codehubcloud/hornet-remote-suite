import { useState,type DragEvent } from 'react';
import type { FileClipboard } from './file-clipboard';
const mime='application/x-hornet-file-drag';
let active:{token:string;value:FileClipboard}|undefined;
export function startFileDrag(event:DragEvent,value:FileClipboard){
 active={token:crypto.randomUUID(),value};event.dataTransfer.effectAllowed='copy';event.dataTransfer.setData(mime,active.token);
}
export function endFileDrag(){active=undefined;}
export function readFileDrag(transfer:DataTransfer){return active&&transfer.getData(mime)===active.token?active.value:undefined;}
export function useFileDrop(enabled:boolean,accept:(value:FileClipboard)=>boolean,drop:(value:FileClipboard)=>Promise<unknown>,external?:(files:File[])=>Promise<unknown>,fail:(error:unknown)=>void=()=>{}){
 const [over,setOver]=useState(false);
 const supports=(transfer:DataTransfer)=>enabled&&((transfer.types.includes(mime)&&!!active&&accept(active.value))||(!transfer.types.includes(mime)&&!!external&&transfer.types.includes('Files')));
 return {className:over?' file-drop-active':'',handlers:{
  onDragOver(event:DragEvent){if(!supports(event.dataTransfer))return;event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='copy';setOver(true);},
  onDragLeave(event:DragEvent){if(!(event.relatedTarget instanceof Node)||!event.currentTarget.contains(event.relatedTarget))setOver(false);},
  onDrop(event:DragEvent){setOver(false);if(!supports(event.dataTransfer))return;event.preventDefault();event.stopPropagation();const value=readFileDrag(event.dataTransfer),files=Array.from(event.dataTransfer.files);endFileDrag();void Promise.resolve().then(()=>value?drop(value):files.length&&external?external(files):undefined).catch(fail);}
 }};
}
