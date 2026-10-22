import { expect,it } from 'vitest';
import { FullscreenController } from '../../apps/desktop/main/fullscreen';
it('queues Escape during a native enter animation, then exits after completion',()=>{
 let state=false;const applied:boolean[]=[];const control=new FullscreenController(()=>state,value=>applied.push(value));
 control.set(true);control.set(false);expect(applied).toEqual([true]);
 state=true;control.completed();expect(applied).toEqual([true,false]);state=false;control.completed();expect(applied).toEqual([true,false]);
});
it('toggles against the pending request and coalesces repeated requests',()=>{
 let state=false;const applied:boolean[]=[];const control=new FullscreenController(()=>state,value=>applied.push(value));
 control.toggle();control.toggle();control.toggle();expect(applied).toEqual([true]);state=true;control.completed();expect(applied).toEqual([true]);control.toggle();expect(applied).toEqual([true,false]);
});
