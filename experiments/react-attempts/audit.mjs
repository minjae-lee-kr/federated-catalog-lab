import { validateOperation } from "./contract.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parse, print } from "graphql";
import {
  scenarios,
  modes,
  querySource,
  slotSpec,
  scopes,
  key,
} from "./model.mjs";
const sha = (b) => createHash("sha256").update(b).digest("hex"),
  escape = (s) =>
    s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
export const quantity = (cache, scope) =>
  Object.values(cache).find(
    (v) =>
      v?.__typename === "Product" &&
      v.sku === scope.sku &&
      v.warehouse === scope.warehouse,
  )?.quantity ?? null;
function checkDOM(dom, state, hook) {
  const expected = [
    ["scope", state.scope.sku + " / " + state.scope.warehouse],
    ["epoch", String(state.epoch)],
    ["quantity", String(hook.data?.product?.quantity ?? "unavailable")],
    ["attempt", state.attempt.status],
    ["hook error", hook.error?.message ?? "none"],
  ];
  assert.deepEqual(
    [...dom.html.matchAll(/<dt>([^<]*)<\/dt><dd>([^<]*)<\/dd>/g)].map((m) =>
      m.slice(1),
    ),
    expected,
  );
  const json = JSON.stringify({ state, hook }, null, 2);
  assert.ok(dom.html.includes("<pre>" + escape(json) + "</pre>"));
  assert.ok(dom.textContent.endsWith(json));
}
export function audit(raw) {
  assert.equal(raw.kind, "react-attempts-recording");
  assert.equal(raw.schema, 1);
  assert.equal(raw.sourceStable, true);
  assert.equal(raw.harnessStable, true);
  assert.deepEqual(raw.sourceBefore, raw.sourceAfter);
  assert.deepEqual(raw.harnessBefore, raw.harnessAfter);
  assert.equal(raw.sourceBefore.git.dirty, false);
  assert.match(raw.sourceBefore.git.head, /^[0-9a-f]{40}$/);
  assert.equal(
    sha(JSON.stringify(raw.sourceBefore.manifest)),
    raw.sourceBefore.sha256,
  );
  assert.equal(raw.browser.kind, "react-attempts-observation");
  assert.equal(raw.browser.sessionId, raw.sessionId);
  assert.equal(raw.browser.configuration.strictMode, false);
  assert.equal(raw.browser.configuration.queryDeduplication, false);
  assert.equal(raw.browser.configuration.observerPolicy, "cache-only");
  assert.equal(raw.browser.configuration.react, "19.3.1");
  assert.equal(raw.tooling.apollo, "4.3.3");
  assert.deepEqual(raw.browser.faults, []);
  assert.equal(raw.browser.cases.length, 10);
  const identities = new Set(),
    results = [];
  for (const c of raw.browser.cases) {
    assert.ok(scenarios.includes(c.scenario) && modes.includes(c.mode));
    assert.equal(c.caseId, c.scenario + "-" + c.mode);
    assert.ok(!identities.has(c.caseId));
    identities.add(c.caseId);
    assert.deepEqual(c.cleanup, { rootUnmounted: true, clientStopped: true });
    const labels =
      c.scenario === "cache-read"
        ? ["seed-success", "new-pending", "new-failed", "cache-only-read"]
        : [
            "seed-success",
            "old-pending",
            ...(c.scenario === "aba"
              ? ["scope-b", "scope-a-again"]
              : ["product-switch", "variable-switch"].includes(c.scenario)
                ? ["scope-changed"]
                : []),
            "new-pending",
            "new-settled",
            "old-settled",
          ];
    assert.deepEqual(
      c.steps.map((s) => s.label),
      labels,
    );
    assert.equal(c.steps[0].attempt.status, "succeeded");
    assert.equal(c.steps[0].hook.data.product.quantity, 3);
    const slots =
      c.scenario === "cache-read" ? ["seed", "new"] : ["seed", "old", "new"];
    assert.deepEqual(
      c.requests.map((r) => r.slot),
      slots,
    );
    assert.deepEqual(
      c.releaseOrder,
      c.scenario === "cache-read" ? ["seed", "new"] : ["seed", "new", "old"],
    );
    assert.deepEqual(
      raw.releases.filter((r) => r.caseId === c.caseId).map((r) => r.slot),
      c.releaseOrder,
    );
    const server = raw.serverObservedRequests.filter(
      (r) => r.caseId === c.caseId,
    );
    assert.equal(server.length, slots.length);
    for (const r of c.requests) {
      const s = server.find((s) => s.slot === r.slot),
        spec = slotSpec(c.scenario, r.slot);
      assert.ok(s);
      assert.equal(r.requestBodyText, s.requestBodyText);
      assert.equal(r.requestWireText, s.requestWireText);
      assert.equal(sha(r.requestWireText), r.requestWireSha256);
      assert.equal(r.requestWireSha256, s.requestWireSha256);
      const wire = JSON.parse(r.requestWireText);
      assert.equal(wire.caseId, c.caseId);
      assert.equal(wire.slot, r.slot);
      assert.deepEqual(wire.operation, JSON.parse(r.requestBodyText));
      const request = JSON.parse(r.requestBodyText);
      validateOperation(request, spec.scope);
      assert.equal(request.operationName, "Stock");
      assert.equal(print(parse(request.query)), print(parse(querySource)));
      assert.deepEqual(request.variables, spec.scope);
      assert.deepEqual(r.response, s.response);
      assert.equal(r.response.status, 200);
      assert.equal(sha(r.response.bodyText), r.response.sha256);
      const body = JSON.parse(r.response.bodyText);
      if (spec.fail) {
        assert.equal(body.data.product, null);
        assert.deepEqual(
          body.errors.map((e) => e.path),
          [["product"]],
        );
      } else {
        assert.equal(body.errors, undefined);
        assert.deepEqual(body.data.product, {
          ...spec.scope,
          quantity: spec.quantity,
          __typename: "Product",
        });
      }
    }
    for (const d of c.domObservations) {
      checkDOM(d.dom, d.state, d.hook);
    }
    for (const step of c.steps) {
      const observation = c.domObservations.findLast(
        (o) =>
          o.dom.html === step.dom.html &&
          o.state.epoch === step.epoch &&
          JSON.stringify(o.state.attempt) === JSON.stringify(step.attempt),
      );
      assert.ok(observation, "Step must refer to actual observed DOM");
      assert.deepEqual(observation.hook, step.hook);
      const expected = quantity(step.cache, step.scope);
      assert.equal(step.hook.data?.product?.quantity ?? null, expected);
      if (step.hook.data)
        assert.deepEqual(
          {
            sku: step.hook.data.product.sku,
            warehouse: step.hook.data.product.warehouse,
          },
          step.scope,
        );
    }
    assert.deepEqual(
      c.events.map((e) => e.sequence),
      c.events.map((_, i) => i + 1),
    );
    for (const slot of slots) {
      const types = [
        "attempt-start",
        "request-start",
        "release-request",
        "response-read",
        "decision",
      ];
      const positions = types.map((type) =>
        c.events.findIndex((e) => e.type === type && e.slot === slot),
      );
      assert.ok(positions.every((i) => i >= 0));
      for (let i = 1; i < positions.length; i++)
        assert.ok(
          positions[i] > positions[i - 1],
          "Causal attempt/release/response/decision order",
        );
    }
    const eventAt = (type, field, value) =>
      c.events.findIndex((e) => e.type === type && e[field] === value);
    assert.ok(
      eventAt("decision", "slot", "new") <
        eventAt(
          "snapshot",
          "label",
          c.scenario === "cache-read" ? "new-failed" : "new-settled",
        ),
    );
    if (c.scenario !== "cache-read") {
      assert.ok(
        eventAt("snapshot", "label", "new-settled") <
          eventAt("release-request", "slot", "old"),
      );
      assert.ok(
        eventAt("decision", "slot", "old") <
          eventAt("snapshot", "label", "old-settled"),
      );
    }
    const end = c.steps.at(-1),
      old = c.decisions.find((d) => d.token.slot === "old"),
      newer = c.decisions.find((d) => d.token.slot === "new");
    assert.ok(newer.accepted);
    assert.equal(
      newer.cacheWrite,
      c.mode === "guarded-write" && newer.outcome === "succeeded",
    );
    if (old) {
      assert.equal(old.accepted, false);
      assert.equal(old.cacheWrite, false);
      assert.equal(old.promise.status, "succeeded");
    }
    if (c.scenario === "cache-read") {
      assert.equal(end.attempt.status, "failed");
      assert.equal(end.hook.error, null);
      assert.equal(end.hook.data.product.quantity, 3);
      assert.equal(c.cacheOnlyRead.data.product.quantity, 3);
      assert.equal(c.requests.length, 2);
      assert.equal(c.steps.at(-2).attempt.status, "failed");
    } else if (c.scenario === "late-success") {
      assert.equal(end.attempt.status, "failed");
      assert.equal(
        end.hook.data.product.quantity,
        c.mode === "status-only" ? 7 : 3,
      );
    } else if (c.scenario === "aba") {
      assert.equal(end.epoch, 3);
      assert.deepEqual(end.scope, scopes.a);
      assert.equal(end.attempt.status, "succeeded");
      assert.equal(
        end.hook.data.product.quantity,
        c.mode === "status-only" ? 7 : 9,
      );
    } else {
      assert.equal(end.epoch, 2);
      assert.deepEqual(
        end.scope,
        c.scenario === "product-switch" ? scopes.b : scopes.west,
      );
      assert.equal(end.hook.data.product.quantity, 12);
      assert.equal(
        quantity(end.cache, scopes.a),
        c.mode === "status-only" ? 7 : 3,
      );
    }
    assert.deepEqual(
      c.decisions.map((d) => d.token.slot),
      c.releaseOrder,
    );
    for (const d of c.decisions) {
      const slot = d.token.slot,
        spec = slotSpec(c.scenario, slot),
        epoch =
          slot === "new"
            ? c.scenario === "aba"
              ? 3
              : ["product-switch", "variable-switch"].includes(c.scenario)
                ? 2
                : 1
            : 1,
        id =
          slot === "seed"
            ? 1
            : slot === "old"
              ? 2
              : c.scenario === "cache-read"
                ? 2
                : 3;
      assert.deepEqual(d.token, { scope: spec.scope, epoch, id, slot });
      assert.equal(d.accepted, slot !== "old");
      assert.equal(
        d.cacheWrite,
        c.mode === "guarded-write" && slot !== "old" && !spec.fail,
      );
      assert.equal(d.outcome, spec.fail ? "failed" : "succeeded");
      assert.equal(d.promise.status, spec.fail ? "failed" : "succeeded");
      if (!spec.fail)
        assert.deepEqual(d.promise.data, {
          product: {
            ...spec.scope,
            quantity: spec.quantity,
            __typename: "Product",
          },
        });
    }
    assert.equal(end.attempt.id, c.scenario === "cache-read" ? 2 : 3);
    assert.equal(c.decisions.length, slots.length);
    results.push({
      caseId: c.caseId,
      quantity: end.hook.data.product.quantity,
      attempt: end.attempt.status,
      originalScopeCache: quantity(end.cache, scopes.a),
      requests: c.requests.length,
    });
  }
  assert.equal(raw.serverObservedRequests.length, 28);
  assert.equal(raw.releases.length, 28);
  return {
    kind: "react-attempts-consistency-audit",
    verified: true,
    sourceHead: raw.sourceBefore.git.head,
    results,
    limits:
      "One fixed release schedule per case. Captured bytes and DOM consistency, not telemetry authentication, server-version freshness, cancellation or cache-write rollback.",
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const file = process.argv[2];
  assert.match(file ?? "", /^attempts-[a-f0-9-]+-[12]\.json$/);
  const bytes = await readFile(new URL("records/" + file, import.meta.url));
  const result = {
    ...audit(JSON.parse(bytes)),
    record: file,
    sha256: sha(bytes),
  };
  await writeFile(
    new URL("records/audit-" + file, import.meta.url),
    JSON.stringify(result, null, 2) + "\n",
    { flag: "wx" },
  );
  console.log(JSON.stringify(result));
}
