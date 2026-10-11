export type TerminalLogFormat='text'|'raw'|'recording';
export interface TerminalLog {
 id:string;terminalId:string;path:string;format:TerminalLogFormat;
 state:'starting'|'recording'|'stopping'|'stopped'|'failed';bytes:number;startedAt:number;error?:string;
}
