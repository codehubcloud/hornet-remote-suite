import { useAppearance } from './appearance';
import { english } from './locales/en';
import { catalogs } from './locales/catalogs';
/** Only pass application copy here. Host names, paths and terminal output are user data. */
export function t(source:string,params:Record<string,string|number>={}):string{
 const key=source.trim(),language=useAppearance.getState().value.language;
 if(!key)return source;
 const catalog=language==='zh-CN'?undefined:language==='en'?english:catalogs[language];
 const translated=language==='zh-CN'?key:catalog&&Object.prototype.hasOwnProperty.call(catalog,key)?catalog[key]:Object.prototype.hasOwnProperty.call(english,key)?english[key]:key;
 const result=translated.replace(/\{(\w+)\}/g,(match,key)=>Object.prototype.hasOwnProperty.call(params,key)?String(params[key]):match);
 return (source.match(/^\s*/)?.[0]??'')+result+(source.match(/\s*$/)?.[0]??'');
}
export function formatDate(value:number){return new Date(value).toLocaleString(useAppearance.getState().value.language);}
