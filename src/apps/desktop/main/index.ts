import { TransferSchedules } from './transfer-schedules';
import { scheduleInput } from '../../../packages/contracts/transfer-schedules';
import { IdentityStore } from './identity-store';
import { identitySchema } from '../../../packages/contracts/identities';
import { app,BrowserWindow,dialog,clipboard,ClipboardItem,ipcMain,protocol,net,screen,type IpcMainInvokeEvent,type IpcMainEvent } from 'electron';
import { FullscreenController } from './fullscreen';
import { plainRtf } from './rtf';
import { join,basename,resolve,sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile,writeFile,stat } from 'node:fs/promises';
import { z } from 'zod';
import { envelopeSchema,schemas,profileSchema,profileCredentialSchema,terminalAckSchema,terminalInputSchema,type HornetEvent,type Profile,type TaskSnapshot } from '../../../packages/contracts';
import { AppError,safeError } from '../../../packages/core/errors';
import { TreeTransfers } from '../../../services/file/tree-transfers';
import { treeRequestSchema } from '../../../packages/contracts/file-tree';
import { readRecording } from '../../../services/terminal/recordings';
import { TerminalLogs } from '../../../services/terminal/logs';
import { LocalFiles } from '../../../services/file/local-files';
import { PathGrants } from '../../../packages/security/path-grants';
import { Vault } from './vault';
import { ProfileCredentials } from './profile-credentials';
import { Backend } from './backend';
import { ExitController } from './exit-controller';
import { appInfo,checkUpdates,downloadUpdate,installUpdate,openHelpLink,openHelpPdf } from './help';
import { RdpService, nativeCall } from '../../../services/native/host';
import { rdpConfigSchema } from '../../../packages/contracts/native';
const rdp=new RdpService();
protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
if(process.env.HORNET_USER_DATA)app.setPath('userData',process.env.HORNET_USER_DATA);
let window:BrowserWindow|undefined,backend:Backend,vault:Vault;
let fullscreen:FullscreenController;
const workbenches=new Set<BrowserWindow>(),controllers=new Map<number,FullscreenController>(),initialWindows=new Map<number,unknown>();
const challengeWindows=new Map<string,number>();
let createWorkbench:(initial?:unknown)=>Promise<BrowserWindow>;
let identities:IdentityStore;
let schedules:TransferSchedules;
const taskCache=new Map<string,TaskSnapshot>();
const grants=new PathGrants();
const localFiles=new LocalFiles(grants);
const challenges=new Map<string,Extract<HornetEvent,{type:'challenge'}>>();
const pendingPasswords=new Map<string,string>();
const terminalSizes=new Map<string,{cols:number;rows:number}>();
const logs=new TerminalLogs((_owner,log)=>emit({type:'terminal.log',log}));
const emit=(event:HornetEvent)=>{
  if(event.type==='challenge'&&![...workbenches].some(target=>!target.isDestroyed()&&target.webContents.id===challengeWindows.get(event.profileId))){const focused=BrowserWindow.getFocusedWindow(),target=focused&&workbenches.has(focused)?focused:[...workbenches].find(target=>!target.isDestroyed());if(target)challengeWindows.set(event.profileId,target.webContents.id);}
  if(event.type==='task.state')taskCache.set(event.task.taskId,event.task);
  logs.observe('local-user',event);
  if(event.type==='terminal.closed')terminalSizes.delete(event.terminalId);
  if(event.type==='challenge')challenges.set(event.challengeId,event);
  if(event.type==='challenge.closed')challenges.delete(event.challengeId);
  if(event.type==='connection.state'&&event.state==='ready'){
    const secret=pendingPasswords.get(event.profileId);pendingPasswords.delete(event.profileId);
    if(secret)void backend.call<Profile[]>('profile.list').then(profiles=>{const p=profiles.find(p=>p.profileId===event.profileId);if(p)vault.save(p,secret);}).catch(()=>emit({type:'service.error',message:'系统凭据保存失败，密码未持久化。'}));
  }
  if(event.type==='connection.state'&&event.state==='failed')pendingPasswords.delete(event.profileId);
  for(const target of workbenches)if(!target.isDestroyed()&&(event.type!=='challenge'||!challengeWindows.has(event.profileId)||target.webContents.id===challengeWindows.get(event.profileId)))target.webContents.send('hornet:event',event);
};
function authorize(event:IpcMainInvokeEvent|IpcMainEvent){
  const source=BrowserWindow.fromWebContents(event.sender);
  if(!source||!workbenches.has(source)||event.senderFrame!==event.sender.mainFrame||!event.senderFrame?.url.startsWith('app://hornet/'))throw new AppError('IPC005','请求来源无权访问。');
}
function responseError(e:unknown,requestId='local'){return {ok:false,requestId,error:e instanceof z.ZodError?{code:'IPC002',message:'请求参数无效。',retryable:false}:safeError(e)};}
async function setupIpc(){
  const treeTransfers=new TreeTransfers(localFiles,grants,backend);
  const credentials=new ProfileCredentials(vault,()=>backend.call('profile.list'),(profile,expectedRevision)=>backend.call('profile.save',{profile,expectedRevision}));
  ipcMain.handle('hornet:request',async(event,raw:unknown)=>{
    let requestId='';
    try{
      authorize(event);
      if(Buffer.byteLength(JSON.stringify(raw))>262144)throw new AppError('IPC002','请求过大。');
      const req=envelopeSchema.parse(raw);requestId=req.requestId;
      if(req.deadlineMs<Date.now())throw new AppError('IPC003','请求已过期。');
      const parsed=schemas[req.method].parse(req.payload);
      if(['connection.open','telnet.open','rlogin.open','mosh.open'].includes(req.method)&&parsed&&typeof parsed==='object'&&'profileId' in parsed)challengeWindows.set(String(parsed.profileId),event.sender.id);
      if(req.method==='auth.respond'){
        const p=schemas['auth.respond'].parse(parsed),challenge=challenges.get(p.challengeId);
        if(!challenge||challenge.kind==='privateKey')throw new AppError('IPC005','认证请求无效。');
        if(p.remember&&challenge.kind==='password')pendingPasswords.set(challenge.profileId,p.response);
      }
      let context:{localPath:string;localParent:string}|undefined;
      if(req.method==='transfer.start'){const p=schemas['transfer.start'].parse(parsed),g=await grants.get('local-user',p.pathGrantId,p.direction);context={localPath:g.path,localParent:g.parent};}
      const data=await backend.call(req.method,parsed,context,Math.min(120000,Math.max(1,req.deadlineMs-Date.now())));
      if(req.method==='task.list')for(const task of data as TaskSnapshot[])taskCache.set(task.taskId,task);
      if(req.method==='terminal.resize'){const p=schemas['terminal.resize'].parse(parsed);terminalSizes.set(p.terminalId,{cols:p.cols,rows:p.rows});logs.resize('local-user',p.terminalId,p.cols,p.rows);}
      if(req.method==='profile.delete')vault.remove(schemas['profile.delete'].parse(parsed).profileId);
      return {ok:true,requestId,data};
    }catch(e){return responseError(e,requestId);}
  });
  ipcMain.handle('hornet:local',async(event,raw:unknown)=>{
    try{
      authorize(event);const window=BrowserWindow.fromWebContents(event.sender)!,fullscreen=controllers.get(window.id)!;const m=z.object({method:z.string(),payload:z.unknown()}).strict().parse(raw);
      let data:unknown;
      switch(m.method){
        case 'zmodem.start':{const p=z.object({terminalId:z.string().uuid(),direction:z.enum(['send','receive'])}).strict().parse(m.payload);await backend.call('terminal.inspect',{terminalId:p.terminalId});const selected=await dialog.showOpenDialog(window!,{title:p.direction==='send'?'选择发送文件':'选择 ZMODEM 接收目录',properties:[p.direction==='send'?'openFile':'openDirectory']});data=null;if(!selected.canceled&&selected.filePaths[0]){const path=selected.filePaths[0];const {realpath,lstat}=await import('node:fs/promises'),{dirname}=await import('node:path');if((await lstat(path)).isSymbolicLink())throw new Error('请选择普通文件或目录。');const canonical=await realpath(path);data=await backend.call('zmodem.start',p,{localPath:canonical,localParent:await realpath(dirname(canonical))});}break;}
        case 'workbench.create':z.object({}).strict().parse(m.payload);await createWorkbench();data=null;break;
        case 'workbench.initial':z.object({}).strict().parse(m.payload);data=initialWindows.get(window.id)??{secondary:false};initialWindows.delete(window.id);break;
        case 'workbench.close':z.object({}).strict().parse(m.payload);data=null;if(workbenches.size>1)window.destroy();else window.close();break;
        case 'workbench.cascade':{z.object({}).strict().parse(m.payload);const area=screen.getDisplayMatching(window.getBounds()).workArea;let index=0;for(const target of workbenches){if(target.isFullScreen())target.setFullScreen(false);if(target.isMaximized())target.unmaximize();if(target.isMinimized())target.restore();const offset=(index++%6)*32;target.setBounds({x:area.x+offset,y:area.y+offset,width:Math.max(1024,area.width-192),height:Math.max(720,area.height-192)});target.show();}data=null;break;}
        case 'workbench.move':{const payload=z.object({view:z.object({id:z.string().uuid(),kind:z.literal('terminal'),profile:profileSchema,connectionId:z.string().uuid(),leaseId:z.string().uuid().optional(),terminalId:z.string().uuid(),terminalIds:z.array(z.string().uuid()).max(32).optional(),generation:z.number().int().positive(),source:z.enum(['local','serial','mosh']).optional(),title:z.string().max(255).optional(),tabColor:z.string().max(16).optional(),terminalTitle:z.string().max(255).optional()}).strict(),snapshot:z.string().max(8388608),inputSeq:z.number().int().nonnegative()}).strict().parse(m.payload);await backend.call('terminal.inspect',{terminalId:payload.view.terminalId});await createWorkbench({secondary:true,view:payload});data=null;break;}
        case 'schedules.list':z.object({}).strict().parse(m.payload);data=schedules.list();break;
        case 'schedules.create':{const input=scheduleInput.parse(m.payload),profile=(await backend.call<Profile[]>('profile.list')).find(profile=>profile.profileId===input.profileId);if(!profile||profile.session?.s3||!['ssh','ftp'].includes(profile.protocol??'ssh'))throw new AppError('IPC002','请选择 SSH 或 FTP 文件连接。');const selected=input.direction==='upload'?await dialog.showOpenDialog(window!,{properties:['openFile']}):await dialog.showSaveDialog(window!,{defaultPath:basename(input.remotePath)});data=null;const path='filePaths' in selected?selected.filePaths[0]:selected.filePath;if(!selected.canceled&&path){const grant=await grants.create('local-user',path,input.direction);data=schedules.add(input,profile.revision,profile.name,grant.path,grant.parent);}break;}
        case 'schedules.run':data=await schedules.run(z.object({id:z.string().uuid()}).strict().parse(m.payload).id);break;
        case 'schedules.cancel':schedules.cancel(z.object({id:z.string().uuid()}).strict().parse(m.payload).id);data=null;break;
        case 'schedules.remove':schedules.remove(z.object({id:z.string().uuid()}).strict().parse(m.payload).id);data=null;break;
        case 'keys.list':z.object({}).strict().parse(m.payload);data=identities.keys();break;
        case 'keys.generate':{const p=z.object({name:z.string().trim().min(1).max(80),algorithm:z.enum(['ed25519','rsa','ecdsa']),passphrase:z.string().max(4096)}).strict().parse(m.payload);data=await identities.generate(p.name,p.algorithm,p.passphrase);break;}
        case 'keys.import':{const p=z.object({name:z.string().trim().min(1).max(80),passphrase:z.string().max(4096)}).strict().parse(m.payload);const selected=await dialog.showOpenDialog(window!,{title:'导入用户私钥',properties:['openFile']});data=null;if(!selected.canceled&&selected.filePaths[0]){if((await stat(selected.filePaths[0])).size>65536)throw new AppError('FILE_LIMIT','私钥文件过大。');data=identities.importKey(p.name,await readFile(selected.filePaths[0],'utf8'),p.passphrase);}break;}
        case 'keys.remove':{const {id}=z.object({id:z.string().uuid()}).strict().parse(m.payload);if((await backend.call<Profile[]>('profile.list')).some(profile=>profile.session?.keyId===id))throw new AppError('KEY_IN_USE','密钥正在被连接配置使用，请先修改对应配置。');identities.removeKey(id);data=null;break;}
        case 'keys.use':{const p=z.object({id:z.string().uuid(),challengeId:z.string().uuid()}).strict().parse(m.payload);if(challenges.get(p.challengeId)?.kind!=='privateKey')throw new AppError('IPC005','私钥请求已失效。');const key=identities.privateKey(p.id,true);if(!key)throw new AppError('KEY_INVALID','私钥不存在。');await backend.call('auth.key',{challengeId:p.challengeId,key});data=null;break;}
        case 'keys.export':{const p=z.object({id:z.string().uuid(),privateKey:z.boolean()}).strict().parse(m.payload),key=identities.keys().find(key=>key.id===p.id);if(!key)throw new AppError('KEY_INVALID','私钥不存在。');data=false;if(p.privateKey){const confirmation=await dialog.showMessageBox(window!,{type:'question',buttons:['导出私钥','取消'],defaultId:1,cancelId:1,message:'将私钥导出到所选文件',detail:key.name+' · '+key.fingerprint});if(confirmation.response!==0)break;}const selected=await dialog.showSaveDialog(window!,{defaultPath:basename(key.name).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_')+(p.privateKey?'':'.pub')});if(!selected.canceled&&selected.filePath){await writeFile(selected.filePath,p.privateKey?identities.privateKey(p.id,true)!:key.publicKey+'\n',{mode:0o600});data=true;}break;}
        case 'identities.list':z.object({}).strict().parse(m.payload);data=identities.identities();break;
        case 'identities.save':{const p=z.object({identity:identitySchema,password:z.string().max(16384).optional(),clearPassword:z.boolean().optional()}).strict().parse(m.payload);data=identities.saveIdentity(p.identity,p.password,p.clearPassword);break;}
        case 'identities.remove':{const {id}=z.object({id:z.string().uuid()}).strict().parse(m.payload);identities.removeIdentity(id);data=null;break;}
        case 'identities.revealPassword':{const {id}=z.object({id:z.string().uuid()}).strict().parse(m.payload);data=identities.revealPassword(id);break;}
        case 'help.info':z.object({}).strict().parse(m.payload);data=appInfo();break;
        case 'help.checkUpdates':z.object({}).strict().parse(m.payload);data=await checkUpdates();break;
        case 'help.downloadUpdate':z.object({}).strict().parse(m.payload);data=await downloadUpdate(progress=>{if(window&&!window.isDestroyed())window.webContents.send('hornet:event',{type:'update.progress',...progress});});break;
        case 'help.installUpdate':z.object({}).strict().parse(m.payload);await installUpdate();data=null;break;
        case 'help.openLink':{const p=z.object({link:z.enum(['website','support','feedback','releases'])}).strict().parse(m.payload);await openHelpLink(p.link);data=null;break;}
        case 'help.openPdf':{const p=z.object({language:z.enum(['zh-CN','zh-TW','en','ja','ko','de','fr','es'])}).strict().parse(m.payload);await openHelpPdf(p.language);data=null;break;}
        case 'profile.save':{
          const p=z.object({profile:profileSchema,expectedRevision:z.number().int().nonnegative(),credential:profileCredentialSchema.optional()}).strict().parse(m.payload);
          data=await credentials.saveProfile(p.profile,p.expectedRevision,p.credential);break;
        }
        case 'profile.credentialStatus':{
          const {profileId}=z.object({profileId:z.string().uuid()}).strict().parse(m.payload);
          const profile=(await backend.call<Profile[]>('profile.list')).find(p=>p.profileId===profileId);
          data={saved:!!profile&&vault.has(profile)};break;
        }
        case 'profile.revealPassword':{
          const p=z.object({profileId:z.string().uuid(),expectedRevision:z.number().int().nonnegative()}).strict().parse(m.payload);
          data=await credentials.revealPassword(p.profileId,p.expectedRevision);break;
        }
        case 'print.export':{const {jobId}=z.object({jobId:z.string().uuid()}).strict().parse(m.payload);const job=await backend.call<{name:string;data:Uint8Array}>('print.job.read',{jobId});const result=await dialog.showSaveDialog(window!,{defaultPath:basename(job.name).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_')||'print-job.bin'});data=false;if(!result.canceled&&result.filePath){await writeFile(result.filePath,new Uint8Array(job.data));data=true;}break;}
        case 'documents.print':{
          const doc=z.object({text:z.string().max(4194304),title:z.string().max(512),landscape:z.boolean(),pageSize:z.enum(['A4','Letter'])}).strict().parse(m.payload);
          const printWindow=new BrowserWindow({show:false,parent:window,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});
          printWindow.removeMenu();printWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
          const escape=(text:string)=>text.replace(/[&<>"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]!));
          try{await printWindow.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;"><title>'+escape(doc.title)+'</title><style>body{color:#000;background:#fff}pre{font:11pt monospace;white-space:pre-wrap;overflow-wrap:anywhere}</style><pre>'+escape(doc.text)+'</pre>'));
          await new Promise<void>((resolve,reject)=>{printWindow.webContents.print({silent:false,landscape:doc.landscape,pageSize:doc.pageSize,printBackground:false},(success,reason)=>{if(success||/cancel/i.test(reason))resolve();else reject(new Error(reason));});});}finally{if(!printWindow.isDestroyed())printWindow.destroy();}data=null;break;
        }
        case 'windowChrome.getFullscreen':z.object({}).strict().parse(m.payload);data=window?.isFullScreen()??false;break;
        case 'windowChrome.setFullscreen':{const {value}=z.object({value:z.boolean()}).strict().parse(m.payload);fullscreen.set(value);data=null;break;}
        case 'windowChrome.toggleFullscreen':z.object({}).strict().parse(m.payload);fullscreen.toggle();data=null;break;
        case 'windowChrome.colors':{
          const color=z.string().regex(/^#[0-9a-f]{6}$/i);
          const colors=z.object({color,symbolColor:color}).strict().parse(m.payload);
          if(process.platform!=='darwin')window?.setTitleBarOverlay({...colors,height:36});
          data=null;break;
        }
        case 'terminalLogs.openRecording':{
          const p=z.object({id:z.string().uuid().optional()}).strict().parse(m.payload??{});let path:string|undefined;
          if(p.id){const log=logs.list('local-user').find(l=>l.id===p.id);if(!log||log.format!=='recording'||!['stopped','failed'].includes(log.state))throw new AppError('LOG_STATE','请先停止会话录制。');path=log.path;}
          else {const result=await dialog.showOpenDialog(window!,{title:'回放录制文件',properties:['openFile'],filters:[{name:'Hornet 会话录制',extensions:['hrec']}]});if(!result.canceled)path=result.filePaths[0];}
          data=path?await readRecording(path):null;break;
        }
        case 'terminalLogs.list':data=logs.list('local-user');break;
        case 'terminalLogs.stop':data=await logs.stop('local-user',z.object({id:z.string().uuid()}).strict().parse(m.payload).id);break;
        case 'terminalLogs.start':{
          const p=z.object({terminalId:z.string().uuid(),format:z.enum(['text','raw','recording'])}).strict().parse(m.payload);
          await backend.call('terminal.inspect',{terminalId:p.terminalId});
          const selected=await dialog.showSaveDialog(window!,{title:p.format==='recording'?'开始会话录制（包含终端输出）':p.format==='text'?'开始持续文本日志（可能包含敏感输出）':'开始原始终端日志（包含控制序列）',defaultPath:'hornet-terminal-'+new Date().toISOString().replace(/[:.]/g,'-')+(p.format==='recording'?'.hrec':'.log'),filters:[{name:'终端日志',extensions:[p.format==='recording'?'hrec':'log']}]});
          data=null;if(!selected.canceled&&selected.filePath){
            await backend.call('terminal.inspect',{terminalId:p.terminalId});
            const recording=await logs.start('local-user',p.terminalId,selected.filePath,p.format,terminalSizes.get(p.terminalId)?.cols,terminalSizes.get(p.terminalId)?.rows);
            try{await backend.call('terminal.inspect',{terminalId:p.terminalId});data=recording;}catch(e){await logs.stop('local-user',recording.id);throw e;}
          }break;
        }
        case 'treeTransfer.preview':data=await treeTransfers.preview('local-user',treeRequestSchema.parse(m.payload));break;
        case 'treeTransfer.execute':data=await treeTransfers.execute('local-user',z.object({planId:z.string().uuid()}).strict().parse(m.payload).planId);break;
        case 'treeTransfer.discard':treeTransfers.discard('local-user',z.object({planId:z.string().uuid()}).strict().parse(m.payload).planId);data=null;break;
        case 'localFiles.choose':{
          const selected=await dialog.showOpenDialog(window!,{title:'选择本地文件工作目录',properties:['openDirectory']});
          data=selected.canceled?null:await localFiles.choose('local-user',selected.filePaths[0]);break;
        }
        case 'localFiles.list':{const p=z.object({rootId:z.string().uuid(),path:z.string().max(4096)}).strict().parse(m.payload);data=await localFiles.list('local-user',p.rootId,p.path);break;}
        case 'localFiles.rename':{const p=z.object({rootId:z.string().uuid(),path:z.string().max(4096),name:z.string().min(1).max(255)}).strict().parse(m.payload);await localFiles.rename('local-user',p.rootId,p.path,p.name);data=null;break;}
        case 'localFiles.remove':{const p=z.object({rootId:z.string().uuid(),path:z.string().max(4096)}).strict().parse(m.payload);await localFiles.remove('local-user',p.rootId,p.path);data=null;break;}
        case 'localFiles.copy':{const p=z.object({sourceId:z.string().uuid(),path:z.string().max(4096),targetId:z.string().uuid(),parent:z.string().max(4096)}).strict().parse(m.payload);await localFiles.copy('local-user',p.sourceId,p.path,p.targetId,p.parent);data=null;break;}
        case 'localFiles.mkdir':{const p=z.object({rootId:z.string().uuid(),path:z.string().max(4096),name:z.string().min(1).max(255)}).strict().parse(m.payload);data=await localFiles.mkdir('local-user',p.rootId,p.path,p.name);break;}
        case 'localFiles.grant':{const p=z.object({rootId:z.string().uuid(),path:z.string().max(4096),direction:z.enum(['upload','download']),name:z.string().max(255).optional()}).strict().parse(m.payload);data=await localFiles.grant('local-user',p.rootId,p.path,p.direction,p.name);break;}
        case 'localFiles.release':{const p=z.object({rootId:z.string().uuid()}).strict().parse(m.payload);localFiles.release('local-user',p.rootId);data=null;break;}
        case 'clipboard.writeRtf':{const {text}=z.object({text:z.string().max(131072)}).strict().parse(m.payload);await clipboard.write([new ClipboardItem({'text/plain':text,'text/rtf':plainRtf(text)})]);data=null;break;}
        case 'clipboard.read':z.object({}).strict().parse(m.payload??{});data=await clipboard.readText();if((data as string).length>131072)throw new AppError('FILE_LIMIT','Clipboard text exceeds 128 KiB.');break;
        case 'clipboard.write':await clipboard.writeText(z.object({text:z.string().max(131072)}).strict().parse(m.payload).text);data=null;break;
        case 'rdp.probe':data=await rdp.probe();break;
        case 'rdp.open':data=rdp.open(rdpConfigSchema.parse(m.payload));break;
        case 'rdp.list':data=rdp.list();break;
        case 'rdp.close':rdp.close(z.object({id:z.string().uuid()}).strict().parse(m.payload).id);data=null;break;
        case 'print.printers':data=(await nativeCall({op:'printers'})).printers;break;
        case 'x11.engine.choose':{
          const selected=await dialog.showOpenDialog(window!,{title:'选择受管理的 VcXsrv 引擎',properties:['openFile'],filters:[{name:'VcXsrv',extensions:['exe']}]});
          data=null;if(!selected.canceled&&selected.filePaths[0])data=await backend.call('x11.engine.configure',{path:selected.filePaths[0]});break;
        }
        case 'x11.configure':{
          const p=z.object({display:z.number().int().min(0).max(99)}).strict().parse(m.payload);
          const selected=await dialog.showOpenDialog(window!,{title:'选择本地 X Server 的 Xauthority 文件',properties:['openFile']});data=null;
          if(!selected.canceled&&selected.filePaths[0]){if((await stat(selected.filePaths[0])).size>65536)throw new Error('Xauthority 文件超过64KiB。');const authority=await readFile(selected.filePaths[0]);try{data=await backend.call('x11.configure',{...p,authority});}finally{authority.fill(0);}}break;
        }
        case 'terminal.exportText':{
          const p=z.object({name:z.string().max(255),text:z.string().max(4194304)}).strict().parse(m.payload);
          if(Buffer.byteLength(p.text)>8388608)throw new AppError('FILE_LIMIT','终端文本超过 8 MiB 导出上限。');
          const name=p.name.replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g,'_').replace(/[. ]+$/,'')||'terminal';
          const selected=await dialog.showSaveDialog(window!,{title:'导出终端文本',defaultPath:'hornet-'+name+'.txt',filters:[{name:'UTF-8 文本',extensions:['txt']}]});
          data=false;if(!selected.canceled&&selected.filePath){await writeFile(selected.filePath,p.text,{encoding:'utf8',mode:0o600});data=true;}break;
        }
        case 'file.choose':{
          const p=z.object({direction:z.enum(['upload','download']),name:z.string().max(255).optional()}).strict().parse(m.payload);
          const result=p.direction==='upload'?await dialog.showOpenDialog(window!,{properties:['openFile']}):await dialog.showSaveDialog(window!,{defaultPath:basename(p.name??'download')});
          const path='filePaths' in result?result.filePaths[0]:result.filePath;
          data=null;if(!result.canceled&&path){const grant=await grants.create('local-user',path,p.direction);data={pathGrantId:grant.id,name:basename(path)};}break;
        }
        case 'auth.key':{
          const p=z.object({challengeId:z.string().uuid()}).strict().parse(m.payload);
          if(challenges.get(p.challengeId)?.kind!=='privateKey')throw new AppError('IPC005','私钥请求无效。');
          const selected=await dialog.showOpenDialog(window!,{title:'选择 SSH 私钥',properties:['openFile']});
          data=false;if(!selected.canceled&&selected.filePaths[0]){if((await stat(selected.filePaths[0])).size>65536)throw new AppError('IPC002','私钥文件过大。');const key=await readFile(selected.filePaths[0],'utf8');await backend.call('auth.key',{challengeId:p.challengeId,key});data=true;}break;
        }
        case 'vault.lock':vault.lock();identities.lock();pendingPasswords.clear();data=null;break;
        case 'profile.export':{
          const selected=await dialog.showSaveDialog(window!,{defaultPath:'hornet-profiles.json',filters:[{name:'Hornet 配置',extensions:['json']}]});
          data=false;if(selected.filePath&&!selected.canceled){await writeFile(selected.filePath,JSON.stringify({formatVersion:1,profiles:await backend.call('profile.list')},null,2),{mode:0o600});data=true;}break;
        }
        case 'profile.import':{
          const selected=await dialog.showOpenDialog(window!,{filters:[{name:'Hornet 配置',extensions:['json']}],properties:['openFile']});
          data=null;if(selected.canceled)break;
          if((await stat(selected.filePaths[0])).size>1048576)throw new AppError('IPC002','配置包超过1MiB。');
          const pack=z.object({formatVersion:z.literal(1),profiles:z.array(profileSchema).max(1000)}).strict().parse(JSON.parse(await readFile(selected.filePaths[0],'utf8')));
          const confirmation=await dialog.showMessageBox(window!,{type:'question',buttons:['导入为新配置','取消'],defaultId:1,cancelId:1,message:'将导入 '+pack.profiles.length+' 个连接配置',detail:'全部生成新的标识，不覆盖已有配置；不导入密码。'});
          if(confirmation.response===0)data=await backend.call('profile.import',pack.profiles);break;
        }
        default:throw new AppError('IPC001','未知操作。');
      }
      return {ok:true,requestId:'local',data};
    }catch(e){return responseError(e);}
  });
  ipcMain.on('hornet:terminal',(event,raw:unknown)=>{
    try{authorize(event);const msg=z.object({kind:z.enum(['write','ack']),payload:z.unknown()}).strict().parse(raw);const p=msg.kind==='write'?terminalInputSchema.parse(msg.payload):terminalAckSchema.parse(msg.payload);void backend.call('terminal.'+msg.kind,p).catch(e=>emit({type:'service.error',message:safeError(e).message}));}
    catch{/* Do not reflect untrusted IPC to other windows. */}
  });
}
async function bootstrap(){
  if(!app.requestSingleInstanceLock()){app.quit();return;}
  const showWindow=()=>{
    const target=BrowserWindow.getFocusedWindow()??[...workbenches].find(target=>!target.isDestroyed());if(!target)return;
    if(target.isMinimized())target.restore();target.show();target.focus();
  };
  app.on('second-instance',showWindow);
  await app.whenReady();
  app.dock?.setIcon(join(__dirname,'icon.png'));
  const assets=resolve(__dirname,'renderer');
  protocol.handle('app',request=>{
    const url=new URL(request.url);
    const file=resolve(assets,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
    if(url.hostname!=='hornet'||!file.startsWith(assets+sep))return new Response('Forbidden',{status:403});
    return net.fetch(pathToFileURL(file).toString());
  });
  vault=new Vault(join(app.getPath('userData'),'credentials','vault.json'));
  identities=new IdentityStore(join(app.getPath('userData'),'credentials','identities.json'));
  backend=new Backend(vault,emit,()=>{void logs.stopAll('local-user').catch(()=>{});},profile=>identities.secret(profile)??vault.get(profile));await backend.start(app.getPath('userData'));
  schedules=new TransferSchedules(join(app.getPath('userData'),'transfer-schedules.json'),async job=>{
    const profile=(await backend.call<Profile[]>('profile.list')).find(profile=>profile.profileId===job.profileId);
    if(!profile||profile.revision!==job.profileRevision)throw new Error('连接配置已改变，请重新创建计划。');
    const grant=await grants.create('local-user',job.localPath,job.direction);if(grant.parent!==job.localParent)throw new Error('本地目录已改变。');
    const lease=await backend.call<import('../../../packages/contracts').Lease>('connection.open',{profileId:job.profileId,purpose:'files'});
    try{const task=await backend.call<TaskSnapshot>('transfer.start',{connectionId:lease.connectionId,direction:job.direction,pathGrantId:grant.id,remotePath:job.remotePath,idempotencyKey:job.id},{localPath:grant.path,localParent:grant.parent});return task.taskId;}finally{await backend.call('connection.release',{leaseId:lease.leaseId});}
  });await setupIpc();
  createWorkbench=async(initial={secondary:true})=>{
  if(workbenches.size>=8)throw new AppError('FILE_LIMIT','最多打开 8 个工作窗口。');
  const window=new BrowserWindow({title:'Hornet Remote Suite',titleBarStyle:'hidden',...(process.platform==='darwin'?{trafficLightPosition:{x:12,y:11}}:{titleBarOverlay:{color:'#f0f0f0',symbolColor:'#20252b',height:36}}),icon:join(__dirname,process.platform==='win32'?'icon.ico':'icon.png'),width:1440,height:900,minWidth:1024,minHeight:720,backgroundColor:'#0c1220',show:process.env.HORNET_SMOKE!=='1',webPreferences:{preload:join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  workbenches.add(window);initialWindows.set(window.id,initial);const webContentsId=window.webContents.id;
  window.on('closed',()=>{for(const [profileId,id]of challengeWindows)if(id===webContentsId)challengeWindows.delete(profileId);workbenches.delete(window);controllers.delete(window.id);initialWindows.delete(window.id);});
  const chromeWindow=window;
  chromeWindow.on('system-context-menu',(event,point)=>{
    const dip=screen.screenToDipPoint(point),bounds=chromeWindow.getContentBounds(),x=dip.x-bounds.x,y=dip.y-bounds.y;
    if(x<0||x>bounds.width||y<0||y>36)return;
    event.preventDefault();chromeWindow.webContents.send('hornet:chrome-context',{x,y});
  });
  const fullscreen=new FullscreenController(()=>window.isFullScreen(),value=>window.setFullScreen(value));controllers.set(window.id,fullscreen);
  const fullscreenChanged=()=>{window?.webContents.send('hornet:fullscreen',window.isFullScreen());setImmediate(()=>fullscreen.completed());};
  window.on('enter-full-screen',fullscreenChanged);window.on('leave-full-screen',fullscreenChanged);
  window.removeMenu();window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',event=>event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_webContents,_permission,callback)=>callback(false));
  const exit=new ExitController(async()=>{
      // Use already-received task events. Never wait for IPC to show Exit.
      const active=[...taskCache.values()].filter(t=>['running','queued','verifying','committing','pausing','cancelling'].includes(t.state));
      const choice=await dialog.showMessageBox(window!,{type:'question',buttons:['退出','取消'],defaultId:1,cancelId:1,message:'退出 Hornet？',detail:(active.length?'将尝试暂停活动传输；异常提交需在重启后核对目标文件。':'连接和配置会保留。')+'后台无响应时最多等待 5 秒后退出。终端、图形会话与 LPD 接收将关闭；系统已接收的打印可能继续。'});
      return choice.response===0;
  },()=>Promise.allSettled([backend.stop(),logs.stopAll('local-user')]),()=>{
      try{backend.forceStop();rdp.stop(true);grants.clear('local-user');pendingPasswords.clear();}
      finally{try{window?.destroy();}finally{app.exit(0);}}
  });
  window.on('close',event=>{
    event.preventDefault();if(workbenches.size>1)window.webContents.send('hornet:close-workbench');else void exit.request().catch(()=>{});
  });
  try{await window.loadURL('app://hornet/index.html');}catch(error){window.destroy();throw error;}
  if(process.env.HORNET_SMOKE!=='1')window.show();return window;
  };
  window=await createWorkbench({secondary:false});
  if(process.env.HORNET_SMOKE!=='1')showWindow();
}
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>{schedules?.stop();rdp.stop();grants.clear('local-user');pendingPasswords.clear();});
void bootstrap().catch(error=>{if(process.env.HORNET_SMOKE==='1')console.error('STARTUP ERROR',error);else dialog.showErrorBox('Hornet 启动失败',error instanceof Error?error.message:'无法启动应用');app.exit(1);});
