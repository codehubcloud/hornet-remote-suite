import { _electron as electron,expect as baseExpect } from '@playwright/test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp,mkdir,readFile,rm } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { dismissStartupSessions } from './session-dialog-helper.mjs';
const expect=baseExpect.configure({timeout:30000});
await mkdir('test-results',{recursive:true});
await build({entryPoints:['tests/fixtures/ssh-server.ts'],outfile:'test-results/xshell-workspace-fixture.cjs',bundle:true,platform:'node',format:'cjs',external:['ssh2']});
const server=await createRequire(import.meta.url)(resolve('test-results/xshell-workspace-fixture.cjs')).sshFixture({networkProxy:true});
const data=await mkdtemp(join(tmpdir(),'hornet-xshell-workspace-')),exportPath=join(data,'commands.json');
const env={...process.env,HORNET_USER_DATA:data,HORNET_SMOKE:'1'};delete env.ELECTRON_RUN_AS_NODE;
let executable=process.env.HORNET_PACKAGED_EXECUTABLE;
if(!executable&&process.argv.includes('--packaged'))executable=process.platform==='win32'?resolve('release/win-unpacked/Hornet Remote Suite.exe'):process.platform==='darwin'?resolve('release',process.arch==='arm64'?'mac-arm64':'mac','Hornet Remote Suite.app/Contents/MacOS/Hornet Remote Suite'):resolve('release',process.arch==='arm64'?'linux-arm64-unpacked':'linux-unpacked','hornet-remote-suite');
let app,page;
try{
 app=await electron.launch({...(executable?{executablePath:executable}:{}),args:executable?(process.platform==='linux'?['--no-sandbox']:[]):['.'],env,timeout:60000});page=await app.firstWindow();page.setDefaultTimeout(30000);await dismissStartupSessions(page);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await app.evaluate(({safeStorage,BrowserWindow,session},path)=>{
  // Test-only keyring for headless hosts; Windows keeps native encryption.
  if(process.platform!=='win32'){safeStorage.isEncryptionAvailable=()=>true;safeStorage.getSelectedStorageBackend=()=> 'test-keyring';safeStorage.encryptString=text=>Buffer.from(text).map(b=>b^0xa5);safeStorage.decryptString=data=>Buffer.from(data).map(b=>b^0xa5).toString();}
  for(const win of BrowserWindow.getAllWindows()){win.webContents.setBackgroundThrottling(false);win.showInactive();}
  session.defaultSession.on('will-download',(_event,item)=>item.setSavePath(path));
 },exportPath);
 await page.evaluate(()=>localStorage.setItem('hornet.terminal.commands.v1',JSON.stringify([{id:crypto.randomUUID(),name:'Legacy command',text:'pwd'}])));await page.reload();await page.locator('.app-shell').waitFor();
 const menu=async(group,item)=>{await page.getByRole('navigation',{name:'应用菜单'}).getByRole('button',{name:group,exact:true}).click();await page.getByRole('menuitem',{name:item,exact:true}).click();};
 const quick=async text=>{await page.getByLabel('快速连接地址',{exact:true}).fill(text);await page.locator('.quick-connect-bar').getByRole('button',{name:'连接',exact:true}).click();};
 const context=async()=>{const bar=page.locator('.session-links-bar'),box=await bar.boundingBox();await bar.click({button:'right',position:{x:box.width-8,y:10}});return page.getByRole('menu',{name:'工具栏设置',exact:true});};
 let toolbar=await context();for(const label of ['菜单栏(M)','标准按钮(S)','地址栏(A)','链接栏(L)','锁定工具栏(B)'])await expect(toolbar.getByRole('menuitem',{name:label,exact:true})).toBeVisible();
 await toolbar.getByRole('menuitem',{name:'地址栏(A)',exact:true}).click();await expect(page.locator('.quick-connect-bar')).toBeHidden();toolbar=await context();await toolbar.getByRole('menuitem',{name:'地址栏(A)',exact:true}).click();
 toolbar=await context();await toolbar.getByRole('menuitem',{name:'菜单栏(M)',exact:true}).click();await expect(page.getByRole('navigation',{name:'应用菜单'})).toBeHidden();await page.getByRole('button',{name:'显示菜单栏',exact:true}).click();await expect(page.getByRole('navigation',{name:'应用菜单'})).toBeVisible();
 const titleContext=async()=>{
  if(process.platform==='win32'||process.platform==='linux')await app.evaluate(({BrowserWindow,screen})=>{const win=BrowserWindow.getAllWindows()[0],bounds=win.getContentBounds();win.emit('system-context-menu',{preventDefault(){}},screen.dipToScreenPoint({x:bounds.x+Math.round(bounds.width/2),y:bounds.y+18}));});
  else await page.getByRole('button',{name:'显示菜单栏',exact:true}).click({button:'right',position:{x:10,y:2}});
  const popup=page.getByRole('menu',{name:'工具栏设置',exact:true});await expect(popup).toBeVisible();return popup;
 };
 // The first row overlaps the native draggable titlebar. Portal menus must
 // explicitly exclude their own rectangle from native window dragging.
 toolbar=await context();await toolbar.getByRole('menuitem',{name:'菜单栏(M)',exact:true}).click();await expect(page.getByRole('navigation',{name:'应用菜单'})).toBeHidden();
 toolbar=await titleContext();await expect(toolbar).toHaveCSS('-webkit-app-region','no-drag');const row=await toolbar.getByRole('menuitem',{name:'菜单栏(M)',exact:true}).boundingBox(),title=await page.locator('.app-titlebar').boundingBox();expect(row.y+row.height/2).toBeLessThan(title.y+title.height);
 await toolbar.getByRole('menuitem',{name:'菜单栏(M)',exact:true}).click();await expect(page.getByRole('navigation',{name:'应用菜单'})).toBeVisible();
 toolbar=await context();await toolbar.getByRole('menuitem',{name:'菜单栏(M)',exact:true}).click();await page.reload();await page.locator('.app-shell').waitFor();await expect(page.getByRole('navigation',{name:'应用菜单'})).toBeHidden();
 toolbar=await titleContext();await toolbar.getByRole('menuitem',{name:'菜单栏(M)',exact:true}).click();await expect(page.getByRole('navigation',{name:'应用菜单'})).toBeVisible();expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('hornet.chrome.v1')).menu)).toBe(true);
 toolbar=await context();await toolbar.getByRole('menuitem',{name:'锁定工具栏(B)',exact:true}).click();await expect(page.locator('.toolbar-grip')).toHaveCount(3);
 await page.locator('[data-toolbar-section=address] .toolbar-grip').dragTo(page.locator('[data-toolbar-section=standard] .toolbar-grip'));
 expect(await page.locator('[data-toolbar-section]').evaluateAll(nodes=>nodes.map(n=>n.dataset.toolbarSection))).toEqual(['address','standard','links']);
 toolbar=await context();await toolbar.getByRole('menuitem',{name:'锁定工具栏(B)',exact:true}).click();await expect(page.locator('.toolbar-grip')).toHaveCount(0);
 if(process.platform==='win32'){
  await app.evaluate(({BrowserWindow,screen})=>{const win=BrowserWindow.getAllWindows()[0],bounds=win.getContentBounds();win.emit('system-context-menu',{preventDefault(){}},screen.dipToScreenPoint({x:bounds.x+bounds.width-220,y:bounds.y+18}));});
  await expect(page.getByRole('menu',{name:'工具栏设置',exact:true})).toBeVisible();await page.keyboard.press('Escape');
 }
 await menu('工具','快速命令管理器');const manager=page.getByRole('dialog',{name:'快速命令管理器',exact:true});await expect(manager.getByLabel('已保存命令',{exact:true})).toContainText('Legacy command');
 await manager.getByLabel('命令集名称',{exact:true}).fill('Ops');await manager.getByRole('button',{name:'新建命令集',exact:true}).click();
 await manager.getByLabel('命令名称',{exact:true}).fill('Insert marker');await manager.getByLabel('快速命令内容',{exact:true}).fill('echo quick-marker');await manager.getByRole('checkbox',{name:'发送后回车',exact:true}).uncheck();
 await manager.getByLabel('填充方式',{exact:true}).selectOption('solid');await manager.getByLabel('背景颜色',{exact:true}).fill('#dc2626');await expect(manager.getByRole('button',{name:'按钮外观预览',exact:true})).toHaveCSS('background-color','rgb(220, 38, 38)');
 await manager.getByRole('button',{name:'恢复主题默认',exact:true}).click();await expect(manager.getByLabel('填充方式',{exact:true})).toHaveValue('theme');
 await manager.getByRole('button',{name:'蓝紫渐变',exact:true}).click();await manager.getByLabel('渐变角度',{exact:true}).fill('90');await manager.getByRole('checkbox',{name:'自动文字颜色',exact:true}).uncheck();await manager.getByLabel('文字颜色',{exact:true}).fill('#ffffff');
 await expect(manager.getByRole('button',{name:'按钮外观预览',exact:true})).toHaveCSS('background-image','linear-gradient(90deg, rgb(37, 99, 235), rgb(124, 58, 237))');await manager.getByRole('button',{name:'保存命令',exact:true}).click();await expect(manager.getByRole('button',{name:'发送并执行',exact:true})).toBeDisabled();
 await manager.getByRole('button',{name:'新建命令',exact:true}).click();await manager.getByLabel('命令名称',{exact:true}).fill('Solid marker');await manager.getByLabel('快速命令内容',{exact:true}).fill('echo solid-marker');await manager.getByLabel('填充方式',{exact:true}).selectOption('radial');await expect(manager.getByRole('button',{name:'按钮外观预览',exact:true})).toHaveCSS('background-image',/radial-gradient/);await manager.getByLabel('填充方式',{exact:true}).selectOption('solid');await manager.getByLabel('背景颜色',{exact:true}).fill('#15803d');await manager.getByRole('button',{name:'保存命令',exact:true}).click();
 await page.screenshot({path:'test-results/quick-command-colors-editor.png'});
 await manager.getByRole('button',{name:'导出命令',exact:true}).click();await expect.poll(async()=>{try{return JSON.parse(await readFile(exportPath,'utf8')).commands.length;}catch{return 0;}}).toBe(3);
 const exported=JSON.parse(await readFile(exportPath,'utf8'));expect(exported.commands.find(command=>command.name==='Insert marker').appearance).toEqual({kind:'linear',from:'#2563eb',to:'#7c3aed',angle:90,textColor:'#ffffff'});expect(exported.commands.find(command=>command.name==='Solid marker').appearance).toEqual({kind:'solid',color:'#15803d'});
 await manager.getByRole('button',{name:'关闭快速命令',exact:true}).click();
 await quick('tester@127.0.0.1:'+server.port);const properties=page.locator('.profile-dialog');await properties.getByLabel('名称',{exact:true}).fill('Feature fixture');await properties.getByLabel('说明',{exact:true}).fill('生产环境\nLinux 运维主机');await properties.getByLabel('连接密码',{exact:true}).fill('test-password');
 await properties.getByRole('button',{name:'显示密码',exact:true}).click();await expect(properties.getByLabel('连接密码',{exact:true})).toHaveAttribute('type','text');await properties.getByRole('button',{name:'隐藏密码',exact:true}).click();
 const category=async name=>properties.getByRole('tab',{name,exact:true}).click();
 await category('外观');await properties.getByLabel('会话字号',{exact:true}).fill('18');await properties.getByLabel('会话配色',{exact:true}).selectOption('nord');
 await category('终端');await properties.getByLabel('终端类型',{exact:true}).selectOption('vt100');await properties.getByLabel('初始列数',{exact:true}).fill('132');await properties.getByLabel('初始行数',{exact:true}).fill('42');
 await category('键盘');await properties.getByLabel('退格键',{exact:true}).selectOption('bs');await properties.getByLabel('回车键',{exact:true}).selectOption('crlf');
 await category('保持活动状态');await properties.getByLabel('保活间隔（秒）',{exact:true}).fill('5');await properties.getByLabel('连续未响应次数',{exact:true}).fill('1');
 await category('重新连接');await properties.getByRole('checkbox',{name:'连接异常关闭时自动重新连接',exact:true}).check();await properties.getByLabel('重连间隔（秒）',{exact:true}).fill('5');await properties.getByLabel('重连时限（分钟，0 为不限）',{exact:true}).fill('1');
 await category('文件传输');await properties.getByLabel('初始远端目录',{exact:true}).fill('/tmp');await category('高级');await properties.getByLabel('快速命令集',{exact:true}).selectOption({label:'Ops'});
 await page.screenshot({path:'test-results/session-properties-categories.png'});await properties.getByRole('button',{name:'保存并连接',exact:true}).click();await page.getByRole('button',{name:'已核对，信任此主机',exact:true}).click();
 const first=page.locator('.terminal-cell').first(),second=page.locator('.terminal-cell').nth(1);await expect(first).toContainText('fixture ready');expect(server.ptyRequests[0]).toEqual({term:'vt100',cols:132,rows:42});await expect(page.getByLabel('远端路径',{exact:true})).toHaveValue('/');await first.locator('.xterm-helper-textarea').focus();await page.keyboard.type('cd /tmp');await page.keyboard.press('Enter');await expect.poll(()=>server.shellPaths[0]).toBe('/tmp');await expect(page.getByLabel('远端路径',{exact:true})).toHaveValue('/tmp');
 await expect(first.locator('.xterm-scrollable-element')).toHaveCSS('background-color','rgb(46, 52, 64)');
 const details=page.locator('.statusbar').getByRole('region',{name:'当前终端属性',exact:true});await expect(page.locator('.sidebar')).toBeHidden();await expect(details).toBeVisible();await expect(details).toContainText('Feature fixture');await expect(details).toContainText('tester');await expect(details.locator('[data-session-property=description] dd')).toHaveAttribute('title','生产环境\nLinux 运维主机');
 const bottom=await details.boundingBox(),viewport=page.viewportSize()??await page.evaluate(()=>({width:innerWidth,height:innerHeight}));expect(bottom.y+bottom.height).toBeGreaterThan(viewport.height-12);await page.getByRole('button',{name:'主机列表',exact:true}).click();await expect(details).toBeVisible();
 await details.getByRole('button',{name:'编辑当前会话属性',exact:true}).click();await category('外观');await properties.getByLabel('会话字号',{exact:true}).fill('20');await properties.getByRole('button',{name:'保存配置',exact:true}).click();await expect(properties).toHaveCount(0);expect(server.shellCount).toBe(1);
 const savedFirst=(await page.evaluate(()=>window.hornet.profiles.list()))[0];expect(savedFirst.session.appearance.fontSize).toBe(20);expect(savedFirst.description).toBe('生产环境\nLinux 运维主机');
 await details.getByRole('button',{name:'编辑当前会话属性',exact:true}).click();await properties.getByLabel('主机',{exact:true}).fill('other.invalid');await properties.getByRole('button',{name:'保存配置',exact:true}).click();await expect(properties.getByRole('alert')).toContainText('PROFILE_BUSY');await properties.getByRole('button',{name:'取消',exact:true}).click();
 await quick('tester@127.0.0.1:'+server.port);await properties.getByLabel('名称',{exact:true}).fill('Second fixture');await properties.getByLabel('连接密码',{exact:true}).fill('test-password');await category('高级');await properties.getByLabel('快速命令集',{exact:true}).selectOption({label:'Ops'});await properties.getByRole('button',{name:'保存并连接',exact:true}).click();await expect(second).toContainText('fixture ready');await expect(details).toContainText('Second fixture');
 await expect(second.locator('.xterm-scrollable-element')).toHaveCSS('background-color','rgb(11, 18, 32)');expect(server.authCount).toBe(2);await expect(details.locator('[data-session-property=description] dd')).toHaveText('—');
 await menu('查看','快速命令');await page.getByRole('menuitem',{name:'快速命令栏',exact:true}).click();const bar=page.getByRole('region',{name:'快速命令栏',exact:true});const firstShellInputBeforeQuick=server.shellInputs.find(([pid])=>pid===1001)?.[1];await bar.getByRole('button',{name:'Insert marker',exact:true}).click();await expect.poll(()=>server.shellInputs.find(([pid])=>pid===1002)?.[1]).toBe('echo quick-marker');expect(server.shellInputs.find(([pid])=>pid===1001)?.[1]).toBe(firstShellInputBeforeQuick);
 await expect(bar.getByRole('button',{name:'Insert marker',exact:true})).toHaveCSS('background-image','linear-gradient(90deg, rgb(37, 99, 235), rgb(124, 58, 237))');await expect(bar.getByRole('button',{name:'Insert marker',exact:true})).toHaveCSS('color','rgb(255, 255, 255)');await expect(bar.getByRole('button',{name:'Solid marker',exact:true})).toHaveCSS('background-color','rgb(21, 128, 61)');
 const beforeEdit=JSON.stringify(server.shellInputs);await bar.getByRole('button',{name:'Insert marker',exact:true}).click({button:'right'});await expect(manager.getByLabel('命令名称',{exact:true})).toHaveValue('Insert marker');await expect(manager.getByLabel('填充方式',{exact:true})).toHaveValue('linear');await expect(manager.getByLabel('渐变角度',{exact:true})).toHaveValue('90');await manager.getByRole('button',{name:'关闭快速命令',exact:true}).click();expect(JSON.stringify(server.shellInputs)).toBe(beforeEdit);
 await second.locator('.xterm-helper-textarea').focus();await page.keyboard.press('Control+F1');await expect.poll(()=>server.shellInputs.find(([pid])=>pid===1002)?.[1]).toBe('echo quick-markerecho quick-marker');
 await menu('查看','快速命令');await page.getByRole('menuitem',{name:'快速命令窗格',exact:true}).click();await expect(page.getByRole('region',{name:'快速命令窗格',exact:true})).toBeVisible();
 const commandPane=page.getByRole('region',{name:'快速命令窗格',exact:true});await expect(commandPane.getByRole('button',{name:'Insert marker',exact:true})).toHaveCSS('background-image','linear-gradient(90deg, rgb(37, 99, 235), rgb(124, 58, 237))');await expect(commandPane.getByRole('button',{name:'Solid marker',exact:true})).toHaveCSS('background-color','rgb(21, 128, 61)');
 await page.getByRole('button',{name:'添加当前会话到链接栏',exact:true}).click();await expect(page.getByRole('toolbar',{name:'链接栏',exact:true}).getByRole('button',{name:'Second fixture',exact:true})).toBeVisible();
 await page.locator('[data-tab-view-id]').first().locator('button').first().click();await expect(details).toContainText('Feature fixture');await first.locator('.xterm-helper-textarea').focus();await page.keyboard.press('Backspace');await page.keyboard.press('Enter');await expect.poll(()=>server.shellInputs.find(([pid])=>pid===1001)?.[1]).toBe('cd /tmp\r\n\x08\r\n');
 await page.screenshot({path:'test-results/xshell-workspace.png'});
 const before=await first.getAttribute('data-terminal-id');server.blackhole();await expect.poll(()=>first.getAttribute('data-terminal-id'),{timeout:40000,intervals:[500]}).not.toBe(before);await expect(first).toContainText('fixture ready');expect(server.shellCount).toBe(3);expect(server.shellInputs.some(([pid])=>pid===1003)).toBe(false);
 await menu('文件','断开');await expect(first.locator('.terminal-disconnected')).toBeVisible();const count=server.shellCount;await page.waitForTimeout(6500);expect(server.shellCount).toBe(count);
 await page.locator('.tabs').getByRole('button',{name:'关闭 Feature fixture',exact:true}).click();await page.locator('.tabs').getByRole('button',{name:'关闭 Second fixture',exact:true}).click();
 await page.reload();await page.locator('.app-shell').waitFor();expect(await page.locator('[data-toolbar-section]').evaluateAll(nodes=>nodes.map(n=>n.dataset.toolbarSection))).toEqual(['address','standard','links']);
 expect((await page.evaluate(()=>window.hornet.profiles.list())).find(p=>p.name==='Feature fixture').description).toBe('生产环境\nLinux 运维主机');
 await menu('工具','快速命令管理器');await manager.getByLabel('命令集',{exact:true}).selectOption({label:'Ops'});await manager.getByLabel('已保存命令',{exact:true}).selectOption({label:'Insert marker'});await expect(manager.getByLabel('快速命令内容',{exact:true})).toHaveValue('echo quick-marker');await expect(manager.getByRole('checkbox',{name:'发送后回车',exact:true})).not.toBeChecked();
 await expect(manager.getByLabel('填充方式',{exact:true})).toHaveValue('linear');await expect(manager.getByLabel('渐变角度',{exact:true})).toHaveValue('90');await expect(manager.getByLabel('文字颜色',{exact:true})).toHaveValue('#ffffff');
 await manager.locator('input[type=file]').setInputFiles(exportPath);await expect(manager.getByLabel('命令集',{exact:true}).locator('option')).toHaveCount(4);await manager.getByRole('button',{name:'关闭快速命令',exact:true}).click();
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('hornet.terminal.commands.v2')).commands.filter(command=>command.name==='Insert marker'&&command.appearance?.kind==='linear').length)).toBe(2);
 expect(errors).toEqual([]);await expect(page.locator('.error-banner')).toHaveCount(0);
 console.log('Xshell workspace passed: toolbar context toggles/reorder/lock/recovery, legacy command migration, sets/import/export/current-only buttons and shortcuts, property categories/persistence/live styling, terminal type/size/keyboard/directory, packet-loss auto-reconnect without replay, and manual disconnect stops retries.');
}catch(error){if(page)await page.screenshot({path:'test-results/xshell-workspace-failure.png',timeout:5000}).catch(()=>{});throw error;}
finally{if(app)await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await server.close();await rm(data,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
