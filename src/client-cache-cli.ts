import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { projectRoot } from './cancellation-evidence.ts';
import { runClientCacheExperiment } from './client-cache-experiment.ts';
import { checkClientCacheReport } from './client-cache-check.ts';

if (process.argv.length !== 2) {
  console.error('This fixed local experiment accepts no options. Run pnpm client-cache.');
  process.exitCode = 2;
} else {
  try {
    const observed = await runClientCacheExperiment();
    const assessment = checkClientCacheReport(observed);
    const report = { ...observed, assessment };
    const path = join(projectRoot, '.local', `client-cache-${Date.now()}-${randomUUID().slice(0, 8)}.json`);
    await mkdir(join(projectRoot, '.local'), { recursive: true });
    await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    if (assessment.observations) console.table(assessment.observations);
    console.log(`Raw HTTP, client results, normalized cache and source evidence: ${path}`);
    if (!assessment.evidenceValid) {
      console.error(assessment.violations.join('\n'));
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Client/cache experiment did not complete.');
    process.exitCode = 1;
  }
}
