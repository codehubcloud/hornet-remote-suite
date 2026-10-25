import { _electron as electron,expect } from '@playwright/test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp,mkdir,rm } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { tmpdir } from 'node:os';
import { dismissStartupSessions } from './session-dialog-helper.mjs';
await mkdir('test-results',{recursive:true});await build({entryPoints:['tests/fixtures/ssh-server.ts'],outfile:'test-results/session-confirm-fixture.cjs',bundle:true,platform:'node',format:'cjs',external:['ssh2']});
const server=await createRequire(import.meta.url)(resolve('test-results/session-confirm-fixture.cjs')).sshFixture(),data=await mkdtemp(join(tmpdir(),'hornet-confirm-'));
const env={...process.env,HORNET_USER_DATA:data,HORNET_SMOKE:'1'};delete env.ELECTRON_RUN_AS_NODE;let app;
try{
 app=await electron.launch({args:process.platform==='linux'?['--no-sandbox','.']:['.'],env,timeout:60000});const page=await app.firstWindow();page.setDefaultTimeout(20000);await dismissStartupSessions(page);
 let accept=false;const prompts=[],errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',async dialog=>{prompts.push(dialog.message());if(accept)await dialog.accept();else await dialog.dismiss();});
 await page.getByLabel('快速连接地址',{exact:true}).fill('tester@127.0.0.1:'+server.port);await page.locator('.quick-connect-bar').getByRole('button',{name:'连接',exact:true}).click();await page.getByLabel('名称',{exact:true}).fill('Confirm fixture');await page.getByRole('button',{name:'保存并连接',exact:true}).click();await page.getByLabel('认证信息',{exact:true}).fill('test-password');await page.getByRole('button',{name:'继续连接',exact:true}).click();await page.getByRole('button',{name:'已核对，信任此主机',exact:true}).click();
 const cell=page.locator('.terminal-cell');await expect(cell).toContainText('fixture ready');
 const tab=page.locator('[data-tab-view-id]').filter({has:page.getByRole('button',{name:'>_ Confirm fixture · 终端',exact:true})});
 await page.getByRole('button',{name:'关闭 Confirm fixture',exact:true}).click();expect(prompts.at(-1)).toContain('127.0.0.1:'+server.port);expect(prompts.at(-1)).toContain('断开并关闭这个标签');await expect(cell.locator('.terminal-disconnected')).toHaveCount(0);await expect(tab).toBeVisible();
 await page.keyboard.press('Control+Shift+F4');expect(prompts).toHaveLength(2);await expect(cell).toBeVisible();
 await page.getByRole('button',{name:'断开',exact:true}).click();expect(prompts.at(-1)).toContain('断开这个会话');await expect(cell.locator('.terminal-disconnected')).toHaveCount(0);await cell.locator('.terminal-host').click();await page.keyboard.type('still-connected');await expect.poll(()=>server.shellInputs[0]?.[1]).toContain('still-connected');
 accept=true;await page.getByRole('button',{name:'断开',exact:true}).click();await expect(cell.locator('.terminal-disconnected')).toBeVisible();const count=prompts.length;
 await page.getByRole('button',{name:'关闭 Confirm fixture',exact:true}).click();await expect(cell).toHaveCount(0);expect(prompts).toHaveLength(count);
 // Connect again and exercise the title menu's close path.
 await page.getByLabel('快速连接地址',{exact:true}).fill('Confirm fixture');await page.locator('.quick-connect-bar').getByRole('button',{name:'连接',exact:true}).click();
 const auth=page.getByLabel('认证信息',{exact:true});await expect.poll(async()=>await auth.isVisible()||(await cell.textContent().catch(()=>''))?.includes('fixture ready')).toBeTruthy();if(await auth.isVisible()){await auth.fill('test-password');await page.getByRole('button',{name:'继续连接',exact:true}).click();}await expect(cell).toContainText('fixture ready');
 await page.getByRole('button',{name:'>_ Confirm fixture · 终端',exact:true}).click({button:'right'});await page.getByRole('menu',{name:'终端标题菜单',exact:true}).getByRole('menuitem',{name:'关闭',exact:true}).click();await expect(cell).toHaveCount(0);expect(prompts.at(-1)).toContain('断开并关闭这个标签');
 expect(errors).toEqual([]);await expect(page.locator('.error-banner')).toHaveCount(0);console.log('Session confirmation passed: close button, shortcut, toolbar, title menu, cancellation preserves live input, accepted disconnect and closed-tab cleanup.');
}catch(error){if(app)await(await app.firstWindow()).screenshot({path:'test-results/session-confirm-failure.png'}).catch(()=>{});throw error;}
finally{if(app)await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await server.close();await rm(data,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
