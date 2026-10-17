import { isDeepStrictEqual } from 'node:util';
import { checkSharedWorkCase } from './shared-work-check.ts';
import type { SharedCase } from './shared-work-experiment.ts';

/** Fixed experiment expectations are separate from the policy-independent replay. */
export function assessSharedCase(item: SharedCase) {
  const analysis = checkSharedWorkCase(item);
  const checks: { name: string; passed: boolean }[] = [];
  const add = (name: string, passed: boolean) => checks.push({ name, passed });
  const id = (label: 'A' | 'B' | 'C' | 'D') => item.requests.find(r => r.label === label)?.requestId;
  const client = (label: 'A' | 'B' | 'C' | 'D') => item.clients.find(c => c.requestId === id(label))?.observation;
  const join = (label: 'A' | 'B' | 'C' | 'D') => item.final.events.find(e => e.kind === 'caller-joined' && e.requestId === id(label));
  const left = (label: 'A' | 'B' | 'C' | 'D') => item.final.events.find(e => e.kind === 'caller-left' && e.requestId === id(label));
  const normal = (label: 'A' | 'B' | 'C' | 'D') => {
    const observation = client(label);
    if (observation?.outcome !== 'http' || observation.status !== 200) return false;
    const body = observation.body as { data?: { stock?: unknown }; errors?: unknown } | null;
    return body !== null && body.errors === undefined && isDeepStrictEqual(body.data?.stock,
      { sku: 'demo-ceramic', quantity: 8, status: 'IN_STOCK' });
  };
  add('policy-independent-evidence-and-complete-drain', analysis.evidenceValid && analysis.allDrained);
  add('A-and-B-share-the-initial-flight', join('A') !== undefined && join('A')?.flightId === join('B')?.flightId);
  add('A-abort-has-separate-server-departure', client('A')?.outcome === 'aborted' && left('A')?.reason === 'disconnected');
  const initial = join('A')?.flightId;
  const settled = item.final.events.find(e => e.kind === 'work-settled' && e.flightId === initial);
  add('departure-barrier-precedes-terminal-release', left('A') !== undefined && settled !== undefined && join('B') !== undefined
    && left('A')!.sequence < settled.sequence && join('B')!.sequence < left('A')!.sequence);
  let role: 'expected-counterexample' | 'control' | 'unsupported' = 'unsupported';
  if (item.id === 'first-caller-ownership' || item.id === 'independent-waiters') {
    const incorrect = item.id === 'first-caller-ownership';
    role = incorrect ? 'expected-counterexample' : 'control';
    add('declared-two-caller-owner-trace', item.trace === 'owner-leaves' && isDeepStrictEqual(item.requests.map(r => r.label), ['A', 'B']));
    add('one-physical-flight', analysis.reconstructed.started === 1 && analysis.reconstructed.peakActive === 1);
    add('no-foreign-cleanup', analysis.foreignCleanups.length === 0 && analysis.redundantStarts.length === 0);
    add('surviving-B-outcome', incorrect
      ? analysis.abortsWithWaiters.length === 1 && analysis.abortsWithWaiters[0]!.waitingRequestIds.includes(id('B')!)
        && analysis.abortsWithWaiters[0]!.cancelledHttpRequestIds.includes(id('B')!) && left('B')?.reason === 'work-cancelled'
      : analysis.abortsWithWaiters.length === 0 && normal('B') && left('B')?.reason === 'completed');
  } else if (item.id === 'stale-cleanup' || item.id === 'identity-cleanup') {
    const incorrect = item.id === 'stale-cleanup';
    role = incorrect ? 'expected-counterexample' : 'control';
    const replacement = join('C')?.flightId;
    const late = join('D')?.flightId;
    const cleanup = item.final.events.find(e => e.kind === 'registry-cleanup' && e.flightId === initial);
    const start = item.final.events.find(e => e.kind === 'flight-started' && e.flightId === replacement);
    add('declared-four-caller-replacement-trace', item.trace === 'replacement' && isDeepStrictEqual(item.requests.map(r => r.label), ['A', 'B', 'C', 'D']));
    add('A-and-B-aborted-C-and-D-received-normal-data', client('B')?.outcome === 'aborted'
      && left('B')?.reason === 'disconnected' && normal('C') && normal('D'));
    add('retiring-old-work-overlaps-new-flight-with-permits-held', analysis.retiringOverlaps.some(e => e.retiringFlightId === initial && e.newFlightId === replacement)
      && start?.active === 2 && start.permits === 2 && left('B') !== undefined && left('B')!.sequence < start.sequence
      && settled !== undefined && start.sequence < settled.sequence);
    add('old-cleanup-observed-before-late-D', cleanup !== undefined && join('D') !== undefined
      && cleanup.previousFlightId === replacement && cleanup.sequence < join('D')!.sequence);
    add('bounded-capacity-is-not-deduplication', analysis.reconstructed.peakActive === 2 && analysis.reconstructed.peakPermits === 2
      && analysis.abortsWithWaiters.length === 0);
    add('late-request-decision-and-physical-execution-count', incorrect
      ? replacement !== undefined && late !== undefined && late !== replacement && analysis.reconstructed.started === 3
        && analysis.foreignCleanups.length === 1 && analysis.redundantStarts.length === 1
        && analysis.redundantStarts[0]!.cleanupSequence === cleanup?.sequence
        && analysis.redundantStarts[0]!.successfulOriginalRequestIds.includes(id('C')!)
        && analysis.redundantStarts[0]!.successfulNewRequestIds.includes(id('D')!)
      : replacement !== undefined && late === replacement && analysis.reconstructed.started === 2
        && analysis.foreignCleanups.length === 0 && analysis.redundantStarts.length === 0 && cleanup?.deleted === false);
  } else add('supported-fixed-case', false);
  return { role, expectedObservationEstablished: checks.every(c => c.passed), checks, analysis };
}
