import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSchema } from 'graphql';
import { composeGraph, schemaSources, validateOperations, compareContract } from '../src/schema.ts';

const baseline = buildSchema(readFileSync(new URL('../schemas/api-baseline.graphql', import.meta.url), 'utf8'));

it('composes current subgraphs and satisfies both published operations and the API baseline', () => {
  assert.deepEqual(compareContract(baseline, composeGraph().apiSchema), { breaking: [], dangerous: [], operationErrors: [] });
});

it('rejects a conflicting cross-subgraph field type during composition', () => {
  assert.throws(() => composeGraph({ ...schemaSources, inventory: schemaSources.inventory.replace('sku: ID!', 'sku: Int!') }), /Composition failed/);
});

it('detects a field removal even when composition succeeds', () => {
  const next = composeGraph({ ...schemaSources, catalog: schemaSources.catalog.replace('  description: String!\n', '') });
  const report = compareContract(baseline, next.apiSchema);
  assert.ok(report.breaking.some(change => change.type === 'FIELD_REMOVED'));
  assert.ok(report.operationErrors.some(error => error.operation === 'CatalogOnly.graphql'));
});

it('detects output nullability weakening although existing queries still validate', () => {
  const next = composeGraph({ ...schemaSources, catalog: schemaSources.catalog.replace('name: String!', 'name: String') });
  const report = compareContract(baseline, next.apiSchema);
  assert.ok(report.breaking.some(change => change.type === 'FIELD_CHANGED_KIND'));
  assert.equal(report.operationErrors.length, 0);
});

it('flags an enum addition for review instead of treating query validation as sufficient', () => {
  const next = composeGraph({ ...schemaSources, inventory: schemaSources.inventory.replace('  SOLD_OUT\n', '  SOLD_OUT\n  PREORDER\n') });
  const report = compareContract(baseline, next.apiSchema);
  assert.equal(report.breaking.length, 0);
  assert.equal(report.operationErrors.length, 0);
  assert.ok(report.dangerous.some(change => change.type === 'VALUE_ADDED_TO_ENUM'));
});

it('allows an additive nullable field while retaining existing contracts', () => {
  const next = composeGraph({ ...schemaSources, catalog: schemaSources.catalog.replace('  description: String!', '  description: String!\n  subtitle: String') });
  assert.deepEqual(compareContract(baseline, next.apiSchema), { breaking: [], dangerous: [], operationErrors: [] });
});

it('reports syntactically invalid operations as contract failures', () => {
  const issues = validateOperations(composeGraph().apiSchema, { 'Broken.graphql': 'query {' });
  assert.equal(issues[0]!.operation, 'Broken.graphql');
  assert.match(issues[0]!.message, /Syntax Error/);
});

it('reports an unbound required argument in a client operation', () => {
  const issues = validateOperations(composeGraph().apiSchema, { 'MissingArgument.graphql': 'query { products { sku } }' });
  assert.match(issues[0]!.message, /required/);
});
