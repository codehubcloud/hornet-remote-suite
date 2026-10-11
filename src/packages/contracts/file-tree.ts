import { z } from 'zod';

export interface TreeEntry { path:string; kind:'file'|'directory'|'link'|'other'; size:number; modified:number; hash?:string }
export const syncPolicySchema=z.enum(['skip','newer','local','remote','keep-both']);
export type SyncPolicy=z.infer<typeof syncPolicySchema>;
export interface FileTree { root:string; entries:TreeEntry[] }
export const treeRequestSchema=z.object({
 connectionId:z.string().uuid(),rootId:z.string().uuid(),localPath:z.string().max(4096),
 remotePath:z.string().min(1).max(4096).refine(v=>!v.includes('\0')),
 direction:z.enum(['upload','download','bidirectional']),policy:syncPolicySchema.optional(),
 // Omitted means compare the contents of both current directories.
 names:z.array(z.string().min(1).max(255)).min(1).max(5000).optional(),
}).strict();
export type TreeRequest=z.infer<typeof treeRequestSchema>;
export interface TreeAction { path:string; sourcePath?:string; direction?:'upload'|'download'; kind:TreeEntry['kind']; size:number; action:'copy'|'replace'|'mkdir'|'conflict'|'skip'; reason?:string }
export interface TreePreview {
 planId:string;direction:TreeRequest['direction'];policy?:SyncPolicy;localPath:string;remotePath:string;expiresAt:number;
 actions:TreeAction[];files:number;directories:number;bytes:number;conflicts:number;
}
export interface TreeResult { taskIds:string[];directories:number;skipped:number;error?:string }
