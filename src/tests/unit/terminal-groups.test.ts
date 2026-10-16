import { afterEach,it,expect,vi } from 'vitest';
import { useStore,closeTerminalView,type View } from '../../apps/desktop/renderer/store';
import { tabGroup } from '../../apps/desktop/renderer/terminal-tabs';
import { layoutRects } from '../../apps/desktop/renderer/terminal-layout';
const view=(id:string):View=>({id,kind:'terminal',connectionId:'shared',terminalId:id,generation:1,profile:{profileId:'fixture',name:id,host:'localhost',port:22,username:'test',group:'',authType:'password',revision:1}});
afterEach(()=>{useStore.setState(useStore.getInitialState(),true);vi.unstubAllGlobals();});
it('creates tab groups from existing terminals, switches within a group and merges without replacing sessions',()=>{
 const s=useStore.getState();['a','b','c'].forEach(id=>s.addView(view(id)));s.setActive('a');s.createTabGroup('a','vertical');
 let state=useStore.getState();expect([...layoutRects(state.terminalLayout!).panes.keys()]).toEqual(['b','a']);expect(tabGroup(state.views[0])).not.toBe(tabGroup(state.views[1]));
 s.setActive('c');state=useStore.getState();expect([...layoutRects(state.terminalLayout!).panes.keys()]).toEqual(['c','a']);
 s.moveTab('a',tabGroup(state.views[1]));state=useStore.getState();expect(layoutRects(state.terminalLayout!).panes.size).toBe(1);expect(new Set(state.views.map(tabGroup)).size).toBe(1);expect(state.views.map(v=>v.terminalId)).toEqual(['a','b','c']);
 s.tileTerminals('horizontal');s.removeView('a');expect(layoutRects(useStore.getState().terminalLayout!).panes.size).toBe(2);
 s.setTerminalLayout(null);expect(new Set(useStore.getState().views.map(tabGroup)).size).toBe(1);
});
it('protects locked tabs from close requests, including batch callers',async()=>{
 const close=vi.fn();vi.stubGlobal('window',{hornet:{terminal:{close}}});const s=useStore.getState();s.addView({...view('locked'),locked:true});
 await closeTerminalView('locked');expect(close).not.toHaveBeenCalled();expect(useStore.getState().views).toHaveLength(1);
});
it('opens independent blank tabs and replaces the active one in its original group when connecting',()=>{
 const s=useStore.getState();s.addView(view('a'));s.addView(view('b'));s.tileTerminals('vertical');s.setActive('b');s.newTab();const blank=useStore.getState().active;s.newTab();
 expect(useStore.getState().blankTabs).toHaveLength(2);s.addView(view('c'));const state=useStore.getState();expect(state.blankTabs).toEqual([blank]);expect(tabGroup(state.views[2])).toBe('b');expect([...layoutRects(state.terminalLayout!).panes.keys()]).toEqual(['a','c']);
});
