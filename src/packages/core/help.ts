import { z } from 'zod';
import type { HelpLink,UpdateInfo } from '../contracts/help';
export const helpBase='https://github.com/codehubcloud/hornet-remote-suite-release';
export const helpLinks:Record<HelpLink,string>={website:helpBase,support:helpBase+'/issues',feedback:helpBase+'/issues/new?title=Feedback&body=',releases:helpBase+'/releases/latest'};
const version=z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/).max(32);
export function newerVersion(latest:string,current:string){
 const a=version.parse(latest).split('.').map(Number),b=version.parse(current).split('.').map(Number);
 for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]>b[i];}return false;
}
export async function checkForUpdates(current:string,fetcher:typeof fetch):Promise<UpdateInfo>{
 version.parse(current);
 const response=await fetcher('https://api.github.com/repos/codehubcloud/hornet-remote-suite-release/releases/latest',{headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.timeout(10000),redirect:'error'});
 if(!response.ok)throw new Error('Update request failed: HTTP '+response.status);
 if(Number(response.headers.get('content-length')??0)>262144)throw new Error('Update response too large');
 const reader=response.body?.getReader();if(!reader)throw new Error('Missing update response');
 const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>262144)throw new Error('Update response too large');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 const release=z.object({tag_name:z.string(),draft:z.literal(false),prerelease:z.literal(false),body:z.string().max(131072).nullable().optional()}).parse(JSON.parse(new TextDecoder().decode(bytes)));
 const latest=version.parse(release.tag_name.replace(/^v/,''));
 return {current,latest,available:newerVersion(latest,current),url:helpBase+'/releases/tag/v'+latest,notes:release.body??''};
}
