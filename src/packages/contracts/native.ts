import { z } from 'zod';
export const printQueueSchema=z.object({queue:z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),printer:z.string().min(1).max(255),mode:z.enum(['raw','text']),enabled:z.boolean()}).strict();
export type PrintQueue=z.infer<typeof printQueueSchema>;
export const printConfigSchema=z.object({bindHost:z.ipv4().or(z.ipv6()),port:z.number().int().min(0).max(65535),queue:z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),printer:z.string().min(1).max(255),mode:z.enum(['raw','text']),allowedSources:z.array(z.ipv4().or(z.ipv6())).min(1).max(32)}).strict();
export type PrintConfig=z.infer<typeof printConfigSchema>;
export interface PrintJob { jobId:string;queue:string;printer:string;mode:'raw'|'text';source:string;owner?:string;host?:string;name:string;bytes:number;state:'held'|'submitting'|'submitted'|'failed'|'unknown'|'cancelled';error?:string;osJobId?:number;createdAt:number }
export interface PrintStatus {listening:boolean;config?:PrintConfig;queues?:PrintQueue[];jobs:PrintJob[]}
export const rdpConfigSchema=z.object({host:z.string().min(1).max(255).regex(/^[a-zA-Z0-9.:-]+$/),port:z.number().int().min(1).max(65535),username:z.string().min(1).max(255),domain:z.string().max(255),password:z.string().max(4096)}).strict();
export type RdpConfig=z.infer<typeof rdpConfigSchema>;
export interface X11Session {
  id:string; profileId:string; command:string;
  state:'preparing'|'startingServer'|'connecting'|'launching'|'running'|'command-exited'|'failed';
  managed?:boolean; display?:number;
  activeChannels:number; exitCode?:number; signal?:string; error?:string;
}
export interface X11Status {configured:boolean;display:number;sessions:X11Session[]}
export const xServerOptionsSchema=z.object({mode:z.enum(['multiWindow','singleWindow']).default('multiWindow'),dpi:z.number().int().min(72).max(240).default(96),allowNetworkListener:z.literal(true)}).strict();
export type XServerOptions=z.infer<typeof xServerOptionsSchema>;
export interface XServerEngine {configured:boolean;path?:string;version?:string;sha256?:string;reason?:string}
export const xdmcpConfigSchema=z.object({host:z.ipv4(),localAddress:z.ipv4(),port:z.number().int().min(1).max(65535).default(177),display:z.number().int().min(10).max(99),dpi:z.number().int().min(72).max(240).default(96),allowUnencrypted:z.literal(true),allowNetworkListener:z.literal(true)}).strict();
export type XdmcpConfig=z.infer<typeof xdmcpConfigSchema>;
export interface XdmcpSession {id:string;host:string;localAddress:string;display:number;state:'querying'|'starting'|'awaiting-login'|'closed'|'failed';error?:string}
export interface XdmcpHost {host:string;willing:boolean;hostname:string;status:string}
