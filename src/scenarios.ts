export const scenarios = ['healthy', 'inventory-error', 'inventory-timeout', 'missing-inventory'] as const;
export type Scenario = typeof scenarios[number];
export function parseScenario(value: unknown): Scenario {
  if (value === undefined || value === '') return 'healthy';
  if (typeof value === 'string' && scenarios.includes(value as Scenario)) return value as Scenario;
  throw new Error('Unknown lab scenario');
}
