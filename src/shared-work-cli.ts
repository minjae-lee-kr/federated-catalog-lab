import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { projectRoot } from './cancellation-evidence.ts';
import { runSharedExperiment } from './shared-work-experiment.ts';
import { assessSharedCase } from './shared-work-assessment.ts';

if (process.argv.length !== 2) {
  console.error('This fixed local experiment accepts no options. Run pnpm shared-work.');
  process.exitCode = 2;
} else {
  try {
    const observed = await runSharedExperiment();
    const cases = observed.cases.map(item => ({ ...item, assessment: assessSharedCase(item) }));
    const expectedObservationsEstablished = observed.sourceUnchanged && cases.every(item => item.assessment.expectedObservationEstablished);
    const report = { ...observed, cases, expectedObservationsEstablished };
    const path = join(projectRoot, '.local', `shared-work-${Date.now()}-${randomUUID().slice(0, 8)}.json`);
    await mkdir(join(projectRoot, '.local'), { recursive: true });
    await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    console.table(cases.map(item => ({ case: item.id, role: item.assessment.role,
      evidenceValid: item.assessment.analysis.evidenceValid, starts: item.assessment.analysis.reconstructed.started,
      abortsWithWaiters: item.assessment.analysis.abortsWithWaiters.length,
      foreignCleanup: item.assessment.analysis.foreignCleanups.length,
      redundantStarts: item.assessment.analysis.redundantStarts.length,
      expectedObservationEstablished: item.assessment.expectedObservationEstablished })));
    console.log(`Raw HTTP observations, event replay and source manifest: ${path}`);
    if (!expectedObservationsEstablished) {
      console.error('An expected observation was not established, evidence was inconsistent, or source changed. Inspect the saved report.');
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Shared-work experiment did not complete.');
    process.exitCode = 1;
  }
}
