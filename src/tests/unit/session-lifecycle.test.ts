import { beforeEach,afterEach,it,expect,vi } from 'vitest';
import { useStore,reconnectView,type View } from '../../apps/desktop/renderer/store';
import { useBroadcast } from '../../apps/desktop/renderer/broadcast';
const old:View={id:'tab',title:'My shell',kind:'terminal',profile:{profileId:'profile',name:'host',host:'localhost',port:22,username:'tester',group:'test',authType:'password',revision:1},connectionId:'old-connection',leaseId:'old-lease',terminalId:'old-terminal',terminalIds:['old-terminal'],generation:1};
const api={connection:{open:vi.fn(),release:vi.fn()},terminal:{create:vi.fn(),close:vi.fn()},layout:{save:vi.fn()}};
beforeEach(()=>{vi.resetAllMocks();useBroadcast.getState().stop();useStore.setState({views:[old],profiles:[old.profile],active:old.id,reconnecting:{},closedTerminals:{},terminalLayout:{kind:'leaf',id:old.id}});vi.stubGlobal('window',{hornet:api});api.connection.open.mockResolvedValue({connectionId:'new-connection',leaseId:'new-lease',generation:1});api.terminal.create.mockResolvedValue({terminalId:'new-terminal',generation:1});});
afterEach(()=>vi.unstubAllGlobals());
it('reconnects in the same tab and preserves its title, active selection and split layout',async()=>{
 await reconnectView(old.id);expect(useStore.getState().views[0]).toMatchObject({id:old.id,title:old.title,terminalId:'new-terminal'});expect(useStore.getState().terminalLayout).toEqual({kind:'leaf',id:old.id});expect(useStore.getState().active).toBe(old.id);
 expect(api.terminal.close).toHaveBeenCalledExactlyOnceWith('old-terminal');expect(api.connection.release).toHaveBeenCalledExactlyOnceWith('old-lease');expect(useStore.getState().reconnecting.tab).toBe(false);
});
it('keeps the old tab on authentication failure and releases new leases when shell creation fails',async()=>{
 api.terminal.create.mockRejectedValue(new Error('cancelled'));await expect(reconnectView(old.id)).rejects.toThrow('cancelled');expect(useStore.getState().views[0]).toEqual(old);expect(api.terminal.close).not.toHaveBeenCalled();expect(api.connection.release).toHaveBeenCalledExactlyOnceWith('new-lease');
});
it('does not resurrect a tab closed while reconnecting and ignores repeated reconnects',async()=>{
 let finish!:(v:unknown)=>void;api.terminal.create.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));const operation=reconnectView(old.id);await vi.waitFor(()=>expect(api.terminal.create).toHaveBeenCalled());await reconnectView(old.id);expect(api.connection.open).toHaveBeenCalledTimes(1);useStore.getState().removeView(old.id);finish({terminalId:'new-terminal',generation:1});await operation;
 expect(useStore.getState().views).toEqual([]);expect(api.terminal.close).toHaveBeenCalledExactlyOnceWith('new-terminal');expect(api.connection.release).toHaveBeenCalledExactlyOnceWith('new-lease');
});
it('drops closed broadcast targets and never enrolls a replacement terminal implicitly',()=>{
 const targets=['a','b','c'].map(id=>({viewId:id,terminalId:id,name:id}));useBroadcast.getState().start(targets);useStore.getState().event({type:'terminal.closed',terminalId:'a'});expect(useBroadcast.getState().targets.map(t=>t.terminalId)).toEqual(['b','c']);useStore.getState().event({type:'terminal.closed',terminalId:'b'});expect(useBroadcast.getState().targets).toEqual([]);expect(()=>useBroadcast.getState().start([targets[0],targets[0]])).toThrow();
});
