import { setTimeout as delay } from 'node:timers/promises';
import { GraphQLError } from 'graphql';

export const workModes = ['timeout-only', 'early-release', 'admission-only', 'cooperative'] as const;
export type WorkMode = typeof workModes[number];
export type EventKind = 'admitted' | 'rejected' | 'cancel-requested' | 'completed' | 'cancelled' | 'permit-released' | 'caller-completed';
export interface WorkEvent {
  sequence: number; elapsedMs: number; kind: EventKind; requestId: string; jobId: number | null;
  active: number; permits: number; reason?: string;
}
export interface WorkSnapshot {
  mode: WorkMode; capacity: number | null; workMs: number; active: number; permits: number;
  maxActive: number; maxPermits: number; started: number; completed: number; cancelled: number; rejected: number;
  events: WorkEvent[];
}

/** Synthetic work holds a slot for a timer. The surrounding transport is real HTTP. */
export class InventoryWork {
  readonly mode: WorkMode;
  readonly capacity: number | null;
  readonly workMs: number;
  private readonly began = performance.now();
  private active = 0;
  private permits = 0;
  private maxActive = 0;
  private maxPermits = 0;
  private started = 0;
  private completed = 0;
  private cancelled = 0;
  private rejected = 0;
  private events: WorkEvent[] = [];
  private idle: (() => void)[] = [];

  constructor(mode: WorkMode, workMs = 1_000, capacity = 2) {
    if (!workModes.includes(mode) || !Number.isSafeInteger(workMs) || workMs < 1 || workMs > 10_000
      || !Number.isSafeInteger(capacity) || capacity < 1 || capacity > 16) throw new Error('Invalid synthetic work configuration.');
    this.mode = mode; this.workMs = workMs; this.capacity = mode === 'timeout-only' ? null : capacity;
  }

  private record(kind: EventKind, requestId: string, jobId: number | null, reason?: string): void {
    this.events.push({ sequence: this.events.length + 1, elapsedMs: Math.round((performance.now() - this.began) * 100) / 100,
      kind, requestId, jobId, active: this.active, permits: this.permits, ...(reason === undefined ? {} : { reason }) });
  }

  callerCompleted(requestId: string): void { this.record('caller-completed', requestId, null); }

  async run(request: { requestId: string; signal: AbortSignal; deadlineAt?: number }): Promise<void> {
    const { requestId } = request;
    const deadline = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (this.mode === 'cooperative' && request.deadlineAt !== undefined) {
      const remaining = request.deadlineAt - Date.now();
      if (remaining <= 0) deadline.abort(new Error('deadline'));
      else timer = setTimeout(() => deadline.abort(new Error('deadline')), remaining);
    }
    const signal = AbortSignal.any([request.signal, deadline.signal]);
    if (signal.aborted || (this.capacity !== null && this.permits >= this.capacity)) {
      clearTimeout(timer); this.rejected++;
      const reason = signal.aborted ? 'already-aborted' : 'admission-full';
      this.record('rejected', requestId, null, reason);
      throw new GraphQLError('Synthetic inventory work was not admitted.', { extensions: { code: signal.aborted ? 'WORK_CANCELLED' : 'INVENTORY_BUSY' } });
    }
    const jobId = ++this.started;
    this.active++; this.permits++;
    this.maxActive = Math.max(this.maxActive, this.active); this.maxPermits = Math.max(this.maxPermits, this.permits);
    this.record('admitted', requestId, jobId);
    let held = true;
    const release = (reason: string) => {
      if (!held) return;
      held = false; this.permits--; this.record('permit-released', requestId, jobId, reason);
    };
    const cancelRequested = () => {
      this.record('cancel-requested', requestId, jobId, deadline.signal.aborted ? 'deadline' : 'peer-disconnected');
      // Deliberately incorrect control: a waiter ending does not settle the work.
      // Its permit count looks bounded while physical active jobs can exceed it.
      if (this.mode === 'early-release') release('incorrect-caller-lifetime');
    };
    signal.addEventListener('abort', cancelRequested, { once: true });
    try {
      if (this.mode === 'cooperative') await delay(this.workMs, undefined, { signal });
      else await delay(this.workMs); // Intentionally signal-ignoring synthetic dependency.
      this.active--; this.completed++; this.record('completed', requestId, jobId);
    } catch (error) {
      this.active--;
      if (!(error instanceof Error) || error.name !== 'AbortError' || !signal.aborted) throw error;
      this.cancelled++; this.record('cancelled', requestId, jobId);
      throw new GraphQLError('Synthetic inventory work cooperatively stopped.', { extensions: { code: 'WORK_CANCELLED' } });
    } finally {
      signal.removeEventListener('abort', cancelRequested); clearTimeout(timer);
      release('underlying-work-settled');
      if (this.active === 0) { for (const resolve of this.idle) resolve(); this.idle = []; }
    }
  }

  whenIdle(): Promise<void> { return this.active === 0 ? Promise.resolve() : new Promise(resolve => this.idle.push(resolve)); }
  snapshot(): WorkSnapshot {
    return { mode: this.mode, capacity: this.capacity, workMs: this.workMs, active: this.active, permits: this.permits,
      maxActive: this.maxActive, maxPermits: this.maxPermits, started: this.started, completed: this.completed,
      cancelled: this.cancelled, rejected: this.rejected, events: this.events.map(event => ({ ...event })) };
  }
}
