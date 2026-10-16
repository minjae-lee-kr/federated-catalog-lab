# The request ended. The work did not.

The interesting failure is not that a slow dependency times out. It is that a concurrency limiter can appear healthy while the work it claims to bound is still accumulating.

This is a secondary, local experiment on `experiment/cancellation-debt`. It uses the existing Apollo Federation gateway and three HTTP subgraphs. Inventory work holds a slot with a synthetic timer; the HTTP requests, dropped connections and cancellation propagation are real. This is not a database or production-load benchmark.

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm debt
# Optional Korean/English interface, http://127.0.0.1:4182/
pnpm debt:ui
```

`pnpm debt` writes `.local/cancellation-debt.json`: every GraphQL response, ordered work transitions, independent checks, runtime metadata, a source manifest and a before/after source-drift check. The UI starts fresh experiments and can download their evidence. There is no prerecorded result behind the screen.

## The counterexample

Run four sequential attempts of the same **read**, with a configured 160 ms subgraph response deadline and 1,000 ms inventory work. The optional admission limit is two. These numbers are fixtures chosen to expose overlapping lifetimes, not production recommendations.

The first local probe observed:

| Policy | Peak active jobs | Peak held permits | Active after final response | Completed / cancelled / rejected |
| --- | ---: | ---: | ---: | --- |
| Timeout only | 4 | 4 | 4 | 4 / 0 / 0 |
| Incorrect release on caller timeout | 4 | 1 | 4 | 4 / 0 / 0 |
| Hold permit until settlement | 2 | 2 | 2 | 2 / 0 / 2 |
| Hold permit + cooperative cancellation | 1 | 1 | 0 | 0 / 4 / 0 |

These are an observed example, not constants embedded in the UI or promises about another machine. Rerun the command and inspect the raw report. The experiment fails visibly if its expected counterexamples are not observed or source files change during the run.

The second row is deliberately wrong. It releases admission ownership when the waiting HTTP connection disappears, while its signal-ignoring work continues. Its permit counter stays below two, yet physical active work reaches four. Checking only `permits <= capacity` would pass the wrong implementation.

The third row keeps the permit until the timer actually settles. It maintains the physical bound even though cancellation is ignored. The cost is visible: additional attempts are rejected while abandoned work occupies the slots. The fourth row cancels a timer that explicitly supports cancellation, then releases its permit after that timer settles.

**The permit belongs to the underlying operation, not to the lifetime of the caller's wait.** A `Promise.race` that returns a timeout and releases a permit in the caller's `finally` can make the same mistake if the other promise continues running.

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

`cancellation-check.ts` independently reconstructs active jobs and owned permits from those transitions. It verifies counters, request/job identity, settlement cardinality and final drain. It separately reports physical-bound violations and releases that precede settlement, so the intentionally broken control is not hidden behind one green result. Mutation controls show that false summary totals, omitted settlements and renamed release reasons do not fool it.

This checker trusts instrumentation coverage; it cannot detect unrecorded jobs or authenticate a hostile host. Source hashes support reproduction under quiescent source, not execution attestation. The capacity bound belongs to this single inventory process, not a fleet of replicas.

Catalog and merchant fields survive all four policies. Missing inventory stays `null` with an explicit error, rather than becoming “sold out.” The cooperative GraphQL error and gateway fetch timeout can race; evidence preserves the observed error code instead of claiming one ordering.

## Primary references and inspected implementation

- [Node 24.19 HTTP](https://nodejs.org/download/release/v24.19.0/docs/api/http.html#event-close_2): response closure, request completion and `writableFinished` have different meanings.
- [Node 24.19 timers](https://nodejs.org/download/release/v24.19.0/docs/api/timers.html#cancelling-timers): the promise-based timer accepts an abort signal and rejects when cancelled.
- [Node 24.19 async context](https://nodejs.org/download/release/v24.19.0/docs/api/async_context.html): request-scoped async state avoids sharing one caller's signal with another.
- [Apollo Server integration contract](https://www.apollographql.com/docs/apollo-server/integrations/building-integrations): the integration constructs context and handles the HTTP boundary.
- [Apollo Gateway API](https://www.apollographql.com/docs/apollo-server/using-federation/api/apollo-gateway): custom data sources. The installed `@apollo/gateway@2.14.4/dist/datasources/RemoteGraphQLDataSource.js` was inspected for its actual request-init and fetcher behavior; no private method is overridden.

## 한국어

핵심은 타임아웃 자체가 아니라 **실행 허가의 수명**입니다. 응답을 기다리는 쪽이 떠났다는 이유로 허가를 반환하면, 허가 수는 1개인데 실제 작업은 4개가 실행되는 상황을 만들 수 있습니다. 화면과 원본 보고서는 이 잘못된 대조군을 명시적으로 구분합니다.

같은 조회를 네 번 시도하며 응답 제한 160ms, 가상 작업 1,000ms, 동시 실행 허가 2개를 사용합니다. 모두 현상을 드러내기 위한 설정값입니다. 속도 개선율이나 운영 트래픽 처리량을 측정하지 않습니다.

올바른 실행 제한기는 작업이 실제로 끝날 때까지 허가를 유지합니다. 하위 작업이 취소를 무시하면 작업은 계속되지만 실행량은 제한할 수 있으며, 그동안 추가 시도를 거절해야 합니다. 협력적 취소는 이번 타이머를 실제로 종료시켜 허가를 더 일찍 돌려줄 수 있게 합니다. DB 작업이나 외부 서비스도 자동으로 멈춘다는 뜻은 아닙니다.

실제 HTTP 연결 종료, 별도로 전달한 기한, 작업 종료, 허가 반환을 각각 기록합니다. 독립 검사기는 이 이벤트로 작업 수와 허가 수를 재구성합니다. 응답 후에도 남은 작업을 응답 안의 텔레메트리만으로 관측했다고 주장하지 않습니다.

`pnpm debt`로 새로운 원본 근거를 저장하거나 `pnpm debt:ui`로 한국어·영문 화면을 실행하세요. 단일 프로세스와 같은 호스트 시계 안에서 확인한 실험이며, 분산 시스템 전체의 실행 제한이나 운영 성능을 증명하지 않습니다.
