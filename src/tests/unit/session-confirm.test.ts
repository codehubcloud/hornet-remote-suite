import { afterEach,it,expect,vi } from 'vitest';
import { closeTerminalView,closeTerminalTabs,disconnectView,useStore,type View } from '../../apps/desktop/renderer/store';
import { useAppearance } from '../../apps/desktop/renderer/appearance';
const view=(id:string):View=>({id,kind:'terminal',connectionId:'connection',leaseId:'lease-'+id,terminalId:'terminal-'+id,generation:1,profile:{profileId:id,name:id,host:'192.168.100.128',port:2222,username:'root',group:'',authType:'password',revision:0}});
function setup(answer:boolean){const confirm=vi.fn((_message:string)=>answer),close=vi.fn(async()=>{}),release=vi.fn(async()=>{}),save=vi.fn(async()=>{});vi.stubGlobal('window',{confirm,hornet:{terminal:{close},connection:{release},layout:{save}}});return {confirm,close,release,save};}
afterEach(()=>{useStore.setState(useStore.getInitialState(),true);useAppearance.setState({value:{language:'zh-CN',theme:'light'}});vi.unstubAllGlobals();});
it('cancels disconnection without changing the shell or auto-reconnect preference',async()=>{
 const m=setup(false);useStore.getState().addView(view('a'));await disconnectView('a');
 expect(m.confirm).toHaveBeenCalledWith('您已连接到 192.168.100.128:2222。\n您要断开这个会话吗？');expect(m.close).not.toHaveBeenCalled();expect(m.release).not.toHaveBeenCalled();expect(useStore.getState().views[0].autoReconnectPaused).toBeUndefined();
});
it('cancels tab closure before releasing any resource or saving the layout',async()=>{
 const m=setup(false);useStore.getState().addView(view('a'));expect(await closeTerminalView('a')).toBe(false);
 expect(m.confirm.mock.calls[0][0]).toContain('断开并关闭这个标签');expect(m.close).not.toHaveBeenCalled();expect(m.release).not.toHaveBeenCalled();expect(m.save).not.toHaveBeenCalled();expect(useStore.getState().views[0].terminalId).toBe('terminal-a');
});
it('disconnects only after confirmation and retains the tab for reconnection',async()=>{
 const m=setup(true);useStore.getState().addView(view('a'));await disconnectView('a');expect(m.close).toHaveBeenCalledExactlyOnceWith('terminal-a');expect(m.release).not.toHaveBeenCalled();expect(useStore.getState().views[0].autoReconnectPaused).toBe(true);
});
it('closes a confirmed tab and persists the remaining workspace',async()=>{
 const m=setup(true);useStore.getState().addView(view('a'));expect(await closeTerminalView('a')).toBe(true);expect(m.close).toHaveBeenCalledExactlyOnceWith('terminal-a');expect(m.release).toHaveBeenCalledExactlyOnceWith('lease-a');expect(m.save).toHaveBeenCalledOnce();expect(useStore.getState().views).toHaveLength(0);
});
it('stops a batch at cancellation and leaves subsequent tabs untouched',async()=>{
 const m=setup(true);m.confirm.mockReturnValueOnce(true).mockReturnValueOnce(false);for(const id of ['a','b','c'])useStore.getState().addView(view(id));
 expect(await closeTerminalTabs(['a','b','c'])).toBe(false);expect(m.confirm).toHaveBeenCalledTimes(2);expect(m.close).toHaveBeenCalledExactlyOnceWith('terminal-a');expect(useStore.getState().views.map(v=>v.id)).toEqual(['b','c']);
});
it('does not prompt for closed or connecting tabs and respects locked tabs',async()=>{
 const m=setup(false),s=useStore.getState();s.addView(view('closed'));s.addView({...view('connecting'),terminalId:undefined,connectionAttempt:{state:'connecting'}});s.addView({...view('locked'),locked:true});useStore.setState({closedTerminals:{'terminal-closed':true}});
 expect(await closeTerminalTabs(['closed','connecting','locked'])).toBe(true);expect(m.confirm).not.toHaveBeenCalled();expect(useStore.getState().views.map(v=>v.id)).toEqual(['locked']);
});
it('uses the configured language and formats IPv6 targets without showing credentials',async()=>{
 const m=setup(false);useAppearance.setState({value:{language:'en',theme:'dark'}});const v=view('a');v.profile.host='2001:db8::1';v.profile.username='private-user';useStore.getState().addView(v);await closeTerminalView('a');
 expect(m.confirm).toHaveBeenCalledWith('You are connected to [2001:db8::1]:2222.\nDo you want to disconnect and close this tab?');expect(m.confirm.mock.calls[0][0]).not.toContain('private-user');
});
