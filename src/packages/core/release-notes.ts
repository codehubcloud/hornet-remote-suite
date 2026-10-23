import bundled from './legacy-release-notes.json';
/** Release bodies carry independently authored translations, never machine
 * translation of arbitrary remote text at runtime. Render selected text only. */
export function localizedReleaseNotes(body:string,language:string,version:string):string|undefined{
 const blocks=[...body.matchAll(/<!-- hornet-notes:([a-zA-Z-]+) -->\s*([\s\S]*?)\s*<!-- \/hornet-notes -->/g)];
 if(blocks.length)return blocks.find(block=>block[1]===language)?.[2].trim()||undefined;
 // Compatibility for the currently published, single-language release.
 if(version===bundled.version)return bundled.notes[language as keyof typeof bundled.notes];
 return undefined;
}
