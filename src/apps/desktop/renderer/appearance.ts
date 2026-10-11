import { create } from 'zustand';
export const languages = [{id:'zh-CN',name:'简体中文'}, {id:'en',name:'English'}] as const;
export const themes = ['light','dark','solarized','contrast','system'] as const;
export type Language = typeof languages[number]['id'];
export type Theme = typeof themes[number];
export type Appearance = {language:Language;theme:Theme};
export const appearanceKey='hornet.appearance.v1';
export function readAppearance(raw:string|null):Appearance {
 try {const v=JSON.parse(raw??'null');if(v&&languages.some(l=>l.id===v.language)&&themes.includes(v.theme))return {language:v.language,theme:v.theme};}catch{}
 return {language:'zh-CN',theme:'light'};
}
function initial(){try{return readAppearance(localStorage.getItem(appearanceKey));}catch{return readAppearance(null);}}
export const useAppearance=create<{value:Appearance;save:(value:Appearance)=>void}>(set=>({value:initial(),save:value=>{
 if(!languages.some(l=>l.id===value.language)||!themes.includes(value.theme))throw new Error('Invalid appearance preference');
 localStorage.setItem(appearanceKey,JSON.stringify(value));set({value});
}}));
export function applyAppearance(value:Appearance,dark=false){
 document.documentElement.lang=value.language;
 document.documentElement.dataset.theme=value.theme==='system'?(dark?'dark':'light'):value.theme;
}
export function observeAppearance(){
 const media=window.matchMedia('(prefers-color-scheme: dark)');
 const update=()=>applyAppearance(useAppearance.getState().value,media.matches);
 update();const stop=useAppearance.subscribe(update);media.addEventListener('change',update);
 return()=>{stop();media.removeEventListener('change',update);};
}
