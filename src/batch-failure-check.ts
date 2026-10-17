import assert from 'node:assert/strict';
import { buildSchema, findBreakingChanges, findDangerousChanges, Kind, parse, print, validate } from 'graphql';
import type { SelectionSetNode } from 'graphql';

// Independent expected values for the three public synthetic records. This checker
// neither imports resolvers/loaders nor accepts their summary counters as evidence.
const expected = [
  { sku: 'demo-notebook', name: 'Field Notes Journal', price: { amountMinor: 1800, currency: 'USD' },
    merchant: { id: 'merchant-north', name: 'North Studio', city: 'Example City' }, availability: { status: 'SOLD_OUT', quantity: 0 } },
  { sku: 'demo-lamp', name: 'Arc Desk Lamp', price: { amountMinor: 6900, currency: 'USD' },
    merchant: { id: 'merchant-east', name: 'East Workshop', city: 'Sample Town' }, availability: { status: 'IN_STOCK', quantity: 3 } },
  { sku: 'demo-ceramic', name: 'Orbit Ceramic Cup', price: { amountMinor: 2400, currency: 'USD' },
    merchant: { id: 'merchant-north', name: 'North Studio', city: 'Example City' }, availability: { status: 'IN_STOCK', quantity: 8 } },
];
const skus = expected.map(item => item.sku);
const operation = `query CatalogCards($skus: [ID!]!) {
  products(skus: $skus) { sku name price { amountMinor currency } merchant { id name city } availability { status quantity } }
}`;
const subgraphOperations: Record<string, string> = {
  catalog: `query($skus:[ID!]!) { products(skus:$skus) { __typename sku name price { amountMinor currency } merchant { __typename id } } }`,
  inventory: `query($representations:[_Any!]!) { _entities(representations:$representations) { ... on Product { availability { status quantity } } } }`,
  merchants: `query($representations:[_Any!]!) { _entities(representations:$representations) { ... on Merchant { name city } } }`,
};

function object(value: unknown, label: string): Record<string, unknown> {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), `${label}: object required.`);
  return value as Record<string, unknown>;
}
function array(value: unknown, label: string): unknown[] { assert.ok(Array.isArray(value), `${label}: array required.`); return value; }
function string(value: unknown, label: string): string { assert.equal(typeof value, 'string', `${label}: string required.`); return value as string; }
const sorted = (values: unknown[]) => [...values].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

// Compare the fixed operation's meaning without pinning generated operation names,
// whitespace or field order. Aliases/directives/defaults/fragments would change the
// fixture's value/path assumptions, so they must not silently enter the evidence.
function operationSignature(source: string) {
  const document = parse(source);
  assert.equal(document.definitions.length, 1, 'One subgraph operation required.');
  const definition = document.definitions[0]!;
  assert.equal(definition.kind, Kind.OPERATION_DEFINITION);
  assert.ok(definition.kind === Kind.OPERATION_DEFINITION);
  assert.equal(definition.operation, 'query');
  assert.equal(definition.directives?.length ?? 0, 0);
  function selections(set: SelectionSetNode): unknown[] {
    return sorted(set.selections.map(selection => {
      assert.equal(selection.directives?.length ?? 0, 0);
      if (selection.kind === Kind.INLINE_FRAGMENT) {
        assert.ok(selection.typeCondition);
        return { on: selection.typeCondition.name.value, selections: selections(selection.selectionSet) };
      }
      assert.ok(selection.kind === Kind.FIELD, 'Named fragment spreads are outside this fixed query plan.');
      assert.equal(selection.alias, undefined, 'Unexpected response alias.');
      return { field: selection.name.value, arguments: sorted((selection.arguments ?? []).map(argument => {
        assert.ok(argument.value.kind === Kind.VARIABLE, 'Expected a bound variable argument.');
        return { name: argument.name.value, variable: argument.value.name.value };
      })), selections: selection.selectionSet ? selections(selection.selectionSet) : [] };
    }));
  }
  return { variables: sorted((definition.variableDefinitions ?? []).map(variable => {
    assert.equal(variable.defaultValue, undefined);
    assert.equal(variable.directives?.length ?? 0, 0);
    return { name: variable.variable.name.value, type: print(variable.type) };
  })), selections: selections(definition.selectionSet) };
}

export function checkBatchFailureCase(input: unknown) {
  try {
    const item = object(input, 'case');
    assert.ok(['nullable-per-key', 'nullable-whole-batch', 'non-null-per-key'].includes(String(item.id)), 'Unknown fixed case.');
    const whole = item.id === 'nullable-whole-batch';
    const nonNull = item.id === 'non-null-per-key';
    assert.deepEqual(item.fixture, { failureMode: whole ? 'whole-batch' : 'per-key', failedSku: 'demo-lamp',
      availabilityType: nonNull ? 'Availability!' : 'Availability', productsType: '[Product]!' }, 'Fixture identity changed.');
    const request = object(item.request, 'request');
    assert.equal(print(parse(string(request.query, 'query'))), print(parse(operation)), 'Selected operation changed.');
    assert.deepEqual(request.variables, { skus }, 'Input SKU order changed.');
    const contract = object(item.contract, 'contract');
    assert.equal(contract.composition, 'composed');
    const baseline = buildSchema(string(contract.baselineApiSchema, 'baseline API'));
    const candidate = buildSchema(string(contract.candidateApiSchema, 'candidate API'));
    assert.equal(baseline.getQueryType()?.getFields().products?.type.toString(), '[Product]!', 'Baseline list boundary changed.');
    const baselineProduct = baseline.getType('Product');
    assert.ok(baselineProduct && 'getFields' in baselineProduct);
    assert.equal(baselineProduct.getFields().availability?.type.toString(), 'Availability', 'Baseline availability must be nullable.');
    assert.equal(candidate.getQueryType()?.getFields().products?.type.toString(), '[Product]!');
    assert.equal(candidate.getType('Product')?.toString(), 'Product');
    const product = candidate.getType('Product');
    assert.ok(product && 'getFields' in product);
    assert.equal(product.getFields().availability?.type.toString(), nonNull ? 'Availability!' : 'Availability');
    assert.deepEqual(findBreakingChanges(baseline, candidate), [], 'Unexpected breaking schema change.');
    assert.deepEqual(findDangerousChanges(baseline, candidate), [], 'Unexpected dangerous schema change.');
    assert.deepEqual(validate(candidate, parse(operation)), [], 'Operation is not valid.');
    assert.deepEqual([contract.breaking, contract.dangerous, contract.operationErrors], [[], [], []], 'Recorded contract result disagrees.');

    const response = object(item.response, 'response');
    assert.equal(response.status, 200, 'HTTP request did not complete as expected.');
    const body = object(response.body, 'response body');
    const lab = object(object(body.extensions, 'extensions').lab, 'lab trace');
    assert.match(string(lab.requestId, 'request identity'), /^[a-f0-9-]{36}$/);
    assert.equal(lab.scenario, 'healthy', 'An unrelated incoming scenario changed the experiment.');
    const fetches = array(lab.fetches, 'fetch traces').map(value => object(value, 'fetch trace'));
    assert.deepEqual(fetches.map(value => value.service).sort(), ['catalog', 'inventory', 'merchants'], 'Expected exactly three subgraph fetches.');
    function captured(service: string, keys: string[]) {
      const trace = fetches.find(value => value.service === service)!;
      assert.equal(trace.outcome, service === 'inventory' ? 'graphql-error' : 'ok');
      assert.ok(typeof trace.durationMs === 'number' && Number.isFinite(trace.durationMs) && trace.durationMs >= 0);
      const batches = [{ source: service, keys }];
      assert.deepEqual(trace.batches, batches, `${service}: batch order or membership changed.`);
      const capture = object(trace.captured, `${service}: capture`);
      const outgoing = object(capture.request, `${service}: request`);
      const incoming = object(capture.response, `${service}: response`);
      assert.deepEqual(operationSignature(string(outgoing.query, `${service}: query`)),
        operationSignature(subgraphOperations[service]!), `${service}: selected operation or argument binding changed.`);
      assert.deepEqual(object(object(incoming.extensions, 'extensions').lab, 'batch trace').batches, batches, 'Envelope and trace batches disagree.');
      if (service !== 'inventory') assert.equal(incoming.errors, undefined, `${service}: unexpected error.`);
      return { outgoing, incoming };
    }
    const catalog = captured('catalog', skus);
    assert.deepEqual(catalog.outgoing.variables, { skus });
    assert.deepEqual(catalog.incoming.data, { products: expected.map(item => ({ __typename: 'Product', sku: item.sku, name: item.name,
      price: item.price, merchant: { __typename: 'Merchant', id: item.merchant.id } })) }, 'Catalog fields were not available before inventory failure.');
    const inventory = captured('inventory', skus);
    assert.deepEqual(inventory.outgoing.variables, { representations: skus.map(sku => ({ __typename: 'Product', sku })) }, 'Inventory representation order changed.');
    const merchant = captured('merchants', ['merchant-north', 'merchant-east']);
    assert.deepEqual(merchant.outgoing.variables, { representations: expected.map(item => ({ __typename: 'Merchant', id: item.merchant.id })) }, 'Merchant representation mapping changed.');
    assert.deepEqual(merchant.incoming.data, { _entities: expected.map(item => ({ name: item.merchant.name, city: item.merchant.city })) });

    const indices = whole ? [0, 1, 2] : [1];
    function errors(value: unknown, root: string, atGateway: boolean) {
      const observed = array(value, `${root}: errors`).map(value => {
        const error = object(value, 'GraphQL error');
        assert.equal(error.message, 'Synthetic inventory lookup failed.');
        assert.deepEqual(error.extensions, { code: 'INVENTORY_KEY_FAILURE', failedSku: 'demo-lamp', ...(atGateway ? { serviceName: 'inventory' } : {}) }, 'Error attribution changed.');
        return error.path;
      });
      assert.deepEqual(sorted(observed), sorted(indices.map(index => [root, index, 'availability'])), `${root}: error paths do not identify the affected positions.`);
    }
    errors(inventory.incoming.errors, '_entities', false);
    errors(body.errors, 'products', true);
    assert.deepEqual(inventory.incoming.data, { _entities: expected.map((item, index) => nonNull && index === 1 ? null :
      { availability: whole || index === 1 ? null : item.availability }) }, 'Subgraph null/error boundary changed.');
    assert.deepEqual(body.data, { products: expected.map((item, index) => nonNull && index === 1 ? null :
      { ...item, availability: whole || index === 1 ? null : item.availability }) }, 'Gateway value preservation or null boundary changed.');
    const products = array(object(body.data, 'data').products, 'products');
    return { evidenceValid: true, violations: [] as string[], observed: {
      productCount: products.filter(value => value !== null).length,
      knownInventoryCount: products.filter(value => value !== null && object(value, 'product').availability !== null).length,
      errorPaths: array(body.errors, 'errors').map(value => object(value, 'error').path),
    } };
  } catch (error) {
    return { evidenceValid: false, violations: [error instanceof Error ? error.message : 'Malformed evidence.'], observed: null };
  }
}
