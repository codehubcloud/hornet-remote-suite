import { dismissStartupSessions } from './session-dialog-helper.mjs';
import { _electron as electron,expect } from '@playwright/test';
import { mkdtemp,mkdir,readFile,rm } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
await mkdir('test-results',{recursive:true});
await build({entryPoints:['tests/fixtures/ssh-server.ts'],outfile:'test-results/terminal-tools-fixture.cjs',bundle:true,platform:'node',format:'cjs',external:['ssh2']});
const server=await createRequire(import.meta.url)(resolve('test-results/terminal-tools-fixture.cjs')).sshFixture();
const data=await mkdtemp(join(tmpdir(),'hornet-terminal-tools-')),output=join(data,'terminal.txt');
const env={...process.env,HORNET_USER_DATA:data,HORNET_SMOKE:'1'};delete env.ELECTRON_RUN_AS_NODE;
let app;
try{
 app=await electron.launch({args:['.'],env,timeout:30000});const page=await app.firstWindow();await dismissStartupSessions(page);page.setDefaultTimeout(15000);
 await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},output);
 const menu=async(group,item)=>{await page.getByRole('navigation',{name:'应用菜单'}).getByRole('button',{name:group,exact:true}).click();await page.getByRole('menuitem',{name:item,exact:true}).click();};
 await page.getByLabel('快速连接地址',{exact:true}).fill('tester@127.0.0.1:'+server.port);await page.locator('.quick-connect-bar').getByRole('button',{name:'连接',exact:true}).click();
 await page.getByLabel('名称',{exact:true}).fill('Terminal fixture');await page.getByRole('button',{name:'保存并连接',exact:true}).click();
 await page.getByLabel('认证信息',{exact:true}).fill('test-password');await page.getByRole('button',{name:'继续连接',exact:true}).click();await page.getByRole('button',{name:'已核对，信任此主机',exact:true}).click();
 await expect(page.locator('.terminal-host')).toBeVisible();
 await page.getByLabel('快速连接地址',{exact:true}).fill('Terminal fixture');await page.locator('.quick-connect-bar').getByRole('button',{name:'连接',exact:true}).click();await expect.poll(()=>server.shellCount).toBe(2);
 await menu('工具','快速命令管理器');const commands=page.getByRole('region',{name:'快速命令',exact:true});
 await commands.getByLabel('命令名称',{exact:true}).fill('Inspect shell');await commands.getByLabel('快速命令内容',{exact:true}).fill('echo tools-fixture\npwd');await commands.getByRole('button',{name:'保存命令',exact:true}).click();
 await commands.getByRole('button',{name:'发送并执行',exact:true}).click();await expect.poll(()=>server.shellInputs.find(([pid])=>pid===1002)?.[1]).toBe('echo tools-fixture\rpwd\r');
 if(server.shellInputs.some(([pid])=>pid===1001))throw new Error('Quick command reached the inactive shell');
 await menu('工具','选项…');const settings=page.getByRole('dialog',{name:'终端设置',exact:true});
 await settings.getByLabel('终端字号',{exact:true}).fill('18');await settings.getByLabel('终端配色',{exact:true}).selectOption('solarized');await settings.getByLabel('终端光标',{exact:true}).selectOption('bar');await settings.getByRole('button',{name:'应用设置',exact:true}).click();
 await expect(page.locator('.terminal-cell.selected .xterm-scrollable-element')).toHaveCSS('background-color','rgb(0, 43, 54)');
 if(server.shellCount!==2||server.authCount!==1)throw new Error('Settings recreated terminal sessions');
 await menu('编辑','到文本编辑器');await page.getByRole('menuitem',{name:'导出终端文本',exact:true}).click();await expect.poll(async()=>{try{return await readFile(output,'utf8');}catch{return '';}}).toContain('tools-fixture');
 await commands.getByRole('button',{name:'关闭快速命令',exact:true}).click();await menu('工具','快速命令管理器');await commands.getByLabel('已保存命令',{exact:true}).selectOption({label:'Inspect shell'});await expect(commands.getByLabel('快速命令内容',{exact:true})).toHaveValue('echo tools-fixture\npwd');
 await page.screenshot({path:'test-results/terminal-tools.png'});
 await commands.getByRole('button',{name:'关闭快速命令',exact:true}).click();
 await page.locator('.tabs').getByRole('button',{name:'关闭 Terminal fixture',exact:true}).first().click();await page.locator('.tabs').getByRole('button',{name:'关闭 Terminal fixture',exact:true}).click();
 await page.reload();await menu('工具','选项…');await expect(settings.getByLabel('终端字号',{exact:true})).toHaveValue('18');await expect(settings.getByLabel('终端配色',{exact:true})).toHaveValue('solarized');
 console.log('Terminal tools smoke passed: settings persist without shell restart, commands reach only selected shell, command restore, actual exported text.');
}catch(error){console.error(error);if(app)await (await app.firstWindow()).screenshot({path:'test-results/terminal-tools-failure.png'}).catch(()=>{});throw error;}
finally{if(app)await app.evaluate(({app})=>app.exit(0));await server.close();await rm(data,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
