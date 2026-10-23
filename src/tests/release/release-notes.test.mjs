import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { releaseNotesBody,releaseLanguages } from '../../tools/release-notes.mjs';
test('requires all eight release translations and a matching version before publication',async()=>{
 const catalog=JSON.parse(await readFile(new URL('../../release-notes.json',import.meta.url),'utf8'));
 const body=releaseNotesBody(catalog,catalog.version);
 assert.equal(body,catalog.notes.en+'\n');
 assert.doesNotMatch(body,/<details>|<summary>|<!--/);
 for(const language of releaseLanguages.filter(language=>language!=='en'))assert.ok(!body.includes(catalog.notes[language]));
 assert.throws(()=>releaseNotesBody(catalog,'99.0.0'),/version/);
 const incomplete=structuredClone(catalog);delete incomplete.notes.en;assert.throws(()=>releaseNotesBody(incomplete,catalog.version),/en/);
 const injected=structuredClone(catalog);injected.notes.en='<!-- unexpected -->';assert.throws(()=>releaseNotesBody(injected,catalog.version),/en/);
});
