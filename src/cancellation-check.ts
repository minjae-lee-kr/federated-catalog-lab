import type { WorkSnapshot } from './cancellation-work.ts';

/** Reconstruct from raw events rather than trusting the work observer's totals. */
export function checkWork(snapshot: WorkSnapshot) {
  const violations: string[] = [];
  const earlyReleases: number[] = [];
  const jobs = new Map<number, { active: boolean; held: boolean; requestId: string }>();
  let active = 0; let permits = 0; let maxActive = 0; let maxPermits = 0;
  let started = 0; let completed = 0; let cancelled = 0; let rejected = 0; let previousMs = 0;
  for (const [index, event] of snapshot.events.entries()) {
    if (event.sequence !== index + 1 || !Number.isFinite(event.elapsedMs) || event.elapsedMs < previousMs) violations.push(`invalid event order at ${index + 1}`);
    previousMs = event.elapsedMs;
    if (!event.requestId) violations.push(`missing request identity at ${event.sequence}`);
    const job = event.jobId === null ? undefined : jobs.get(event.jobId);
    switch (event.kind) {
      case 'admitted':
        if (event.jobId === null || !Number.isSafeInteger(event.jobId) || event.jobId <= 0 || job) violations.push(`invalid admission at ${event.sequence}`);
        else jobs.set(event.jobId, { active: true, held: true, requestId: event.requestId });
        active++; permits++; started++; break;
      case 'completed': case 'cancelled':
        if (!job?.active) violations.push(`work settled without an active job at ${event.sequence}`);
        else job.active = false;
        active--; if (event.kind === 'completed') completed++; else cancelled++;
        break;
      case 'permit-released':
        if (!job?.held) violations.push(`permit released without ownership at ${event.sequence}`);
        else { job.held = false; if (job.active) earlyReleases.push(event.jobId!); }
        permits--; break;
      case 'cancel-requested':
        if (!job?.active) violations.push(`cancellation observed without active work at ${event.sequence}`);
        break;
      case 'rejected': rejected++; if (event.jobId !== null) violations.push('rejected work acquired a job'); break;
      case 'caller-completed': if (event.jobId !== null) violations.push('caller completion changed job identity'); break;
      default: violations.push(`unknown event kind at ${event.sequence}`);
    }
    if (job && job.requestId !== event.requestId) violations.push(`job changed request identity at ${event.sequence}`);
    if (event.active !== active || event.permits !== permits || active < 0 || permits < 0) violations.push(`counter mismatch at ${event.sequence}`);
    maxActive = Math.max(maxActive, active); maxPermits = Math.max(maxPermits, permits);
  }
  const reconstructed = { active, permits, maxActive, maxPermits, started, completed, cancelled, rejected };
  for (const [key, value] of Object.entries(reconstructed)) if (snapshot[key as keyof typeof reconstructed] !== value) violations.push(`summary mismatch: ${key}`);
  if (started !== active + completed + cancelled) violations.push('work accounting is not conserved');
  return {
    bookkeepingValid: violations.length === 0, violations, reconstructed,
    permitLifetimeValid: earlyReleases.length === 0, earlyReleases,
    physicalBoundSatisfied: snapshot.capacity === null ? null : maxActive <= snapshot.capacity,
    permitCounterBoundSatisfied: snapshot.capacity === null ? null : maxPermits <= snapshot.capacity,
    drained: active === 0 && permits === 0,
  };
}
