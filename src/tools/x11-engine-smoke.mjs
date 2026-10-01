import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp,writeFile,rm,mkdir,readdir } from 'node:fs/promises';
import { resolve,join,dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn,execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
const executable=resolve(process.argv[2]??'.cache/x11-engine/vcxsrv/vcxsrv.exe');
await build({entryPoints:['services/x11/engine.ts'],outfile:'dist/x11-engine-test.cjs',bundle:true,platform:'node',format:'cjs'});
const require=createRequire(import.meta.url),{XServers,probeDisplay,encodeAuthority}=require(resolve('dist/x11-engine-test.cjs'));
const root=await mkdtemp(join(tmpdir(),'hornet-x11-engine-')),servers=new XServers(root),children=[];
try{
 await servers.configure(executable);
 const options={mode:'multiWindow',dpi:96,allowNetworkListener:true},abort=new AbortController();
 const exits=[];
 const first=await servers.start(options,abort.signal,error=>exits.push(error.message));
 const second=await servers.start(options,abort.signal,error=>exits.push(error.message));
 assert.notEqual(first.display,second.display);
 assert.equal(await probeDisplay(first.port,first.cookie),true);
 assert.equal(await probeDisplay(second.port,first.cookie),false);
 assert.equal(await probeDisplay(first.port,second.cookie),false);
 for(const [index,display] of [first,second].entries()){
   const authority=join(root,'test-authority-'+index);await writeFile(authority,encodeAuthority(display.display,display.cookie),{mode:0o600});
   const env={...process.env,XAUTHORITY:authority};
   const child=spawn(join(dirname(executable),'xclock.exe'),['-display','127.0.0.1:'+display.display,'-title','Hornet X11 smoke '+index,'-geometry','220x220+'+(50+index*260)+'+50'],{env,windowsHide:true,stdio:'ignore'});children.push(child);
   let tree='';const deadline=Date.now()+10000;
   while(Date.now()<deadline){const result=await promisify(execFile)(join(dirname(executable),'xwininfo.exe'),['-display','127.0.0.1:'+display.display,'-root','-tree'],{env,windowsHide:true,timeout:2000});tree=result.stdout;if(tree.includes('Hornet X11 smoke '+index))break;await new Promise(r=>setTimeout(r,150));}
   assert.match(tree,new RegExp('Hornet X11 smoke '+index));
   assert.ok(!tree.includes('Hornet X11 smoke '+(1-index)),'Other display window leaked into this display');
 }
 console.log('Two real xclock windows mapped on isolated displays; cross-cookie authentication rejected.');
 await first.stop();assert.equal(await probeDisplay(second.port,second.cookie),true);
 await second.stop();assert.equal(exits.length,0);
 assert.ok(!(await readdir(root)).some(name=>name.startsWith('session-')),'Native authority folders survived stop');
 await mkdir('test-results',{recursive:true});
 await writeFile('test-results/x11-engine.json',JSON.stringify({engine:await servers.status(),twoRealXclockWindows:true,crossCookieRejected:true,independentStop:true,authorityCleanup:true},null,2));
 console.log('Independent stop and authority cleanup passed.');
}finally{
 for(const child of children)child.kill();await servers.stop();await rm(root,{recursive:true,force:true});
}
