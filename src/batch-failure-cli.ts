import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { projectRoot } from './cancellation-evidence.ts';
import { runBatchFailureExperiment } from './batch-failure-experiment.ts';
import { checkBatchFailureCase } from './batch-failure-check.ts';

if (process.argv.length !== 2) {
  console.error('This fixed local experiment accepts no options. Run pnpm batch-failure.');
  process.exitCode = 2;
} else {
  try {
    const observed = await runBatchFailureExperiment();
    const cases = observed.cases.map(item => ({ ...item, assessment: checkBatchFailureCase(item) }));
    const expectedObservationsEstablished = observed.sourceUnchanged && cases.every(item => item.assessment.evidenceValid);
    const report = { ...observed, cases, expectedObservationsEstablished };
    const path = join(projectRoot, '.local', `batch-failure-${Date.now()}-${randomUUID().slice(0, 8)}.json`);
    await mkdir(join(projectRoot, '.local'), { recursive: true });
    await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    console.table(cases.map(item => ({ case: item.id, http: item.response.status, evidenceValid: item.assessment.evidenceValid,
      products: item.assessment.observed?.productCount, knownInventory: item.assessment.observed?.knownInventoryCount,
      errorPaths: JSON.stringify(item.assessment.observed?.errorPaths) })));
    console.log(`Raw GraphQL envelopes, contract results and source manifest: ${path}`);
    if (!expectedObservationsEstablished) {
      console.error('An expected observation was not established or source changed. Inspect the report.');
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Batch failure experiment did not complete.');
    process.exitCode = 1;
  }
}
