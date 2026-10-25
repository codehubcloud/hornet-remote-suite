import { _electron as electron,expect } from '@playwright/test';
import { mkdtemp,mkdir,rm,writeFile,readFile } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { dismissStartupSessions } from './session-dialog-helper.mjs';
await mkdir('test-results',{recursive:true});
await build({entryPoints:['tests/fixtures/ssh-server.ts'],outfile:'test-results/file-drag-fixture.cjs',bundle:true,platform:'node',format:'cjs',external:['ssh2']});
const server=await createRequire(import.meta.url)(resolve('test-results/file-drag-fixture.cjs')).sshFixture({remoteHash:'supported',remoteSystem:'Linux\nID=ubuntu\n'});
const data=await mkdtemp(join(tmpdir(),'hornet-drag-ui-')),local=join(data,'local'),external=join(data,'external.txt');await mkdir(local);await writeFile(external,'EXTERNAL DROP');await writeFile(join(local,'upload.txt'),'LOCAL DRAG');await writeFile(join(local,'second.txt'),'SECOND DRAG');
const env={...process.env,HORNET_USER_DATA:data,HORNET_SMOKE:'1'};delete env.ELECTRON_RUN_AS_NODE;
let app;
async function drag(_page,from,to){await from.dragTo(to);}

async function dropExternal(page,target){await page.evaluate(()=>{const input=document.createElement('input');input.type='file';input.id='drop-source';input.style.display='none';document.body.append(input);});await page.locator('#drop-source').setInputFiles(external);const transfer=await page.evaluateHandle(()=>{const transfer=new DataTransfer();transfer.items.add(document.querySelector('#drop-source').files[0]);return transfer;});try{await target.dispatchEvent('dragover',{dataTransfer:transfer});await target.dispatchEvent('drop',{dataTransfer:transfer});}finally{await transfer.dispose();await page.locator('#drop-source').evaluate(node=>node.remove());}}
try{
 app=await electron.launch({args:process.platform==='linux'?['--no-sandbox','.']:['.'],env,timeout:60000});const page=await app.firstWindow();page.setDefaultTimeout(20000);await dismissStartupSessions(page);const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.getByLabel('快速连接地址',{exact:true}).fill('tester@127.0.0.1:'+server.port);await page.locator('.quick-connect-bar').getByRole('button',{name:'连接',exact:true}).click();await page.getByLabel('名称',{exact:true}).fill('Drag fixture');await page.getByRole('button',{name:'保存并连接',exact:true}).click();
 await page.getByLabel('认证信息',{exact:true}).fill('test-password');await page.getByRole('button',{name:'继续连接',exact:true}).click();await page.getByRole('button',{name:'已核对，信任此主机',exact:true}).click();
 await expect.poll(()=>page.evaluate(async()=>(await window.hornet.profiles.list()).find(p=>p.name==='Drag fixture')?.remoteSystem)).toBe('ubuntu');
 // Drop real OS-backed File objects across the context-isolated preload bridge.
 const compact=page.locator('.files-compact');await expect(compact).toBeVisible();await dropExternal(page,compact);await expect.poll(()=>server.files.get('/external.txt')?.toString()).toBe('EXTERNAL DROP');await expect(compact.getByRole('row').filter({hasText:'external.txt'})).toBeVisible();
 const row=compact.getByRole('row').filter({hasText:'hello.txt'});await row.getByRole('button',{name:'准备拖出',exact:true}).click();const native=row.getByRole('button',{name:'拖到桌面',exact:true});await expect(native).toBeVisible();
 // Intercept only the OS boundary, after the real backend has downloaded and verified bytes.
 await app.evaluate(({BrowserWindow})=>{globalThis.dragPayload=null;BrowserWindow.getAllWindows()[0].webContents.startDrag=payload=>{globalThis.dragPayload={files:payload.files,iconEmpty:payload.icon.isEmpty()};};});
 await native.dispatchEvent('dragstart',{dataTransfer:await page.evaluateHandle(()=>new DataTransfer())});await expect.poll(()=>app.evaluate(()=>globalThis.dragPayload?.files?.length)).toBe(1);const payload=await app.evaluate(()=>globalThis.dragPayload);expect(payload.iconEmpty).toBe(false);expect(await readFile(payload.files[0],'utf8')).toBe('hello 世界\n');
 await page.getByRole('button',{name:'打开文件',exact:true}).click();await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},local);
 const left=page.locator('.local-file-pane'),right=page.locator('.remote-file-pane .files');await left.getByRole('button',{name:'选择本地目录',exact:true}).click();
 await left.getByLabel('选择本地文件 upload.txt',{exact:true}).check();await left.getByLabel('选择本地文件 second.txt',{exact:true}).check();await drag(page,left.getByRole('row').filter({hasText:'upload.txt'}),right);
 await expect.poll(()=>server.files.get('/upload.txt')?.toString()).toBe('LOCAL DRAG');await expect.poll(()=>server.files.get('/second.txt')?.toString()).toBe('SECOND DRAG');
 await drag(page,right.getByRole('row').filter({hasText:'hello.txt'}),left);await expect.poll(async()=>{try{return await readFile(join(local,'hello.txt'),'utf8');}catch{return '';}}).toBe('hello 世界\n');
 // A second download to the same name must preserve the existing local contents.
 await writeFile(join(local,'hello.txt'),'KEEP EXISTING');await drag(page,right.getByRole('row').filter({hasText:'hello.txt'}),left);const conflict=page.getByRole('dialog',{name:'目标文件已存在',exact:true});await expect(conflict).toBeVisible();expect(await readFile(join(local,'hello.txt'),'utf8')).toBe('KEEP EXISTING');await conflict.getByLabel('操作',{exact:true}).selectOption('skip');await conflict.getByRole('button',{name:'确定',exact:true}).click();await expect(conflict).toBeHidden();await expect(page.locator('.error-banner')).toHaveCount(0);
 await page.getByRole('button',{name:'◈ 工作台',exact:true}).click();await expect(page.locator('.host .system-icon[data-system=ubuntu]')).toBeVisible();
 await page.screenshot({path:'test-results/file-drag-system-icon.png'});expect(errors).toEqual([]);
 await app.evaluate(({app})=>app.exit(0));app=undefined;
 // Persistence must survive the process, not just the renderer store.
 app=await electron.launch({args:process.platform==='linux'?['--no-sandbox','.']:['.'],env,timeout:60000});const next=await app.firstWindow();await expect(next.locator('.host .system-icon[data-system=ubuntu]')).toBeVisible({timeout:30000});
 console.log('File drag and system icons passed: real OS-file upload, compact refresh, multi-file upload, download, conflict preservation, verified native export and persisted Ubuntu icon.');
}catch(error){if(app)await (await app.firstWindow()).screenshot({path:'test-results/file-drag-failure.png'}).catch(()=>{});throw error;}
finally{if(app)await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await server.close();await rm(data,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
