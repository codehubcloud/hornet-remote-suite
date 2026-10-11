import type { FileTree,TreeEntry } from '../../packages/contracts/file-tree';
import { AppError } from '../../packages/core/errors';

export function treeName(name:string,windows=false){
 if(!name||name==='.'||name==='..'||name.length>255||/[\/\\\x00-\x1f\x7f]/.test(name)||
  (windows&&(/[<>:"|?*]/.test(name)||/[. ]$/.test(name)||/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name))))
  throw new AppError('FILE_CONFLICT','不支持的文件名：'+name);
}

// All paths returned by a directory reader are rebuilt from validated basenames.
// Links are visible in the preview but never traversed.
export async function scanTree(root:string,read:(path:string)=>Promise<{entries:TreeEntry[];truncated:boolean}>):Promise<FileTree>{
 const entries:TreeEntry[]=[];const deadline=Date.now()+90000;
 async function visit(path:string,depth:number){
  if(depth>32||Date.now()>deadline)throw new AppError('FILE_LIMIT','目录扫描超过 32 层或 90 秒，请选择较小的目录。');
  const page=await read(path);
  if(page.truncated)throw new AppError('FILE_LIMIT','目录条目过多，无法生成完整预览。');
  const seen=new Set<string>();
  for(const item of page.entries){
   treeName(item.path);
   if(seen.has(item.path))throw new AppError('FILE_CONFLICT','目录返回了重复名称。');
   seen.add(item.path);
   const relative=path?path+'/'+item.path:item.path;
   if(relative.length>4096||entries.length>=5000)throw new AppError('FILE_LIMIT','单次目录操作最多 5000 个条目，请分批处理。');
   if(!Number.isSafeInteger(item.size)||item.size<0||!Number.isFinite(item.modified))throw new AppError('FILE_CONFLICT','文件元数据无效。');
   entries.push({...item,path:relative});
   if(item.kind==='directory')await visit(relative,depth+1);
  }
 }
 await visit('',0);
 entries.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 return {root,entries};
}
