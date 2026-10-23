import { readFile, stat } from 'node:fs/promises';
import { openAsBlob } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checksumAssets, validateVersion } from './release-assets.mjs';
import { releaseNotesBody } from './release-notes.mjs';

const repository = 'codehubcloud/hornet-remote-suite-release';
const version = validateVersion(process.env.RELEASE_VERSION);
const token = process.env.RELEASE_TOKEN;
if (!token) throw new Error('RELEASE_TOKEN is missing. Configure it in the private source repository Actions secrets.');
const directory = process.argv[2] ?? 'release-assets';
const assets = await checksumAssets(directory, version);
const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
async function api(path, method = 'GET', body) {
  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
    method, headers: { ...headers, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 404 && method === 'GET') return null;
  if (!response.ok) throw new Error(`GitHub API ${method} failed: ${response.status}`);
  return response.status === 204 ? null : response.json();
}
const repo = await api('');
if (!repo || repo.private) throw new Error('Binary release repository must exist and be public.');
const tag = 'v' + version;
const existing = await api('/releases/tags/' + tag);
if (existing && !existing.draft) throw new Error('This version is already published; published releases are immutable in this pipeline. Increment the version.');
const body = releaseNotesBody(JSON.parse(await readFile(new URL('../release-notes.json', import.meta.url), 'utf8')),version);
assets.push('release-notes.json');
const release = existing ?? await api('/releases', 'POST', {
  tag_name: tag, target_commitish: repo.default_branch, name: `Hornet Remote Suite ${version}`, body, draft: true, prerelease: false,
});
if (existing) await api('/releases/' + release.id, 'PATCH', { tag_name: tag, target_commitish: repo.default_branch, body, name: `Hornet Remote Suite ${version}`, draft: true, prerelease: false });
const previous = await api('/releases/' + release.id + '/assets?per_page=100');
// A failed upload can be retried, but only on an unpublished draft.
for (const asset of previous) await api('/releases/assets/' + asset.id, 'DELETE');
for (const name of assets) {
  const path = name==='release-notes.json'?fileURLToPath(new URL('../release-notes.json',import.meta.url)):join(directory, name), info = await stat(path);
  const url = release.upload_url.replace(/\{.*$/, '') + '?name=' + encodeURIComponent(name);
  const response = await fetch(url, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Length': String(info.size) },
    body: await openAsBlob(path),
  });
  if (!response.ok) throw new Error(`Asset upload failed for ${name}: ${response.status}. Release remains a draft.`);
  console.log('Uploaded ' + name);
}
const uploaded = await api('/releases/' + release.id + '/assets?per_page=100');
if (uploaded.length !== assets.length || assets.some(name => !uploaded.some(asset => asset.name === name && asset.state === 'uploaded'))) throw new Error('Uploaded assets are incomplete; release remains a draft.');
const published = await api('/releases/' + release.id, 'PATCH', { tag_name: tag, target_commitish: repo.default_branch, draft: false, prerelease: false, make_latest: 'true' });
if (published.tag_name !== tag || published.draft || published.prerelease) throw new Error('Published release state does not match the requested stable version.');
console.log('Published ' + published.html_url);
