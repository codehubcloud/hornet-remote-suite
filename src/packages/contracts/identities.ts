import { z } from 'zod';
export const identitySchema=z.object({id:z.string().uuid(),name:z.string().trim().min(1).max(80),username:z.string().min(1).max(255).refine(value=>!/[\x00-\x1f\x7f]/.test(value)),authType:z.enum(['password','privateKey','agent']),keyId:z.string().uuid().optional()}).strict().refine(value=>value.authType!=='privateKey'||!!value.keyId,'Select a private key');
export type IdentityConfig=z.infer<typeof identitySchema> & {hasPassword:boolean};
export interface ManagedKey {id:string;name:string;algorithm:string;fingerprint:string;publicKey:string;createdAt:number;passphraseProtected:boolean}
export interface KnownHost {id:string;host:string;port:number;algorithm:string;fingerprint:string;publicKey:string;createdAt:number}
