import { z } from 'zod';
export const printConfigSchema=z.object({bindHost:z.ipv4().or(z.ipv6()),port:z.number().int().min(0).max(65535),queue:z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),printer:z.string().min(1).max(255),mode:z.enum(['raw','text']),allowedSources:z.array(z.ipv4().or(z.ipv6())).min(1).max(32)}).strict();
export type PrintConfig=z.infer<typeof printConfigSchema>;
export interface PrintJob { jobId:string;queue:string;printer:string;mode:'raw'|'text';source:string;name:string;bytes:number;state:'held'|'submitting'|'submitted'|'failed'|'unknown'|'cancelled';error?:string;osJobId?:number;createdAt:number }
export interface PrintStatus {listening:boolean;config?:PrintConfig;jobs:PrintJob[]}
export const rdpConfigSchema=z.object({host:z.string().min(1).max(255).regex(/^[a-zA-Z0-9.:-]+$/),port:z.number().int().min(1).max(65535),username:z.string().min(1).max(255),domain:z.string().max(255),password:z.string().max(4096)}).strict();
export type RdpConfig=z.infer<typeof rdpConfigSchema>;
export interface X11Status {configured:boolean;display:number;sessions:{id:string;profileId:string;state:string}[]}
