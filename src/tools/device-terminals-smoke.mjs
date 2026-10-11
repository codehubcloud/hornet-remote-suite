import { dismissStartupSessions } from './session-dialog-helper.mjs';
import { _electron as electron,expect } from '@playwright/test';
import { mkdtemp,mkdir,readFile,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
await mkdir('test-results',{recursive:true});
const data=await mkdtemp(join(tmpdir(),'hornet-device-ui-')),logPath=join(data,'local.log');
const env={...process.env,HORNET_USER_DATA:data,HORNET_SMOKE:'1'};delete env.ELECTRON_RUN_AS_NODE;
let app;
try{
 app=await electron.launch({args:['.'],env,timeout:30000});const page=await app.firstWindow();await dismissStartupSessions(page);page.setDefaultTimeout(20000);
 await page.evaluate(()=>{window.deviceOutput={};window.deviceClosed=[];window.hornet.onEvent(e=>{if(e.type==='terminal.data')window.deviceOutput[e.terminalId]=(window.deviceOutput[e.terminalId]??'')+new TextDecoder().decode(new Uint8Array(e.data));if(e.type==='terminal.closed')window.deviceClosed.push(e.terminalId);});});
 await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},logPath);
 const menu=async(group,item)=>{await page.getByRole('navigation',{name:'应用菜单'}).getByRole('button',{name:group,exact:true}).click();await page.getByRole('menuitem',{name:item,exact:true}).click();};
 const output=id=>page.evaluate(id=>window.deviceOutput[id]??'',id);
 const execute=async command=>{await menu('工具','快速命令管理器');const panel=page.getByRole('region',{name:'快速命令',exact:true});await panel.getByLabel('快速命令内容',{exact:true}).fill(command);await panel.getByRole('button',{name:'发送并执行',exact:true}).click();await panel.getByRole('button',{name:'关闭快速命令',exact:true}).click();};
 await menu('文件','本地终端');let dialog=page.getByRole('dialog',{name:'本地终端',exact:true});await dialog.getByLabel('本地 Shell',{exact:true}).selectOption('powershell');await dialog.getByLabel('起始目录',{exact:true}).fill(data);await dialog.getByRole('button',{name:'打开终端',exact:true}).click();
 await expect(page.locator('.terminal-host')).toBeVisible();await expect(page.locator('.terminal-files')).toBeHidden();await expect(page.getByRole('button',{name:'打开文件',exact:true})).toBeDisabled();
 const ps=await page.locator('.terminal-cell').getAttribute('data-terminal-id');await expect.poll(()=>output(ps)).toContain('PS ');
 await menu('编辑','开始持续文本日志');await execute("Write-Output ('LOCAL_'+'POWER'); Write-Output ('中文'+'验证'); Write-Output ('PID_'+$PID)");
 await expect.poll(()=>output(ps)).toContain('LOCAL_POWER');await expect.poll(()=>output(ps)).toContain('中文验证');
 await execute("Write-Output ('BEGIN_'+'WAIT'); Start-Sleep -Seconds 30");await expect.poll(()=>output(ps)).toContain('BEGIN_WAIT');await page.locator('.terminal-cell.selected .xterm-helper-textarea').focus();await page.keyboard.press('Control+c');await execute("Write-Output ('AFTER_'+'BREAK')");await expect.poll(()=>output(ps)).toContain('AFTER_BREAK');
 const pid=Number((await output(ps)).match(/PID_(\d+)/)?.[1]);expect(pid).toBeGreaterThan(0);
 await menu('文件','本地终端');dialog=page.getByRole('dialog',{name:'本地终端',exact:true});await expect(dialog.getByLabel('起始目录',{exact:true})).toHaveValue(data);await dialog.getByLabel('本地 Shell',{exact:true}).selectOption('cmd');await dialog.getByRole('button',{name:'打开终端',exact:true}).click();
 await expect(dialog).toBeHidden();await expect(page.locator('.terminal-cell')).toHaveCount(2);
 const cmd=await page.locator('.terminal-cell.selected').getAttribute('data-terminal-id');expect(cmd).not.toBe(ps);await execute('echo CMD_^ONLY');await expect.poll(()=>output(cmd)).toContain('CMD_ONLY');expect(await output(ps)).not.toContain('CMD_ONLY');
 await page.locator('.tabs .tab').filter({hasText:'Windows PowerShell'}).click({button:'right'});await page.getByRole('menuitem',{name:'垂直分割',exact:true}).click();await expect(page.locator('.terminal-cell:visible')).toHaveCount(2);await expect(page.locator('[data-terminal-id="'+cmd+'"] .xterm-rows')).toContainText('CMD_ONLY');await expect.poll(()=>page.locator('[data-terminal-id="'+cmd+'"]').evaluate(root=>root.querySelector('.xterm-screen').getBoundingClientRect().width<=root.clientWidth)).toBe(true);
 await page.locator('[data-terminal-id="'+cmd+'"] .pane-heading').getByRole('button',{name:'命令提示符 CMD',exact:true}).click();await execute('echo SPLIT_^READY');
 await expect.poll(()=>page.locator('[data-terminal-id="'+cmd+'"]').evaluate(root=>Array.from(root.querySelectorAll('.xterm-rows>div')).some(row=>row.textContent.includes('SPLIT_READY')&&row.getBoundingClientRect().top>=root.getBoundingClientRect().top&&row.getBoundingClientRect().bottom<=root.getBoundingClientRect().bottom))).toBe(true);
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.screenshot({path:'test-results/local-terminals.png'});
 await page.locator('.tabs').getByRole('button',{name:'关闭 Windows PowerShell',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.hornet.terminalLogs.list())).toMatchObject([{state:'stopped'}]);await expect.poll(()=>{try{process.kill(pid,0);return true;}catch{return false;}}).toBe(false);
 expect(await readFile(logPath,'utf8')).toContain('LOCAL_POWER');await execute('echo STILL_^CMD');await expect.poll(()=>output(cmd)).toContain('STILL_CMD');
 await menu('文件','串口终端');dialog=page.getByRole('dialog',{name:'串口终端',exact:true});await expect(dialog.getByLabel('波特率',{exact:true})).toHaveValue('115200');await dialog.getByRole('button',{name:'刷新端口',exact:true}).click();await expect(dialog.getByRole('button',{name:'刷新端口',exact:true})).toBeEnabled();await expect(dialog.getByLabel('流控',{exact:true})).toBeVisible();await page.screenshot({path:'test-results/serial-settings.png'});await dialog.getByRole('button',{name:'取消',exact:true}).click();
 // No physical serial port is opened by this UI test.
 await execute('exit');await expect.poll(()=>page.evaluate(()=>window.deviceClosed)).toContain(cmd);await expect(page.locator('.terminal-address')).toContainText('已断开');await page.locator('.tabs').getByRole('button',{name:'关闭 命令提示符 CMD',exact:true}).click();
 expect(await page.evaluate(()=>window.hornet.profiles.list())).toEqual([]);expect((await page.evaluate(()=>window.hornet.layout.load())).profileIds).toEqual([]);
 await expect(page.getByRole('alert')).toHaveCount(0);
 console.log('Device desktop smoke passed: Electron native adapters, real PowerShell/CMD, UTF-8, separate sessions, split, local log, process cleanup, serial enumeration/form, no saved SSH profile pollution.');
}catch(error){if(app)await (await app.firstWindow()).screenshot({path:'test-results/device-terminals-failure.png'}).catch(()=>{});throw error;}
finally{if(app)await app.evaluate(({app})=>app.exit(0));await rm(data,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
