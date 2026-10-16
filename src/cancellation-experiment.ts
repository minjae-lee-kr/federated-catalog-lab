import { InventoryWork, workModes } from './cancellation-work.ts';
import type { WorkMode } from './cancellation-work.ts';
import { checkWork } from './cancellation-check.ts';
import { startLab } from './lab.ts';
import { loadOperations } from './schema.ts';
import { sampleSkus } from './data.ts';
import { sourceEvidence } from './cancellation-evidence.ts';

export const experimentFixture = { attempts: 4, responseTimeoutMs: 160, workMs: 1_000, capacity: 2 } as const;

export async function runWorkCase(mode: WorkMode) {
  const work = new InventoryWork(mode, experimentFixture.workMs, experimentFixture.capacity);
  const lab = await startLab({ inventoryWork: work, subgraphTimeoutMs: experimentFixture.responseTimeoutMs });
  const responses: { attempt: number; status: number; body: unknown }[] = [];
  const expectedRequestIds: string[] = [];
  const checks: { name: string; passed: boolean }[] = [];
  try {
    for (let attempt = 1; attempt <= experimentFixture.attempts; attempt++) {
      const response = await fetch(lab.url, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-lab-scenario': 'inventory-timeout' },
        body: JSON.stringify({ query: loadOperations()['CatalogCards.graphql'], variables: { skus: sampleSkus } }),
        signal: AbortSignal.timeout(5_000),
      });
      const body = await response.json() as { extensions?: { lab?: { requestId?: string } }; data?: { products?: { sku: string; name: string; merchant: { name: string } | null; availability: unknown }[] }; errors?: unknown[] };
      const requestId = body.extensions?.lab?.requestId;
      if (typeof requestId !== 'string') throw new Error('Gateway response lacks an observed request identity.');
      expectedRequestIds.push(requestId);
      work.callerCompleted(requestId);
      responses.push({ attempt, status: response.status, body });
      checks.push({ name: `attempt-${attempt}-partial-data`, passed: response.status === 200 && (body.errors?.length ?? 0) > 0
        && body.data?.products?.length === sampleSkus.length
        && body.data.products.every((product, index) => product.sku === sampleSkus[index] && Boolean(product.name) && Boolean(product.merchant?.name) && product.availability === null) });
    }
    const afterCallers = work.snapshot();
    await work.whenIdle();
    const final = work.snapshot();
    const analysis = checkWork(final, expectedRequestIds);
    checks.push({ name: 'raw-event-bookkeeping', passed: analysis.bookkeepingValid }, { name: 'all-work-drained', passed: analysis.drained });
    if (mode === 'timeout-only') checks.push({ name: 'timeouts-leave-overlapping-work', passed: afterCallers.active > experimentFixture.capacity && final.completed === experimentFixture.attempts });
    if (mode === 'early-release') checks.push({ name: 'permit-count-can-lie-about-work', passed: analysis.permitCounterBoundSatisfied === true && analysis.physicalBoundSatisfied === false && !analysis.permitLifetimeValid });
    if (mode === 'admission-only') checks.push({ name: 'noncooperative-work-stays-bounded-but-remains-active', passed: analysis.physicalBoundSatisfied === true && analysis.permitLifetimeValid && final.rejected > 0 && afterCallers.active > 0 });
    if (mode === 'cooperative') checks.push({ name: 'cooperative-work-stops-and-keeps-permit-until-settlement', passed: analysis.physicalBoundSatisfied === true && analysis.permitLifetimeValid && final.started === experimentFixture.attempts && final.cancelled === final.started && final.completed === 0 });
    return { mode, role: mode === 'timeout-only' || mode === 'early-release' ? 'counterexample' : 'mitigation',
      passed: checks.every(check => check.passed), checks, responses, afterCallers, final, analysis };
  } finally { await lab.stop(); }
}

export async function runCancellationExperiment(onProgress: (mode: WorkMode) => void = () => {}) {
  const before = await sourceEvidence();
  const cases = [];
  for (const mode of workModes) { cases.push(await runWorkCase(mode)); onProgress(mode); }
  const after = await sourceEvidence();
  return {
    version: 1, generatedAt: new Date().toISOString(),
    runtime: { node: process.version, platform: process.platform, arch: process.arch, undici: process.versions.undici },
    fixture: experimentFixture, source: before, sourceUnchanged: before.sha256 === after.sha256,
    passed: before.sha256 === after.sha256 && cases.every(item => item.passed), cases,
    limits: [
      'Real HTTP/socket cancellation surrounds synthetic timer-held work. This does not demonstrate cancellation of a database query, CPU task or external side effect.',
      'Response deadlines and work durations are configured fixtures, not observed speed improvements or representative traffic.',
      'Admission limits belong to this one inventory process. No global or cross-replica capacity bound is claimed.',
      'Absolute deadlines use this shared host clock. Clock skew and authenticated cross-service deadline policy are outside this lab.',
      'Cancellation is explicit and cooperative. The admission-only control deliberately ignores it and retains permits until real settlement.',
      'The raw-event checker verifies recorded transitions, not uninstrumented work. Source hashes aid reproduction; they are not execution attestations.',
    ],
  };
}
