import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Kind, parse, print, visit } from 'graphql';
import { startLab } from './lab.ts';
import { apiSnapshot, compareContract, composeGraph, loadOperations, schemaSources } from './schema.ts';
import { sourceEvidence } from './cancellation-evidence.ts';

export const batchFailureCases = ['nullable-per-key', 'nullable-whole-batch', 'non-null-per-key'] as const;
export type BatchFailureCase = typeof batchFailureCases[number];

function sourcesFor(id: BatchFailureCase) {
  if (id !== 'non-null-per-key') return { ...schemaSources };
  let changed = 0;
  const inventory = visit(parse(schemaSources.inventory), {
    ObjectTypeDefinition(node) {
      if (node.name.value !== 'Product') return undefined;
      return { ...node, fields: node.fields?.map(field => {
        if (field.name.value !== 'availability' || field.type.kind !== Kind.NAMED_TYPE) return field;
        changed++;
        return { ...field, type: { kind: Kind.NON_NULL_TYPE as const, type: field.type } };
      }) };
    },
  });
  if (changed !== 1) throw new Error('The fixed nullable availability fixture changed.');
  return { ...schemaSources, inventory: print(inventory) };
}

export async function runBatchFailureCase(id: BatchFailureCase) {
  if (!batchFailureCases.includes(id)) throw new Error('Unknown batch failure case.');
  const sources = sourcesFor(id);
  const baseline = composeGraph().apiSchema;
  const failureMode = id === 'nullable-whole-batch' ? 'whole-batch' : 'per-key';
  const lab = await startLab({ subgraphTimeoutMs: 2000, fixture: {
    sources, inventoryFailure: { mode: failureMode, sku: 'demo-lamp' }, captureResponses: true,
  } });
  try {
    const request = { query: loadOperations()['CatalogCards.graphql']!,
      variables: { skus: ['demo-notebook', 'demo-lamp', 'demo-ceramic'] } };
    const response = await fetch(lab.url, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request), signal: AbortSignal.timeout(5000) });
    return {
      id,
      fixture: { failureMode, failedSku: 'demo-lamp', availabilityType: id === 'non-null-per-key' ? 'Availability!' : 'Availability', productsType: '[Product]!' },
      request,
      contract: { composition: 'composed', baselineApiSchema: apiSnapshot(baseline), candidateApiSchema: apiSnapshot(lab.apiSchema),
        ...compareContract(baseline, lab.apiSchema) },
      response: { status: response.status, body: await response.json() as unknown },
    };
  } finally { await lab.stop(); }
}

export async function runBatchFailureExperiment() {
  const sourceBefore = await sourceEvidence();
  const require = createRequire(import.meta.url);
  const packages = Object.fromEntries(['@apollo/gateway', '@apollo/subgraph', '@apollo/server', '@apollo/composition', 'graphql', 'dataloader'].map(name => {
    // Some packages do not export package.json. Inspect the resolved package's
    // own metadata instead of assuming a public subpath or a node_modules layout.
    let directory = dirname(require.resolve(name));
    for (;;) {
      const file = join(directory, 'package.json');
      if (existsSync(file)) {
        const metadata = JSON.parse(readFileSync(file, 'utf8')) as { name?: string; version?: string };
        if (metadata.name === name && typeof metadata.version === 'string') return [name, metadata.version];
      }
      if (directory === dirname(directory)) throw new Error(`Could not inspect installed package version: ${name}`);
      directory = dirname(directory);
    }
  }));
  const cases = [];
  for (const id of batchFailureCases) cases.push(await runBatchFailureCase(id));
  const sourceAfter = await sourceEvidence();
  return {
    version: 1, kind: 'batch-failure-boundary', generatedAt: new Date().toISOString(),
    tooling: { node: process.version, platform: process.platform, arch: process.arch, packages },
    sourceBefore, sourceAfter,
    sourceUnchanged: sourceBefore.sha256 === sourceAfter.sha256 && JSON.stringify(sourceBefore.git) === JSON.stringify(sourceAfter.git),
    cases,
    limits: [
      'Fixed synthetic inputs; gateway and three HTTP subgraphs run in one Node process on loopback.',
      'Each HTTP operation creates fresh DataLoaders. No application or cross-request cache is modeled.',
      'Wire errors carry a synthetic failedSku; serialized objects do not establish JavaScript Error identity.',
      'Response duration is diagnostic only, not a benchmark. No real database, client error policy, retry or production claim.',
      'Source hashes and consistency checks aid reproduction, not hostile-host attestation or detection of uninstrumented work.',
    ],
  };
}
