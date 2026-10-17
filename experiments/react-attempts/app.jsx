import React, { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import {
  ApolloClient,
  HttpLink,
  InMemoryCache,
  gql,
} from "@apollo/client/core";
import { ApolloProvider, useQuery } from "@apollo/client/react";
import {
  scopes,
  scenarios,
  modes,
  querySource,
  createState,
  enter,
  begin,
  settle,
} from "./model.mjs";
const query = gql(querySource),
  copy = (x) => JSON.parse(JSON.stringify(x ?? null)),
  cases = [],
  faults = [],
  lifetime = new AbortController();
let config,
  active,
  root,
  busy = false;
const $ = (id) => document.getElementById(id),
  sha = async (text) =>
    [
      ...new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
      ),
    ]
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("");
const errorValue = (e) => (e ? { name: e.name, message: e.message } : null);
function fault(e) {
  if (faults.length < 32) faults.push(errorValue(e));
  $("status").textContent = "Stopped: " + e.message;
}
window.addEventListener("error", (e) => fault(e.error ?? Error(e.message)));
window.addEventListener("unhandledrejection", (e) => fault(e.reason));
async function post(path, body) {
  const r = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-lab-session": config.token,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(18000)]),
  });
  if (!r.ok) throw Error(await r.text());
  return r.json();
}
function bounded(p, label) {
  let timer;
  return Promise.race([
    p,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error(label + " deadline")), 10000);
    }),
  ]).finally(() => clearTimeout(timer));
}
function View({ runtime }) {
  const current = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot);
  const result = useQuery(query, {
    variables: current.scope,
    fetchPolicy: "cache-only",
    returnPartialData: false,
    notifyOnNetworkStatusChange: true,
  });
  const ref = useRef();
  const hook = {
    data: copy(result.data),
    error: errorValue(result.error),
    loading: result.loading,
    networkStatus: result.networkStatus,
    dataState: result.dataState,
  };
  const state = copy(current);
  useLayoutEffect(() => {
    const dom = {
      html: ref.current.innerHTML,
      textContent: ref.current.textContent,
    };
    const obs = {
      sequence: runtime.record.domObservations.length + 1,
      state,
      hook,
      dom,
    };
    if (runtime.record.domObservations.length >= 100) throw Error("DOM budget");
    runtime.record.domObservations.push(obs);
    runtime.latest = obs;
    runtime.notify?.();
  });
  return (
    <section ref={ref} aria-label="Observed component">
      <h2>
        {runtime.record.scenario} · {runtime.record.mode}
      </h2>
      <dl>
        <dt>scope</dt>
        <dd>
          {state.scope.sku} / {state.scope.warehouse}
        </dd>
        <dt>epoch</dt>
        <dd>{state.epoch}</dd>
        <dt>quantity</dt>
        <dd>{hook.data?.product?.quantity ?? "unavailable"}</dd>
        <dt>attempt</dt>
        <dd>{state.attempt.status}</dd>
        <dt>hook error</dt>
        <dd>{hook.error?.message ?? "none"}</dd>
      </dl>
      <pre>{JSON.stringify({ state, hook }, null, 2)}</pre>
    </section>
  );
}
function publish(r, state) {
  r.state = state;
  for (const listener of r.listeners) listener();
}
async function awaitDOM(r) {
  let done;
  const ready = new Promise((resolve) => (done = resolve));
  r.notify = () => {
    const o = r.latest,
      expected = copy(r.client.readQuery({ query, variables: r.state.scope }));
    if (
      o &&
      JSON.stringify(o.state) === JSON.stringify(r.state) &&
      JSON.stringify(o.hook.data) === JSON.stringify(expected)
    )
      done();
  };
  r.notify();
  await bounded(ready, "DOM/store/cache agreement");
  r.notify = null;
}
const event = (r, type, details = {}) =>
  r.record.events.push({
    sequence: r.record.events.length + 1,
    type,
    ...details,
  });
async function snapshot(r, label) {
  await awaitDOM(r);
  event(r, "snapshot", { label });
  r.record.steps.push({
    label,
    scope: copy(r.state.scope),
    epoch: r.state.epoch,
    attempt: copy(r.state.attempt),
    hook: copy(r.latest.hook),
    dom: copy(r.latest.dom),
    cache: copy(r.client.cache.extract()),
    decisions: copy(r.record.decisions),
  });
}
function attempt(r, slot) {
  const b = begin(r.state);
  publish(r, b.state);
  const token = { ...b.token, slot };
  event(r, "attempt-start", { slot, token: copy(token) });
  r.currentSlot = slot;
  const promise = r.client
    .query({
      query,
      variables: token.scope,
      fetchPolicy:
        r.record.mode === "status-only" ? "network-only" : "no-cache",
      errorPolicy: "none",
      context: { headers: { "x-attempt-slot": slot } },
    })
    .then(
      (result) => ({ status: "succeeded", data: copy(result.data) }),
      (error) => ({ status: "failed", message: error.message }),
    )
    .then((outcome) => {
      const decision = settle(
        r.state,
        token,
        outcome,
        r.record.mode === "guarded-write"
          ? (data) =>
              r.client.writeQuery({ query, variables: token.scope, data })
          : undefined,
      );
      publish(r, decision.state);
      event(r, "decision", {
        slot,
        accepted: decision.accepted,
        outcome: decision.outcome,
      });
      r.record.decisions.push({
        token,
        accepted: decision.accepted,
        outcome: decision.outcome,
        cacheWrite: decision.cacheWrite,
        promise: copy(outcome),
      });
      return decision;
    });
  return { token, promise };
}
async function arrive(r, slot) {
  await post("/await", { caseId: r.record.caseId, slot });
}
async function release(r, task) {
  const slot = task.token.slot;
  event(r, "release-request", { slot });
  await post("/release", { caseId: r.record.caseId, slot });
  event(r, "release-ack", { slot });
  r.record.releaseOrder.push(slot);
  await bounded(task.promise, "query settlement");
}
async function navigate(r, scope, label) {
  publish(r, enter(r.state, scope));
  await snapshot(r, label);
}
async function runCase(scenario, mode) {
  const record = {
    caseId: `${scenario}-${mode}`,
    scenario,
    mode,
    steps: [],
    requests: [],
    decisions: [],
    domObservations: [],
    releaseOrder: [],
    events: [],
    cleanup: null,
  };
  cases.push(record);
  const r = {
    record,
    state: createState(),
    latest: null,
    listeners: new Set(),
  };
  r.subscribe = (listener) => {
    r.listeners.add(listener);
    return () => r.listeners.delete(listener);
  };
  r.getSnapshot = () => r.state;
  active = r;
  const observedFetch = async (input, init) => {
    const op = JSON.parse(init.body),
      slot = init.headers["x-attempt-slot"];
    const req = { slot, requestBodyText: init.body, response: null };
    record.requests.push(req);
    event(r, "request-start", { slot });
    const wire = JSON.stringify({ caseId: record.caseId, slot, operation: op });
    req.requestWireText = wire;
    req.requestWireSha256 = await sha(wire);
    const response = await fetch("/graphql", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-lab-session": config.token,
      },
      body: wire,
      signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(18000)]),
    });
    const reader = response.body.getReader(),
      chunks = [];
    let size = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 65536) {
          await reader.cancel();
          throw Error("Response limit");
        }
        chunks.push(part.value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    event(r, "response-read", { slot });
    req.response = {
      status: response.status,
      bodyText: text,
      sha256: await sha(text),
    };
    return new Response(text, {
      status: response.status,
      headers: { "content-type": "application/json" },
    });
  };
  r.client = new ApolloClient({
    cache: new InMemoryCache({
      typePolicies: { Product: { keyFields: ["sku", "warehouse"] } },
    }),
    queryDeduplication: false,
    link: new HttpLink({ uri: "/graphql", fetch: observedFetch }),
  });
  root = createRoot($("root"), {
    onUncaughtError: fault,
    onCaughtError: fault,
    onRecoverableError: fault,
  });
  root.render(
    <ApolloProvider client={r.client}>
      <View runtime={r} />
    </ApolloProvider>,
  );
  const seed = attempt(r, "seed");
  await arrive(r, "seed");
  await release(r, seed);
  await snapshot(r, "seed-success");
  if (scenario === "cache-read") {
    const newer = attempt(r, "new");
    await arrive(r, "new");
    await snapshot(r, "new-pending");
    await release(r, newer);
    await snapshot(r, "new-failed");
    const result = await r.client.query({
      query,
      variables: r.state.scope,
      fetchPolicy: "cache-only",
      errorPolicy: "none",
    });
    record.cacheOnlyRead = {
      data: copy(result.data),
      error: errorValue(result.error),
    };
    await snapshot(r, "cache-only-read");
  } else {
    const old = attempt(r, "old");
    await arrive(r, "old");
    await snapshot(r, "old-pending");
    if (scenario === "product-switch")
      await navigate(r, scopes.b, "scope-changed");
    if (scenario === "variable-switch")
      await navigate(r, scopes.west, "scope-changed");
    if (scenario === "aba") {
      await navigate(r, scopes.b, "scope-b");
      await navigate(r, scopes.a, "scope-a-again");
    }
    const newer = attempt(r, "new");
    await arrive(r, "new");
    await snapshot(r, "new-pending");
    await release(r, newer);
    await snapshot(r, "new-settled");
    await release(r, old);
    await snapshot(r, "old-settled");
  }
  root.unmount();
  r.client.stop();
  root = null;
  record.cleanup = { rootUnmounted: true, clientStopped: true };
  active = null;
}
$("run").onclick = async () => {
  if (busy || cases.length) return;
  busy = true;
  $("run").disabled = true;
  try {
    for (const scenario of scenarios)
      for (const mode of modes) {
        $("status").textContent = `Running ${scenario} / ${mode}`;
        await runCase(scenario, mode);
      }
    const report = {
      kind: "react-attempts-observation",
      schema: 1,
      sessionId: config.sessionId,
      configuration: {
        react: React.version,
        mode: "production",
        strictMode: false,
        queryDeduplication: false,
        observerPolicy: "cache-only",
        querySource,
      },
      userAgent: navigator.userAgent,
      cases,
      faults,
    };
    const saved = await post("/save", report);
    $("status").textContent = `Saved ${saved.file} SHA256 ${saved.sha256}`;
  } catch (error) {
    fault(error);
    try {
      root?.unmount();
      active?.client.stop();
      const saved = await post("/save", {
        kind: "react-attempts-observation",
        schema: 1,
        sessionId: config.sessionId,
        configuration: {
          react: React.version,
          mode: "production",
          strictMode: false,
          queryDeduplication: false,
          observerPolicy: "cache-only",
          querySource,
        },
        userAgent: navigator.userAgent,
        cases,
        faults,
      });
      $("status").textContent += " · partial failure saved " + saved.file;
    } catch (saveError) {
      fault(saveError);
    }
  } finally {
    busy = false;
    $("stop").disabled = false;
  }
};
$("stop").onclick = async () => {
  root?.unmount();
  active?.client.stop();
  await post("/stop", {});
  lifetime.abort();
  $("stop").disabled = true;
};
config = await (await fetch("/config")).json();
$("run").disabled = false;
$("status").textContent = `Ready · source ${config.sourceHead.slice(0, 8)}`;
