import { copyFile,mkdir,readFile,writeFile } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { runIconsTool } from 'app-builder-lib/out/toolsets/icons.js';
import { PNG } from 'pngjs';

const source=resolve('assets/branding/source.png');
await mkdir('assets/branding',{recursive:true});
if(process.argv[2]&&resolve(process.argv[2])!==source)await copyFile(resolve(process.argv[2]),source);
const png=await readFile(source);
if(png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw new Error('The brand source must be PNG.');
const width=png.readUInt32BE(16),height=png.readUInt32BE(20);
if(Math.min(width,height)<512)throw new Error('The brand source must be at least 512 pixels on each side.');
if(Math.max(width,height)>8192)throw new Error('The brand source must not exceed 8192 pixels on either side.');
// Near-invisible fringe pixels must not dictate the size of the taskbar logo.
// Only change the SVG viewport; keep the original PNG bytes and visible artwork.
const decoded=PNG.sync.read(png);
let left=width,top=height,right=-1,bottom=-1;
for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(decoded.data[(y*width+x)*4+3]>=16){
 left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);
}
if(right<left)throw new Error('The brand source has no visible artwork.');
const visibleWidth=right-left+1,visibleHeight=bottom-top+1;
const side=Math.max(visibleWidth,visibleHeight)*1.04;
const originX=left+visibleWidth/2-side/2,originY=top+visibleHeight/2-side/2;
await mkdir('.cache/branding',{recursive:true});
const svg=resolve('.cache/branding/source.svg');
await writeFile(svg,`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="${originX} ${originY} ${side} ${side}"><image width="${width}" height="${height}" href="data:image/png;base64,${png.toString('base64')}"/></svg>`);
const output=resolve('build/icons');await mkdir(join(output,'png'),{recursive:true});
for(const format of ['ico','icns','set'])await runIconsTool({inputFile:svg,outputFormat:format,outDir:format==='set'?join(output,'png'):output});
await copyFile(join(output,'png','512x512.png'),join(output,'icon.png'));
await mkdir('apps/desktop/renderer/public',{recursive:true});
await copyFile(join(output,'png','256x256.png'),'apps/desktop/renderer/public/logo.png');
console.log(`Brand icons generated: visible artwork ${visibleWidth}x${visibleHeight}, 2% padding, Windows ICO, macOS ICNS, Linux PNG sizes and renderer logo.`);
