# Can an ignored response still change the screen?

[한국어](react-attempts.ko.md) · [Earlier React observations](react-recheck.md)

A failed recheck can leave an earlier value on screen alongside a failure notice. What happens if an older request succeeds after that failure? If a callback checks that its attempt is no longer current and skips the state update, does that also protect the displayed quantity?

There is more than one path to the screen. An application can update its own attempt state in a promise callback, while Apollo delivers product values through a shared cache. A condition in the callback does not prevent cache writes that have already happened.

This experiment compares **guarding attempt status** with **applying the same guard before writing the cache**. It uses fictional products and warehouses, real GraphQL HTTP and a React component. First follow the two response paths, then compare scope changes and response order, and finally examine the costs of taking ownership of cache writes.

## Where the same condition runs

Both modes separately track the current scope and latest attempt. A scope combines product SKU and warehouse. Each scope change advances an epoch; each new lookup gets an attempt ID. A response can update attempt state only when all three match the current state.

The comparison does not weaken one mode's guard. The difference is when Apollo writes to cache.

| Mode | HTTP lookup | Cache write | Attempt status |
| --- | --- | --- | --- |
| Status guard only | `client.query` with `network-only` | Apollo writes the response automatically | Completion callback checks whether the attempt is current |
| Guard cache writes too | `client.query` with `no-cache` | Explicit `writeQuery` after the current-attempt check | Updated after the same check and write |

The React view reads through a `cache-only` query. Commands start network requests; the view subscribes to cache changes. That separates the question of whether attempt status changed from whether a cache update changed the quantity.

The earlier experiment called one hook's `observable.reobserve` sequentially. This experiment separates `client.query` commands from the cache-subscribing view to compare overlapping independent requests. It does not test ordinary `refetch` or the full lifecycle of the earlier hook.

The state model tracks only the current scope, epoch and latest attempt. It stores no separate last-success history. After a scope change, the cache may contain a value while attempt status is `idle` or `pending`. A readable value is not treated as a confirmed result from the current visit.

[Apollo's `no-cache`](https://www.apollographql.com/docs/react/caching/advanced-topics) skips automatic response writes. [Explicit `writeQuery`](https://www.apollographql.com/docs/react/caching/cache-interaction) changes the local cache. It neither changes nor reserves inventory on the server.

## Include controls that should already work

Five scenarios run under both modes. Each starts with a new client and cache, receiving quantity `3` for A/east over actual HTTP. Responses are then released in the order below. The quantities are fictional values chosen to distinguish responses.

| Scenario | Controlled ordering | Boundary being examined |
| --- | --- | --- |
| Late success | Hold an earlier request → newer request fails → earlier `7` arrives | Can cache data change while attempt status stays failed? |
| Product change | Hold A → move to B → receive B's `12` → receive A's `7` | Is another product's cache isolated from the current view? |
| Warehouse change | Hold A/east → move to A/west → receive west's `12` → receive east's `7` | Is a variable change treated as a different scope? |
| A → B → A | Hold first A → move to B → return to A → receive new A's `9` → first A's `7` | Does returning to the same cache key require a visit epoch too? |
| Cache read after failure | New request fails → `cache-only` query | Can a cache read clear independently tracked failure? |

Both modes can preserve the current screen in the product and warehouse controls. Those cases distinguish situations that correct cache identity already handles. The final control also challenges an overgeneralization: reading cache does not always erase a failure record. Unlike the earlier experiment that read the hook's error field, both modes here track attempt status separately.

## What changed in the actual recording

Ten runs in Chrome against the fixed source recorded 28 HTTP responses. The table shows each case's final checkpoint, not a claim that every intermediate DOM changed atomically.

| Scenario | Guard status only | Guard writes too | Attempt status |
| --- | --- | --- | --- |
| Late success | Displayed quantity `7` | Displayed quantity `3` | Latest attempt remains `failed` in both |
| Product change | B shows `12`; departed A's cache holds `7` | B shows `12`; A's cache holds `3` | Both `succeeded` |
| Warehouse change | West shows `12`; east's cache holds `7` | West shows `12`; east's cache holds `3` | Both `succeeded` |
| A → B → A | Displayed quantity `7` | Displayed quantity `9` | New attempt remains `succeeded` in both |
| Cache read after failure | Displayed quantity `3` | Displayed quantity `3` | Both remain `failed` |

In the late-success case, both modes rejected the older attempt's status update. The automatic-write mode still changed its quantity from `3` to `7`. Protecting status and protecting the displayed value were different operations.

The A → B → A case left a subtler combination. The latest attempt still reported success, but the quantity was `7` from the previous visit's request, rather than the `9` returned by that successful attempt. Without a connection between a success indicator and its value, each can look reasonable while their combination tells a different story.

The product and warehouse controls kept the current quantity at `12` in both modes. Their difference was the cache left behind. Guarded writes discarded the old response's `7` and retained `3` for the inactive scope. Calling that an unconditional improvement would hide a choice: whether a later visit should be allowed to reuse that response.

## The same scope is not the same visit

After moving from product A to B, a late A response must not update B's attempt status. Moving from A's east warehouse to its west warehouse changes the scope too. The cache object's key in this fixture also includes both SKU and warehouse. Request scope and normalized cache identity are separate contracts that both need to be correct.

Returning A → B → A exposes the limit of checking only a scope string. A request from the first visit and a request from the return visit have the same product and warehouse, but belong to different visits. The epoch records that distinction. Attempt IDs distinguish earlier and later requests within one visit.

An epoch is not the only possible representation. This implementation also checks attempt IDs that increase across the entire run, so outcomes after a new request do not establish that each number is independently necessary. The epoch expresses immediate invalidation on leaving a visit, before another request starts.

This rule **gives the later-started attempt authority over the screen's decision**. It does not establish that the later request contains newer server data. Even if that later request fails, the earlier request's late success may be excluded. Discarding a useful success is part of the chosen policy.

## Owning the write is more than adding a boolean

Using `no-cache` followed by conditional `writeQuery` gives the application a decision point before a response enters the displayed cache. It also replaces automatic behavior with responsibilities.

- A rejected response could have been useful elsewhere. Excluding it also gives up warming the cache for a product that is not currently visible.
- Partial success, merge policies, optimistic updates and other writers need explicit treatment. A production application's write ownership is broader than the fixture's single complete product response.
- A scope change must invalidate the old attempt immediately. Waiting until the next request starts leaves an interval in which the previous response may still be accepted.
- Checking immediately before the write and updating status afterward does not create a transaction. A write exception or another cache writer needs separate handling. Recording a failed write does not roll back partial changes already made.

React's [Effect cleanup example that ignores late results](https://react.dev/reference/react/useEffect) explains why result application needs a condition. This experiment asks whether that decision must also control the shared-cache write. Locally owned state and a cache read by multiple subscribers have different boundaries.

## What the comparison needs to establish

The local server acknowledges request arrival before explicitly releasing a response. It creates the intended completion order instead of assuming that a sleep will usually produce it. This tests chosen orderings, not every race or real-world latency distribution.

This is one local GraphQL HTTP server; it does not recreate the earlier Federation experiment's distributed request structure. `queryDeduplication: false` keeps overlapping operations independent. Requests are allowed to complete rather than cancelled, so the comparison concerns an arriving response's authority to write.

Attempt state uses `useSyncExternalStore`; the cache uses `useQuery`. The observer reads the actual DOM in `useLayoutEffect`. A checkpoint waits for the observed state and value to match the current store and cache. Waiting does not render the component or write values.

The raw record also contains DOM between checkpoints. During initial lookups in automatic-write mode, a DOM with `succeeded` and no hook data preceded the quantity. In its A → B → A case, `succeeded` appeared alongside the earlier quantity `3` before `9` appeared. The two independent subscriptions cannot be assumed to update in the same commit. Those combinations did not appear in this guarded-write recording, but that is not a guarantee of atomicity across all intermediate states. The observer does not measure paints visible to the user or their duration.

Read that A → B → A observation at `/browser/cases/6/domObservations/7` in the [raw JSON](https://minjae-lee-kr.github.io/research/react-attempts/recording.json). The next observation contains quantity `9`. Array indices start at zero.

Read the displayed quantity, independent attempt status, current scope, cache and actual HTTP result together. Status alone can miss an automatic cache write; quantity alone can miss a failed latest attempt.

Neither mode establishes current inventory or authorizes a purchase. Server response versions, validity deadlines and purchase-time revalidation need separate contracts. The comparison concerns **which responses may change a local value under the chosen screen-attempt ordering**.

## Evidence and reproduction

[Compare the five scenarios](https://minjae-lee-kr.github.io/research/react-attempts/?lang=en) · [Raw JSON](https://minjae-lee-kr.github.io/research/react-attempts/recording.json) · [Local run guide](../experiments/react-attempts/README.md) · [Source used for this execution](https://github.com/minjae-lee-kr/federated-catalog-lab/tree/c9f524f4fbcf46521916dc45a508ad3f07463268/experiments/react-attempts)

The original file is `attempts-50a8850a-2119-4e58-bbfe-d501a800c0df-1.json`, 537,913 bytes. Its SHA-256 is `e1fc7b48b39726a4604477036f50b18eee46b97d65ed895b0b92045cdc12b3f5`. Source and bundle manifests matched before and after execution; HTTP bodies and actual DOM passed consistency checks. Ten negative controls that changed record copies were rejected. This is a consistency check, not a reproduction or external attestation of the earlier execution.

The recording uses React 19.3.1 production without StrictMode and Apollo Client 4.3.3. It compares one controlled completion order per scenario. It does not validate SSR, Suspense, remounts, persistent caches, competing writers or every concurrent schedule. It does not reproduce an employer's system or production outcomes.
