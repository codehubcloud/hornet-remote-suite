import { _electron as electron,expect as baseExpect } from '@playwright/test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp,mkdir,rm } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { dismissStartupSessions } from './session-dialog-helper.mjs';

const expect=baseExpect.configure({timeout:30000});
await mkdir('test-results',{recursive:true});
await build({entryPoints:['tests/fixtures/ssh-server.ts'],outfile:'test-results/clipboard-fixture.cjs',bundle:true,platform:'node',format:'cjs',external:['ssh2']});
const server=await createRequire(import.meta.url)(resolve('test-results/clipboard-fixture.cjs')).sshFixture();
const data=await mkdtemp(join(tmpdir(),'hornet-clipboard-'));
const env={...process.env,HORNET_USER_DATA:data,HORNET_SMOKE:'1'};delete env.ELECTRON_RUN_AS_NODE;
let executable=process.env.HORNET_PACKAGED_EXECUTABLE;
if(!executable&&process.argv.includes('--packaged'))executable=process.platform==='win32'?resolve('release/win-unpacked/Hornet Remote Suite.exe'):process.platform==='darwin'?resolve('release',process.arch==='arm64'?'mac-arm64':'mac','Hornet Remote Suite.app/Contents/MacOS/Hornet Remote Suite'):resolve('release',process.arch==='arm64'?'linux-arm64-unpacked':'linux-unpacked','hornet-remote-suite');
let app;
try{
 app=await electron.launch({...(executable?{executablePath:executable}:{}),args:executable?(process.platform==='linux'?['--no-sandbox']:[]):['.'],env,timeout:60000});
 const page=await app.firstWindow();page.setDefaultTimeout(20000);await dismissStartupSessions(page);
 // The smoke window is hidden. Keep its resize/paint callbacks running as they
 // would in the visible installed app before selecting text in a new split.
 await app.evaluate(({BrowserWindow})=>{for(const window of BrowserWindow.getAllWindows())window.webContents.setBackgroundThrottling(false);});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 // Match Electron's Promise-returning API, including delayed writes, without
 // reading or replacing the user's real system clipboard.
 await app.evaluate(({clipboard})=>{
  const state=globalThis.__hornetClipboardFixture={text:'initial',failWrite:false};
  clipboard.readText=async()=>{await new Promise(r=>setTimeout(r,15));return state.text;};
  clipboard.writeText=async text=>{await new Promise(r=>setTimeout(r,80));if(state.failWrite)throw new Error('fixture clipboard denied');state.text=text;};
 });
 const setClipboard=text=>app.evaluate((_electron,text)=>{globalThis.__hornetClipboardFixture.text=text;},text);
 const clipboard=()=>app.evaluate(()=>globalThis.__hornetClipboardFixture.text);
 const roundTrip=await page.evaluate(async()=>{const write=window.hornet.clipboard.write('clipboard 世界');const read=window.hornet.clipboard.read();await write;return read;});
 expect(roundTrip).toBe('clipboard 世界');
 const menu=async(group,item)=>{await page.getByRole('navigation',{name:'应用菜单'}).getByRole('button',{name:group,exact:true}).click();await page.getByRole('menuitem',{name:item,exact:true}).click();};
 await page.getByLabel('快速连接地址',{exact:true}).fill('tester@127.0.0.1:'+server.port);
 await page.locator('.quick-connect-bar').getByRole('button',{name:'连接',exact:true}).click();
 await page.getByLabel('名称',{exact:true}).fill('Clipboard fixture');await page.getByRole('button',{name:'保存并连接',exact:true}).click();
 await page.getByLabel('认证信息',{exact:true}).fill('test-password');await page.getByRole('button',{name:'继续连接',exact:true}).click();await page.getByRole('button',{name:'已核对，信任此主机',exact:true}).click();
 const first=page.locator('.terminal-cell').first();await expect(first).toContainText('fixture ready');
 const selectFixture=async cell=>{
  // Flush the clipped pane's layout before measuring its glyph coordinates.
  await cell.locator('.terminal-host').click({position:{x:150,y:50}});
  const text=cell.locator('.xterm-rows').getByText('fixture ready',{exact:true}).first();await expect(text).toBeVisible();
  let box,previous;
  // Fitting a split replaces xterm's text spans; wait for the new span and its
  // geometry instead of using a node that disappears between two RPC calls.
  await expect.poll(async()=>{const current=await text.evaluate(node=>{if(!node.isConnected)return null;const rect=node.getBoundingClientRect();return {x:rect.x,y:rect.y,width:rect.width,height:rect.height};});if(!current||!current.width||!current.height){previous=undefined;return false;}const key=JSON.stringify(current),stable=key===previous;previous=key;box=current;return stable;},{intervals:[20,40,80,100]}).toBe(true);
  // xterm's screen receives mouse events; its text spans are pointer-events:none.
  await page.mouse.dblclick(box.x+4,box.y+4);
 };
 await selectFixture(first);await menu('编辑','复制');await expect.poll(clipboard).toBe('fixture');
 await menu('编辑','粘贴');await expect.poll(()=>server.shellInputs.find(([pid])=>pid===1001)?.[1]).toBe('fixture');
 await expect(first.locator('.xterm-helper-textarea')).toBeFocused();
 await page.getByLabel('快速连接地址',{exact:true}).fill('Clipboard fixture');await page.locator('.quick-connect-bar').getByRole('button',{name:'连接',exact:true}).click();await expect.poll(()=>server.shellCount).toBe(2);
 const tabs=page.locator('.tabs').getByRole('button',{name:'>_ Clipboard fixture · 终端',exact:true});
 await tabs.first().click({button:'right'});await page.getByRole('menuitem',{name:'水平分割',exact:true}).click();
 const second=page.locator('.terminal-cell').nth(1);await expect(second).toBeVisible();
 await expect(second.locator('.terminal-host')).toBeVisible();
 await setClipboard('selection marker');await selectFixture(second);await page.keyboard.press('Control+Shift+C');await expect.poll(clipboard).toBe('fixture');
 const context=page.getByRole('menu',{name:'终端内容菜单',exact:true});
 const openContext=async cell=>{await cell.locator('.terminal-host').click({button:'right',position:{x:150,y:50}});await expect(context).toBeVisible();};
 await setClipboard('previous clipboard');await openContext(second);
 await expect(second).toHaveClass(/selected/);await expect(context.getByRole('menuitem',{name:'复制',exact:true})).toBeEnabled();
 if(!executable)await page.screenshot({path:'test-results/terminal-context-menu.png'});
 await context.getByRole('menuitem',{name:'复制',exact:true}).click();await expect.poll(clipboard).toBe('fixture');
 await tabs.first().click();
 await openContext(second);await context.getByRole('menuitem',{name:'粘贴',exact:true}).click();
 await expect.poll(()=>server.shellInputs.find(([pid])=>pid===1002)?.[1]).toBe('fixture');
 expect(server.shellInputs.find(([pid])=>pid===1001)?.[1]).toBe('fixture');
 await expect(second.locator('.xterm-helper-textarea')).toBeFocused();
 await second.locator('.xterm-helper-textarea').focus();await page.keyboard.press('Shift+F10');await expect(context).toBeVisible();await page.keyboard.press('Escape');await expect(context).toHaveCount(0);await expect(second.locator('.xterm-helper-textarea')).toBeFocused();
 await openContext(second);await context.getByRole('menuitem',{name:'搜索终端',exact:true}).click();await page.getByLabel('搜索终端内容').fill('fixture');await page.getByRole('button',{name:'下一个',exact:true}).click();await page.getByRole('button',{name:'关闭终端搜索',exact:true}).click();
 await openContext(second);await expect(context.getByRole('menuitem',{name:'复制',exact:true})).toBeDisabled();await context.getByRole('menuitem',{name:'全选',exact:true}).click();
 await openContext(second);await context.getByRole('menuitem',{name:'复制',exact:true}).click();await expect.poll(clipboard).toContain('fixture ready');
 const before=server.shellInputs.find(([pid])=>pid===1002)?.[1];await setClipboard('first_line\nsecond_line');
 page.once('dialog',dialog=>dialog.dismiss());await openContext(second);await context.getByRole('menuitem',{name:'粘贴',exact:true}).click();await page.waitForTimeout(150);expect(server.shellInputs.find(([pid])=>pid===1002)?.[1]).toBe(before);
 await setClipboard('shortcut_text');await second.locator('.xterm-helper-textarea').focus();await page.keyboard.press('Control+Shift+V');await expect.poll(()=>server.shellInputs.find(([pid])=>pid===1002)?.[1]).toBe(before+'shortcut_text');
 await setClipboard('x'.repeat(131073));const limit=await page.evaluate(async()=>{try{await window.hornet.clipboard.read();return '';}catch(error){return error.message;}});expect(limit).toContain('FILE_LIMIT');expect(limit).not.toContain('could not be cloned');
 await app.evaluate(()=>{globalThis.__hornetClipboardFixture.failWrite=true;});const writeFailure=await page.evaluate(async()=>{try{await window.hornet.clipboard.write('blocked');return '';}catch(error){return error.message;}});expect(writeFailure).toContain('IPC004');
 await app.evaluate(()=>{globalThis.__hornetClipboardFixture.failWrite=false;});await setClipboard('recovered');expect(await page.evaluate(()=>window.hornet.clipboard.read())).toBe('recovered');
 await openContext(second);await context.getByRole('menuitem',{name:'重命名终端',exact:true}).click();
 await page.getByLabel('终端标题',{exact:true}).fill('Renamed pane');await page.getByRole('button',{name:'保存标题',exact:true}).click();
 await expect(second.locator('.tabs')).toContainText('Renamed pane');await expect(first.locator('.tabs')).toContainText('Clipboard fixture');expect(server.shellCount).toBe(2);
 const id=await second.getAttribute('data-terminal-id');await openContext(second);await context.getByRole('menuitem',{name:'断开',exact:true}).click();await expect.poll(()=>server.shellCount).toBe(2);await page.waitForTimeout(100);await openContext(second);await expect(context.getByRole('menuitem',{name:'粘贴',exact:true})).toBeDisabled();await page.keyboard.press('Escape');
 if(!executable)await page.screenshot({path:'test-results/terminal-disconnected.png'});
 await expect(second.locator('.terminal-disconnected')).toContainText('已断开');await expect(second.locator('.tabs')).toContainText('已断开');
 await openContext(second);await expect(context.getByRole('menuitem',{name:'断开',exact:true})).toBeDisabled();await context.getByRole('menuitem',{name:'重新连接',exact:true}).click();
 await expect.poll(()=>server.shellCount).toBe(3);await expect(second).toHaveAttribute('data-terminal-id',/.+/);await expect.poll(()=>second.getAttribute('data-terminal-id')).not.toBe(id);
 await expect(second.locator('.terminal-disconnected')).toHaveCount(0);await expect(second.locator('.tabs')).toContainText('Renamed pane');expect(server.authCount).toBe(1);
 server.disconnect();await expect(first.locator('.terminal-disconnected')).toBeVisible();await expect(second.locator('.terminal-disconnected')).toBeVisible();
 await expect(first.locator('.terminal-host')).toContainText('fixture ready');await expect(second.locator('.terminal-host')).toContainText('fixture ready');
 await openContext(second);await context.getByRole('menuitem',{name:'全选',exact:true}).click();await openContext(second);await context.getByRole('menuitem',{name:'复制',exact:true}).click();await expect.poll(clipboard).toContain('fixture ready');
 await openContext(second);await context.getByRole('menuitem',{name:'关闭当前标签',exact:true}).click();await expect(page.locator('.terminal-cell')).toHaveCount(1);
 expect(errors).toEqual([]);await expect(page.locator('.error-banner')).toHaveCount(0);
 console.log('Terminal clipboard passed: async IPC, ordered copy/paste, mouse selection, content context menu, selected split targeting, keyboard menu/shortcut, multiline cancellation, limits, rejected writes, recovery and closed-session guard.');
}finally{
 if(app)await app.evaluate(({app})=>app.exit(0)).catch(()=>{});
 await server.close();await rm(data,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
