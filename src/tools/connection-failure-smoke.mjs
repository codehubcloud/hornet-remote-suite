import { _electron as electron,expect as baseExpect } from '@playwright/test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { createServer,createConnection } from 'node:net';
import { mkdtemp,mkdir,rm } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { dismissStartupSessions } from './session-dialog-helper.mjs';

const expect=baseExpect.configure({timeout:15000});
await mkdir('test-results',{recursive:true});
await build({entryPoints:['tests/fixtures/ssh-server.ts'],outfile:'test-results/connection-failure-fixture.cjs',bundle:true,platform:'node',format:'cjs',external:['ssh2']});
const fixture=await createRequire(import.meta.url)(resolve('test-results/connection-failure-fixture.cjs')).sshFixture();
const sockets=new Set();let forward=false;
const endpoint=createServer(socket=>{
 sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));
 if(!forward){socket.resume();return;}
 const upstream=createConnection({host:'127.0.0.1',port:fixture.port});sockets.add(upstream);upstream.on('error',()=>socket.destroy());upstream.on('close',()=>{sockets.delete(upstream);socket.destroy();});socket.on('close',()=>upstream.destroy());socket.pipe(upstream);upstream.pipe(socket);
});
await new Promise(resolve=>endpoint.listen(0,'127.0.0.1',resolve));const port=endpoint.address().port;
await new Promise(resolve=>endpoint.close(resolve));
const data=await mkdtemp(join(tmpdir(),'hornet-connection-failure-'));
const env={...process.env,HORNET_USER_DATA:data,HORNET_SMOKE:'1'};delete env.ELECTRON_RUN_AS_NODE;
const executable=process.env.HORNET_PACKAGED_EXECUTABLE;
let app;
try{
 app=await electron.launch({...(executable?{executablePath:executable}:{}),args:executable?(process.platform==='linux'?['--no-sandbox']:[]):['.'],env,timeout:60000});const page=await app.firstWindow();page.setDefaultTimeout(15000);await dismissStartupSessions(page);
 await app.evaluate(({BrowserWindow})=>{for(const win of BrowserWindow.getAllWindows()){win.webContents.setBackgroundThrottling(false);win.showInactive();}});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.getByLabel('快速连接地址',{exact:true}).fill('tester@127.0.0.1:'+port);await page.locator('.quick-connect-bar').getByRole('button',{name:'连接',exact:true}).click();
 await page.getByLabel('名称',{exact:true}).fill('Offline fixture');const refusedAt=Date.now();await page.getByRole('button',{name:'保存并连接',exact:true}).click();
 const cell=page.locator('.terminal-cell').first(),host=cell.locator('.terminal-host');
 const sessionState=page.locator('[data-session-property="state"] dd');
 await expect(host).toContainText('服务器拒绝连接');expect(Date.now()-refusedAt).toBeLessThan(5000);
 await expect(host).toContainText('127.0.0.1:'+port);await expect(cell.getByRole('status')).toContainText('连接失败');await expect(page.getByLabel('认证信息',{exact:true})).toHaveCount(0);
 await expect(sessionState).toHaveText('连接失败');
 const tabId=await page.locator('.tabs [data-tab-view-id]').first().getAttribute('data-tab-view-id');
 // A TCP endpoint that accepts connections but never sends an SSH banner.
 await new Promise(resolve=>endpoint.listen(port,'127.0.0.1',resolve));
 await cell.getByRole('button',{name:'重新连接',exact:true}).click();await expect(cell.getByRole('status')).toContainText('正在连接');
 await expect(sessionState).toHaveText('正在连接…');
 await page.getByLabel('认证信息',{exact:true}).fill('test-password');const silentAt=Date.now();await page.getByRole('button',{name:'继续连接',exact:true}).click();
 expect(await page.evaluate(()=>window.hornet.profiles.list())).toHaveLength(1);
 await expect(host).toContainText('服务器未响应');const elapsed=Date.now()-silentAt;expect(elapsed).toBeGreaterThanOrEqual(9000);expect(elapsed).toBeLessThan(15000);
 console.log('Silent SSH endpoint reported after '+(elapsed/1000).toFixed(1)+'s.');
 await expect(cell.getByRole('status')).toContainText('连接失败');await expect(cell.getByRole('button',{name:'打开文件',exact:true})).toBeDisabled();
 await expect(sessionState).toHaveText('连接失败');
 await host.evaluate(node=>node.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:500,clientY:250})));
 const menu=page.getByRole('menu',{name:'终端内容菜单',exact:true});await expect(menu.getByRole('menuitem',{name:'粘贴',exact:true})).toBeDisabled();await menu.getByRole('menuitem',{name:'全选',exact:true}).click();
 await page.screenshot({path:'test-results/connection-failure.png'});
 // Reuse the exact failed tab after restoring the endpoint, with real SSH.
 forward=true;await cell.getByRole('button',{name:'重新连接',exact:true}).click();await page.getByLabel('认证信息',{exact:true}).fill('test-password');await page.getByRole('button',{name:'继续连接',exact:true}).click();await page.getByRole('button',{name:'已核对，信任此主机',exact:true}).click();
 await expect(host).toContainText('fixture ready');await expect(cell.getByRole('button',{name:'打开文件',exact:true})).toBeEnabled();await expect(cell.locator('.terminal-disconnected')).toHaveCount(0);
 await expect(sessionState).toHaveText('已连接');
 expect(await page.locator('.tabs [data-tab-view-id]').first().getAttribute('data-tab-view-id')).toBe(tabId);await expect(page.locator('.tabs [data-tab-view-id]')).toHaveCount(1);
 expect(errors).toEqual([]);await expect(page.locator('.error-banner')).toHaveCount(0);
 // Closing a live transport must update the footer without removing its terminal.
 for(const socket of sockets)socket.destroy();
 await expect(sessionState).toHaveText('已断开');
 await cell.getByRole('button',{name:'重新连接',exact:true}).click();
 await expect(sessionState).toHaveText('正在连接…');
 await page.getByLabel('认证信息',{exact:true}).fill('test-password');await page.getByRole('button',{name:'继续连接',exact:true}).click();
 await expect(sessionState).toHaveText('已连接');
 console.log('Connection failure UI passed: immediate refusal without password prompt, visible target/reason, 10s silent-server deadline, responsive IPC, disabled paste/files, successful same-tab SSH recovery, and footer states for connecting/failed/connected/disconnected/reconnecting.');
}finally{
 if(app)await app.evaluate(({app})=>app.exit(0)).catch(()=>{});
 for(const socket of sockets)socket.destroy();if(endpoint.listening)await new Promise(resolve=>endpoint.close(resolve));
 await fixture.close();await rm(data,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
