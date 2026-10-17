import assert from 'node:assert/strict';
import test from 'node:test';
import { runSharedCase, sharedCaseDefinitions } from '../src/shared-work-experiment.ts';
import type { SharedCase } from '../src/shared-work-experiment.ts';
import { SettlementGates, SharedWork } from '../src/shared-work.ts';
import type { ClientObservation, SharedEvent } from '../src/shared-work.ts';
import { assessSharedCase } from '../src/shared-work-assessment.ts';

function response(item: SharedCase, label: 'A' | 'B' | 'C' | 'D') {
  const id = item.requests.find(r => r.label === label)?.requestId;
  assert.ok(id);
  const result = item.clients.find(c => c.requestId === id)?.observation;
  assert.ok(result);
  return result;
}
function stock(observation: ClientObservation) {
  assert.equal(observation.outcome, 'http');
  if (observation.outcome !== 'http') assert.fail('Expected an observed HTTP response.');
  assert.equal(observation.status, 200);
  const body = observation.body as { data: { stock: unknown }; errors?: unknown; extensions: { sharedWork: { requestId: string; flightId: number } } };
  assert.equal(body.errors, undefined);
  assert.deepEqual(body.data.stock, { sku: 'demo-ceramic', quantity: 8, status: 'IN_STOCK' });
  return body.extensions.sharedWork;
}
function event(item: SharedCase, kind: SharedEvent['kind'], flightId: number, requestId?: string) {
  const found = item.final.events.find(e => e.kind === kind && e.flightId === flightId && (requestId === undefined || e.requestId === requestId));
  assert.ok(found, `Missing ${kind}/F${flightId}`);
  return found;
}
function drained(item: SharedCase) {
  assert.equal(item.executionError, null);
  assert.equal(item.final.active, 0); assert.equal(item.final.permits, 0);
  assert.equal(item.final.waiters, 0); assert.equal(item.final.registeredFlightId, null);
  assert.ok(item.final.events.every(e => e.active <= 2 && e.permits <= 2));
}

test('two real HTTP traces distinguish cancellation ownership from stale registry cleanup', { timeout: 20_000 }, async () => {
  const cases = [];
  for (const definition of sharedCaseDefinitions) cases.push(await runSharedCase(definition));
  for (const item of cases) {
    drained(item);
    const assessment = assessSharedCase(item);
    assert.equal(assessment.expectedObservationEstablished, true, JSON.stringify(assessment.checks));
    assert.equal(assessment.analysis.evidenceValid, true);
  }
  const [wrongOwner, owned, wrongCleanup, identity] = cases as [SharedCase, SharedCase, SharedCase, SharedCase];
  assert.deepEqual(response(wrongOwner, 'A'), { outcome: 'aborted' });
  const survivor = response(wrongOwner, 'B');
  assert.equal(survivor.outcome, 'http');
  if (survivor.outcome !== 'http') assert.fail('Remaining waiter must observe the work error over HTTP.');
  assert.equal(survivor.status, 200);
  const failed = survivor.body as { errors: { extensions: { code: string } }[]; data: { stock: unknown }; extensions: { sharedWork: { flightId: number } } };
  assert.equal(failed.data.stock, null);
  assert.deepEqual(failed.errors.map(e => e.extensions.code), ['WORK_CANCELLED']);
  assert.equal(failed.extensions.sharedWork.flightId, 1);
  assert.equal(event(wrongOwner, 'abort-requested', 1).waiters, 1);
  assert.equal(stock(response(owned, 'B')).flightId, 1);
  assert.equal(owned.final.events.some(e => e.kind === 'abort-requested'), false);
  for (const item of [wrongCleanup, identity]) {
    assert.deepEqual(response(item, 'A'), { outcome: 'aborted' });
    assert.deepEqual(response(item, 'B'), { outcome: 'aborted' });
    const c = stock(response(item, 'C')); const d = stock(response(item, 'D'));
    assert.equal(c.requestId, item.requests.find(r => r.label === 'C')?.requestId);
    assert.equal(d.requestId, item.requests.find(r => r.label === 'D')?.requestId);
    const secondStart = event(item, 'flight-started', 2);
    assert.equal(secondStart.active, 2); assert.equal(secondStart.permits, 2);
    const oldCleanup = event(item, 'registry-cleanup', 1);
    assert.equal(oldCleanup.previousFlightId, 2);
    assert.ok(event(item, 'registry-detached', 1).sequence < secondStart.sequence);
    assert.ok(secondStart.sequence < event(item, 'work-settled', 1).sequence);
    assert.ok(event(item, 'work-settled', 1).sequence < event(item, 'permit-released', 1).sequence);
    assert.ok(oldCleanup.sequence < event(item, 'caller-joined', d.flightId, d.requestId).sequence);
  }
  assert.equal(wrongCleanup.final.started, 3);
  assert.equal(event(wrongCleanup, 'registry-cleanup', 1).deleted, true);
  assert.notEqual(stock(response(wrongCleanup, 'C')).flightId, stock(response(wrongCleanup, 'D')).flightId);
  assert.equal(identity.final.started, 2);
  assert.equal(event(identity, 'registry-cleanup', 1).deleted, false);
  assert.equal(stock(response(identity, 'C')).flightId, stock(response(identity, 'D')).flightId);
});

test('a sparse interrupted run stays unestablished instead of producing a success summary', () => {
  const partial: SharedCase = { id: 'identity-cleanup', trace: 'replacement', policy: 'owned-lifetimes',
    requests: [], clients: [], executionError: 'Missing event barrier: A joined',
    final: { policy: 'owned-lifetimes', capacity: 2, active: 0, permits: 0, registeredFlightId: null, waiters: 0, started: 0, events: [] } };
  const result = assessSharedCase(partial);
  assert.equal(result.expectedObservationEstablished, false);
  assert.equal(result.analysis.evidenceValid, false);
});

test('HTTP positive controls share one flight without cancellation and keep the first caller when the joiner leaves', { timeout: 10_000 }, async () => {
  const healthy = await runSharedCase({ id: 'healthy-control', trace: 'none-leave', policy: 'owned-lifetimes' });
  drained(healthy);
  assert.equal(stock(response(healthy, 'A')).flightId, stock(response(healthy, 'B')).flightId);
  assert.equal(healthy.final.started, 1);
  const joiner = await runSharedCase({ id: 'joiner-leaves-control', trace: 'joiner-leaves', policy: 'owned-lifetimes' });
  drained(joiner);
  assert.deepEqual(response(joiner, 'B'), { outcome: 'aborted' });
  assert.equal(stock(response(joiner, 'A')).flightId, 1);
  assert.equal(joiner.final.events.some(e => e.kind === 'abort-requested'), false);
});

test('detaching two abandoned flights does not free capacity before their settlement', async () => {
  const gates = new SettlementGates(); const work = new SharedWork('owned-lifetimes', gates);
  const results: Promise<unknown>[] = [];
  const controllers = [new AbortController(), new AbortController()];
  try {
    for (const [index, controller] of controllers.entries()) {
      const id = `00000000-0000-4000-8000-00000000000${index + 1}`;
      const handle = work.join({ requestId: id, signal: controller.signal });
      results.push(handle.result.catch(error => error));
      controller.abort();
    }
    const held = work.snapshot();
    assert.equal(held.registeredFlightId, null); assert.equal(held.waiters, 0);
    assert.equal(held.active, 2); assert.equal(held.permits, 2);
    assert.throws(() => work.join({ requestId: '00000000-0000-4000-8000-000000000003', signal: new AbortController().signal }), /not admitted/);
    gates.release(1);
    await work.until(e => e.kind === 'permit-released' && e.flightId === 1, 'first capacity returned');
    const replacement = work.join({ requestId: '00000000-0000-4000-8000-000000000004', signal: new AbortController().signal });
    results.push(replacement.result);
    assert.equal(replacement.flightId, 3); assert.equal(work.snapshot().permits, 2);
  } finally { gates.releaseAll(); await Promise.all(results); await work.whenIdle(); }
  assert.equal(work.snapshot().active, 0); assert.equal(work.snapshot().permits, 0);
});

test('abort and terminal release cannot remove the same waiter twice', async () => {
  for (const abortFirst of [true, false]) {
    const gates = new SettlementGates(); const work = new SharedWork('owned-lifetimes', gates);
    const controller = new AbortController();
    const handle = work.join({ requestId: '00000000-0000-4000-8000-000000000001', signal: controller.signal });
    const result = handle.result.catch(error => error);
    if (abortFirst) controller.abort();
    gates.release(handle.flightId);
    await work.whenIdle();
    if (!abortFirst) controller.abort();
    await result;
    assert.equal(work.snapshot().events.filter(e => e.kind === 'caller-left').length, 1);
    assert.equal(work.snapshot().waiters, 0);
    assert.ok(work.snapshot().events.every(e => e.waiters === null || e.waiters >= 0));
  }
});
