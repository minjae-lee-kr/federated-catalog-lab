import { evolutionScenarios } from './evolution-scenarios.ts';
import type { EvolutionScenarioId } from './evolution-scenarios.ts';
import { createImpactReport, formatImpactText } from './schema-impact.ts';

const usage = `Usage: pnpm impact [--scenario NAME] [--format text|json]

In-memory hypothetical schema changes. No server startup, writes or baseline updates.
Scenarios: ${evolutionScenarios.map(scenario => scenario.id).join(', ')}

Exit 0 means the experiment completed, including intentionally breaking scenarios.
Use pnpm contracts for the actual checked-in API compatibility gate.`;

try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') console.log(usage);
  else {
    let format: 'text' | 'json' = 'text';
    let scenario: EvolutionScenarioId | undefined;
    const seen = new Set<string>();
    while (args.length) {
      const option = args.shift()!;
      if (!['--scenario', '--format'].includes(option) || seen.has(option)) throw new Error(`Unknown or repeated option: ${option}`);
      seen.add(option);
      const value = args.shift();
      if (option === '--format') {
        if (value !== 'text' && value !== 'json') throw new Error('--format must be text or json.');
        format = value;
      } else {
        if (!evolutionScenarios.some(candidate => candidate.id === value)) throw new Error(`Unknown scenario: ${value ?? '(missing)'}`);
        scenario = value as EvolutionScenarioId;
      }
    }
    const report = createImpactReport(scenario ? { scenarios: [scenario] } : {});
    process.stdout.write(format === 'json' ? `${JSON.stringify(report, null, 2)}\n` : formatImpactText(report));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
