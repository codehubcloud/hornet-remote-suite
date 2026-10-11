import { dismissStartupSessions } from './session-dialog-helper.mjs';
import { _electron as electron,expect } from '@playwright/test';
import { mkdtemp,rm,mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const data=await mkdtemp(join(tmpdir(),'hornet-navigation-'));
const env={...process.env,HORNET_USER_DATA:data,HORNET_SMOKE:'1'};delete env.ELECTRON_RUN_AS_NODE;
await mkdir('test-results',{recursive:true});let app;
try{
 app=await electron.launch({args:['.'],env,timeout:30000});const page=await app.firstWindow();await dismissStartupSessions(page);page.setDefaultTimeout(15000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const menu=async(group,item)=>{await page.getByRole('navigation',{name:'应用菜单'}).getByRole('button',{name:group,exact:true}).click();await page.getByRole('menuitem',{name:item,exact:true}).click();};
 const home=page.getByRole('region',{name:'快速开始',exact:true});
 await expect(home).toBeVisible();await page.getByRole('button',{name:'主机列表',exact:true}).click();await expect(page.locator('.sidebar')).toBeHidden();await page.getByRole('button',{name:'主机列表',exact:true}).click();await expect(page.locator('.sidebar')).toBeVisible();await expect(page.getByRole('region',{name:'任务中心',exact:true})).toHaveCount(0);
 // Quick start uses the same validated address parser and does not connect without saving.
 await home.getByLabel('开始页连接地址').fill('ssh://demo@[::1]:2222');await home.getByRole('button',{name:'连接',exact:true}).click();
 await expect(page.getByLabel('主机',{exact:true})).toHaveValue('::1');await expect(page.getByLabel('端口',{exact:true})).toHaveValue('2222');await page.getByRole('button',{name:'取消',exact:true}).click();
 await page.getByRole('button',{name:'新建连接',exact:true}).click();await page.getByLabel('名称',{exact:true}).fill('Development');await page.getByLabel('主机',{exact:true}).fill('127.0.0.1');await page.getByLabel('用户名',{exact:true}).fill('demo');await page.getByRole('button',{name:'保存配置',exact:true}).click();
 const host=page.locator('.host').filter({hasText:'Development'});await expect(host).toBeVisible();expect((await host.boundingBox()).height).toBeLessThan(55);
 await host.focus();await page.keyboard.press('Shift+F10');await expect(page.getByRole('menuitem',{name:'打开终端',exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(host).toBeFocused();
 await host.click({button:'right'});await expect(page.getByRole('menuitem',{name:'新建子分组',exact:true})).toHaveCount(0);await page.getByRole('menuitem',{name:'复制连接',exact:true}).click();
 await expect(page.getByLabel('名称',{exact:true})).toHaveValue('Development 副本');await page.getByRole('button',{name:'保存配置',exact:true}).click();
 const saved=await page.evaluate(()=>window.hornet.profiles.list());expect(saved).toHaveLength(2);expect(new Set(saved.map(p=>p.profileId)).size).toBe(2);
 await page.screenshot({path:'test-results/compact-workbench.png'});
 await menu('工具','X11 图形应用');await page.getByLabel('X11 启动命令',{exact:true}).fill('xterm -ls');
 await page.getByRole('button',{name:'XDMCP 桌面',exact:true}).click();await expect(page.getByLabel('X11 启动命令',{exact:true})).toBeHidden();await page.getByLabel('XDMCP 服务器',{exact:true}).fill('192.168.1.50');
 await menu('工具','远程桌面');await page.getByLabel('VNC 目标',{exact:true}).fill('localhost');
 await menu('工具','X11 图形应用');await expect(page.locator('.tabs').getByRole('button',{name:'X11 图形应用',exact:true})).toHaveCount(1);await expect(page.getByLabel('XDMCP 服务器',{exact:true})).toHaveValue('192.168.1.50');
 await page.getByRole('button',{name:'图形应用',exact:true}).click();await expect(page.getByLabel('X11 启动命令',{exact:true})).toHaveValue('xterm -ls');await page.screenshot({path:'test-results/compact-x11.png'});
 await menu('工具','打印中心');await expect(page.getByLabel('打印队列名',{exact:true})).toBeHidden();await expect(page.getByRole('table')).toBeVisible();await page.screenshot({path:'test-results/compact-print.png'});
 await menu('帮助','功能支持情况');await expect(page.getByRole('region',{name:'功能支持情况',exact:true})).toContainText('FTP / FTPS');await menu('文件','关闭当前标签');await expect(home).toBeVisible();await menu('选项卡','下一个标签');await expect(page.getByLabel('X11 启动命令',{exact:true})).toBeVisible();
 await menu('文件','本地终端');await page.getByLabel('本地 Shell',{exact:true}).selectOption('cmd');await page.getByRole('button',{name:'打开终端',exact:true}).click();
 await expect(page.locator('.terminal-host:visible')).toBeVisible();await page.locator('.terminal-host:visible').click();await page.keyboard.type('echo NAV_KEEP_ALIVE');await page.keyboard.press('Enter');await expect(page.locator('.terminal-host:visible')).toContainText('NAV_KEEP_ALIVE');
 await menu('工具','端口转发');await menu('文件','关闭当前标签');await page.locator('.tabs').getByRole('button',{name:/CMD.*终端/}).first().click();await expect(page.locator('.terminal-host:visible')).toContainText('NAV_KEEP_ALIVE');
 await page.locator('.terminal-host:visible').click();await page.keyboard.type('echo STILL_RUNNING');await page.keyboard.press('Enter');await expect(page.locator('.terminal-host:visible')).toContainText('STILL_RUNNING');
 await page.locator('.tabs').getByRole('button',{name:'关闭 命令提示符 CMD',exact:true}).click();await expect(page.locator('.terminal-cell')).toHaveCount(0);
 expect(errors).toEqual([]);console.log('Workspace navigation passed: compact home, clone isolation, keyboard menus, focused tools, retained forms and live terminal.');
}catch(error){if(app)await (await app.firstWindow()).screenshot({path:'test-results/navigation-failure.png',timeout:5000}).catch(()=>{});throw error;}
finally{if(app)await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await rm(data,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
