import { formatConsumerImpact, runConsumerImpact } from './consumer-impact.ts';

const usage = `Usage: pnpm consumer-impact [--format text|json] [--report-dir NEW_DIRECTORY]

Real operation type generation and TypeScript compilation of fixed synthetic consumers.
Default: temporary files, removed after success or failure. A new --report-dir retains artifacts.
Exit 0 means expected outcomes were observed, including deliberate type errors.
Tool failure, timeout, unexpected diagnostics or changed input exits 1. Not a deployment gate.`;

const controller = new AbortController();
const abort = () => controller.abort();
process.once('SIGINT', abort);
process.once('SIGTERM', abort);
try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') console.log(usage);
  else {
    let format = 'text';
    let reportDir: string | undefined;
    const seen = new Set<string>();
    while (args.length) {
      const option = args.shift()!;
      if (!['--format', '--report-dir'].includes(option) || seen.has(option)) throw new Error(`Unknown or repeated option: ${option}`);
      seen.add(option);
      const value = args.shift();
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${option}`);
      if (option === '--format') {
        if (!['text', 'json'].includes(value)) throw new Error('--format must be text or json.');
        format = value;
      } else reportDir = value;
    }
    const report = await runConsumerImpact({ signal: controller.signal, ...(reportDir ? { reportDir } : {}) });
    process.stdout.write(format === 'json' ? `${JSON.stringify(report, null, 2)}\n` : formatConsumerImpact(report));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  process.removeListener('SIGINT', abort);
  process.removeListener('SIGTERM', abort);
}
