import { terminalEncodingSchema,type TerminalEncoding } from './terminal-encoding';
import type { TerminalRecording } from './terminal-recording';
import { localTerminalSchema,serialTerminalSchema,type LocalTerminalConfig,type SerialTerminalConfig,type DeviceTerminal,type SerialDevice } from './device-terminal';
import type { TreeRequest,TreePreview,TreeResult } from './file-tree';
import type { TerminalLog,TerminalLogFormat } from './terminal-log';
import type { LocalDirectory } from './local-files';
import { z } from 'zod';
import { sessionOptionsSchema } from './session-options';
import { printConfigSchema, printQueueSchema, type PrintQueue, xServerOptionsSchema, xdmcpConfigSchema, type PrintConfig, type PrintStatus, type RdpConfig, type X11Status, type XServerOptions, type XServerEngine, type XdmcpConfig, type XdmcpSession, type XdmcpHost } from './native';

const id = z.string().uuid();
const text = z.string().min(1).max(255).refine(v => !/[\x00-\x1f\x7f]/.test(v), 'Contains control characters');
export const profileSchema = z.object({
  protocol:z.enum(['ssh','telnet','ftp']).optional(),profileId: id, name: text, host: text, port: z.number().int().min(1).max(65535),
  ftpSecurity:z.enum(['none','explicit','implicit']).optional(),
  username: z.string().max(255).refine(v=>!/[\x00-\x1f\x7f]/.test(v)), group: z.string().max(128), authType: z.enum(['password', 'privateKey', 'agent']),
  description: z.string().max(2048).optional(), updatedAt: z.number().int().nonnegative().optional(),
  encoding:terminalEncodingSchema.optional(),
  jumpProfileIds:z.array(id).max(4).optional(),
  session:sessionOptionsSchema.optional(),
  revision: z.number().int().nonnegative(),
}).strict().refine(p=>p.protocol==='telnet'||p.username.length>0,{message:'连接需要用户名。',path:['username']}).refine(p=>!p.jumpProfileIds?.length||((p.protocol??'ssh')==='ssh'&&!p.jumpProfileIds.includes(p.profileId)&&new Set(p.jumpProfileIds).size===p.jumpProfileIds.length),{message:'跳板链只能用于 SSH，不能重复或包含自身。',path:['jumpProfileIds']}).refine(p=>p.protocol==='ftp'?p.authType==='password'&&!!p.ftpSecurity:!p.ftpSecurity,{message:'FTP 需要密码认证并指定传输加密方式。',path:['ftpSecurity']});
export type Profile = z.infer<typeof profileSchema>;
export const profileCredentialSchema=z.discriminatedUnion('mode',[
 z.object({mode:z.literal('keep')}).strict(),z.object({mode:z.literal('remove')}).strict(),
 z.object({mode:z.literal('save'),password:z.string().min(1).max(16384).refine(v=>!v.includes('\0'))}).strict()
]);
export type ProfileCredential=z.infer<typeof profileCredentialSchema>;
export const tunnelConfigSchema = z.object({
  profileId: id, kind: z.enum(['local', 'remote', 'dynamic']),
  bindHost: z.enum(['127.0.0.1', '::1']),
  bindPort: z.number().int().min(0).max(65535),
  targetHost: z.string().min(1).max(253).refine(v => !/[\s\x00-\x1f\x7f/\\]/.test(v), 'Invalid destination host'),
  targetPort: z.number().int().min(1).max(65535),
  allowedHosts: z.array(z.string().min(1).max(253).regex(/^[a-zA-Z0-9.*:_-]+$/)).max(64).optional(),
  allowedPorts: z.array(z.number().int().min(1).max(65535)).max(64).optional(),
}).strict();
export type TunnelConfig = z.infer<typeof tunnelConfigSchema>;
export interface TunnelSnapshot extends TunnelConfig {
  tunnelId: string; connectionId: string; leaseId: string;
  state: 'starting'|'listening'|'stopping'|'stopped'|'failed';
  activeStreams: number; bytesToTarget: number; bytesFromTarget: number; error?: string;
}
export const remotePath = z.string().min(1).max(4096).refine(v => !v.includes('\0'), 'Invalid path');
export const schemas = {
  'localTerminal.shells':z.object({}).strict(),
  'localTerminal.open':localTerminalSchema,
  'serialTerminal.list':z.object({}).strict(),
  'serialTerminal.open':serialTerminalSchema,
  'telnet.open':z.object({profileId:id,cols:z.number().int().min(1).max(1000),rows:z.number().int().min(1).max(1000)}).strict(),
  'print.queue.save':printQueueSchema,
  'print.queue.remove':z.object({queue:z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)}).strict(),
  'print.status': z.object({}).strict(),
  'print.start': printConfigSchema,
  'print.stop': z.object({}).strict(),
  'print.submit': z.object({jobId:id}).strict(),
  'print.cancel': z.object({jobId:id}).strict(),
  'x11.status': z.object({}).strict(),
  'x11.engine': z.object({}).strict(),
  'x11.launch': z.object({profileId:id,command:z.string().min(1).max(4096).refine(v=>!v.includes('\0')),managed:xServerOptionsSchema.optional()}).strict(),
  'xdmcp.interfaces': z.object({}).strict(),
  'xdmcp.query': z.object({host:z.ipv4(),localAddress:z.ipv4(),port:z.number().int().min(1).max(65535)}).strict(),
  'xdmcp.open': xdmcpConfigSchema,
  'xdmcp.list': z.object({}).strict(),
  'xdmcp.close': z.object({id}).strict(),
  'x11.stop': z.object({id}).strict(),
  'vnc.open': z.object({ profileId: id, host: text, port: z.number().int().min(1).max(65535) }).strict(),
  'vnc.close': z.object({ desktopId: id }).strict(),
  'tunnel.list': z.object({}).strict(),
  'tunnel.create': tunnelConfigSchema,
  'tunnel.stop': z.object({ tunnelId: id }).strict(),
  'profile.list': z.object({}).strict(),
  'profile.save': z.object({ profile: profileSchema, expectedRevision: z.number().int().nonnegative() }).strict(),
  'group.remove': z.object({ path: z.string().min(1).max(128), members: z.array(z.object({profileId:id,revision:z.number().int().positive()}).strict()).max(10000) }).strict(),
  'profile.delete': z.object({ profileId: id, expectedRevision: z.number().int().positive() }).strict(),
  'connection.open': z.object({ profileId: id, purpose: z.enum(['terminal', 'files']),fresh:z.boolean().optional() }).strict(),
  'connection.retain':z.object({connectionId:id}).strict(),
  'connection.release': z.object({ leaseId: id }).strict(),
  'connection.close': z.object({ connectionId: id, generation: z.number().int().positive() }).strict(),
  'auth.respond': z.object({ challengeId: id, response: z.string().max(65536), remember: z.boolean() }).strict(),
  'auth.cancel': z.object({ challengeId: id }).strict(),
  'trust.resolve': z.object({ challengeId: id, decision: z.enum(['accept', 'reject']) }).strict(),
  'terminal.encoding': z.object({terminalId:id,generation:z.number().int().positive(),encoding:terminalEncodingSchema.optional()}).strict(),
  'terminal.send': z.object({terminalId:id,generation:z.number().int().positive(),seq:z.number().int().positive(),data:z.string().max(32768)}).strict(),
  'terminal.cwd': z.object({terminalId:id}).strict(),
  'terminal.create': z.object({ connectionId: id, cols: z.number().int().min(1).max(1000), rows: z.number().int().min(1).max(1000), trackDirectory:z.boolean().optional() }).strict(),
  'terminal.attach': z.object({ terminalId: id }).strict(),
  'terminal.resize': z.object({ terminalId: id, generation: z.number().int().positive(), cols: z.number().int().min(1).max(1000), rows: z.number().int().min(1).max(1000) }).strict(),
  'terminal.close': z.object({ terminalId: id }).strict(),
  'file.list': z.object({ connectionId: id, path: remotePath }).strict(),
  'file.read': z.object({ connectionId: id, path: remotePath }).strict(),
  'file.mkdir': z.object({ connectionId: id, path: remotePath }).strict(),
  'file.rename': z.object({ connectionId: id, path: remotePath, target: remotePath }).strict(),
  'file.chmod': z.object({ connectionId: id, path: remotePath, mode: z.number().int().min(0).max(511) }).strict(),
  'file.remove': z.object({ connectionId: id, path: remotePath }).strict(),
  'file.save': z.object({ connectionId: id, path: remotePath, content: z.string().max(131072), expectedHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  'transfer.start': z.object({ connectionId: id, direction: z.enum(['upload','download']), pathGrantId: id, remotePath, idempotencyKey: id }).strict(),
  'task.list': z.object({}).strict(),
  'task.cancel': z.object({ taskId: id, expectedRevision: z.number().int().positive() }).strict(),
  'task.pause': z.object({ taskId: id, expectedRevision: z.number().int().positive() }).strict(),
  'task.resume': z.object({ taskId: id, expectedRevision: z.number().int().positive() }).strict(),
  'layout.load': z.object({}).strict(),
  'layout.save': z.object({ profileIds: z.array(id).max(100), activeProfileId: id.optional() }).strict(),
  'capability.list': z.object({}).strict(),
} as const;
export type Method = keyof typeof schemas;
export const envelopeSchema = z.object({
  version: z.literal(1), requestId: id, deadlineMs: z.number().finite(),
  method: z.enum(Object.keys(schemas) as [Method, ...Method[]]), payload: z.unknown()
}).strict();
export const terminalInputSchema = z.object({
  terminalId: id, generation: z.number().int().positive(), seq: z.number().int().positive(),
  data: z.string().max(32768)
}).strict();
export const terminalAckSchema = z.object({ terminalId: id, seq: z.number().int().positive() }).strict();
export type Result<T> = { ok: true; requestId: string; data: T }
  | { ok: false; requestId: string; error: { code: string; message: string; retryable: boolean } };
export interface Lease { connectionId: string; leaseId: string; generation: number }
export interface FileEntry { name: string; path: string; kind: 'directory'|'file'|'link'|'other'; size: number; modified: number; mode: number }
export interface FilePage { path: string; entries: FileEntry[]; truncated: boolean }
export type TaskState = 'queued'|'running'|'verifying'|'committing'|'pausing'|'paused'|'cancelling'|'cancelled'|'succeeded'|'failed'|'conflict';
export interface TaskSnapshot { taskId: string; profileId: string; direction: 'upload'|'download'; name: string; state: TaskState; totalBytes: number; transferredBytes: number; verification?:{bytes:number;totalBytes:number;method:'stream'|'remote'}; revision: number; error?: string; updatedAt: number }
export interface Capability { id: string; name: string; state: 'available'|'unavailable'|'requires-setup'|'experimental'; reason: string }
export type HornetEvent =
  | { type:'terminal.log';log:TerminalLog }
  | { type: 'tunnel.state'; tunnel: TunnelSnapshot }
  | { type: 'challenge'; challengeId: string; kind: 'password'|'privateKey'|'passphrase'|'keyboard'|'trust'; profileId: string; title: string; message: string; echo?: boolean }
  | { type: 'challenge.closed'; challengeId: string }
  | { type: 'connection.state'; connectionId: string; profileId: string; generation: number; state: string; error?: string; disconnect?: import('./terminal-disconnect').TerminalDisconnect }
  | { type: 'terminal.data'; terminalId: string; generation: number; seq: number; data: Uint8Array }
  | { type: 'terminal.closed'; terminalId: string; generation?:number; disconnect?: import('./terminal-disconnect').TerminalDisconnect }
  | { type: 'task.state'; task: TaskSnapshot }
  | { type: 'service.error'; message: string };
export interface Layout { profileIds: string[]; activeProfileId?: string }
export interface HornetApi {
 help:{info():Promise<import('./help').AppInfo>;checkUpdates():Promise<import('./help').UpdateInfo>;openLink(link:import('./help').HelpLink):Promise<void>;openPdf(language:string):Promise<void>};
 windowChrome:{platform:string;setColors:(colors:{color:string;symbolColor:string})=>Promise<void>;onContextMenu:(listener:(point:{x:number;y:number})=>void)=>()=>void};
 clipboard:{read:()=>Promise<string>;write:(text:string)=>Promise<void>};
  localTerminal:{shells():Promise<{id:'powershell'|'cmd';name:string;path:string}[]>;open(config:LocalTerminalConfig):Promise<DeviceTerminal>};
  serialTerminal:{list():Promise<SerialDevice[]>;open(config:SerialTerminalConfig):Promise<DeviceTerminal>};
  terminalLogs:{openRecording(id?:string):Promise<TerminalRecording|null>;start(terminalId:string,format:TerminalLogFormat):Promise<TerminalLog|null>;stop(id:string):Promise<TerminalLog>;list():Promise<TerminalLog[]>};
  telnet:{open(profileId:string,cols:number,rows:number):Promise<{terminalId:string;connectionId:string;generation:number}>};
  treeTransfer:{preview(request:TreeRequest):Promise<TreePreview>;execute(planId:string):Promise<TreeResult>;discard(planId:string):Promise<void>};
  localFiles:{choose():Promise<LocalDirectory|null>;list(rootId:string,path:string):Promise<LocalDirectory>;mkdir(rootId:string,path:string,name:string):Promise<void>;grant(rootId:string,path:string,direction:'upload'|'download',name?:string):Promise<{pathGrantId:string}>;release(rootId:string):Promise<void>};

  print:{saveQueue(queue:PrintQueue):Promise<PrintStatus>;removeQueue(queue:string):Promise<PrintStatus>;status():Promise<PrintStatus>;start(config:PrintConfig):Promise<PrintStatus>;stop():Promise<void>;submit(jobId:string):Promise<unknown>;cancel(jobId:string):Promise<void>;printers():Promise<string[]>};
  x11:{status():Promise<X11Status>;engine():Promise<XServerEngine>;chooseEngine():Promise<XServerEngine|null>;configure(display:number):Promise<X11Status|null>;launch(profileId:string,command:string,managed?:XServerOptions):Promise<{id:string}>;stop(id:string):Promise<void>};
  xdmcp:{interfaces():Promise<{name:string;address:string}[]>;query(host:string,localAddress:string,port:number):Promise<XdmcpHost>;open(config:XdmcpConfig):Promise<{id:string}>;list():Promise<XdmcpSession[]>;close(id:string):Promise<void>};
  rdp:{probe():Promise<{available:boolean;presentation:string}>;open(config:RdpConfig):Promise<{id:string}>;list():Promise<{id:string;state:string;reason?:number}[]>;close(id:string):Promise<void>};
  vnc: { open(profileId: string, host: string, port: number): Promise<{ desktopId: string; url: string; token: string }>; close(desktopId: string): Promise<void> };
  tunnel: { list(): Promise<TunnelSnapshot[]>; create(config: TunnelConfig): Promise<TunnelSnapshot>; stop(tunnelId: string): Promise<void> };
  profiles: { credentialStatus(profileId:string):Promise<{saved:boolean}>;removeGroup(path:string,members:{profileId:string;revision:number}[]):Promise<void>; list(): Promise<Profile[]>; save(profile: Profile, expectedRevision: number,credential?:ProfileCredential): Promise<Profile>; delete(profileId: string, expectedRevision: number): Promise<void>; import(): Promise<number|null>; export(): Promise<boolean> };
  connection: { retain(connectionId:string):Promise<Lease>;open(profileId: string, purpose: 'terminal'|'files',fresh?:boolean): Promise<Lease>; release(leaseId: string): Promise<void>; close(connectionId: string, generation: number): Promise<void> };
  auth: { respond(challengeId: string, response: string, remember: boolean): Promise<void>; cancel(challengeId: string): Promise<void>; trust(challengeId: string, decision: 'accept'|'reject'): Promise<void>; chooseKey(challengeId: string): Promise<boolean>; lock(): Promise<void> };
  terminal: { encoding(terminalId:string,generation:number,encoding?:TerminalEncoding):Promise<TerminalEncoding>;send(terminalId:string,generation:number,seq:number,data:string):Promise<void>; exportText(name:string,text:string):Promise<boolean>;cwd(terminalId:string):Promise<{path:string|null;reason?:string}>; create(connectionId: string, cols: number, rows: number,trackDirectory?:boolean): Promise<{ terminalId: string; generation: number }>; attach(terminalId: string): Promise<void>; write(terminalId: string,generation: number,seq: number,data: string): void; ack(terminalId: string,seq: number): void; resize(terminalId: string,generation: number,cols: number,rows: number): Promise<void>; close(terminalId: string): Promise<void> };
  file: { chmod(connectionId:string,path:string,mode:number):Promise<void>; list(connectionId: string,path: string): Promise<FilePage>; read(connectionId: string,path: string): Promise<{ content: string; hash: string }>; save(connectionId: string,path: string,content: string,expectedHash: string): Promise<{ hash: string }>; choose(direction: 'upload'|'download',name?: string): Promise<{ pathGrantId: string; name: string }|null>; mkdir(connectionId:string,path:string):Promise<void>; rename(connectionId:string,path:string,target:string):Promise<void>; remove(connectionId:string,path:string):Promise<void> };
  transfer: { start(connectionId: string,direction: 'upload'|'download',pathGrantId: string,remotePath: string,idempotencyKey: string): Promise<TaskSnapshot> };
  task: { list(): Promise<TaskSnapshot[]>; pause(taskId: string,expectedRevision: number): Promise<void>; cancel(taskId: string,expectedRevision: number): Promise<void>; resume(taskId: string,expectedRevision: number): Promise<void> };
  layout: { load(): Promise<Layout>; save(layout: Layout): Promise<void> };
  capabilities(): Promise<Capability[]>;
  onEvent(listener: (event: HornetEvent) => void): () => void;
}
