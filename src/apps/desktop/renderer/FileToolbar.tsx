import type { ButtonHTMLAttributes } from 'react';

export type FileTool='folder'|'mkdir'|'up'|'go'|'refresh'|'upload'|'download'|'filter'|'export';
const paths:Record<FileTool,string>={
 folder:'M2 6h7l2 2h11v12H2z M2 6V4h7l2 2',mkdir:'M2 7h7l2 2h11v11H2z M16 2v8 M12 6h8',
 up:'M12 21V4 M5 11l7-7 7 7',go:'M3 12h17 M13 5l7 7-7 7',refresh:'M20 8a9 9 0 1 0 1 7 M20 2v6h-6',
 upload:'M12 16V3 M7 8l5-5 5 5 M3 16v5h18v-5',download:'M12 3v13 M7 11l5 5 5-5 M3 16v5h18v-5',
 filter:'M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16 M16 16l6 6',export:'M12 14V2 M7 7l5-5 5 5 M8 11H3v11h18V11h-5'
};
export function FileToolIcon({icon}:{icon:FileTool}){return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[icon]}/></svg>;}
export function FileToolButton({label,icon,count,className='',...props}:{label:string;icon:FileTool;count?:number}&ButtonHTMLAttributes<HTMLButtonElement>){return <button type="button" {...props} className={'file-tool-button '+className} aria-label={label} title={label}><FileToolIcon icon={icon}/>{!!count&&<small>{count}</small>}</button>;}
