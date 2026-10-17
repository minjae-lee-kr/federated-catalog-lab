// Narrow consistency audit for this fixed browser harness. No rerun.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateOperation } from "./contract.mjs";
const fixedQuery = readFileSync(
  new URL("../../operations/CatalogCards.graphql", import.meta.url),
  "utf8",
);
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
export function audit(raw) {
  const results = [];
  const file = "in-memory-record";

  const sha = (value) => createHash("sha256").update(value).digest("hex");
  const escaped = (text) =>
    text
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  const lampText = (data) => {
    if (data === null) return "데이터 없음";
    const availability = data?.products?.find(
      (p) => p?.sku === "demo-lamp",
    )?.availability;
    return availability === null
      ? "null · 확인 불가"
      : (availability?.quantity ?? "데이터 없음");
  };
  assert.equal(raw.kind, "react-useQuery-dom-recording");
  assert.equal(raw.browser.kind, "react-useQuery-dom-observation");
  assert.ok(raw.browser.cases.length > 0 && raw.browser.cases.length <= 4);
  assert.equal(raw.browser.sessionId, raw.sessionId);
  assert.equal(raw.sourceStable, true);
  assert.deepEqual(raw.sourceBefore, raw.sourceAfter);
  assert.equal(raw.sourceBefore.git.dirty, false);
  assert.match(raw.sourceBefore.git.head, /^[0-9a-f]{40}$/);
  assert.equal(
    sha(JSON.stringify(raw.sourceBefore.manifest)),
    raw.sourceBefore.sha256,
  );
  assert.ok(
    raw.sourceBefore.manifest.some(
      (f) => f.path === "experiments/react-recheck/server.mjs",
    ),
  );
  for (const f of raw.sourceBefore.manifest) {
    assert.match(f.sha256, /^[0-9a-f]{64}$/);
    assert.ok(
      !f.path.startsWith("/") &&
        !f.path.includes("..") &&
        !f.path.includes("\\"),
    );
  }
  assert.equal(raw.harnessStable, true);
  assert.deepEqual(raw.harnessBefore, raw.harnessAfter);
  assert.equal(raw.tooling.packages["@apollo/client"], "4.3.3");
  assert.equal(raw.tooling.packages.react, "19.3.1");
  assert.equal(raw.tooling.packages["react-dom"], "19.3.1");
  assert.ok(Array.isArray(raw.browser.faults));
  assert.equal(raw.browser.configuration.strictMode, false);
  assert.equal(raw.browser.configuration.mode, "production");
  assert.equal(raw.browser.configuration.react, "19.3.1");
  assert.deepEqual(
    [...new Set(raw.browser.cases.map((c) => c.errorPolicy))].sort(),
    ["all", "none"],
    "Publication requires both policies",
  );
  const ids = new Set();
  for (const c of raw.browser.cases) {
    assert.ok(!ids.has(c.caseId));
    ids.add(c.caseId);
    assert.ok(["all", "none"].includes(c.errorPolicy));
    assert.equal(c.cleanup.rootUnmounted, true);
    assert.equal(c.cleanup.clientStopped, true);
    assert.deepEqual(
      c.steps.map((s) => s.label),
      ["warm", "failed", "cache-first"],
    );
    assert.deepEqual(
      c.steps.map((s) => s.requestCount),
      [1, 1, 0],
    );
    const server = raw.serverObservedRequests.filter(
      (r) => r.caseId === c.caseId,
    );
    assert.equal(server.length, 2);
    assert.equal(c.requests.length, 2);
    for (let i = 0; i < 2; i++) {
      const a = c.requests[i],
        b = server[i];
      assert.equal(a.phase, i ? "failed" : "warm");
      assert.equal(b.phase, a.phase);
      assert.equal(a.endpoint, i ? "failure" : "healthy");
      assert.equal(b.endpoint, a.endpoint);
      assert.equal(a.requestBodyText, b.requestBodyText);
      validateOperation(JSON.parse(a.requestBodyText), fixedQuery);
      assert.equal(a.response.bodyText, b.response.bodyText);
      assert.equal(a.response.status, 200);
      assert.equal(b.response.status, 200);
      assert.equal(a.response.sha256, sha(a.response.bodyText));
      assert.equal(b.response.sha256, a.response.sha256);
      assert.equal(a.transportError, null);
      assert.equal(b.transportError, undefined);
    }
    const healthy = JSON.parse(c.requests[0].response.bodyText),
      failed = JSON.parse(c.requests[1].response.bodyText);
    assert.equal(healthy.errors, undefined);
    assert.deepEqual(
      healthy.data.products.map((p) => p.sku),
      ["demo-notebook", "demo-lamp", "demo-ceramic"],
    );
    assert.deepEqual(
      failed.data.products.map((p) => p.sku),
      ["demo-notebook", "demo-lamp", "demo-ceramic"],
    );
    assert.equal(healthy.data.products[1].availability.quantity, 3);
    assert.equal(healthy.data.products[1].availability.status, "IN_STOCK");
    assert.equal(failed.data.products[1].availability, null);
    assert.deepEqual(
      failed.errors.map((e) => e.path),
      [["products", 1, "availability"]],
    );
    const [warm, failure, cache] = c.steps;
    const expected = c.errorPolicy === "all" ? failed.data : healthy.data;
    assert.deepEqual(warm.after.latestHook.data, healthy.data);
    assert.deepEqual(failure.after.latestHook.data, expected);
    assert.deepEqual(failure.after.latestHook.error.data, failed.data);
    assert.equal(failure.after.latestHook.networkStatus, 8);
    assert.equal(failure.after.latestHook.dataState, "complete");
    assert.equal(
      failure.after.latestHook.previousDataPresent,
      c.errorPolicy === "all",
    );
    assert.deepEqual(
      failure.after.latestHook.previousData,
      c.errorPolicy === "all" ? healthy.data : null,
    );
    assert.deepEqual(cache.after.latestHook.data, expected);
    assert.equal(cache.after.latestHook.error, null);
    assert.equal(cache.after.latestHook.networkStatus, 7);
    assert.deepEqual(cache.before.cache, cache.after.cache);
    assert.deepEqual(cache.after.readQuery, expected);
    assert.equal(
      failure.settlement.status,
      c.errorPolicy === "all" ? "resolved" : "rejected",
    );
    assert.deepEqual(
      (failure.settlement.result?.error ?? failure.settlement.error).data,
      failed.data,
    );
    assert.equal(cache.settlement.status, "resolved");
    assert.deepEqual(cache.settlement.result.data, expected);
    let previousHTML,
      previousTime = -1;
    for (const observation of c.domObservations) {
      assert.equal(observation.kind, "post-commit-dom-read");
      assert.notEqual(observation.dom.html, previousHTML);
      previousHTML = observation.dom.html;
      const text = JSON.stringify(observation.result, null, 2);
      assert.ok(
        observation.dom.textContent.endsWith(text),
        "Recorded DOM text must contain the exact hook JSON",
      );
      assert.ok(
        observation.dom.html.includes(`<pre>${escaped(text)}</pre>`),
        "Recorded DOM HTML must contain the exact hook JSON",
      );
      assert.equal(
        observation.sequence,
        c.domObservations.indexOf(observation) + 1,
      );
      assert.ok(
        Number.isFinite(observation.observedAtMs) &&
          observation.observedAtMs >= previousTime,
      );
      previousTime = observation.observedAtMs;
      const r = observation.result;
      const definitions = [
        ...observation.dom.html.matchAll(/<dt>([^<]*)<\/dt><dd>([^<]*)<\/dd>/g),
      ].map((m) => [m[1], m[2]]);
      assert.deepEqual(
        definitions,
        [
          ["networkStatus", `${r.networkStatus} · ${r.networkStatusName}`],
          ["loading / dataState", `${r.loading} / ${r.dataState}`],
          ["data의 조명 재고", String(lampText(r.data))],
          ["previousData 재고", String(lampText(r.previousData))],
          [
            "error.data 재고",
            r.error ? String(lampText(r.error.data)) : "오류 없음",
          ],
        ],
        "Visible status definition list must match recorded values",
      );
      const cards = [
        ...observation.dom.html.matchAll(
          /<article class="card"><h3>([^<]*)<\/h3><strong>([^<]*)<\/strong><span class="status">([^<]*)<\/span><\/article>/g,
        ),
      ].map((m) => m.slice(1));
      assert.deepEqual(
        cards,
        (r.data?.products ?? []).map((p) => [
          escaped(p.name),
          p.availability === null
            ? "확인 불가"
            : String(p.availability.quantity),
          p.availability?.status ?? "nullable availability = null",
        ]),
        "Visible product cards must agree with data",
      );
      const errorParagraphs = [
        ...observation.dom.html.matchAll(/<p class="error">([^<]*)<\/p>/g),
      ].map((m) => m[1]);
      assert.deepEqual(
        errorParagraphs,
        r.error ? [escaped("이번 조회 오류: " + r.error.message)] : [],
        "Visible error must agree with error presence",
      );
    }
    for (const step of c.steps) {
      const observations = c.domObservations.filter(
        (d) => d.phase === step.label,
      );
      assert.ok(observations.length > 0);
      assert.deepEqual(observations.at(-1).result, step.after.latestHook);
    }
    results.push({
      policy: c.errorPolicy,
      httpByStep: c.steps.map((s) => s.requestCount),
      observedDistinctDOMStates: c.domObservations.length,
      failedPromise: failure.settlement.status,
      failedDOMDataLamp: failure.after.latestHook.data.products[1].availability,
      failedPreviousDataPresent: failure.after.latestHook.previousDataPresent,
      failedPreviousData: failure.after.latestHook.previousData,
      errorDataLamp:
        failure.after.latestHook.error.data.products[1].availability,
      cacheFirstError: cache.after.latestHook.error,
    });
  }
  assert.equal(
    raw.serverObservedRequests.length,
    raw.browser.cases.reduce((n, c) => n + c.requests.length, 0),
  );
  return {
    kind: "fixed-react-record-consistency-audit",
    record: file,
    sourceHead: raw.sourceBefore.git.head,
    consistencyVerified: true,
    cleanRuntime: raw.browser.faults.length === 0,
    observedFaults: raw.browser.faults,
    results,
    limits:
      "Checks captured server/browser bytes, hook values, actual DOM snapshots and Promise/cache consistency. Not authentication, all commits/paints, or a general React behavior proof.",
  };
}

if (
  process.argv[1] &&
  new URL(import.meta.url).pathname.endsWith(
    process.argv[1].replaceAll("\\", "/").split("/").at(-1),
  )
) {
  const file = process.argv[2];
  assert.match(file ?? "", /^react-[a-f0-9-]+-[1-4]\.json$/);
  const bytes = await readFile(new URL(`records/${file}`, import.meta.url));
  const result = {
    ...audit(JSON.parse(bytes)),
    record: file,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  await writeFile(
    new URL(`records/audit-${file}`, import.meta.url),
    JSON.stringify(result, null, 2) + "\n",
    { flag: "wx" },
  );
  console.log(JSON.stringify(result));
}
