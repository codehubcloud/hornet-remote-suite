import { z } from 'zod';
import type { TaskSnapshot } from './index';
export interface TransferFile {path:string;kind:'file'|'directory'|'link'|'other';size:number;modified:number;hash?:string}
export interface TransferInfo {transport:'ssh'|'ftp'|'s3';path:string;file?:TransferFile}
export const transferRequestSchema=z.object({connectionId:z.string().uuid(),direction:z.enum(['upload','download']),pathGrantId:z.string().uuid(),remotePath:z.string().min(1).max(4096).refine(path=>!/[\x00-\x1f\x7f]/.test(path))}).strict();
export type TransferRequest=z.infer<typeof transferRequestSchema>;
export const conflictActionSchema=z.enum(['replace','newer','keep-both','rename','skip','cancel']);
export type ConflictAction=z.infer<typeof conflictActionSchema>;
export interface TransferConflict {id:string;direction:'upload'|'download';source:TransferFile;target:TransferFile;canReplace:boolean}
export type TransferPreparation={kind:'started';task:TaskSnapshot}|{kind:'conflict';conflict:TransferConflict}|{kind:'skipped'|'cancelled'};
