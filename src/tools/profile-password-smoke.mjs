import { _electron as electron,expect as baseExpect } from '@playwright/test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp,mkdir,readFile,rm } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { dismissStartupSessions } from './session-dialog-helper.mjs';
const expect=baseExpect.configure({timeout:25000});
await mkdir('test-results',{recursive:true});
await build({entryPoints:['tests/fixtures/ssh-server.ts'],outfile:'test-results/profile-password-fixture.cjs',bundle:true,platform:'node',format:'cjs',external:['ssh2']});
const server=await createRequire(import.meta.url)(resolve('test-results/profile-password-fixture.cjs')).sshFixture();
const data=await mkdtemp(join(tmpdir(),'hornet-profile-password-'));
const env={...process.env,HORNET_USER_DATA:data,HORNET_SMOKE:'1'};delete env.ELECTRON_RUN_AS_NODE;
let executable=process.env.HORNET_PACKAGED_EXECUTABLE;
if(!executable&&process.argv.includes('--packaged'))executable=process.platform==='win32'?resolve('release/win-unpacked/Hornet Remote Suite.exe'):process.platform==='darwin'?resolve('release',process.arch==='arm64'?'mac-arm64':'mac','Hornet Remote Suite.app/Contents/MacOS/Hornet Remote Suite'):resolve('release',process.arch==='arm64'?'linux-arm64-unpacked':'linux-unpacked','hornet-remote-suite');
let app;
try{
 app=await electron.launch({...(executable?{executablePath:executable}:{}),args:executable?(process.platform==='linux'?['--no-sandbox']:[]):process.platform==='linux'?['--no-sandbox','.']:['.'],env,timeout:60000});
 const page=await app.firstWindow();page.setDefaultTimeout(25000);await dismissStartupSessions(page);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await app.evaluate(({safeStorage,BrowserWindow})=>{
  if(process.platform!=='win32'){safeStorage.isEncryptionAvailable=()=>true;safeStorage.getSelectedStorageBackend=()=> 'test-keyring';safeStorage.encryptString=s=>Buffer.from(s).map(b=>b^0xa5);safeStorage.decryptString=b=>Buffer.from(b).map(b=>b^0xa5).toString();}
  const decrypt=safeStorage.decryptString.bind(safeStorage);globalThis.__passwordReads=0;safeStorage.decryptString=buffer=>{globalThis.__passwordReads++;return decrypt(buffer);};
  for(const win of BrowserWindow.getAllWindows()){win.webContents.setBackgroundThrottling(false);win.showInactive();}
 });
 let profile=await page.evaluate(port=>window.hornet.profiles.save({profileId:crypto.randomUUID(),revision:0,name:'Password fixture',host:'127.0.0.1',port,username:'tester',group:'',authType:'password'},0,{mode:'save',password:'test-password'}),server.port);
 const dialog=page.locator('.profile-dialog'),password=dialog.getByLabel('连接密码',{exact:true});
 const open=async()=>{await page.reload();await page.getByRole('button',{name:'操作 Password fixture',exact:true}).click();await page.getByRole('menuitem',{name:'编辑连接',exact:true}).click();await expect(password).toHaveAttribute('placeholder','••••••••');await expect(password).toHaveAttribute('type','password');await expect(password).toHaveValue('');};
 const reveal=async expected=>{await dialog.getByRole('button',{name:'显示密码',exact:true}).click();await expect(password).toHaveAttribute('type','text');await expect(password).toHaveValue(expected);};
 const hide=async()=>{await dialog.getByRole('button',{name:'隐藏密码',exact:true}).click();await expect(password).toHaveAttribute('type','password');};
 const save=async()=>{await dialog.getByRole('button',{name:'保存配置',exact:true}).click();await expect(dialog).toHaveCount(0);profile=(await page.evaluate(()=>window.hornet.profiles.list()))[0];};
 await open();expect(await app.evaluate(()=>globalThis.__passwordReads)).toBe(0);
 await reveal('test-password');expect(await app.evaluate(()=>globalThis.__passwordReads)).toBe(1);
 await hide();await expect(password).toHaveValue('');await expect(password).toHaveAttribute('placeholder','••••••••');
 await page.screenshot({path:'test-results/profile-password-masked.png'});
 await reveal('test-password');await save();await open();await reveal('test-password');
 // Changing the endpoint must not reuse a revealed old password.
 await dialog.getByLabel('主机',{exact:true}).fill('other.invalid');await expect(password).toHaveAttribute('type','password');await expect(password).toHaveValue('');await expect(password).not.toHaveAttribute('placeholder','••••••••');
 const reads=await app.evaluate(()=>globalThis.__passwordReads);await reveal('');expect(await app.evaluate(()=>globalThis.__passwordReads)).toBe(reads);
 await dialog.getByLabel('主机',{exact:true}).fill('127.0.0.1');await expect(password).toHaveAttribute('placeholder','••••••••');await expect(password).toHaveAttribute('type','password');
 await password.fill('replacement-password');await reveal('replacement-password');await save();await open();await reveal('replacement-password');
 // An intentionally edited password is the only one written back as plaintext input.
 await password.fill('test-password');await save();await open();await reveal('test-password');await dialog.getByRole('button',{name:'取消',exact:true}).click();await open();
 await page.evaluate(()=>window.hornet.auth.lock());await dialog.getByRole('button',{name:'显示密码',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('VAULT_UNAVAILABLE');await expect(password).toHaveAttribute('type','password');await expect(password).toHaveValue('');await expect(password).toHaveAttribute('placeholder','••••••••');await dialog.getByRole('button',{name:'取消',exact:true}).click();
 profile=await page.evaluate(p=>window.hornet.profiles.save(p,p.revision,{mode:'save',password:'test-password'}),profile);
 await page.reload();await page.getByLabel('快速连接地址',{exact:true}).fill('Password fixture');await page.locator('.quick-connect-bar').getByRole('button',{name:'连接',exact:true}).click();await page.getByRole('button',{name:'已核对，信任此主机',exact:true}).click();await expect(page.locator('.terminal-cell')).toContainText('fixture ready');await expect(page.getByLabel('认证信息',{exact:true})).toHaveCount(0);
 expect(await readFile(join(data,'credentials','vault.json'),'utf8')).not.toContain('test-password');expect(JSON.stringify(await page.evaluate(()=>window.hornet.profiles.list()))).not.toContain('test-password');expect(await page.evaluate(()=>JSON.stringify(localStorage))).not.toContain('test-password');expect(errors).toEqual([]);
 console.log('Profile password passed: masked reopening without decryption, eye reveal/hide, keep on save, edited password roundtrip, endpoint clearing, locked-vault failure, encrypted storage and real SSH auto-login.');
}finally{
 if(app)await app.evaluate(({app})=>app.exit(0)).catch(()=>{});
 await server.close();await rm(data,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
