import { test } from "node:test";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { validateOperation, validateReport } from "./contract.mjs";
const query =
  "query CatalogCards($skus: [ID!]!) { products(skus: $skus) { sku __typename } }";
const operation = () => ({
  query,
  operationName: "CatalogCards",
  variables: { skus: ["demo-notebook", "demo-lamp", "demo-ceramic"] },
});
const report = () => ({
  kind: "react-useQuery-dom-observation",
  schema: 1,
  sessionId: "test",
  faults: [],
  cases: [
    {
      caseId: "case-1",
      errorPolicy: "none",
      steps: ["warm", "failed", "cache-first"].map((label) => ({ label })),
      requests: [{}, {}],
      domObservations: [{}],
      cleanup: { rootUnmounted: true, clientStopped: true },
    },
  ],
});
test("fixed operation permits formatting but not a different selection", () => {
  const b = operation();
  b.query =
    "query CatalogCards($skus:[ID!]!){products(skus:$skus){sku __typename}}";
  validateOperation(b, query);
  b.query = b.query.replace("{sku __typename}", "{sku name __typename}");
  assert.throws(() => validateOperation(b, query));
});
test("rejects malformed bodies, changed variables and request extensions", () => {
  for (const b of [
    null,
    [],
    {},
    { ...operation(), variables: { skus: ["private"] } },
    { ...operation(), extensions: {} },
  ])
    assert.throws(() => validateOperation(b, query));
});
test("completed observation is accepted, unfinished cleanup and duplicate case rejected", () => {
  validateReport(report(), "test");
  for (const change of [
    (r) => r.cases[0].steps.pop(),
    (r) => (r.cases[0].cleanup = null),
    (r) => r.cases.push(r.cases[0]),
    (r) => (r.sessionId = "other"),
  ]) {
    const r = report();
    change(r);
    assert.throws(() => validateReport(r, "test"));
  }
});
test("nested secret fields and excessive observations are rejected", () => {
  const a = report();
  a.cases[0].sessionToken = "not-a-real-token";
  assert.throws(() => validateReport(a, "test"));
  const b = report();
  b.cases[0].domObservations = Array(49).fill({});
  assert.throws(() => validateReport(b, "test"));
});

test("actual Apollo request includes injected typename without broadening selections", async () => {
  const source = await readFile(
    new URL("../../operations/CatalogCards.graphql", import.meta.url),
    "utf8",
  );
  const body = JSON.parse(
    await readFile(
      new URL("./fixtures/apollo-request.json", import.meta.url),
      "utf8",
    ),
  );
  validateOperation(body, source);
  for (const query of [
    body.query.replace("quantity", "quantity price"),
    body.query.replace("quantity", ""),
    body.query.replace(
      "products(skus: $skus)",
      "products(skus: $skus) @skip(if: true)",
    ),
  ])
    assert.throws(() => validateOperation({ ...body, query }, source));
});
