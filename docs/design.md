# Design decisions and the edges they expose

## 1. Federation is an ownership tool, not a free performance improvement

Catalog owns the product record. Inventory contributes availability through the same SKU key. Merchant details belong to a separate entity. The reference-only Merchant declaration in catalog uses `resolvable: false`: catalog can point at a merchant but does not pretend to resolve its fields.

This division intentionally produces a dependent execution stage: the catalog response must supply keys before other subgraphs can resolve entities. Federation does not remove that dependency or make remote calls free. For three arrays in one process, a single GraphQL server would be simpler; the split exists to make federation behavior inspectable.

Schemas are composed from local source before the gateway starts. This avoids runtime introspection as a deployment mechanism and makes the exact composition testable. Dynamic service ports affect routing URLs only.

## 2. Nullability controls the failure boundary

`products` is a non-null list with nullable entries. A missing SKU occupies a null slot, preserving input order. Product names and prices are required because the synthetic catalog record owns them.

`Product.availability` is nullable. Failing inventory must not imply that the product disappeared or that stock is zero. A returned quantity of zero means sold out; a null inventory result means unknown. The accompanying GraphQL errors distinguish an unavailable dependency from the intentional missing-record scenario.

This design does not make `null` sufficient for every product. A production API could use an explicit result union or a typed freshness/availability object if clients need richer status. That decision should follow product needs rather than wrapping every field by default.

## 3. A loader cache belongs to one request

Each subgraph HTTP operation constructs new DataLoaders. Within the operation, duplicate merchant IDs and SKUs share a batch result. After the operation, the loader objects disappear. No process-global cache can leak a failure, stale value or access decision into a later request.

Batch results have exactly one slot per requested key in the original order. The implementation builds a lookup map and remaps keys; it never assumes that the backing store preserves order. Tests exercise duplicate keys, absent keys and concurrent requests.

For real persistence, authorization context belongs in the loader boundary and cache keys. This lab has no identity model and cannot validate tenant isolation.

## 4. A timeout bounds waiting; it does not cancel a remote job

The gateway fetcher uses `AbortSignal.timeout`. An injected inventory delay triggers a timeout while catalog and merchant results survive. The error code is deliberately separate from a GraphQL resolver failure.

The downstream resolver may continue after the gateway aborts its connection. This lab does not propagate cancellation to a database, enforce a shared end-to-end deadline or stop CPU-intensive work. All services also share one event loop, so a blocked loop would delay the timeout itself. Tests use broad timing bounds to check that the deadline is applied, not to claim a service-level objective.

There are no automatic retries. A retry policy would need an explicit budget and classification of transient errors; retrying every subgraph failure can multiply load.

## 5. Three checks answer three different questions

1. **Composition:** can all subgraph declarations form a valid, executable graph?
2. **Schema comparison:** does the new public API remove or weaken a previous guarantee?
3. **Operation validation:** do the checked-in clients still express valid selections and variables?

Removing an unselected field can pass operation validation but still break an unknown client. Weakening output nullability can preserve query syntax while breaking generated client assumptions. Adding an enum value can remain schema-compatible but surprise exhaustive client branches, so the local policy also flags dangerous changes.

The baseline check does not prove behavioral compatibility, freshness, authorization correctness, latency or business invariants. Those need other evidence.

## 6. Telemetry must describe observations honestly

Each gateway response includes request-local fetch records, elapsed time and loader batches received from successful subgraph HTTP responses. The records are teaching instrumentation, not a distributed tracing system or a durable audit log. No global collection is retained.

A timed-out subgraph cannot deliver batch telemetry. The UI says “No batch result received” instead of treating an absent record as zero work. The trace list is completion-ordered, not a precise timeline. Measured milliseconds vary by machine and load.

Apollo Server reporting plugins are disabled. Apollo Gateway's separate anonymous telemetry is also explicitly opted out with `APOLLO_TELEMETRY_DISABLED=true` during gateway construction. The pinned Gateway reads this flag synchronously in its constructor; the caller's previous environment value is restored immediately in `finally`, with no intervening await. A test checks this isolation. No cloud credentials are needed or read by the application.

## 7. Why a small HTTP adapter?

Apollo's public `executeHTTPGraphQLRequest` API allows a narrow Node HTTP adapter. The lab accepts JSON POST only, caps bodies, checks Host and Origin, binds to loopback and catches listen errors so startup can roll back. Tests verify these boundaries and cleanup.

Shutdown first stops accepting work and closes idle connections. After a one-second grace period it closes remaining HTTP connections, including clients that never finish a request body. Repeated stop calls share the same cleanup promise. This bounds listener cleanup; it does not forcibly interrupt JavaScript computation or cancel a downstream job.

This adapter is intentionally not a general-purpose integration package. It omits GET/APQ URL handling, uploads and a GraphQL IDE. For a production service, prefer a maintained integration and configure the deployment boundary explicitly.
