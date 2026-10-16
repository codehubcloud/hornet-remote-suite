import { app,BrowserWindow,net,shell } from 'electron';
import { mkdir,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkForUpdates,helpLinks } from '../../../packages/core/help';
import { manualHtml } from '../../../packages/core/help-content';
import type { AppInfo,HelpLink } from '../../../packages/contracts/help';
export const appInfo=():AppInfo=>({version:app.getVersion(),platform:process.platform,arch:process.arch,electron:process.versions.electron,chrome:process.versions.chrome,node:process.versions.node});
export async function openHelpLink(link:HelpLink){await shell.openExternal(helpLinks[link]);}
export const checkUpdates=()=>checkForUpdates(app.getVersion(),net.fetch.bind(net) as typeof fetch);
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
