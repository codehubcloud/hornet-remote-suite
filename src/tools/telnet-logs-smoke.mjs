import { dismissStartupSessions } from './session-dialog-helper.mjs';
import { _electron as electron,expect } from '@playwright/test';
import { mkdtemp,mkdir,readFile,rm } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
await mkdir('test-results',{recursive:true});
await build({entryPoints:['tests/fixtures/telnet-server.ts'],outfile:'test-results/telnet-ui-fixture.cjs',bundle:true,platform:'node',format:'cjs'});
const server=await createRequire(import.meta.url)(resolve('test-results/telnet-ui-fixture.cjs')).telnetFixture();
const data=await mkdtemp(join(tmpdir(),'hornet-telnet-ui-')),plain=join(data,'plain.log'),raw=join(data,'raw.log');
const env={...process.env,HORNET_USER_DATA:data,HORNET_SMOKE:'1'};delete env.ELECTRON_RUN_AS_NODE;
let app;
try{
 app=await electron.launch({args:['.'],env,timeout:30000});const page=await app.firstWindow();await dismissStartupSessions(page);page.setDefaultTimeout(15000);
 await app.evaluate(({dialog},paths)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:paths.shift()});},[plain,raw]);
 const menu=async(group,item)=>{await page.getByRole('navigation',{name:'应用菜单'}).getByRole('button',{name:group,exact:true}).click();await page.getByRole('menuitem',{name:item,exact:true}).click();};
 await page.getByLabel('快速连接地址',{exact:true}).fill('telnet://127.0.0.1:'+server.port);await page.locator('.quick-connect-bar').getByRole('button',{name:'连接',exact:true}).click();
 await expect(page.getByLabel('连接协议',{exact:true})).toHaveValue('telnet');await page.getByLabel('名称',{exact:true}).fill('Telnet fixture');await page.getByRole('button',{name:'保存并连接',exact:true}).click();
 await expect(page.locator('.terminal-host')).toBeVisible();await expect(page.getByLabel('认证信息',{exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'打开文件',exact:true})).toBeDisabled();await expect(page.locator('.terminal-files')).toBeHidden();await expect(page.getByRole('region',{name:'任务中心',exact:true})).toBeVisible();
 await expect.poll(()=>server.peers[0]?.terminalType).toBe('XTERM-256COLOR');
 const profiles=await page.evaluate(()=>window.hornet.profiles.list());if(profiles[0]?.protocol!=='telnet')throw new Error('Telnet protocol was not persisted');
 await menu('编辑','开始持续文本日志');await expect(page.getByRole('button',{name:'停止终端日志',exact:true})).toBeVisible();
 await page.getByLabel('快速连接地址',{exact:true}).fill('Telnet fixture');await page.locator('.quick-connect-bar').getByRole('button',{name:'连接',exact:true}).click();await expect.poll(()=>server.peers.length).toBe(2);
 await menu('编辑','开始原始终端日志');await expect.poll(()=>page.evaluate(async()=>(await window.hornet.terminalLogs.list()).filter(l=>l.state==='recording').length)).toBe(2);
 server.peers[0].socket.write('\x1b[31mFIRST_HIDDEN\x1b[0m\r\n');server.peers[1].socket.write('\x1b[32mSECOND_RAW\x1b[0m\r\n');
 await menu('工具','快速命令管理器');const commands=page.getByRole('region',{name:'快速命令',exact:true});await commands.getByLabel('快速命令内容',{exact:true}).fill('echo selected');await commands.getByRole('button',{name:'发送并执行',exact:true}).click();await expect.poll(()=>server.peers[1].input.toString()).toBe('echo selected\r');if(server.peers[0].input.length)throw new Error('Command reached inactive Telnet session');await commands.getByRole('button',{name:'关闭快速命令',exact:true}).click();
 const tabs=page.locator('.tabs .tab').filter({hasText:'Telnet fixture'});await tabs.first().click({button:'right'});await page.getByRole('menuitem',{name:'垂直分割',exact:true}).click();await expect(page.locator('.terminal-cell:visible')).toHaveCount(2);await page.screenshot({path:'test-results/telnet-split.png'});
 await page.locator('.tabs').getByRole('button',{name:'关闭 Telnet fixture',exact:true}).first().click();await expect.poll(()=>page.evaluate(async()=>(await window.hornet.terminalLogs.list()).filter(l=>l.state==='stopped').length)).toBe(1);
 await page.getByRole('button',{name:'停止终端日志',exact:true}).click();await expect.poll(()=>page.evaluate(async()=>(await window.hornet.terminalLogs.list()).filter(l=>l.state==='stopped').length)).toBe(2);
 expect(await readFile(plain,'utf8')).toBe('FIRST_HIDDEN\r\n');const bytes=await readFile(raw);expect(bytes.includes(Buffer.from('\x1b[32mSECOND_RAW\x1b[0m'))).toBe(true);expect(bytes.toString()).toContain('echo selected');
 server.peers[1].socket.write('AFTER_STOP\r\n');await page.getByRole('button',{name:'搜索终端',exact:true}).click();await page.getByLabel('搜索终端内容',{exact:true}).fill('AFTER_STOP');await page.getByRole('button',{name:'下一个',exact:true}).click();await expect(page.getByText('已定位匹配',{exact:true})).toBeVisible();expect(await readFile(raw)).toEqual(bytes);
 await menu('编辑','终端日志管理');await expect(page.getByRole('dialog',{name:'终端日志管理',exact:true})).toContainText('已停止');await page.screenshot({path:'test-results/terminal-logs.png'});await page.getByRole('button',{name:'关闭日志管理',exact:true}).click();
 const oldTerminal=await page.locator('.terminal-cell.selected').getAttribute('data-terminal-id');await menu('文件','重新连接');await expect.poll(()=>server.peers.length).toBe(3);await expect(page.locator('.terminal-cell')).toHaveCount(1);await expect(page.locator('.terminal-cell.selected')).not.toHaveAttribute('data-terminal-id',oldTerminal);await page.locator('.terminal-cell.selected .xterm-helper-textarea').focus();await page.keyboard.insertText('TELNET_RECONNECTED');await page.keyboard.press('Enter');await expect.poll(()=>server.peers[2].input.toString()).toBe('TELNET_RECONNECTED\r');
 await page.locator('.tabs').getByRole('button',{name:'关闭 Telnet fixture',exact:true}).click();await page.reload();const restored=await page.evaluate(()=>window.hornet.profiles.list());if(restored[0]?.protocol!=='telnet')throw new Error('Protocol lost on reload');
 console.log('Telnet/logs desktop smoke passed: saved profiles, no SSH auth/SFTP, independent panes, selected command, hidden-pane recording, text/raw bytes, auto-stop, stop preserves terminal.');
}catch(error){console.error(error);if(app)await (await app.firstWindow()).screenshot({path:'test-results/telnet-logs-failure.png'}).catch(()=>{});throw error;}
finally{if(app)await app.evaluate(({app})=>app.exit(0));await server.close();await rm(data,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
