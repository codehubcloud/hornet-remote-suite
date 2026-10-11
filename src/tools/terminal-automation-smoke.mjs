import { _electron as electron,expect } from '@playwright/test';
import { mkdtemp,mkdir,rm } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { dismissStartupSessions } from './session-dialog-helper.mjs';
await mkdir('test-results',{recursive:true});
await build({entryPoints:['tests/fixtures/ssh-server.ts'],outfile:'test-results/automation-fixture.cjs',bundle:true,platform:'node',format:'cjs',external:['ssh2']});
const server=await createRequire(import.meta.url)(resolve('test-results/automation-fixture.cjs')).sshFixture();
const data=await mkdtemp(join(tmpdir(),'hornet-automation-')),env={...process.env,HORNET_USER_DATA:data,HORNET_SMOKE:'1'};delete env.ELECTRON_RUN_AS_NODE;
let app;
try{
 app=await electron.launch({args:['.'],env,timeout:30000});const page=await app.firstWindow();page.setDefaultTimeout(15000);await dismissStartupSessions(page);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const menu=async(group,item)=>{await page.locator('.reference-menubar').getByRole('button',{name:group,exact:true}).click();await page.getByRole('menuitem',{name:item,exact:true}).click();};
 const quick=async(address)=>{await page.getByLabel('快速连接地址',{exact:true}).fill(address);await page.locator('.quick-connect-bar').getByRole('button',{name:'连接',exact:true}).click();};
 await quick('tester@127.0.0.1:'+server.port);await page.getByLabel('名称',{exact:true}).fill('Encoded');await page.getByLabel('字符编码',{exact:true}).selectOption('gbk');await page.getByRole('button',{name:'保存并连接',exact:true}).click();
 await page.getByLabel('认证信息',{exact:true}).fill('test-password');await page.getByRole('button',{name:'继续连接',exact:true}).click();await page.getByRole('button',{name:'已核对，信任此主机',exact:true}).click();await expect(page.locator('.terminal-cell')).toHaveCount(1);
 await quick('Encoded');await expect(page.locator('.terminal-cell')).toHaveCount(2);
 await menu('工具','脚本');const script=page.getByRole('dialog',{name:'脚本管理器',exact:true});
 await script.getByLabel('脚本名称',{exact:true}).fill('中文脚本');await script.getByLabel('步骤文本',{exact:true}).nth(0).fill('中文');await script.getByLabel('步骤文本',{exact:true}).nth(1).fill('echo:中文');
 await script.getByRole('button',{name:'添加步骤',exact:true}).click();await script.getByLabel('步骤类型',{exact:true}).nth(2).selectOption('delay');await script.getByLabel('延时（毫秒）',{exact:true}).fill('100');
 await script.getByRole('button',{name:'添加步骤',exact:true}).click();await script.getByLabel('步骤文本',{exact:true}).nth(2).fill('SCRIPT_DONE');await script.getByRole('button',{name:'保存',exact:true}).click();
 await script.getByRole('button',{name:'运行脚本',exact:true}).click();await expect(script.getByRole('status')).toContainText('执行完成 · 4/4');await expect(page.locator('.terminal-cell.selected')).toContainText('SCRIPT_DONE');
 expect(server.shellBytes).toHaveLength(1);expect(server.shellBytes[0][1].toString('hex')).toBe('d6d0cec40d'+Buffer.from('SCRIPT_DONE\r').toString('hex'));
 await page.screenshot({path:'test-results/terminal-automation.png'});await script.getByRole('button',{name:'关闭',exact:true}).click();
 await menu('查看','脚本管理器');await script.getByLabel('已保存脚本',{exact:true}).selectOption('中文脚本');await expect(script.getByLabel('步骤文本',{exact:true}).nth(0)).toHaveValue('中文');
 await script.getByLabel('已保存脚本',{exact:true}).selectOption('');await script.getByLabel('脚本名称',{exact:true}).fill('timeout');await script.getByLabel('步骤类型',{exact:true}).nth(0).selectOption('wait');await script.getByLabel('步骤文本',{exact:true}).nth(0).fill('NEVER_MATCH');await script.getByLabel('超时（毫秒）',{exact:true}).nth(0).fill('100');
 await script.getByRole('button',{name:'运行脚本',exact:true}).click();await expect(script.getByRole('status')).toContainText('等待输出超时');
 await script.getByLabel('步骤类型',{exact:true}).nth(0).selectOption('delay');await script.getByLabel('延时（毫秒）',{exact:true}).fill('300000');await script.getByLabel('步骤类型',{exact:true}).nth(1).selectOption('send');await script.getByLabel('步骤文本',{exact:true}).fill('NEVER_SEND');
 const before=server.shellBytes[0][1].toString('hex');await script.getByRole('button',{name:'运行脚本',exact:true}).click();await expect(script.getByRole('status')).toContainText('正在执行');await script.getByRole('button',{name:'停止脚本',exact:true}).click();await expect(script.getByRole('status')).toContainText('脚本已停止');expect(server.shellBytes[0][1].toString('hex')).toBe(before);
 await script.getByRole('button',{name:'关闭',exact:true}).click();
 await menu('工具','终端编码');const encoding=page.getByRole('dialog',{name:'终端编码',exact:true});await expect(encoding.getByLabel('字符编码',{exact:true})).toHaveValue('gbk');await encoding.getByLabel('字符编码',{exact:true}).selectOption('utf8');await encoding.getByRole('button',{name:'应用设置',exact:true}).click();
 await page.locator('.terminal-cell.selected .xterm-helper-textarea').focus();await page.keyboard.insertText('切换');await expect(page.locator('.terminal-cell.selected')).toContainText('echo:切换');expect(server.shellBytes[0][1].subarray(-6).toString()).toBe('切换');
 // Starting a new transport uses the saved encoding, not the temporary override.
 await menu('文件','重新连接');await expect.poll(()=>server.shellCount).toBe(3);await menu('工具','终端编码');await expect(encoding.getByLabel('字符编码',{exact:true})).toHaveValue('gbk');await encoding.getByRole('button',{name:'取消',exact:true}).click();
 await menu('工具','脚本');await script.getByLabel('脚本名称',{exact:true}).fill('disconnect');await script.getByLabel('步骤类型',{exact:true}).nth(0).selectOption('delay');await script.getByLabel('延时（毫秒）',{exact:true}).fill('300000');await script.getByRole('button',{name:'运行脚本',exact:true}).click();
 const id=await page.locator('.terminal-cell.selected').getAttribute('data-terminal-id');await page.evaluate(id=>window.hornet.terminal.close(id),id);await expect(script.getByRole('status')).toContainText('脚本已停止');await expect(script.getByRole('button',{name:'运行脚本',exact:true})).toBeDisabled();expect(errors).toEqual([]);
 console.log('Terminal automation passed: saved GBK session, isolated script send/wait/delay, persistence, timeout/cancel/close, runtime encoding switch and reconnect reset.');
}catch(error){if(app)await (await app.firstWindow()).screenshot({path:'test-results/automation-failure.png',timeout:5000}).catch(()=>{});throw error;}
finally{if(app)await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await server.close();await rm(data,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
