import { terminalEncodingSchema } from './terminal-encoding';
import { z } from 'zod';
export const terminalSize={cols:z.number().int().min(1).max(1000),rows:z.number().int().min(1).max(1000)};
export const localTerminalSchema=z.object({shell:z.enum(['powershell','cmd']),cwd:z.string().max(4096).refine(v=>!/[\x00-\x1f]/.test(v)).optional(),...terminalSize}).strict();
export const serialTerminalSchema=z.object({
 path:z.string().regex(/^COM[1-9][0-9]{0,4}$/i).transform(v=>v.toUpperCase()),
 baudRate:z.number().int().min(50).max(4000000),dataBits:z.union([z.literal(5),z.literal(6),z.literal(7),z.literal(8)]),
 stopBits:z.union([z.literal(1),z.literal(1.5),z.literal(2)]),parity:z.enum(['none','even','odd','mark','space']),
 encoding:terminalEncodingSchema.optional(),
 flowControl:z.enum(['none','rtscts','xonxoff']),newline:z.enum(['cr','lf','crlf']),localEcho:z.boolean(),...terminalSize
}).strict().refine(v=>v.stopBits!==1.5||v.dataBits===5,{message:'1.5停止位仅用于5数据位。'});
export type LocalTerminalConfig=z.infer<typeof localTerminalSchema>;
export type SerialTerminalConfig=z.infer<typeof serialTerminalSchema>;
export interface DeviceTerminal {terminalId:string;connectionId:string;generation:number;name:string;address:string;source:'local'|'serial'}
export interface SerialDevice {path:string;manufacturer?:string;serialNumber?:string}
