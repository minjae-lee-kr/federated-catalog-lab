import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { sourceEvidence } from '../src/cancellation-evidence.ts';

test('source manifest changes with public assets and rejects a selected root junction', async () => {
  const parent = resolve(tmpdir());
  const directory = await mkdtemp(join(parent, 'federation-evidence-'));
  try {
    await mkdir(join(directory, 'public'));
    await writeFile(join(directory, 'public/app.js'), 'console.log(1)');
    const first = await sourceEvidence(directory);
    assert.deepEqual(await sourceEvidence(directory), first);
    await writeFile(join(directory, 'public/app.js'), 'console.log(2)');
    assert.notEqual((await sourceEvidence(directory)).sha256, first.sha256);
    await mkdir(join(directory, 'synthetic-outside'));
    await symlink(join(directory, 'synthetic-outside'), join(directory, 'src'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(sourceEvidence(directory), /does not follow symbolic links/);
  } finally { assert.equal(dirname(directory), parent); await rm(directory, { recursive: true, force: true }); }
});
