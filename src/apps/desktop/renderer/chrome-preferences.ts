import { create } from 'zustand';
import { z } from 'zod';
const section=z.enum(['standard','address','links']);
const schema=z.object({menu:z.boolean(),standard:z.boolean(),address:z.boolean(),links:z.boolean(),locked:z.boolean(),order:z.array(section).length(3).refine(v=>new Set(v).size===3),bookmarks:z.array(z.string().uuid()).max(100)}).strict();
export const chromeDefaults:z.infer<typeof schema>={menu:true,standard:true,address:true,links:true,locked:true,order:['standard','address','links'],bookmarks:[]};
function read(){try{return schema.parse(JSON.parse(localStorage.getItem('hornet.chrome.v1')??''));}catch{return {...chromeDefaults};}}
export const useChromePreferences=create<{value:z.infer<typeof schema>;change:(patch:Partial<z.infer<typeof schema>>)=>void}>(set=>({value:read(),change:patch=>set(s=>{const value=schema.parse({...s.value,...patch});localStorage.setItem('hornet.chrome.v1',JSON.stringify(value));return {value};})}));
