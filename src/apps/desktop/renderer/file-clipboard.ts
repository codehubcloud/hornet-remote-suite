import { create } from 'zustand';
export type FileClipboard={source:'local';rootId:string;paths:string[]}|{source:'remote';connectionId:string;files:{name:string;path:string;kind:string}[]};
export const useFileClipboard=create<{value:FileClipboard|null;set:(value:FileClipboard)=>void}>(set=>({value:null,set:value=>set({value})}));
