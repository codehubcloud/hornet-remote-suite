export interface RecordingHeader {kind:'hornet-terminal-recording';version:1;cols:number;rows:number}
export type RecordingFrame=[number,'o',string]|[number,'r',number,number];
export interface TerminalRecording {name:string;header:RecordingHeader;frames:RecordingFrame[];duration:number}
export const recordingLimit=16*1024*1024;
export const recordingFrameLimit=100000;
