import { readFileSync } from 'node:fs';
import { buildSchema } from 'graphql';
import { composeGraph, compareContract, loadOperations } from './schema.ts';

const baseline = buildSchema(readFileSync(new URL('../schemas/api-baseline.graphql', import.meta.url), 'utf8'));
const current = composeGraph();
const report = compareContract(baseline, current.apiSchema);
console.log(JSON.stringify({ composedSubgraphs: 3, operations: Object.keys(loadOperations()), ...report }, null, 2));
// A deliberately strict local policy: dangerous changes need explicit review too.
if (report.breaking.length || report.dangerous.length || report.operationErrors.length) process.exitCode = 1;
