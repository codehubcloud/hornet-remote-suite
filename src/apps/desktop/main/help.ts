import { app,BrowserWindow,net,shell } from 'electron';
import { createHash,timingSafeEqual } from 'node:crypto';
import { mkdir,open,rm,stat,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkForUpdates,helpBase,helpLinks } from '../../../packages/core/help';
import { manualHtml } from '../../../packages/core/help-content';
import type { AppInfo,HelpLink,UpdateDownload } from '../../../packages/contracts/help';
export const appInfo=():AppInfo=>({version:app.getVersion(),platform:process.platform,arch:process.arch,electron:process.versions.electron,chrome:process.versions.chrome,node:process.versions.node});
export async function openHelpLink(link:HelpLink){await shell.openExternal(helpLinks[link]);}
export const checkUpdates=()=>checkForUpdates(app.getVersion(),net.fetch.bind(net) as typeof fetch);
type Progress={receivedBytes:number;totalBytes:number|null;state:'downloading'|'downloaded'};
let downloadWork:Promise<UpdateDownload>|undefined;
let stagedInstaller:string|undefined;
const updateHeaders={Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
async function responseBytes(response:Response,limit:number){
 if(!response.ok)throw new Error(`Update request failed: HTTP ${response.status}`);
 const reader=response.body?.getReader();if(!reader)throw new Error('Missing update response');
 const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw new Error('Update response too large');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
function installerName(version:string){
 const arch=process.arch==='arm64'?'arm64':'x64';
 if(process.platform==='win32')return `Hornet-Remote-Suite-${version}-windows-x64.exe`;
 if(process.platform==='darwin')return `Hornet-Remote-Suite-${version}-macos-${arch}.dmg`;
 if(process.platform==='linux')return `Hornet-Remote-Suite-${version}-linux-${arch==='x64'?'amd64':'arm64'}.deb`;
 throw new Error('No update installer is available for this platform.');
}
async function latestRelease(){
 const response=await net.fetch('https://api.github.com/repos/codehubcloud/hornet-remote-suite-release/releases/latest',{headers:updateHeaders,signal:AbortSignal.timeout(20000),redirect:'error'});
 const bytes=await responseBytes(response,262144);
 return JSON.parse(new TextDecoder().decode(bytes)) as {tag_name:string;draft:boolean;prerelease:boolean;assets:{name:string;browser_download_url:string}[]};
}
export function downloadUpdate(onProgress:(progress:Progress)=>void):Promise<UpdateDownload>{
 if(downloadWork)return downloadWork;
 downloadWork=(async()=>{
  const release=await latestRelease(),version=release.tag_name?.replace(/^v/,''),info=await checkUpdates();
  if(!info.available||version!==info.latest||release.draft||release.prerelease)throw new Error('No verified update is available. Check for updates again.');
  const name=installerName(version),checksumName='SHA256SUMS';
  const asset=(release.assets??[]).find(item=>item.name===name),checksums=(release.assets??[]).find(item=>item.name===checksumName);
  const assetPrefix=`${helpBase}/releases/download/v${version}/`;
  if(!asset||!checksums)throw new Error('The release is missing a trusted installer or checksum.');
  if(asset.browser_download_url!==assetPrefix+asset.name||checksums.browser_download_url!==assetPrefix+checksums.name)throw new Error('The release contains an untrusted download URL.');
  const manifestResponse=await net.fetch(checksums.browser_download_url,{signal:AbortSignal.timeout(30000),redirect:'follow'});
  const manifest=new TextDecoder().decode(await responseBytes(manifestResponse,32768));
  const checksumLine=manifest.split(/\r?\n/).find(line=>line.endsWith(`  ${name}`)||line.endsWith(` *${name}`));
  const expected=checksumLine?.match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
  if(!expected||expected[2]!==name)throw new Error('The installer checksum is missing or invalid.');
  const dir=join(app.getPath('userData'),'updates');await mkdir(dir,{recursive:true});
  const finalPath=join(dir,name),tempPath=finalPath+'.download';await rm(tempPath,{force:true});
  const response=await net.fetch(asset.browser_download_url,{signal:AbortSignal.timeout(30*60*1000),redirect:'follow'});
  if(!response.ok||!response.body)throw new Error(`Installer download failed: HTTP ${response.status}`);
  const length=Number(response.headers.get('content-length'));const totalBytes=Number.isSafeInteger(length)&&length>0?length:null;
  if(totalBytes!==null&&totalBytes>1_500_000_000)throw new Error('Installer download is too large.');
  const reader=response.body.getReader(),file=await open(tempPath,'w'),hash=createHash('sha256');let receivedBytes=0;
  try{
   for(;;){const {done,value}=await reader.read();if(done)break;receivedBytes+=value.length;if(receivedBytes>1_500_000_000)throw new Error('Installer download is too large.');hash.update(value);await file.write(value);onProgress({receivedBytes,totalBytes,state:'downloading'});}
   await file.sync();
  }catch(error){await reader.cancel().catch(()=>{});await file.close();await rm(tempPath,{force:true});throw error;}
  await file.close();
  const actual=Buffer.from(hash.digest('hex'),'hex'),wanted=Buffer.from(expected[1],'hex');
  if(actual.length!==wanted.length||!timingSafeEqual(actual,wanted)||receivedBytes===0||(totalBytes!==null&&receivedBytes!==totalBytes)){await rm(tempPath,{force:true});throw new Error('Downloaded installer failed its integrity check.');}
  await rm(finalPath,{force:true});const {rename}=await import('node:fs/promises');await rename(tempPath,finalPath);
  stagedInstaller=finalPath;onProgress({receivedBytes,totalBytes:receivedBytes,state:'downloaded'});return {fileName:name,size:receivedBytes};
 })().finally(()=>{downloadWork=undefined;});
 return downloadWork;
}
export async function installUpdate(){
 if(!stagedInstaller)throw new Error('Download an update before installing it.');
 const info=await stat(stagedInstaller);if(!info.isFile()||info.size===0)throw new Error('The downloaded installer is missing. Download it again.');
 const error=await shell.openPath(stagedInstaller);if(error)throw new Error(error);
}
let pdfWork:Promise<void>|undefined;
export function openHelpPdf(language:string){
 if(pdfWork)return pdfWork;
 pdfWork=(async()=>{
  const win=new BrowserWindow({show:false,width:800,height:1000,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,javascript:false}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',event=>event.preventDefault());
  const timeout=setTimeout(()=>{if(!win.isDestroyed())win.destroy();},20000);
  try{
   await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(manualHtml(language,app.getVersion())));
   const pdf=await win.webContents.printToPDF({printBackground:true,preferCSSPageSize:true});
   const dir=join(app.getPath('userData'),'help');await mkdir(dir,{recursive:true});
   const file=join(dir,`Hornet-Help-${app.getVersion()}-${language.startsWith('zh')?'zh':'en'}.pdf`);await writeFile(file,pdf);
   const error=await shell.openPath(file);if(error)throw new Error(error);
  }finally{clearTimeout(timeout);if(!win.isDestroyed())win.destroy();}
 })().finally(()=>{pdfWork=undefined;});return pdfWork;
}
