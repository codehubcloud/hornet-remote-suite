import { readdir,readFile } from 'node:fs/promises';
import { parseSync } from 'rolldown/utils';
const root=new URL('../apps/desktop/renderer/',import.meta.url);
const catalog=parseSync('en.ts',await readFile(new URL('locales/en.ts',root),'utf8'),{lang:'ts'}).program;
const translations=new Set();
function visit(node,fn){if(!node||typeof node!=='object')return;fn(node);for(const [key,value]of Object.entries(node)){if(key==='parent')continue;if(Array.isArray(value))value.forEach(child=>visit(child,fn));else if(value&&typeof value==='object')visit(value,fn);}}
visit(catalog,node=>{if(node.type==='Property'&&typeof node.key?.value==='string')translations.add(node.key.value);});
const missing=[];
for(const file of await readdir(root)){
 if(!/\.tsx?$/.test(file))continue;
 const ast=parseSync(file,await readFile(new URL(file,root),'utf8'),{lang:file.endsWith('tsx')?'tsx':'ts'});
 if(ast.errors.length)throw new Error('Cannot parse '+file);
 visit(ast.program,node=>{
  const value=node.type==='CallExpression'&&['t','tr','unavailable','workspaceItem'].includes(node.callee?.name)?node.arguments[0]?.value:node.type==='Property'&&node.key?.name==='label'?node.value?.value:undefined;
  if(typeof value==='string'&&/[\u3400-\u9fff]/.test(value)&&!translations.has(value.trim()))missing.push(file+': '+value);
 });
}
if(missing.length){console.error([...new Set(missing)].join('\n'));process.exitCode=1;}else console.log('Locale coverage passed: application copy and menu labels have English translations.');
