import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parse, print, visit } from 'graphql';

// Expected public fixtures are independent of the experiment, cache library and
// resolvers. A forged summary cannot substitute for request/result/cache evidence.
const skus = ['demo-notebook', 'demo-lamp', 'demo-ceramic'];
const merchantIds = ['merchant-north', 'merchant-east', 'merchant-north'];
const quantities = [0, 3, 8];
const data = (failed: boolean) => ({ products: skus.map((sku, i) => ({
  __typename: 'Product', sku, name: ['Field Notes Journal', 'Arc Desk Lamp', 'Orbit Ceramic Cup'][i],
  price: { __typename: 'Money', amountMinor: [1800, 6900, 2400][i], currency: 'USD' },
  merchant: { __typename: 'Merchant', id: merchantIds[i], name: i === 1 ? 'East Workshop' : 'North Studio', city: i === 1 ? 'Sample Town' : 'Example City' },
  availability: failed && i === 1 ? null : { __typename: 'Availability', status: i === 0 ? 'SOLD_OUT' : 'IN_STOCK', quantity: quantities[i] },
})) });
const query = `query CatalogCards($skus:[ID!]!) { products(skus:$skus) {
  sku name price { amountMinor currency } merchant { id name city } availability { status quantity }
} }`;
const wireQuery = `query CatalogCards($skus:[ID!]!) { products(skus:$skus) {
  sku name price { amountMinor currency __typename } merchant { id name city __typename }
  availability { status quantity __typename } __typename
} }`;
const subgraphQueries = {
  catalog: `query($skus:[ID!]!) { products(skus:$skus) { __typename sku name price { __typename amountMinor currency } merchant { __typename id } } }`,
  inventory: `query($representations:[_Any!]!) { _entities(representations:$representations) { ... on Product { availability { __typename status quantity } } } }`,
  merchants: `query($representations:[_Any!]!) { _entities(representations:$representations) { ... on Merchant { name city } } }`,
};
const gatewayErrors = [{ message: 'Synthetic inventory lookup failed.', path: ['products', 1, 'availability'],
  extensions: { code: 'INVENTORY_KEY_FAILURE', failedSku: 'demo-lamp', serviceName: 'inventory' } }];
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
function object(value: unknown, label: string): Record<string, unknown> {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), `${label}: object required.`);
  return value as Record<string, unknown>;
}
function array(value: unknown, label: string): unknown[] { assert.ok(Array.isArray(value), `${label}: array required.`); return value; }
function string(value: unknown, label: string): string { assert.equal(typeof value, 'string', `${label}: string required.`); return value as string; }
function signature(text: unknown, generated = false) {
  return print(visit(parse(string(text, 'query')), {
    OperationDefinition(node) { return generated ? { ...node, name: undefined } : undefined; },
    SelectionSet: { leave(node) { return { ...node, selections: [...node.selections].sort((a, b) => print(a).localeCompare(print(b))) }; } },
  }));
}
function expectedCache(failed: boolean): Record<string, unknown> {
  const cache: Record<string, unknown> = {};
  for (const product of data(failed).products) {
    const merchantKey = `Merchant:${JSON.stringify({ id: product.merchant.id })}`;
    cache[merchantKey] = product.merchant;
    cache[`Product:${JSON.stringify({ sku: product.sku })}`] = { ...product, merchant: { __ref: merchantKey } };
  }
  cache.ROOT_QUERY = { __typename: 'Query', [`products(${JSON.stringify({ skus })})`]: skus.map(sku => ({ __ref: `Product:${JSON.stringify({ sku })}` })) };
  return cache;
}
function verifyHttp(value: unknown, endpoint: string, sequence: number, requestIds: Set<string>) {
  const request = object(value, 'HTTP observation');
  assert.equal(request.sequence, sequence, 'HTTP sequence must be contiguous within the client.');
  assert.equal(request.endpoint, endpoint, 'HTTP target must agree with the step.');
  assert.equal(request.transportError, null, 'A transport failure cannot establish the resolver-error comparison.');
  const sent = object(request.request, 'HTTP request');
  assert.equal(sent.method, 'POST');
  const body = object(JSON.parse(string(sent.bodyText, 'request bytes')), 'GraphQL POST');
  assert.equal(body.operationName, 'CatalogCards');
  assert.equal(signature(body.query), signature(wireQuery), 'Wire operation/selected fields changed.');
  assert.deepEqual(body.variables, { skus }, 'Wire SKU order changed.');
  assert.deepEqual(body.extensions, { clientLibrary: { name: '@apollo/client', version: '4.3.3' } });
  const received = object(request.response, 'HTTP response');
  assert.equal(received.status, 200, 'Expected a resolver failure inside HTTP 200.');
  const raw = string(received.bodyText, 'response bytes');
  assert.equal(received.sha256, sha(raw), 'Response SHA-256 mismatch.');
  const response = object(JSON.parse(raw), 'GraphQL envelope');
  const failed = endpoint === 'failure';
  assert.deepEqual(response.data, data(failed), 'Actual gateway values must match this fixture.');
  assert.deepEqual(response.errors ?? [], failed ? gatewayErrors : [], 'Actual gateway error path/cause mismatch.');
  const lab = object(object(response.extensions, 'extensions').lab, 'gateway observation');
  assert.equal(lab.scenario, 'healthy', 'Header scenario stays healthy; resolver failure belongs to the fixed server fixture.');
  const requestId = string(lab.requestId, 'gateway request ID');
  assert.match(requestId, /^[0-9a-f-]{36}$/);
  assert.ok(!requestIds.has(requestId), 'Reused gateway response/request ID.');
  requestIds.add(requestId);
  const fetches = array(lab.fetches, 'subgraph fetches').map(value => object(value, 'subgraph fetch'));
  assert.deepEqual(fetches.map(item => item.service).sort(), ['catalog', 'inventory', 'merchants']);
  for (const trace of fetches) {
    const name = String(trace.service) as keyof typeof subgraphQueries;
    assert.equal(trace.outcome, failed && name === 'inventory' ? 'graphql-error' : 'ok');
    const keys = name === 'merchants' ? ['merchant-north', 'merchant-east'] : skus;
    assert.deepEqual(trace.batches, [{ source: name, keys }], 'Subgraph batch keys mismatch.');
    const capture = object(trace.captured, 'subgraph capture');
    const capturedRequest = object(capture.request, 'subgraph request');
    assert.equal(signature(capturedRequest.query, true), signature(subgraphQueries[name], true), 'Subgraph operation mismatch.');
    assert.deepEqual(capturedRequest.variables, name === 'catalog' ? { skus } : { representations: name === 'inventory'
      ? skus.map(sku => ({ __typename: 'Product', sku }))
      : merchantIds.map(id => ({ __typename: 'Merchant', id })) }, 'Subgraph entity mapping mismatch.');
    const downstream = object(capture.response, 'subgraph response');
    const capturedLab = object(object(downstream.extensions, 'subgraph extensions').lab, 'subgraph metadata');
    assert.deepEqual(capturedLab.batches, trace.batches, 'Captured subgraph batches must agree with the gateway trace.');
    const products = data(failed).products;
    const expectedData = name === 'inventory' ? { _entities: products.map(product => ({ availability: product.availability })) }
      : name === 'catalog' ? { products: products.map(product => ({ __typename: 'Product', sku: product.sku, name: product.name, price: product.price, merchant: { __typename: 'Merchant', id: product.merchant.id } })) }
      : { _entities: products.map(product => ({ name: product.merchant.name, city: product.merchant.city })) };
    assert.deepEqual(downstream.data, expectedData, 'Subgraph field values mismatch.');
    const errors = array(downstream.errors ?? [], 'subgraph errors').map(value => {
      const error = object(value, 'subgraph error');
      return { message: error.message, path: error.path, extensions: error.extensions };
    });
    assert.deepEqual(errors, failed && name === 'inventory' ? [{ message: gatewayErrors[0]!.message,
      path: ['_entities', 1, 'availability'], extensions: { code: 'INVENTORY_KEY_FAILURE', failedSku: 'demo-lamp' } }] : []);
  }
}

export function checkClientCacheEvidence(input: unknown) {
  try {
    const report = object(input, 'experiment');
    assert.equal(signature(report.query), signature(query), 'Selected operation changed.');
    assert.deepEqual(report.variables, { skus });
    assert.deepEqual(report.cacheConfiguration, { typePolicies: { Product: { keyFields: ['sku'] }, Merchant: { keyFields: ['id'] } } });
    const cases = array(report.cases, 'cases').map(value => object(value, 'case'));
    assert.deepEqual(cases.map(item => item.id), ['all-cold', 'none-warm', 'all-warm', 'ignore-warm', 'all-no-cache'], 'Fixed case coverage/order mismatch.');
    const observations = [];
    const requestIds = new Set<string>();
    for (const item of cases) {
      const id = string(item.id, 'case ID');
      const warm = id.endsWith('-warm');
      const noCache = id === 'all-no-cache';
      const policy = id === 'none-warm' ? 'none' : id === 'ignore-warm' ? 'ignore' : 'all';
      const steps = array(item.steps, 'steps').map(value => object(value, 'step'));
      assert.deepEqual(steps.map(step => step.label), warm ? ['warm', 'failed', 'cache-first'] : ['failed', 'cache-first'], 'Step order mismatch.');
      let cache: Record<string, unknown> = {};
      let nextSequence = 1;
      for (const step of steps) {
        const isWarm = step.label === 'warm';
        const isNext = step.label === 'cache-first';
        const fetchPolicy = isNext ? 'cache-first' : noCache ? 'no-cache' : 'network-only';
        const endpoint = isWarm ? 'healthy' : 'failure';
        assert.equal(step.endpoint, endpoint, 'The follow-up stays on the failed server.');
        assert.equal(step.fetchPolicy, fetchPolicy);
        assert.equal(step.errorPolicy, policy);
        assert.deepEqual(step.cacheBefore, cache, 'Cache continuity mismatch.');
        const http = array(step.http, 'step HTTP observations');
        const network = !isNext || noCache;
        assert.equal(http.length, network ? 1 : 0, 'Unexpected HTTP request count; cached data is not a fresh lookup.');
        for (const request of http) verifyHttp(request, endpoint, nextSequence++, requestIds);
        const rejected = !isWarm && !isNext && policy === 'none';
        const hasError = network && !isWarm && policy !== 'ignore';
        const resultData = rejected ? null : data(isWarm || (isNext && policy === 'none') ? false : true);
        const error = hasError ? { name: 'CombinedGraphQLErrors', message: gatewayErrors[0]!.message,
          errors: gatewayErrors, dataPresent: true, data: data(true) } : null;
        assert.deepEqual(step.result, { status: rejected ? 'rejected' : 'resolved', dataPresent: !rejected,
          data: resultData, error }, 'Client settlement/data/error evidence mismatch.');
        if (network && fetchPolicy !== 'no-cache' && !rejected) cache = expectedCache(!isWarm);
        assert.deepEqual(step.cacheAfter, cache, 'Normalized cache write/preservation mismatch.');
        assert.deepEqual(step.readAfter, Object.keys(cache).length ? data(isWarm || policy === 'none' ? false : true) : null,
          'cache.readQuery must agree with stored fields.');
      }
      const failed = steps.find(step => step.label === 'failed')!;
      const next = steps.at(-1)!;
      const result = object(next.result, 'next result');
      observations.push({ id, failedStatus: object(failed.result, 'failed result').status,
        failedHasError: object(failed.result, 'failed result').error !== null,
        nextHttpRequests: array(next.http, 'next HTTP').length, nextHasError: result.error !== null,
        nextLampQuantity: policy === 'none' ? 3 : null, priorHealthyValueRetained: policy === 'none' });
    }
    return { evidenceValid: true, violations: [] as string[], observations };
  } catch (error) {
    return { evidenceValid: false, violations: [error instanceof Error ? error.message : 'Invalid client/cache evidence.'], observations: null };
  }
}

export function checkClientCacheReport(input: unknown) {
  const evidence = checkClientCacheEvidence(input);
  if (!evidence.evidenceValid) return evidence;
  try {
    const report = object(input, 'report');
    assert.equal(report.version, 1); assert.equal(report.kind, 'client-cache-boundary');
    assert.ok(Number.isFinite(Date.parse(string(report.generatedAt, 'capture time'))));
    const tooling = object(report.tooling, 'tooling');
    assert.match(string(tooling.node, 'Node version'), /^v\d+\.\d+\.\d+$/, 'Node version must be recorded.');
    for (const key of ['platform', 'arch']) assert.match(string(tooling[key], key), /^[a-z][a-z0-9_]*$/, `${key} must be recorded.`);
    assert.deepEqual(object(tooling.packages, 'packages'), {
      '@apollo/client': '4.3.3', rxjs: '7.8.2', graphql: '16.14.2',
      '@apollo/gateway': '2.14.4', '@apollo/server': '5.5.1', '@apollo/subgraph': '2.14.4', dataloader: '2.2.3',
    }, 'Pinned installed package versions changed or are incomplete (Apollo Client 4.3.3).');
    const before = object(report.sourceBefore, 'source before');
    const after = object(report.sourceAfter, 'source after');
    for (const source of [before, after]) {
      const manifest = array(source.manifest, 'source manifest');
      assert.ok(manifest.length > 0, 'Source manifest must not be empty.');
      const paths = new Set<string>();
      let previous = '';
      for (const value of manifest) {
        const entry = object(value, 'source entry');
        const path = string(entry.path, 'source path');
        assert.ok(path.length > 0 && !/[:\\\x00-\x1f\x7f]/.test(path)
          && path.split('/').every(part => part.length > 0 && part !== '.' && part !== '..'),
        'Source paths must be normalized relative file paths.');
        assert.ok(!paths.has(path) && path > previous, 'Source paths must be unique and sorted.');
        assert.match(string(entry.sha256, 'source file digest'), /^[0-9a-f]{64}$/, 'Source file digest must be a SHA-256 value.');
        paths.add(path); previous = path;
      }
      // This checks required experiment inputs, not authenticity or an exhaustive
      // reconstruction of the host filesystem from its claimed manifest.
      for (const required of [
        'src/client-cache-experiment.ts', 'src/client-cache-check.ts', 'src/client-cache-cli.ts',
        'src/lab.ts', 'src/subgraphs.ts', 'src/loaders.ts', 'src/schema.ts', 'src/http-server.ts',
        'src/cancellation-evidence.ts', 'operations/CatalogCards.graphql',
        'schemas/catalog.graphql', 'schemas/inventory.graphql', 'schemas/merchants.graphql',
        'package.json', 'pnpm-lock.yaml',
      ]) assert.ok(paths.has(required), `Missing required source file: ${required}`);
      assert.equal(source.sha256, sha(JSON.stringify(manifest)), 'Source manifest digest mismatch.');
      if (source.git !== null) {
        const git = object(source.git, 'Git state');
        assert.match(string(git.head, 'Git head'), /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/, 'Git head must be an object ID.');
        assert.ok(!/[\x00-\x1f\x7f]/.test(string(git.branch, 'Git branch')), 'Git branch must not contain control characters.');
        assert.equal(typeof git.dirty, 'boolean', 'Git dirty state must be boolean.');
      }
    }
    assert.deepEqual(after, before, 'Source changed during capture.');
    assert.equal(report.sourceUnchanged, true);
    return evidence;
  } catch (error) {
    return { evidenceValid: false, violations: [error instanceof Error ? error.message : 'Invalid report provenance.'], observations: null };
  }
}
