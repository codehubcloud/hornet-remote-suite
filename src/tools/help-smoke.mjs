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
let app;await mkdir('test-results',{recursive:true});
try{
 app=await electron.launch({...(executable?{executablePath:executable}:{}),args:executable?(process.platform==='linux'?['--no-sandbox']:[]):process.platform==='linux'?['--no-sandbox','.']:['.'],env,timeout:60000});
 const page=await app.firstWindow();page.setDefaultTimeout(20000);
 const guide=page.getByRole('dialog',{name:'用户使用指引',exact:true});
 await expect(guide).toBeVisible();await expect(page.getByRole('dialog',{name:'会话',exact:true})).toHaveCount(0);
 await expect(guide.getByRole('navigation',{name:'指引目录'}).getByRole('button')).toHaveCount(12);
 await expect(guide.getByRole('searchbox',{name:'搜索使用指引'})).toBeFocused();
 await guide.getByRole('button',{name:'下一章',exact:true}).click();await expect(guide.getByRole('article')).toContainText('保存并连接');
 await guide.getByRole('button',{name:'上一章',exact:true}).click();await expect(guide.getByRole('article')).toContainText('首次安装');
 await page.screenshot({path:'test-results/user-guide-first-run.png'});
 await dismissStartupSessions(page);
 await page.reload();await expect(guide).toHaveCount(0);await expect(page.getByRole('dialog',{name:'会话',exact:true})).toHaveCount(0);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 // Keep browsers and PDF viewers closed. PDF creation and help IPC remain real.
 await app.evaluate(({shell,net,BrowserWindow})=>{for(const win of BrowserWindow.getAllWindows()){win.webContents.setBackgroundThrottling(false);win.showInactive();}globalThis.__helpLinks=[];globalThis.__helpFiles=[];globalThis.__helpUpdateMode='new';shell.openExternal=async url=>{globalThis.__helpLinks.push(url);};shell.openPath=async path=>{globalThis.__helpFiles.push(path);return '';};const original=net.fetch.bind(net);net.fetch=(url,options)=>{if(String(url).startsWith('https://api.github.com/repos/codehubcloud/hornet-remote-suite-release/')){if(globalThis.__helpUpdateMode==='error')return Promise.resolve(new Response('',{status:503}));return Promise.resolve(new Response(JSON.stringify({tag_name:globalThis.__helpUpdateMode==='current'?'v'+globalThis.__helpCurrent:'v9.0.0',draft:false,prerelease:false,body:'Verified release notes'})));}return original(url,options);};});
 const info=await page.evaluate(()=>window.hornet.help.info());await app.evaluate((_e,version)=>{globalThis.__helpCurrent=version;},info.version);
 const menu=async item=>{await page.getByRole('navigation',{name:'应用菜单',exact:true}).getByRole('button',{name:'帮助',exact:true}).click();await page.getByRole('menuitem',{name:item,exact:true}).click();};
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
 await menu('检查更新…');modal=page.getByRole('dialog',{name:'检查更新…',exact:true});await expect(modal.getByRole('status')).toHaveText('发现新版本 9.0.0');await expect(modal).toContainText('Verified release notes');await modal.getByRole('button',{name:'访问发布页面',exact:true}).click();expect((await app.evaluate(()=>globalThis.__helpLinks)).at(-1).endsWith('/releases/latest')).toBe(true);await page.screenshot({path:'test-results/help-update.png'});await modal.getByRole('button',{name:'关闭',exact:true}).click();
 await app.evaluate(()=>{globalThis.__helpUpdateMode='error';});await menu('检查更新…');await expect(modal.getByRole('alert')).toBeVisible();await app.evaluate(()=>{globalThis.__helpUpdateMode='current';});await modal.getByRole('button',{name:'重试',exact:true}).click();await expect(modal.getByRole('status')).toHaveText('当前已是最新版本');await modal.getByRole('button',{name:'关闭',exact:true}).click();
 await menu('关于 Hornet');modal=page.getByRole('dialog',{name:'关于 Hornet',exact:true});await expect(modal).toContainText(info.version);await expect(modal).toContainText(info.electron);await expect(modal).not.toContainText('开发版');await modal.getByRole('button',{name:'关闭',exact:true}).click();expect(errors).toEqual([]);
 // Preferences survive a complete application restart, and help remains usable in other languages.
 const closed=app.waitForEvent('close',{timeout:30000});await app.evaluate(({app,session})=>{session.defaultSession.flushStorageData();app.exit(0);}).catch(()=>{});await closed;
 app=await electron.launch({...(executable?{executablePath:executable}:{}),args:executable?(process.platform==='linux'?['--no-sandbox']:[]):process.platform==='linux'?['--no-sandbox','.']:['.'],env,timeout:60000});
 const reopened=await app.firstWindow();await expect(reopened.getByRole('region',{name:'快速开始',exact:true})).toBeVisible();await expect(reopened.getByRole('dialog')).toHaveCount(0);
 for(const [language,label,chapter] of [['en','User Guide','Installation and first launch'],['zh-TW','使用者操作指引','首次安裝與開始使用']]){
  await reopened.evaluate(language=>localStorage.setItem('hornet.appearance.v1',JSON.stringify({language,theme:'dark'})),language);await reopened.reload();
  await reopened.getByRole('navigation').first().getByRole('button',{name:language==='en'?'Help':'幫助',exact:true}).click();
  await reopened.getByRole('menuitem',{name:label,exact:true}).click();const translated=reopened.getByRole('dialog',{name:label,exact:true});await expect(translated.getByRole('article')).toContainText(chapter);await reopened.keyboard.press('Escape');
 }
 console.log('Help passed: first-run guide before sessions, chapter navigation/search/focus, persistent acknowledgment across restart, menu reopening, English/Traditional Chinese content, F1, public links, real detailed PDF generation, update states, retry, about and rejected arbitrary URLs.');
}catch(error){if(app)await(await app.firstWindow()).screenshot({path:'test-results/help-failure.png',timeout:5000}).catch(()=>{});throw error;}
finally{if(app)await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await rm(data,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
