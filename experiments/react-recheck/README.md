# A readable value is not a successful recheck

[한국어](README.ko.md) · [Detailed note](../../docs/react-recheck.md)

This local harness mounts a real React `useQuery` component against two loopback Apollo Federation gateways. It asks which value remains visible after a stock lookup fails, then the same observable is evaluated with `cache-first`.

Each policy gets a fresh client/cache and one component. Run three steps: a healthy `network-only` lookup; a `network-only` lookup whose lamp availability resolver fails; then `cache-first`. Compare `errorPolicy: all` and `none`. The input is three fictional products. The healthy lamp quantity is 3; the failure response has `availability: null` and a GraphQL field error, with HTTP 200.

This explicitly calls **the hook-created `observable.reobserve`**. It is not a normal `refetch` button, and does not establish behavior for StrictMode, Suspense, SSR, remounts, variable changes, concurrency, or other versions.

## Run from the repository root

Requirements: Node 24.x (24.19.0+), pnpm 11.25.0, Git, and a modern browser. The browser must support `AbortSignal.any` and Web Crypto. Install both packages; the nested harness resolves Apollo from the root installation.

```sh
pnpm install --frozen-lockfile
pnpm --dir experiments/react-recheck install --frozen-lockfile
pnpm --dir experiments/react-recheck build
pnpm --dir experiments/react-recheck test
pnpm --dir experiments/react-recheck start
```

Use a **clean Git checkout**, including these experiment sources. Startup rejects a missing or dirty Git checkout so a capture can name an exact source revision. Building creates ignored `app.js` and `build-receipt.json`; they are separately hashed before and after a capture. Do not edit sources or rebuild while a session runs.

Open `http://127.0.0.1:4352`. Choose `all`, press buttons 1 → 2 → 3, then choose `none` and repeat. Save once after both cases; saving unmounts the active component. Record the filename shown, then stop the owned servers with the final button. The controls are Korean; this guide and the detailed note explain them in both languages. Port 4352 must be available; do not terminate unrelated processes to free it.

```sh
pnpm --dir experiments/react-recheck audit react-SESSION-1.json
pnpm --dir experiments/react-recheck check:negative react-SESSION-1.json
```

Replace the filename with the actual generated name. Records stay in ignored `records/`; nothing uploads automatically. The audit requires both policies, fixed request/query/variables, the expected fictional product identity and healthy lamp quantity, matching server/browser response bytes, and consistent hook/Promise/cache/visible DOM fields. The negative controls alter copies of the record, including visible values, request arguments, response bytes and provenance. They do not make new network requests. CI builds the harness and tests the request contract; it does **not** make a browser capture.

## What this costs and what it proves

The fetch wrapper buffers bounded response bodies to preserve exact bytes. That changes delivery timing. `useLayoutEffect` reads this component's actual HTML/text after commit, omitting adjacent identical DOM. Observation counts are not render, commit, or paint counts; a completed step waits for a non-loading DOM result and one timer turn, not global quiescence.

The proxy permits only the fixed operation, including Apollo's `__typename` additions and pinned client-library extension. It binds to loopback, validates Origin/Host and a per-session token, limits requests/body sizes/saves, and stops after 20 minutes. The token is not saved. These controls reduce accidental exposure; they do not authenticate telemetry from a hostile local browser. HTTP 200, a resolved Promise, `dataState: complete`, and a readable cache value each answer different questions. None alone establishes current stock or authorizes a purchase.

`sourceBefore/After` hashes all tracked files. `harnessBefore/After` also hashes the served generated bundle and build receipt. A later consistency audit is not a reproduction of the original execution. Review records before choosing to publish them; historical runs must keep their original bytes and source revision.

The request fixture was extracted from an earlier independent synthetic capture. It contains only the public fixed operation and fictional SKU inputs, and is a contract regression fixture, not a new execution result.
