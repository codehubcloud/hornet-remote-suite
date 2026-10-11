import { z } from 'zod';

const text=z.string().min(1).max(8192);
export const scriptStepSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('send'),text,enter:z.boolean()}).strict(),
 z.object({kind:z.literal('wait'),text,timeoutMs:z.number().int().min(100).max(300000)}).strict(),
 z.object({kind:z.literal('delay'),ms:z.number().int().min(0).max(300000)}).strict(),
]);
export const terminalScriptSchema=z.object({version:z.literal(1),name:z.string().trim().min(1).max(80),steps:z.array(scriptStepSchema).min(1).max(200)}).strict();
export type TerminalScript=z.infer<typeof terminalScriptSchema>;
export type ScriptStep=z.infer<typeof scriptStepSchema>;
