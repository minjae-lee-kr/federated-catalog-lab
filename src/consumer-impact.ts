import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSchema, parse, printSchema, validate } from 'graphql';
import { scenarioSources } from './evolution-scenarios.ts';
import { composeGraph } from './schema.ts';
import type { ServiceName } from './schema.ts';
import { createImpactReport } from './schema-impact.ts';
import { runTool } from './consumer-impact-process.ts';
import type { ToolCommand } from './consumer-impact-process.ts';

const require = createRequire(import.meta.url);
const moduleRoot = fileURLToPath(new URL('../', import.meta.url));
const root = existsSync(path.join(moduleRoot, 'package.json')) ? moduleRoot : path.resolve(moduleRoot, '..');
const names = ['strict-name', 'nullable-name', 'exhaustive-status', 'fallback-status'] as const;
const operations = ['CatalogOnly', 'CatalogCards'] as const;
const scenarios = ['unchanged', 'add-optional-field', 'weaken-name-nullability', 'add-stock-enum-value'] as const;
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const compilerOptions = { strict: true, noCheck: false, noEmit: true, skipLibCheck: false, noUncheckedIndexedAccess: true,
  exactOptionalPropertyTypes: true, target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', types: [], lib: ['ES2022'] };
const generatorOptions = { enumType: 'string-literal', maybeValue: 'T | null', immutableTypes: true, futureProofEnums: false };
type Generated = Record<string, string>;
interface Compilation { exitCode: number; diagnosticCodes: number[]; diagnostics: string; consumerSha256: string }
interface Case {
  id: string; schema: string; generatorPolicy: typeof generatorOptions; regenerated: boolean;
  candidateSchemaSha256: string; generatedFromSchemaSha256: string;
  operationValidation: Record<string, 'valid'>; generatedSha256: Record<string, string>;
  consumers: Record<string, Compilation>;
}
export interface ConsumerImpactReport {
  version: 1; mode: 'generated-consumer-compilation';
  tooling: { node: string; packages: Record<string, string>; compilerOptions: typeof compilerOptions };
  inputs: { path: string; sha256: string }[]; inputsUnchanged: true;
  cases: Case[]; limits: string[];
}

export async function runConsumerImpact(options: {
  reportDir?: string; timeoutMs?: number; signal?: AbortSignal;
  // Programmatic overrides allow tool-failure tests; the CLI exposes no tool injection.
  generator?: ToolCommand; compiler?: ToolCommand; scratchParent?: string;
} = {}): Promise<ConsumerImpactReport> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('timeoutMs must be a positive integer.');
  const destination = options.reportDir ? path.resolve(options.reportDir) : undefined;
  if (destination) {
    if (existsSync(destination)) throw new Error('Report directory must be new.');
    for (let parent = path.dirname(destination); ; parent = path.dirname(parent)) {
      const stat = lstatSync(parent);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Report parent must be an ordinary directory.');
      if (path.dirname(parent) === parent) break;
    }
  }
  const inputPaths = ['schemas/api-baseline.graphql', ...['catalog', 'inventory', 'merchants'].map(name => `schemas/${name}.graphql`),
    ...operations.map(name => `operations/${name}.graphql`), ...names.map(name => `fixtures/consumers/${name}.ts`)];
  const inputs = Object.fromEntries(inputPaths.map(name => [name, readFileSync(path.join(root, name))]));
  const verifyInputs = () => { for (const name of inputPaths) assert.ok(readFileSync(path.join(root, name)).equals(inputs[name]!), `Input changed: ${name}`); };
  const documents = Object.fromEntries(operations.map(name => [name, inputs[`operations/${name}.graphql`]!.toString('utf8')]));
  const sources = Object.fromEntries(['catalog', 'inventory', 'merchants'].map(name => [name, inputs[`schemas/${name}.graphql`]!.toString('utf8')])) as Record<ServiceName, string>;
  const impact = createImpactReport({ baseline: buildSchema(inputs['schemas/api-baseline.graphql']!.toString('utf8')), documents, sources, scenarios });
  const scratchParent = path.resolve(options.scratchParent ?? os.tmpdir());
  const scratch = mkdtempSync(path.join(scratchParent, 'consumer-impact-'));
  assert.equal(path.dirname(scratch), scratchParent);
  const worker = fileURLToPath(new URL(import.meta.url.endsWith('.ts') ? './consumer-impact-worker.ts' : './consumer-impact-worker.js', import.meta.url));
  const generator = options.generator ?? { executable: process.execPath, args: [worker] };
  const tool = (command: ToolCommand, label: string, cwd: string, input?: string) => runTool(command, { label, cwd, timeoutMs,
    ...(input === undefined ? {} : { input }), ...(options.signal === undefined ? {} : { signal: options.signal }) });
  const write = (name: string, content: string | Buffer) => {
    const file = path.join(scratch, name); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, content, { flag: 'wx' });
  };
  try {
    const compiler = options.compiler ?? { executable: process.execPath, args: [path.join(path.dirname(require.resolve('typescript/package.json')), 'bin/tsc')] };
    const packages = Object.fromEntries(['@apollo/composition', '@apollo/federation-internals', 'graphql', '@graphql-codegen/core', '@graphql-codegen/typescript-operations', 'graphql-sock', 'typescript'].map(name => [name, (require(`${name}/package.json`) as { version: string }).version]));
    const cases: Case[] = [];
    let baseline: Generated | undefined;
    let baselineSchema = '';
    for (const scenario of scenarios) {
      const sdl = `${printSchema(composeGraph(scenarioSources(scenario, sources)).apiSchema)}\n`;
      const schema = buildSchema(sdl);
      for (const source of Object.values(documents)) assert.equal(validate(schema, parse(source)).length, 0, 'Unexpected invalid operation.');
      write(`schemas/${scenario}.graphql`, sdl);
      const policies = scenario === 'unchanged' || scenario === 'add-stock-enum-value' ? [false, true] : [false];
      for (const futureProofEnums of policies) {
        const config = { ...generatorOptions, futureProofEnums };
        const result = await tool(generator, 'generator', scratch, JSON.stringify({ schema: sdl, documents, config }));
        if (result.exitCode !== 0 || result.stderr) throw new Error(`Generator failed (exit ${result.exitCode}).`);
        let generated: Generated;
        try {
          const parsed: unknown = JSON.parse(result.stdout);
          assert.ok(parsed && typeof parsed === 'object' && !Array.isArray(parsed));
          assert.deepEqual(Object.keys(parsed).sort(), [...operations].sort());
          assert.ok(Object.values(parsed).every(value => typeof value === 'string' && value.trim().length > 0));
          generated = parsed as Generated;
        } catch { throw new Error('Generator returned missing or invalid operation types.'); }
        if (scenario === 'unchanged' && !futureProofEnums) { baseline = generated; baselineSchema = sdl; }
        if (scenario === 'add-optional-field') assert.deepEqual(generated, baseline, 'Unselected additive field changed operation types.');
        if (scenario === 'add-stock-enum-value' && !futureProofEnums) assert.equal(generated.CatalogOnly, baseline!.CatalogOnly, 'Unselected enum changed CatalogOnly.');
        const id = scenario + (futureProofEnums ? '-future-proof-enums' : '');
        const consumers = futureProofEnums ? ['exhaustive-status', 'fallback-status'] : [...names];
        await record(id, generated, consumers, config, true, sdl);
      }
      if (scenario === 'weaken-name-nullability' || scenario === 'add-stock-enum-value') {
        await record(`${scenario}-stale-types`, baseline!, [...names], generatorOptions, false, baselineSchema);
      }
      async function record(id: string, generated: Generated, selected: string[], config: typeof generatorOptions, regenerated: boolean, generatedFrom: string) {
        const folder = path.join(scratch, id);
        for (const [name, content] of Object.entries(generated)) write(`${id}/${name}.generated.ts`, content);
        const compiled: Record<string, Compilation> = {};
        for (const name of selected) {
          const source = inputs[`fixtures/consumers/${name}.ts`]!;
          write(`${id}/${name}.ts`, source);
          const tsconfig = `${name}.tsconfig.json`;
          write(`${id}/${tsconfig}`, `${JSON.stringify({ compilerOptions, files: [`${name}.ts`] }, null, 2)}\n`);
          const result = await tool({ ...compiler, args: [...compiler.args, '--project', tsconfig, '--pretty', 'false'] }, 'compiler', folder);
          assert.equal(result.stderr, '', `Compiler wrote unexpected stderr: ${id}/${name}`);
          const diagnostics = result.stdout.replaceAll('\r\n', '\n').replaceAll('\\', '/').trim();
          if (diagnostics.includes(scratch.replaceAll('\\', '/'))) throw new Error('Compiler produced unexpected absolute paths.');
          const codes = [...diagnostics.matchAll(/error TS(\d+):/g)].map(match => Number(match[1]));
          const nullError = regenerated && scenario === 'weaken-name-nullability' && name === 'strict-name';
          const enumError = regenerated && name === 'exhaustive-status' && (scenario === 'add-stock-enum-value' || config.futureProofEnums);
          const expected = nullError ? [18047] : enumError ? [2345] : [];
          assert.deepEqual(codes, expected, `Unexpected compiler diagnostics: ${id}/${name}`);
          if (!expected.length) assert.ok(result.exitCode === 0 && !diagnostics, `Compiler did not succeed: ${id}/${name}`);
          else {
            assert.ok(result.exitCode === 1 || result.exitCode === 2, `Compiler failed outside type checking: ${id}/${name}`);
            const value = config.futureProofEnums
              ? scenario === 'add-stock-enum-value' ? '"%future added value" | "PREORDER"' : '"%future added value"'
              : '"PREORDER"';
            const message = nullError ? "'product.name' is possibly 'null'."
              : `Argument of type '${value}' is not assignable to parameter of type 'never'.`;
            const continuation = enumError && config.futureProofEnums && scenario === 'add-stock-enum-value'
              ? '\n  Type \'"%future added value"\' is not assignable to type \'never\'.' : '';
            // Accept only the pinned compiler's complete diagnostic, not a matching
            // TS code followed by unrelated output from a failing tool.
            const header = new RegExp(`^${name}\\.ts\\(\\d+,\\d+\\): error TS${expected[0]}: `);
            assert.ok(header.test(diagnostics), `Wrong failure location: ${id}/${name}`);
            assert.equal(diagnostics.replace(header, ''), message + continuation, `Wrong failure reason or extra output: ${id}/${name}`);
          }
          write(`${id}/${name}.diagnostics.txt`, diagnostics ? `${diagnostics}\n` : '');
          compiled[name] = { exitCode: result.exitCode, diagnosticCodes: codes, diagnostics, consumerSha256: sha256(source) };
        }
        cases.push({ id, schema: impact.scenarios.find(item => item.id === scenario)!.compatibility.classification,
          generatorPolicy: config, regenerated, candidateSchemaSha256: sha256(sdl), generatedFromSchemaSha256: sha256(generatedFrom),
          operationValidation: { CatalogOnly: 'valid', CatalogCards: 'valid' },
          generatedSha256: Object.fromEntries(Object.entries(generated).map(([name, text]) => [name, sha256(text)])), consumers: compiled });
      }
    }
    verifyInputs();
    const report: ConsumerImpactReport = { version: 1, mode: 'generated-consumer-compilation',
      tooling: { node: process.version, packages, compilerOptions },
      inputs: inputPaths.map(name => ({ path: name, sha256: sha256(inputs[name]!) })), inputsUnchanged: true, cases,
      limits: [
        'Synthetic fixed consumers; no employer code or production results.',
        'Real composition, GraphQL validation, official Codegen and TypeScript compilation; no resolver or consumer runtime execution.',
        'Results depend on these consumers, generated types and explicit strict compiler settings. This is not a deployment gate.',
        'Stale-type controls deliberately compile baseline types against changed candidate schemas; their passing result does not cover the change.',
        'Fallback compilation does not establish product correctness. futureProofEnums adds a type entry, not a wire-value decoder.',
      ] };
    write('report.json', `${JSON.stringify(report, null, 2)}\n`);
    if (destination) {
      // A report.json is a completion marker, written after every artifact copy.
      mkdirSync(destination);
      cpSync(scratch, destination, { recursive: true, errorOnExist: true, force: false, filter: source => source !== path.join(scratch, 'report.json') });
      writeFileSync(path.join(destination, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    }
    return report;
  } finally {
    // scratch is the exact fresh directory made above; never user-supplied output.
    rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

export function formatConsumerImpact(report: ConsumerImpactReport): string {
  const lines = ['GENERATED CONSUMER IMPACT', 'Queries remain valid; compiler outcomes below use fixed consumer files.', ''];
  for (const item of report.cases) {
    lines.push(`${item.id}: ${item.regenerated ? 'regenerated types' : 'STALE baseline types'}`);
    for (const [name, result] of Object.entries(item.consumers)) lines.push(`  ${name}: ${result.diagnosticCodes.length ? result.diagnosticCodes.map(code => `TS${code}`).join(', ') : 'compiles'}`);
  }
  return `${lines.join('\n')}\n\nExpected type errors are observations, not a deployment approval. No runtime failure is established.\n`;
}
