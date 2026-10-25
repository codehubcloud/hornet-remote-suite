import { describe,it,expect } from 'vitest';
import { TransferProgress,transferDuration } from '../../packages/core/transfer-progress';
import type { TaskSnapshot } from '../../packages/contracts';
const base:TaskSnapshot={taskId:'1',profileId:'p',direction:'upload',name:'file',state:'running',totalBytes:10000,transferredBytes:0,revision:1,updatedAt:1000,startedAt:1000};
describe('transfer rate estimates',()=>{
 it('estimates speed and remaining time from actual transferred bytes and hides them during verification',()=>{const sampler=new TransferProgress();sampler.sample(base,1000);const metric=sampler.sample({...base,transferredBytes:2000},2000);expect(metric.speed).toBe(2000);expect(metric.remainingSeconds).toBe(4);expect(metric.percent).toBe(20);const verified=sampler.sample({...base,state:'verifying',transferredBytes:10000,verification:{bytes:10,totalBytes:10000,method:'remote'}},3000);expect(verified.speed).toBe(0);expect(verified.remainingSeconds).toBeUndefined();expect(sampler.sample({...base,state:'succeeded',transferredBytes:10000},4000).percent).toBe(100);});
 it('freezes elapsed time while paused and never produces invalid estimates for empty files or resets',()=>{const sampler=new TransferProgress();sampler.sample(base,1000);const paused=sampler.sample({...base,state:'paused'},2000);expect(sampler.sample({...base,state:'paused'},20000).elapsedSeconds).toBe(paused.elapsedSeconds);expect(sampler.sample({...base,totalBytes:0,transferredBytes:0},21000).percent).toBe(0);expect(transferDuration(3661)).toBe('1:01:01');expect(transferDuration(0)).toBe('00:00');});
});
