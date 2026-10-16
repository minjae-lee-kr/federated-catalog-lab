import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { startLab } from '../src/lab.ts';
import { startUi } from '../src/ui-server.ts';

describe('local demo HTTP boundary', () => {
  let lab: Awaited<ReturnType<typeof startLab>>;
  let ui: Awaited<ReturnType<typeof startUi>>;
  before(async () => { lab = await startLab({ subgraphTimeoutMs: 1000 }); ui = await startUi(lab.url); });
  after(async () => { await ui?.stop(); await lab?.stop(); });
  const run = (body: unknown, headers: Record<string, string> = {}) => fetch(`${ui.url}run`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  });

  it('serves a self-contained page with a restrictive resource policy', async () => {
    const response = await fetch(ui.url);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy')!, /connect-src 'self'/);
    assert.match(await response.text(), /Honest failures/);
    assert.equal((await fetch(`${ui.url}style.css`)).status, 200);
  });

  it('proxies a named operation to the real gateway', async () => {
    const response = await run({ operation: 'CatalogCards.graphql', scenario: 'healthy', duplicates: true });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.data.products.length, 4);
    assert.equal(result.extensions.lab.fetches.length, 3);
  });

  it('rejects cross-origin browser requests', async () => {
    assert.equal((await run({ operation: 'CatalogCards.graphql' }, { origin: 'https://example.invalid' })).status, 403);
  });

  it('rejects an unexpected host header', async () => {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(ui.url, { headers: { host: 'untrusted.example' } }, res => { res.resume(); resolve(res.statusCode); });
      req.once('error', reject);
      req.end();
    });
    assert.equal(status, 403);
  });

  it('does not accept arbitrary GraphQL or special object property names as operations', async () => {
    assert.equal((await run({ operation: '__proto__', query: '{ __typename }' })).status, 400);
  });

  it('requires boolean duplicate selection and rejects extra capability fields', async () => {
    for (const duplicates of ['false', {}, [], null, 0, 1]) {
      assert.equal((await run({ operation: 'CatalogCards.graphql', scenario: 'healthy', duplicates })).status, 400);
    }
    assert.equal((await run({ operation: 'CatalogCards.graphql', query: '{ __typename }' })).status, 400);
    assert.equal((await run({ operation: 'CatalogCards.graphql', duplicates: false })).status, 200);
  });

  it('rejects unknown scenarios and non-JSON bodies', async () => {
    assert.equal((await run({ operation: 'CatalogCards.graphql', scenario: 'arbitrary' })).status, 400);
    assert.equal((await run({}, { 'content-type': 'text/plain' })).status, 415);
  });

  it('rejects oversized requests and prevents arbitrary file access', async () => {
    assert.equal((await run({ padding: 'x'.repeat(33000) })).status, 413);
    assert.equal((await fetch(`${ui.url}package.json`)).status, 404);
  });
});
