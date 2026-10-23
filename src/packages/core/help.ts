import { z } from 'zod';
import type { HelpLink,UpdateInfo } from '../contracts/help';
import { releaseNotesFromCatalog } from './release-notes';
export const helpBase='https://github.com/codehubcloud/hornet-remote-suite-release';
export const helpLinks:Record<HelpLink,string>={website:'https://codehub.org.cn/products/hornet-remote-suite/',support:helpBase+'/issues',feedback:helpBase+'/issues/new?title=Feedback&body=',releases:helpBase+'/releases/latest'};
const version=z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/).max(32);
export function newerVersion(latest:string,current:string){
 const a=version.parse(latest).split('.').map(Number),b=version.parse(current).split('.').map(Number);
 for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]>b[i];}return false;
}
async function boundedText(response:Response,limit:number){
 if(!response.ok)throw new Error('Update request failed: HTTP '+response.status);
 if(Number(response.headers.get('content-length')??0)>limit)throw new Error('Update response too large');
 const reader=response.body?.getReader();if(!reader)throw new Error('Missing update response');
 const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw new Error('Update response too large');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 return new TextDecoder().decode(bytes);
}
export async function checkForUpdates(current:string,fetcher:typeof fetch):Promise<UpdateInfo>{
 version.parse(current);
 const response=await fetcher('https://api.github.com/repos/codehubcloud/hornet-remote-suite-release/releases/latest',{headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.timeout(10000),redirect:'error'});
 const release=z.object({tag_name:z.string(),draft:z.literal(false),prerelease:z.literal(false),body:z.string().max(131072).nullable().optional(),assets:z.array(z.object({name:z.string(),browser_download_url:z.string().url()})).optional()}).parse(JSON.parse(await boundedText(response,262144)));
 const latest=version.parse(release.tag_name.replace(/^v/,''));
 const arch=process.arch==='arm64'?'arm64':'x64';
 const asset=process.platform==='win32'?`Hornet-Remote-Suite-${latest}-windows-x64.exe`:process.platform==='darwin'?`Hornet-Remote-Suite-${latest}-macos-${arch}.dmg`:process.platform==='linux'?`Hornet-Remote-Suite-${latest}-linux-${arch==='x64'?'amd64':'arm64'}.deb`:'';
 let notes=release.body??'';
 const notesUrl=`${helpBase}/releases/download/v${latest}/release-notes.json`;
 if(release.assets?.some(item=>item.name==='release-notes.json'&&item.browser_download_url===notesUrl)){
  try{
   const translated=await fetcher(notesUrl,{signal:AbortSignal.timeout(5000),redirect:'follow'});
   notes=releaseNotesFromCatalog(JSON.parse(await boundedText(translated,65536)),latest);
  }catch{/* Missing or invalid optional notes must not prevent an update. */}
 }
 return {current,latest,available:newerVersion(latest,current),url:helpBase+'/releases/tag/v'+latest,notes,installerAvailable:!!asset&&!!release.assets?.some(item=>item.name===asset&&item.browser_download_url===helpBase+'/releases/download/v'+latest+'/'+asset)};
}
