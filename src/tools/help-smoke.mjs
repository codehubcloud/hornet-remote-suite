import { _electron as electron,expect as baseExpect } from '@playwright/test';
import { mkdtemp,rm,mkdir,readFile } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { dismissStartupSessions } from './session-dialog-helper.mjs';
const expect=baseExpect.configure({timeout:25000});
const data=await mkdtemp(join(tmpdir(),'hornet-help-'));
const env={...process.env,HORNET_USER_DATA:data,HORNET_SMOKE:'1'};delete env.ELECTRON_RUN_AS_NODE;
let executable=process.env.HORNET_PACKAGED_EXECUTABLE;
if(!executable&&process.argv.includes('--packaged'))executable=process.platform==='win32'?resolve('release/win-unpacked/Hornet Remote Suite.exe'):process.platform==='darwin'?resolve('release',process.arch==='arm64'?'mac-arm64':'mac','Hornet Remote Suite.app/Contents/MacOS/Hornet Remote Suite'):resolve('release',process.arch==='arm64'?'linux-arm64-unpacked':'linux-unpacked','hornet-remote-suite');
const updateArch=process.arch==='arm64'?'arm64':'x64';
const updateAssetName=process.platform==='win32'?'Hornet-Remote-Suite-9.0.0-windows-x64.exe':process.platform==='darwin'?`Hornet-Remote-Suite-9.0.0-macos-${updateArch}.dmg`:`Hornet-Remote-Suite-9.0.0-linux-${updateArch==='x64'?'amd64':'arm64'}.deb`;
let app;await mkdir('test-results',{recursive:true});
try{
 app=await electron.launch({...(executable?{executablePath:executable}:{}),args:executable?(process.platform==='linux'?['--no-sandbox']:[]):process.platform==='linux'?['--no-sandbox','.']:['.'],env,timeout:60000});
 const page=await app.firstWindow();page.setDefaultTimeout(20000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 // The smoke window starts hidden. Show it before the first guide screenshot
 // so Chromium can present a frame on packaged Windows builds as well.
 await app.evaluate(({BrowserWindow})=>{for(const win of BrowserWindow.getAllWindows()){win.webContents.setBackgroundThrottling(false);win.showInactive();}});
 const guide=page.getByRole('dialog',{name:'用户使用指引',exact:true});
 await expect(guide).toBeVisible();await expect(page.getByRole('dialog',{name:'会话',exact:true})).toHaveCount(0);
 await expect(guide.getByRole('navigation',{name:'指引目录'}).getByRole('button')).toHaveCount(12);
 await expect(guide.getByRole('searchbox',{name:'搜索使用指引'})).toBeFocused();
 await guide.getByRole('button',{name:'下一章',exact:true}).click();await expect(guide.getByRole('article')).toContainText('保存并连接');
 await guide.getByRole('button',{name:'上一章',exact:true}).click();await expect(guide.getByRole('article')).toContainText('首次安装');
 await page.screenshot({path:'test-results/user-guide-first-run.png'});
 await guide.getByRole('button',{name:'开始分步引导',exact:true}).click();
 const tour=page.getByRole('dialog',{name:'分步使用引导',exact:true}),next=tour.getByRole('button',{name:'下一步',exact:true}),back=tour.getByRole('button',{name:'上一步',exact:true});
 await expect(tour).toHaveAttribute('data-tour-step','0');await expect(guide).toHaveCount(0);await expect(page.getByRole('dialog',{name:'会话',exact:true})).toHaveCount(0);await expect(back).toBeDisabled();
 await next.click();await expect(tour).toHaveAttribute('data-tour-step','1');await expect(page.locator('.user-tour-highlight')).toBeVisible();
 const targetBox=await page.locator('[data-tour="new-session"]').boundingBox(),highlightBox=await page.locator('.user-tour-highlight').boundingBox();expect(Math.abs(highlightBox.x-targetBox.x)).toBeLessThan(8);expect(highlightBox.width).toBeGreaterThanOrEqual(targetBox.width);
 await page.screenshot({path:'test-results/user-tour-new-session.png'});
 await back.click();await expect(tour).toHaveAttribute('data-tour-step','0');await page.keyboard.press('ArrowRight');await expect(tour).toHaveAttribute('data-tour-step','1');
 await page.keyboard.press('ArrowLeft');await expect(tour).toHaveAttribute('data-tour-step','0');
 const originalBounds=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getBounds());
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1000,680));
 await next.click();const cardBox=await tour.boundingBox(),viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));expect(cardBox.x).toBeGreaterThanOrEqual(0);expect(cardBox.y).toBeGreaterThanOrEqual(0);expect(cardBox.x+cardBox.width).toBeLessThanOrEqual(viewport.width);expect(cardBox.y+cardBox.height).toBeLessThanOrEqual(viewport.height);
 await next.focus();await page.keyboard.press('Tab');await expect(tour.getByRole('button',{name:'用户使用指引',exact:true})).toBeFocused();await page.keyboard.press('Shift+Tab');await expect(next).toBeFocused();
 for(let step=2;step<=9;step++){await next.click();await expect(tour).toHaveAttribute('data-tour-step',String(step));}
 await tour.getByRole('button',{name:'完成引导',exact:true}).click();await expect(tour).toHaveCount(0);
 await app.evaluate(({BrowserWindow},bounds)=>BrowserWindow.getAllWindows()[0].setBounds(bounds),originalBounds);
 await dismissStartupSessions(page);
 await page.reload();await expect(guide).toHaveCount(0);await expect(page.getByRole('dialog',{name:'会话',exact:true})).toHaveCount(0);
 // Keep browsers and PDF viewers closed. PDF creation and help IPC remain real.
 await app.evaluate(({shell,net,BrowserWindow},fixture)=>{
  for(const win of BrowserWindow.getAllWindows()){win.webContents.setBackgroundThrottling(false);win.showInactive();}
  globalThis.__helpLinks=[];globalThis.__helpFiles=[];globalThis.__helpUpdateMode='new';shell.openExternal=async url=>{globalThis.__helpLinks.push(url);};shell.openPath=async path=>{globalThis.__helpFiles.push(path);return '';};
  const original=net.fetch.bind(net);net.fetch=(url,options)=>{const value=String(url);
   if(value.startsWith('https://api.github.com/repos/codehubcloud/hornet-remote-suite-release/')){if(globalThis.__helpUpdateMode==='error')return Promise.resolve(new Response('',{status:503}));const version=globalThis.__helpUpdateMode==='current'?globalThis.__helpCurrent:'9.0.0',base='https://github.com/codehubcloud/hornet-remote-suite-release/releases/download/v'+version+'/',asset=fixture.assetName.replace('9.0.0',version),assets=[{name:asset,browser_download_url:base+asset},{name:'SHA256SUMS',browser_download_url:base+'SHA256SUMS'}];return Promise.resolve(new Response(JSON.stringify({tag_name:'v'+version,draft:false,prerelease:false,body:'Verified release notes',assets})));}
   if(value.endsWith('/SHA256SUMS'))return Promise.resolve(new Response(fixture.digest+'  '+fixture.assetName+'\n'));
   if(value.includes(fixture.assetName.replace('9.0.0',globalThis.__helpUpdateMode==='current'?globalThis.__helpCurrent:'9.0.0')))return Promise.resolve(new Response(Uint8Array.from(fixture.payload)));return original(url,options);};
 },{assetName:updateAssetName,payload:[72,79,82,78,69,84,45,85,80,68,65,84,69],digest:'a7041c68010df800c93ae6773c6ef5174d659b5e66d54f17f9527e23d96ff110'});
 const info=await page.evaluate(()=>window.hornet.help.info());await app.evaluate((_e,version)=>{globalThis.__helpCurrent=version;},info.version);
 const menu=async item=>{await page.getByRole('navigation',{name:'应用菜单',exact:true}).getByRole('button',{name:'帮助',exact:true}).click();await page.getByRole('menuitem',{name:item,exact:true}).click();};
 await menu('分步使用引导');await expect(tour).toHaveAttribute('data-tour-step','0');await tour.getByRole('button',{name:'跳过引导',exact:true}).click();await expect(tour).toHaveCount(0);
 await menu('分步使用引导');await next.click();await page.keyboard.press('Escape');await expect(tour).toHaveCount(0);
 await menu('分步使用引导');await tour.getByRole('button',{name:'用户使用指引',exact:true}).click();await expect(tour).toHaveCount(0);await expect(guide).toBeVisible();await page.keyboard.press('Escape');
 // Hidden targets use an explanatory card without changing saved toolbar preferences.
 const originalChrome=await page.evaluate(()=>localStorage.getItem('hornet.chrome.v1'));
 await page.evaluate(()=>localStorage.setItem('hornet.chrome.v1',JSON.stringify({menu:true,standard:false,address:false,links:false,locked:true,order:['standard','address','links'],bookmarks:[]})));await page.reload();
 await page.getByRole('button',{name:'X11 图形应用 启动预设、显示设置与 XDMCP',exact:true}).click();
 const hiddenChrome=await page.evaluate(()=>localStorage.getItem('hornet.chrome.v1'));await menu('分步使用引导');await next.click();await expect(tour).toContainText('该区域当前隐藏');await expect(page.locator('.user-tour-highlight')).toHaveCount(0);await tour.getByRole('button',{name:'跳过引导',exact:true}).click();expect(await page.evaluate(()=>localStorage.getItem('hornet.chrome.v1'))).toBe(hiddenChrome);
 await page.evaluate(value=>{if(value===null)localStorage.removeItem('hornet.chrome.v1');else localStorage.setItem('hornet.chrome.v1',value);},originalChrome);await page.reload();
 await menu('用户使用指引');await expect(guide).toBeVisible();
 const guideSearch=guide.getByRole('searchbox',{name:'搜索使用指引'});
 await guideSearch.fill('径向渐变');await expect(guide.getByRole('article')).toContainText('快速命令与按钮颜色');
 await expect(guide.getByRole('navigation').getByRole('button')).toHaveCount(1);await expect(guide.getByRole('button',{name:'下一章',exact:true})).toBeDisabled();
 await guideSearch.fill('no-such-guide-topic');await expect(guide.getByRole('status')).toHaveText('没有找到相关内容，请尝试其他关键词。');
 await guideSearch.fill('');await guide.getByRole('button',{name:'关闭',exact:true}).focus();await page.keyboard.press('Tab');await expect(guide.getByRole('button',{name:'关闭使用指引',exact:true})).toBeFocused();await page.keyboard.press('Shift+Tab');await expect(guide.getByRole('button',{name:'关闭',exact:true})).toBeFocused();
 await page.keyboard.press('Escape');await expect(guide).toHaveCount(0);
 await menu('Hornet 帮助');let modal=page.getByRole('dialog',{name:'Hornet 帮助',exact:true});await expect(modal).toContainText('快速命令');await expect(modal).toContainText('Ctrl＋滚轮');await modal.getByRole('button',{name:'关闭',exact:true}).click();await page.keyboard.press('F1');await expect(modal).toBeVisible();await page.keyboard.press('Escape');await expect(modal).toHaveCount(0);
 for(const label of ['访问网站','访问技术支持','发送反馈意见'])await menu(label);
 expect(await app.evaluate(()=>globalThis.__helpLinks)).toEqual(['https://github.com/codehubcloud/hornet-remote-suite-release','https://github.com/codehubcloud/hornet-remote-suite-release/issues','https://github.com/codehubcloud/hornet-remote-suite-release/issues/new?title=Feedback&body=']);
 await expect(page.evaluate(()=>window.hornet.help.openLink('file:///bad'))).rejects.toThrow();
 await menu('打开帮助PDF');modal=page.getByRole('dialog',{name:'打开帮助PDF',exact:true});await expect(modal.getByRole('status')).toHaveText('帮助 PDF 已交给系统查看器打开。');const paths=await app.evaluate(()=>globalThis.__helpFiles);expect(paths).toHaveLength(1);expect(paths[0].startsWith(data)).toBe(true);const pdf=await readFile(paths[0]);expect(pdf.subarray(0,5).toString()).toBe('%PDF-');expect(pdf.length).toBeGreaterThan(5000);expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length)).toBe(1);await modal.getByRole('button',{name:'关闭',exact:true}).click();
 await menu('检查更新…');modal=page.locator('.help-dialog');await expect(modal.getByRole('status')).toHaveText('发现新版本 9.0.0');await expect(modal).toContainText('Verified release notes');await modal.getByRole('button',{name:'Download update',exact:true}).click();await expect(modal.getByRole('button',{name:'Install update',exact:true})).toBeEnabled();await expect(modal).toContainText('Update downloaded:');await modal.getByRole('button',{name:'Install update',exact:true}).click();await expect.poll(()=>app.evaluate(()=>globalThis.__helpFiles.length)).toBe(2);await page.screenshot({path:'test-results/help-update.png'});await modal.getByRole('button').last().click();
 await app.evaluate(()=>{globalThis.__helpUpdateMode='error';});await menu('检查更新…');await expect(modal.getByRole('alert')).toBeVisible();await app.evaluate(()=>{globalThis.__helpUpdateMode='current';});await modal.getByRole('button',{name:'重试',exact:true}).click();await expect(modal.getByRole('status')).toHaveText('当前已是最新版本');await modal.getByRole('button',{name:'关闭',exact:true}).click();
 await menu('关于 Hornet');modal=page.getByRole('dialog',{name:'关于 Hornet',exact:true});await expect(modal).toContainText(info.version);await expect(modal).toContainText(info.electron);await expect(modal).not.toContainText('开发版');await modal.getByRole('button',{name:'关闭',exact:true}).click();expect(errors).toEqual([]);
 // Preferences survive a complete application restart, and help remains usable in other languages.
 const closed=app.waitForEvent('close',{timeout:30000});await app.evaluate(({app,session})=>{session.defaultSession.flushStorageData();app.exit(0);}).catch(()=>{});await closed;
 app=await electron.launch({...(executable?{executablePath:executable}:{}),args:executable?(process.platform==='linux'?['--no-sandbox']:[]):process.platform==='linux'?['--no-sandbox','.']:['.'],env,timeout:60000});
 const reopened=await app.firstWindow();await expect(reopened.getByRole('region',{name:'快速开始',exact:true})).toBeVisible();await expect(reopened.getByRole('dialog')).toHaveCount(0);
 for(const [language,label,chapter,tourLabel] of [['en','User Guide','Installation and first launch','Guided Tour'],['zh-TW','使用者操作指引','首次安裝與開始使用','逐步操作導覽']]){
  await reopened.evaluate(language=>localStorage.setItem('hornet.appearance.v1',JSON.stringify({language,theme:'dark'})),language);await reopened.reload();
  await reopened.getByRole('navigation').first().getByRole('button',{name:language==='en'?'Help':'幫助',exact:true}).click();
  await reopened.getByRole('menuitem',{name:label,exact:true}).click();const translated=reopened.getByRole('dialog',{name:label,exact:true});await expect(translated.getByRole('article')).toContainText(chapter);await reopened.keyboard.press('Escape');
  await reopened.getByRole('navigation').first().getByRole('button',{name:language==='en'?'Help':'幫助',exact:true}).click();await reopened.getByRole('menuitem',{name:tourLabel,exact:true}).click();await expect(reopened.getByRole('dialog',{name:tourLabel,exact:true})).toHaveAttribute('data-tour-step','0');await reopened.keyboard.press('Escape');
 }
 console.log('Help passed: 10-step highlighted tour, next/back/finish/skip/Escape, resize/focus, hidden-target fallback without preference changes, manual entry, first-run guide, persistent acknowledgment, localized reopening, F1, public links, detailed PDF, updates and about.');
}catch(error){if(app)await(await app.firstWindow()).screenshot({path:'test-results/help-failure.png',timeout:5000}).catch(()=>{});throw error;}
finally{if(app)await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await rm(data,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
