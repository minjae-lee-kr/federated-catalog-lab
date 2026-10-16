import { lstat, mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sourceEvidence, projectRoot } from './cancellation-evidence.ts';
import { runCancellationExperiment } from './cancellation-experiment.ts';
import { createCancellationExport } from './cancellation-export.ts';

if (process.argv.length > 2) throw new Error('This fixed export accepts no options. Run pnpm debt:export.');
const before = await sourceEvidence();
if (!before.git || before.git.dirty) throw new Error('Commit the reviewed source before capturing a static export. A clean local Git revision is required.');
const report = await runCancellationExperiment(mode => console.log(`Captured ${mode}`));
const files = await createCancellationExport(report);
const after = await sourceEvidence();
if (before.sha256 !== after.sha256 || before.sha256 !== report.source.sha256 || after.git?.head !== before.git.head || after.git?.dirty) {
  throw new Error('Source changed while capturing or rendering. No static export was written.');
}
const directory = join(projectRoot, '.local', 'cancellation-export');
for (const path of [join(projectRoot, '.local'), directory]) {
  await mkdir(path, { recursive: true });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Export requires ordinary local directories.');
}
if ((await readdir(directory)).some(name => !Object.hasOwn(files, name))) throw new Error('Export directory contains unexpected files. Preserve or move them before exporting.');
for (const name of Object.keys(files)) {
  try {
    const info = await lstat(join(directory, name));
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Export refuses to replace a symbolic link or non-file.');
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}
for (const [name, contents] of Object.entries(files)) await writeFile(join(directory, name), contents);
console.log(`Read-only capture: ${directory}`);
console.log(`Revision: ${report.source.git!.head}; source SHA-256: ${report.source.sha256}`);
