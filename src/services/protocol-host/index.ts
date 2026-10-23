import { ZmodemTransfers } from '../terminal/zmodem';
import { sameTransport } from '../../packages/core/profile-settings';
import { FtpConnections } from '../ftp/connections';
import { FtpFiles } from '../ftp/files';
import { FtpTransfers } from '../ftp/transfers';
import { S3Connections } from '../s3/connections';
import { S3Files } from '../s3/files';
import { S3Transfers } from '../s3/transfers';
import { DeviceTerminals } from '../terminal/devices';
import { localShells,openLocal } from '../terminal/local';
import { serialDevices,openSerial } from '../terminal/serial';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Storage } from '../../packages/storage/database';
import { schemas, profileSchema, terminalInputSchema, terminalAckSchema, type HornetEvent,type Profile } from '../../packages/contracts';
import { AppError,safeError } from '../../packages/core/errors';
import { Challenges } from '../../packages/security/challenges';
import { Connections } from '../ssh/connections';
import { Tunnels } from '../ssh/tunnels';
import { VncService } from '../desktop/vnc';
import { LpdService } from '../print/lpd';
import { nativeCall } from '../native/host';
import { X11Service } from '../x11/sessions';
import { XServers } from '../x11/engine';
import { XdmcpService,localInterfaces } from '../x11/xdmcp';
import { TelnetTerminals } from '../terminal/telnet';
import { RloginTerminals } from '../terminal/rlogin';
import { openMosh,moshExecutable } from '../terminal/mosh';
import { Terminals } from '../terminal/terminals';
import { Files } from '../file/files';
import type { TransferContext } from '../file/tree-transfers';
import { Transfers } from '../file/transfers';
interface Port { postMessage(data:unknown):void; on(event:'message',listener:(event:{data:Message})=>void):void }
interface Message { type:string; owner:string; method:string; requestId:string; payload:unknown; context?:TransferContext; secret?:string }
const port=(process as NodeJS.Process & {parentPort:Port}).parentPort;
function startHost(){
const store=new Storage(join(process.argv[2],'data','hornet.db'),join(__dirname,'schema.sql'));
const emit=(owner:string,event:HornetEvent)=>port.postMessage({type:'event',owner,event});
const vaultWait=new Map<string,(secret:string|undefined)=>void>();
const challenges=new Challenges(emit);
const cachedSecret=(owner:string,profile:Profile):Promise<string|undefined>=>new Promise(resolve=>{
  const requestId=randomUUID();const timer=setTimeout(()=>{vaultWait.delete(requestId);resolve(undefined);},5000);
  vaultWait.set(requestId,value=>{clearTimeout(timer);resolve(value);});
  port.postMessage({type:'vault.get',owner,profile,requestId});
});
const connections=new Connections(store,challenges,emit,cachedSecret);
const ftp=new FtpConnections(store,challenges,emit,cachedSecret);
const ftpFiles=new FtpFiles(ftp);
const s3=new S3Connections(store,challenges,emit,cachedSecret);
const s3Files=new S3Files(s3);
const fileService=(id:string)=>s3.has(id)?s3Files:ftp.has(id)?ftpFiles:files;
const zmodem=new ZmodemTransfers();
const terminals=new Terminals(connections,emit);
const telnet=new TelnetTerminals(emit);
const rlogin=new RloginTerminals(emit);
const devices=new DeviceTerminals(emit);
const terminalService=(id:string)=>devices.has(id)?devices:telnet.has(id)?telnet:rlogin.has(id)?rlogin:terminals;
const tunnels=new Tunnels(connections,emit);
const vnc=new VncService(connections);
const xServers=new XServers(join(process.argv[2],'x11'));
const x11=new X11Service(connections,xServers);
const xdmcp=new XdmcpService(xServers);
const lpd=new LpdService(join(process.argv[2],'print-spool'),async(job,path)=>{const result=await nativeCall({op:'print',path,printer:job.printer,mode:job.mode,jobId:job.jobId},60000);return result.osJobId;});
const files=new Files(connections);
const transfers=new Transfers(store,connections,emit,new FtpTransfers(ftp,emit),new S3Transfers(s3,emit));
async function dispatch(m:Message):Promise<unknown>{
  const p=m.payload,owner=m.owner;
  switch(m.method){
    case 'localTerminal.shells':return localShells();
    case 'localTerminal.open':return openLocal(devices,owner,schemas['localTerminal.open'].parse(p));
    case 'serialTerminal.list':return serialDevices();
    case 'serialTerminal.open':return openSerial(devices,owner,schemas['serialTerminal.open'].parse(p));
    case 'telnet.open':{const v=schemas['telnet.open'].parse(p);return telnet.open(owner,store.profile(v.profileId),v.cols,v.rows);}
    case 'rlogin.open':{const v=schemas['rlogin.open'].parse(p);return rlogin.open(owner,store.profile(v.profileId),v.cols,v.rows);}
    case 'mosh.open':{const v=schemas['mosh.open'].parse(p);return openMosh(devices,owner,store.profile(v.profileId),v.cols,v.rows);}
    case 'zmodem.list':return zmodem.list();
    case 'zmodem.cancel':zmodem.cancel(schemas['zmodem.cancel'].parse(p).id);return null;
    case 'zmodem.start':{const v=z.object({terminalId:z.string().uuid(),direction:z.enum(['send','receive'])}).strict().parse(p);if(!m.context)throw new AppError('IPC005','需要本地文件选择授权。');return zmodem.start(v.terminalId,v.direction,m.context.localPath,m.context.localParent,terminals.binary(owner,v.terminalId));}
    case 'terminal.detach':{const v=schemas['terminal.detach'].parse(p);return terminalService(v.terminalId).detach(owner,v.terminalId);}
    case 'terminal.inspect':{const v=schemas['terminal.attach'].parse(p);return terminalService(v.terminalId).inspect(owner,v.terminalId);}
    case 'print.queue.save':return lpd.saveQueue(schemas['print.queue.save'].parse(p));
    case 'print.queue.remove':return lpd.removeQueue(schemas['print.queue.remove'].parse(p).queue);
    case 'print.default':return lpd.setDefault(schemas['print.default'].parse(p).queue);
    case 'print.job.read':return lpd.readJob(schemas['print.job.read'].parse(p).jobId);
    case 'print.jobs.remove':return lpd.removeJobs(schemas['print.jobs.remove'].parse(p).jobIds);
    case 'print.status':return lpd.status();
    case 'print.start':return lpd.start(schemas['print.start'].parse(p));
    case 'print.stop':return lpd.stop();
    case 'print.submit':return lpd.print(schemas['print.submit'].parse(p).jobId);
    case 'print.cancel':return lpd.cancel(schemas['print.cancel'].parse(p).jobId);
    case 'x11.status':return x11.status(owner);
    case 'x11.engine':return xServers.status();
    case 'x11.engine.configure':return xServers.configure(z.object({path:z.string().min(1).max(32768)}).strict().parse(p).path);
    case 'x11.configure':{const v=z.object({display:z.number().int().min(0).max(99),authority:z.instanceof(Uint8Array)}).parse(p);return x11.configure(v.display,Buffer.from(v.authority));}
    case 'x11.launch':{const v=schemas['x11.launch'].parse(p);return x11.launch(owner,v.profileId,v.command,v.managed);}
    case 'x11.stop':return x11.close(owner,schemas['x11.stop'].parse(p).id);
    case 'xdmcp.interfaces':return localInterfaces();
    case 'xdmcp.query':{const v=schemas['xdmcp.query'].parse(p);return xdmcp.query(owner,v.host,v.localAddress,v.port);}
    case 'xdmcp.open':return xdmcp.open(owner,schemas['xdmcp.open'].parse(p));
    case 'xdmcp.list':return xdmcp.list(owner);
    case 'xdmcp.close':return xdmcp.close(owner,schemas['xdmcp.close'].parse(p).id);
    case 'vnc.open':{const v=schemas['vnc.open'].parse(p);return vnc.open(owner,v.profileId,v.host,v.port);}
    case 'vnc.close':return vnc.close(owner,schemas['vnc.close'].parse(p).desktopId);
    case 'tunnel.list':return tunnels.list(owner);
    case 'tunnel.create':return tunnels.create(owner,schemas['tunnel.create'].parse(p));
    case 'tunnel.stop':return tunnels.stop(owner,schemas['tunnel.stop'].parse(p).tunnelId);
    case 'profile.list':return store.profiles();
    case 'profile.save':{const v=schemas['profile.save'].parse(p);if((connections.hasProfile(v.profile.profileId)||ftp.hasProfile(v.profile.profileId)||s3.hasProfile(v.profile.profileId)||telnet.hasProfile(v.profile.profileId)||rlogin.hasProfile(v.profile.profileId))&&!sameTransport(store.profile(v.profile.profileId),v.profile))throw new AppError('PROFILE_BUSY','请先关闭正在使用此配置的连接，再修改认证或端点。');return store.saveProfile(v.profile,v.expectedRevision);}
    case 'group.remove':{const v=schemas['group.remove'].parse(p);if(v.members.some(m=>connections.hasProfile(m.profileId)||ftp.hasProfile(m.profileId)||s3.hasProfile(m.profileId)||telnet.hasProfile(m.profileId)||rlogin.hasProfile(m.profileId)||transfers.hasProfile(m.profileId)))throw new AppError('PROFILE_BUSY','分组中有正在使用的连接或传输，请先关闭后再删除。');return store.removeGroup(v.path,v.members);}
    case 'profile.delete':{const v=schemas['profile.delete'].parse(p);if(connections.hasProfile(v.profileId)||ftp.hasProfile(v.profileId)||s3.hasProfile(v.profileId)||telnet.hasProfile(v.profileId)||rlogin.hasProfile(v.profileId)||transfers.hasProfile(v.profileId))throw new AppError('PROFILE_BUSY','请先关闭此主机的连接和传输。');return store.deleteProfile(v.profileId,v.expectedRevision);}
    case 'profile.import':return store.importProfiles(z.array(profileSchema).max(1000).parse(p));
    case 'connection.retain':{const id=schemas['connection.retain'].parse(p).connectionId;return s3.has(id)?s3.retain(owner,id):connections.retain(owner,id);}
    case 'connection.open':{const v=schemas['connection.open'].parse(p),profile=store.profile(v.profileId);if(profile.session?.s3){if(v.purpose!=='files')throw new AppError('CAPABILITY_UNAVAILABLE','AWS S3 profiles provide object storage, not a terminal.');return s3.acquire(owner,v.profileId);}if(profile.protocol==='ftp'){if(v.purpose!=='files')throw new AppError('CAPABILITY_UNAVAILABLE','FTP 不支持终端。');return ftp.acquire(owner,v.profileId);}if((profile.protocol??'ssh')!=='ssh')throw new AppError('CAPABILITY_UNAVAILABLE',`${(profile.protocol??'ssh').toUpperCase()} requires its dedicated connection entry.`);return v.fresh?connections.acquireIsolated(owner,v.profileId):connections.acquire(owner,v.profileId);}
    case 'connection.release':{const {leaseId}=schemas['connection.release'].parse(p);return (s3.hasLease(leaseId)?s3:ftp.hasLease(leaseId)?ftp:connections).release(owner,leaseId);}
    case 'connection.close':{const v=schemas['connection.close'].parse(p);return (s3.has(v.connectionId)?s3:ftp.has(v.connectionId)?ftp:connections).close(owner,v.connectionId,v.generation);}
    case 'auth.respond':{const v=schemas['auth.respond'].parse(p);return challenges.respond(owner,v.challengeId,v.response);}
    case 'auth.cancel':return challenges.cancel(owner,schemas['auth.cancel'].parse(p).challengeId);
    case 'auth.key':{const v=z.object({challengeId:z.string().uuid(),key:z.string().max(65536)}).parse(p);if(challenges.kind(owner,v.challengeId)!=='privateKey')throw new AppError('IPC005','私钥请求已失效。');return challenges.respond(owner,v.challengeId,v.key);}
    case 'knownHosts.list':schemas['knownHosts.list'].parse(p);return store.knownHosts();
    case 'knownHosts.remove':{const v=schemas['knownHosts.remove'].parse(p);return store.forgetHost(v.id,v.fingerprint);}
    case 'trust.resolve':{const v=schemas['trust.resolve'].parse(p);return challenges.respond(owner,v.challengeId,v.decision,true);}
    case 'terminal.encoding':{const v=schemas['terminal.encoding'].parse(p);return terminalService(v.terminalId).encoding(owner,v.terminalId,v.generation,v.encoding);}
    case 'terminal.cwd':{const v=schemas['terminal.cwd'].parse(p);return terminalService(v.terminalId).cwd(owner,v.terminalId);}
    case 'terminal.create':{const v=schemas['terminal.create'].parse(p);return terminals.create(owner,v.connectionId,v.cols,v.rows,v.trackDirectory);}
    case 'terminal.attach':{const v=schemas['terminal.attach'].parse(p);return terminalService(v.terminalId).attach(owner,v.terminalId);}
    case 'terminal.resize':{const v=schemas['terminal.resize'].parse(p);return terminalService(v.terminalId).resize(owner,v.terminalId,v.generation,v.cols,v.rows);}
    case 'terminal.close':{const v=schemas['terminal.close'].parse(p);return terminalService(v.terminalId).close(owner,v.terminalId);}
    case 'terminal.send':
    case 'terminal.write':{const v=terminalInputSchema.parse(p);return terminalService(v.terminalId).write(owner,v.terminalId,v.generation,v.seq,v.data);}
    case 'terminal.ack':{const v=terminalAckSchema.parse(p);return terminalService(v.terminalId).ack(owner,v.terminalId,v.seq);}
    case 'file.tree':{const v=schemas['file.list'].parse(p);return fileService(v.connectionId).tree(owner,v.connectionId,v.path);}
    case 'file.tree.hash':{const v=z.object({connectionId:z.string().uuid(),root:z.string().min(1).max(4096),path:z.string().min(1).max(4096)}).strict().parse(p);return fileService(v.connectionId).treeHash(owner,v.connectionId,v.root,v.path);}
    case 'file.tree.mkdir':{const v=z.object({connectionId:z.string().uuid(),root:z.string().min(1).max(4096),path:z.string().min(1).max(4096)}).strict().parse(p);return fileService(v.connectionId).treeMkdir(owner,v.connectionId,v.root,v.path);}
    case 'ftp.mode':{const v=schemas['ftp.mode'].parse(p);return ftp.configure(owner,v.connectionId,v.mode);}
    case 'ftp.command':{const v=schemas['ftp.command'].parse(p);return ftp.command(owner,v.connectionId,v.command);}
    case 'file.list':{const v=schemas['file.list'].parse(p);return fileService(v.connectionId).list(owner,v.connectionId,v.path);}
    case 'file.read':{const v=schemas['file.read'].parse(p);return fileService(v.connectionId).read(owner,v.connectionId,v.path);}
    case 'file.mkdir':{const v=schemas['file.mkdir'].parse(p);return fileService(v.connectionId).mkdir(owner,v.connectionId,v.path);}
    case 'file.rename':{const v=schemas['file.rename'].parse(p);return fileService(v.connectionId).rename(owner,v.connectionId,v.path,v.target);}
    case 'file.chmod':{const v=schemas['file.chmod'].parse(p);return fileService(v.connectionId).chmod(owner,v.connectionId,v.path,v.mode);}
    case 'file.remove':{const v=schemas['file.remove'].parse(p);return fileService(v.connectionId).remove(owner,v.connectionId,v.path);}
    case 'file.save':{const v=schemas['file.save'].parse(p);return fileService(v.connectionId).save(owner,v.connectionId,v.path,v.content,v.expectedHash);}
    case 'transfer.start':{const v=schemas['transfer.start'].parse(p);if(!m.context)throw new AppError('IPC005','缺少文件授权。');return transfers.start(owner,v.connectionId,v.direction,m.context.localPath,m.context.localParent,v.remotePath,v.idempotencyKey,m.context);}
    case 'task.list':return transfers.list(owner);
    case 'task.pause':{const v=schemas['task.pause'].parse(p);return transfers.pause(owner,v.taskId,v.expectedRevision);}
    case 'task.cancel':{const v=schemas['task.cancel'].parse(p);return transfers.cancel(owner,v.taskId,v.expectedRevision);}
    case 'task.resume':{const v=schemas['task.resume'].parse(p);return transfers.resume(owner,v.taskId,v.expectedRevision);}
    case 'layout.load':return store.layout();
    case 'layout.save':return store.saveLayout(schemas['layout.save'].parse(p));
    case 'capability.list':return [
      {id:'ssh',name:'SSH 终端',state:'available',reason:'密码 / 托管私钥 / Agent、跳板链、多窗口与活标签移动、按键对应、突出显示、触发器、脚本、录制及手动 SSH ZMODEM'},
      {id:'sftp',name:'SFTP 文件管理',state:'available',reason:'本地/远端双面板、双向同步、同名策略、SHA-256 覆盖校验、递归传输、续传、权限及 UTF-8 编辑'},
      {id:'tunnels',name:'SSH 端口转发 / SOCKS5',state:'available',reason:'本地 / 远程 / 动态 SOCKS5 TCP 转发；最多四跳 SSH 链，逐跳认证与指纹校验、独立租约'},
      {id:'x11',name:'X11 / XDMCP',state:x11.status().configured||(await xServers.status()).configured?'experimental':'requires-setup',reason:'VcXsrv 自动管理、独立进程/显示/cookie；SSH 图形应用和局域网 XDMCP 独立窗口；需明确启用网络监听'},
      {id:'desktop',name:'VNC 远程桌面',state:'available',reason:'工作台内嵌画面及输入，强制使用 SSH 加密通道，剪贴板默认禁用'},
      {id:'rdp',name:'RDP 原生窗口',state:'requires-setup',reason:'Windows 系统控件需在远程桌面工作区探测；受管理独立窗口，尚非内嵌桌面'},
      {id:'print',name:'LPD 打印',state:'available',reason:'多队列接收、队列暂停与打印机映射、持久暂存、手动提交 Windows RAW/UTF-8 文本打印；默认关闭监听'},
      {id:'telnet',name:'Telnet 终端',state:'available',reason:'独立 TCP 会话、窗口大小与终端类型协商、已有终端分屏；明文协议，不提供文件功能'},
      {id:'rlogin',name:'RLOGIN terminal',state:'available',reason:'RFC 1282 terminal over TCP; requires server-side trust, sends data in plaintext, has no password authentication or file transfer'},
      {id:'mosh',name:'Mosh terminal',state:moshExecutable()?'available':'unavailable',reason:'Uses the installed Mosh client and the remote mosh-server; authentication is interactive through SSH and remote file management is not provided'},
      {id:'wsl',name:'Windows Subsystem for Linux',state:localShells().some(shell=>shell.id==='wsl')?'available':'unavailable',reason:'Runs installed Linux distributions through Windows ConPTY; optional distribution and Linux working directory are supported'},
      {id:'local',name:'本地 PowerShell / CMD',state:localShells().length?'available':'unavailable',reason:'Windows ConPTY 交互终端、窗口尺寸、分屏和持续日志；文件菜单打开'},
      {id:'serial',name:'串口终端',state:'requires-setup',reason:'COM 端口枚举、波特率/校验位/流控、多编码、脚本与日志；需要可用串口设备'},
      {id:'ftp',name:'FTP / FTPS',state:'available',reason:'被动模式、显式/隐式 TLS、二进制/ASCII/自动模式、FTP 命令、同步浏览与预订；普通文件 SHA-256 校验，不支持 FTP 目录同步、在线编辑或权限修改'},
      {id:'s3',name:'AWS S3 object storage',state:'available',reason:'Bucket/object browsing, create empty folders, UTF-8 preview/edit, verified upload/download and object rename/delete; requires bucket-scoped IAM access keys; POSIX permissions and folder rename are unsupported'},
      {id:'extensions',name:'IDE / 插件 / AI / 企业服务',state:'unavailable',reason:'按设计文档列为后续扩展，不在当前版本伪装启用'}
    ];
    case 'shutdown':await devices.stop();await lpd.shutdown();vnc.stop();await x11.stop();await xdmcp.stop();await xServers.stop();await transfers.stop();terminals.stop();telnet.stop();rlogin.stop();tunnels.shutdown();challenges.cancelOwner(owner);s3.stop();ftp.stop();await connections.stop();store.close();return null;
    default:throw new AppError('IPC001','未知方法。');
  }
}
port.on('message',({data:m})=>{
  if(m.type==='ping'){port.postMessage({type:'heartbeat'});return;}
  if(m.type==='vault.reply'){vaultWait.get(m.requestId)?.(m.secret);vaultWait.delete(m.requestId);return;}
  if(m.type!=='call')return;
  void dispatch(m).then(data=>port.postMessage({type:'result',requestId:m.requestId,result:{ok:true,requestId:m.requestId,data}}),error=>port.postMessage({type:'result',requestId:m.requestId,result:{ok:false,requestId:m.requestId,error:error instanceof z.ZodError?{code:'IPC002',message:'请求参数不正确。',retryable:false}:safeError(error)}}));
});
port.postMessage({type:'ready',version:1});
setInterval(()=>port.postMessage({type:'heartbeat'}),5000).unref();
}
try{startHost();}catch(error){
  // Deliver a safe startup error before exiting, rather than losing its cause
  // to a generic "backend exited" message or dumping the bundled source.
  port.postMessage({type:'startup.failed',error:safeError(error)});
  setTimeout(()=>process.exit(1),50);
}
