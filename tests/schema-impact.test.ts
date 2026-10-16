import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createImpactReport, formatImpactText } from '../src/schema-impact.ts';
import type { ImpactReport, ScenarioImpact } from '../src/schema-impact.ts';
import { scenarioSources } from '../src/evolution-scenarios.ts';
import type { EvolutionScenarioId } from '../src/evolution-scenarios.ts';
import { schemaSources } from '../src/schema.ts';

const report = createImpactReport();
const scenario = (id: EvolutionScenarioId): ScenarioImpact => report.scenarios.find(candidate => candidate.id === id)!;
const names = (operations: { operation: string }[] | null) => operations?.map(operation => operation.operation);

it('unchanged and safe-additive controls do not invent consumer impact', () => {
  assert.equal(report.scenarios.length, 7);
  for (const id of ['unchanged', 'add-optional-field'] as const) {
    const result = scenario(id);
    assert.equal(result.composition.status, 'composed');
    assert.equal(result.compatibility.classification, 'compatible');
    assert.deepEqual(result.invalidatedOperations, []);
    assert.deepEqual(result.validOperationsWithSchemaChanges, []);
    assert.ok(result.operations.every(operation => operation.validation === 'valid' && operation.selectedSchemaChanges!.length === 0));
  }
});

it('a field removal identifies exactly the affected named operation and source location', () => {
  const result = scenario('remove-description');
  assert.deepEqual(result.invalidatedOperations, [{ document: 'CatalogOnly.graphql', operation: 'CatalogOnly' }]);
  const unaffected = result.operations.find(operation => operation.operation === 'CatalogCards')!;
  assert.equal(unaffected.validation, 'valid');
  assert.deepEqual(unaffected.selectedSchemaChanges, []);
  const affected = result.operations.find(operation => operation.operation === 'CatalogOnly')!;
  assert.deepEqual(affected.errors[0]!.locations, [{ line: 5, column: 5 }]);
  assert.deepEqual(affected.selectedSchemaChanges, [{ coordinate: 'Product.description', kind: 'field-removed', before: 'String!', after: null }]);
});

it('weakened output nullability is a schema break while both GraphQL queries remain valid', () => {
  const result = scenario('weaken-name-nullability');
  assert.equal(result.compatibility.classification, 'breaking');
  assert.ok(result.compatibility.breaking!.some(change => change.type === 'FIELD_CHANGED_KIND'));
  assert.deepEqual(result.invalidatedOperations, []);
  assert.deepEqual(names(result.validOperationsWithSchemaChanges), ['CatalogCards', 'CatalogOnly']);
  assert.ok(result.operations.every(operation => operation.validation === 'valid' && operation.errors.length === 0));
  assert.deepEqual(result.operations[0]!.selectedSchemaChanges, [{ coordinate: 'Product.name', kind: 'output-type-changed', before: 'String!', after: 'String' }]);
});

it('a new required argument invalidates both consumers that omit it', () => {
  const result = scenario('require-region-argument');
  assert.equal(result.compatibility.classification, 'breaking');
  assert.ok(result.compatibility.breaking!.some(change => change.type === 'REQUIRED_ARG_ADDED'));
  assert.deepEqual(names(result.invalidatedOperations), ['CatalogCards', 'CatalogOnly']);
  assert.ok(result.operations.every(operation => operation.errors.some(error => error.message.includes('region'))));
});

it('enum expansion asks only the selecting consumer for schema review without claiming invalid queries', () => {
  const result = scenario('add-stock-enum-value');
  assert.equal(result.compatibility.classification, 'review-required');
  assert.deepEqual(result.compatibility.breaking, []);
  assert.deepEqual(result.invalidatedOperations, []);
  assert.deepEqual(names(result.validOperationsWithSchemaChanges), ['CatalogCards']);
  assert.equal(result.operations[1]!.validation, 'valid');
  assert.deepEqual(result.operations[1]!.selectedSchemaChanges, []);
});

it('failed composition leaves downstream checks explicitly unevaluated, never green', () => {
  const result = scenario('conflict-entity-key');
  assert.equal(result.composition.status, 'failed');
  assert.ok(result.composition.errors.some(error => error.code === 'FIELD_TYPE_MISMATCH'));
  assert.deepEqual(result.compatibility, { classification: 'not-evaluated', breaking: null, dangerous: null });
  assert.equal(result.invalidatedOperations, null);
  assert.equal(result.validOperationsWithSchemaChanges, null);
  assert.ok(result.operations.every(operation => operation.validation === 'not-evaluated' && operation.selectedSchemaChanges === null));
});

it('attributes a shared document fragment and alias to its selecting operation only', () => {
  const result = createImpactReport({
    scenarios: ['remove-description'],
    documents: {
      'TwoConsumers.graphql': `
        query Detailed($skus: [ID!]!) { products(skus: $skus) { ...Details } }
        query Minimal($skus: [ID!]!) { products(skus: $skus) { __typename name } }
        fragment Details on Product { about: description }
      `,
    },
  }).scenarios[0]!;
  assert.deepEqual(result.invalidatedOperations, [{ document: 'TwoConsumers.graphql', operation: 'Detailed' }]);
  assert.equal(result.operations.find(operation => operation.operation === 'Minimal')!.validation, 'valid');
  assert.deepEqual(result.operations.find(operation => operation.operation === 'Minimal')!.selectedSchemaChanges, []);
  assert.equal(result.operations[0]!.selectedSchemaChanges![0]!.coordinate, 'Product.description', 'schema coordinate uses field name, not response alias');
});

it('keeps equal operation names in different documents distinguishable', () => {
  const result = createImpactReport({ scenarios: ['remove-description'], documents: {
    'A.graphql': 'query Consumer { products(skus: []) { description } }',
    'B.graphql': 'query Consumer { products(skus: []) { name } }',
  } }).scenarios[0]!;
  assert.deepEqual(result.invalidatedOperations, [{ document: 'A.graphql', operation: 'Consumer' }]);
  assert.equal(result.operations[1]!.validation, 'valid');
});

it('treats conditional selections conservatively instead of assuming runtime variables', () => {
  const result = createImpactReport({ scenarios: ['weaken-name-nullability'], documents: {
    'Conditional.graphql': 'query Conditional($skip: Boolean!) { products(skus: []) { name @skip(if: $skip) } }',
  } }).scenarios[0]!;
  assert.equal(result.operations[0]!.validation, 'valid');
  assert.deepEqual(names(result.validOperationsWithSchemaChanges), ['Conditional']);
});

it('rejects invalid, anonymous or empty baseline consumers before comparing scenarios', () => {
  assert.throws(() => createImpactReport({ documents: { 'Invalid.graphql': 'query Invalid { doesNotExist }' } }), /Baseline document.*invalid/);
  assert.throws(() => createImpactReport({ documents: { 'Anonymous.graphql': '{ __typename }' } }), /named operations/);
  assert.throws(() => createImpactReport({ documents: {} }), /At least one named/);
  assert.throws(() => createImpactReport({ scenarios: [] }), /At least one evolution/);
  assert.throws(() => createImpactReport({ scenarios: ['unchanged', 'unchanged'] }), /at most once/);
});

it('makes fixture drift visible instead of silently reporting an unexecuted change', () => {
  const alreadyNullable = { ...schemaSources, catalog: schemaSources.catalog.replace('name: String!', 'name: String') };
  assert.throws(() => scenarioSources('weaken-name-nullability', alreadyNullable), /expects Product.name/);
  const alreadyRemoved = { ...schemaSources, catalog: schemaSources.catalog.replace('  description: String!\n', '') };
  assert.throws(() => scenarioSources('remove-description', alreadyRemoved), /exactly one Product.description/);
});

it('is deterministic and never rewrites the checked-in schema or baseline artifacts', () => {
  const files = ['catalog', 'inventory', 'merchants', 'api-baseline'].map(name => new URL(`../schemas/${name}.graphql`, import.meta.url));
  const before = files.map(file => readFileSync(file, 'utf8'));
  const sourcesBefore = structuredClone(schemaSources);
  assert.deepEqual(createImpactReport(), report);
  assert.deepEqual(schemaSources, sourcesBefore);
  assert.deepEqual(files.map(file => readFileSync(file, 'utf8')), before);
});

it('CLI JSON has one selected scenario and treats expected breakage as an experiment result', () => {
  const cli = fileURLToPath(new URL('../src/schema-impact-cli.ts', import.meta.url));
  const result = spawnSync(process.execPath, [cli, '--scenario', 'require-region-argument', '--format', 'json'], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as ImpactReport;
  assert.equal(parsed.scenarios.length, 1);
  assert.equal(parsed.scenarios[0]!.compatibility.classification, 'breaking');
  assert.deepEqual(names(parsed.scenarios[0]!.invalidatedOperations), ['CatalogCards', 'CatalogOnly']);
});

it('CLI rejects unknown or repeated options rather than silently changing scope', () => {
  const cli = fileURLToPath(new URL('../src/schema-impact-cli.ts', import.meta.url));
  for (const args of [['--scenario', 'typo'], ['--format', 'xml'], ['--format', 'text', '--format', 'json'], ['--write-baseline']]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.ok(result.stderr.length > 0);
  }
});

it('the text report preserves the distinction between query validation and schema review', () => {
  const text = formatImpactText(createImpactReport({ scenarios: ['weaken-name-nullability'] }));
  assert.match(text, /schema breaking/);
  assert.match(text, /CatalogCards.graphql#CatalogCards: valid/);
  assert.match(text, /schema review: Product.name \(String! -> String\)/);
  assert.match(text, /not runtime values/);
});
