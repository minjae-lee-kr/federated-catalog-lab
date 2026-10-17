# One inventory failure. How much of the product page disappears?

[한국어](batch-failure.ko.md) · [Generated consumer types](consumer-impact.md) · [Project overview](../README.md)

A valid query and one efficient batch do not tell a caller which values will survive a dependency failure. This experiment changes two decisions independently: whether the batch rejects every key or returns an error for one key, and whether `Product.availability` may be null.

The same three fictional products pass through the existing Apollo Gateway and three HTTP subgraphs. Only `demo-lamp` triggers the injected lookup failure. The request order is notebook, lamp, cup, so the failing position is index **1**. The loader is synthetic; composition, GraphQL execution, federation entity mapping and HTTP are real.

```sh
pnpm install --frozen-lockfile
pnpm batch-failure
```

The command prints the observed data counts and error paths, then saves the original parsed GraphQL envelopes, contract results, tool versions and source manifest in a new `.local/batch-failure-*.json`. It starts loopback servers on ephemeral ports and stops them before returning. Exit `0` means the expected observations were established, including partial failures; it does not mean all three policies preserve the same data. Exit `1` means a tool failed, evidence disagreed or source changed during the run.

## Three passing contract checks, three different boundaries

All three variants compose, validate `CatalogCards`, and return HTTP **200**. The installed GraphQL schema comparison reports no breaking or dangerous changes for these variants. The runtime result is still different:

| Inventory batch policy | Availability type | Products retained | Known inventory values | Gateway error paths |
| --- | --- | ---: | ---: | --- |
| Return an `Error` at the lamp's key | `Availability` | 3 | 2 | `products[1].availability` |
| Throw from the whole batch | `Availability` | 3 | 0 | `products[0..2].availability` |
| Return an `Error` at the lamp's key | `Availability!` | 2 | 2 | `products[1].availability` |

These are expected, independently checked outcomes of this fixed fixture, not performance figures. The command derives the displayed counts from the received data after checking it; they are not accepted from producer counters.

With a whole-batch rejection, the two healthy keys reject too. Their product names, prices and merchants remain, but their inventory values become unknown. A single batched call did not provide per-key isolation.

With the non-null field, the lamp's **entire product becomes null**, including its otherwise available name and price. The list remains because its type is `[Product]!`: the list is required, but each product may be null. This is GraphQL's declared error behavior, not a gateway defect. Strengthening an output field can pass a schema compatibility check while changing what an execution failure removes. [GraphQL execution-error rules](https://spec.graphql.org/September2025/#sec-Handling-Execution-Errors)

## Follow the failed key across the boundary

The checker follows these identities rather than merely counting errors:

```text
request skus[1] = demo-lamp
  → inventory representation[1].sku = demo-lamp
  → DataLoader batch keys[1] = demo-lamp
  → subgraph error: _entities[1].availability
  → gateway error: products[1].availability
```

It also checks the other two products' exact values and the catalog/merchant responses before gateway assembly. In the non-null case, that evidence shows that the discarded lamp fields had actually been fetched. Whole-batch errors retain the synthetic `failedSku: demo-lamp` cause but affect three response paths. Cause identity and affected position are different things.

The [checker](../src/batch-failure-check.ts) does not import the resolver, loader or producer summary counters. It uses a separate expected mapping of the three public fixtures, checks the nullable baseline, reparses the recorded API schemas and validates the selected operation. Subgraph operation ASTs bind selected fields and arguments to the captured variables without relying on generated names or formatting. [Mutation controls](../tests/batch-failure.test.ts) change query structure, error paths, representation order, healthy data, cause identity and contract evidence in copies of actual responses. Invalid evidence yields no derived summary. This is a consistency check of an instrumented local run, not an independent network observer or cryptographic attestation.

## Choose the failure boundary deliberately

If a lookup can distinguish a failed key from valid results, returning an `Error` for that key can preserve the other values. A backend outage may leave every result unknown; inventing per-key success would be worse than rejecting the batch. Likewise, `Availability!` is reasonable only if removing the parent is acceptable when its guarantee cannot be met. Nullability is part of the failure contract, not just a convenience for generated types.

The cache distinction matters too. In the installed DataLoader, an individual `Error` result is memoized, while a whole-batch rejection clears the failed loads. A later load can therefore dispatch again. Separate in-process tests check this difference and JavaScript error identity; JSON error objects cannot establish that identity. Each subgraph HTTP operation creates fresh loaders, so no cache crosses requests. This experiment does not model a shared application cache or retries. [DataLoader error caching](https://github.com/graphql/dataloader#caching-errors)

This complements [consumer compilation](consumer-impact.md): a type checker asks whether the supplied types admit the consumer code; this experiment asks which selected values survive execution. A client may still discard partial data according to its own error policy; no client library or product UI runs here. [Apollo Client error policies](https://www.apollographql.com/docs/react/data/error-handling)

## Scope and sources

All services share one Node process. The failure is injected inside a request-scoped batch function, not a real database. There is no latency improvement, production scale, employer system, retry policy or distributed-cache claim. Durations in the trace are diagnostics only. Existing historical Cancellation Debt and shared-work recordings remain unchanged; a new report identifies its own source revision, dirty state and before/after fingerprint.

The experiment follows the installed versions recorded in each report. Implementation: [runner](../src/batch-failure-experiment.ts), [HTTP observation](../src/lab.ts), [loader](../src/loaders.ts). Primary background: [DataLoader batch contract](https://github.com/graphql/dataloader#batch-function), [Apollo's nullability explanation](https://www.apollographql.com/blog/using-nullability-in-graphql), and [Shopify's breadth-first execution article](https://shopify.engineering/faster-breadth-first-graphql-execution). Shopify's executor separately reconstructs error locations after traversal; that informed the decision to verify paths and values here, not to copy its engine or performance claims.
