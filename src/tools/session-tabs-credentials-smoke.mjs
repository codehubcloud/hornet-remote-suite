import { _electron as electron,expect as baseExpect } from '@playwright/test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp,mkdir,readFile,rm } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { dismissStartupSessions } from './session-dialog-helper.mjs';
const expect=baseExpect.configure({timeout:30000});
await mkdir('test-results',{recursive:true});
await build({entryPoints:['tests/fixtures/ssh-server.ts'],outfile:'test-results/tab-credentials-fixture.cjs',bundle:true,platform:'node',format:'cjs',external:['ssh2']});
const server=await createRequire(import.meta.url)(resolve('test-results/tab-credentials-fixture.cjs')).sshFixture();
const data=await mkdtemp(join(tmpdir(),'hornet-tab-credentials-'));
const env={...process.env,HORNET_USER_DATA:data,HORNET_SMOKE:'1'};delete env.ELECTRON_RUN_AS_NODE;
let executable=process.env.HORNET_PACKAGED_EXECUTABLE;
if(!executable&&process.argv.includes('--packaged'))executable=process.platform==='win32'?resolve('release/win-unpacked/Hornet Remote Suite.exe'):process.platform==='darwin'?resolve('release',process.arch==='arm64'?'mac-arm64':'mac','Hornet Remote Suite.app/Contents/MacOS/Hornet Remote Suite'):resolve('release',process.arch==='arm64'?'linux-arm64-unpacked':'linux-unpacked','hornet-remote-suite');
let app,page;const errors=[];
async function launch(){
 app=await electron.launch({...(executable?{executablePath:executable}:{}),args:executable?(process.platform==='linux'?['--no-sandbox']:[]):['.'],env,timeout:60000});page=await app.firstWindow();page.setDefaultTimeout(30000);await page.locator('.app-shell').waitFor();if(await page.evaluate(()=>localStorage.getItem('hornet.sessions.showOnStartup')!=='false'))await dismissStartupSessions(page);
 // Windows uses the real OS encryption. Headless runners without a keyring
 // use a deterministic fixture, confined to this temporary profile.
 const nativeKeyring=await app.evaluate(({safeStorage,BrowserWindow})=>{
  const native=process.platform==='win32'&&safeStorage.isEncryptionAvailable();
  globalThis.__testKeyringAvailable=true;
  safeStorage.isEncryptionAvailable=()=>globalThis.__testKeyringAvailable;
  if(!native){safeStorage.getSelectedStorageBackend=()=> 'test-keyring';safeStorage.encryptString=text=>Buffer.from(text).map(byte=>byte^0xa5);safeStorage.decryptString=buffer=>Buffer.from(buffer).map(byte=>byte^0xa5).toString();}
  for(const win of BrowserWindow.getAllWindows())win.webContents.setBackgroundThrottling(false);
  return native;
 });console.log('Credential encryption: '+(nativeKeyring?'Windows native safeStorage':'isolated test keyring'));page.on('pageerror',error=>errors.push(error.message));
}
const quick=async text=>{await page.getByLabel('快速连接地址',{exact:true}).fill(text);await page.locator('.quick-connect-bar').getByRole('button',{name:'连接',exact:true}).click();};
const tab=id=>page.locator('[data-tab-view-id="'+id+'"]');
const titleMenu=()=>page.getByRole('menu',{name:'终端标题菜单',exact:true});
const open=async id=>{await tab(id).locator('button').first().click({button:'right'});await expect(titleMenu()).toBeVisible();};
const item=async(id,label)=>{await open(id);await titleMenu().getByRole('menuitem',{name:label,exact:true}).click();};
const sub=async(id,parent,child)=>{await open(id);await titleMenu().getByRole('menuitem',{name:parent,exact:true}).click();await page.getByRole('menu',{name:parent,exact:true}).getByRole('menuitem',{name:child,exact:true}).click();};
try{
 await launch();await quick('tester@127.0.0.1:'+server.port);await page.getByLabel('名称',{exact:true}).fill('Saved fixture');
 await page.getByLabel('连接密码',{exact:true}).fill('test-password');await expect(page.getByRole('checkbox',{name:'保存密码',exact:true})).toBeChecked();
 await app.evaluate(()=>{globalThis.__testKeyringAvailable=false;});await page.getByRole('button',{name:'保存并连接',exact:true}).click();
 await expect(page.locator('.profile-dialog [role=alert]')).toContainText('系统安全存储不可用');expect(await page.evaluate(()=>window.hornet.profiles.list())).toEqual([]);expect(server.authCount).toBe(0);
 await app.evaluate(()=>{globalThis.__testKeyringAvailable=true;});await page.getByRole('button',{name:'保存并连接',exact:true}).click();
 await page.getByRole('button',{name:'已核对，信任此主机',exact:true}).click();await expect(page.locator('.terminal-cell')).toContainText('fixture ready');await expect(page.getByLabel('认证信息',{exact:true})).toHaveCount(0);
 let profile=(await page.evaluate(()=>window.hornet.profiles.list()))[0];expect(profile.username).toBe('tester');expect(profile).not.toHaveProperty('password');
 expect(await page.evaluate(id=>window.hornet.profiles.credentialStatus(id),profile.profileId)).toEqual({saved:true});expect(await readFile(join(data,'credentials','vault.json'),'utf8')).not.toContain('test-password');
 const first=await page.locator('.terminal-cell').getAttribute('data-terminal-id');let ids=await page.locator('[data-tab-view-id]').evaluateAll(nodes=>nodes.map(n=>n.dataset.tabViewId)),a=ids[0];
 await item(a,'复制SSH渠道');await expect.poll(()=>server.shellCount).toBe(2);expect(server.authCount).toBe(1);
 await item(a,'复制会话');await expect.poll(()=>server.shellCount).toBe(3);expect(server.authCount).toBe(2);await expect(page.getByLabel('认证信息',{exact:true})).toHaveCount(0);
 ids=await page.locator('[data-tab-view-id]').evaluateAll(nodes=>nodes.map(n=>n.dataset.tabViewId));expect(new Set(ids).size).toBe(3);
 const b=ids[1],c=ids[2];
 await sub(a,'新选项卡组','垂直分割');await expect(page.locator('.terminal-cell:visible')).toHaveCount(2);await expect(tab(b).locator('..')).toContainText('Saved fixture');
 await tab(c).locator('button').first().click();await expect(page.locator('.terminal-cell:visible')).toHaveCount(2);expect(server.shellCount).toBe(3);
 await item(a,'锁');await expect(tab(a).locator('button').last()).toBeDisabled();await page.keyboard.press('Control+Shift+F4');await expect(tab(a)).toHaveCount(1);
 await sub(a,'设置颜色','蓝色');await expect(tab(a)).toHaveCSS('border-top-color','rgb(57, 153, 219)');
 await item(a,'显示编号');await expect(page.locator('.tab-number')).toHaveCount(0);await item(a,'显示编号');
 await item(a,'显示状态图标');await expect(page.locator('.tab-state-icon')).toHaveCount(0);await item(a,'显示状态图标');
 server.setShellTitle(1003,'Remote title fixture');await item(a,'显示终端标题');await expect(tab(c)).toContainText('Remote title fixture');await item(a,'显示终端标题');
 await sub(a,'新选项卡组','移动到选项卡组 2');await expect(page.locator('.terminal-cell:visible')).toHaveCount(1);
 await item(a,'关闭其他选项卡');await expect(page.locator('.terminal-cell')).toHaveCount(1);expect(await page.locator('.terminal-cell').getAttribute('data-terminal-id')).toBe(first);
 await open(a);await expect(titleMenu().getByRole('menuitem',{name:'关闭所有选项卡',exact:true})).toBeDisabled();await page.keyboard.press('Escape');await expect(page.locator('.terminal-cell')).toHaveCount(1);await item(a,'锁');
 await page.keyboard.press('Shift+Alt+N');await expect(page.locator('.tabs .tab').filter({hasText:'新选项卡'})).toHaveCount(1);await page.keyboard.press('Control+Shift+F4');await expect(page.locator('.tabs .tab').filter({hasText:'新选项卡'})).toHaveCount(0);
 await item(a,'关闭');await expect(page.locator('.terminal-cell')).toHaveCount(0);server.disconnect();
 await expect.poll(async()=>{try{profile=await page.evaluate(profile=>window.hornet.profiles.save({...profile,name:'Saved fixture edited'},profile.revision),profile);return true;}catch(error){if(!error.message.includes('PROFILE_BUSY'))throw error;return false;}}).toBe(true);
 expect(await page.evaluate(id=>window.hornet.profiles.credentialStatus(id),profile.profileId)).toEqual({saved:true});
 const exited=app.waitForEvent('close');await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await exited;await launch();await quick('Saved fixture edited');await expect(page.locator('.terminal-cell')).toContainText('fixture ready');await expect(page.getByLabel('认证信息',{exact:true})).toHaveCount(0);expect(server.authCount).toBe(3);
 expect(await page.locator('.tab-number').count()).toBe(1);expect(await page.locator('.tab-state-icon').count()).toBe(1);
 if(!executable){const current=await page.locator('[data-tab-view-id]').getAttribute('data-tab-view-id');await open(current);await page.screenshot({path:'test-results/xshell-tab-context-menu.png'});await page.keyboard.press('Escape');}
 if(process.platform==='win32'){
  const current=await page.locator('[data-tab-view-id]').getAttribute('data-tab-view-id');await sub(current,'新选项卡组','垂直分割');await expect(page.locator('.terminal-cell:visible')).toHaveCount(2);
  await expect(page.locator('.terminal-cell').nth(1)).toContainText('PowerShell');const local=await page.locator('[data-tab-view-id]').last().getAttribute('data-tab-view-id');
  await item(current,'关闭所有本地标签');await expect(page.locator('.terminal-cell')).toHaveCount(1);await expect(tab(local)).toHaveCount(0);
 }
 expect(errors).toEqual([]);await expect(page.locator('.error-banner')).toHaveCount(0);
 console.log('Session tabs and credentials passed: encrypted credentials, unavailable-keyring rollback, restart auto-login, independent duplication vs shared channels, groups, lock/close protection, colors, title/number/status preferences and blank-tab shortcut.');
}finally{
 if(app)await app.evaluate(({app})=>app.exit(0)).catch(()=>{});
 await server.close();await rm(data,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
