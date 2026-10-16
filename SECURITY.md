# Security scope

This project is a local, synthetic, read-only lab. Do not deploy it as a public service or add credentials, real customer data, internal APIs or employer source code.

## Local defaults

- Gateway, subgraphs and explorer bind to `127.0.0.1`.
- HTTP accepts JSON POST only for GraphQL, rejects unexpected Host/Origin headers and caps bodies at 32 KiB.
- The explorer accepts a fixed set of named operations and fault scenarios; it does not forward arbitrary URLs, headers or file paths.
- UI output uses DOM text nodes rather than interpreting server data as HTML; a same-origin Content Security Policy applies.
- Apollo reporting and Gateway anonymous telemetry are explicitly disabled.
- Errors omit stack traces. No secrets or external credentials are required.
- No authentication or authorization exists. Loopback is an exposure boundary, not a substitute for those controls.

The SKU limit is not a full GraphQL query-cost limit. Direct GraphQL clients can use aliases or introspection. This is one reason to keep the lab local.

## Dependency review — 2026-10-17

`pnpm audit --prod` reported two **moderate** upstream advisories in the pinned dependency graph:

| Package | Advisory | Local assessment |
| --- | --- | --- |
| `uuid` | [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) | Affects buffer bounds in specific UUID functions. Application code uses Node's `randomUUID`; transitive packages still bring an affected version. |
| `@opentelemetry/core` | [GHSA-8988-4f7v-96qf](https://github.com/advisories/GHSA-8988-4f7v-96qf) | Affects W3C Baggage extraction. The lab does not install a baggage propagator or forward client headers to subgraphs; Gateway telemetry export is disabled. The dependency remains affected. |

These findings have **not** been erased by forcing incompatible major dependency versions. The local boundaries reduce exposure but do not make the affected packages patched. Reassess when compatible upstream releases become available, and run the full test suite after updates. The audit is a point-in-time report, not a guarantee that no other vulnerabilities exist.

`pnpm peers check` reports no mismatched peer dependencies. GraphQL 16 is intentional because the pinned Apollo packages require it; blindly taking the newest GraphQL major breaks that contract.

### Reachability evidence in this pinned configuration

- `@apollo/federation-internals@2.14.4/dist/operations.js` calls `uuid.v1()` without an external buffer. `@apollo/query-graphs@2.14.4/dist/graphPath.js` calls `uuid.v4()` without one. The reviewed advisory concerns v3/v5/v6 buffer bounds; these inspected query/composition call sites do not exercise that affected signature. `src/lab.ts` uses Node's `randomUUID` for request IDs. This is a call-site assessment, not a claim that the transitive package is patched.
- `@opentelemetry/core@1.30.1/build/src/baggage/propagation/W3CBaggagePropagator.js` contains the affected `extract` path, which splits the supplied baggage string. The lab does not register a propagator or call `propagation.extract`; neither call appears in the pinned Gateway's compiled runtime. `ObservedDataSource.willSendRequest` in `src/lab.ts` forwards only the validated synthetic inventory scenario, not a client's baggage or other headers.
- The pinned Gateway constructor in `@apollo/gateway@2.14.4/dist/index.js` checks `APOLLO_TELEMETRY_DISABLED` before creating its anonymous data-collection exporter. `src/lab.ts` sets it to `true` immediately around that synchronous constructor and restores the caller's original value in `finally`, without an intervening await. Server reporting plugins are disabled separately in `src/subgraphs.ts`.
- The integration test starts the lab with the caller's flag set to `false`, replaces that pinned exporter factory with a failure sentinel, verifies it is never called, and verifies the original environment value is restored. This intentionally checks an upstream integration detail and must be re-reviewed when upgrading Apollo.

The cloud-detector dependency path also brings `uuid` and OpenTelemetry packages. Disabling Gateway's exporter prevents its associated resource-detection initialization in this configuration. Adding a real telemetry SDK, propagator, new UUID usage or public network exposure would require a new reachability review. The audit continues to report both affected dependencies.

## Reporting a problem

For a public repository, report reproducible, non-sensitive issues through the repository's issue tracker. Do not include real credentials, internal URLs or private work artifacts.
