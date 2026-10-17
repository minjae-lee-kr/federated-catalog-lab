import { GraphQLError } from 'graphql';

export const sharedKey = 'inventory:demo-ceramic';
export const sharedPolicies = {
  'first-caller': { cancellation: 'first-caller', cleanup: 'identity' },
  'unconditional-cleanup': { cancellation: 'last-waiter', cleanup: 'unconditional' },
  'owned-lifetimes': { cancellation: 'last-waiter', cleanup: 'identity' },
} as const;
export type SharedPolicy = keyof typeof sharedPolicies;
export type SharedEventKind = 'client-invoked' | 'client-abort-requested' | 'client-result'
  | 'flight-started' | 'caller-joined' | 'caller-left' | 'caller-rejected'
  | 'flight-retiring' | 'registry-detached' | 'abort-requested'
  | 'work-settled' | 'permit-released' | 'registry-cleanup';
export type ClientObservation = { outcome: 'http'; status: number; body: unknown }
  | { outcome: 'aborted' } | { outcome: 'transport-error'; errorName: string };
export interface SharedEvent {
  sequence: number;
  kind: SharedEventKind;
  key: typeof sharedKey;
  requestId: string | null;
  flightId: number | null;
  registeredFlightId: number | null;
  waiters: number | null;
  active: number;
  permits: number;
  reason?: 'disconnected' | 'completed' | 'work-cancelled' | 'first-caller-left'
    | 'no-waiters' | 'already-aborted' | 'capacity-full';
  settlement?: 'completed' | 'cancelled';
  previousFlightId?: number | null;
  deleted?: boolean;
  observation?: ClientObservation;
}
export interface SharedSnapshot {
  policy: SharedPolicy;
  capacity: 2;
  active: number;
  permits: number;
  registeredFlightId: number | null;
  waiters: number;
  started: number;
  events: SharedEvent[];
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}

/** Synthetic terminal-work barriers, never an HTTP control API or a clock schedule. */
export class SettlementGates {
  private readonly gates = new Map<number, ReturnType<typeof deferred<void>>>();
  private draining = false;
  wait(flightId: number): Promise<void> {
    if (this.gates.has(flightId)) throw new Error('Duplicate synthetic work start.');
    const gate = deferred<void>();
    this.gates.set(flightId, gate);
    if (this.draining) gate.resolve();
    return gate.promise;
  }
  release(flightId: number): void {
    const gate = this.gates.get(flightId);
    if (!gate) throw new Error('Cannot release work that has not started.');
    gate.resolve();
  }
  releaseAll(): void {
    this.draining = true;
    for (const gate of this.gates.values()) gate.resolve();
  }
}

interface Flight {
  id: number;
  owner: string;
  controller: AbortController;
  phase: 'joinable' | 'retiring' | 'settled';
  callers: Set<string>;
  completion: ReturnType<typeof deferred<'completed' | 'cancelled'>>;
}

/** One key, no result cache. Registry membership is separate from physical settlement. */
export class SharedWork {
  private registry: Flight | undefined;
  private readonly flights = new Map<number, Flight>();
  private readonly seenCallers = new Set<string>();
  private readonly tasks: Promise<void>[] = [];
  private active = 0;
  private permits = 0;
  private readonly events: SharedEvent[] = [];
  private readonly observers = new Set<(event: SharedEvent) => void>();
  readonly capacity = 2;
  readonly policy: SharedPolicy;
  private readonly gates: SettlementGates;

  constructor(policy: SharedPolicy, gates: SettlementGates) {
    if (!Object.hasOwn(sharedPolicies, policy)) throw new Error('Unknown shared-work policy.');
    this.policy = policy; this.gates = gates;
  }

  private emit(kind: SharedEventKind, flight: Flight | undefined, requestId: string | null = null,
    detail: Pick<SharedEvent, 'reason' | 'settlement' | 'previousFlightId' | 'deleted' | 'observation'> = {}): void {
    const event: SharedEvent = { sequence: this.events.length + 1, kind, key: sharedKey, requestId,
      flightId: flight?.id ?? null, registeredFlightId: this.registry?.id ?? null,
      waiters: flight?.callers.size ?? null, active: this.active, permits: this.permits, ...detail };
    this.events.push(event);
    for (const observe of this.observers) observe(structuredClone(event));
  }

  observeClient(kind: 'client-invoked' | 'client-abort-requested' | 'client-result', requestId: string,
    observation?: ClientObservation): void {
    // A client result has no inferred flight ID: its actual HTTP body carries the
    // join-bound handle. The checker must correlate that body with server events.
    this.emit(kind, undefined, requestId, observation ? { observation: structuredClone(observation) } : {});
  }

  until(predicate: (event: SharedEvent) => boolean, description: string, timeoutMs = 5_000): Promise<SharedEvent> {
    const existing = this.events.find(predicate);
    if (existing) return Promise.resolve(structuredClone(existing));
    return new Promise((resolve, reject) => {
      const observe = (event: SharedEvent) => {
        if (!predicate(event)) return;
        clearTimeout(timer); this.observers.delete(observe); resolve(event);
      };
      const timer = setTimeout(() => {
        this.observers.delete(observe); reject(new Error(`Missing event barrier: ${description}`));
      }, timeoutMs);
      this.observers.add(observe);
    });
  }

  join(request: { requestId: string; signal: AbortSignal }): { flightId: number; result: Promise<void> } {
    const { requestId, signal } = request;
    if (!/^[a-f0-9-]{36}$/.test(requestId) || this.seenCallers.has(requestId)) throw new Error('A caller identity must be unique in this fixture.');
    this.seenCallers.add(requestId);
    if (signal.aborted || (!this.registry && this.permits >= this.capacity)) {
      this.emit('caller-rejected', undefined, requestId, { reason: signal.aborted ? 'already-aborted' : 'capacity-full' });
      throw new GraphQLError('Shared synthetic work was not admitted.', { extensions: { code: signal.aborted ? 'CALLER_LEFT' : 'INVENTORY_BUSY' } });
    }
    let flight = this.registry;
    if (!flight) {
      flight = { id: this.flights.size + 1, owner: requestId, controller: new AbortController(), phase: 'joinable',
        callers: new Set(), completion: deferred() };
      this.flights.set(flight.id, flight); this.registry = flight;
      this.active++; this.permits++;
      this.emit('flight-started', flight);
      this.tasks.push(this.execute(flight));
    }
    if (flight.phase !== 'joinable') throw new Error('Only joinable work can remain registered.');
    const joined = flight;
    joined.callers.add(requestId);
    this.emit('caller-joined', joined, requestId);
    const result = new Promise<void>((resolve, reject) => {
      let finished = false;
      const leave = (reason: 'disconnected' | 'completed' | 'work-cancelled') => {
        if (finished) return false;
        finished = true;
        signal.removeEventListener('abort', onAbort);
        joined.callers.delete(requestId);
        this.emit('caller-left', joined, requestId, { reason });
        return true;
      };
      const onAbort = () => {
        if (!leave('disconnected')) return;
        if (joined.callers.size === 0 && joined.phase === 'joinable') {
          joined.phase = 'retiring'; this.emit('flight-retiring', joined);
          const previousFlightId = this.registry?.id ?? null;
          const deleted = this.registry === joined;
          if (deleted) this.registry = undefined;
          this.emit('registry-detached', joined, null, { previousFlightId, deleted });
          this.abort(joined, 'no-waiters');
        } else if (sharedPolicies[this.policy].cancellation === 'first-caller' && joined.owner === requestId) {
          // Deliberately wrong ownership: the first caller can end another caller's work.
          this.abort(joined, 'first-caller-left');
        }
        reject(new GraphQLError('This HTTP caller left.', { extensions: { code: 'CALLER_LEFT' } }));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      joined.completion.promise.then(outcome => {
        if (!leave(outcome === 'completed' ? 'completed' : 'work-cancelled')) return;
        if (outcome === 'completed') resolve();
        else reject(new GraphQLError('Shared synthetic work was cancelled.', { extensions: { code: 'WORK_CANCELLED' } }));
      });
    });
    return { flightId: joined.id, result };
  }

  private abort(flight: Flight, reason: 'first-caller-left' | 'no-waiters'): void {
    if (flight.controller.signal.aborted || flight.phase === 'settled') return;
    flight.controller.abort(); this.emit('abort-requested', flight, null, { reason });
  }

  private async execute(flight: Flight): Promise<void> {
    // Cancellation requests may arrive before the synthetic terminal stage is
    // released. This models an allowed async ordering, not database cancellation.
    await this.gates.wait(flight.id);
    const settlement = flight.controller.signal.aborted ? 'cancelled' : 'completed';
    flight.phase = 'settled'; this.active--;
    this.emit('work-settled', flight, null, { settlement });
    this.permits--; this.emit('permit-released', flight);
    const previousFlightId = this.registry?.id ?? null;
    const deleted = this.registry !== undefined && (sharedPolicies[this.policy].cleanup === 'unconditional' || this.registry === flight);
    // There is no await between checking identity and deleting the registration.
    if (deleted) this.registry = undefined;
    this.emit('registry-cleanup', flight, null, { previousFlightId, deleted });
    flight.completion.resolve(settlement);
  }

  async whenIdle(): Promise<void> { await Promise.all(this.tasks); }
  snapshot(): SharedSnapshot {
    return { policy: this.policy, capacity: 2, active: this.active, permits: this.permits,
      registeredFlightId: this.registry?.id ?? null, waiters: [...this.flights.values()].reduce((n, f) => n + f.callers.size, 0),
      started: this.flights.size, events: structuredClone(this.events) };
  }
}
