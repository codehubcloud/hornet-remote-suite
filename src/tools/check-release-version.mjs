import { readFile, appendFile } from 'node:fs/promises';
import { validateVersion } from './release-assets.mjs';
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
validateVersion(version);
const requested = (process.env.REQUESTED_VERSION ?? version).replace(/^v/, '');
if (requested !== version) throw new Error('Release version must match src/package.json: ' + version);
if (process.env.GITHUB_ACTIONS === 'true' && process.env.SOURCE_PRIVATE !== 'true') {
  const explicitlyApprovedPublicRun = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' && process.env.ALLOW_PUBLIC_SOURCE_RELEASE === 'true';
  if (!explicitlyApprovedPublicRun) throw new Error('Publishing from a public source repository requires explicit approval on a manual workflow run.');
}
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `version=${version}\n`);
console.log('Validated release version ' + version);
