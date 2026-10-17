# The request ended. The work did not.

[한국어](cancellation-debt.ko.md) · [Project overview](../README.md)

A slow dependency can keep working after its caller times out. If the limiter returns the permit at that point, its counter can look healthy while the work it should limit keeps accumulating.

This is the primary experiment in Federated Catalog Lab. It uses an Apollo Federation gateway and three HTTP subgraphs. Inventory work holds a slot with a synthetic timer; the HTTP requests, dropped connections and cancellation propagation are real. This is not a database or production-load benchmark.

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm debt
# Optional Korean/English interface, http://127.0.0.1:4182/
pnpm debt:ui
# Read-only static capture; requires a clean, committed local revision
pnpm debt:export
```

`pnpm debt` writes `.local/cancellation-debt.json`: every GraphQL response, ordered work transitions, independent checks, runtime metadata, a source manifest and a before/after source-drift check. The UI starts fresh experiments and can download their evidence. There is no prerecorded result behind the screen.

`pnpm debt:export` is separate from the live UI. It requires a clean Git revision, captures a fresh successful run, checks source/head stability again after rendering, and writes `.local/cancellation-export/`. Open `index.html` directly or host that directory as static files. It contains relative assets, `report.json`, a matching `report-data.js` for offline rendering, and `export.json` with file hashes. The screen explicitly labels the saved run, capture time, revision, source fingerprint and limitations in Korean or English. Its run button and live transport script are absent; no API is required, and its content policy blocks network connections. Exporting does not publish anything. The raw JSON remains unchanged; hashes support reproduction and file integrity, not execution attestation.

## The counterexample

Run four sequential attempts of the same **read**, with a configured 160 ms subgraph response deadline and 1,000 ms inventory work. The optional admission limit is two. These numbers are fixtures chosen to expose overlapping lifetimes, not production recommendations.

The first local probe observed:

| Policy                                 | Peak active jobs | Peak held permits | Active after final response | Completed / cancelled / rejected |
| -------------------------------------- | ---------------: | ----------------: | --------------------------: | -------------------------------- |
| Timeout only                           |                4 |                 4 |                           4 | 4 / 0 / 0                        |
| Incorrect release on caller timeout    |                4 |                 1 |                           4 | 4 / 0 / 0                        |
| Hold permit until settlement           |                2 |                 2 |                           2 | 2 / 0 / 2                        |
| Hold permit + cooperative cancellation |                1 |                 1 |                           0 | 0 / 4 / 0                        |

These are an observed example, not constants embedded in the UI or promises about another machine. Rerun the command and inspect the raw report. The experiment fails visibly if its expected counterexamples are not observed or source files change during the run.

The second row is deliberately wrong. It releases admission ownership when the waiting HTTP connection disappears, while its signal-ignoring work continues. Its permit counter stays below two, yet physical active work reaches four. Checking only `permits <= capacity` would pass the wrong implementation.

The third row keeps the permit until the timer actually settles. It maintains the physical bound even though cancellation is ignored. The cost is visible: additional attempts are rejected while abandoned work occupies the slots. The fourth row cancels a timer that explicitly supports cancellation, then releases its permit after that timer settles.

**Release the permit when the underlying operation actually settles.** A `Promise.race` that returns a timeout and releases a permit in the caller's `finally` can make the same mistake if the other promise continues running.

## Where cancellation travels—and where it does not

```text
caller closes before response finishes
  → Node ServerResponse close + !writableFinished
  → request-scoped AbortSignal in gateway context
  → explicit fetch signal in RemoteGraphQLDataSource
  → inventory's premature HTTP response closure
  → cooperative timer rejects
  → actual work settles
  → permit released
```

The inventory hop also receives a generated absolute deadline. A direct-HTTP test keeps that caller connected and verifies that the deadline itself cancels the cooperative timer. The deadline starts at the inventory fetch: it is **not an end-to-end user-request budget**, and it uses the shared host clock. A distributed design would need a deadline trust policy and a clock-skew model.

`IncomingMessage.close` is deliberately not used as a cancellation signal; request-body completion is not caller abandonment. `ServerResponse.finish` also does not prove the caller received the response. The integration observes premature response closure and never turns it into a business rollback guarantee.

Apollo Gateway does not infer this chain. The pinned `RemoteGraphQLDataSource` constructs its fetch request itself. The experiment uses its `process` and `fetcher` extension points, with `AsyncLocalStorage` to carry the correct request signal through concurrent calls. A test aborts one gateway caller while a neighboring caller completes successfully, guarding against a mutable shared-signal bug.

Cancellation is cooperative. The admission-only and incorrect-release controls ignore the signal on purpose, and their work continues after the HTTP response has ended. This does not show that a database driver, CPU-bound function, remote service or already committed side effect can be stopped. All services share one event loop; blocking it delays cancellation and timeouts too.

## Observe the work after the response is gone

Response-only telemetry cannot report a job that continues after its response channel closes. The experiment therefore keeps a separate in-process work event ledger. `admitted`, `cancel-requested`, `completed`/`cancelled`, `permit-released` and `caller-completed` are distinct transitions. A cancellation request is not counted as cancelled work.

`cancellation-check.ts` independently reconstructs active jobs and owned permits from those transitions. It verifies counters, request/job identity, settlement cardinality and final drain. The experiment supplies the exact request IDs returned by its four HTTP responses: each must have an observed admission or rejection and exactly one caller completion, with no extra work-request identities. Correlation is checked over the whole trace rather than assuming work always starts before its caller finishes. It separately reports physical-bound violations and releases that precede settlement, so the intentionally broken control is not hidden behind one green result. Mutation controls cover false totals, omitted settlements, renamed release reasons and duplicate/missing caller completions. Two real-HTTP controls corrupt only a response ID or remove only the forwarded work ID; both must fail evidence validation while retaining the actual partial GraphQL data.

This checker trusts instrumentation coverage; it cannot detect unrecorded jobs or authenticate a hostile host. Source hashes support reproduction under quiescent source, not execution attestation. The capacity bound belongs to this single inventory process, not a fleet of replicas.

Catalog and merchant fields survive all four policies. Missing inventory stays `null` with an explicit error, rather than becoming “sold out.” The cooperative GraphQL error and gateway fetch timeout can race; evidence preserves the observed error code instead of claiming one ordering.

## Primary references and inspected implementation

- [Node 24.19 HTTP](https://nodejs.org/download/release/v24.19.0/docs/api/http.html#event-close_2): response closure, request completion and `writableFinished` have different meanings.
- [Node 24.19 timers](https://nodejs.org/download/release/v24.19.0/docs/api/timers.html#cancelling-timers): the promise-based timer accepts an abort signal and rejects when cancelled.
- [Node 24.19 async context](https://nodejs.org/download/release/v24.19.0/docs/api/async_context.html): request-scoped async state avoids sharing one caller's signal with another.
- [Apollo Server integration contract](https://www.apollographql.com/docs/apollo-server/integrations/building-integrations): the integration constructs context and handles the HTTP boundary.
- [Apollo Gateway API](https://www.apollographql.com/docs/apollo-server/using-federation/api/apollo-gateway): custom data sources. The installed `@apollo/gateway@2.14.4/dist/datasources/RemoteGraphQLDataSource.js` was inspected for its actual request-init and fetcher behavior; no private method is overridden.
