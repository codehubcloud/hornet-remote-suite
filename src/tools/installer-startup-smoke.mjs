import { _electron as electron,expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp,rm,readdir } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';

if(process.platform!=='win32')throw Error('Windows installer startup probe requires Windows.');
const executable=process.env.HORNET_PACKAGED_EXECUTABLE;
const installer=process.env.HORNET_INSTALLER_EXECUTABLE;
if(!executable||!installer)throw Error('Set HORNET_PACKAGED_EXECUTABLE and HORNET_INSTALLER_EXECUTABLE to the exact files to test.');
const data=await mkdtemp(join(tmpdir(),'hornet-real-installer-'));
let app;
try{
 const env={...process.env,HORNET_USER_DATA:join(data,'user-data'),HORNET_SMOKE:'1'};delete env.ELECTRON_RUN_AS_NODE;
 app=await electron.launch({executablePath:resolve(executable),args:[],env,timeout:60000});
 const applicationProcess=app.process();
 const page=await app.firstWindow();await expect(page.locator('.app-shell')).toBeVisible();
 await new Promise((resolveProbe,reject)=>{
  const child=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',resolve('tools/installer-smoke.ps1'),'-StartupProbeInstaller',resolve(installer),'-StartupProbeDirectory',join(data,'new-install','Hornet Remote Suite')],{stdio:'inherit',windowsHide:true});
  child.once('error',reject);child.once('exit',code=>code===0?resolveProbe():reject(Error('Real installer startup probe failed: '+code)));
 });
 if(applicationProcess.exitCode!==null)throw Error('Cancelling setup closed the existing genuine app.');
 await expect(page.locator('.app-shell')).toBeVisible();
 const target=await readdir(join(data,'new-install','Hornet Remote Suite')).catch(()=>[]);
 if(target.some(name=>/\.exe$/i.test(name)))throw Error('Startup cancellation installed an executable.');
 console.log('Actual packaged Electron remained running and responsive after setup cancellation; isolated target unchanged.');
}finally{
 if(app)await app.evaluate(({app})=>app.exit(0)).catch(()=>{});
 await rm(data,{recursive:true,force:true,maxRetries:10,retryDelay:300});
}
