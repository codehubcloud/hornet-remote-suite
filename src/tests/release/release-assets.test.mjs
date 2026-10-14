import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checksumAssets, expectedAssets, validateVersion } from '../../tools/release-assets.mjs';

test('rejects version injection and prerelease inputs', () => {
  assert.equal(validateVersion('0.0.1'), '0.0.1');
  for (const input of ['v0.0.1', '0.00.1', '../0.0.1', '0.0.1\n', '0.0.1-beta', '0.0.1;echo bad', undefined]) assert.throws(() => validateVersion(input));
});
test('publishes only the complete installer set and checksums every file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hornet-release-test-'));
  try {
    const expected = expectedAssets('0.0.1');
    await assert.rejects(checksumAssets(directory, '0.0.1'), /seven expected/);
    for (const name of expected) await writeFile(join(directory, name), 'installer fixture');
    const names = await checksumAssets(directory, '0.0.1');
    assert.equal(names.length, 8);
    const sums = await readFile(join(directory, 'SHA256SUMS'), 'utf8');
    assert.equal(sums.trim().split('\n').length, 7);
    assert.match(sums, /^[a-f0-9]{64}  Hornet-/);
    await writeFile(join(directory, 'source.zip'), 'must not leave private repository');
    await assert.rejects(checksumAssets(directory, '0.0.1'), /seven expected/);
    await rm(join(directory, 'source.zip'));
    await writeFile(join(directory, expected[0]), '');
    await assert.rejects(checksumAssets(directory, '0.0.1'), /Invalid installer/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
