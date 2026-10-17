import assert from "node:assert/strict";
import { parse, print } from "graphql";
import { querySource } from "./model.mjs";
export function validateOperation(operation, scope) {
  assert.ok(
    operation && typeof operation === "object" && !Array.isArray(operation),
  );
  const keys = ["operationName", "query", "variables"];
  if ("extensions" in operation) {
    keys.push("extensions");
    assert.deepEqual(operation.extensions, {
      clientLibrary: { name: "@apollo/client", version: "4.3.3" },
    });
  }
  assert.deepEqual(Object.keys(operation).sort(), keys.sort());
  assert.equal(operation.operationName, "Stock");
  assert.equal(print(parse(operation.query)), print(parse(querySource)));
  assert.deepEqual(operation.variables, scope);
}
