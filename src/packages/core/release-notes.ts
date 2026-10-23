import bundled from './legacy-release-notes.json';
import { z } from 'zod';
const note=z.string().trim().min(1).max(14000).refine(text=>!text.includes('<!--'));
const catalogSchema=z.object({version:z.string(),notes:z.object({'zh-CN':note,'zh-TW':note,en:note,ja:note,ko:note,de:note,fr:note,es:note}).strict()}).strict();
/** The public body stays plain text for older clients. Only updated clients
 * fetch this version-bound metadata and convert it to the internal format. */
export function releaseNotesFromCatalog(input:unknown,version:string){
 const catalog=catalogSchema.parse(input);if(catalog.version!==version)throw new Error('Release notes version mismatch');
 return Object.entries(catalog.notes).map(([language,text])=>`<!-- hornet-notes:${language} -->\n${text}\n<!-- /hornet-notes -->`).join('\n\n');
}
/** Release bodies carry independently authored translations, never machine
 * translation of arbitrary remote text at runtime. Render selected text only. */
export function localizedReleaseNotes(body:string,language:string,version:string):string|undefined{
 const blocks=[...body.matchAll(/<!-- hornet-notes:([a-zA-Z-]+) -->\s*([\s\S]*?)\s*<!-- \/hornet-notes -->/g)];
 if(blocks.length)return blocks.find(block=>block[1]===language)?.[2].trim()||undefined;
 // Compatibility for the currently published, single-language release.
 if(version===bundled.version)return bundled.notes[language as keyof typeof bundled.notes];
 return undefined;
}
