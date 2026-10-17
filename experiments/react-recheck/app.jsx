import React, { useLayoutEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  ApolloClient,
  HttpLink,
  InMemoryCache,
  gql,
  NetworkStatus,
} from "@apollo/client/core";
import { ApolloProvider, useQuery } from "@apollo/client/react";
import { CombinedGraphQLErrors } from "@apollo/client/errors";

const $ = (id) => document.getElementById(id);
const clone = (value) => JSON.parse(JSON.stringify(value ?? null));
const started = performance.now();
const at = () => Math.round((performance.now() - started) * 1000) / 1000;
const variables = { skus: ["demo-notebook", "demo-lamp", "demo-ceramic"] };
const typePolicies = {
  Product: { keyFields: ["sku"] },
  Merchant: { keyFields: ["id"] },
};
const queryOptions = {
  fetchPolicy: "network-only",
  notifyOnNetworkStatusChange: true,
  returnPartialData: false,
  pollInterval: 0,
};
const lifetime = new AbortController();
const cases = [],
  faults = [];
let config,
  query,
  active,
  root,
  busy = false,
  closed = false;
const sha = async (text) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
  ]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
function errorValue(error) {
  if (!error) return null;
  return CombinedGraphQLErrors.is(error)
    ? clone({
        name: error.name,
        message: error.message,
        errors: error.errors,
        dataPresent: error.data !== undefined,
        data: error.data ?? null,
      })
    : { name: error.name ?? "Error", message: error.message ?? String(error) };
}
function resultValue(result) {
  return {
    dataPresent: result.data !== undefined,
    data: clone(result.data),
    previousDataPresent: result.previousData !== undefined,
    previousData: clone(result.previousData),
    error: errorValue(result.error),
    loading: result.loading ?? null,
    networkStatus: result.networkStatus ?? null,
    networkStatusName: NetworkStatus[result.networkStatus] ?? null,
    dataState: result.dataState ?? null,
  };
}
const lamp = (data) =>
  data?.products?.find((p) => p?.sku === "demo-lamp")?.availability;
const lampText = (data) =>
  data === null
    ? "데이터 없음"
    : lamp(data) === null
      ? "null · 확인 불가"
      : (lamp(data)?.quantity ?? "데이터 없음");
function controls() {
  $("policy").disabled = busy || closed;
  $("warm").disabled =
    busy ||
    closed ||
    !config ||
    cases.length >= 4 ||
    (active && active.stage !== "cache-first-done");
  $("fail").disabled = busy || closed || active?.stage !== "warm-done";
  $("cache").disabled = busy || closed || active?.stage !== "failed-done";
  $("save").disabled =
    busy || closed || !cases.length || cases.some((c) => c.steps.length !== 3);
  $("stop").disabled = busy || closed;
}
function fatal(error, channel = "harness", extra = {}) {
  if (faults.length < 32)
    faults.push({
      atMs: at(),
      channel,
      message: String(error?.message ?? error),
      stack:
        typeof error?.stack === "string" ? error.stack.slice(0, 8000) : null,
      ...extra,
    });
  $("action").textContent = `관측 중단: ${error?.message ?? error}`;
}
window.addEventListener("error", (event) =>
  fatal(event.error ?? event.message, "window.error", {
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
  }),
);
window.addEventListener("unhandledrejection", (event) =>
  fatal(event.reason, "unhandledrejection"),
);
async function bounded(promise, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label}: 8000ms deadline`)),
          8000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function bodyText(response, cap = 1_048_576) {
  const reader = response.body.getReader(),
    parts = [];
  let size = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.length;
      if (size > cap) throw new Error("Response exceeds byte limit");
      parts.push(item.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const p of parts) {
    bytes.set(p, offset);
    offset += p.length;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
function recordCommit(runtime, element, result) {
  runtime.latest = result;
  const html = element.innerHTML;
  if (html !== runtime.lastDOM) {
    if (runtime.record.domObservations.length >= 48)
      throw new Error("DOM observation budget exceeded");
    runtime.lastDOM = html;
    const observation = {
      sequence: runtime.record.domObservations.length + 1,
      observedAtMs: at(),
      phase: runtime.phase,
      kind: "post-commit-dom-read",
      dom: { html, textContent: element.textContent },
      result: resultValue(result),
    };
    runtime.record.domObservations.push(observation);
    const li = document.createElement("li");
    li.textContent = `${runtime.record.errorPolicy} · ${runtime.phase} · status ${observation.result.networkStatusName} · data=${lampText(observation.result.data)} · previousData=${lampText(observation.result.previousData)} · error.data=${observation.result.error ? lampText(observation.result.error.data) : "오류 없음"} · ${observation.result.dataState}`;
    $("timeline").append(li);
  }
  for (const waiter of [...runtime.waiters])
    if (waiter.predicate(result)) {
      runtime.waiters.delete(waiter);
      waiter.resolve(result);
    }
}
function QueryView({ runtime }) {
  const result = useQuery(query, {
    variables,
    ...queryOptions,
    errorPolicy: runtime.record.errorPolicy,
  });
  const target = useRef(null);
  useLayoutEffect(() => {
    recordCommit(runtime, target.current, result);
  });
  const value = resultValue(result);
  return (
    <section ref={target} className="panel" aria-label="useQuery 컴포넌트 상태">
      <h2>현재 컴포넌트 · {runtime.record.errorPolicy}</h2>
      <dl>
        <dt>networkStatus</dt>
        <dd>
          {value.networkStatus} · {value.networkStatusName}
        </dd>
        <dt>loading / dataState</dt>
        <dd>
          {String(value.loading)} / {value.dataState}
        </dd>
        <dt>data의 조명 재고</dt>
        <dd>{lampText(value.data)}</dd>
        <dt>previousData 재고</dt>
        <dd>{lampText(value.previousData)}</dd>
        <dt>error.data 재고</dt>
        <dd>{value.error ? lampText(value.error.data) : "오류 없음"}</dd>
      </dl>
      {value.error && (
        <p className="error">이번 조회 오류: {value.error.message}</p>
      )}
      <div className="cards">
        {value.data?.products?.map((p, i) => (
          <article className="card" key={p?.sku ?? i}>
            <h3>{p?.name ?? "상품 없음"}</h3>
            <strong>
              {p?.availability === null
                ? "확인 불가"
                : (p?.availability?.quantity ?? "—")}
            </strong>
            <span className="status">
              {p?.availability?.status ?? "nullable availability = null"}
            </span>
          </article>
        ))}
      </div>
      <details>
        <summary>이 DOM에 연결된 전체 hook 값</summary>
        <pre>{JSON.stringify(value, null, 2)}</pre>
      </details>
    </section>
  );
}
function waitFor(runtime, predicate) {
  if (runtime.latest && predicate(runtime.latest))
    return Promise.resolve(runtime.latest);
  return new Promise((resolve) => runtime.waiters.add({ predicate, resolve }));
}
function snapshot(runtime) {
  return {
    cache: clone(runtime.client.cache.extract()),
    readQuery: clone(runtime.client.cache.readQuery({ query, variables })),
    latestHook: runtime.latest ? resultValue(runtime.latest) : null,
  };
}
function dispose() {
  if (!active) return;
  root?.unmount();
  root = null;
  active.latest?.observable.stop();
  active.client.stop();
  active.abort.abort();
  active.waiters.clear();
  active.record.cleanup = {
    rootUnmounted: true,
    clientStopped: true,
    atMs: at(),
  };
  active = null;
}
async function warm() {
  dispose();
  const record = {
    caseId: `case-${cases.length + 1}`,
    errorPolicy: $("policy").value,
    options: queryOptions,
    steps: [],
    requests: [],
    domObservations: [],
    cleanup: null,
  };
  cases.push(record);
  const runtime = {
    record,
    phase: "warm",
    endpoint: "healthy",
    stage: "warming",
    latest: null,
    lastDOM: null,
    waiters: new Set(),
    abort: new AbortController(),
  };
  const observedFetch = async (input, init) => {
    const expected = `/graphql/${runtime.endpoint}`;
    if (
      input !== expected ||
      init.method !== "POST" ||
      typeof init.body !== "string" ||
      init.body.length > 65536 ||
      record.requests.length >= 3
    )
      throw new Error("Fixed request contract violated");
    const request = {
      sequence: record.requests.length + 1,
      phase: runtime.phase,
      endpoint: runtime.endpoint,
      requestBodyText: init.body,
      startedAtMs: at(),
      response: null,
      transportError: null,
    };
    record.requests.push(request);
    try {
      const response = await fetch(expected, {
        ...init,
        headers: {
          ...init.headers,
          "x-lab-session": config.sessionToken,
          "x-lab-case": record.caseId,
          "x-lab-phase": runtime.phase,
        },
        redirect: "error",
        signal: AbortSignal.any([
          runtime.abort.signal,
          lifetime.signal,
          AbortSignal.timeout(5000),
          ...(init.signal ? [init.signal] : []),
        ]),
      });
      const text = await bodyText(response);
      request.response = {
        status: response.status,
        bodyText: text,
        sha256: await sha(text),
      };
      return new Response(text, {
        status: response.status,
        headers: { "content-type": response.headers.get("content-type") ?? "" },
      });
    } catch (error) {
      request.transportError = errorValue(error);
      throw error;
    } finally {
      request.completedAtMs = at();
    }
  };
  runtime.client = new ApolloClient({
    cache: new InMemoryCache({ typePolicies }),
    link: new HttpLink({
      uri: () => `/graphql/${runtime.endpoint}`,
      fetch: observedFetch,
    }),
  });
  active = runtime;
  const before = snapshot(runtime);
  root = createRoot($("root"), {
    onUncaughtError: (e) => fatal(e, "react.onUncaughtError"),
    onCaughtError: (e) => fatal(e, "react.onCaughtError"),
    onRecoverableError: (e) => fatal(e, "react.onRecoverableError"),
  });
  root.render(
    <ApolloProvider client={runtime.client}>
      <QueryView runtime={runtime} />
    </ApolloProvider>,
  );
  await bounded(
    waitFor(runtime, (r) => !r.loading),
    "warm DOM",
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  record.steps.push({
    label: "warm",
    before,
    after: snapshot(runtime),
    completionSurface:
      "first non-loading hook result read from committed DOM; no query Promise",
    requestCount: record.requests.length,
  });
  runtime.stage = "warm-done";
}
async function reobserve(label) {
  const runtime = active;
  runtime.phase = label;
  runtime.endpoint = "failure";
  const before = snapshot(runtime),
    firstRequest = runtime.record.requests.length,
    firstDOM = runtime.record.domObservations.length;
  let settlement;
  try {
    const value = await bounded(
      runtime.latest.observable.reobserve({
        fetchPolicy: label === "failed" ? "network-only" : "cache-first",
      }),
      label + " ResultPromise",
    );
    settlement = { status: "resolved", result: resultValue(value) };
  } catch (error) {
    settlement = { status: "rejected", error: errorValue(error) };
  }
  $("promise").textContent = JSON.stringify({ label, ...settlement }, null, 2);
  await bounded(
    waitFor(
      runtime,
      (r) => !r.loading && (label === "failed" ? Boolean(r.error) : !r.error),
    ),
    label + " DOM",
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  runtime.record.steps.push({
    label,
    fetchPolicy: label === "failed" ? "network-only" : "cache-first",
    before,
    after: snapshot(runtime),
    settlement,
    requestCount: runtime.record.requests.length - firstRequest,
    domSequences: runtime.record.domObservations
      .slice(firstDOM)
      .map((x) => x.sequence),
  });
  runtime.stage = label + "-done";
}
async function action(label, fn) {
  if (busy || closed) return;
  busy = true;
  controls();
  $("action").textContent = label + "…";
  try {
    await fn();
    $("action").textContent = label + " 완료";
  } catch (error) {
    if (active) active.stage = "failed-harness";
    fatal(error);
  } finally {
    busy = false;
    controls();
  }
}
$("warm").onclick = () => action("정상 조회", warm);
$("fail").onclick = () => action("실패 서버 조회", () => reobserve("failed"));
$("cache").onclick = () =>
  action("cache-first 재평가", () => reobserve("cache-first"));
$("save").onclick = () =>
  action("로컬 기록 저장", async () => {
    dispose();
    const report = {
      kind: "react-useQuery-dom-observation",
      schema: 1,
      generatedAt: new Date().toISOString(),
      sessionId: config.sessionId,
      browser: { userAgent: navigator.userAgent },
      configuration: {
        react: React.version,
        mode: "production",
        strictMode: false,
        querySource: config.querySource,
        variables,
        typePolicies,
        queryOptions,
      },
      cases,
      faults,
      method:
        "Read component innerHTML/textContent in useLayoutEffect after commit; adjacent identical DOM omitted. Not render/commit/paint counts. Phase closes after non-loading DOM and one timer turn, not global quiescence.",
    };
    const response = await fetch("/save", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-lab-session": config.sessionToken,
      },
      body: JSON.stringify(report),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(await response.text());
    const saved = await response.json();
    $("provenance").textContent +=
      ` · 저장: ${saved.file} · SHA ${saved.sha256}`;
  });
$("stop").onclick = () =>
  action("소유 서버 종료", async () => {
    dispose();
    lifetime.abort();
    const r = await fetch("/shutdown", {
      method: "POST",
      headers: { "x-lab-session": config.sessionToken },
    });
    if (!r.ok) throw new Error("Shutdown rejected");
    closed = true;
  });
window.addEventListener("pagehide", () => {
  dispose();
  lifetime.abort();
});
try {
  const response = await fetch("/config", {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("Config unavailable");
  config = await response.json();
  query = gql(config.querySource);
  $("provenance").textContent =
    `React ${React.version} · Apollo ${config.packages["@apollo/client"]} · source ${config.sourceHead.slice(0, 8)} · session ${config.sessionId}`;
  $("action").textContent =
    "정책을 고르고 1 → 2 → 3 순서로 실행하세요. 저장 후 다른 정책을 시작할 수 있습니다.";
  controls();
} catch (error) {
  fatal(error);
}
