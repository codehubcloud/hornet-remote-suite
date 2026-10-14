const { spawnSync } = require('node:child_process');
module.exports = async context => {
  const arch = { 0: 'ia32', 1: 'x64', 3: 'arm64' }[context.arch];
  if (context.electronPlatformName !== process.platform || arch !== process.arch) {
    throw new Error('Native modules must be packaged on the matching OS and CPU architecture.');
  }
  const result = spawnSync(require('electron'), ['-e', "require('node-pty'); require('serialport'); console.log('Electron native adapters loaded');"], {
    cwd: context.appDir, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', windowsHide: true,
  });
  if (result.error || result.status !== 0 || !result.stdout.includes('Electron native adapters loaded')) {
    throw new Error('Native adapter verification failed in Electron: ' + (result.error?.message ?? result.stderr));
  }
  console.log('Native adapter verification passed in the target Electron runtime.');
};
