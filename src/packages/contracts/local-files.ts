export interface LocalDirectory {
 rootId:string;rootPath:string;path:string;
 entries:{name:string;path:string;kind:'file'|'directory'|'link'|'other';size:number;modified:number}[];
 truncated:boolean;
}
