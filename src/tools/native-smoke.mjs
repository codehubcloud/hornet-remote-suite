import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
if(process.platform!=='win32')throw new Error('Native smoke requires an interactive Windows desktop.');
for(const op of ['rdpProbe','printers']){
 const result=spawnSync(resolve('dist/NativeHost.exe'),[],{input:JSON.stringify({op})+'\n',encoding:'utf8',timeout:15000,windowsHide:true});
 if(result.error||result.status!==0)throw result.error??new Error('Native helper failed: '+op);
 const value=JSON.parse(result.stdout.trim());
 if(value.error||(op==='rdpProbe'&&!value.available)||(op==='printers'&&!Array.isArray(value.printers)))throw new Error('Invalid native response: '+op);
 console.log(op==='rdpProbe'?'RDP control and enforced security settings initialized.':`Printer enumeration passed (${value.printers.length} printers); no jobs printed.`);
}
