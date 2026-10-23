import { afterEach,expect,it } from 'vitest';
import { mkdtemp,readFile,rm,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UpdateCache,updateInstallerName,type UpdateReceipt } from '../../apps/desktop/main/update-cache';
const directories:string[]=[];
afterEach(async()=>{await Promise.all(directories.splice(0).map(directory=>rm(directory,{recursive:true,force:true})));});
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'hornet-update-cache-'));directories.push(directory);
 const receipt:UpdateReceipt={version:'0.0.26',fileName:updateInstallerName('0.0.26','win32','x64'),size:9,sha256:createHash('sha256').update('installer').digest('hex'),notes:'Verified release notes'};
 const cache=new UpdateCache(directory,'0.0.25','win32','x64');await writeFile(cache.path(receipt),'installer');
 return {cache,receipt,directory};
}
it('restores verified installers after process restart, retaining them after repeated installation attempts',async()=>{
 const {cache,receipt,directory}=await fixture();await cache.save(receipt);
 const restarted=new UpdateCache(directory,'0.0.25','win32','x64');
 expect(await restarted.load()).toEqual(receipt);
 expect(restarted.info(receipt)).toMatchObject({available:true,latest:'0.0.26',installerAvailable:true,downloaded:{fileName:receipt.fileName,size:9}});
 expect(await restarted.load()).toEqual(receipt);expect(await readFile(cache.path(receipt),'utf8')).toBe('installer');
});
it('rejects corrupt, replaced, missing or only partly downloaded installers',async()=>{
 const {cache,receipt}=await fixture();await cache.save(receipt);
 await writeFile(cache.path(receipt),'corrupted');expect(await cache.load()).toBeUndefined();
 await writeFile(cache.path(receipt),'short');expect(await cache.load()).toBeUndefined();
 await rm(cache.path(receipt));await writeFile(cache.path(receipt)+'.download','installer');expect(await cache.load()).toBeUndefined();
 await expect(cache.save(receipt)).rejects.toThrow();
});
it('never offers a downgrade, wrong-platform package or path from an untrusted receipt',async()=>{
 const {cache,receipt,directory}=await fixture();await cache.save(receipt);
 expect(await new UpdateCache(directory,'0.0.26','win32','x64').load()).toBeUndefined();
 expect(await new UpdateCache(directory,'0.0.27','win32','x64').load()).toBeUndefined();
 expect(await new UpdateCache(directory,'0.0.25','darwin','arm64').load()).toBeUndefined();
 for(const changed of [{fileName:'../outside.exe'},{version:'../0.0.26'},{sha256:'invalid'},{size:1_500_000_001}]){
  await writeFile(join(directory,'pending-update.json'),JSON.stringify({...receipt,...changed}));expect(await cache.load()).toBeUndefined();
 }
 await writeFile(join(directory,'pending-update.json'),'{');expect(await cache.load()).toBeUndefined();
});
