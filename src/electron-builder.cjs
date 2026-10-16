module.exports = {
  appId: 'com.codehubcloud.hornetremotesuite',
  productName: 'Hornet Remote Suite',
  // prepare:runtime installed the matching, checksum-verified Electron runtime.
  electronDist: () => require('node:path').join(require('node:path').dirname(require.resolve('electron/package.json')), 'dist'),
  copyright: 'Copyright © 2026 codehubcloud',
  directories: { output: process.env.HORNET_PACKAGE_OUTPUT || 'release' },
  artifactName: 'Hornet-Remote-Suite-${version}-${os}-${arch}.${ext}',
  asar: true,
  // These adapters use Node-API. Rebuilding serialport for Electron unnecessarily
  // discards its portable prebuilt binary. Verify them using Electron instead.
  npmRebuild: false,
  beforePack: './tools/verify-native.cjs',
  files: [
    'dist/main.cjs', 'dist/preload.cjs', 'dist/host.cjs', 'dist/schema.sql', 'dist/icon.png', 'dist/icon.ico',
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
  win: { icon:'build/icons/icon.ico', artifactName: 'Hornet-Remote-Suite-${version}-windows-${arch}.${ext}', target: [{ target: 'nsis', arch: ['x64'] }] },
  nsis: {
    oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true, createStartMenuShortcut: true,
    shortcutName: 'Hornet Remote Suite', deleteAppDataOnUninstall: false,
    installerIcon:'build/icons/icon.ico',uninstallerIcon:'build/icons/icon.ico',installerHeaderIcon:'build/icons/icon.ico',
    differentialPackage: false,
  },
  mac: { icon:'build/icons/icon.icns', artifactName: 'Hornet-Remote-Suite-${version}-macos-${arch}.${ext}', target: 'dmg', category: 'public.app-category.developer-tools' },
  linux: { icon:'build/icons/png',target: ['AppImage', 'deb'], category: 'Network', maintainer: 'codehubcloud' },
};
