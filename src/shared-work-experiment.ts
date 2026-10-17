import { ApolloServer } from '@apollo/server';
import { GraphQLError, parse } from 'graphql';
import { startGraphQLHttp } from './http-server.ts';
import { disabledPlugins } from './subgraphs.ts';
import { quantities } from './data.ts';
import { sourceEvidence } from './cancellation-evidence.ts';
import { SettlementGates, SharedWork } from './shared-work.ts';
import type { ClientObservation, SharedPolicy, SharedSnapshot } from './shared-work.ts';

export type SharedTrace = 'owner-leaves' | 'replacement' | 'none-leave' | 'joiner-leaves';
export interface SharedCase {
  id: string;
  trace: SharedTrace;
  policy: SharedPolicy;
  requests: { label: 'A' | 'B' | 'C' | 'D'; requestId: string }[];
  clients: { requestId: string; observation: ClientObservation }[];
  final: SharedSnapshot;
  executionError: string | null;
}
export const sharedCaseDefinitions = [
  { id: 'first-caller-ownership', trace: 'owner-leaves', policy: 'first-caller' },
  { id: 'independent-waiters', trace: 'owner-leaves', policy: 'owned-lifetimes' },
  { id: 'stale-cleanup', trace: 'replacement', policy: 'unconditional-cleanup' },
  { id: 'identity-cleanup', trace: 'replacement', policy: 'owned-lifetimes' },
] as const;
const ids = {
  A: '00000000-0000-4000-8000-000000000001',
  B: '00000000-0000-4000-8000-000000000002',
  C: '00000000-0000-4000-8000-000000000003',
  D: '00000000-0000-4000-8000-000000000004',
} as const;

interface FixtureContext { requestId: string; signal: AbortSignal; flightId: number | null }
async function startSharedHttp(work: SharedWork) {
  // Deliberately a fixed GraphQL fixture, not the Federation gateway or its loaders.
  // Keep the existing real HTTP close→AbortSignal integration and invented product.
  const server = new ApolloServer<FixtureContext>({
    typeDefs: parse('type Stock { sku: ID!, quantity: Int!, status: String! } type Query { stock: Stock }'),
    resolvers: { Query: { stock: async (_: unknown, __: unknown, context: FixtureContext) => {
      const handle = work.join({ requestId: context.requestId, signal: context.signal });
      context.flightId = handle.flightId;
      await handle.result;
      return { sku: 'demo-ceramic', quantity: quantities['demo-ceramic'], status: 'IN_STOCK' };
    } } },
    includeStacktraceInErrorResponses: false, stopOnTerminationSignals: false,
    plugins: [...disabledPlugins(), { async requestDidStart() {
      return { async willSendResponse({ response, contextValue }) {
        if (response.body.kind === 'single') response.body.singleResult.extensions = {
          sharedWork: { requestId: contextValue.requestId, flightId: contextValue.flightId },
        };
      } };
    } }],
  });
  return startGraphQLHttp(server, async (request, lifetime) => {
    const requestId = request.headers['x-lab-request-id'];
    if (typeof requestId !== 'string' || !Object.values(ids).includes(requestId as typeof ids[keyof typeof ids])) {
      throw new GraphQLError('This fixed fixture requires an A–D request identity.');
    }
    return { requestId, signal: lifetime.signal, flightId: null };
  });
}

/** Real loopback HTTP, controlled terminal-stage barriers; timeouts only fail the run. */
export async function runSharedCase(definition: { id: string; trace: SharedTrace; policy: SharedPolicy }): Promise<SharedCase> {
  const gates = new SettlementGates();
  const work = new SharedWork(definition.policy, gates);
  const requests: SharedCase['requests'] = [];
  const observations: SharedCase['clients'] = [];
  const clients = new Map<keyof typeof ids, { controller: AbortController; finished: boolean; result: Promise<void> }>();
  const running = await startSharedHttp(work);
  let executionError: string | null = null;
  function start(label: keyof typeof ids) {
    if (clients.has(label)) throw new Error('The harness cannot invoke a caller twice.');
    const requestId = ids[label];
    requests.push({ label, requestId });
    work.observeClient('client-invoked', requestId);
    const controller = new AbortController();
    const client = { controller, finished: false, result: Promise.resolve() };
    client.result = (async () => {
      let observation: ClientObservation;
      try {
        const response = await fetch(running.url, {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-lab-request-id': requestId },
          body: JSON.stringify({ query: 'query SharedStock { stock { sku quantity status } }' }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5_000)]),
        });
        const text = await response.text();
        if (text.length > 32_768) throw new Error('Fixture response exceeds its bound.');
        observation = { outcome: 'http', status: response.status, body: JSON.parse(text) as unknown };
      } catch (error) {
        const errorName = error instanceof Error ? error.name : 'UnknownError';
        observation = controller.signal.aborted && errorName === 'AbortError'
          ? { outcome: 'aborted' } : { outcome: 'transport-error', errorName };
      }
      client.finished = true;
      observations.push({ requestId, observation: structuredClone(observation) });
      work.observeClient('client-result', requestId, observation);
    })();
    clients.set(label, client);
  }
  async function joined(label: keyof typeof ids) {
    const event = await work.until(e => e.kind === 'caller-joined' && e.requestId === ids[label], `${label} joined`);
    if (event.flightId === null) throw new Error('Join lacks its flight handle.');
    return event.flightId;
  }
  function abort(label: keyof typeof ids) {
    const client = clients.get(label);
    if (!client) throw new Error('Cannot abort a caller that was not invoked.');
    if (!client.finished && !client.controller.signal.aborted) {
      work.observeClient('client-abort-requested', ids[label]);
      client.controller.abort();
    }
  }
  async function departed(label: keyof typeof ids) {
    await work.until(e => e.kind === 'caller-left' && e.requestId === ids[label] && e.reason === 'disconnected', `${label} server-observed departure`);
  }
  async function settle(flightId: number) {
    gates.release(flightId);
    await work.until(e => e.kind === 'registry-cleanup' && e.flightId === flightId, `F${flightId} cleanup`);
  }
  try {
    start('A'); const first = await joined('A');
    start('B'); const second = await joined('B');
    if (first !== second) throw new Error('The two HTTP callers did not share their initial flight.');
    if (definition.trace === 'replacement') {
      abort('A'); await departed('A');
      abort('B'); await departed('B');
      await work.until(e => e.kind === 'registry-detached' && e.flightId === first, 'old flight detached');
      await work.until(e => e.kind === 'abort-requested' && e.flightId === first, 'old cancellation requested');
      start('C'); const replacement = await joined('C');
      if (replacement === first) throw new Error('Retiring work incorrectly accepted the replacement caller.');
      // F1 remains physically active and holds its permit until this release.
      await settle(first);
      start('D'); const late = await joined('D');
      // Settle newest first to keep the trace focused on the old F1 cleanup.
      for (const flight of [...new Set([replacement, late])].sort((a, b) => b - a)) await settle(flight);
    } else {
      if (definition.trace !== 'none-leave') {
        const leaving = definition.trace === 'joiner-leaves' ? 'B' : 'A';
        abort(leaving); await departed(leaving);
      }
      await settle(first);
    }
    await Promise.all([...clients.values()].map(client => client.result));
    await work.whenIdle();
  } catch (error) {
    executionError = error instanceof Error ? error.message : 'Unexpected fixture failure.';
  } finally {
    for (const label of clients.keys()) abort(label);
    gates.releaseAll();
    await Promise.all([...clients.values()].map(client => client.result));
    await work.whenIdle();
    await running.stop();
  }
  return { ...definition, requests, clients: observations, final: work.snapshot(), executionError };
}

export async function runSharedExperiment() {
  const before = await sourceEvidence();
  const cases: SharedCase[] = [];
  for (const definition of sharedCaseDefinitions) cases.push(await runSharedCase(definition));
  const after = await sourceEvidence();
  return {
    version: 1, generatedAt: new Date().toISOString(),
    runtime: { node: process.version, platform: process.platform, arch: process.arch, undici: process.versions.undici },
    source: before, sourceAfter: after, sourceUnchanged: before.sha256 === after.sha256,
    fixture: { key: 'inventory:demo-ceramic', capacity: 2, deadlineUpperBoundMs: 5_000,
      transport: 'fixed GraphQL fixture over existing loopback HTTP adapter', work: 'synthetic terminal-stage gates' },
    cases,
    limits: [
      'Separate HTTP requests share one synthetic job behind a fixed GraphQL fixture. The Federation gateway, per-request DataLoaders and existing four-policy experiment are unchanged.',
      'Client abort and server-observed departure are distinct events. Replacement starts only after the recorded departure/detachment barrier.',
      'Gates select an allowed asynchronous ordering; they do not measure database cancellation, production latency, throughput or costs.',
      'The synthetic task checks its controller at the released terminal gate. An abort request alone does not physically settle it; this is not a measurement of cancellation latency.',
      'These traces observe server departure before releasing work. In general a client may abort after work completes but before the response arrives; a client abort alone does not prove server-side cancellation.',
      'Retiring work keeps capacity until actual settlement; it may overlap a new joinable flight. Capacity is local to one process.',
      'In the replacement trace A/B are cancelled; C/D receive normal stock data. Their response flight identities can differ under the incorrect cleanup policy.',
      'No cache, TTL, cross-replica deduplication, unknown-job discovery, tenant boundary or exactly-once guarantee is implemented.',
      'Recorded transitions and source hashes are inspection aids, not proofs of uninstrumented work or execution attestations.',
    ],
  };
}
