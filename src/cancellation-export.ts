import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkWork } from './cancellation-check.ts';
import { projectRoot } from './cancellation-evidence.ts';
import { experimentFixture } from './cancellation-experiment.ts';
import type { runCancellationExperiment } from './cancellation-experiment.ts';
import { workModes } from './cancellation-work.ts';

type Report = Awaited<ReturnType<typeof runCancellationExperiment>>;
const hash = (text: string) => createHash('sha256').update(text).digest('hex');

function replaceOnce(text: string, before: string, after: string): string {
  if (text.split(before).length !== 2) throw new Error('Static export template changed. Review the transformation before exporting.');
  return text.replace(before, after);
}

/** A capture produced by this lab, not a general-purpose importer for untrusted reports. */
export async function createCancellationExport(report: Report): Promise<Record<string, string>> {
  if (!report.passed || !report.sourceUnchanged || !report.source.git || report.source.git.dirty
    || !/^[a-f0-9]{40,64}$/.test(report.source.git.head) || !/^[a-f0-9]{64}$/.test(report.source.sha256)
    || !Number.isFinite(Date.parse(report.generatedAt))) throw new Error('Export requires a successful, unchanged capture from a clean Git revision.');
  if (JSON.stringify(report.fixture) !== JSON.stringify(experimentFixture)
    || JSON.stringify(report.cases.map(item => item.mode)) !== JSON.stringify(workModes)) throw new Error('Export does not match the fixed experiment.');
  for (const item of report.cases) {
    const ids = item.responses.map(response => (response.body as { extensions?: { lab?: { requestId?: string } } })?.extensions?.lab?.requestId);
    if (!item.passed || item.checks.some(check => !check.passed) || ids.length !== experimentFixture.attempts || ids.some(id => typeof id !== 'string')
      || !checkWork(item.final, ids as string[]).bookkeepingValid) throw new Error('Export requires complete, correlated raw observations.');
  }
  for (const entry of report.source.manifest) {
    if (!entry.path || entry.path.startsWith('/') || entry.path.includes('\\') || entry.path.split('/').includes('..') || /^[a-z]:/i.test(entry.path)) {
      throw new Error('Source manifest must contain relative public paths only.');
    }
  }
  const reportJson = `${JSON.stringify(report, null, 2)}\n`;
  // Fail closed on accidental local path disclosure; do not silently redact raw evidence.
  if (/(?<![a-z])[a-z]:[\\/]|(?:file|vscode):\/\/|\/(?:Users|home)\//i.test(reportJson)) throw new Error('The capture contains an absolute local path.');
  const [template, css, view] = await Promise.all(['debt.html', 'debt.css', 'debt.js'].map(name => readFile(join(projectRoot, 'public', name), 'utf8')));
  let html = replaceOnce(template!, '<html lang="en">', '<html lang="en" data-report-mode="recorded">');
  html = replaceOnce(html, '<title>Cancellation debt</title>', '<meta http-equiv="Content-Security-Policy" content="connect-src \'none\'; base-uri \'none\'; form-action \'none\'"><title>Cancellation debt — saved run</title>');
  html = replaceOnce(html, 'href="/debt.css"', 'href="./debt.css"');
  html = replaceOnce(html, '<script defer src="/debt.js"></script><script defer src="/debt-live.js"></script>', '<script defer src="./report-data.js"></script><script defer src="./debt.js"></script>');
  html = replaceOnce(html, 'href="/" class="brand"', 'href="./index.html" class="brand"');
  html = replaceOnce(html, '<button id="run" class="primary" type="button" data-i18n="run"></button>', '');
  const files: Record<string, string> = {
    'index.html': html,
    'debt.css': css!,
    'debt.js': view!,
    // Classic external scripts also work when opening index.html directly from disk.
    'report-data.js': `globalThis.CANCELLATION_DEBT_REPORT = ${JSON.stringify(report).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029')};\n`,
    'report.json': reportJson,
  };
  files['export.json'] = `${JSON.stringify({
    kind: 'prerecorded-read-only-cancellation-debt', version: 1, generatedAt: report.generatedAt,
    revision: report.source.git, sourceSha256: report.source.sha256, sourceUnchanged: report.sourceUnchanged,
    report: { path: 'report.json', sha256: hash(reportJson) },
    files: Object.entries(files).map(([path, contents]) => ({ path, sha256: hash(contents) })),
    limits: ['Opening this export does not execute the experiment.', 'Source and asset hashes are reproduction aids, not execution attestations.', ...report.limits],
  }, null, 2)}\n`;
  return files;
}
