import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runCancellationExperiment } from './cancellation-experiment.ts';
import { projectRoot } from './cancellation-evidence.ts';

if (process.argv.length > 2) throw new Error('This fixed experiment accepts no options. Run pnpm debt.');
const report = await runCancellationExperiment(mode => console.log(`Observed ${mode}`));
const directory = join(projectRoot, '.local');
await mkdir(directory, { recursive: true });
const path = join(directory, 'cancellation-debt.json');
await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
console.table(report.cases.map(item => ({ mode: item.mode, activeAfterCallers: item.afterCallers.active,
  maxActive: item.final.maxActive, maxPermits: item.final.maxPermits, completed: item.final.completed, cancelled: item.final.cancelled, rejected: item.final.rejected, expectedObservation: item.passed })));
console.log(`Raw observations and source manifest: ${path}`);
if (!report.passed) { console.error('An expected observation failed or source changed during the run. Inspect the raw report.'); process.exitCode = 1; }
