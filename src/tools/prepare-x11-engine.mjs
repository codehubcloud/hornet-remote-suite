// Fetch an upstream engine into the project's ignored test cache. No system installation.
import { mkdir,writeFile,readFile,rename } from 'node:fs/promises';
import { createWriteStream,createReadStream,existsSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve,join } from 'node:path';
const version='21.1.16.1',root=resolve('.cache/x11-engine'),archive=join(root,'vcxsrv-'+version+'.exe');
const url='https://github.com/marchaesen/vcxsrv/releases/download/'+version+'/vcxsrv-64.'+version+'.installer.exe';
await mkdir(root,{recursive:true});
if(!existsSync(archive)){
 const response=await fetch(url);if(!response.ok||!response.body)throw new Error('Engine download failed: '+response.status);
 await pipeline(Readable.fromWeb(response.body),createWriteStream(archive+'.part'));await rename(archive+'.part',archive);
}
const hash=createHash('sha256');for await(const chunk of createReadStream(archive))hash.update(chunk);
const sha256=hash.digest('hex'),manifest=join(root,'download.json');
if(sha256!=='df7fed8f49665d0592528ab6be9d07111ea73c6848283d128b77690e05b8f90b')throw new Error('Engine archive differs from the recorded 21.1.16.1 artifact');
if(existsSync(manifest)&&JSON.parse(await readFile(manifest,'utf8')).sha256!==sha256)throw new Error('Cached engine checksum changed');
const sevenZip=join(process.env.ProgramFiles,'7-Zip','7z.exe');
execFileSync(sevenZip,['x','-y','-o'+join(root,'vcxsrv'),archive],{stdio:'ignore',windowsHide:true});
await writeFile(manifest,JSON.stringify({version,url,sha256,integrity:'Local download fingerprint; upstream release has no published checksum'},null,2));
console.log(JSON.stringify({version,sha256,executable:join(root,'vcxsrv','vcxsrv.exe')}));
