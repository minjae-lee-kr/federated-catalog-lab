# One inventory failure. How much of the product page disappears?

[한국어](batch-failure.ko.md) · [Generated consumer types](consumer-impact.md) · [Project overview](../README.md)

A valid query and one efficient batch do not tell a caller which values will survive a dependency failure. This experiment changes two decisions independently: whether the batch rejects every key or returns an error for one key, and whether `Product.availability` may be null.

The same three fictional products pass through the existing Apollo Gateway and three HTTP subgraphs. Only `demo-lamp` triggers the injected lookup failure. The request order is notebook, lamp, cup, so the failing position is index **1**. The loader is synthetic; composition, GraphQL execution, federation entity mapping and HTTP are real.

[Compare the recorded product cards and error paths](https://minjae-lee-kr.github.io/research/partial-data/) from revision `e34b17e`, or rerun the experiment below. The viewer presents captured server responses; it does not execute a client library's error policy.

```sh
pnpm install --frozen-lockfile
pnpm batch-failure
```

The command prints the observed data counts and error paths, then saves the original parsed GraphQL envelopes, contract results, tool versions and source manifest in a new `.local/batch-failure-*.json`. It starts loopback servers on ephemeral ports and stops them before returning. Exit `0` means the expected observations were established, including partial failures; it does not mean all three policies preserve the same data. Exit `1` means a tool failed, evidence disagreed or source changed during the run.

## The same query, three failure boundaries

Federation composition succeeds in each run, `CatalogCards` is valid against the resulting API schema, and the gateway returns HTTP **200**. Comparing each API schema with the nullable baseline reports no breaking or dangerous changes in the installed GraphQL library. Those checks leave an execution decision open: how much data should one failed lookup remove?

| Inventory batch policy | Availability type | Products retained | Known inventory values | Gateway error paths |
| --- | --- | ---: | ---: | --- |
| Return an `Error` at the lamp's key | `Availability` | 3 | 2 | `products[1].availability` |
| Throw from the whole batch | `Availability` | 3 | 0 | `products[0..2].availability` |
| Return an `Error` at the lamp's key | `Availability!` | 2 | 2 | `products[1].availability` |

These counts describe retained data in this fixed fixture. The checker derives them from the received responses, separately from the runner's counters.

With a whole-batch rejection, the two healthy keys reject too. Their product names, prices and merchants remain, but their inventory values become unknown. A single batched call did not provide per-key isolation.

With the non-null field, the lamp's **entire product becomes null**, including its otherwise available name and price. The list remains because its type is `[Product]!`: the list is required, but each product may be null. This follows GraphQL's error propagation rules. Strengthening an output field can pass a schema compatibility check while changing what an execution failure removes. [GraphQL execution-error rules](https://spec.graphql.org/September2025/#sec-Handling-Execution-Errors)

## Choose the failure boundary deliberately

Return a per-key `Error` when the lookup can distinguish that failed key from valid results. The cost is that consumers must handle missing inventory alongside usable product data. Reject the whole batch when the dependency cannot establish any of its results. Declare `Availability!` when removing the parent product is acceptable if inventory cannot be supplied. Nullability determines the scope of data loss as well as the generated type.

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

The [checker](../src/batch-failure-check.ts) keeps its expected fixture values separate from the resolver and loader. It checks the nullable baseline, reparses recorded API schemas and validates the query. Subgraph operation ASTs connect selected fields and arguments to captured variables without depending on generated names or formatting. [Mutation controls](../tests/batch-failure.test.ts) alter query structure, error paths, representation order, healthy data, cause identity and contract evidence in response copies; inconsistent evidence yields no summary. Composition happens in the runner; the checker rechecks the resulting API contract and recorded execution.

## Cache lifetime changes the next load

In the installed DataLoader, an individual `Error` result is memoized, while a whole-batch rejection clears the failed loads. A later load can therefore dispatch again. Separate in-process tests check this difference and JavaScript error identity, which serialized JSON cannot establish. Each subgraph HTTP operation creates fresh loaders, so this cache lasts only for that request. [DataLoader error caching](https://github.com/graphql/dataloader#caching-errors)

This complements [consumer compilation](consumer-impact.md): a type checker asks whether the supplied types admit the consumer code; this experiment asks which selected values survive execution. A client may still discard partial data according to its own [error policy](https://www.apollographql.com/docs/react/data/error-handling).

## Scope and sources

All services share one Node process; failures are injected into a request-scoped batch function. The evidence covers the resulting server data and error paths, not a database outage, client behavior, retries or a shared application cache. Durations are diagnostic, not performance measurements. The checker tests consistency within the instrumented run rather than observing the network independently. Each report identifies its source revision, dirty state and before/after fingerprint; historical recordings retain their original bytes.

The experiment follows the installed versions recorded in each report. Implementation: [runner](../src/batch-failure-experiment.ts), [HTTP observation](../src/lab.ts), [loader](../src/loaders.ts). Primary background: [DataLoader batch contract](https://github.com/graphql/dataloader#batch-function), [Apollo's nullability explanation](https://www.apollographql.com/blog/using-nullability-in-graphql), and [Shopify's breadth-first execution article](https://shopify.engineering/faster-breadth-first-graphql-execution). Shopify's separate reconstruction of error locations informed the decision to verify both paths and values here.
