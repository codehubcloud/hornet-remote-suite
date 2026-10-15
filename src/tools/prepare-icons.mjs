import { copyFile,mkdir,readFile,writeFile } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { runIconsTool } from 'app-builder-lib/out/toolsets/icons.js';

const source=resolve('assets/branding/source.png');
await mkdir('assets/branding',{recursive:true});
if(process.argv[2]&&resolve(process.argv[2])!==source)await copyFile(resolve(process.argv[2]),source);
const png=await readFile(source);
if(png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw new Error('The brand source must be PNG.');
const width=png.readUInt32BE(16),height=png.readUInt32BE(20),side=Math.max(width,height);
if(Math.min(width,height)<512)throw new Error('The brand source must be at least 512 pixels on each side.');
// Center the complete supplied image in a square with transparent padding.
// Preserve its alpha channel, proportions and colors; never crop or redraw it.
await mkdir('.cache/branding',{recursive:true});
const svg=resolve('.cache/branding/source.svg');
await writeFile(svg,`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 ${side} ${side}"><image x="${-(width-side)/2}" y="${-(height-side)/2}" width="${width}" height="${height}" href="data:image/png;base64,${png.toString('base64')}"/></svg>`);
const output=resolve('build/icons');await mkdir(join(output,'png'),{recursive:true});
for(const format of ['ico','icns','set'])await runIconsTool({inputFile:svg,outputFormat:format,outDir:format==='set'?join(output,'png'):output});
await copyFile(join(output,'png','512x512.png'),join(output,'icon.png'));
await mkdir('apps/desktop/renderer/public',{recursive:true});
await copyFile(join(output,'png','256x256.png'),'apps/desktop/renderer/public/logo.png');
console.log('Brand icons generated: Windows ICO, macOS ICNS, Linux PNG sizes and renderer logo.');
