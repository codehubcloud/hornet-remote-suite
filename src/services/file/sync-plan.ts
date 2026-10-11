import { posix } from 'node:path';
import type { FileTree,TreeAction,TreeEntry,TreeRequest } from '../../packages/contracts/file-tree';
import { treeName } from './tree';

// Pure planner: no writes. Both directions use one union, so a path can never
// be overwritten from both sides in the same reviewed plan.
export function planSync(local:FileTree,remote:FileTree,request:TreeRequest,windows=process.platform==='win32'):TreeAction[]{
 const policy=request.policy??'skip',both=request.direction==='bidirectional';
 const key=(path:string)=>windows?path.normalize('NFC').toLowerCase():path;
 const left=new Map(local.entries.map(e=>[key(e.path),e])),right=new Map(remote.entries.map(e=>[key(e.path),e]));
 const selected=new Set(request.names),included=(e:TreeEntry)=>!selected.size||selected.has(e.path.split('/')[0]);
 const entries=both?[...local.entries,...remote.entries]:request.direction==='upload'?local.entries:remote.entries;
 const paths=[...new Set(entries.filter(included).map(e=>key(e.path)))].sort();
 const duplicate=new Set<string>();for(const tree of [local,remote]){const seen=new Set<string>();for(const e of tree.entries){const k=key(e.path);if(seen.has(k))duplicate.add(k);seen.add(k);}}
 const blocked=new Set<string>(),actions:TreeAction[]=[],used=new Set([...left.keys(),...right.keys()]);
 const alternate=(path:string,side:string)=>{const ext=posix.extname(path),base=path.slice(0,path.length-ext.length);for(let n=1;n<10000;n++){const name=base+' ('+side+(n===1?'':' '+n)+')'+ext;try{treeName(posix.basename(name),windows);}catch{return undefined;}if(!used.has(key(name))){used.add(key(name));return name;}}};
 for(const k of paths){
  const l=left.get(k),r=right.get(k),entry=(request.direction==='download'?r:l)??r!;
  let direction:'upload'|'download'=request.direction==='download'?'download':'upload';
  if(both&&!l)direction='download';
  const source=direction==='upload'?l:r,target=direction==='upload'?r:l;
  let reason:string|undefined;
  try{for(const part of entry.path.split('/'))treeName(part,windows&&(both||direction==='download'));}catch(e){reason=(e as Error).message;}
  const ancestors=k.split('/').slice(0,-1).map((_,i)=>k.split('/').slice(0,i+1).join('/'));
  if(entry.path.split('/').some(part=>/^\.hornet-[a-f0-9-]+\.part$/i.test(part)))reason='传输临时文件不参与同步。';
  if(ancestors.some(p=>blocked.has(p)))reason='上级目录存在冲突。';
  else if(duplicate.has(k))reason='目标文件系统无法区分这些名称。';
  else if(l&&r&&l.path!==r.path)reason='两侧名称大小写或 Unicode 形式不同，请先统一名称。';
  else if([l,r].some(e=>e&&(e.kind==='link'||e.kind==='other')))reason='不传输符号链接或特殊文件。';
  else if(l&&r&&l.kind!==r.kind)reason='目标条目类型不同。';
  if(reason){
   blocked.add(k);
   const collisions=duplicate.has(k)?[...new Map([...local.entries,...remote.entries].filter(e=>key(e.path)===k).map(e=>[e.path,e])).values()]:[entry];
   for(const e of collisions)actions.push({path:e.path,kind:e.kind,size:e.size,action:'conflict',reason});
   continue;
  }
  if(!source)continue;
  if(!target){actions.push({path:source.path,direction,kind:source.kind,size:source.size,action:source.kind==='directory'?'mkdir':'copy'});continue;}
  if(source.kind==='directory'){actions.push({path:source.path,kind:'directory',size:0,action:'skip'});continue;}
  if(l?.hash&&l.hash===r?.hash){actions.push({path:entry.path,kind:'file',size:entry.size,action:'skip',reason:'文件内容相同。'});continue;}
  if(policy==='keep-both'){
   const sides:('upload'|'download')[]=both?['upload','download']:[direction];
   for(const d of sides){const original=d==='upload'?l!:r!,name=alternate(original.path,d==='upload'?'local':'remote');actions.push(name?{path:name,sourcePath:original.path,direction:d,kind:'file',size:original.size,action:'copy',reason:'保留双方副本。'}:{path:original.path,direction:d,kind:'file',size:original.size,action:'conflict',reason:'无法生成有效的副本名称。'});}
   continue;
  }
  let chosen:'upload'|'download'|undefined;
  if(policy==='local')chosen='upload';else if(policy==='remote')chosen='download';
  else if(policy==='newer'&&Math.abs(l!.modified-r!.modified)>2000)chosen=l!.modified>r!.modified?'upload':'download';
  if(chosen&&(both||chosen===direction)){const src=chosen==='upload'?l!:r!;actions.push({path:src.path,direction:chosen,kind:'file',size:src.size,action:'replace',reason:'覆盖目标文件。'});}
  else actions.push({path:entry.path,kind:'file',size:entry.size,action:chosen?'skip':'conflict',reason:chosen?'目标侧优先，保留现有内容。':policy==='newer'?'内容不同且修改时间接近，需手动选择优先侧。':'目标文件已存在，保留现有内容。'});
 }
 return actions;
}
