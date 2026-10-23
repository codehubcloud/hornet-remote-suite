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
let clipboardSequence:Promise<unknown>=Promise.resolve();
function clipboardCall<T>(method:string,payload:unknown={}):Promise<T>{
 const request=clipboardSequence.then(()=>local<T>(method,payload));
 clipboardSequence=request.catch(()=>{});return request;
}
const api:HornetApi={
 zmodem:{start:(terminalId,direction)=>local('zmodem.start',{terminalId,direction}),list:()=>call('zmodem.list'),cancel:id=>call('zmodem.cancel',{id})},
 workbench:{create:()=>local('workbench.create'),cascade:()=>local('workbench.cascade'),move:payload=>local('workbench.move',payload),initial:()=>local('workbench.initial'),close:()=>local('workbench.close'),onClose:listener=>{ipcRenderer.on('hornet:close-workbench',listener);return()=>ipcRenderer.removeListener('hornet:close-workbench',listener);}},
 schedules:{list:()=>local('schedules.list'),create:input=>local('schedules.create',input),run:id=>local('schedules.run',{id}),cancel:id=>local('schedules.cancel',{id}),remove:id=>local('schedules.remove',{id})},
 knownHosts:{list:()=>call('knownHosts.list'),remove:(id,fingerprint)=>call('knownHosts.remove',{id,fingerprint:fingerprint})},
 keys:{list:()=>local('keys.list'),generate:(name,algorithm,passphrase)=>local('keys.generate',{name,algorithm,passphrase}),import:(name,passphrase)=>local('keys.import',{name,passphrase}),remove:id=>local('keys.remove',{id}),export:(id,privateKey)=>local('keys.export',{id,privateKey}),use:(challengeId,id)=>local('keys.use',{challengeId,id})},
 identities:{list:()=>local('identities.list'),save:(identity,password,clearPassword)=>local('identities.save',{identity,password,clearPassword}),remove:id=>local('identities.remove',{id}),revealPassword:id=>local('identities.revealPassword',{id})},
 help:{info:()=>local('help.info'),checkUpdates:()=>local('help.checkUpdates'),downloadUpdate:()=>local('help.downloadUpdate'),installUpdate:()=>local('help.installUpdate'),openLink:link=>local('help.openLink',{link}),openPdf:language=>local('help.openPdf',{language})},
 documents:{print:document=>local('documents.print',document)},
 windowChrome:{toggleFullscreen:()=>local('windowChrome.toggleFullscreen',{}),getFullscreen:()=>local('windowChrome.getFullscreen',{}),setFullscreen:value=>local('windowChrome.setFullscreen',{value}),onFullscreen:listener=>{const handler=(_event:unknown,value:boolean)=>listener(value===true);ipcRenderer.on('hornet:fullscreen',handler);return()=>{ipcRenderer.removeListener('hornet:fullscreen',handler);};},platform:process.platform,setColors:colors=>local('windowChrome.colors',colors),onContextMenu:listener=>{const handler=(_event:unknown,point:{x:number;y:number})=>{if(point&&Number.isFinite(point.x)&&Number.isFinite(point.y))listener({x:point.x,y:point.y});};ipcRenderer.on('hornet:chrome-context',handler);return()=>{ipcRenderer.removeListener('hornet:chrome-context',handler);};}},
 clipboard:{writeRtf:text=>clipboardCall('clipboard.writeRtf',{text}),read:()=>clipboardCall('clipboard.read'),write:text=>clipboardCall('clipboard.write',{text})},
 localTerminal:{shells:()=>call('localTerminal.shells'),open:config=>call('localTerminal.open',config)},
 serialTerminal:{list:()=>call('serialTerminal.list'),open:config=>call('serialTerminal.open',config)},
 terminalLogs:{openRecording:id=>local('terminalLogs.openRecording',{id}),start:(terminalId,format)=>local('terminalLogs.start',{terminalId,format}),stop:id=>local('terminalLogs.stop',{id}),list:()=>local('terminalLogs.list')},
 telnet:{open:(profileId,cols,rows)=>call('telnet.open',{profileId,cols,rows})},
 rlogin:{open:(profileId,cols,rows)=>call('rlogin.open',{profileId,cols,rows})},
 mosh:{open:(profileId,cols,rows)=>call('mosh.open',{profileId,cols,rows})},
 treeTransfer:{preview:request=>local('treeTransfer.preview',request),execute:planId=>local('treeTransfer.execute',{planId}),discard:planId=>local('treeTransfer.discard',{planId})},
 localFiles:{rename:(rootId,path,name)=>local('localFiles.rename',{rootId,path,name}),remove:(rootId,path)=>local('localFiles.remove',{rootId,path}),copy:(sourceId,path,targetId,parent)=>local('localFiles.copy',{sourceId,path,targetId,parent}),choose:()=>local('localFiles.choose'),list:(rootId,path)=>local('localFiles.list',{rootId,path}),mkdir:(rootId,path,name)=>local('localFiles.mkdir',{rootId,path,name}),grant:(rootId,path,direction,name)=>local('localFiles.grant',{rootId,path,direction,name}),release:rootId=>local('localFiles.release',{rootId})},

 print:{setDefault:queue=>call('print.default',{queue}),removeJobs:jobIds=>call('print.jobs.remove',{jobIds}),exportJob:jobId=>local('print.export',{jobId}),saveQueue:queue=>call('print.queue.save',queue),removeQueue:queue=>call('print.queue.remove',{queue}),status:()=>call('print.status'),start:config=>call('print.start',config),stop:()=>call('print.stop'),submit:jobId=>call('print.submit',{jobId}),cancel:jobId=>call('print.cancel',{jobId}),printers:()=>local('print.printers')},
 x11:{status:()=>call('x11.status'),engine:()=>call('x11.engine'),chooseEngine:()=>local('x11.engine.choose'),configure:display=>local('x11.configure',{display}),launch:(profileId,command,managed)=>call('x11.launch',{profileId,command,managed}),stop:id=>call('x11.stop',{id})},
 xdmcp:{interfaces:()=>call('xdmcp.interfaces'),query:(host,localAddress,port)=>call('xdmcp.query',{host,localAddress,port}),open:config=>call('xdmcp.open',config),list:()=>call('xdmcp.list'),close:id=>call('xdmcp.close',{id})},
 rdp:{probe:()=>local('rdp.probe'),open:config=>local('rdp.open',config),list:()=>local('rdp.list'),close:id=>local('rdp.close',{id})},
 vnc:{open:(profileId,host,port)=>call('vnc.open',{profileId,host,port}),close:desktopId=>call('vnc.close',{desktopId})},
 tunnel:{list:()=>call('tunnel.list'),create:config=>call('tunnel.create',config),stop:tunnelId=>call('tunnel.stop',{tunnelId})},
 profiles:{credentialStatus:profileId=>local('profile.credentialStatus',{profileId}),revealPassword:(profileId,expectedRevision)=>local('profile.revealPassword',{profileId,expectedRevision}),removeGroup:(path,members)=>call('group.remove',{path,members}),list:()=>call('profile.list'),save:(profile,expectedRevision,credential)=>local('profile.save',{profile,expectedRevision,credential}),delete:(profileId,expectedRevision)=>call('profile.delete',{profileId,expectedRevision}),import:()=>local('profile.import'),export:()=>local('profile.export')},
 connection:{retain:connectionId=>call('connection.retain',{connectionId}),open:(profileId,purpose,fresh)=>call('connection.open',{profileId,purpose,fresh}),release:leaseId=>call('connection.release',{leaseId}),close:(connectionId,generation)=>call('connection.close',{connectionId,generation})},
 auth:{respond:(challengeId,response,remember)=>call('auth.respond',{challengeId,response,remember}),cancel:challengeId=>call('auth.cancel',{challengeId}),trust:(challengeId,decision)=>call('trust.resolve',{challengeId,decision}),chooseKey:challengeId=>local('auth.key',{challengeId}),lock:()=>local('vault.lock')},
 terminal:{detach:terminalId=>call('terminal.detach',{terminalId}),encoding:(terminalId,generation,encoding)=>call('terminal.encoding',{terminalId,generation,encoding}),send:(terminalId,generation,seq,data)=>call('terminal.send',{terminalId,generation,seq,data}),exportText:(name,text)=>local('terminal.exportText',{name,text}),cwd:terminalId=>call('terminal.cwd',{terminalId}),create:(connectionId,cols,rows,trackDirectory)=>call('terminal.create',{connectionId,cols,rows,trackDirectory}),attach:terminalId=>call('terminal.attach',{terminalId}),write:(terminalId,generation,seq,data)=>ipcRenderer.send('hornet:terminal',{kind:'write',payload:{terminalId,generation,seq,data}}),ack:(terminalId,seq)=>ipcRenderer.send('hornet:terminal',{kind:'ack',payload:{terminalId,seq}}),resize:(terminalId,generation,cols,rows)=>call('terminal.resize',{terminalId,generation,cols,rows}),close:terminalId=>call('terminal.close',{terminalId})},
 ftp:{mode:(connectionId,mode)=>call('ftp.mode',{connectionId,mode}),command:(connectionId,command)=>call('ftp.command',{connectionId,command})},
 file:{chmod:(connectionId,path,mode)=>call('file.chmod',{connectionId,path,mode}),list:(connectionId,path)=>call('file.list',{connectionId,path}),read:(connectionId,path)=>call('file.read',{connectionId,path}),save:(connectionId,path,content,expectedHash)=>call('file.save',{connectionId,path,content,expectedHash}),choose:(direction,name)=>local('file.choose',{direction,name}),mkdir:(connectionId,path)=>call('file.mkdir',{connectionId,path}),rename:(connectionId,path,target)=>call('file.rename',{connectionId,path,target}),remove:(connectionId,path)=>call('file.remove',{connectionId,path})},
 transfer:{start:(connectionId,direction,pathGrantId,remotePath,idempotencyKey)=>call('transfer.start',{connectionId,direction,pathGrantId,remotePath,idempotencyKey})},
 task:{list:()=>call('task.list'),pause:(taskId,expectedRevision)=>call('task.pause',{taskId,expectedRevision}),cancel:(taskId,expectedRevision)=>call('task.cancel',{taskId,expectedRevision}),resume:(taskId,expectedRevision)=>call('task.resume',{taskId,expectedRevision})},
 layout:{load:()=>call('layout.load'),save:layout=>call('layout.save',layout)},
 capabilities:()=>call('capability.list'),
 onEvent:listener=>{const fn=(_event:Electron.IpcRendererEvent,event:HornetEvent)=>listener(event);ipcRenderer.on('hornet:event',fn);return()=>ipcRenderer.removeListener('hornet:event',fn);}
};
contextBridge.exposeInMainWorld('hornet',api);
