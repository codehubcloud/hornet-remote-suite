import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp,rm,writeFile,mkdir } from 'node:fs/promises';
import { resolve,join,dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
const executable=resolve(process.argv[2]??'.cache/x11-engine/vcxsrv/vcxsrv.exe');
await build({entryPoints:{'x11-engine-test':'services/x11/engine.ts','xdmcp-test':'services/x11/xdmcp.ts','xdmcp-fixture':'tests/fixtures/xdmcp-server.ts'},outdir:'dist',outExtension:{'.js':'.cjs'},bundle:true,platform:'node',format:'cjs'});
const require=createRequire(import.meta.url),{XServers,probeDisplay}=require(resolve('dist/x11-engine-test.cjs')),{XdmcpService}=require(resolve('dist/xdmcp-test.cjs'));
const root=await mkdtemp(join(tmpdir(),'hornet-xdmcp-')),engines=new XServers(root),xdmcp=new XdmcpService(engines),fixture=await require(resolve('dist/xdmcp-fixture.cjs')).xdmcpFixture(dirname(executable));
try{
 await engines.configure(executable);
 const config={host:'127.0.0.1',localAddress:'127.0.0.1',port:fixture.port,display:70,dpi:96,allowUnencrypted:true,allowNetworkListener:true};
 const {id}=await xdmcp.open('smoke',config);
 let tree='';const deadline=Date.now()+15000;
 while(Date.now()<deadline){
   if(fixture.error)throw new Error(fixture.error);
   try{tree=(await promisify(execFile)(join(dirname(executable),'xwininfo.exe'),['-display','127.0.0.1:70','-root','-tree'],{env:{...process.env,XAUTHORITY:fixture.authority},windowsHide:true,timeout:2000})).stdout;if(tree.includes('Hornet XDMCP smoke'))break;}catch{}
   await new Promise(r=>setTimeout(r,250));
 }
 assert.equal(fixture.managed,true,JSON.stringify({opcodes:fixture.opcodes,sessions:xdmcp.list('smoke')}));assert.equal(fixture.display,70);assert.match(tree,/Hornet XDMCP smoke/);
 assert.equal(await probeDisplay(6070,fixture.cookie),true);
 await xdmcp.close('smoke',id);await engines.stop();assert.equal(xdmcp.list('smoke').length,0);
 await mkdir('test-results',{recursive:true});await writeFile('test-results/xdmcp.json',JSON.stringify({realVcXsrv:true,queryRequestAcceptManage:true,realXclockWindow:true,authentication:'Protocol fixture; no Linux login manager'},null,2));
 console.log('Real VcXsrv XDMCP Query/Request/Accept/Manage and xclock rendering passed. This is not a Linux login acceptance test.');
}finally{await xdmcp.stop();await engines.stop();await fixture.close();await rm(root,{recursive:true,force:true});}
