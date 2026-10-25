import { queueTransfer,type TransferBatch } from './transfer-queue';
import { queueDirectoryTransfer } from './DirectoryTransferHost';
import type { LocalDirectory } from '../../../packages/contracts/local-files';
import { useFileClipboard } from './file-clipboard';
import { t as tr } from './i18n';
type Clip=NonNullable<ReturnType<typeof useFileClipboard.getState>['value']>;
const tree=queueDirectoryTransfer;
export async function pasteToLocal(clipboard:Clip,directory:LocalDirectory){
 if(clipboard.source==='local'){for(const path of clipboard.paths)await window.hornet.localFiles.copy(clipboard.rootId,path,directory.rootId,directory.path);return;}
 const batch:TransferBatch={};for(const file of clipboard.files){if(batch.cancelled)break;
  if(file.kind==='directory'){const index=file.path.lastIndexOf('/');if(!await tree({connectionId:clipboard.connectionId,rootId:directory.rootId,localPath:directory.path,remotePath:file.path.slice(0,index)||'/',direction:'download',names:[file.name],policy:'skip'}))batch.cancelled=true;}
  else if(file.kind==='file'){const grant=await window.hornet.localFiles.grant(directory.rootId,directory.path,'download',file.name,true);await queueTransfer({connectionId:clipboard.connectionId,direction:'download',pathGrantId:grant.pathGrantId,remotePath:file.path},batch);}
 }
}
export async function pasteToRemote(clipboard:Clip,connectionId:string,destination:string){
 if(clipboard.source!=='local')return;
 const batch:TransferBatch={};for(const path of clipboard.paths){if(batch.cancelled)break;const normalized=path.replaceAll('\\','/'),index=normalized.lastIndexOf('/'),parent=normalized.slice(0,index<0?0:index),name=normalized.slice(index+1);const page=await window.hornet.localFiles.list(clipboard.rootId,parent),entry=page.entries.find(entry=>entry.name===name);if(!entry)throw new Error(tr('源文件已不存在。'));
  if(entry.kind==='directory'){if(!await tree({connectionId,rootId:clipboard.rootId,localPath:parent,remotePath:destination,direction:'upload',names:[name],policy:'skip'}))batch.cancelled=true;}
  else if(entry.kind==='file'){const grant=await window.hornet.localFiles.grant(clipboard.rootId,path,'upload');await queueTransfer({connectionId,direction:'upload',pathGrantId:grant.pathGrantId,remotePath:(destination==='/'?'':destination)+'/'+name},batch);}
 }
}
