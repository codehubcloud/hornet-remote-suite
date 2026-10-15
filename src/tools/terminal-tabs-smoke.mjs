import { _electron as electron,expect } from '@playwright/test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp,mkdir,rm } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { dismissStartupSessions } from './session-dialog-helper.mjs';

await mkdir('test-results',{recursive:true});
await build({entryPoints:['tests/fixtures/ssh-server.ts'],outfile:'test-results/terminal-tabs-fixture.cjs',bundle:true,platform:'node',format:'cjs',external:['ssh2']});
const server=await createRequire(import.meta.url)(resolve('test-results/terminal-tabs-fixture.cjs')).sshFixture();
const data=await mkdtemp(join(tmpdir(),'hornet-terminal-tabs-'));
const env={...process.env,HORNET_USER_DATA:data,HORNET_SMOKE:'1'};delete env.ELECTRON_RUN_AS_NODE;
let executable=process.env.HORNET_PACKAGED_EXECUTABLE;
if(!executable&&process.argv.includes('--packaged'))executable=process.platform==='win32'?resolve('release/win-unpacked/Hornet Remote Suite.exe'):process.platform==='darwin'?resolve('release',process.arch==='arm64'?'mac-arm64':'mac','Hornet Remote Suite.app/Contents/MacOS/Hornet Remote Suite'):resolve('release',process.arch==='arm64'?'linux-arm64-unpacked':'linux-unpacked','hornet-remote-suite');
let app;
try{
 app=await electron.launch({...(executable?{executablePath:executable}:{}),args:executable?(process.platform==='linux'?['--no-sandbox']:[]):['.'],env,timeout:60000});
 const page=await app.firstWindow();page.setDefaultTimeout(20000);await dismissStartupSessions(page);
 await app.evaluate(({BrowserWindow})=>{for(const win of BrowserWindow.getAllWindows())win.webContents.setBackgroundThrottling(false);});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const quick=async text=>{await page.getByLabel('快速连接地址',{exact:true}).fill(text);await page.locator('.quick-connect-bar').getByRole('button',{name:'连接',exact:true}).click();};
 await quick('tester@127.0.0.1:'+server.port);
 await page.getByLabel('名称',{exact:true}).fill('Split fixture');await page.getByRole('button',{name:'保存并连接',exact:true}).click();
 await page.getByLabel('认证信息',{exact:true}).fill('test-password');await page.getByRole('button',{name:'继续连接',exact:true}).click();await page.getByRole('button',{name:'已核对，信任此主机',exact:true}).click();
 const first=page.locator('.terminal-cell').first(),second=page.locator('.terminal-cell').nth(1);
 await expect(first).toContainText('fixture ready');await quick('Split fixture');await expect(second).toContainText('fixture ready');
 const ids=await page.locator('.terminal-cell').evaluateAll(cells=>cells.map(cell=>{cell.__originalXterm=cell.querySelector('.xterm');return cell.dataset.terminalId;}));
 const tab=cell=>cell.locator('.tabs [data-tab-view-id]');
 const titleMenu=async(locator,item)=>{await locator.click({button:'right'});await page.getByRole('menuitem',{name:item,exact:true}).click();};
 const appMenu=async(group,item)=>{await page.getByRole('navigation',{name:'应用菜单'}).getByRole('button',{name:group,exact:true}).click();await page.getByRole('menuitem',{name:item,exact:true}).click();};
 await titleMenu(page.locator('.tabs [data-tab-view-id]').first(),'垂直分割');
 await expect(first.locator('.tabs')).toBeVisible();await expect(second.locator('.tabs')).toBeVisible();
 await expect(page.locator('.workspace>.tabs,.pane-heading')).toHaveCount(0);
 await expect(page.locator('.tabs [data-tab-view-id]')).toHaveCount(2);
 const checkIdentity=async()=>{expect(await page.locator('.terminal-cell').evaluateAll(cells=>cells.every(cell=>cell.__originalXterm===cell.querySelector('.xterm')))).toBe(true);expect(await page.locator('.terminal-cell').evaluateAll(cells=>cells.map(c=>c.dataset.terminalId))).toEqual(ids);expect(server.shellCount).toBe(2);expect(server.authCount).toBe(1);};
 const checkPaneHeader=async cell=>{const pane=await cell.boundingBox(),header=await cell.locator('.tabs').boundingBox();expect(Math.abs(header.y-pane.y)).toBeLessThan(1);expect(header.width).toBeCloseTo(pane.width,0);};
 await checkPaneHeader(first);await checkPaneHeader(second);
 const a=await first.boundingBox(),b=await second.boundingBox(),content=await page.locator('.content').boundingBox();expect(b.x).toBeGreaterThanOrEqual(a.x+a.width-1);expect(a.y).toBe(content.y);expect(b.y).toBe(content.y);
 await checkIdentity();
 await page.screenshot({path:'test-results/terminal-tab-groups-vertical.png'});
 await titleMenu(tab(second),'重命名终端');await page.getByLabel('终端标题',{exact:true}).fill('Secondary terminal');await page.getByRole('button',{name:'保存标题',exact:true}).click();await expect(tab(second)).toContainText('Secondary terminal');
 // Switching the focused split must still switch the directory browser.
 await page.getByRole('button',{name:'跟随终端',exact:true}).click();
 await first.locator('.xterm-helper-textarea').focus();await page.keyboard.type("cd '/tmp/space dir'");await page.keyboard.press('Enter');
 await expect(page.locator('.terminal-file-view:visible').getByLabel('远端路径',{exact:true})).toHaveValue('/tmp/space dir');
 await tab(second).locator('button').first().click();await expect(page.locator('.terminal-file-view:visible').getByLabel('远端路径',{exact:true})).toHaveValue('/');
 await first.getByRole('button',{name:'隐藏文件栏',exact:true}).click();await expect(page.locator('.terminal-files')).toBeHidden();await expect(first.getByRole('button',{name:'◈ 工作台',exact:true})).toBeVisible();await expect(page.locator('.tabs [data-tab-view-id]')).toHaveCount(2);await checkIdentity();
 await first.getByRole('button',{name:'显示文件栏',exact:true}).click();await expect(page.locator('.terminal-files>.tabs')).toBeVisible();
 await titleMenu(tab(second),'水平分割');await checkPaneHeader(first);await checkPaneHeader(second);const top=await first.boundingBox(),bottom=await second.boundingBox();expect(bottom.y).toBeGreaterThanOrEqual(top.y+top.height-1);await checkIdentity();
 const divider=page.getByRole('separator',{name:'调整终端分屏',exact:true});await divider.focus();await page.keyboard.press('ArrowDown');await expect(divider).toHaveAttribute('aria-valuenow','55');await checkIdentity();
 await page.screenshot({path:'test-results/terminal-tab-groups.png'});
 // Leaving the terminal workspace and returning must retain both pane tabs.
 await page.getByRole('button',{name:'◈ 工作台',exact:true}).click();await expect(page.locator('.workspace>.tabs')).toBeVisible();await page.locator('.workspace>.tabs [data-tab-view-id]').last().locator('button').first().click();await expect(second.locator('.tabs')).toBeVisible();await checkIdentity();
 await titleMenu(tab(second),'取消分屏');await expect(page.locator('.workspace>.tabs')).toBeVisible();await expect(page.locator('.terminal-cell>.tabs')).toHaveCount(0);await checkIdentity();
 await appMenu('窗口','垂直分割');await expect(page.locator('.terminal-cell>.tabs')).toHaveCount(2);await checkIdentity();
 await second.getByRole('button',{name:'关闭 Secondary terminal',exact:true}).click();await expect(page.locator('.terminal-cell')).toHaveCount(1);await expect(page.locator('.workspace>.tabs')).toBeVisible();await expect(first).toContainText('fixture ready');
 expect(await first.evaluate(cell=>cell.__originalXterm===cell.querySelector('.xterm'))).toBe(true);expect(await first.getAttribute('data-terminal-id')).toBe(ids[0]);expect(server.shellCount).toBe(2);
 expect(errors).toEqual([]);await expect(page.locator('.error-banner')).toHaveCount(0);
 console.log('Terminal pane tabs passed: top-aligned tab groups, both axes, rename, resize, active directory follow, hidden file bar, workspace switching, merge/close and unchanged live terminal instances.');
}catch(error){if(app)await (await app.firstWindow()).screenshot({path:'test-results/terminal-tabs-failure.png',timeout:5000}).catch(()=>{});throw error;}
finally{if(app)await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await server.close();await rm(data,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
