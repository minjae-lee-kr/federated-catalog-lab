import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { runConsumerImpact } from '../src/consumer-impact.ts';
import { runTool } from '../src/consumer-impact-process.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const node = (source: string) => ({ executable: process.execPath, args: ['--input-type=module', '-e', source, '--'] });
const fakeTypes = node('process.stdout.write(JSON.stringify({CatalogOnly:"export {};",CatalogCards:"export {};"}))');
const scratch = () => mkdtempSync(path.join(os.tmpdir(), 'consumer-proof-test-'));
const remove = (directory: string) => rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });

test('real generated types expose only the fixed consumers that depend on each changed guarantee', { timeout: 60_000 }, async () => {
  const parent = scratch();
  const reportDir = path.join(parent, 'evidence');
  const fixtures = readdirSync(path.join(root, 'fixtures/consumers')).map(name => path.join(root, 'fixtures/consumers', name));
  const before = fixtures.map(file => readFileSync(file));
  try {
    const report = await runConsumerImpact({ scratchParent: parent, reportDir });
    // A second run verifies the public JSON excludes incidental paths/timestamps.
    assert.deepEqual(await runConsumerImpact({ scratchParent: parent }), report);
    const cases = new Map(report.cases.map(item => [item.id, item]));
    for (const id of ['unchanged', 'add-optional-field']) {
      assert.ok(Object.values(cases.get(id)!.consumers).every(item => item.exitCode === 0));
    }
    const nullable = cases.get('weaken-name-nullability')!;
    assert.deepEqual(nullable.operationValidation, { CatalogOnly: 'valid', CatalogCards: 'valid' });
    assert.deepEqual(nullable.consumers['strict-name']!.diagnosticCodes, [18047]);
    assert.equal(nullable.consumers['nullable-name']!.exitCode, 0);
    assert.match(readFileSync(path.join(reportDir, nullable.id, 'CatalogOnly.generated.ts'), 'utf8'), /name: string \| null/);
    const expanded = cases.get('add-stock-enum-value')!;
    assert.deepEqual(expanded.consumers['exhaustive-status']!.diagnosticCodes, [2345]);
    assert.equal(expanded.consumers['fallback-status']!.exitCode, 0);
    assert.equal(expanded.generatedSha256.CatalogOnly, cases.get('unchanged')!.generatedSha256.CatalogOnly);
    for (const id of ['weaken-name-nullability-stale-types', 'add-stock-enum-value-stale-types']) {
      const stale = cases.get(id)!;
      assert.equal(stale.regenerated, false);
      assert.notEqual(stale.candidateSchemaSha256, stale.generatedFromSchemaSha256);
      assert.deepEqual(stale.generatedSha256, cases.get('unchanged')!.generatedSha256);
      assert.ok(Object.values(stale.consumers).every(item => item.exitCode === 0));
    }
    assert.match(cases.get('unchanged-future-proof-enums')!.consumers['exhaustive-status']!.diagnostics, /%future added value/);
    assert.equal(cases.get('unchanged-future-proof-enums')!.consumers['fallback-status']!.exitCode, 0);
    assert.ok(!JSON.stringify(report).includes(parent) && !JSON.stringify(report).includes(root));
    assert.deepEqual(fixtures.map(file => readFileSync(file)), before);
    assert.deepEqual(readdirSync(parent), ['evidence']);
    assert.deepEqual(JSON.parse(readFileSync(path.join(reportDir, 'report.json'), 'utf8')), report);
  } finally { remove(parent); }
});

test('missing/failed/malformed tools fail the experiment and leave no scratch or completed report', { timeout: 20_000 }, async () => {
  const parent = scratch();
  try {
    for (const failure of [
      { generator: { executable: path.join(parent, 'missing-generator'), args: [] } },
      { generator: node('process.exit(7)') },
      { generator: node('process.stdout.write("{}")') },
      { generator: fakeTypes, compiler: { executable: path.join(parent, 'missing-compiler'), args: [] } },
      { generator: fakeTypes, compiler: node('process.exit(9)') },
      { generator: fakeTypes, compiler: node('console.log("other.ts(1,1): error TS2345: unrelated"); process.exit(1)') },
    ]) {
      await assert.rejects(runConsumerImpact({ ...failure, scratchParent: parent, reportDir: path.join(parent, 'report') }));
      assert.deepEqual(readdirSync(parent), []);
    }
    for (const noise of ['stderr', 'stdout']) {
      const expectedDiagnostic = 'exhaustive-status.ts(14,33): error TS2345: Argument of type \'"%future added value"\' is not assignable to parameter of type \'never\'.';
      const compiler = node(`
        if (process.cwd().endsWith('unchanged-future-proof-enums') && process.argv.includes('exhaustive-status.tsconfig.json')) {
          console.log(${JSON.stringify(expectedDiagnostic)});
          process[${JSON.stringify(noise)}].write('INCOMPLETE_COMPILATION: compiler worker failed\\n');
          process.exitCode = 1;
        }
      `);
      await assert.rejects(runConsumerImpact({ generator: fakeTypes, compiler, scratchParent: parent,
        reportDir: path.join(parent, 'report') }), /unexpected stderr|extra output/);
      assert.deepEqual(readdirSync(parent), []);
    }
    writeFileSync(path.join(parent, 'keep.txt'), 'previous evidence');
    await assert.rejects(runConsumerImpact({ reportDir: parent }), /must be new/);
    assert.equal(readFileSync(path.join(parent, 'keep.txt'), 'utf8'), 'previous evidence');
  } finally { remove(parent); }
});

test('tool lifetime and output are bounded, and cancellation waits for the owned child to exit', { timeout: 15_000 }, async () => {
  const parent = scratch();
  try {
    await assert.rejects(runTool(node('setInterval(() => {}, 1000)'), { label: 'test', cwd: parent, timeoutMs: 100 }), /timed out/);
    await assert.rejects(runTool(node('console.log("x".repeat(10000))'), { label: 'test', cwd: parent, timeoutMs: 5000, maxOutputBytes: 100 }), /output limit/);
    const pidFile = path.join(parent, 'pid');
    const controller = new AbortController();
    const pending = runTool(node(`import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`),
      { label: 'test', cwd: parent, timeoutMs: 5000, signal: controller.signal });
    // Attach the rejection handler before triggering cancellation.
    const rejected = assert.rejects(pending, /aborted/);
    for (let attempt = 0; !existsSync(pidFile) && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(existsSync(pidFile));
    const pid = Number(readFileSync(pidFile, 'utf8'));
    controller.abort();
    await rejected;
    assert.throws(() => process.kill(pid, 0), /ESRCH/);
  } finally { remove(parent); }
});

test('CLI rejects unknown/repeated/missing options before starting the experiment', () => {
  const cli = fileURLToPath(new URL('../src/consumer-impact-cli.ts', import.meta.url));
  for (const args of [['--format', 'xml'], ['--format', 'json', '--format', 'text'], ['--report-dir'], ['--write-baseline']]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.ok(result.stderr.length > 0);
  }
});
