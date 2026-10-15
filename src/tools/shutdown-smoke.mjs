import { _electron as electron,expect } from '@playwright/test';
import { mkdtemp,rm,writeFile } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { dismissStartupSessions } from './session-dialog-helper.mjs';

const data=await mkdtemp(join(tmpdir(),'hornet-shutdown-')),worker=join(data,'prototype-probe.cjs');
await writeFile(worker,"process.parentPort.on('message',()=>{});\n");
const env={...process.env,HORNET_USER_DATA:data,HORNET_SMOKE:'1'};delete env.ELECTRON_RUN_AS_NODE;
let executable=process.env.HORNET_PACKAGED_EXECUTABLE;
if(!executable&&process.argv.includes('--packaged'))executable=process.platform==='win32'?resolve('release/win-unpacked/Hornet Remote Suite.exe'):process.platform==='darwin'?resolve('release',process.arch==='arm64'?'mac-arm64':'mac','Hornet Remote Suite.app/Contents/MacOS/Hornet Remote Suite'):resolve('release',process.arch==='arm64'?'linux-arm64-unpacked':'linux-unpacked','hornet-remote-suite');
let app,exited=false;
try{
 app=await electron.launch({...(executable?{executablePath:executable}:{}),args:executable?(process.platform==='linux'?['--no-sandbox']:[]):process.platform==='linux'?['--no-sandbox','.']:['.'],env,timeout:60000});
 const applicationProcess=app.process();
 const page=await app.firstWindow();page.setDefaultTimeout(15000);await dismissStartupSessions(page);
 await expect(page.getByRole('region',{name:'快速开始',exact:true})).toBeVisible();
 // The helper obtains Electron's shared UtilityProcess prototype. Drop call
 // delivery only in this isolated test process: the real host keeps sending
 // heartbeats, but every ordinary request and graceful shutdown stays pending.
 await app.evaluate(async({utilityProcess,dialog},path)=>{
  const probe=utilityProcess.fork(path,[],{serviceName:'Shutdown test probe',stdio:'pipe'});
  probe.stdout?.resume();probe.stderr?.resume();
  await new Promise((resolve,reject)=>{probe.once('spawn',resolve);probe.once('exit',()=>reject(new Error('Probe exited before spawn')));});
  const prototype=Object.getPrototypeOf(probe),original=prototype.postMessage;
  if(typeof original!=='function'){probe.kill();throw new Error('UtilityProcess shared method unavailable');}
  const state=globalThis.__hornetShutdownFixture={calls:[],prompts:0,choice:1,backendPid:0};
  prototype.postMessage=function(message,...rest){if(message?.type==='call'){state.calls.push(message.method);state.backendPid=this.pid;return;}return original.call(this,message,...rest);};
  dialog.showMessageBox=async()=>{state.prompts++;return {response:state.choice};};
  probe.kill();
 },worker);
 await page.evaluate(()=>{void window.hornet.task.list().catch(()=>{});});
 await expect.poll(()=>app.evaluate(()=>globalThis.__hornetShutdownFixture.calls.includes('task.list'))).toBe(true);
 const promptsBefore=Date.now();
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());
 await expect.poll(()=>app.evaluate(()=>globalThis.__hornetShutdownFixture.prompts),{timeout:5000}).toBe(1);
 expect(Date.now()-promptsBefore).toBeLessThan(5000);
 expect(applicationProcess.exitCode).toBeNull();
 const backendPid=await app.evaluate(()=>{const state=globalThis.__hornetShutdownFixture;state.choice=0;return state.backendPid;});
 // Also freeze this disposable renderer. Closing must use only the main
 // process, and must bypass a renderer that cannot answer beforeunload.
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false));
 await page.evaluate(()=>{setTimeout(()=>{while(true){/* Deliberate test-only renderer hang. */}},50);});
 await new Promise(resolve=>setTimeout(resolve,200));
 const started=Date.now();
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());
 await expect.poll(()=>applicationProcess.exitCode,{timeout:12000}).toBe(0);exited=true;
 const elapsed=Date.now()-started;expect(elapsed).toBeLessThan(10000);
 await expect.poll(()=>{try{process.kill(backendPid,0);return true;}catch{return false;}},{timeout:5000}).toBe(false);
 console.log('Shutdown passed: nonresponsive IPC, immediate confirmation, cancel preserves the app, frozen renderer, accepted exit in '+elapsed+'ms, protocol host terminated.');
}finally{
 if(app&&!exited)await app.evaluate(({app})=>app.exit(0)).catch(()=>{});
 await rm(data,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
