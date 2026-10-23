export const releaseLanguages=['zh-CN','zh-TW','en','ja','ko','de','fr','es'];
export function releaseNotesBody(catalog,version){
 if(catalog?.version!==version)throw new Error('Release notes version must match the release version.');
 for(const language of releaseLanguages){
  const text=catalog.notes?.[language];
  if(typeof text!=='string'||!text.trim()||text.length>14000||text.includes('<!--'))throw new Error('Missing or invalid release notes: '+language);
 }
 const body=releaseLanguages.map(language=>`<details>\n<summary>${language}</summary>\n\n<!-- hornet-notes:${language} -->\n${catalog.notes[language].trim()}\n<!-- /hornet-notes -->\n\n</details>`).join('\n\n');
 if(body.length>65000)throw new Error('Multilingual release notes are too large.');
 return body+'\n';
}
