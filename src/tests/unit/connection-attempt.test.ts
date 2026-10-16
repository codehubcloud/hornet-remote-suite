import { afterEach,it,expect,vi } from 'vitest';
import { closeTerminalView,hasRemoteFiles,isTerminalClosed,openView,reconnectView,useStore } from '../../apps/desktop/renderer/store';
import type { Profile } from '../../packages/contracts';
import { connectionError } from '../../services/ssh/connect-socket';

const profile:Profile={profileId:'fixture',name:'offline',host:'127.0.0.1',port:2222,username:'test',group:'test',authType:'password',revision:1};
function api(open:()=>Promise<unknown>){
 const api={connection:{open:vi.fn(open),release:vi.fn(async()=>{})},terminal:{create:vi.fn(async()=>({terminalId:'shell'})),close:vi.fn(async()=>{})},layout:{save:vi.fn(async()=>{})}};
 vi.stubGlobal('window',{hornet:api});return api;
}
afterEach(()=>{useStore.setState({views:[],active:'home',reconnecting:{},terminalLayout:null,closedTerminals:{},connectionStates:{}});vi.unstubAllGlobals();});
it('opens a disabled terminal immediately and retains its target and error when connection fails',async()=>{
 let reject!:(e:Error)=>void;const mock=api(()=>new Promise((_resolve,fail)=>{reject=fail;}));
 const pending=openView(profile,'terminal'),initial=useStore.getState().views[0];
 expect(initial.connectionAttempt?.state).toBe('connecting');expect(initial.terminalId).toBeUndefined();expect(hasRemoteFiles(initial)).toBe(false);
 expect(useStore.getState().active).toBe(initial.id);expect(useStore.getState().reconnecting[initial.id]).toBe(true);
 reject(new Error('SSH001 · server refused'));await expect(pending).rejects.toThrow('server refused');
 const failed=useStore.getState().views[0];expect(failed.id).toBe(initial.id);expect(failed.profile).toEqual(profile);expect(failed.connectionAttempt).toEqual({state:'failed',error:'SSH001 · server refused'});
 expect(isTerminalClosed(failed,useStore.getState())).toBe(true);expect(mock.terminal.create).not.toHaveBeenCalled();
 mock.connection.open.mockResolvedValue({connectionId:'connected',leaseId:'lease',generation:1});
 await reconnectView(initial.id);const ready=useStore.getState().views[0];expect(ready.id).toBe(initial.id);expect(ready.terminalId).toBe('shell');expect(ready.connectionAttempt).toBeUndefined();expect(hasRemoteFiles(ready)).toBe(true);
});
it('releases a connection that finishes after its pending tab was closed',async()=>{
 let resolve!:(value:unknown)=>void;const mock=api(()=>new Promise(done=>{resolve=done;})),pending=openView(profile,'terminal');
 await closeTerminalView(useStore.getState().views[0].id);expect(mock.terminal.close).not.toHaveBeenCalled();
 resolve({connectionId:'connected',leaseId:'lease',generation:1});await pending;
 expect(useStore.getState().views).toEqual([]);expect(mock.terminal.close).toHaveBeenCalledWith('shell');expect(mock.connection.release).toHaveBeenCalledWith('lease');
});
it.each([
 ['ECONNREFUSED','服务器拒绝连接'],['ENOTFOUND','无法解析服务器地址'],['EAI_AGAIN','无法解析服务器地址'],
 ['EHOSTUNREACH','服务器或网络不可达'],['ENETUNREACH','服务器或网络不可达'],['ETIMEDOUT','连接超时'],['ECONNRESET','服务器重置了连接']
])('explains %s with the actual destination', (code,reason)=>{
 const error=connectionError({code},'server.example',2222);expect(error.message).toContain('server.example:2222');expect(error.message).toContain(reason);expect(error.retryable).toBe(true);
});
