# Which responses may write the cache?

[한국어](README.ko.md) · [Design note](../../docs/react-attempts.md)

A real React `useQuery` component observes Apollo's cache while independent HTTP commands complete in a controlled order. Compare a guard that protects attempt status with the same guard applied before cache writes.

- `status-only`: `client.query({ fetchPolicy: 'network-only' })` allows Apollo's automatic writes; the caller checks scope, epoch and attempt ID before settling its own status.
- `guarded-write`: `client.query({ fetchPolicy: 'no-cache' })` skips automatic writes; an accepted successful attempt calls `writeQuery` before settling status.

Both modes use the same guard. The view uses `cache-only`; neither mode uses ordinary `refetch` or the previous experiment's `observable.reobserve`. Scope is SKU plus warehouse, and the normalized `Product` key includes both. Every scope transition advances the epoch, including returning to a previously visited scope. The model tracks the latest attempt, not a separate history of successful confirmations.

## Run from the repository root

Requirements: Node 24.x (24.19.0+), pnpm 11.25.0, Git and a browser supporting `AbortSignal.any` and Web Crypto. Apollo is resolved from the root installation; React is pinned in this nested package.

```sh
pnpm install --frozen-lockfile
pnpm --dir experiments/react-attempts install --frozen-lockfile
pnpm --dir experiments/react-attempts build
pnpm --dir experiments/react-attempts test
pnpm --dir experiments/react-attempts start
```

Start from a clean Git checkout with the experiment sources committed. The server records the source revision and tracked file hashes. The generated `app.js` and build receipt are ignored by Git but separately hashed. Do not rebuild or edit sources during a recording.

Open `http://127.0.0.1:4354`, then choose **Run all ten cases and save**. The page runs five scenarios under both modes and saves a new file after all cases finish. Copy its generated filename, then choose **Stop owned server**. Port 4354 must be free; do not terminate unrelated processes to free it. Records remain local in ignored `records/`; nothing uploads automatically.

```sh
pnpm --dir experiments/react-attempts audit attempts-SESSION-1.json
pnpm --dir experiments/react-attempts check:negative attempts-SESSION-1.json
```

Replace the example name with the actual saved filename. The audit reads the saved record; it does not rerun HTTP or React. Negative controls alter copies, leaving original evidence unchanged.

## Five schedules, two write policies

Each run creates a fresh client/cache and receives an initial quantity of `3` through real HTTP. Within a run, the same cache-only React component stays mounted across navigation. A local GraphQL server holds requests until an explicit release; the browser waits for arrival before choosing the next release.

| Scenario | Release order after initial success |
| --- | --- |
| `late-success` | New same-scope request fails, then older success returns `7` |
| `product-switch` | B/east returns `12`, then the old A/east request returns `7` |
| `variable-switch` | A/west returns `12`, then the old A/east request returns `7` |
| `aba` | Return A → B → A; new A returns `9`, then first-visit A returns `7` |
| `cache-read` | New request fails; read the remaining cache without a network attempt |

Product/warehouse switches are controls for correctly separated cache identities. The cache-read case checks that both modes retain independently tracked failure. These are not five manufactured failures of one mode.

`queryDeduplication: false` ensures independent overlapping requests. Fixed quantities are response identifiers, not production metrics or authoritative inventory versions. The server is one synthetic GraphQL HTTP endpoint, not the repository's multi-subgraph Federation setup.

## Read the evidence in order

Follow HTTP request arrival and release, the promise result, the token-acceptance decision, the cache, and the actual post-commit DOM. A rejected old attempt can still have written cache in the automatic-write mode; a preserved failure badge alone does not establish that the quantity stayed unchanged.

The view independently subscribes to immutable attempt state through `useSyncExternalStore` and to the cache through `useQuery`. The observer reads component HTML and text in `useLayoutEffect`. A snapshot only waits for the observed state and hook data to agree with the current store and cache; it does not render or write either one. An unchanged step may reuse the last matching DOM observation. Snapshot counts are not render, commit or paint counts, and the wait does not establish global asynchronous quiescence.

The model's write-exception test uses a synthetic throwing callback. It checks failure status, not rollback of partial Apollo writes. A guard immediately before `writeQuery` does not form a transaction with external observers or other cache writers.

## Limits

React 19.3.1 production, StrictMode off; Apollo Client 4.3.3; fixed variables, identities and schedules; in-memory cache. No automatic cancellation, server-version arbitration, cross-tab coordination, SSR, Suspense, remount recovery, persistent cache or production load is established.

Latest-started-wins is a chosen UI rule. It can discard a useful older success and prevent warming an inactive scope. It cannot tell whether the server's current stock is correct or authorize a purchase. Hashes and consistency checks support inspection; they do not authenticate records from a hostile local environment.
