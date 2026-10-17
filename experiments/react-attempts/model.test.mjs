import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createState,
  enter,
  begin,
  settle,
  scopes,
  accepts,
  key,
  slotSpec,
} from "./model.mjs";
test("scope and variable changes invalidate before another attempt", () => {
  const b = begin(createState());
  assert.equal(accepts(enter(b.state, scopes.b), b.token), false);
  assert.equal(accepts(enter(b.state, scopes.west), b.token), false);
  assert.notEqual(key(scopes.a), key(scopes.west));
});
test("ABA never reuses an epoch; newer failure rejects older success", () => {
  const old = begin(createState());
  const aba = enter(enter(old.state, scopes.b), scopes.a);
  assert.equal(accepts(aba, old.token), false);
  const fresh = begin(old.state);
  const failed = settle(fresh.state, fresh.token, { status: "failed" });
  let writes = 0;
  const late = settle(
    failed.state,
    old.token,
    { status: "succeeded" },
    () => writes++,
  );
  assert.equal(late.accepted, false);
  assert.equal(writes, 0);
  assert.equal(late.state.attempt.status, "failed");
});
test("write completes before succeeded; a throwing write becomes failure", () => {
  const b = begin(createState());
  let writes = 0;
  const ok = settle(b.state, b.token, { status: "succeeded", data: 3 }, (d) => {
    assert.equal(b.state.attempt.status, "pending");
    assert.equal(d, 3);
    writes++;
  });
  assert.equal(ok.state.attempt.status, "succeeded");
  assert.equal(writes, 1);
  const fail = settle(b.state, b.token, { status: "succeeded" }, () => {
    throw Error("synthetic");
  });
  assert.equal(fail.state.attempt.status, "failed");
  assert.equal(fail.cacheWrite, false);
});
test("fixed slots reject extra scenarios and requests", () => {
  assert.throws(() => slotSpec("unknown", "new"));
  assert.throws(() => slotSpec("cache-read", "old"));
  assert.equal(slotSpec("variable-switch", "new").scope.warehouse, "west");
});

test("a settled token cannot settle again", () => {
  const b = begin(createState());
  const failed = settle(b.state, b.token, { status: "failed" });
  let writes = 0;
  const duplicate = settle(
    failed.state,
    b.token,
    { status: "succeeded" },
    () => writes++,
  );
  assert.equal(duplicate.accepted, false);
  assert.equal(writes, 0);
  assert.equal(duplicate.state.attempt.status, "failed");
});

import { validateOperation } from "./contract.mjs";
import { querySource } from "./model.mjs";
test("HTTP operation fixes query, variables and optional pinned extension", () => {
  const op = {
    operationName: "Stock",
    query: querySource,
    variables: scopes.a,
  };
  validateOperation(op, scopes.a);
  validateOperation(
    {
      ...op,
      extensions: {
        clientLibrary: { name: "@apollo/client", version: "4.3.3" },
      },
    },
    scopes.a,
  );
  for (const bad of [
    null,
    {},
    { ...op, variables: scopes.west },
    { ...op, query: querySource.replace("quantity", "quantity other") },
    { ...op, extensions: {} },
    { ...op, unrecognized: true },
  ])
    assert.throws(() => validateOperation(bad, scopes.a));
});
