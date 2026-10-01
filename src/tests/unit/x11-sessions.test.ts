import { afterEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { randomBytes } from 'node:crypto';
import type { ClientChannel } from 'ssh2';
import { X11Service } from '../../services/x11/sessions';
import type { Connections } from '../../services/ssh/connections';
import type { XServers } from '../../services/x11/engine';

vi.mock('node:net',async()=>{
  const {EventEmitter}=await import('node:events');
  return {createConnection:vi.fn(()=>{
    const socket=new EventEmitter() as EventEmitter & {setTimeout:ReturnType<typeof vi.fn>;destroy:ReturnType<typeof vi.fn>};
    socket.setTimeout=vi.fn();
    socket.destroy=vi.fn(()=>socket.emit('close'));
    queueMicrotask(()=>socket.emit('connect'));
    return socket;
  })};
});

function authority(cookie:Buffer,display=0){
  return Buffer.concat([Buffer.from([255,255]),...[Buffer.alloc(0),Buffer.from(String(display)),Buffer.from('MIT-MAGIC-COOKIE-1'),cookie].flatMap(field=>{
    const length=Buffer.alloc(2);length.writeUInt16BE(field.length);return [length,field];
  })]);
}
function commandStream(){
  return Object.assign(new PassThrough(),{stderr:new PassThrough()}) as unknown as ClientChannel;
}
const services:X11Service[]=[];
afterEach(()=>{for(const service of services.splice(0))service.stop();vi.useRealTimers();});
function fixture(engines?:XServers){
  const client=Object.assign(new EventEmitter(),{exec:vi.fn()});
  const lease={connectionId:'connection',leaseId:'lease',generation:1};
  const connections={acquire:vi.fn(async()=>lease),acquireIsolated:vi.fn(async()=>lease),get:vi.fn(()=>({client})),release:vi.fn()};
  const service=new X11Service(connections as unknown as Connections,engines);services.push(service);
  const cookie=randomBytes(16);service.configure(0,authority(cookie));
  const stream=commandStream();
  client.exec.mockImplementation((_command,_options,callback)=>callback(undefined,stream));
  return {service,connections,client,lease,stream,cookie};
}
async function until(predicate:()=>boolean){
  for(let attempt=0;attempt<30;attempt++){if(predicate())return;await Promise.resolve();}
  expect(predicate()).toBe(true);
}

it('keeps the previous configuration after invalid authority and rejects invalid displays',()=>{
  const {service}=fixture();
  expect(()=>service.configure(3,Buffer.from([0]))).toThrow('Xauthority');
  expect(service.status()).toMatchObject({configured:true,display:0});
  for(const display of [-1,100,0.5,NaN])expect(()=>service.configure(display,Buffer.alloc(0))).toThrow();
});

it('exposes launch state, isolates owners and snapshots, and retains forwarding after successful command exit',async()=>{
  const {service,connections,client,stream}=fixture();
  const {id}=await service.launch('a','profile','xclock &');
  expect(service.status('a').sessions[0]).toMatchObject({id,command:'xclock &',state:'running',activeChannels:0});
  expect(service.status('b').sessions).toEqual([]);
  service.status('a').sessions[0].state='failed';
  expect(service.status('a').sessions[0].state).toBe('running');
  expect(()=>service.close('b',id)).toThrow('无权');
  stream.emit('exit',0);
  expect(service.status('a').sessions[0]).toMatchObject({state:'command-exited',exitCode:0});
  expect(client.listenerCount('x11')).toBe(1);
  expect(connections.release).not.toHaveBeenCalled();
  await expect(service.launch('a','profile','again')).rejects.toMatchObject({code:'X11_DISPLAY_BUSY'});
  service.close('a',id);service.close('a',id);
  expect(connections.release).toHaveBeenCalledTimes(1);
  expect(client.listenerCount('x11')).toBe(0);
  expect(stream.destroyed).toBe(true);
});

it('treats command channel closure without an exit-status as exited and retains the forwarding lease',async()=>{
  const {service,stream,connections}=fixture();
  await service.launch('a','profile','daemon');
  stream.emit('close');
  expect(service.status().sessions[0].state).toBe('command-exited');
  expect(connections.release).not.toHaveBeenCalled();
});

it.each([[127,undefined],[null,'TERM']] as const)('reports failed exit %s / %s and frees its lease',async(code,signal)=>{
  const {service,stream,connections,client}=fixture();
  await service.launch('a','profile','missing-command');
  stream.emit('exit',code,signal);
  expect(service.status().sessions[0]).toMatchObject({state:'failed',activeChannels:0});
  expect(service.status().sessions[0].error).toBeTruthy();
  expect(connections.release).toHaveBeenCalledTimes(1);
  expect(client.listenerCount('x11')).toBe(0);
});

it('cancels a launch waiting for SSH and releases a late lease without running the command',async()=>{
  const {service,connections,client,lease}=fixture();
  let acquired!:(value:typeof lease)=>void;
  connections.acquire.mockImplementation(()=>new Promise(resolve=>{acquired=resolve;}));
  const launching=service.launch('a','profile','xclock');
  const rejected=expect(launching).rejects.toMatchObject({code:'IPC006'});
  await until(()=>connections.acquire.mock.calls.length===1);
  const id=service.status().sessions[0].id;
  expect(service.status().sessions[0].state).toBe('connecting');
  service.close('a',id);
  await rejected;
  expect(service.status().sessions).toEqual([]);
  acquired(lease);
  await until(()=>connections.release.mock.calls.length===1);
  expect(client.exec).not.toHaveBeenCalled();
});

it('cancels a pending exec immediately and destroys a late command stream',async()=>{
  const {service,connections,client}=fixture();
  let complete!:(error:undefined,stream:ClientChannel)=>void;
  client.exec.mockImplementation((_command,_options,callback)=>{complete=callback;});
  const launching=service.launch('a','profile','xclock');
  const rejected=expect(launching).rejects.toMatchObject({code:'IPC006'});
  await until(()=>!!complete);
  service.close('a',service.status().sessions[0].id);
  await rejected;
  const late=commandStream();complete(undefined,late);
  expect(late.destroyed).toBe(true);
  expect(connections.release).toHaveBeenCalledTimes(1);
});

it('times out an unanswered X11 request and leaves a useful failure record',async()=>{
  vi.useFakeTimers();
  const {service,client,connections}=fixture();
  client.exec.mockImplementation(()=>{});
  const launching=service.launch('a','profile','xclock');
  const rejected=expect(launching).rejects.toMatchObject({code:'X11_LAUNCH_FAILED'});
  await until(()=>client.exec.mock.calls.length===1);
  await vi.advanceTimersByTimeAsync(15000);
  await rejected;
  expect(service.status().sessions[0]).toMatchObject({state:'failed',error:'X11 转发或命令启动超时。'});
  expect(connections.release).toHaveBeenCalledTimes(1);
  expect(client.listenerCount('x11')).toBe(0);
});

it('settles a pending launch on SSH disconnect and preserves shared connection ownership',async()=>{
  const {service,client,connections}=fixture();
  client.exec.mockImplementation(()=>{});
  const launching=service.launch('a','profile','xclock');
  const rejected=expect(launching).rejects.toMatchObject({code:'SSH006'});
  await until(()=>client.exec.mock.calls.length===1);
  client.emit('close');
  await rejected;
  expect(service.status().sessions[0].state).toBe('failed');
  expect(connections.release).toHaveBeenCalledTimes(1);
});

it('cleans failed requests, permits retry, and bounds failure history',async()=>{
  const {service,client,connections}=fixture();
  client.exec.mockImplementation((_command,_options,callback)=>callback(new Error('server denied')));
  for(let index=0;index<22;index++){
    await expect(service.launch('a','profile','xclock')).rejects.toMatchObject({code:'X11_FORWARD_DENIED'});
  }
  expect(service.status().sessions).toHaveLength(20);
  expect(connections.release).toHaveBeenCalledTimes(22);
  expect(client.listenerCount('x11')).toBe(0);
  expect(client.listenerCount('error')).toBe(0);
});

it('counts forwarded channels, enforces the channel limit, and closes every stream on stop',async()=>{
  const {service,client,connections}=fixture();
  const {id}=await service.launch('a','profile','xclock');
  const channels=Array.from({length:32},()=>commandStream());
  const reject=vi.fn();
  for(const channel of channels)client.emit('x11',{},()=>channel,reject);
  expect(service.status().sessions[0].activeChannels).toBe(32);
  const accept=vi.fn();client.emit('x11',{},accept,reject);
  expect(accept).not.toHaveBeenCalled();expect(reject).toHaveBeenCalledTimes(1);
  service.close('a',id);
  expect(channels.every(channel=>channel.destroyed)).toBe(true);
  expect(connections.release).toHaveBeenCalledTimes(1);
});

it('stops during connection acquisition and never revives on a late result',async()=>{
  const {service,connections,lease,client}=fixture();
  let acquired!:(value:typeof lease)=>void;
  connections.acquire.mockImplementation(()=>new Promise(resolve=>{acquired=resolve;}));
  const launching=service.launch('a','profile','xclock');
  const rejected=expect(launching).rejects.toMatchObject({code:'IPC006'});
  await until(()=>!!acquired);
  service.stop();await rejected;
  acquired(lease);await until(()=>connections.release.mock.calls.length===1);
  expect(service.status()).toEqual({configured:false,display:0,sessions:[]});
  expect(client.exec).not.toHaveBeenCalled();
  expect(()=>service.configure(0,authority(randomBytes(16)))).toThrow('已停止');
});

it('uses separate managed displays and isolated SSH leases, and stops only the selected engine',async()=>{
 const stop1=vi.fn(async()=>{}),stop2=vi.fn(async()=>{});
 const engines={start:vi.fn().mockResolvedValueOnce({display:10,port:6010,cookie:randomBytes(16),stop:stop1}).mockResolvedValueOnce({display:11,port:6011,cookie:randomBytes(16),stop:stop2})};
 const {service,connections}=fixture(engines as unknown as XServers);
 const options={mode:'multiWindow' as const,dpi:96,allowNetworkListener:true as const};
 const first=await service.launch('a','profile','first',options),second=await service.launch('a','profile','second',options);
 expect(service.status().sessions.map(s=>s.display)).toEqual([10,11]);expect(connections.acquireIsolated).toHaveBeenCalledTimes(2);expect(connections.acquire).not.toHaveBeenCalled();
 service.close('a',first.id);expect(stop1).toHaveBeenCalledOnce();expect(stop2).not.toHaveBeenCalled();expect(service.status().sessions[0].id).toBe(second.id);
 service.close('a',second.id);expect(stop2).toHaveBeenCalledOnce();
});

it('marks the owning session failed when its managed X Server exits',async()=>{
 let onExit!:(error:Error)=>void;const stop=vi.fn(async()=>{});
 const engines={start:vi.fn(async(_options,_signal,exited)=>{onExit=exited;return {display:10,port:6010,cookie:randomBytes(16),stop};})};
 const {service,connections}=fixture(engines as unknown as XServers);
 await service.launch('a','profile','xclock',{mode:'multiWindow',dpi:96,allowNetworkListener:true});
 onExit(new Error('Engine died'));
 expect(service.status().sessions[0]).toMatchObject({state:'failed',error:'Engine died'});expect(stop).toHaveBeenCalledOnce();expect(connections.release).toHaveBeenCalledOnce();
});
