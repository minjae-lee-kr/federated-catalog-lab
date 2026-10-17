# The error disappeared. Was inventory checked again?

[한국어](client-cache.ko.md) · [Server-side partial responses](batch-failure.md)

A failed inventory lookup can leave a readable product card. The next question is what a client keeps from that response: the fields, the error, or an older successful value.

This experiment runs `ApolloClient.query` against two real local Federation gateways. One returns healthy inventory; the other fails only `demo-lamp`. Its HTTP 200 response contains three products, `availability: null` for the lamp, and an error at `products[1].availability`. The notebook's quantity is genuinely `0`; the lamp's `null` means this lookup did not establish a quantity.

## Run and inspect

```sh
pnpm install --frozen-lockfile
pnpm client-cache
```

The command accepts no URLs or other options. It creates two loopback gateways, each with three HTTP subgraphs, and stops them after the five cases. Each case gets a new client and cache. A warm case first queries the healthy server over HTTP, then changes the same client's `HttpLink` URI to the fixed failure server without replacing its cache. Its last call is another `client.query` with `fetchPolicy: 'cache-first'`, **not** `ObservableQuery.refetch`. The failure endpoint remains selected even when no request is sent.

The report is written to a new `.local/client-cache-*.json` file. For each step, inspect these separate observations:

- `http`: request body, HTTP status, original UTF-8 response body and SHA-256. No HTTP observation means that step did not invoke the fetch adapter.
- `result`: promise resolution/rejection, returned data and serialized error. A rejected `none` call has no resolved result, but its `CombinedGraphQLErrors.data` still contains the partial response.
- `cacheBefore` / `cacheAfter`: actual `cache.extract()` snapshots; `readAfter`: a separate `cache.readQuery` result. Reading a value establishes neither freshness nor business validity.

## Five comparisons

The failed step uses `network-only`, except the explicit `no-cache` control. All calls in a case use the same error policy. The warm lamp quantity is the synthetic value `3`.

| Case | Failed call | After that call | Next `cache-first` call |
| --- | --- | --- | --- |
| `all-cold` | Resolves with data + error | Stores lamp `null` | No HTTP, lamp `null`, no error |
| `none-warm` | Rejects with error | Keeps prior lamp quantity `3` | No HTTP, quantity `3`, no error |
| `all-warm` | Resolves with data + error | Replaces quantity `3` with `null` | No HTTP, lamp `null`, no error |
| `ignore-warm` | Resolves with data, omits error | Replaces quantity `3` with `null` | No HTTP, lamp `null`, no error |
| `all-no-cache` | Resolves with data + error | Cache stays empty | One HTTP request to the same failure server, data + error; this call now caches the partial data |

The table describes the fixed observations checked by the command, not a promise about every Apollo API or configuration. The five cases make nine client HTTP requests across thirteen `client.query` calls. That count is a control for the experiment, not a performance result.

## The decision is about missing context

`all` preserves useful fields and exposes the first error. It does not make that error part of the next cached result. If a screen needs to distinguish “inventory lookup failed” from another reason for a nullable field, it needs an explicit state model for that distinction. Keeping a separate error state also requires deciding when it expires and which later result clears it.

`none` avoids writing this partial response. With a warm cache, that also leaves the prior quantity available. Treating an error-free cache read as a new inventory confirmation would be an application mistake. The experiment does not know whether quantity `3` is still correct: it has no stock mutation, validity deadline or reservation contract.

`ignore` removes the first error signal; it does not turn `null` into zero. `no-cache` keeps this response out of the cache, at the cost of another network request on the following cold `cache-first` call. That request still fails. These policies choose what to expose and store; they do not repair the dependency or establish inventory validity.

## Scope and evidence

Apollo Client is pinned to `4.3.3`, RxJS to `7.8.2` and GraphQL to `16.14.2`. `Product.keyFields: ['sku']` and `Merchant.keyFields: ['id']` explicitly select normalization identities. The product fixture has no default `id`; silently relying on the default would test an embedded-product cache instead. Availability and money objects stay embedded. Each server operation creates fresh DataLoaders; their request-local memoization is separate from the client's cache.

The independent checker imports neither Apollo Client nor the producer/resolver code. It checks the selected operation and SKU order, raw response hashes and values, downstream keys/error paths, promise outcomes, normalized cache transitions and actual request coverage. Mutation tests remove a real request, relocate an error, reuse a response, change cache values and forge source stability. Invalid evidence returns no display observations.

Reports include installed versions plus source manifests/Git state before and after execution. Hash agreement supports reproducibility; it does not attest execution on a hostile host. The raw body is observed inside the fetch adapter, not by an independent packet recorder. The command bounds each HTTP operation and response body; it runs sequentially and closes its owned clients and servers.

This is one Node process using synthetic data and resolver faults. It does not test React rendering, `watchQuery`, persistence, retries, network-error behavior, cross-tab state or application freshness policy. A `client.query` result here has no `dataState` field; cache readability is recorded through `readAfter` instead. Older batch-failure recordings remain separate evidence of the server boundary.

## Primary references

- [Apollo: errors across API types](https://www.apollographql.com/docs/react/data/error-handling#promise-based-apis) explains the promise policies; the cache transitions above are separately executed observations.
- [Apollo: supported fetch policies](https://www.apollographql.com/docs/react/data/queries#supported-fetch-policies) distinguishes `cache-first`, `network-only` and `no-cache`.
- [Apollo: custom cache IDs](https://www.apollographql.com/docs/react/caching/cache-configuration#customizing-cache-ids) explains `keyFields`.
- [Apollo: CombinedGraphQLErrors](https://www.apollographql.com/docs/react/api/errors/CombinedGraphQLErrors) documents the error's original response data.
