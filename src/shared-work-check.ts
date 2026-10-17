import { isDeepStrictEqual } from 'node:util';
import type { ClientObservation, SharedEvent, SharedSnapshot } from './shared-work.ts';

export interface SharedEvidence {
  requests: readonly { requestId: string }[];
  clients: readonly { requestId: string; observation: ClientObservation }[];
  final: SharedSnapshot;
  executionError: string | null;
}

interface Caller {
  flight: number | null;
  left: SharedEvent['reason'] | null;
  rejected: boolean;
  abortRequested: boolean;
  result?: ClientObservation;
}
interface Flight {
  waiters: Set<string>;
  phase: 'joinable' | 'retiring' | 'settled';
  abortRequested: boolean;
  settlement?: 'completed' | 'cancelled';
  permit: boolean;
  cleaned: boolean;
}
interface AbortWithWaiters {
  sequence: number;
  flightId: number;
  waitingRequestIds: string[];
  cancelledHttpRequestIds: string[];
}
interface ForeignCleanup {
  sequence: number;
  cleaningFlightId: number;
  removedFlightId: number;
  waitingRequestIds: string[];
}
interface RedundantStart {
  sequence: number;
  newFlightId: number;
  unregisteredFlightId: number;
  cleanupSequence: number | null;
  successfulOriginalRequestIds: string[];
  successfulNewRequestIds: string[];
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}
function response(observation: ClientObservation | undefined) {
  if (observation?.outcome !== 'http') return undefined;
  const body = object(observation.body);
  const identity = object(object(body?.extensions)?.sharedWork);
  const data = object(body?.data);
  const errors = Array.isArray(body?.errors) ? body.errors : [];
  const cancelled = errors.some(error => object(object(error)?.extensions)?.code === 'WORK_CANCELLED');
  const success = errors.length === 0 && isDeepStrictEqual(data?.stock, {
    sku: 'demo-ceramic', quantity: 8, status: 'IN_STOCK',
  });
  return { identity, success, cancelled: cancelled && data?.stock === null };
}

/** Replay this one-key fixture's evidence; policy names and expected outcomes are not inputs to the verdict. */
export function checkSharedWorkCase(input: SharedEvidence) {
  const evidenceErrors: string[] = [];
  const check = (condition: boolean, message: string): boolean => {
    if (!condition) evidenceErrors.push(message);
    return condition;
  };
  const callers = new Map<string, Caller>();
  const flights = new Map<number, Flight>();
  const declared = new Set(input.requests.map(request => request.requestId));
  const abortsWithWaiters: AbortWithWaiters[] = [];
  const foreignCleanups: ForeignCleanup[] = [];
  const redundantStarts: RedundantStart[] = [];
  const retiringOverlaps: { sequence: number; retiringFlightId: number; newFlightId: number }[] = [];
  let registered: number | null = null;
  let peakActive = 0;
  let peakPermits = 0;
  const activeCount = () => [...flights.values()].filter(flight => flight.phase !== 'settled').length;
  const permitCount = () => [...flights.values()].filter(flight => flight.permit).length;
  const waiterCount = () => [...flights.values()].reduce((sum, flight) => sum + flight.waiters.size, 0);
  check(input.executionError === null, 'execution did not complete normally');
  check(input.final.capacity === 2, 'this fixture requires capacity 2');
  check(declared.size === input.requests.length && declared.size > 0, 'declared request identities must be unique and nonempty');

  input.final.events.forEach((event, index) => {
    const at = `event ${event.sequence} (${event.kind})`;
    check(event.sequence === index + 1, `${at}: sequence is not contiguous`);
    check(event.key === 'inventory:demo-ceramic', `${at}: unexpected fixed key`);
    const flight = event.flightId === null ? undefined : flights.get(event.flightId);
    const caller = event.requestId === null ? undefined : callers.get(event.requestId);
    const needsFlight = () => check(flight !== undefined, `${at}: unknown flight`);
    const needsCaller = () => check(caller !== undefined, `${at}: caller was not invoked`);
    const registryMutation = () => {
      check(event.previousFlightId === registered, `${at}: cleanup previous identity differs from replay`);
      check(typeof event.deleted === 'boolean', `${at}: cleanup deletion is missing`);
      check(!event.deleted || registered !== null, `${at}: cannot delete an empty registry`);
      if (event.deleted) registered = null;
    };

    switch (event.kind) {
      case 'client-invoked':
        if (check(event.requestId !== null && declared.has(event.requestId) && !caller,
          `${at}: invocation identity is undeclared or repeated`) && event.requestId !== null) {
          callers.set(event.requestId, { flight: null, left: null, rejected: false, abortRequested: false });
        }
        break;
      case 'client-abort-requested':
        if (needsCaller() && caller) {
          check(!caller.abortRequested && !caller.result, `${at}: abort request is repeated or follows its result`);
          caller.abortRequested = true;
        }
        break;
      case 'client-result':
        if (needsCaller() && caller) {
          check(caller.result === undefined && event.observation !== undefined, `${at}: result is missing or repeated`);
          if (event.observation) caller.result = event.observation;
        }
        break;
      case 'flight-started': {
        if (!check(event.flightId !== null && Number.isSafeInteger(event.flightId) && event.flightId > 0 && !flight,
          `${at}: flight identity is invalid or repeated`) || event.flightId === null) break;
        check(registered === null, `${at}: start replaced an existing registration`);
        for (const [id, existing] of flights) {
          if (existing.phase === 'retiring') retiringOverlaps.push({ sequence: event.sequence, retiringFlightId: id, newFlightId: event.flightId });
          if (existing.phase === 'joinable' && existing.waiters.size > 0) {
            redundantStarts.push({ sequence: event.sequence, newFlightId: event.flightId, unregisteredFlightId: id,
              cleanupSequence: foreignCleanups.findLast(cleanup => cleanup.removedFlightId === id)?.sequence ?? null,
              successfulOriginalRequestIds: [], successfulNewRequestIds: [] });
          }
        }
        flights.set(event.flightId, { waiters: new Set(), phase: 'joinable', abortRequested: false, permit: true, cleaned: false });
        registered = event.flightId;
        break;
      }
      case 'caller-joined':
        if (needsFlight() && needsCaller() && flight && caller && event.requestId !== null) {
          check(caller.flight === null && !caller.rejected && caller.left === null, `${at}: caller joined more than once`);
          check(registered === event.flightId && flight.phase === 'joinable', `${at}: caller joined unregistered or retired work`);
          caller.flight = event.flightId;
          flight.waiters.add(event.requestId);
        }
        break;
      case 'caller-rejected':
        if (needsCaller() && caller) {
          check(caller.flight === null && !caller.rejected, `${at}: rejection follows admission or another rejection`);
          check(event.reason === 'already-aborted' || event.reason === 'capacity-full', `${at}: unknown rejection reason`);
          if (event.reason === 'capacity-full') check(registered === null && permitCount() >= 2, `${at}: capacity rejection contradicts permits`);
          if (event.reason === 'already-aborted') check(caller.abortRequested, `${at}: rejection lacks client cancellation`);
          caller.rejected = true;
        }
        break;
      case 'caller-left':
        if (needsFlight() && needsCaller() && flight && caller && event.requestId !== null) {
          check(caller.flight === event.flightId && caller.left === null && flight.waiters.has(event.requestId), `${at}: caller left another flight or left twice`);
          check(['disconnected', 'completed', 'work-cancelled'].includes(event.reason ?? ''), `${at}: unknown caller departure`);
          if (event.reason === 'disconnected') check(caller.abortRequested, `${at}: server departure lacks client cancellation request`);
          else check(flight.settlement === (event.reason === 'completed' ? 'completed' : 'cancelled'), `${at}: caller departure contradicts settlement`);
          caller.left = event.reason ?? null;
          flight.waiters.delete(event.requestId);
        }
        break;
      case 'flight-retiring':
        if (needsFlight() && flight) {
          check(flight.phase === 'joinable' && flight.waiters.size === 0, `${at}: retirement requires last waiter departure`);
          flight.phase = 'retiring';
        }
        break;
      case 'registry-detached':
        if (needsFlight() && flight) {
          check(flight.phase === 'retiring', `${at}: detach precedes retirement`);
          check(event.deleted === (registered === event.flightId), `${at}: retirement detached a foreign registration`);
          registryMutation();
        }
        break;
      case 'abort-requested':
        if (needsFlight() && flight && event.flightId !== null) {
          check(!flight.abortRequested && flight.phase !== 'settled', `${at}: repeated or post-settlement abort`);
          check(event.reason === 'first-caller-left' || event.reason === 'no-waiters', `${at}: unknown abort reason`);
          if (event.reason === 'no-waiters') check(flight.waiters.size === 0 && flight.phase === 'retiring', `${at}: no-waiters abort has live waiters`);
          flight.abortRequested = true;
          if (flight.waiters.size > 0) abortsWithWaiters.push({ sequence: event.sequence, flightId: event.flightId,
            waitingRequestIds: [...flight.waiters], cancelledHttpRequestIds: [] });
        }
        break;
      case 'work-settled':
        if (needsFlight() && flight) {
          check(flight.phase !== 'settled' && flight.permit, `${at}: duplicate settlement or permit returned early`);
          check(event.settlement === (flight.abortRequested ? 'cancelled' : 'completed'), `${at}: terminal outcome contradicts abort observation`);
          flight.phase = 'settled';
          if (event.settlement) flight.settlement = event.settlement;
        }
        break;
      case 'permit-released':
        if (needsFlight() && flight) {
          check(flight.phase === 'settled' && flight.permit, `${at}: permit returned before settlement or returned twice`);
          flight.permit = false;
        }
        break;
      case 'registry-cleanup':
        if (needsFlight() && flight && event.flightId !== null) {
          check(flight.phase === 'settled' && !flight.permit && !flight.cleaned, `${at}: cleanup precedes settlement/release or repeats`);
          if (event.deleted && registered !== null && registered !== event.flightId) {
            foreignCleanups.push({ sequence: event.sequence, cleaningFlightId: event.flightId,
              removedFlightId: registered, waitingRequestIds: [...(flights.get(registered)?.waiters ?? [])] });
          }
          registryMutation();
          flight.cleaned = true;
        }
        break;
      default:
        check(false, `${at}: unknown event kind`);
    }

    const clientEvent = event.kind.startsWith('client-') || event.kind === 'caller-rejected';
    check(!clientEvent || event.flightId === null, `${at}: client result must not infer a flight identity`);
    check(event.registeredFlightId === registered, `${at}: registered identity differs from replay`);
    check(event.waiters === (event.flightId === null ? null : flights.get(event.flightId)?.waiters.size), `${at}: waiter snapshot differs from replay`);
    check(event.active === activeCount(), `${at}: active snapshot differs from physical settlement replay`);
    check(event.permits === permitCount(), `${at}: permit snapshot differs from acquisition/release replay`);
    check(permitCount() <= 2, `${at}: permit capacity exceeded`);
    peakActive = Math.max(peakActive, activeCount());
    peakPermits = Math.max(peakPermits, permitCount());
  });

  const observations = new Map<string, ClientObservation>();
  for (const client of input.clients) {
    check(declared.has(client.requestId) && !observations.has(client.requestId), `HTTP observation identity is undeclared or repeated: ${client.requestId}`);
    observations.set(client.requestId, client.observation);
  }
  for (const requestId of declared) {
    const caller = callers.get(requestId);
    const observation = observations.get(requestId);
    check(caller !== undefined && observation !== undefined && caller?.result !== undefined, `missing invocation or HTTP observation: ${requestId}`);
    if (!caller || !observation) continue;
    check(isDeepStrictEqual(caller.result, observation), `ledger differs from observed HTTP result: ${requestId}`);
    if (observation.outcome === 'aborted') {
      // A client can abandon response delivery after work has completed. Only the
      // server's departure/settlement events establish what happened to its work.
      check(caller.abortRequested, `aborted result lacks client cancellation request: ${requestId}`);
      continue;
    }
    if (observation.outcome !== 'http') {
      check(false, `unexpected transport failure: ${requestId}`);
      continue;
    }
    const parsed = response(observation);
    check(observation.status === 200, `unexpected HTTP status: ${requestId}`);
    check(caller.flight !== null && parsed?.identity?.requestId === requestId && parsed.identity.flightId === caller.flight,
      `HTTP request/flight identity differs from admission: ${requestId}`);
    check(parsed?.success === true || parsed?.cancelled === true, `unexpected GraphQL result: ${requestId}`);
    check(caller.left === (parsed?.success ? 'completed' : 'work-cancelled'), `HTTP result contradicts server completion: ${requestId}`);
  }
  const successes = (flightId: number) => [...callers].filter(([id, caller]) => caller.flight === flightId
    && response(observations.get(id))?.success).map(([id]) => id);
  for (const abort of abortsWithWaiters) {
    abort.cancelledHttpRequestIds = abort.waitingRequestIds.filter(id => response(observations.get(id))?.cancelled === true);
  }
  for (const start of redundantStarts) {
    start.successfulOriginalRequestIds = successes(start.unregisteredFlightId);
    start.successfulNewRequestIds = successes(start.newFlightId);
  }
  check(input.final.active === activeCount(), 'final active differs from replay');
  check(input.final.permits === permitCount(), 'final permits differ from replay');
  check(input.final.waiters === waiterCount(), 'final waiters differ from replay');
  check(input.final.registeredFlightId === registered, 'final registry differs from replay');
  check(input.final.started === flights.size, 'final start count differs from replay');
  const allDrained = activeCount() === 0 && permitCount() === 0 && waiterCount() === 0 && registered === null
    && [...flights.values()].every(flight => flight.cleaned)
    && declared.size === callers.size && declared.size === observations.size
    && [...callers.values()].every(caller => caller.result !== undefined
      && (caller.left !== null || caller.rejected || (caller.flight === null && caller.result.outcome === 'aborted')));
  check(allDrained, 'not all declared callers, physical work, permits and registry entries drained');
  return { evidenceValid: evidenceErrors.length === 0, evidenceErrors, allDrained,
    reconstructed: { started: flights.size, peakActive, peakPermits },
    abortsWithWaiters, foreignCleanups, redundantStarts, retiringOverlaps };
}
