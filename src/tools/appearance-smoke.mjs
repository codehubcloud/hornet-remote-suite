import { dismissStartupSessions } from './session-dialog-helper.mjs';
import { _electron as electron,expect } from '@playwright/test';
import { mkdtemp,rm,mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const data=await mkdtemp(join(tmpdir(),'hornet-appearance-'));
const env={...process.env,HORNET_USER_DATA:data,HORNET_SMOKE:'1'};delete env.ELECTRON_RUN_AS_NODE;
await mkdir('test-results',{recursive:true});let app;
try{
 app=await electron.launch({args:['.'],env,timeout:30000});const page=await app.firstWindow();await dismissStartupSessions(page);page.setDefaultTimeout(15000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const menu=async(group,item)=>{await page.locator('.reference-menubar').getByRole('button',{name:group,exact:true}).click();await page.getByRole('menuitem',{name:item,exact:true}).click();};
 await expect(page.locator('html')).toHaveAttribute('data-theme','light');
 await page.keyboard.press('Alt+f');await expect(page.getByRole('menuitem',{name:'新建…',exact:true})).toBeFocused();await expect(page.getByRole('menuitem',{name:'重新连接',exact:true})).toBeDisabled();
 await page.keyboard.press('Escape');await expect(page.locator('.reference-menubar').getByRole('button',{name:'文件',exact:true})).toBeFocused();
 await menu('查看','主题');await expect(page.getByRole('menu',{name:'主题',exact:true})).toBeVisible();await page.keyboard.press('ArrowLeft');await expect(page.getByRole('menuitem',{name:'主题',exact:true})).toBeFocused();await page.keyboard.press('ArrowRight');await page.getByRole('menuitem',{name:'经典浅色',exact:true}).click();
 await page.getByRole('button',{name:'语言与主题',exact:true}).click();await page.getByLabel('界面语言',{exact:true}).selectOption('en');
 await expect(page.locator('html')).toHaveAttribute('lang','en');
 const dialog=page.getByRole('dialog',{name:'Language and theme',exact:true});await expect(dialog).toBeVisible();
 const colors=new Set();
 for(const theme of ['light','dark','solarized','contrast']){
  await dialog.getByLabel('Interface theme',{exact:true}).selectOption(theme);await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
  colors.add(await page.locator('html').evaluate(e=>getComputedStyle(e).backgroundColor));await page.screenshot({path:`test-results/appearance-${theme}.png`});
 }
 expect(colors.size).toBe(4);
 await dialog.getByLabel('Interface theme',{exact:true}).selectOption('system');await page.emulateMedia({colorScheme:'dark'});await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await page.emulateMedia({colorScheme:'light'});await expect(page.locator('html')).toHaveAttribute('data-theme','light');
 await dialog.getByRole('button',{name:'Close',exact:true}).click();
 await page.keyboard.press('Alt+f');await page.screenshot({path:'test-results/appearance-english-menu.png'});await page.keyboard.press('Escape');
 const home=page.getByRole('region',{name:'Quick start',exact:true});await expect(home).toBeVisible();expect(await home.innerText()).not.toMatch(/[\u3400-\u9fff]/);
 await page.reload();await expect(page.locator('html')).toHaveAttribute('lang','en');
 await menu('File','New…');await page.getByLabel('Name',{exact:true}).fill('文件');await page.getByLabel('Host',{exact:true}).fill('127.0.0.1');await page.getByLabel('Username',{exact:true}).fill('demo');await page.getByRole('button',{name:'Save configuration',exact:true}).click();
 await expect(page.locator('.host')).toContainText('文件');expect((await page.evaluate(()=>window.hornet.profiles.list()))[0].name).toBe('文件');
 await menu('File','Recent sessions');await expect(page.getByRole('menuitem',{name:'No sessions',exact:true})).toBeDisabled();await page.keyboard.press('Escape');await page.keyboard.press('Escape');
 await menu('Tools','Print center');await expect(page.locator('.reference-menubar').getByRole('button',{name:'Queue',exact:true})).toBeVisible();await menu('File','New queue');await expect(page.getByLabel('Print queue name',{exact:true})).toBeVisible();
 await page.locator('.tabs').getByRole('button',{name:'◈ Workspace',exact:true}).click();await menu('File','Local terminal');
 await page.getByLabel('Local shell',{exact:true}).selectOption('cmd');await page.getByRole('button',{name:'Open terminal',exact:true}).click();
 const terminal=page.locator('.terminal-cell.selected'),id=await terminal.getAttribute('data-terminal-id');await expect(terminal).toBeVisible();
 await terminal.locator('.xterm-helper-textarea').focus();await page.keyboard.type('echo THEME_^ALIVE');await page.keyboard.press('Enter');await expect(terminal).toContainText('THEME_ALIVE');
 // Stub Electron's clipboard to avoid touching the user's OS clipboard.
 await app.evaluate(({clipboard})=>{let value='echo CLIP_^READY';clipboard.readText=()=>value;clipboard.writeText=text=>{value=text;};});
 await menu('Edit','Paste');await terminal.locator('.xterm-helper-textarea').focus();await page.keyboard.press('Enter');await expect(terminal).toContainText('CLIP_READY');
 await page.getByRole('button',{name:'Language and theme',exact:true}).click();await dialog.getByLabel('Interface theme',{exact:true}).selectOption('dark');await dialog.getByLabel('Interface language',{exact:true}).selectOption('zh-CN');await page.getByRole('dialog',{name:'语言与主题',exact:true}).getByRole('button',{name:'关闭',exact:true}).click();
 await expect(terminal).toHaveAttribute('data-terminal-id',id);await expect(terminal).toContainText('THEME_ALIVE');await terminal.locator('.xterm-helper-textarea').focus();await page.keyboard.type('echo STILL_^ALIVE');await page.keyboard.press('Enter');await expect(terminal).toContainText('STILL_ALIVE');
 await page.keyboard.press('Alt+d');await expect(page.getByLabel('快速连接地址',{exact:true})).toBeFocused();
 await page.keyboard.press('Control+Shift+F4');await expect(page.locator('.terminal-cell')).toHaveCount(0);
 await page.getByRole('button',{name:'折叠工具栏',exact:true}).click();await page.keyboard.press('Alt+f');await expect(page.getByRole('menuitem',{name:'新建…',exact:true})).toBeVisible();await page.keyboard.press('Escape');
 await menu('帮助','关于 Hornet');await expect(page.getByRole('dialog',{name:'关于 Hornet',exact:true})).toContainText('0.1.0');await page.getByRole('dialog',{name:'关于 Hornet',exact:true}).getByRole('button',{name:'关闭',exact:true}).click();
 await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await expect(page.locator('html')).toHaveAttribute('lang','zh-CN');
 expect(errors).toEqual([]);console.log('Appearance smoke passed: keyboard menus/submenus, four palettes, system theme, persistent bilingual UI, literal user data, print context, clipboard and live terminal continuity.');
}catch(error){if(app)await (await app.firstWindow()).screenshot({path:'test-results/appearance-failure.png',timeout:5000}).catch(()=>{});throw error;}
finally{if(app)await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await rm(data,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
