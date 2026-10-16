import { afterEach,it,expect } from 'vitest';
import { isTerminalClosed,useStore,type View } from '../../apps/desktop/renderer/store';
import { useBroadcast } from '../../apps/desktop/renderer/broadcast';

const view=(id:string,connectionId='shared'):View=>({id,kind:'terminal',connectionId,terminalId:id,generation:1,profile:{profileId:'fixture',name:id,host:'localhost',port:22,username:'test',group:'',authType:'password',revision:1}});
afterEach(()=>{useStore.setState({views:[],closedTerminals:{},connectionStates:{}});useBroadcast.getState().stop();});

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
