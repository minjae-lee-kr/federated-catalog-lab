# Cancellation Debt

[English](README.md) · [한국어](README.ko.md)

**The request ended. The work did not.**

A concurrency limiter can report **one held permit while four jobs are still running**. This Apollo Federation lab reproduces that failure over real HTTP, then compares two ways to protect the underlying capacity.

The practical question: **who owns a permit after its caller gives up?**

## Run the experiment

Requires Node.js **24.19.0** and pnpm **11.25.0**. No credentials, Docker or external services.

```sh
pnpm install --frozen-lockfile
pnpm debt:ui
```

Open **http://127.0.0.1:4182/**. The Korean/English interface runs all four policies, shows work continuing beyond the response, and lets you inspect and download the events. Switching language preserves the selected policy and expanded evidence.

For terminal execution, use `pnpm debt`. For a saved, read-only page, use `pnpm debt:export` from a clean commit; it writes `.local/cancellation-export/` with raw JSON and file hashes. Exporting does not publish anything.

## The result worth inspecting

Four sequential reads. A configured **160 ms deadline per subgraph fetch**, **1,000 ms of uncancelled timer work**, and an optional capacity limit of **two**. These are experimental settings, not performance measurements.

| Policy | Observed peak jobs / permits | What it reveals |
| --- | ---: | --- |
| Timeout only | 4 / 4 | Ending the wait does not end the work. |
| Release on caller timeout — deliberately wrong | 4 / 1 | A healthy-looking permit counter can hide excess work. |
| Hold until work settles | 2 / 2 | Capacity stays bounded, but abandoned work occupies slots and later attempts are rejected. |
| Hold until settlement + cooperative cancellation | 1 / 1 | Work that supports cancellation settles sooner and returns its permit. |

These are observed values from a local run, not constants embedded in the display. Each run checks whether the expected counterexamples actually occurred. The checker reconstructs jobs and permits from events, correlates them with the HTTP responses and distinguishes **cancellation requested** from **work cancelled**.

**A permit belongs to the operation that consumes capacity—not merely to the promise waiting for its result.**

[Inspect the recorded event timelines](docs/observed-trace.md): two policies, the original JSON, and a reproducible figure from revision `ff47d27`.

## Inspect the engineering judgment

- **Follow the lifetime:** [the case study](docs/cancellation-debt.md) explains response closure, explicit signal propagation and the point where a permit may be released.
- **Challenge the evidence:** [the independent event checker](src/cancellation-check.ts) rejects missing settlements, mismatched request identities and inconsistent counters. Real HTTP controls also corrupt response/work identity to test the checker.
- **Keep useful data:** catalog and merchant fields survive inventory failure. Unknown inventory remains `null` with an error; it never silently becomes “sold out.”
- **Explore the wider API:** the [federation explorer](docs/federation-explorer.md) covers entity composition, request-scoped batching and [schema/consumer impact](docs/schema-evolution.md).

```sh
pnpm verify       # TypeScript, schema contracts, tests and build
pnpm dev          # Optional federation explorer at 127.0.0.1:4181
```

## Boundaries that matter

The gateway and three HTTP subgraphs share one Node process. Work is a synthetic timer; only the cooperative-cancellation policy makes it consume the signal and stop. This does not demonstrate database cancellation, CPU preemption, rollback, distributed admission control or production throughput. The deadline is a subgraph-hop budget on a shared host clock, not an end-to-end request budget. Source hashes and event checks aid reproduction; they do not attest to a hostile host or detect uninstrumented work.

All data, scenarios and implementations are original personal work. No employer code, internal architecture, private metrics or incidents are reproduced. The live lab binds to loopback and is not a public service. Two moderate upstream dependency advisories remain; their scope and inspected call paths are documented in [SECURITY.md](SECURITY.md).

[Primary references and implementation notes](docs/cancellation-debt.md#primary-references-and-inspected-implementation) · [MIT License](LICENSE)
