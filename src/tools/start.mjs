import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const env={...process.env};
delete env.ELECTRON_RUN_AS_NODE;
// Electron is the interactive application: Windows must be allowed to show it.
const child=spawn(require('electron'),['.'],{stdio:'inherit',env,windowsHide:false});
child.on('exit',code=>process.exit(code??1));
child.on('error',error=>{console.error(error.message);process.exit(1);});
