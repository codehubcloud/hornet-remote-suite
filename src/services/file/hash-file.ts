import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { AppError } from '../../packages/core/errors';
export async function hashFile(stream:Readable,timeoutMs=30000){
 const timer=setTimeout(()=>stream.destroy(new AppError('FILE_LIMIT','文件比较超时，请选择较小的目录。')),timeoutMs);
 try{const hash=createHash('sha256');for await(const chunk of stream)hash.update(chunk);return hash.digest('hex');}
 finally{clearTimeout(timer);stream.destroy();}
}
