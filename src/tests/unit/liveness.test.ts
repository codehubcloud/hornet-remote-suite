import { it,expect } from 'vitest';
import { Liveness } from '../../packages/core/liveness';

it('probes before declaring an unresponsive child and accepts any activity',()=>{
 let now=0;const health=new Liveness(()=>now);
 for(let i=0;i<29;i++){now+=1000;expect(health.poll()).toBe('healthy');}
 now+=1000;expect(health.poll()).toBe('probe');
 for(let i=0;i<14;i++){now+=1000;expect(health.poll()).toBe('healthy');}
 health.activity();now+=1000;expect(health.poll()).toBe('healthy');
 for(let i=0;i<29;i++){now+=1000;health.poll();}
 for(let i=0;i<15;i++){now+=1000;health.poll();}
 expect(health.poll()).toBe('unresponsive');
});
it('excludes sleep, long event-loop stalls and clock discontinuities from request deadlines',()=>{
 let now=0;const health=new Liveness(()=>now);
 now+=5000;expect(health.time()).toBe(5000);
 now+=3600000;expect(health.poll()).toBe('healthy');expect(health.time()).toBe(5000);
 now+=1000;expect(health.time()).toBe(6000);
 health.suspend();for(let i=0;i<120;i++){now+=1000;expect(health.poll()).toBe('healthy');}
 expect(health.time()).toBe(6000);health.resume();
 now+=1000;expect(health.time()).toBe(7000);
 now-=5000;expect(health.poll()).toBe('healthy');expect(health.time()).toBe(7000);
});
