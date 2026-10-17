# Federated Catalog Lab

[English](README.md) · [한국어](README.ko.md)

Three experiments use the same synthetic catalog, inventory and merchant APIs to follow failures across the server and client. They use real Apollo Gateway and HTTP subgraphs in an independent personal lab.

- **What if work outlives a timeout?** The Cancellation Debt experiment below compares when to return an execution slot.
- **What survives one failed inventory lookup?** [Compare partial responses](https://minjae-lee-kr.github.io/research/partial-data/) under different batch-error and nullability choices. Reproduce: `pnpm batch-failure`.
- **Does an error-free cache read mean recovery?** The [client cache experiment](docs/client-cache.md) follows error policies and cache writes into the next query. Reproduce: `pnpm client-cache`.

## Cancellation Debt

**The request ended. The work did not.**

A product page can stop waiting for inventory while the inventory work continues. If the limiter returns that work's execution slot on timeout, it can admit more work while the previous work still consumes capacity.

Four policies are compared over real HTTP calls. Execution slots (permits) are used to limit how many jobs may run at once; the checker reconstructs active jobs and held slots from events and correlates them with HTTP responses. The deliberately wrong policy can show **one held permit while four jobs are still running**.

**Return the execution slot when the work actually ends.** Holding it keeps the limit meaningful, but abandoned work occupies capacity and new requests may be rejected. Cooperative cancellation helps only when the work responds to it; here that work is a timer, with all services in one Node process.

## Run the cancellation experiment

Requires Node.js **24.19.0 or newer in the 24.x line** and pnpm **11.25.0**. Installation enforces this minimum; CI runs on 24.19.0. No credentials, Docker or external services.

```sh
pnpm install --frozen-lockfile
pnpm debt:ui
```

Open **http://127.0.0.1:4182/**. The Korean/English interface runs all four policies, shows work continuing beyond the response, and lets you inspect and download the events. Switching language preserves the selected policy and expanded evidence.

For terminal execution, use `pnpm debt`. For a saved, read-only page, use `pnpm debt:export` from a clean commit; it writes `.local/cancellation-export/` with raw JSON and file hashes. Exporting does not publish anything.

## The result worth inspecting

Four sequential reads. A configured **160 ms deadline per subgraph fetch**, **1,000 ms of uncancelled timer work**, and an optional capacity limit of **two**. These are experimental settings, not performance measurements.

| Policy                                           | Observed peak jobs / permits | What it reveals                                                                            |
| ------------------------------------------------ | ---------------------------: | ------------------------------------------------------------------------------------------ |
| Timeout only                                     |                        4 / 4 | Ending the wait does not end the work.                                                     |
| Release on caller timeout — deliberately wrong   |                        4 / 1 | A healthy-looking permit counter can hide excess work.                                     |
| Hold until work settles                          |                        2 / 2 | Capacity stays bounded, but abandoned work occupies slots and later attempts are rejected. |
| Hold until settlement + cooperative cancellation |                        1 / 1 | Work that supports cancellation settles sooner and returns its permit.                     |

These are observed values from a local run, not constants embedded in the display. Each run checks whether the expected counterexamples actually occurred. The checker reconstructs jobs and permits from events, correlates them with the HTTP responses and distinguishes **cancellation requested** from **work cancelled**.

[Inspect the recorded event timelines](docs/observed-trace.md): two policies, the original JSON, and a reproducible figure from revision `ff47d27`.

**When callers share work:** [normal responses can hide duplicate execution](docs/shared-work.md). A fixed HTTP experiment separates caller cancellation, physical settlement and registry cleanup.

## Inspect the engineering judgment

- **Trace cancellation to the work:** [the case study](docs/cancellation-debt.md) follows response closure, signal propagation and the point where a permit may be released.
- **Test the checker:** [the independent event checker](src/cancellation-check.ts) rejects missing settlements, mismatched request identities and inconsistent counters. Real HTTP controls also corrupt response/work identity to test the checker.
- **Choose what survives failure:** [one failed key, three different response boundaries](docs/batch-failure.md) compares per-key errors, whole-batch rejection and a non-null field over real HTTP. Federation composition and query validation succeed in all three runs; HTTP 200 responses still retain different data. [Compare the recorded product cards](https://minjae-lee-kr.github.io/research/partial-data/).
- **Explore the wider API:** the [federation explorer](docs/federation-explorer.md) covers entity composition and request-scoped batching. Follow [schema changes](docs/schema-evolution.md) through [type generation and compilation of unchanged consumers](docs/consumer-impact.md).

[Design choices and tradeoffs](docs/design.md) · [Explorer review path](docs/review-guide.md)

```sh
pnpm verify       # TypeScript, schema contracts, tests and build
pnpm dev          # Optional federation explorer at 127.0.0.1:4181
```

## Boundaries that matter

The gateway and three HTTP subgraphs share one Node process. Work is a synthetic timer; only the cooperative-cancellation policy makes it consume the signal and stop. This does not demonstrate database cancellation, CPU preemption, rollback, distributed admission control or production throughput. The deadline is a subgraph-hop budget on a shared host clock, not an end-to-end request budget. Source hashes and event checks aid reproduction; they do not attest to a hostile host or detect uninstrumented work.

All data, scenarios and implementations are original personal work. No employer code, internal architecture, private metrics or incidents are reproduced. The live lab binds to loopback and is not a public service. Two moderate upstream dependency advisories remain; their scope and inspected call paths are documented in [SECURITY.md](SECURITY.md).

[Primary references and implementation notes](docs/cancellation-debt.md#primary-references-and-inspected-implementation) · [MIT License](LICENSE)
