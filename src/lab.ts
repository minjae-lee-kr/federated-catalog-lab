import { randomUUID } from 'node:crypto';
import { ApolloServer } from '@apollo/server';
import { ApolloGateway, RemoteGraphQLDataSource } from '@apollo/gateway';
import { GraphQLError } from 'graphql';
import { composeGraph, serviceNames } from './schema.ts';
import type { ServiceName } from './schema.ts';
import { startSubgraph, disabledPlugins } from './subgraphs.ts';
import { parseScenario } from './scenarios.ts';
import type { Scenario } from './scenarios.ts';
import type { BatchRecord } from './loaders.ts';
import { startGraphQLHttp } from './http-server.ts';

export interface FetchTrace {
  service: string;
  durationMs: number;
  outcome: 'ok' | 'graphql-error' | 'transport-error';
  batches: BatchRecord[];
}
export interface GatewayContext { requestId: string; scenario: Scenario; fetches: FetchTrace[] }
type ProcessOptions = Parameters<RemoteGraphQLDataSource<GatewayContext>['process']>[0];

class ObservedDataSource extends RemoteGraphQLDataSource<GatewayContext> {
  service: ServiceName;
  constructor(service: ServiceName, url: string, timeoutMs: number) {
    super({ url });
    this.service = service;
    this.fetcher = async (input, init) => {
      try {
        const { body, ...request } = init ?? {};
        return await fetch(input, { ...request, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : body.toString('utf8') }), signal: AbortSignal.timeout(timeoutMs) });
      } catch (error) {
        const timedOut = error instanceof Error && error.name === 'TimeoutError';
        throw new GraphQLError(timedOut ? `${service} exceeded its response deadline.` : `${service} could not be reached.`, {
          extensions: { code: timedOut ? 'SUBGRAPH_TIMEOUT' : 'SUBGRAPH_UNAVAILABLE' },
        });
      }
    };
  }

  override async process(options: ProcessOptions) {
    const start = performance.now();
    const context = options.context as GatewayContext;
    try {
      const result = await super.process(options);
      context.fetches?.push({
        service: this.service,
        durationMs: Math.round((performance.now() - start) * 100) / 100,
        outcome: result.errors?.length ? 'graphql-error' : 'ok',
        batches: (result.extensions?.lab as { batches?: BatchRecord[] } | undefined)?.batches ?? [],
      });
      return result;
    } catch (error) {
      context.fetches?.push({ service: this.service, durationMs: Math.round((performance.now() - start) * 100) / 100, outcome: 'transport-error', batches: [] });
      throw error;
    }
  }

  override willSendRequest({ request, context }: ProcessOptions) {
    // Only the fault scenario travels between these local demo services. Never forward arbitrary client headers.
    if (this.service === 'inventory') request.http?.headers.set('x-lab-scenario', context.scenario ?? 'healthy');
  }
}

export interface LabOptions { port?: number; subgraphTimeoutMs?: number; slowInventoryMs?: number }

export async function startLab(options: LabOptions = {}) {
  const subgraphs: Awaited<ReturnType<typeof startSubgraph>>[] = [];
  let server: ApolloServer<GatewayContext> | undefined;
  try {
    // Roll back already-started servers if any later step fails.
    for (const name of serviceNames) subgraphs.push(await startSubgraph(name, 0, options.slowInventoryMs ?? 450));
    const urls = Object.fromEntries(subgraphs.map(service => [service.name, service.url])) as Record<ServiceName, string>;
    const composed = composeGraph(undefined, urls);
    // Gateway checks this flag synchronously in its constructor. Restore the caller's
    // environment immediately: no await or other task can interleave in this scope.
    const previousTelemetry = process.env.APOLLO_TELEMETRY_DISABLED;
    let gateway: ApolloGateway;
    process.env.APOLLO_TELEMETRY_DISABLED = 'true';
    try {
      gateway = new ApolloGateway({
        supergraphSdl: composed.supergraphSdl,
        buildService: ({ name, url }) => new ObservedDataSource(name as ServiceName, url!, options.subgraphTimeoutMs ?? 180),
      });
    } finally {
      if (previousTelemetry === undefined) delete process.env.APOLLO_TELEMETRY_DISABLED;
      else process.env.APOLLO_TELEMETRY_DISABLED = previousTelemetry;
    }
    server = new ApolloServer<GatewayContext>({
      gateway,
      includeStacktraceInErrorResponses: false,
      stopOnTerminationSignals: false,
      plugins: [...disabledPlugins(), {
        async requestDidStart() {
          return { async willSendResponse({ response, contextValue }) {
            if (response.body.kind === 'single') response.body.singleResult.extensions = {
              lab: { requestId: contextValue.requestId, scenario: contextValue.scenario, fetches: contextValue.fetches },
            };
          } };
        },
      }],
    });
    const running = await startGraphQLHttp(server,
      async req => {
        let scenario: Scenario;
        try { scenario = parseScenario(req.headers['x-lab-scenario']); }
        catch { throw new GraphQLError('Unknown lab scenario.', { extensions: { code: 'BAD_USER_INPUT', http: { status: 400 } } }); }
        return { requestId: randomUUID(), scenario, fetches: [] };
      }, options.port ?? 0);
    let stopPromise: Promise<void> | undefined;
    return {
      url: running.url,
      subgraphs: urls,
      apiSchema: composed.apiSchema,
      stop() {
        stopPromise ??= (async () => {
          await running.stop();
          await Promise.all(subgraphs.map(service => service.stop()));
        })();
        return stopPromise;
      },
    };
  } catch (error) {
    await server?.stop().catch(() => undefined);
    await Promise.all(subgraphs.map(service => service.stop()));
    throw error;
  }
}
