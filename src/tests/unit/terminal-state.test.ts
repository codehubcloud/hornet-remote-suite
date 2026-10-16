import { afterEach,it,expect } from 'vitest';
import { isTerminalClosed,useStore,type View } from '../../apps/desktop/renderer/store';
import { useBroadcast } from '../../apps/desktop/renderer/broadcast';

const view=(id:string,connectionId='shared'):View=>({id,kind:'terminal',connectionId,terminalId:id,generation:1,profile:{profileId:'fixture',name:id,host:'localhost',port:22,username:'test',group:'',authType:'password',revision:1}});
afterEach(()=>{useStore.setState({views:[],closedTerminals:{},connectionStates:{},terminalDisconnects:{},connectionDisconnects:{}});useBroadcast.getState().stop();});

it('marks background shells closed and stops broadcast even if channel close events are missing',()=>{
 const first=view('first'),second=view('second'),other=view('other','independent');
 useStore.setState({views:[first,second,other]});
 useBroadcast.getState().start([first,second,other].map(v=>({viewId:v.id,terminalId:v.terminalId!,name:v.id})));
 useStore.getState().event({type:'connection.state',connectionId:'shared',generation:1,profileId:'fixture',state:'closed'});
 expect(isTerminalClosed(first,useStore.getState())).toBe(true);expect(isTerminalClosed(second,useStore.getState())).toBe(true);
 expect(isTerminalClosed(other,useStore.getState())).toBe(false);expect(useBroadcast.getState().targets).toEqual([]);
});

it('preserves transport closure before a view mounts and never revives an exited shell on a ready event',()=>{
 const terminal=view('late');useStore.getState().event({type:'connection.state',connectionId:'shared',generation:1,profileId:'fixture',state:'failed'});
 expect(isTerminalClosed(terminal,useStore.getState())).toBe(true);
 useStore.getState().event({type:'terminal.closed',terminalId:terminal.terminalId!});
 useStore.getState().event({type:'connection.state',connectionId:'shared',generation:1,profileId:'fixture',state:'ready'});
 expect(isTerminalClosed(terminal,useStore.getState())).toBe(true);expect(isTerminalClosed(view('new'),useStore.getState())).toBe(false);
});

it('retains the original error and time once for every shared shell despite duplicate close events',()=>{
 const first=view('first'),second=view('second'),disconnect={reason:'error' as const,at:1700000000000,error:'Keepalive timeout'};
 useStore.setState({views:[first,second]});
 useStore.getState().event({type:'terminal.closed',terminalId:'first',generation:1,disconnect});
 useStore.getState().event({type:'connection.state',connectionId:'shared',generation:1,profileId:'fixture',state:'closed',disconnect});
 useStore.getState().event({type:'terminal.closed',terminalId:'first'});
 expect(useStore.getState().terminalDisconnects.first).toEqual(disconnect);
 expect(useStore.getState().terminalDisconnects.second).toMatchObject(disconnect);
});
it('keeps pre-mount disconnect details and ignores a stale terminal generation',()=>{
 const terminal=view('late'),disconnect={reason:'error' as const,at:1700000000000,error:'ECONNRESET'};
 useStore.getState().event({type:'connection.state',connectionId:'shared',generation:1,profileId:'fixture',state:'closed',disconnect});
 useStore.setState({views:[terminal]});
 useStore.getState().event({type:'terminal.closed',terminalId:'late',generation:2,disconnect:{reason:'user',at:2}});
 expect(useStore.getState().terminalDisconnects.late).toBeUndefined();
 useStore.getState().event({type:'terminal.closed',terminalId:'late',generation:1});
 expect(useStore.getState().terminalDisconnects.late).toMatchObject(disconnect);
});
