export const releaseLanguages=['zh-CN','zh-TW','en','ja','ko','de','fr','es'];
export function releaseNotesBody(catalog,version){
 if(catalog?.version!==version)throw new Error('Release notes version must match the release version.');
 for(const language of releaseLanguages){
  const text=catalog.notes?.[language];
  if(typeof text!=='string'||!text.trim()||text.length>14000||text.includes('<!--'))throw new Error('Missing or invalid release notes: '+language);
 }
 if(Buffer.byteLength(JSON.stringify(catalog),'utf8')>65536)throw new Error('Multilingual release notes are too large.');
 // Older clients render the body verbatim, so never put markup or all
 // translations here. New clients read the separate release-notes.json asset.
 return catalog.notes.en.trim()+'\n';
}
