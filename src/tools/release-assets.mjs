import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function validateVersion(version) {
  if (typeof version !== 'string' || version !== version.trim() || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error('Release version must be stable semver, e.g. 0.0.1.');
  return version;
}
export function expectedAssets(version) {
  validateVersion(version);
  return [
    `Hornet-Remote-Suite-${version}-windows-x64.exe`,
    ...['x64', 'arm64'].map(arch => `Hornet-Remote-Suite-${version}-macos-${arch}.dmg`),
    ...['x86_64', 'arm64'].map(arch => `Hornet-Remote-Suite-${version}-linux-${arch}.AppImage`),
    ...['amd64', 'arm64'].map(arch => `Hornet-Remote-Suite-${version}-linux-${arch}.deb`),
  ].sort();
}
export async function checksumAssets(directory, version) {
  const names = (await readdir(directory)).sort(), expected = expectedAssets(version);
  const actual = names.filter(name => name !== 'SHA256SUMS');
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Release assets must contain exactly the seven expected installers; extra files and missing platforms are rejected. Found: ' + actual.join(', '));
  const lines = [];
  for (const name of expected) {
    const path = join(directory, name), info = await stat(path);
    if (!info.isFile() || info.size === 0) throw new Error('Invalid installer: ' + name);
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    lines.push(`${hash.digest('hex')}  ${name}`);
  }
  await writeFile(join(directory, 'SHA256SUMS'), lines.join('\n') + '\n');
  return [...expected, 'SHA256SUMS'];
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await checksumAssets(process.argv[2], process.argv[3]);
  console.log('All seven installers validated and SHA256SUMS generated.');
}
