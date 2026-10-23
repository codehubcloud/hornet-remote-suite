import { createReadStream } from 'node:fs';
import { lstat,mkdir,readFile,rename,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { helpBase,newerVersion } from '../../../packages/core/help';
import type { UpdateDownload,UpdateInfo } from '../../../packages/contracts/help';

const receiptSchema=z.object({version:z.string().max(32),fileName:z.string().max(150),size:z.number().int().positive().max(1_500_000_000),sha256:z.string().regex(/^[a-f0-9]{64}$/i),notes:z.string().max(131072)}).strict();
export type UpdateReceipt=z.infer<typeof receiptSchema>;
export function updateInstallerName(version:string,platform:string,arch:string){
 const architecture=arch==='arm64'?'arm64':'x64';
 if(platform==='win32')return `Hornet-Remote-Suite-${version}-windows-x64.exe`;
 if(platform==='darwin')return `Hornet-Remote-Suite-${version}-macos-${architecture}.dmg`;
 if(platform==='linux')return `Hornet-Remote-Suite-${version}-linux-${architecture==='x64'?'amd64':'arm64'}.deb`;
 throw new Error('No update installer is available for this platform.');
}

/** A receipt is written only after a trusted release's checksum is verified.
 * Revalidate the file on recovery and installation; a cancelled installer never
 * consumes it. Paths are derived locally, never accepted from the renderer. */
export class UpdateCache {
 constructor(readonly directory:string,private current:string,private platform:string,private arch:string){}
 private validate(input:unknown){
  const receipt=receiptSchema.parse(input);
  if(!newerVersion(receipt.version,this.current)||receipt.fileName!==updateInstallerName(receipt.version,this.platform,this.arch))throw new Error('Invalid update receipt');
  return receipt;
 }
 path(receipt:UpdateReceipt){return join(this.directory,this.validate(receipt).fileName);}
 async verify(receipt:UpdateReceipt){
  const path=this.path(receipt),info=await lstat(path);
  if(!info.isFile()||info.size!==receipt.size)return false;
  const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);
  return hash.digest('hex')===receipt.sha256.toLowerCase();
 }
 async load():Promise<UpdateReceipt|undefined>{
  try{
   const path=join(this.directory,'pending-update.json'),info=await lstat(path);
   if(!info.isFile()||info.size>1_000_000)return;
   const receipt=this.validate(JSON.parse(await readFile(path,'utf8')));
   return await this.verify(receipt)?receipt:undefined;
  }catch{return undefined;}
 }
 async save(receipt:UpdateReceipt){
  this.validate(receipt);if(!await this.verify(receipt))throw new Error('Downloaded installer failed its integrity check.');
  await mkdir(this.directory,{recursive:true});
  const path=join(this.directory,'pending-update.json');
  await writeFile(path+'.tmp',JSON.stringify(receipt),{mode:0o600});await rename(path+'.tmp',path);
 }
 download(receipt:UpdateReceipt):UpdateDownload{return {fileName:receipt.fileName,size:receipt.size};}
 info(receipt:UpdateReceipt):UpdateInfo{return {current:this.current,latest:receipt.version,available:true,url:`${helpBase}/releases/tag/v${receipt.version}`,notes:receipt.notes,installerAvailable:true,downloaded:this.download(receipt)};}
}
