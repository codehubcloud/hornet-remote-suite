import { app,BrowserWindow,dialog,ipcMain,protocol,net,type IpcMainInvokeEvent,type IpcMainEvent } from 'electron';
import { join,basename,resolve,sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile,writeFile,stat } from 'node:fs/promises';
import { z } from 'zod';
import { envelopeSchema,schemas,profileSchema,terminalAckSchema,terminalInputSchema,type HornetEvent,type Profile,type TaskSnapshot } from '../../../packages/contracts';
import { AppError,safeError } from '../../../packages/core/errors';
import { PathGrants } from '../../../packages/security/path-grants';
import { Vault } from './vault';
import { Backend } from './backend';
import { RdpService, nativeCall } from '../../../services/native/host';
import { rdpConfigSchema } from '../../../packages/contracts/native';
const rdp=new RdpService();
protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
if(process.env.HORNET_USER_DATA)app.setPath('userData',process.env.HORNET_USER_DATA);
let window:BrowserWindow|undefined,backend:Backend,vault:Vault,quitting=false;
const grants=new PathGrants();
const challenges=new Map<string,Extract<HornetEvent,{type:'challenge'}>>();
const pendingPasswords=new Map<string,string>();
const emit=(event:HornetEvent)=>{
  if(event.type==='challenge')challenges.set(event.challengeId,event);
  if(event.type==='challenge.closed')challenges.delete(event.challengeId);
  if(event.type==='connection.state'&&event.state==='ready'){
    const secret=pendingPasswords.get(event.profileId);pendingPasswords.delete(event.profileId);
    if(secret)void backend.call<Profile[]>('profile.list').then(profiles=>{const p=profiles.find(p=>p.profileId===event.profileId);if(p)vault.save(p,secret);}).catch(()=>window?.webContents.send('hornet:event',{type:'service.error',message:'系统凭据保存失败，密码未持久化。'}));
  }
  if(event.type==='connection.state'&&event.state==='failed')pendingPasswords.delete(event.profileId);
  if(window&&!window.isDestroyed())window.webContents.send('hornet:event',event);
};
function authorize(event:IpcMainInvokeEvent|IpcMainEvent){
  if(!window||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||!event.senderFrame?.url.startsWith('app://hornet/'))throw new AppError('IPC005','请求来源无权访问。');
}
function responseError(e:unknown,requestId='local'){return {ok:false,requestId,error:e instanceof z.ZodError?{code:'IPC002',message:'请求参数无效。',retryable:false}:safeError(e)};}
async function setupIpc(){
  ipcMain.handle('hornet:request',async(event,raw:unknown)=>{
    let requestId='';
    try{
      authorize(event);
      if(Buffer.byteLength(JSON.stringify(raw))>262144)throw new AppError('IPC002','请求过大。');
      const req=envelopeSchema.parse(raw);requestId=req.requestId;
      if(req.deadlineMs<Date.now())throw new AppError('IPC003','请求已过期。');
      const parsed=schemas[req.method].parse(req.payload);
      if(req.method==='auth.respond'){
        const p=schemas['auth.respond'].parse(parsed),challenge=challenges.get(p.challengeId);
        if(!challenge||challenge.kind==='privateKey')throw new AppError('IPC005','认证请求无效。');
        if(p.remember&&challenge.kind==='password')pendingPasswords.set(challenge.profileId,p.response);
      }
      let context:{localPath:string;localParent:string}|undefined;
      if(req.method==='transfer.start'){const p=schemas['transfer.start'].parse(parsed),g=await grants.get('local-user',p.pathGrantId,p.direction);context={localPath:g.path,localParent:g.parent};}
      const data=await backend.call(req.method,parsed,context,Math.min(120000,Math.max(1,req.deadlineMs-Date.now())));
      if(req.method==='profile.delete')vault.remove(schemas['profile.delete'].parse(parsed).profileId);
      return {ok:true,requestId,data};
    }catch(e){return responseError(e,requestId);}
  });
  ipcMain.handle('hornet:local',async(event,raw:unknown)=>{
    try{
      authorize(event);const m=z.object({method:z.string(),payload:z.unknown()}).strict().parse(raw);
      let data:unknown;
      switch(m.method){
        case 'rdp.probe':data=await rdp.probe();break;
        case 'rdp.open':data=rdp.open(rdpConfigSchema.parse(m.payload));break;
        case 'rdp.list':data=rdp.list();break;
        case 'rdp.close':rdp.close(z.object({id:z.string().uuid()}).strict().parse(m.payload).id);data=null;break;
        case 'print.printers':data=(await nativeCall({op:'printers'})).printers;break;
        case 'x11.configure':{
          const p=z.object({display:z.number().int().min(0).max(99)}).strict().parse(m.payload);
          const selected=await dialog.showOpenDialog(window!,{title:'选择本地 X Server 的 Xauthority 文件',properties:['openFile']});data=null;
          if(!selected.canceled&&selected.filePaths[0]){if((await stat(selected.filePaths[0])).size>65536)throw new Error('Xauthority 文件超过64KiB。');const authority=await readFile(selected.filePaths[0]);try{data=await backend.call('x11.configure',{...p,authority});}finally{authority.fill(0);}}break;
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
        case 'vault.lock':vault.lock();pendingPasswords.clear();data=null;break;
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
    if(!window||window.isDestroyed())return;
    if(window.isMinimized())window.restore();
    window.show();window.focus();
  };
  app.on('second-instance',showWindow);
  await app.whenReady();
  const assets=resolve(__dirname,'renderer');
  protocol.handle('app',request=>{
    const url=new URL(request.url);
    const file=resolve(assets,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
    if(url.hostname!=='hornet'||!file.startsWith(assets+sep))return new Response('Forbidden',{status:403});
    return net.fetch(pathToFileURL(file).toString());
  });
  vault=new Vault(join(app.getPath('userData'),'credentials','vault.json'));
  backend=new Backend(vault,emit);await backend.start(app.getPath('userData'));await setupIpc();
  window=new BrowserWindow({title:'Hornet Remote Suite',width:1440,height:900,minWidth:1024,minHeight:720,backgroundColor:'#0c1220',show:process.env.HORNET_SMOKE!=='1',webPreferences:{preload:join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  window.removeMenu();window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',event=>event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_webContents,_permission,callback)=>callback(false));
  window.on('close',event=>{
    if(quitting)return;event.preventDefault();
    void (async()=>{
      const tasks=await backend.call<TaskSnapshot[]>('task.list').catch(()=>[]);
      const active=tasks.filter(t=>['running','queued','verifying','committing'].includes(t.state));
      const choice=await dialog.showMessageBox(window!,{type:'question',buttons:['退出','取消'],defaultId:1,cancelId:1,message:'退出 Hornet？',detail:active.length?'活动传输将暂停，重新启动后可校验恢复。终端、图形会话与 LPD 接收将关闭；系统已接收的打印可能继续。':'终端、图形会话与 LPD 接收将关闭，配置会保留；系统已接收的打印可能继续。'});
      if(choice.response!==0)return;
      quitting=true;await backend.stop().catch(()=>{});window?.destroy();app.quit();
    })();
  });
  await window.loadURL('app://hornet/index.html');
  if(process.env.HORNET_SMOKE!=='1')showWindow();
}
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>{rdp.stop();grants.clear('local-user');pendingPasswords.clear();});
void bootstrap().catch(error=>{if(process.env.HORNET_SMOKE==='1')console.error('STARTUP ERROR',error);else dialog.showErrorBox('Hornet 启动失败',error instanceof Error?error.message:'无法启动应用');app.exit(1);});
