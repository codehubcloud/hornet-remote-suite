import { randomUUID } from 'node:crypto';
import { AppError } from '../core/errors';
import type { HornetEvent } from '../contracts';
type ChallengeEvent = Extract<HornetEvent, { type: 'challenge' }>;
interface Pending { owner: string; kind: ChallengeEvent['kind']; resolve: (value: string) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>;cleanup?:()=>void }
export class Challenges {
  private pending = new Map<string, Pending>();
  constructor(private emit: (owner: string,event: HornetEvent) => void, private timeoutMs = 120000) {}
  ask(owner: string, info: Omit<ChallengeEvent, 'type'|'challengeId'>,signal?:AbortSignal): Promise<string> {
    const challengeId = randomUUID();
    return new Promise((resolve,reject) => {
      if(signal?.aborted){reject(new AppError('IPC006','认证已取消。'));return;}
      const timer = setTimeout(() => { this.finish(challengeId); reject(new AppError('IPC003','认证等待超时。')); }, this.timeoutMs);
      const cancel=()=>{if(this.pending.has(challengeId))this.cancel(owner,challengeId);};
      this.pending.set(challengeId,{ owner,kind: info.kind,resolve,reject,timer,cleanup:()=>signal?.removeEventListener('abort',cancel) });
      signal?.addEventListener('abort',cancel,{once:true});
      this.emit(owner,{ type:'challenge',challengeId,...info });
    });
  }
  kind(owner: string,id: string) {
    const entry = this.pending.get(id);
    if (!entry || entry.owner !== owner) throw new AppError('IPC005','认证请求已失效。');
    return entry.kind;
  }
  respond(owner: string,id: string,response: string, trust = false) {
    const entry = this.pending.get(id);
    if (!entry || entry.owner !== owner || (entry.kind === 'trust') !== trust) throw new AppError('IPC005','认证请求无效。');
    this.finish(id); entry.resolve(response);
  }
  cancelOwner(owner: string) {
    for (const [id,p] of this.pending) if (p.owner === owner) { this.finish(id); p.reject(new AppError('IPC006','认证已取消。')); }
  }
  cancel(owner: string,id: string) {
    const entry=this.pending.get(id);
    if(!entry||entry.owner!==owner)throw new AppError('IPC005','认证请求已失效。');
    this.finish(id);entry.reject(new AppError('IPC006','认证已取消。'));
  }
  private finish(id: string) { const p = this.pending.get(id); if (p) { clearTimeout(p.timer);p.cleanup?.(); this.pending.delete(id); this.emit(p.owner,{ type:'challenge.closed',challengeId:id }); } }
}
