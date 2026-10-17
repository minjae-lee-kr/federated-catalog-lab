# The error disappeared. The recheck still failed.

[한국어](react-recheck.ko.md) · [Earlier cache experiment](client-cache.md)

The inventory lookup failed, but the screen still showed **3**. Reading from cache then cleared the error. **Zero** HTTP requests were sent in between.

Could that screen tell the user, “Checked again”?

This Apollo Client and React experiment uses three synthetic products. It keeps a component mounted after a healthy response, fails the next inventory lookup, then reads the same query from cache. The question is not how to eliminate caching. It is **how to keep a useful value on screen without presenting a failed recheck as a successful one**.

Start with the three steps below, then compare what `data` and `previousData` actually retain. The final section examines the costs of tracking a displayed value separately from a network attempt.

## What changed, and what stayed the same

Apollo Client stores server values in a memory cache. `useQuery` exposes query state to a React component. In this experiment, the product list and prices remain available; only the lamp's `availability` lookup fails. The response contains the other products, `availability: null` for the lamp, and a GraphQL error at that field. Its HTTP status is 200.

`null` does not mean a quantity of zero. This response did not establish a quantity. The experiment cannot tell whether the earlier quantity of `3` is still correct.

Each policy gets a fresh client and cache. One component stays mounted through these steps:

| Step | Operation | Actual HTTP requests |
| --- | --- | ---: |
| Healthy lookup | `network-only` receives quantity `3` from the healthy server | 1 |
| Failed lookup | Re-evaluate the same observable with `network-only`, now using the failing server | 1 |
| Cache read | Re-evaluate the same observable with `cache-first`; the failing server remains selected | 0 |

Steps two and three call `observable.reobserve(...)` on the observable returned by `useQuery`. They do not reproduce an ordinary `useQuery.refetch()` button or automatic retry. `cache-first` can satisfy a query without contacting the server when its required data is readable from cache.

These are the essential calls. This explanatory excerpt omits endpoint switching and observation code.

```js
// Keep the same observable returned by useQuery.
try {
  await observable.reobserve({ fetchPolicy: 'network-only' });
} catch (error) {
  // The actual observer records this error too.
}
await observable.reobserve({ fetchPolicy: 'cache-first' });
```

The [earlier promise-based experiment](client-cache.md) observed `client.query()` results and cache contents. This experiment follows a real `useQuery` component through to its DOM. A separate `watchQuery` subscription, a method's returned promise and a React hook result are distinct observation surfaces; they were not treated as the same result object.

## A failed request and a retained value described different facts

`errorPolicy` determines how GraphQL errors and partial data are handled. After the healthy lookup, the two policies behaved differently in the pinned version:

| Immediately after failure | `all` | `none` |
| --- | --- | --- |
| Lamp inventory in current `data` | New response's `null` | Earlier quantity `3` |
| Lamp inventory in `previousData` | Earlier quantity `3` | `previousData` absent |
| Lamp inventory in `error.data` | New response's `null` | New response's `null` |
| `reobserve` promise | Resolves with data and error | Rejects with error |
| Hook state | `networkStatus: 8`, `dataState: complete` | `networkStatus: 8`, `dataState: complete` |

Reading only the rejected promise under `none`, I could have expected the screen to have no data either. The actual product card still showed the earlier quantity of `3`. The new partial response was separately available in `error.data`.

The absent `previousData` was especially useful evidence. Treating that field as an indicator of “old data still on screen” would miss this case: current `data` itself retained the old value. The presence of `previousData` alone could not establish a value's origin or when it had been checked.

Nor did `dataState: complete` establish a successful inventory recheck. Both policies reported `complete`, with an error and different displayed inventory. Whether data was readable and what the UI could claim about it were separate questions.

## No successful response cleared the error

After the final `cache-first` call, both current hook results had no error and `networkStatus` was 7. `all` still read `null`; `none` still read `3`. Neither sent an HTTP request.

There was no evidence that the server had recovered: the failed field had not been requested again. There was also no evidence that `3` was wrong. The experiment contains no stock mutation or reservation.

Choosing `all` can preserve the other products while leaving an unavailable field as `null`. The UI must distinguish unavailable information from sold-out stock. In this `none` case, the previous screen could remain useful, but its retained value should not look newly confirmed. Neither error policy decides whether inventory is valid.

## Keep the value, but remember the attempt separately

The design I explored separates what the screen can read from the last explicit network attempt.

```text
Displayed value: 3
Last network attempt: failed
Value from last successful attempt: 3
Current inventory: not established by this record
```

One possible rule is to mark a new attempt `pending` and record success or failure when it settles. A cache read could update the displayed value without creating a successful network attempt or erasing a failed one. Under that rule, failure could remain visible after the final cache read. **This is a design proposal prompted by the observations. The public experiment does not integrate this state management or validate its effects.**

The cost is more than one extra state variable.

- **Define success.** Here, success concerns the lamp's inventory field. HTTP 200 or a resolved promise is insufficient. The caller must decide which fields a partial response has to confirm.
- **Decide when failure expires.** If a readable cache value cannot clear the notice, it stays longer. A later success, a different product or dismissal could clear it; the application must choose. Preserving failure context adds UI complexity.
- **Choose what to do with late outcomes.** Once a newer attempt starts, an older attempt's late settlement could be excluded from the attempt record. That discards potentially useful success information. A server-provided response version could justify another rule.

Adding attempt sequence numbers to this record would not, by itself, guard the ordering of displayed values. Integration would also need a rule for resetting context when the product, user or variables change. This sequential experiment cannot establish the correctness of those concurrency and lifetime decisions.

Even this state cannot authorize an order. Purchase eligibility needs a separate server contract, such as revalidation or reservation. The design here concerns what the screen tells the user.

## Checking the JSON was not enough to check the screen

The observer reads the actual component DOM in `useLayoutEffect`, after commit. It cross-checks hook values, product-card quantities and status, error text, promise outcomes, memory cache and HTTP response bodies captured by both browser and server. Following [React's distinction between render and commit](https://react.dev/learn/render-and-commit), these observations are not render counts. Adjacent identical DOM snapshots are omitted; total commits and paints are not measured either.

The initial checker had a gap: a correct diagnostic JSON block inside the DOM could pass even if a product card displayed the wrong number. The strengthened check separately compares the cards and status table. Copies that replace `3` with `999` in either location must be rejected. Having the correct value somewhere in the record was different from showing it correctly where a user reads it.

The experiment uses Apollo Client 4.3.3, a React 19.3.1 production build, a continuously mounted component without StrictMode, fixed query variables and a memory cache. A `reobserve` phase closes after its non-loading DOM condition and one timer turn. That is not a claim that all asynchronous work has settled.

Remounting, StrictMode, Suspense, SSR, variable changes, persistent caches, transport errors and concurrent requests are outside this result. This is a personal experiment with synthetic inputs and real HTTP, not a reproduction of an employer's system or incident.

Caching kept the screen useful. To say a value had been checked again, the screen needed more than a readable value: it also needed **the outcome of the attempt to check it**.

## Run it and read the record

[Compare the recorded results in English or Korean](https://minjae-lee-kr.github.io/research/react-recheck/?lang=en). Switch between two policies and three steps. This reader displays saved observations; it does not rerun the experiment in your browser.

The public capture was newly run at source `888784efaf8869c09834459eb7889f79b17014a9`. The [original JSON](https://minjae-lee-kr.github.io/research/react-recheck/recording.json) has SHA-256 `a39a4881cd04a400795aae3ad4f5291146813ef6902d3c58e55bd82e7fc0863e`. Sources and bundle were unchanged across the run; the consistency audit and ten mutation controls passed. Of 133 tracked files, 127 matched Git blobs byte for byte; six documentation/configuration files differed only by CRLF/LF line endings. Hashes establish byte consistency, not who performed the execution.

The [run guide](../experiments/react-recheck/README.md) covers installing the pinned dependencies and starting the local observation server. In a real browser, run the healthy lookup, failed lookup and cache read for each policy, then save a new record. New executions do not overwrite earlier observations.

Start with the failed HTTP response, then compare `data`, `previousData`, `error.data` and the actual product card. Finally, check that the last step sent zero requests. That separates the observation that an error disappeared from the claim that a server lookup succeeded.

## References

- [Apollo ObservableQuery](https://www.apollographql.com/docs/react/api/core/ObservableQuery): API distinctions between subscriptions and promise-returning methods.
- [React render and commit](https://react.dev/learn/render-and-commit): distinguishes DOM observation from rendering and painting.
- [Earlier client.query experiment](client-cache.md): promise and cache comparisons without React.

The official docs are the current versions at consultation time. The table reports the pinned version under these execution conditions; it is not a specification for every Apollo configuration.
