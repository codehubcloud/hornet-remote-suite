import { _electron as electron,expect } from '@playwright/test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp,mkdir,rm,writeFile,readFile } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { dismissStartupSessions } from './session-dialog-helper.mjs';

await mkdir('test-results',{recursive:true});
await build({entryPoints:['tests/fixtures/ssh-server.ts'],outfile:'test-results/transfer-reliability-fixture.cjs',bundle:true,platform:'node',format:'cjs',external:['ssh2']});
const server=await createRequire(import.meta.url)(resolve('test-results/transfer-reliability-fixture.cjs')).sshFixture({remoteHash:'supported',hashDelayMs:1500});
const data=await mkdtemp(join(tmpdir(),'hornet-reliability-')),source=join(data,'upload.bin'),payload=Buffer.alloc(4*1024*1024,0x71);await writeFile(source,payload);
const env={...process.env,HORNET_USER_DATA:data,HORNET_SMOKE:'1'};delete env.ELECTRON_RUN_AS_NODE;
let executable=process.env.HORNET_PACKAGED_EXECUTABLE;
if(!executable&&process.argv.includes('--packaged'))executable=process.platform==='win32'?resolve('release/win-unpacked/Hornet Remote Suite.exe'):process.platform==='darwin'?resolve('release',process.arch==='arm64'?'mac-arm64':'mac','Hornet Remote Suite.app/Contents/MacOS/Hornet Remote Suite'):resolve('release',process.arch==='arm64'?'linux-arm64-unpacked':'linux-unpacked','hornet-remote-suite');
let app;
try{
 app=await electron.launch({...(executable?{executablePath:executable}:{}),args:process.platform==='linux'?['--no-sandbox',...(!executable?['.']:[])]:executable?[]:['.'],env,timeout:60000});
 const page=await app.firstWindow();page.setDefaultTimeout(20000);await dismissStartupSessions(page);
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},source);
 await page.getByLabel('快速连接地址',{exact:true}).fill('tester@127.0.0.1:'+server.port);
 await page.locator('.quick-connect-bar').getByRole('button',{name:'连接',exact:true}).click();
 await page.getByLabel('名称',{exact:true}).fill('Transfer fixture');await page.getByRole('button',{name:'保存并连接',exact:true}).click();
 await page.getByLabel('认证信息',{exact:true}).fill('test-password');await page.getByRole('button',{name:'继续连接',exact:true}).click();await page.getByRole('button',{name:'已核对，信任此主机',exact:true}).click();
 await expect(page.locator('.terminal-host')).toBeVisible();
 const profileId=await page.evaluate(async()=>(await window.hornet.profiles.list()).find(p=>p.name==='Transfer fixture').profileId);
 const connection=await page.evaluate(id=>window.hornet.connection.open(id,'files'),profileId);
 const upload=await page.evaluate(async id=>{const selected=await window.hornet.file.choose('upload');return window.hornet.transfer.start(id,'upload',selected.pathGrantId,"/large 'quoted;$.bin",crypto.randomUUID());},connection.connectionId);
 const tasks=page.getByRole('region',{name:'任务中心',exact:true});
 await expect(tasks).toContainText('SHA-256');
 await expect.poll(()=>server.remoteHashes.length,{timeout:30000}).toBeGreaterThan(0);
 // Ordinary requests must still be handled while the remote disk computes SHA-256.
 expect(await page.evaluate(()=>window.hornet.x11.status())).toHaveProperty('configured');
 await expect(tasks).toContainText('远端');
 await expect.poll(()=>page.evaluate(async id=>(await window.hornet.task.list()).find(t=>t.taskId===id)?.state,upload.taskId),{timeout:45000}).toBe('succeeded');
 expect(server.files.get("/large 'quoted;$.bin")).toEqual(payload);expect([...server.readBytes.values()].reduce((a,b)=>a+b,0)).toBe(0);
 const local=join(data,'download.bin');await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},local);
 const download=await page.evaluate(async id=>{const selected=await window.hornet.file.choose('download','download.bin');return window.hornet.transfer.start(id,'download',selected.pathGrantId,"/large 'quoted;$.bin",crypto.randomUUID());},connection.connectionId);
 await expect.poll(()=>page.evaluate(async id=>(await window.hornet.task.list()).find(t=>t.taskId===id)?.state,download.taskId),{timeout:45000}).toBe('succeeded');
 expect(await readFile(local)).toEqual(payload);expect(server.readBytes.get("/large 'quoted;$.bin")).toBe(payload.length);
 await app.evaluate(({powerMonitor})=>{powerMonitor.emit('suspend');powerMonitor.emit('resume');});
 expect((await page.evaluate(()=>window.hornet.profiles.list())).some(p=>p.profileId===profileId)).toBe(true);
 expect(errors).toEqual([]);await expect(page.locator('.error-banner')).toHaveCount(0);
 console.log('Transfer reliability passed: actual backend, remote SHA-256, no upload readback, single download, live verification UI, responsive X11 status and power-event recovery.');
}finally{
 if(app)await app.evaluate(({app})=>app.exit(0)).catch(()=>{});
 await server.close();await rm(data,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
