import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { InventoryWork, workModes } from '../src/cancellation-work.ts';
import { runWorkCase } from '../src/cancellation-experiment.ts';
import { checkWork } from '../src/cancellation-check.ts';
import { startLab } from '../src/lab.ts';
import { startSubgraph } from '../src/subgraphs.ts';
import { loadOperations } from '../src/schema.ts';
import { sampleSkus } from '../src/data.ts';

function query(url: string, signal?: AbortSignal) {
  return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-lab-scenario': 'inventory-timeout' },
    body: JSON.stringify({ query: loadOperations()['CatalogCards.graphql'], variables: { skus: sampleSkus } }), ...(signal ? { signal } : {}) });
}
async function until(condition: () => boolean) {
  const end = performance.now() + 5_000;
  while (!condition()) { if (performance.now() > end) assert.fail('Expected real work admission was not observed.'); await delay(5); }
}

test('real HTTP retry sequence distinguishes waiting, permit ownership and physical settlement', { timeout: 20_000 }, async () => {
  const cases = [];
  for (const mode of workModes) cases.push(await runWorkCase(mode));
  for (const item of cases) assert.ok(item.passed, `${item.mode}: ${JSON.stringify(item.checks)}`);
  const incorrect = cases.find(item => item.mode === 'early-release')!;
  assert.equal(incorrect.analysis.permitCounterBoundSatisfied, true);
  assert.equal(incorrect.analysis.physicalBoundSatisfied, false);
  assert.equal(incorrect.analysis.permitLifetimeValid, false);
  // The independent checker must follow transition ordering, not a friendly label.
  const renamed = structuredClone(incorrect.final);
  for (const event of renamed.events) if (event.kind === 'permit-released') event.reason = 'looks-safe';
  assert.equal(checkWork(renamed).permitLifetimeValid, false);
  const dishonestSummary = structuredClone(incorrect.final); dishonestSummary.maxActive = 2;
  assert.equal(checkWork(dishonestSummary).bookkeepingValid, false);
  const missingSettlement = structuredClone(incorrect.final);
  missingSettlement.events = missingSettlement.events.filter(event => event.kind !== 'completed');
  assert.equal(checkWork(missingSettlement).bookkeepingValid, false);
});

test('deadline reaches cooperative subgraph work even while its HTTP caller remains connected', async () => {
  const work = new InventoryWork('cooperative', 1_000, 2);
  const inventory = await startSubgraph('inventory', 0, 1_000, work);
  try {
    const response = await fetch(inventory.url, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-lab-scenario': 'inventory-timeout', 'x-lab-deadline-at': String(Date.now() + 100) },
      body: JSON.stringify({ query: 'query { _entities(representations: [{__typename: "Product", sku: "demo-ceramic"}]) { ... on Product { sku availability { quantity } } } }' }),
    });
    const result = await response.json() as { errors?: { extensions?: { code?: string } }[] };
    assert.equal(response.status, 200);
    assert.ok(result.errors?.some(error => error.extensions?.code === 'WORK_CANCELLED'));
    const actual = work.snapshot();
    assert.equal(actual.cancelled, 1); assert.equal(actual.completed, 0);
    assert.deepEqual(actual.events.filter(event => event.kind === 'cancel-requested').map(event => event.reason), ['deadline']);
    assert.equal(checkWork(actual).permitLifetimeValid, true);
  } finally { await inventory.stop(); await work.whenIdle(); }
});

test('aborting one concurrent gateway request propagates explicitly without cancelling its neighbor', async () => {
  const work = new InventoryWork('cooperative', 350, 2);
  const lab = await startLab({ inventoryWork: work, subgraphTimeoutMs: 2_000 });
  const first = new AbortController();
  try {
    const abandoned = query(lab.url, first.signal);
    const rejected = assert.rejects(abandoned, error => error instanceof Error && error.name === 'AbortError');
    await until(() => work.snapshot().started === 1);
    const neighbor = query(lab.url);
    await until(() => work.snapshot().started === 2);
    first.abort(); await rejected;
    const response = await neighbor;
    const result = await response.json() as { errors?: unknown; extensions: { lab: { requestId: string } }; data: { products: { availability: unknown }[] } };
    assert.equal(response.status, 200); assert.equal(result.errors, undefined);
    assert.ok(result.data.products.every(product => product.availability !== null));
    await work.whenIdle();
    const actual = work.snapshot();
    assert.equal(actual.cancelled, 1); assert.equal(actual.completed, 1);
    assert.equal(actual.events.find(event => event.kind === 'completed')?.requestId, result.extensions.lab.requestId);
    assert.deepEqual(actual.events.filter(event => event.kind === 'cancel-requested').map(event => event.reason), ['peer-disconnected']);
    assert.ok(checkWork(actual).bookkeepingValid);
  } finally { await lab.stop(); }
});

test('a disconnected caller does not magically cancel signal-ignoring work', async () => {
  const work = new InventoryWork('admission-only', 300, 1);
  const lab = await startLab({ inventoryWork: work, subgraphTimeoutMs: 100 });
  try {
    const response = await query(lab.url); await response.json();
    await until(() => work.snapshot().events.some(event => event.kind === 'cancel-requested'));
    const during = work.snapshot();
    assert.equal(during.active, 1); assert.equal(during.permits, 1);
    const retry = await query(lab.url);
    const result = await retry.json() as { errors?: { extensions?: { code?: string } }[] };
    assert.ok(result.errors?.some(error => error.extensions?.code === 'INVENTORY_BUSY'));
    await work.whenIdle();
    const actual = work.snapshot();
    assert.equal(actual.completed, 1); assert.equal(actual.cancelled, 0); assert.equal(actual.rejected, 1);
    assert.equal(checkWork(actual).physicalBoundSatisfied, true);
    assert.equal(checkWork(actual).permitLifetimeValid, true);
  } finally { await lab.stop(); }
});

test('an already expired deadline is rejected without acquiring capacity', async () => {
  const work = new InventoryWork('cooperative', 100, 1);
  await assert.rejects(work.run({ requestId: 'expired-local-request', signal: new AbortController().signal, deadlineAt: Date.now() - 1 }), /not admitted/);
  const actual = work.snapshot();
  assert.equal(actual.started, 0); assert.equal(actual.rejected, 1);
  assert.ok(checkWork(actual).bookkeepingValid); assert.ok(checkWork(actual).drained);
});
