import { _electron as electron,expect } from '@playwright/test';
import { mkdtemp,rm,mkdir } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { dismissStartupSessions } from './session-dialog-helper.mjs';

const data=await mkdtemp(join(tmpdir(),'hornet-titlebar-'));
const env={...process.env,HORNET_USER_DATA:data,HORNET_SMOKE:'1'};delete env.ELECTRON_RUN_AS_NODE;
let executable=process.env.HORNET_PACKAGED_EXECUTABLE;
if(!executable&&process.argv.includes('--packaged'))executable=process.platform==='win32'?resolve('release/win-unpacked/Hornet Remote Suite.exe'):process.platform==='darwin'?resolve('release',process.arch==='arm64'?'mac-arm64':'mac','Hornet Remote Suite.app/Contents/MacOS/Hornet Remote Suite'):resolve('release',process.arch==='arm64'?'linux-arm64-unpacked':'linux-unpacked','hornet-remote-suite');
await mkdir('test-results',{recursive:true});let app;
try{
 app=await electron.launch({...(executable?{executablePath:executable}:{}),args:executable?(process.platform==='linux'?['--no-sandbox']:[]):process.platform==='linux'?['--no-sandbox','.']:['.'],env,timeout:60000});
 const page=await app.firstWindow();page.setDefaultTimeout(15000);await dismissStartupSessions(page);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await app.evaluate(({BrowserWindow})=>{
  const win=BrowserWindow.getAllWindows()[0];win.showInactive();
  if(typeof win.setTitleBarOverlay==='function'){
   const original=win.setTitleBarOverlay.bind(win);
   win.setTitleBarOverlay=options=>{globalThis.__titlebarColors=options;original(options);};
  }
 });
 if(process.platform!=='linux'){
  await page.getByRole('navigation',{name:'应用菜单'}).getByRole('button',{name:'查看',exact:true}).click();await page.getByRole('menuitem',{name:'全屏',exact:true}).click();
  await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isFullScreen())).toBe(true);
  await page.keyboard.press('Escape');await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isFullScreen())).toBe(false);
  await page.keyboard.press('F11');await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isFullScreen())).toBe(true);
  await page.keyboard.press('F11');await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isFullScreen())).toBe(false);
 }
 await page.getByRole('navigation',{name:'应用菜单'}).getByRole('button',{name:'查看',exact:true}).click();await page.getByRole('menuitem',{name:'十六进制查看器',exact:true}).click();
 const hex=page.getByRole('dialog',{name:'十六进制查看器',exact:true});await hex.locator('input[type=file]').setInputFiles({name:'binary.dat',mimeType:'application/octet-stream',buffer:Buffer.from([0,65,127,255,...Array(4096).fill(66)])});
 await expect(hex.locator('pre')).toContainText('00 41 7f ff');await hex.getByRole('button',{name:'下一个',exact:true}).click();await expect(hex.locator('pre')).toContainText('00001000');await hex.getByRole('button',{name:'关闭',exact:true}).click();
 const bar=page.locator('.app-titlebar'),menu=bar.locator('.reference-menubar');
 await expect(bar).toBeVisible();expect((await bar.boundingBox()).y).toBe(0);
 if(process.platform==='win32')await expect.poll(()=>page.evaluate(()=>navigator.windowControlsOverlay?.visible)).toBe(true);
 expect(await bar.innerText()).not.toContain('Hornet Remote Suite');
 await expect(bar).toHaveCSS('-webkit-app-region','drag');await expect(menu).toHaveCSS('-webkit-app-region','no-drag');
 const logo=bar.locator('img');await expect.poll(()=>logo.evaluate(img=>img.complete&&img.naturalWidth)).toBe(256);
 const artwork=await logo.evaluate(img=>{const c=document.createElement('canvas');c.width=c.height=256;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);const data=ctx.getImageData(0,0,256,256).data;let left=256,top=256,right=-1,bottom=-1;for(let y=0;y<256;y++)for(let x=0;x<256;x++)if(data[(y*256+x)*4+3]>=128){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}return {cornerAlpha:data[3],width:right-left+1,height:bottom-top+1};});
 expect(artwork.cornerAlpha).toBe(0);expect(Math.max(artwork.width,artwork.height)).toBeGreaterThanOrEqual(230);
 const metrics=await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];return {outer:w.getBounds().height,inner:w.getContentBounds().height};});
 expect(metrics.outer-metrics.inner).toBeLessThan(20);
 await page.getByRole('button',{name:'语言与主题',exact:true}).click();
 const settings=page.locator('.appearance-dialog');
 for(const theme of ['light','dark','github-light','github-dark','vscode-light','vscode-dark','visual-studio-blue','contrast','system']){
  await settings.locator('select').nth(1).selectOption(theme);
  if(process.platform!=='darwin'){
   const expected=await bar.evaluate(node=>{const hex=value=>'#'+value.match(/\d+/g).slice(0,3).map(n=>Number(n).toString(16).padStart(2,'0')).join('');return {color:hex(getComputedStyle(node).backgroundColor),symbolColor:hex(getComputedStyle(node.querySelector('button')).color),height:36};});
   await expect.poll(()=>app.evaluate(()=>globalThis.__titlebarColors)).toEqual(expected);
  }
 }
 await settings.locator('select').nth(1).selectOption('vscode-dark');await settings.locator('.modal-actions button').click();
 await page.screenshot({path:'test-results/titlebar-vscode-dark.png'});
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1024,720));
 // Windows applies its minimum non-client size and DPI rounding as well.
 await expect.poll(()=>page.evaluate(()=>innerWidth)).toBeLessThan(1100);
 const safe=await page.locator('.titlebar-content').boundingBox(),menus=await menu.boundingBox(),drag=await page.locator('.titlebar-drag-space').boundingBox();
 expect(menus.x+menus.width).toBeLessThanOrEqual(safe.x+safe.width-35);expect(drag.width).toBeGreaterThanOrEqual(35);
 await menu.getByRole('button',{name:'文件',exact:true}).click();await expect(page.getByRole('menuitem',{name:'新建…',exact:true})).toBeVisible();await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'折叠工具栏',exact:true}).click();await expect(bar).toBeVisible();await expect(page.locator('.standard-toolbar')).toBeHidden();
 await menu.getByRole('button',{name:'帮助',exact:true}).click();await page.getByRole('menuitem',{name:'关于 Hornet',exact:true}).click();await expect(page.getByRole('dialog',{name:'关于 Hornet',exact:true})).toBeVisible();await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();
 if(process.platform!=='linux'){
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].maximize());await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isMaximized())).toBe(true);await expect(bar).toBeVisible();
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].unmaximize());await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isMaximized())).toBe(false);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].minimize());await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isMinimized())).toBe(true);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].restore());await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isMinimized())).toBe(false);
 }
 await page.keyboard.press('Alt+f');await expect(page.getByRole('menuitem',{name:'新建…',exact:true})).toBeVisible();await page.keyboard.press('Escape');
 expect(errors).toEqual([]);console.log('Title bar passed: transparent logo, integrated menus, theme-matched native controls, safe resize, collapse and native window states.');
}catch(error){if(app)await (await app.firstWindow()).screenshot({path:'test-results/titlebar-failure.png',timeout:5000}).catch(()=>{});throw error;}
finally{if(app)await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await rm(data,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
