import assert from "node:assert/strict";
import { parse, print } from "graphql";
import { addTypenameToDocument } from "@apollo/client/utilities";
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
export function validateOperation(body, querySource) {
  assert.ok(object(body), "Request must be an object");
  const keys = ["operationName", "query", "variables"];
  if ("extensions" in body) {
    keys.push("extensions");
    assert.deepEqual(body.extensions, {
      clientLibrary: { name: "@apollo/client", version: "4.3.3" },
    });
  }
  assert.deepEqual(Object.keys(body).sort(), keys.sort());
  assert.equal(body.operationName, "CatalogCards");
  assert.equal(typeof body.query, "string");
  assert.equal(
    print(parse(body.query)),
    print(addTypenameToDocument(parse(querySource))),
    "Fixed query required",
  );
  assert.deepEqual(body.variables, {
    skus: ["demo-notebook", "demo-lamp", "demo-ceramic"],
  });
}
export function validateReport(report, sessionId) {
  assert.ok(object(report), "Report must be an object");
  assert.equal(report.kind, "react-useQuery-dom-observation");
  assert.equal(report.schema, 1);
  assert.equal(report.sessionId, sessionId);
  assert.ok(
    Array.isArray(report.cases) &&
      report.cases.length > 0 &&
      report.cases.length <= 4,
  );
  assert.ok(Array.isArray(report.faults) && report.faults.length <= 32);
  const ids = new Set();
  for (const c of report.cases) {
    assert.ok(object(c) && /^case-[1-4]$/.test(c.caseId));
    assert.ok(!ids.has(c.caseId), "Duplicate case");
    ids.add(c.caseId);
    assert.ok(["all", "none"].includes(c.errorPolicy));
    assert.deepEqual(
      c.steps?.map((s) => s.label),
      ["warm", "failed", "cache-first"],
      "Only completed cases are saved",
    );
    assert.equal(c.requests?.length, 2);
    assert.ok(
      Array.isArray(c.domObservations) &&
        c.domObservations.length > 0 &&
        c.domObservations.length <= 48,
    );
    assert.equal(c.cleanup?.rootUnmounted, true);
    assert.equal(c.cleanup?.clientStopped, true);
  }
  // The endpoint stores same-origin observations, not authenticated telemetry.
  // Never accept credentials as part of a record, including nested fields.
  const rejectSecrets = (value) => {
    if (!object(value) && !Array.isArray(value)) return;
    for (const [key, child] of Object.entries(value)) {
      assert.ok(
        !/token|authorization|cookie|password/i.test(key),
        "Secrets are not recording fields",
      );
      rejectSecrets(child);
    }
  };
  rejectSecrets(report);
}
