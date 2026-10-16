import { EventEmitter } from 'node:events';
import { afterEach,it,expect,vi } from 'vitest';
import { createConnection,type Socket } from 'node:net';
import { connectSocket } from '../../services/ssh/connect-socket';

vi.mock('node:net',()=>({createConnection:vi.fn()}));
function pendingSocket(){
 vi.useFakeTimers();const socket=Object.assign(new EventEmitter(),{destroy:vi.fn()});
 vi.mocked(createConnection).mockReturnValue(socket as unknown as Socket);return socket;
}
afterEach(()=>{vi.useRealTimers();vi.clearAllMocks();});
it('bounds DNS/TCP establishment even when the OS emits neither connect nor error',async()=>{
 const socket=pendingSocket(),pending=connectSocket('offline.example',22,new AbortController().signal);
 const rejected=expect(pending).rejects.toThrow('offline.example:22 · 连接超时');
 await vi.advanceTimersByTimeAsync(9999);expect(socket.destroy).not.toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(1);await rejected;expect(socket.destroy).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
});
it('immediately cancels a pending TCP socket and clears its deadline',async()=>{
 const socket=pendingSocket(),controller=new AbortController(),pending=connectSocket('offline.example',22,controller.signal);
 const rejected=expect(pending).rejects.toThrow('取消');controller.abort();await rejected;
 expect(socket.destroy).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
});
it('hands off a connected socket without leaving a network timer that could interrupt credentials',async()=>{
 const socket=pendingSocket(),controller=new AbortController(),pending=connectSocket('online.example',22,controller.signal);
 socket.emit('connect');await expect(pending).resolves.toBe(socket);await vi.advanceTimersByTimeAsync(20000);controller.abort();
 expect(socket.destroy).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
});
it('reports DNS failure and destroys the pending socket without waiting for its deadline',async()=>{
 const socket=pendingSocket(),pending=connectSocket('unknown.example',22,new AbortController().signal);
 const rejected=expect(pending).rejects.toThrow('无法解析服务器地址');socket.emit('error',Object.assign(new Error('DNS failure'),{code:'ENOTFOUND'}));await rejected;
 expect(socket.destroy).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
});
