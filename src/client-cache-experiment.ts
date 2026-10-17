import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ApolloClient, HttpLink, InMemoryCache, gql } from '@apollo/client/core';
import { CombinedGraphQLErrors } from '@apollo/client/errors';
import type { ErrorPolicy, FetchPolicy } from '@apollo/client/core';
import { startLab } from './lab.ts';
import { loadOperations, schemaSources } from './schema.ts';
import { sourceEvidence } from './cancellation-evidence.ts';

export const clientCacheCases = ['all-cold', 'none-warm', 'all-warm', 'ignore-warm', 'all-no-cache'] as const;
export type ClientCacheCase = typeof clientCacheCases[number];
type Endpoint = 'healthy' | 'failure';
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
const json = (value: unknown): Json => JSON.parse(JSON.stringify(value)) as Json;
const querySource = loadOperations()['CatalogCards.graphql']!;
const query = gql(querySource);
const variables = { skus: ['demo-notebook', 'demo-lamp', 'demo-ceramic'] };
const typePolicies = { Product: { keyFields: ['sku'] }, Merchant: { keyFields: ['id'] } };

interface HttpRecord {
  sequence: number; endpoint: Endpoint; request: { method: string; bodyText: string };
  response: { status: number; bodyText: string; sha256: string } | null;
  transportError: { name: string; message: string } | null;
}
function describeError(error: unknown): Json {
  if (error === undefined || error === null) return null;
  if (CombinedGraphQLErrors.is(error)) return json({ name: error.name, message: error.message,
    errors: error.errors, dataPresent: error.data !== undefined, data: error.data ?? null });
  return { name: error instanceof Error ? error.name : 'UnknownError',
    message: error instanceof Error ? error.message : 'Non-Error rejection.' };
}
async function readBounded(response: Response): Promise<Buffer> {
  if (!response.body) throw new Error('Expected a JSON response body.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) return Buffer.concat(chunks);
      bytes += item.value.byteLength;
      if (bytes > 1_048_576) throw new Error('Fixed fixture response exceeded 1 MiB.');
      chunks.push(item.value);
    }
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  finally { reader.releaseLock(); }
}

async function runCase(id: ClientCacheCase, urls: Record<Endpoint, string>) {
  const warm = id.endsWith('-warm');
  const errorPolicy: ErrorPolicy = id === 'none-warm' ? 'none' : id === 'ignore-warm' ? 'ignore' : 'all';
  const cache = new InMemoryCache({ typePolicies });
  let endpoint: Endpoint = 'healthy';
  const http: HttpRecord[] = [];
  const observedFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    // Only the two servers created by this run are eligible. No URL/headers are
    // accepted from the command line, saved evidence or an external caller.
    if (url !== urls[endpoint] || new URL(url).hostname !== '127.0.0.1') throw new Error('Unexpected fixture endpoint.');
    if (init?.method !== 'POST' || typeof init.body !== 'string' || Buffer.byteLength(init.body) > 65_536) throw new Error('Expected a bounded GraphQL POST.');
    const record: HttpRecord = { sequence: http.length + 1, endpoint,
      request: { method: 'POST', bodyText: init.body }, response: null, transportError: null };
    http.push(record);
    try {
      const deadline = AbortSignal.timeout(5000);
      const response = await fetch(url, { ...init, redirect: 'error',
        signal: init.signal ? AbortSignal.any([init.signal, deadline]) : deadline });
      const bytes = await readBounded(response);
      const bodyText = bytes.toString('utf8');
      record.response = { status: response.status, bodyText, sha256: createHash('sha256').update(bytes).digest('hex') };
      // HttpLink receives the same UTF-8 JSON body that was observed. This records
      // application bytes; it is not a packet capture or independent server log.
      return new Response(bodyText, { status: response.status, headers: { 'content-type': response.headers.get('content-type') ?? '' } });
    } catch (error) {
      record.transportError = { name: error instanceof Error ? error.name : 'UnknownError', message: error instanceof Error ? error.message : 'Fetch failed.' };
      throw error;
    }
  };
  const client = new ApolloClient({ cache, link: new HttpLink({ uri: () => urls[endpoint], fetch: observedFetch }) });
  async function step(label: 'warm' | 'failed' | 'cache-first', target: Endpoint, fetchPolicy: FetchPolicy) {
    endpoint = target;
    const cacheBefore = json(cache.extract());
    const start = http.length;
    let result;
    try {
      const returned = await client.query({ query, variables, fetchPolicy, errorPolicy });
      result = { status: 'resolved', dataPresent: returned.data !== undefined, data: json(returned.data ?? null),
        error: describeError(returned.error) };
    } catch (error) {
      result = { status: 'rejected', dataPresent: false, data: null, error: describeError(error) };
    }
    return { label, endpoint: target, fetchPolicy, errorPolicy, result, cacheBefore, cacheAfter: json(cache.extract()),
      readAfter: json(cache.readQuery({ query, variables })), http: http.slice(start) };
  }
  try {
    const steps = [];
    if (warm) steps.push(await step('warm', 'healthy', 'network-only'));
    steps.push(await step('failed', 'failure', id === 'all-no-cache' ? 'no-cache' : 'network-only'));
    steps.push(await step('cache-first', 'failure', 'cache-first'));
    return { id, steps };
  } finally { client.stop(); }
}

export async function runClientCacheCases() {
  const labs: Awaited<ReturnType<typeof startLab>>[] = [];
  try {
    labs.push(await startLab({ subgraphTimeoutMs: 2000, fixture: { sources: schemaSources, captureResponses: true } }));
    labs.push(await startLab({ subgraphTimeoutMs: 2000, fixture: { sources: schemaSources, captureResponses: true,
      inventoryFailure: { mode: 'per-key', sku: 'demo-lamp' } } }));
    const cases = [];
    for (const id of clientCacheCases) cases.push(await runCase(id, { healthy: labs[0]!.url, failure: labs[1]!.url }));
    return { query: querySource, variables, cacheConfiguration: { typePolicies }, cases };
  } finally {
    const stopped = await Promise.allSettled(labs.map(lab => lab.stop()));
    const failures = stopped.filter(result => result.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Owned lab cleanup failed.');
  }
}

function installedVersions() {
  const require = createRequire(import.meta.url);
  return Object.fromEntries(['@apollo/client', 'rxjs', 'graphql', '@apollo/gateway', '@apollo/server', '@apollo/subgraph', 'dataloader'].map(name => {
    let directory = dirname(require.resolve(name));
    for (;;) {
      const file = join(directory, 'package.json');
      if (existsSync(file)) {
        const metadata = JSON.parse(readFileSync(file, 'utf8')) as { name?: string; version?: string };
        if (metadata.name === name && typeof metadata.version === 'string') return [name, metadata.version];
      }
      if (directory === dirname(directory)) throw new Error(`Could not inspect installed package version: ${name}`);
      directory = dirname(directory);
    }
  }));
}
export async function runClientCacheExperiment() {
  const sourceBefore = await sourceEvidence();
  const tooling = { node: process.version, platform: process.platform, arch: process.arch, packages: installedVersions() };
  const experiment = await runClientCacheCases();
  const sourceAfter = await sourceEvidence();
  return { version: 1, kind: 'client-cache-boundary', generatedAt: new Date().toISOString(), tooling,
    sourceBefore, sourceAfter,
    sourceUnchanged: sourceBefore.sha256 === sourceAfter.sha256 && JSON.stringify(sourceBefore.git) === JSON.stringify(sourceAfter.git),
    ...experiment,
    limits: [
      'ApolloClient.query only; no watchQuery, React rendering, persistence, retry, network-error policy or cross-tab behavior.',
      'Each case has a new client/cache. Warm steps use actual healthy HTTP; later steps retain that client/cache and switch HttpLink to the fixed failure server.',
      'Two gateways, each with three real HTTP subgraphs, share one Node process on loopback. Inputs and resolver faults are synthetic.',
      'A null field is a present cache value. A readable cached result does not mean fresh, valid inventory or a successful recent inventory lookup.',
      'cache.extract stores field values here, not a durable history of GraphQL errors. No expiry or business validity contract is implemented.',
      'Raw response bytes are observed inside the HttpLink fetch adapter; source consistency and fixture checks are not hostile-host execution attestation.',
    ] };
}
