import { z } from 'zod';
import { localTerminalSchema,serialTerminalSchema } from './device-terminal';

export const terminalPreferencesSchema=z.object({
 fontSize:z.number().int().min(8).max(32),font:z.enum(['cascadia','consolas','courier']),
 theme:z.enum(['hornet','light','github-light','github-dark','vscode-light','vscode-dark','visual-studio-light','visual-studio-dark','visual-studio-blue','solarized','solarized-light','dracula','nord','gruvbox','one-dark','rose-pine','coffee','contrast']),
 scrollback:z.number().int().min(1000).max(100000),cursorStyle:z.enum(['block','bar','underline']),cursorBlink:z.boolean(),
}).strict();
export const sessionOptionsSchema=z.object({
 keyId:z.string().uuid().optional(),identityId:z.string().uuid().optional(),
 appearance:terminalPreferencesSchema.partial().optional(),
 terminal:z.object({type:z.enum(['xterm-256color','xterm','vt100','vt220','ansi']).optional(),cols:z.number().int().min(20).max(500).optional(),rows:z.number().int().min(5).max(200).optional(),backspace:z.enum(['del','bs']).optional(),enter:z.enum(['cr','crlf']).optional(),bell:z.enum(['none','visual']).optional()}).strict().optional(),
 keepAlive:z.object({intervalSeconds:z.number().int().min(5).max(300),maxMissed:z.number().int().min(1).max(10)}).strict().optional(),
 reconnect:z.object({enabled:z.boolean(),intervalSeconds:z.number().int().min(5).max(3600),limitMinutes:z.number().int().min(0).max(1440)}).strict().optional(),
 quickCommandSetId:z.string().min(1).max(80).optional(),disableQuickShortcuts:z.boolean().optional(),
 remoteDirectory:z.string().min(1).max(4096).refine(s=>!/[\x00-\x1f\x7f]/.test(s)).optional(),
 device:z.union([localTerminalSchema,serialTerminalSchema]).optional(),
 rdpDomain:z.string().max(255).optional(),
 mosh:z.boolean().optional(),
 s3:z.boolean().optional(),
 s3Region:z.string().regex(/^[a-z0-9-]{3,64}$/).optional(),
}).strict();
export type SessionOptions=z.infer<typeof sessionOptionsSchema>;
