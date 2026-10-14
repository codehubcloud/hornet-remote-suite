import { readdir,readFile } from 'node:fs/promises';
import { parseSync } from 'rolldown/utils';
const root=new URL('../apps/desktop/renderer/',import.meta.url);
const catalog=parseSync('en.ts',await readFile(new URL('locales/en.ts',root),'utf8'),{lang:'ts'}).program;
const translations=new Set();
function visit(node,fn){if(!node||typeof node!=='object')return;fn(node);for(const [key,value]of Object.entries(node)){if(key==='parent')continue;if(Array.isArray(value))value.forEach(child=>visit(child,fn));else if(value&&typeof value==='object')visit(value,fn);}}
visit(catalog,node=>{if(node.type==='Property'&&typeof node.key?.value==='string')translations.add(node.key.value);});
const missing=[];
for(const file of ['en.ts','zh-TW.ts','native-ui.ts']){
 const ast=parseSync(file,await readFile(new URL('locales/'+file,root),'utf8'),{lang:'ts'});
 if(ast.errors.length)throw new Error('Cannot parse '+file);
 const seen=new Set();
 visit(ast.program,node=>{
  if(node.type!=='Property'||typeof node.key?.value!=='string')return;
  const key=node.key.value;
  if(seen.has(key))missing.push(file+': duplicate key '+key);seen.add(key);
  if(!translations.has(key))missing.push(file+': unknown key '+key);
  const values=file==='native-ui.ts'?node.value?.elements?.map(value=>value?.value):[node.value?.value];
  if(!values||(file==='native-ui.ts'&&values.length!==5)){missing.push(file+': invalid language columns '+key);return;}
  for(const value of values){
   if(typeof value!=='string'||!value.trim()){missing.push(file+': empty translation '+key);continue;}
   const placeholders=text=>[...text.matchAll(/\{(\w+)\}/g)].map(match=>match[1]).sort().join(',');
   if(placeholders(value)!==placeholders(key))missing.push(file+': placeholder mismatch '+key);
  }
 });
 if(file==='zh-TW.ts')for(const key of translations)if(!seen.has(key))missing.push(file+': missing translation '+key);
}
for(const file of await readdir(root)){
 if(!/\.tsx?$/.test(file))continue;
 const ast=parseSync(file,await readFile(new URL(file,root),'utf8'),{lang:file.endsWith('tsx')?'tsx':'ts'});
 if(ast.errors.length)throw new Error('Cannot parse '+file);
 visit(ast.program,node=>{
  const value=node.type==='CallExpression'&&['t','tr','unavailable','workspaceItem'].includes(node.callee?.name)?node.arguments[0]?.value:node.type==='Property'&&node.key?.name==='label'?node.value?.value:undefined;
  if(typeof value==='string'&&/[\u3400-\u9fff]/.test(value)&&!translations.has(value.trim()))missing.push(file+': '+value);
 });
}
if(missing.length){console.error([...new Set(missing)].join('\n'));process.exitCode=1;}else console.log('Locale checks passed: English coverage, complete Traditional Chinese catalog, five native UI catalogs and consistent placeholders.');
