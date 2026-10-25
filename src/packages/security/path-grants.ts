import { randomUUID } from 'node:crypto';
import { realpath, lstat } from 'node:fs/promises';
import { dirname, basename, join, resolve } from 'node:path';
import { AppError } from '../core/errors';
export interface PathGrant { id: string; owner: string; path: string; direction: 'upload'|'download'; expires: number; parent: string }
export class PathGrants {
  private grants = new Map<string,PathGrant>();
  async create(owner: string,path: string,direction: 'upload'|'download',replace:boolean|'prompt'=false): Promise<PathGrant> {
    const absolute = resolve(path);
    const parent = await realpath(dirname(absolute));
    if ((await lstat(dirname(absolute))).isSymbolicLink()) throw new AppError('IPC005','不允许通过目录链接授权文件。');
    if (direction === 'upload') { const stat = await lstat(absolute); if (!stat.isFile() || stat.isSymbolicLink()) throw new AppError('IPC005','请选择普通文件。'); }
    else { try { const info=await lstat(absolute);if(replace==='prompt'||replace&&info.isFile()&&!info.isSymbolicLink()){}else throw new AppError('FILE_CONFLICT','下载目标已存在，请选择新文件名。'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; } }
    const grant = { id:randomUUID(),owner,path:join(parent,basename(absolute)),direction,expires:Date.now()+15*60*1000,parent };
    this.grants.set(grant.id,grant); return grant;
  }
  async get(owner: string,id: string,direction: 'upload'|'download') {
    const grant = this.grants.get(id);
    if (!grant || grant.owner !== owner || grant.direction !== direction || grant.expires < Date.now()) throw new AppError('IPC005','文件授权无效或已过期，请重新选择。');
    if (await realpath(dirname(grant.path)) !== grant.parent) throw new AppError('IPC005','文件目录已经改变。');
    return grant;
  }
  clear(owner: string) { for (const [id,g] of this.grants) if (g.owner === owner) this.grants.delete(id); }
}
