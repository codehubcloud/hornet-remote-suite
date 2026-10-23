interface ZmodemTransfer {send(bytes:number[]):void;end():Promise<void>}
interface ZmodemOffer {get_details():{name:string;size:number};accept(options:{on_input:(bytes:number[])=>void}):Promise<unknown>}
interface ZmodemSession {abort():void;start():void;close():Promise<void>;send_offer(info:{name:string;size:number;mtime:number;files_remaining:number}):Promise<ZmodemTransfer|undefined>;on(event:'offer',handler:(offer:ZmodemOffer)=>void):void;on(event:'session_end',handler:()=>void):void}
declare module 'zmodem.js' {const Zmodem:{Sentry:new(options:{to_terminal:(bytes:number[])=>void;sender:(bytes:number[])=>void;on_retract:()=>void;on_detect:(detection:{get_session_role():string;deny():void;confirm():ZmodemSession})=>void})=>{consume(bytes:number[]):void}};export default Zmodem;}
