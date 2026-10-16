/** Captured once by the service; delayed/background views use the original time. */
export interface TerminalDisconnect {
 reason:'remote'|'user'|'error'|'exit';
 at:number;
 error?:string;
}
