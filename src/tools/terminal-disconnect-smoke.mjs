import { _electron as electron,expect as baseExpect } from '@playwright/test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp,mkdir,rm } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { dismissStartupSessions } from './session-dialog-helper.mjs';

const expect=baseExpect.configure({timeout:30000});
await mkdir('test-results',{recursive:true});
await build({entryPoints:['tests/fixtures/ssh-server.ts'],outfile:'test-results/disconnect-fixture.cjs',bundle:true,platform:'node',format:'cjs',external:['ssh2']});
const server=await createRequire(import.meta.url)(resolve('test-results/disconnect-fixture.cjs')).sshFixture({networkProxy:true});
const data=await mkdtemp(join(tmpdir(),'hornet-disconnect-'));
const env={...process.env,HORNET_USER_DATA:data,HORNET_SMOKE:'1'};delete env.ELECTRON_RUN_AS_NODE;
let executable=process.env.HORNET_PACKAGED_EXECUTABLE;
if(!executable&&process.argv.includes('--packaged'))executable=process.platform==='win32'?resolve('release/win-unpacked/Hornet Remote Suite.exe'):process.platform==='darwin'?resolve('release',process.arch==='arm64'?'mac-arm64':'mac','Hornet Remote Suite.app/Contents/MacOS/Hornet Remote Suite'):resolve('release',process.arch==='arm64'?'linux-arm64-unpacked':'linux-unpacked','hornet-remote-suite');
let app;
try{
 app=await electron.launch({...(executable?{executablePath:executable}:{}),args:executable?(process.platform==='linux'?['--no-sandbox']:[]):['.'],env,timeout:60000});
 const page=await app.firstWindow();page.setDefaultTimeout(30000);await dismissStartupSessions(page);
 await app.evaluate(({BrowserWindow})=>{for(const win of BrowserWindow.getAllWindows()){win.webContents.setBackgroundThrottling(false);win.showInactive();}});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const quick=async text=>{await page.getByLabel('快速连接地址',{exact:true}).fill(text);await page.locator('.quick-connect-bar').getByRole('button',{name:'连接',exact:true}).click();};
 await quick('tester@127.0.0.1:'+server.port);
 await page.getByLabel('名称',{exact:true}).fill('Disconnect fixture');await page.getByRole('button',{name:'保存并连接',exact:true}).click();
 await page.getByLabel('认证信息',{exact:true}).fill('test-password');await page.getByRole('button',{name:'继续连接',exact:true}).click();await page.getByRole('button',{name:'已核对，信任此主机',exact:true}).click();
 const first=page.locator('.terminal-cell').first(),second=page.locator('.terminal-cell').nth(1);
 await expect(first).toContainText('fixture ready');await quick('Disconnect fixture');await expect(second).toContainText('fixture ready');expect(server.authCount).toBe(1);
 for(const [pid] of server.shellSizes)server.writeShell(pid,'\r\n'+Array.from({length:12},(_,index)=>'retained-line-'+index).join('\r\n')+'\r\n$ ');
 for(const [index,cell] of [first,second].entries()){
  await page.locator('.tabs [data-tab-view-id]').nth(index).locator('button').first().click();
  await expect(cell.locator('.terminal-host')).toContainText('retained-line-11');
 }
 const oldIds=await page.locator('.terminal-cell').evaluateAll(nodes=>nodes.map(node=>node.dataset.terminalId));
 // Hide the terminals and collapse the toolbar, then silently discard packets.
 // Neither peer sends FIN/RST. Production's 15s / 3-miss SSH keepalive must
 // detect this without renderer polling or a simulated terminal.closed event.
 await page.getByRole('button',{name:'折叠工具栏',exact:true}).click();
 await page.getByRole('button',{name:'◈ 工作台',exact:true}).click();
 const started=Date.now();server.blackhole();
 const list=await page.evaluate(()=>window.hornet.profiles.list());expect(list).toHaveLength(1);
 await expect.poll(()=>page.locator('.terminal-tab-disconnected').count(),{timeout:75000,intervals:[1000]}).toBe(2);
 console.log('Silent network loss detected after '+((Date.now()-started)/1000).toFixed(1)+'s with the production keepalive settings.');
 await page.locator('.tabs [data-tab-view-id]').first().locator('button').first().click();
 await expect(first.locator('.terminal-disconnected')).toBeVisible();await expect(first.locator('.terminal-host')).toContainText('fixture ready');
 await expect(first.locator('.terminal-host')).toContainText('连接错误：Keepalive timeout');
 await expect(first.locator('.terminal-host')).toContainText(/已断开会话「Disconnect fixture」，时间 \d{2}:\d{2}:\d{2}。/);
 // Hidden xterm canvases render their queued text when the tab becomes visible.
 for(const [index,cell] of [first,second].entries()){
  await page.locator('.tabs [data-tab-view-id]').nth(index).locator('button').first().click();
  await expect(cell.locator('.terminal-host')).toContainText('已断开会话');
  for(let line=0;line<12;line++)await expect(cell.locator('.terminal-host')).toContainText('retained-line-'+line);
  expect((await cell.locator('.terminal-host').textContent()).match(/已断开会话/g)).toHaveLength(1);
 }
 await page.locator('.tabs [data-tab-view-id]').first().locator('button').first().click();
 await expect(first.locator('.terminal-host')).toContainText('已断开会话');
 const firstTranscript=await first.locator('.terminal-host').textContent();
 await page.screenshot({path:'test-results/terminal-disconnect.png'});
 const inputBefore=JSON.stringify(server.shellInputs);await first.locator('.xterm-helper-textarea').focus();await page.keyboard.type('must-not-run');expect(JSON.stringify(server.shellInputs)).toBe(inputBefore);
 await second.locator('.terminal-host').evaluate(node=>node.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:200,clientY:200})));
 const context=page.getByRole('menu',{name:'终端内容菜单',exact:true});await expect(context.getByRole('menuitem',{name:'粘贴',exact:true})).toBeDisabled();await expect(context.getByRole('menuitem',{name:'断开',exact:true})).toBeDisabled();
 await context.getByRole('menuitem',{name:'重新连接',exact:true}).click();
 // Passwords were deliberately not saved. Reconnection must authenticate
 // again; the same endpoint's previously accepted host key remains trusted.
 await page.getByLabel('认证信息',{exact:true}).fill('test-password');await page.getByRole('button',{name:'继续连接',exact:true}).click();
 // New TCP links work while the old links remain blackholed.
 await expect.poll(()=>server.shellCount).toBe(3);await expect(second.locator('.terminal-disconnected')).toHaveCount(0);await expect(second.locator('.terminal-host')).toContainText('fixture ready');
 expect(await second.getAttribute('data-terminal-id')).not.toBe(oldIds[1]);await expect(first.locator('.terminal-disconnected')).toHaveCount(1);
 await expect(page.locator('.terminal-tab-disconnected')).toHaveCount(1);expect(server.shellInputs.flatMap(([,text])=>[text]).join('')).not.toContain('must-not-run');
 // Leaving a full-screen app must restore the saved normal-screen history.
 server.writeShell(server.shellSizes.at(-1)[0],'\r\nbefore-fullscreen\r\n$ \x1b[?1049h\x1b[Hfull-screen running');
 await expect(second.locator('.terminal-host')).toContainText('full-screen running');
 // A deliberate disconnect has a different reason and still appends just once.
 await second.locator('.terminal-host').evaluate(node=>node.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:400,clientY:200})));
 await page.getByRole('menu',{name:'终端内容菜单',exact:true}).getByRole('menuitem',{name:'断开',exact:true}).click();
 await expect(second.locator('.terminal-host')).toContainText('已主动断开连接。');
 await expect(second.locator('.terminal-host')).toContainText('before-fullscreen');
 await expect(second.locator('.terminal-host')).toContainText('fixture ready');
 expect((await second.locator('.terminal-host').textContent()).match(/已断开会话/g)).toHaveLength(1);
 expect(await first.locator('.terminal-host').textContent()).toBe(firstTranscript);
 expect(errors).toEqual([]);await expect(page.locator('.error-banner')).toHaveCount(0);expect(await page.evaluate(()=>window.hornet.profiles.list())).toHaveLength(1);
 console.log('Disconnected terminals passed: real packet loss, hidden tabs, collapsed toolbar, both shared shells closed, retained output, disabled input/paste, timestamped transcript, actual error, full-screen recovery, deduplication, manual disconnect/reconnect and independent tab state.');
}finally{
 if(app)await app.evaluate(({app})=>app.exit(0)).catch(()=>{});
 await server.close();await rm(data,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
