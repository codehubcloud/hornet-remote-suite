// Only compiled first-party runtime files may leave the private repository.
const { listPackage } = require('@electron/asar');
const { join } = require('node:path');
const { existsSync } = require('node:fs');
module.exports = async context => {
  const resources = context.electronPlatformName === 'darwin'
    ? join(context.appOutDir, context.packager.appInfo.productFilename + '.app', 'Contents', 'Resources')
    : join(context.appOutDir, 'resources');
  const entries = listPackage(join(resources, 'app.asar')).map(p => p.replace(/^[/\\]+/, '').replace(/\\/g, '/'));
  for (const entry of entries) {
    if (entry === 'package.json' || entry === 'node_modules' || entry.startsWith('node_modules/')) continue;
    if (!/^dist(?:\/|$)/.test(entry) || /\.(?:map|tsx?)$/i.test(entry)) {
      throw new Error('Unexpected first-party file in public package: ' + entry);
    }
    if (entry !== 'dist' && !/^dist\/(?:main\.cjs|preload\.cjs|host\.cjs|schema\.sql|icon\.(?:png|ico)|NativeHost\.exe|renderer(?:\/|$))$/.test(entry)
        && !entry.startsWith('dist/renderer/')) throw new Error('Unexpected build output: ' + entry);
  }
  for (const entry of ['dist/main.cjs', 'dist/preload.cjs', 'dist/host.cjs', 'dist/schema.sql', 'dist/icon.png', 'dist/icon.ico', 'dist/renderer/logo.png','dist/renderer/index.html']) {
    if (!entries.includes(entry)) throw new Error('Missing runtime file: ' + entry);
  }
  for (const entry of ['host.cjs', 'schema.sql', ...(context.electronPlatformName === 'win32' ? ['NativeHost.exe'] : [])]) {
    if (!existsSync(join(resources, 'app.asar.unpacked', 'dist', entry))) throw new Error('Missing unpacked runtime: ' + entry);
  }
  console.log('Public package audit passed: compiled runtime only; no first-party source or source maps.');
};
