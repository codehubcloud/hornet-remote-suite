module.exports = {
  appId: 'com.codehubcloud.hornetremotesuite',
  productName: 'Hornet Remote Suite',
  // npm ci already installed the matching, checksum-verified Electron runtime.
  electronDist: () => require('node:path').dirname(require('electron')),
  copyright: 'Copyright © 2026 codehubcloud',
  directories: { output: 'release' },
  artifactName: 'Hornet-Remote-Suite-${version}-${os}-${arch}.${ext}',
  asar: true,
  // These adapters use Node-API. Rebuilding serialport for Electron unnecessarily
  // discards its portable prebuilt binary. Verify them using Electron instead.
  npmRebuild: false,
  beforePack: './tools/verify-native.cjs',
  files: [
    'dist/main.cjs', 'dist/preload.cjs', 'dist/host.cjs', 'dist/schema.sql',
    'dist/renderer/**/*', 'dist/NativeHost.exe',
    '!**/*.map', '!**/*.ts', '!**/*.tsx', '!**/*.pdb', '!**/test{,s}/**',
  ],
  asarUnpack: [
    'dist/host.cjs', 'dist/schema.sql', 'dist/NativeHost.exe',
    // The utility process starts from a real filesystem path. Keep its whole
    // runtime dependency tree beside it, including ssh2's transitive modules.
    'node_modules/**',
  ],
  afterPack: './tools/audit-package.cjs',
  publish: null,
  win: { artifactName: 'Hornet-Remote-Suite-${version}-windows-${arch}.${ext}', target: [{ target: 'nsis', arch: ['x64'] }] },
  nsis: {
    oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true, createStartMenuShortcut: true,
    shortcutName: 'Hornet Remote Suite', deleteAppDataOnUninstall: false,
    differentialPackage: false,
  },
  mac: { artifactName: 'Hornet-Remote-Suite-${version}-macos-${arch}.${ext}', target: 'dmg', category: 'public.app-category.developer-tools' },
  linux: { target: ['AppImage', 'deb'], category: 'Network', maintainer: 'codehubcloud' },
};
