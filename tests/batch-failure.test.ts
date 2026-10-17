import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { runBatchFailureCase, batchFailureCases } from '../src/batch-failure-experiment.ts';
import { checkBatchFailureCase } from '../src/batch-failure-check.ts';
import { createContext } from '../src/loaders.ts';

describe('runtime batch failure boundaries over three real HTTP subgraphs', () => {
  const recordings: Awaited<ReturnType<typeof runBatchFailureCase>>[] = [];
  before(async () => { for (const id of batchFailureCases) recordings.push(await runBatchFailureCase(id)); });
  it('separates operation validity and HTTP 200 from preserved data and error locations', () => {
    const checked = recordings.map(checkBatchFailureCase);
    assert.deepEqual(checked.map(item => item.evidenceValid), [true, true, true], JSON.stringify(checked));
    assert.deepEqual(checked.map(item => [item.observed!.productCount, item.observed!.knownInventoryCount]), [[3, 2], [3, 0], [2, 2]]);
    assert.deepEqual(checked.map(item => item.observed!.errorPaths), [
      [['products', 1, 'availability']],
      [['products', 0, 'availability'], ['products', 1, 'availability'], ['products', 2, 'availability']],
      [['products', 1, 'availability']],
    ]);
  });

  function rejected(index: number, mutate: (record: any) => void, reason: RegExp) {
    // Deliberately corrupt a clone of actual HTTP evidence; never change producer behavior.
    const record = structuredClone(recordings[index]);
    mutate(record);
    const result = checkBatchFailureCase(record);
    assert.equal(result.evidenceValid, false);
    assert.equal(result.observed, null, 'Malformed evidence must not feed a success narrative.');
    assert.match(result.violations.join('\n'), reason);
  }
  const trace = (record: any, service: string) => record.response.body.extensions.lab.fetches.find((item: any) => item.service === service);

  it('rejects a relocated error even if HTTP status and number of errors are unchanged', () => {
    rejected(0, record => { record.response.body.errors[0].path[1] = 0; }, /error paths/);
  });
  it('rejects a wrong representation mapping even when loader and response counts match', () => {
    rejected(0, record => { trace(record, 'inventory').captured.request.variables.representations.reverse(); }, /representation order/);
  });
  it('binds captured queries to selected fields and variables without pinning generated names or formatting', () => {
    rejected(0, record => { trace(record, 'inventory').captured.request.query = '{ __typename }'; }, /operation or argument/);
    rejected(0, record => { trace(record, 'inventory').captured.request.query = 'not graphql'; }, /Syntax Error/);
    rejected(0, record => { trace(record, 'inventory').captured.request.query = 'query($representations:[_Any!]!){_entities(representations:$wrong){... on Product { availability { status quantity } }}}'; }, /argument binding/);
    const equivalent: any = structuredClone(recordings[0]);
    trace(equivalent, 'inventory').captured.request.query = `query AnotherGeneratedName($representations: [_Any!]!) {
      _entities(representations: $representations) { ... on Product { availability { quantity status } } }
    }`;
    assert.equal(checkBatchFailureCase(equivalent).evidenceValid, true);
  });
  it('rejects a swallowed per-key error presented as sold out', () => {
    rejected(0, record => { record.response.body.data.products[1].availability = { status: 'SOLD_OUT', quantity: 0 }; }, /value preservation/);
  });
  it('requires healthy fields at the gateway and confirms they existed before null bubbling', () => {
    rejected(2, record => { record.response.body.data.products[0].merchant = null; }, /value preservation/);
    rejected(2, record => { trace(record, 'catalog').captured.response.data.products[1].name = null; }, /Catalog fields/);
  });
  it('rejects misleading root-cause identity and missing downstream evidence', () => {
    rejected(1, record => { record.response.body.errors[0].extensions.failedSku = 'demo-notebook'; }, /attribution/);
    rejected(0, record => { delete trace(record, 'inventory').captured; }, /capture/);
  });
  it('does not trust a green contract summary over a changed schema', () => {
    rejected(2, record => { record.contract.candidateApiSchema = record.contract.candidateApiSchema.replace('availability: Availability!', 'availability: Availability'); }, /Availability/);
    rejected(2, record => { record.contract.baselineApiSchema = record.contract.candidateApiSchema; }, /Baseline availability/);
    rejected(0, record => { record.contract.baselineApiSchema = record.contract.baselineApiSchema.replace('[Product]!', '[Product!]!'); }, /Baseline list/);
  });
  it('does not let repeated errors or an extra transport failure pass as the expected boundary', () => {
    rejected(0, record => { record.response.body.errors.push(record.response.body.errors[0]); }, /error paths/);
    rejected(0, record => { trace(record, 'merchants').outcome = 'transport-error'; }, /transport-error/);
  });
  it('treats absent or malformed evidence as unestablished', () => {
    for (const value of [null, {}, [], { id: 'unknown' }]) assert.equal(checkBatchFailureCase(value).evidenceValid, false);
  });
});

describe('DataLoader error identity and cache scope (in process, not inferred from JSON)', () => {
  const errorOf = (value: Promise<unknown>) => value.then(
    () => assert.fail('Expected a synthetic failure.'),
    error => { assert.ok(error instanceof Error); return error; },
  );
  it('memoizes individual Error results only inside one request context', async () => {
    const first = createContext('healthy', 0, undefined, { mode: 'per-key', sku: 'demo-lamp' });
    const error = await errorOf(first.inventory.load('demo-lamp'));
    assert.equal(await errorOf(first.inventory.load('demo-lamp')), error);
    assert.equal(first.batches.length, 1);
    const second = createContext('healthy', 0, undefined, { mode: 'per-key', sku: 'demo-lamp' });
    assert.notEqual(await errorOf(second.inventory.load('demo-lamp')), error);
    assert.equal(second.batches.length, 1);
  });
  it('rejects the entire batch with one cause and clears failed loads for a later dispatch', async () => {
    const context = createContext('healthy', 0, undefined, { mode: 'whole-batch', sku: 'demo-lamp' });
    const [healthyKey, failedKey] = await Promise.all([
      errorOf(context.inventory.load('demo-ceramic')), errorOf(context.inventory.load('demo-lamp')),
    ]);
    assert.equal(healthyKey, failedKey);
    assert.notEqual(await errorOf(context.inventory.load('demo-lamp')), failedKey);
    assert.equal(context.batches.length, 2);
    assert.deepEqual(await context.inventory.load('demo-ceramic'), { status: 'IN_STOCK', quantity: 8 });
  });
});
