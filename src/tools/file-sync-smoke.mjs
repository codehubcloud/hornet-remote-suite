import { _electron as electron,expect } from '@playwright/test';
import { mkdtemp,mkdir,rm,writeFile,readFile,utimes } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { dismissStartupSessions } from './session-dialog-helper.mjs';
await mkdir('test-results',{recursive:true});await build({entryPoints:['tests/fixtures/ssh-server.ts'],outfile:'test-results/sync-fixture.cjs',bundle:true,platform:'node',format:'cjs',external:['ssh2']});
const server=await createRequire(import.meta.url)(resolve('test-results/sync-fixture.cjs')).sshFixture({atomicRename:true});
const data=await mkdtemp(join(tmpdir(),'hornet-sync-ui-')),local=join(data,'local');await mkdir(local);
for(const [name,text,time]of [['up.txt','LOCAL_NEW',1700000030],['down.txt','LOCAL_OLD',1700000000],['same.txt','identical',1700000040],['tie.txt','LEFT',1700000000]]){await writeFile(join(local,name),text);await utimes(join(local,name),time,time);}
for(const [name,text,time]of [['up.txt','REMOTE_OLD',1700000000],['down.txt','REMOTE_NEW',1700000030],['same.txt','identical',1700000000],['tie.txt','RIGHT',1700000000]]){server.files.set('/'+name,Buffer.from(text));server.mtimes.set('/'+name,time);}
const env={...process.env,HORNET_USER_DATA:data,HORNET_SMOKE:'1'};delete env.ELECTRON_RUN_AS_NODE;let app;
try{
 app=await electron.launch({args:['.'],env,timeout:30000});const page=await app.firstWindow();page.setDefaultTimeout(20000);await dismissStartupSessions(page);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},local);
 await page.getByLabel('快速连接地址',{exact:true}).fill('tester@127.0.0.1:'+server.port);await page.locator('.quick-connect-bar').getByRole('button',{name:'连接',exact:true}).click();await page.getByLabel('名称',{exact:true}).fill('Sync fixture');await page.getByRole('button',{name:'保存并连接',exact:true}).click();
 await page.getByLabel('认证信息',{exact:true}).fill('test-password');await page.getByRole('button',{name:'继续连接',exact:true}).click();await page.getByRole('button',{name:'已核对，信任此主机',exact:true}).click();await page.getByRole('button',{name:'打开文件',exact:true}).click();
 await page.getByRole('region',{name:'本地文件',exact:true}).getByRole('button',{name:'选择本地目录',exact:true}).click();
 for(const [region,pathLabel,filterLabel]of [['本地文件','本地相对路径','筛选本地文件'],['远端文件','远端路径','筛选当前目录']]){
  const pane=page.getByRole('region',{name:region,exact:true});await pane.getByRole('textbox',{name:pathLabel,exact:true}).click();await page.getByRole('navigation',{name:'应用菜单'}).getByRole('button',{name:'编辑',exact:true}).click();await page.getByRole('menuitem',{name:'查找…',exact:true}).click();const filter=pane.getByRole('textbox',{name:filterLabel,exact:true});await expect(filter).toBeFocused();await page.keyboard.press('Escape');await expect(filter).toHaveCount(0);
 }
 await page.getByRole('button',{name:'双向同步…',exact:true}).click();
 const preview=page.getByRole('dialog',{name:'目录传输预览',exact:true}),row=name=>preview.getByRole('row').filter({hasText:name});
 await expect(row('up.txt')).toContainText('本地 → 远端');await expect(row('up.txt')).toContainText('覆盖文件');await expect(row('down.txt')).toContainText('远端 → 本地');await expect(row('same.txt')).toContainText('文件内容相同');await expect(row('tie.txt')).toContainText('跳过冲突');
 await preview.getByRole('button',{name:'关闭预览',exact:true}).click();expect(server.files.get('/up.txt').toString()).toBe('REMOTE_OLD');expect(await readFile(join(local,'down.txt'),'utf8')).toBe('LOCAL_OLD');
 await page.getByRole('button',{name:'双向同步…',exact:true}).click();await preview.getByLabel('同名文件策略',{exact:true}).selectOption('local');await expect(row('tie.txt')).toContainText('覆盖文件');await expect(row('down.txt')).toContainText('本地 → 远端');await preview.getByLabel('同名文件策略',{exact:true}).selectOption('newer');await expect(row('down.txt')).toContainText('远端 → 本地');await expect(preview.getByRole('button',{name:'执行同步',exact:true})).toBeEnabled();await page.screenshot({path:'test-results/file-sync-preview.png'});
 await preview.getByRole('button',{name:'执行同步',exact:true}).click();await expect.poll(()=>server.files.get('/up.txt')?.toString()).toBe('LOCAL_NEW');await expect.poll(()=>readFile(join(local,'down.txt'),'utf8')).toBe('REMOTE_NEW');expect(server.files.get('/tie.txt').toString()).toBe('RIGHT');
 await expect.poll(()=>page.evaluate(async()=>(await window.hornet.task.list()).every(t=>t.state==='succeeded'))).toBe(true);
 await page.getByRole('button',{name:'双向同步…',exact:true}).click();await expect(row('up.txt')).toContainText('文件内容相同');await expect(row('down.txt')).toContainText('文件内容相同');await preview.getByLabel('同名文件策略',{exact:true}).selectOption('keep-both');await expect(preview).toContainText('tie (local).txt');await expect(preview).toContainText('tie (remote).txt');await expect(preview.getByRole('button',{name:'执行同步',exact:true})).toBeEnabled();await preview.getByRole('button',{name:'执行同步',exact:true}).click();
 await expect.poll(()=>server.files.get('/tie (local).txt')?.toString()).toBe('LEFT');await expect.poll(async()=>{try{return await readFile(join(local,'tie (remote).txt'),'utf8');}catch{return '';}}).toBe('RIGHT');expect(await readFile(join(local,'tie.txt'),'utf8')).toBe('LEFT');expect(server.files.get('/tie.txt').toString()).toBe('RIGHT');expect(errors).toEqual([]);
 console.log('File synchronization desktop passed: preview/cancel, policy recompare, atomic replacement in both directions, content equality, ties and keep-both copies.');
}catch(error){if(app)await (await app.firstWindow()).screenshot({path:'test-results/file-sync-failure.png'}).catch(()=>{});throw error;}
finally{if(app)await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await server.close();await rm(data,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
