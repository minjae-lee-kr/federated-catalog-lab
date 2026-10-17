import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { checkSharedWorkCase } from '../src/shared-work-check.ts';
import { runSharedCase, sharedCaseDefinitions } from '../src/shared-work-experiment.ts';
import type { SharedCase } from '../src/shared-work-experiment.ts';

const cases = new Map<string, SharedCase>();
before(async () => {
  // Every base trace comes from real loopback HTTP; mutations below touch copies.
  for (const definition of [...sharedCaseDefinitions,
    { id: 'no-departures', trace: 'none-leave', policy: 'first-caller' },
    { id: 'second-caller-departs', trace: 'joiner-leaves', policy: 'first-caller' },
  ] as const) cases.set(definition.id, await runSharedCase(definition));
}, { timeout: 45_000 });

function actual(id: string) {
  const item = cases.get(id);
  assert.ok(item, `Missing actual HTTP case ${id}`);
  return item;
}
function request(item: SharedCase, label: 'A' | 'B' | 'C' | 'D') {
  const entry = item.requests.find(value => value.label === label);
  assert.ok(entry);
  return entry.requestId;
}
function renumber(item: SharedCase) {
  item.final.events.forEach((event, index) => { event.sequence = index + 1; });
}

test('real traces distinguish evidence consistency from the two ownership defects', () => {
  for (const item of cases.values()) {
    const before = structuredClone(item);
    const result = checkSharedWorkCase(item);
    assert.deepEqual(result.evidenceErrors, [], item.id);
    assert.equal(result.evidenceValid, true);
    assert.equal(result.allDrained, true);
    assert.ok(result.reconstructed.peakActive <= 2 && result.reconstructed.peakPermits <= 2);
    assert.deepEqual(item, before, 'the pure checker must not mutate input evidence');
    assert.deepEqual(checkSharedWorkCase(item), result, 'replay must be deterministic');
  }

  const badOwner = actual('first-caller-ownership');
  const ownerResult = checkSharedWorkCase(badOwner);
  assert.equal(ownerResult.abortsWithWaiters.length, 1);
  assert.deepEqual(ownerResult.abortsWithWaiters[0]?.waitingRequestIds, [request(badOwner, 'B')]);
  assert.deepEqual(ownerResult.abortsWithWaiters[0]?.cancelledHttpRequestIds, [request(badOwner, 'B')]);
  assert.deepEqual(ownerResult.foreignCleanups, []);
  assert.deepEqual(ownerResult.redundantStarts, []);

  const badCleanup = actual('stale-cleanup');
  const cleanupResult = checkSharedWorkCase(badCleanup);
  assert.deepEqual(cleanupResult.abortsWithWaiters, []);
  assert.equal(cleanupResult.foreignCleanups.length, 1);
  assert.equal(cleanupResult.foreignCleanups[0]?.cleaningFlightId, 1);
  assert.equal(cleanupResult.foreignCleanups[0]?.removedFlightId, 2);
  assert.deepEqual(cleanupResult.foreignCleanups[0]?.waitingRequestIds, [request(badCleanup, 'C')]);
  assert.equal(cleanupResult.redundantStarts.length, 1);
  const extra = cleanupResult.redundantStarts[0]!;
  assert.equal(extra.newFlightId, 3);
  assert.equal(extra.unregisteredFlightId, 2);
  assert.equal(extra.cleanupSequence, cleanupResult.foreignCleanups[0]?.sequence);
  assert.deepEqual(extra.successfulOriginalRequestIds, [request(badCleanup, 'C')]);
  assert.deepEqual(extra.successfulNewRequestIds, [request(badCleanup, 'D')]);
  assert.equal(cleanupResult.reconstructed.started, 3);
});

test('correct ownership and valid retiring/new overlap do not become false positives', () => {
  for (const id of ['independent-waiters', 'identity-cleanup', 'no-departures', 'second-caller-departs']) {
    const item = actual(id);
    const result = checkSharedWorkCase(item);
    assert.deepEqual(result.abortsWithWaiters, [], id);
    assert.deepEqual(result.foreignCleanups, [], id);
    assert.deepEqual(result.redundantStarts, [], id);
  }
  for (const id of ['identity-cleanup', 'stale-cleanup']) {
    const result = checkSharedWorkCase(actual(id));
    assert.equal(result.retiringOverlaps.length, 1);
    assert.equal(result.retiringOverlaps[0]?.retiringFlightId, 1);
    assert.equal(result.retiringOverlaps[0]?.newFlightId, 2);
    assert.equal(result.reconstructed.peakActive, 2);
    assert.equal(result.reconstructed.peakPermits, 2);
  }
  assert.equal(checkSharedWorkCase(actual('identity-cleanup')).reconstructed.started, 2);
});

test('policy names and fixture labels cannot hide an observed defect', () => {
  const original = actual('stale-cleanup');
  const renamed = structuredClone(original);
  renamed.id = 'looks-correct';
  renamed.trace = 'none-leave';
  renamed.policy = 'owned-lifetimes';
  renamed.final.policy = 'owned-lifetimes';
  assert.deepEqual(checkSharedWorkCase(renamed), checkSharedWorkCase(original));
});

test('missing departure is rejected after sequence gaps are repaired', () => {
  const changed = structuredClone(actual('identity-cleanup'));
  const leaving = request(changed, 'B');
  changed.final.events = changed.final.events.filter(event => !(event.kind === 'caller-left' && event.requestId === leaving));
  renumber(changed);
  const result = checkSharedWorkCase(changed);
  assert.equal(result.evidenceValid, false);
  assert.ok(result.evidenceErrors.some(error => error.includes('waiter snapshot differs') || error.includes('last waiter departure')));
  assert.ok(result.evidenceErrors.every(error => !error.includes('sequence is not contiguous')));
});

test('same payload and a real flight ID cannot disguise a response belonging to another admission', () => {
  const changed = structuredClone(actual('stale-cleanup'));
  const late = request(changed, 'D');
  const observed = changed.clients.find(client => client.requestId === late)!;
  assert.equal(observed.observation.outcome, 'http');
  if (observed.observation.outcome !== 'http') assert.fail('D must have a real HTTP response');
  const body = observed.observation.body as { extensions: { sharedWork: { flightId: number } } };
  body.extensions.sharedWork.flightId = 2; // C's real, successful flight; D actually joined F3.
  const mismatch = checkSharedWorkCase(changed);
  assert.ok(mismatch.evidenceErrors.some(error => error.includes('ledger differs from observed HTTP result')));
  const ledgerResult = changed.final.events.find(event => event.kind === 'client-result' && event.requestId === late)!;
  ledgerResult.observation = structuredClone(observed.observation); // Defeat copy-equality-only checking too.
  const result = checkSharedWorkCase(changed);
  assert.equal(result.evidenceValid, false);
  assert.ok(result.evidenceErrors.some(error => error.includes('HTTP request/flight identity differs from admission')));
  assert.ok(result.evidenceErrors.every(error => !error.includes('ledger differs from observed')));
  assert.equal(result.allDrained, true, 'drained counters alone cannot establish response identity');
});

test('missing physical settlement cannot be hidden by a permit-release event and final zero counters', () => {
  const changed = structuredClone(actual('identity-cleanup'));
  changed.final.events = changed.final.events.filter(event => !(event.kind === 'work-settled' && event.flightId === 1));
  renumber(changed);
  const result = checkSharedWorkCase(changed);
  assert.equal(result.evidenceValid, false);
  assert.equal(result.allDrained, false);
  assert.ok(result.evidenceErrors.some(error => error.includes('permit returned before settlement')));
});

test('a client abort while awaiting delivery is not inferred to cancel already completed server work', () => {
  // A semantic control derived from actual evidence, not a claim this ordering
  // was generated by the harness: completion and network delivery are distinct.
  const changed = structuredClone(actual('no-departures'));
  const id = request(changed, 'A');
  const index = changed.final.events.findIndex(event => event.kind === 'client-result' && event.requestId === id);
  const resultEvent = changed.final.events[index]!;
  const { observation: ignoredObservation, ...metadata } = resultEvent;
  changed.final.events.splice(index, 0, { ...metadata, kind: 'client-abort-requested' });
  resultEvent.observation = { outcome: 'aborted' };
  changed.clients.find(client => client.requestId === id)!.observation = { outcome: 'aborted' };
  renumber(changed);
  const result = checkSharedWorkCase(changed);
  assert.deepEqual(result.evidenceErrors, []);
  assert.deepEqual(result.abortsWithWaiters, []);
  assert.equal(changed.final.events.find(event => event.kind === 'caller-left' && event.requestId === id)?.reason, 'completed');
});
