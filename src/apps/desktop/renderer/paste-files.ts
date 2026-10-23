import type { LocalDirectory } from '../../../packages/contracts/local-files';
import { useFileClipboard } from './file-clipboard';
import { t as tr } from './i18n';
type Clip=NonNullable<ReturnType<typeof useFileClipboard.getState>['value']>;
async function tree(request:Parameters<typeof window.hornet.treeTransfer.preview>[0]){
 const preview=await window.hornet.treeTransfer.preview(request);
 try{if(!window.confirm(tr('确认粘贴目录？')+'\n'+preview.actions.length+' '+tr('个条目')))return;const result=await window.hornet.treeTransfer.execute(preview.planId);if(result.error)throw new Error(result.error);}finally{await window.hornet.treeTransfer.discard(preview.planId).catch(()=>{});}
}
export async function pasteToLocal(clipboard:Clip,directory:LocalDirectory){
 if(clipboard.source==='local'){for(const path of clipboard.paths)await window.hornet.localFiles.copy(clipboard.rootId,path,directory.rootId,directory.path);return;}
 for(const file of clipboard.files){
  if(file.kind==='directory'){const index=file.path.lastIndexOf('/');await tree({connectionId:clipboard.connectionId,rootId:directory.rootId,localPath:directory.path,remotePath:file.path.slice(0,index)||'/',direction:'download',names:[file.name],policy:'skip'});}
  else if(file.kind==='file'){const grant=await window.hornet.localFiles.grant(directory.rootId,directory.path,'download',file.name);await window.hornet.transfer.start(clipboard.connectionId,'download',grant.pathGrantId,file.path,crypto.randomUUID());}
 }
}
export async function pasteToRemote(clipboard:Clip,connectionId:string,destination:string){
 if(clipboard.source!=='local')return;
 for(const path of clipboard.paths){const normalized=path.replaceAll('\\','/'),index=normalized.lastIndexOf('/'),parent=normalized.slice(0,index<0?0:index),name=normalized.slice(index+1);const page=await window.hornet.localFiles.list(clipboard.rootId,parent),entry=page.entries.find(entry=>entry.name===name);if(!entry)throw new Error(tr('源文件已不存在。'));
  if(entry.kind==='directory')await tree({connectionId,rootId:clipboard.rootId,localPath:parent,remotePath:destination,direction:'upload',names:[name],policy:'skip'});
  else if(entry.kind==='file'){const grant=await window.hornet.localFiles.grant(clipboard.rootId,path,'upload');await window.hornet.transfer.start(connectionId,'upload',grant.pathGrantId,(destination==='/'?'':destination)+'/'+name,crypto.randomUUID());}
 }
}
