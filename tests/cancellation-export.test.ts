import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { before, test } from 'node:test';
import { createCancellationExport } from '../src/cancellation-export.ts';
import { runCancellationExperiment } from '../src/cancellation-experiment.ts';
import { startCancellationUi } from '../src/cancellation-ui-server.ts';

let fixture: Awaited<ReturnType<typeof runCancellationExperiment>>;
before(async () => {
  fixture = await runCancellationExperiment();
  assert.equal(fixture.passed, true);
  // Export validation fixtures only; never written as deliverable evidence.
  // This permits testing both Git states while developing on a dirty checkout.
  fixture.source.git = { head: 'a'.repeat(40), branch: 'test-fixture-only', dirty: false };
});

test('static export resolves every local link, omits transport, and retains byte-identical raw data', async () => {
  const files = await createCancellationExport(fixture);
  assert.deepEqual(Object.keys(files).sort(), ['debt.css', 'debt.js', 'export.json', 'index.html', 'report-data.js', 'report.json']);
  for (const match of files['index.html']!.matchAll(/(?:href|src)="([^"]+)"/g)) {
    assert.ok(match[1]!.startsWith('./'), match[1]);
    assert.ok(Object.hasOwn(files, match[1]!.slice(2)), `Missing local asset: ${match[1]}`);
  }
  assert.doesNotMatch(files['index.html']!, /id="run"|debt-live\.js|type="module"/);
  assert.match(files['index.html']!, /data-report-mode="recorded"/);
  assert.match(files['index.html']!, /connect-src 'none'/);
  assert.match(files['index.html']!, /class="table-wrap" tabindex="0" role="region"/);
  assert.match(files['index.html']!, /aria-describedby="table-hint"/);
  assert.doesNotMatch(files['debt.js']!, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/);
  assert.equal(/(?<![a-z])[a-z]:[\\/]|file:\/\/|\/(?:Users|home)\//i.test(Object.values(files).join('\n')), false, 'No absolute local path in export');
  assert.equal(files['report.json'], `${JSON.stringify(fixture, null, 2)}\n`);
  const context: { CANCELLATION_DEBT_REPORT?: unknown } = {};
  runInNewContext(files['report-data.js']!, context, { timeout: 1_000 });
  assert.deepEqual(JSON.parse(JSON.stringify(context.CANCELLATION_DEBT_REPORT)), JSON.parse(files['report.json']!));
  const manifest = JSON.parse(files['export.json']!) as { generatedAt: string; revision: unknown; files: { path: string; sha256: string }[] };
  assert.equal(manifest.generatedAt, fixture.generatedAt);
  assert.deepEqual(manifest.revision, fixture.source.git);
  for (const entry of manifest.files) assert.equal(entry.sha256, createHash('sha256').update(files[entry.path]!).digest('hex'));
});

test('export fails closed on dirty, drifted, unsuccessful or decorrelated captures', async () => {
  for (const mutate of [
    (value: typeof fixture) => { value.source.git!.dirty = true; },
    (value: typeof fixture) => { value.sourceUnchanged = false; },
    (value: typeof fixture) => { value.passed = false; },
    (value: typeof fixture) => { value.cases[0]!.final.events.find(event => event.kind === 'caller-completed')!.requestId = 'unrelated'; },
    (value: typeof fixture) => { value.source.manifest[0]!.path = 'C:/Users/private/source.ts'; },
    (value: typeof fixture) => { value.limits.push('Local file: C:\\Users\\private\\source.ts'); },
  ]) {
    const changed = structuredClone(fixture); mutate(changed);
    await assert.rejects(createCancellationExport(changed));
  }
});

test('frozen data script escapes HTML delimiters while preserving exact JSON strings', async () => {
  const changed = structuredClone(fixture);
  changed.limits.push('</script><script>throw new Error("not executable")</script>\u2028');
  const files = await createCancellationExport(changed);
  assert.doesNotMatch(files['report-data.js']!, /<\/script>/);
  const context: { CANCELLATION_DEBT_REPORT?: unknown } = {};
  runInNewContext(files['report-data.js']!, context, { timeout: 1_000 });
  assert.deepEqual(JSON.parse(JSON.stringify(context.CANCELLATION_DEBT_REPORT)), changed);
});

test('live transport remains a separate same-origin asset, absent from the static export', async () => {
  const ui = await startCancellationUi();
  try {
    const page = await fetch(ui.url).then(response => response.text());
    assert.match(page, /src="\/debt-live\.js"/);
    const response = await fetch(`${ui.url}debt-live.js`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /fetch\('\/experiment'/);
  } finally { await ui.stop(); }
});
