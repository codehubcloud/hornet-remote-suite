import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, rm, readdir, readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { dismissStartupSessions } from './session-dialog-helper.mjs';

let executable = process.env.HORNET_PACKAGED_EXECUTABLE;
if (!executable) {
  if (process.platform === 'win32') executable = resolve('release/win-unpacked/Hornet Remote Suite.exe');
  else if (process.platform === 'darwin') {
    const directory = (await readdir('release')).find(name => name === (process.arch === 'arm64' ? 'mac-arm64' : 'mac'));
    if (!directory) throw new Error('Packaged macOS directory missing.');
    executable = resolve('release', directory, 'Hornet Remote Suite.app/Contents/MacOS/Hornet Remote Suite');
  } else executable = resolve('release', process.arch === 'arm64' ? 'linux-arm64-unpacked' : 'linux-unpacked', 'hornet-remote-suite');
}
await mkdir('test-results', { recursive: true });
await build({ entryPoints: ['tests/fixtures/ssh-server.ts'], outfile: 'test-results/package-fixture.cjs', bundle: true, platform: 'node', format: 'cjs', external: ['ssh2'] });
const server = await createRequire(import.meta.url)(resolve('test-results/package-fixture.cjs')).sshFixture();
const data = await mkdtemp(join(tmpdir(), 'hornet-package-'));
await build({ entryPoints: ['packages/storage/database.ts'], outfile: 'test-results/package-storage.cjs', bundle: true, platform: 'node', format: 'cjs' });
const { Storage } = createRequire(import.meta.url)(resolve('test-results/package-storage.cjs'));
const storage = new Storage(join(data, 'data', 'hornet.db'), resolve('packages/storage/schema.sql'));
const legacyProfile = storage.saveProfile({ profileId: randomUUID(), name: 'Upgrade retained fixture', host: '127.0.0.1', port: server.port, username: 'tester', group: 'upgrade', authType: 'password', revision: 0 }, 0);
const schema = (await readFile('packages/storage/schema.sql', 'utf8')).replace(/\r\n/g, '\n');
const eol = process.env.HORNET_SMOKE_SCHEMA_EOL ?? 'lf';
if (!['lf', 'crlf'].includes(eol)) throw new Error('Invalid fixture schema line endings.');
const oldSchema = eol === 'crlf' ? schema.replace(/\n/g, '\r\n') : schema;
storage.db.prepare('UPDATE schema_migration SET checksum=? WHERE version=1').run(createHash('sha256').update(oldSchema).digest('hex'));
storage.close();
const env = { ...process.env, HORNET_USER_DATA: data, HORNET_SMOKE: '1', HORNET_DIAGNOSTICS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ executablePath: executable, args: process.platform === 'linux' ? ['--no-sandbox'] : [], env, timeout: 60000 });
  console.log('Packaged Electron launched.');
  app.process().stderr.on('data', chunk => process.stderr.write(chunk));
  const page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  await dismissStartupSessions(page);
  console.log('Packaged startup dialog and renderer ready.');
  const retained = await page.evaluate(() => window.hornet.profiles.list());
  if (!retained.some(profile => profile.profileId === legacyProfile.profileId && profile.revision === legacyProfile.revision && profile.name === legacyProfile.name)) throw new Error('Upgrade lost the existing profile.');
  console.log('Legacy ' + eol.toUpperCase() + ' database opened and existing profile retained.');
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.getByRole('region', { name: '快速开始', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '新建连接', exact: true }).click();
  await page.getByLabel('名称', { exact: true }).fill('Packaged loopback test');
  await page.getByLabel('主机', { exact: true }).fill('127.0.0.1');
  await page.getByLabel('端口', { exact: true }).fill(String(server.port));
  await page.getByLabel('用户名', { exact: true }).fill('tester');
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await page.locator('.host .host-top strong').filter({hasText: 'Packaged loopback test'}).dblclick();
  await page.getByLabel('认证信息', { exact: true }).fill('test-password');
  await page.getByRole('button', { name: '继续连接', exact: true }).click();
  await page.getByRole('button', { name: '已核对，信任此主机', exact: true }).click();
  console.log('Loopback SSH authentication completed.');
  await expect(page.locator('.terminal-host')).toBeVisible();
  await expect(page.locator('.terminal-files').getByText('hello.txt', { exact: false })).toBeVisible();
  await expect(page.locator('.xterm-screen')).toContainText('fixture ready');
  const version = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion() }));
  const metadata = await import('../package.json', { with: { type: 'json' } });
  if (!version.packaged || version.version !== metadata.default.version) throw new Error('Packaged app version mismatch.');
  if (process.platform === 'win32') {
    const native = await page.evaluate(() => window.hornet.rdp.probe());
    if (!native.available) throw new Error('Packaged Windows native RDP helper unavailable.');
    const local = await page.evaluate(() => window.hornet.localTerminal.open({ shell: 'cmd', cols: 80, rows: 24 }));
    if (!local.terminalId) throw new Error('Packaged ConPTY local terminal unavailable.');
    await page.evaluate(id => window.hornet.terminal.close(id), local.terminalId);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`Packaged ${process.platform}/${process.arch} ${version.version} passed: actual executable, isolated storage, sandboxed preload, utility process, SSH terminal and SFTP${process.platform === 'win32' ? ', native helper' : ''}.`);
} catch (error) {
  console.error('Packaged smoke failed:', error);
  throw error;
} finally {
  if (app) {
    // Automated tests must not wait for the application's interactive exit prompt.
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
  await server.close();
  await rm(data, { recursive: true, force: true, maxRetries: 4 });
}
