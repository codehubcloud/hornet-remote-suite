import { contextBridge,ipcRenderer } from 'electron';
import type { HornetApi,HornetEvent,Method,Result } from '../../../packages/contracts';
function requestId(){// crypto.randomUUID is available in the isolated preload global.
  return crypto.randomUUID();
}
async function call<T>(method:Method,payload:unknown={}):Promise<T>{
  const result=await ipcRenderer.invoke('hornet:request',{version:1,requestId:requestId(),deadlineMs:Date.now()+120000,method,payload}) as Result<T>;
  if(!result.ok)throw new Error(result.error.code+' · '+result.error.message);return result.data;
}
async function local<T>(method:string,payload:unknown={}):Promise<T>{const result=await ipcRenderer.invoke('hornet:local',{method,payload}) as Result<T>;if(!result.ok)throw new Error(result.error.code+' · '+result.error.message);return result.data;}
const api:HornetApi={
 print:{status:()=>call('print.status'),start:config=>call('print.start',config),stop:()=>call('print.stop'),submit:jobId=>call('print.submit',{jobId}),cancel:jobId=>call('print.cancel',{jobId}),printers:()=>local('print.printers')},
 x11:{status:()=>call('x11.status'),configure:display=>local('x11.configure',{display}),launch:(profileId,command)=>call('x11.launch',{profileId,command}),stop:id=>call('x11.stop',{id})},
 rdp:{probe:()=>local('rdp.probe'),open:config=>local('rdp.open',config),list:()=>local('rdp.list'),close:id=>local('rdp.close',{id})},
 vnc:{open:(profileId,host,port)=>call('vnc.open',{profileId,host,port}),close:desktopId=>call('vnc.close',{desktopId})},
 tunnel:{list:()=>call('tunnel.list'),create:config=>call('tunnel.create',config),stop:tunnelId=>call('tunnel.stop',{tunnelId})},
 profiles:{removeGroup:(path,members)=>call('group.remove',{path,members}),list:()=>call('profile.list'),save:(profile,expectedRevision)=>call('profile.save',{profile,expectedRevision}),delete:(profileId,expectedRevision)=>call('profile.delete',{profileId,expectedRevision}),import:()=>local('profile.import'),export:()=>local('profile.export')},
 connection:{open:(profileId,purpose)=>call('connection.open',{profileId,purpose}),release:leaseId=>call('connection.release',{leaseId}),close:(connectionId,generation)=>call('connection.close',{connectionId,generation})},
 auth:{respond:(challengeId,response,remember)=>call('auth.respond',{challengeId,response,remember}),cancel:challengeId=>call('auth.cancel',{challengeId}),trust:(challengeId,decision)=>call('trust.resolve',{challengeId,decision}),chooseKey:challengeId=>local('auth.key',{challengeId}),lock:()=>local('vault.lock')},
 terminal:{cwd:terminalId=>call('terminal.cwd',{terminalId}),create:(connectionId,cols,rows,trackDirectory)=>call('terminal.create',{connectionId,cols,rows,trackDirectory}),attach:terminalId=>call('terminal.attach',{terminalId}),write:(terminalId,generation,seq,data)=>ipcRenderer.send('hornet:terminal',{kind:'write',payload:{terminalId,generation,seq,data}}),ack:(terminalId,seq)=>ipcRenderer.send('hornet:terminal',{kind:'ack',payload:{terminalId,seq}}),resize:(terminalId,generation,cols,rows)=>call('terminal.resize',{terminalId,generation,cols,rows}),close:terminalId=>call('terminal.close',{terminalId})},
 file:{chmod:(connectionId,path,mode)=>call('file.chmod',{connectionId,path,mode}),list:(connectionId,path)=>call('file.list',{connectionId,path}),read:(connectionId,path)=>call('file.read',{connectionId,path}),save:(connectionId,path,content,expectedHash)=>call('file.save',{connectionId,path,content,expectedHash}),choose:(direction,name)=>local('file.choose',{direction,name}),mkdir:(connectionId,path)=>call('file.mkdir',{connectionId,path}),rename:(connectionId,path,target)=>call('file.rename',{connectionId,path,target}),remove:(connectionId,path)=>call('file.remove',{connectionId,path})},
 transfer:{start:(connectionId,direction,pathGrantId,remotePath,idempotencyKey)=>call('transfer.start',{connectionId,direction,pathGrantId,remotePath,idempotencyKey})},
 task:{list:()=>call('task.list'),pause:(taskId,expectedRevision)=>call('task.pause',{taskId,expectedRevision}),cancel:(taskId,expectedRevision)=>call('task.cancel',{taskId,expectedRevision}),resume:(taskId,expectedRevision)=>call('task.resume',{taskId,expectedRevision})},
 layout:{load:()=>call('layout.load'),save:layout=>call('layout.save',layout)},
 capabilities:()=>call('capability.list'),
 onEvent:listener=>{const fn=(_event:Electron.IpcRendererEvent,event:HornetEvent)=>listener(event);ipcRenderer.on('hornet:event',fn);return()=>ipcRenderer.removeListener('hornet:event',fn);}
};
contextBridge.exposeInMainWorld('hornet',api);
