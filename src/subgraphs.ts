import { ApolloServer } from '@apollo/server';
import { ApolloServerPluginInlineTraceDisabled, ApolloServerPluginLandingPageDisabled, ApolloServerPluginSchemaReportingDisabled, ApolloServerPluginUsageReportingDisabled } from '@apollo/server/plugin/disabled';
import { buildSubgraphSchema } from '@apollo/subgraph';
import { GraphQLError, parse } from 'graphql';
import { schemaSources } from './schema.ts';
import type { ServiceName } from './schema.ts';
import { createContext } from './loaders.ts';
import type { SubgraphContext } from './loaders.ts';
import type { ProductRecord } from './data.ts';
import { parseScenario } from './scenarios.ts';
import { startGraphQLHttp } from './http-server.ts';

const resolvers = {
  catalog: {
    Query: {
      products: (_: unknown, args: { skus: string[] }, context: unknown) => {
        if (args.skus.length > 12) throw new GraphQLError('Request at most 12 SKUs.', { extensions: { code: 'BAD_USER_INPUT' } });
        return args.skus.map(sku => (context as SubgraphContext).product.load(sku));
      },
    },
    Product: {
      __resolveReference: (reference: { sku: string }, context: unknown) => (context as SubgraphContext).product.load(reference.sku),
      price: (product: ProductRecord) => ({ amountMinor: product.amountMinor, currency: product.currency }),
      merchant: (product: ProductRecord) => ({ __typename: 'Merchant', id: product.merchantId }),
    },
  },
  inventory: {
    Product: {
      __resolveReference: (reference: { sku: string }) => reference,
      availability: (reference: { sku: string }, _: unknown, context: unknown) => (context as SubgraphContext).inventory.load(reference.sku),
    },
  },
  merchants: {
    Merchant: {
      __resolveReference: (reference: { id: string }, context: unknown) => (context as SubgraphContext).merchant.load(reference.id),
    },
  },
};

export const disabledPlugins = () => [
  ApolloServerPluginUsageReportingDisabled(), ApolloServerPluginSchemaReportingDisabled(),
  ApolloServerPluginInlineTraceDisabled(), ApolloServerPluginLandingPageDisabled(),
];

export async function startSubgraph(name: ServiceName, port = 0, slowInventoryMs = 450) {
  const server = new ApolloServer<SubgraphContext>({
    schema: buildSubgraphSchema({ typeDefs: parse(schemaSources[name]), resolvers: resolvers[name] }),
    includeStacktraceInErrorResponses: false,
    stopOnTerminationSignals: false,
    plugins: [...disabledPlugins(), {
      async requestDidStart() {
        return { async willSendResponse({ response, contextValue }) {
          if (response.body.kind === 'single') response.body.singleResult.extensions = { lab: { batches: contextValue.batches } };
        } };
      },
    }],
  });
  const running = await startGraphQLHttp(server, async req => createContext(parseScenario(req.headers['x-lab-scenario']), slowInventoryMs), port);
  return { name, ...running };
}
