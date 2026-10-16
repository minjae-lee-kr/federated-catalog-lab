import { after, before, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { startLab } from '../src/lab.ts';
import { loadOperations } from '../src/schema.ts';
import { sampleSkus } from '../src/data.ts';
import type { FetchTrace } from '../src/lab.ts';

interface Result {
  data?: { products: ({ sku: string; name: string; price?: { amountMinor: number; currency: string }; merchant?: { id: string; name: string }; availability?: { status: string; quantity: number } | null } | null)[] } | null;
  errors?: { message: string; path?: (string | number)[]; extensions?: { code?: string; stacktrace?: unknown } }[];
  extensions?: { lab: { requestId: string; scenario: string; fetches: FetchTrace[] } };
}

describe('real HTTP federation', () => {
  let lab: Awaited<ReturnType<typeof startLab>>;
  const operations = loadOperations();
  before(async () => { lab = await startLab({ subgraphTimeoutMs: 500, slowInventoryMs: 1200 }); });
  after(async () => { await lab?.stop(); });
  async function query(scenario = 'healthy', skus: string[] = sampleSkus, operation = 'CatalogCards.graphql') {
    const response = await fetch(lab.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-lab-scenario': scenario },
      body: JSON.stringify({ query: operations[operation], variables: { skus } }),
    });
    return { status: response.status, result: await response.json() as Result };
  }
  const trace = (result: Result, name: string) => result.extensions!.lab.fetches.find(fetch => fetch.service === name)!;

  it('combines real entity fields from all three HTTP subgraphs', async () => {
    const { status, result } = await query();
    assert.equal(status, 200);
    assert.equal(result.errors, undefined);
    assert.equal(result.data!.products[0]!.name, 'Orbit Ceramic Cup');
    assert.deepEqual(result.data!.products[0]!.price, { amountMinor: 2400, currency: 'USD' });
    assert.equal(result.data!.products[0]!.merchant!.name, 'North Studio');
    assert.deepEqual(result.data!.products[0]!.availability, { status: 'IN_STOCK', quantity: 8 });
    assert.deepEqual(result.extensions!.lab.fetches.map(fetch => fetch.service).sort(), ['catalog', 'inventory', 'merchants']);
  });

  it('preserves order, repeats output positions, and batches only unique keys', async () => {
    const { result } = await query('healthy', ['demo-lamp', 'demo-ceramic', 'demo-lamp', 'demo-notebook']);
    assert.deepEqual(result.data!.products.map(product => product!.sku), ['demo-lamp', 'demo-ceramic', 'demo-lamp', 'demo-notebook']);
    assert.deepEqual(trace(result, 'inventory').batches, [{ source: 'inventory', keys: ['demo-lamp', 'demo-ceramic', 'demo-notebook'] }]);
    assert.equal(trace(result, 'merchants').batches.length, 1);
    assert.equal(trace(result, 'merchants').batches[0]!.keys.length, 2);
  });

  it('does not fetch unselected domains, even with an inventory fault selected', async () => {
    const { result } = await query('inventory-error', sampleSkus, 'CatalogOnly.graphql');
    assert.equal(result.errors, undefined);
    assert.deepEqual(result.extensions!.lab.fetches.map(fetch => fetch.service), ['catalog']);
  });

  it('keeps sold out and missing inventory as separate states', async () => {
    const { result } = await query('missing-inventory');
    assert.equal(result.errors, undefined);
    assert.deepEqual(result.data!.products[1]!.availability, { status: 'SOLD_OUT', quantity: 0 });
    assert.equal(result.data!.products[2]!.availability, null);
    assert.equal(result.data!.products[2]!.name, 'Arc Desk Lamp');
  });

  it('retains product and merchant fields when inventory resolvers fail', async () => {
    const { status, result } = await query('inventory-error');
    assert.equal(status, 200, 'GraphQL partial errors remain a successful HTTP response');
    assert.equal(result.errors!.length, 3);
    assert.ok(result.data!.products.every(product => product!.availability === null && product!.merchant!.name));
    assert.deepEqual(result.errors![0]!.path, ['products', 0, 'availability']);
    assert.equal(result.errors![0]!.extensions!.code, 'INVENTORY_UNAVAILABLE');
    assert.equal(result.errors![0]!.extensions!.stacktrace, undefined);
    assert.equal(trace(result, 'inventory').outcome, 'graphql-error');
  });

  it('bounds gateway waiting and returns partial data on a transport timeout', async () => {
    const start = performance.now();
    const { result } = await query('inventory-timeout');
    assert.ok(performance.now() - start < 2500, 'generous upper bound catches an ignored deadline, not performance regression');
    assert.equal(result.errors![0]!.extensions!.code, 'SUBGRAPH_TIMEOUT');
    assert.ok(result.data!.products.every(product => product!.availability === null && product!.name));
    assert.equal(trace(result, 'inventory').outcome, 'transport-error');
    assert.deepEqual(trace(result, 'inventory').batches, [], 'timed-out work cannot report downstream batch telemetry');
  });

  it('creates fresh loader caches for the next request after a failure', async () => {
    const failed = await query('inventory-error');
    const healthy = await query();
    assert.notEqual(failed.result.extensions!.lab.requestId, healthy.result.extensions!.lab.requestId);
    assert.equal(healthy.result.errors, undefined);
    assert.equal(healthy.result.data!.products[0]!.availability!.quantity, 8);
    assert.equal(trace(healthy.result, 'inventory').batches.length, 1);
  });

  it('isolates concurrent requests with different failure scenarios', async () => {
    const [failed, healthy] = await Promise.all([query('inventory-error'), query()]);
    assert.equal(failed.result.data!.products[0]!.availability, null);
    assert.equal(healthy.result.data!.products[0]!.availability!.status, 'IN_STOCK');
    assert.notEqual(failed.result.extensions!.lab.requestId, healthy.result.extensions!.lab.requestId);
  });

  it('returns a null slot for an unknown product without misaligning following results', async () => {
    const { result } = await query('healthy', ['not-a-real-sku', 'demo-lamp']);
    assert.equal(result.errors, undefined);
    assert.equal(result.data!.products[0], null);
    assert.equal(result.data!.products[1]!.sku, 'demo-lamp');
    assert.deepEqual(trace(result, 'inventory').batches[0]!.keys, ['demo-lamp']);
  });

  it('treats prototype-like SKU names as missing inventory, not inherited object properties', async () => {
    const skus = ['constructor', 'toString', '__proto__', 'not-real'];
    const response = await fetch(lab.subgraphs.inventory, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: 'query Entities($representations: [_Any!]!) { _entities(representations: $representations) { ... on Product { sku availability { status quantity } } } }',
        variables: { representations: skus.map(sku => ({ __typename: 'Product', sku })) },
      }),
    });
    const result = await response.json();
    assert.equal(result.errors, undefined);
    assert.deepEqual(result.data._entities, skus.map(sku => ({ sku, availability: null })));
  });

  it('returns an empty result without fan-out for an empty selection', async () => {
    const { result } = await query('healthy', []);
    assert.deepEqual(result.data!.products, []);
    assert.deepEqual(result.extensions!.lab.fetches.map(fetch => fetch.service), ['catalog']);
  });

  it('rejects oversized selections before fetching inventory or merchants', async () => {
    const { result } = await query('healthy', Array(13).fill('demo-lamp'));
    assert.equal(result.data, null);
    assert.equal(result.errors![0]!.extensions!.code, 'BAD_USER_INPUT');
    assert.deepEqual(result.extensions!.lab.fetches.map(fetch => fetch.service), ['catalog']);
  });

  it('rejects unknown fault scenarios instead of accepting arbitrary control input', async () => {
    const { status, result } = await query('anything-goes');
    assert.equal(status, 400);
    assert.equal(result.errors![0]!.extensions!.code, 'BAD_USER_INPUT');
  });

  it('rejects non-POST, cross-origin, malformed and oversized GraphQL HTTP requests', async () => {
    assert.equal((await fetch(lab.url)).status, 405);
    assert.equal((await fetch(lab.url, { method: 'POST', headers: { origin: 'https://example.invalid', 'content-type': 'application/json' }, body: '{}' })).status, 403);
    assert.equal((await fetch(lab.url, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status, 415);
    assert.equal((await fetch(lab.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })).status, 400);
    assert.equal((await fetch(lab.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'x'.repeat(33000) }) })).status, 413);
  });
});

it('stops every server and tolerates repeated cleanup', async () => {
  const lab = await startLab();
  const urls = [lab.url, ...Object.values(lab.subgraphs)];
  assert.ok(urls.every(url => new URL(url).hostname === '127.0.0.1'));
  await Promise.all([lab.stop(), lab.stop()]);
  for (const url of urls) await assert.rejects(fetch(url, { signal: AbortSignal.timeout(1000) }));
});

it('restores the caller telemetry setting after isolated gateway construction', async () => {
  // Deliberately checks the pinned Gateway integration boundary. If Apollo changes
  // this internal factory on upgrade, re-review its opt-out instead of dropping the check.
  const require = createRequire(import.meta.url);
  const telemetry = require('@apollo/gateway/dist/utilities/opentelemetry') as { createDataCollectionExporter: () => unknown };
  const exporter = mock.method(telemetry, 'createDataCollectionExporter', () => { throw new Error('Gateway telemetry must remain disabled'); });
  const original = process.env.APOLLO_TELEMETRY_DISABLED;
  process.env.APOLLO_TELEMETRY_DISABLED = 'false';
  try {
    const lab = await startLab();
    try {
      assert.equal(process.env.APOLLO_TELEMETRY_DISABLED, 'false');
      assert.equal(exporter.mock.callCount(), 0);
    }
    finally { await lab.stop(); }
  } finally {
    if (original === undefined) delete process.env.APOLLO_TELEMETRY_DISABLED;
    else process.env.APOLLO_TELEMETRY_DISABLED = original;
    exporter.mock.restore();
  }
});

it('rejects a bound gateway port and rolls back startup without killing the existing listener', async () => {
  const occupied = createServer((_, response) => response.end('existing listener'));
  await new Promise<void>(resolve => occupied.listen({ host: '127.0.0.1', port: 0 }, resolve));
  const port = (occupied.address() as AddressInfo).port;
  try {
    await assert.rejects(startLab({ port }), { code: 'EADDRINUSE' });
    assert.equal(await (await fetch(`http://127.0.0.1:${port}/`)).text(), 'existing listener');
  } finally {
    await new Promise<void>((resolve, reject) => { occupied.close(error => error ? reject(error) : resolve()); occupied.closeIdleConnections(); });
  }
});
