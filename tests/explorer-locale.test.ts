import assert from "node:assert/strict";
import test from "node:test";

// Import the browser's actual state controller without requiring a DOM dependency.
const { createExplorerState, initialLanguage } = await import(
  new URL("../public/app.js", import.meta.url).href
);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

test("browser locale survives blocked storage and only a valid saved choice overrides it", () => {
  assert.equal(initialLanguage("ko-KR"), "ko");
  assert.equal(initialLanguage("en-US", { getItem: () => "ko" }), "ko");
  assert.equal(initialLanguage("ko-KR", { getItem: () => "en" }), "en");
  assert.equal(initialLanguage("ko-KR", { getItem: () => "unknown" }), "ko");
  assert.equal(
    initialLanguage("ko-KR", {
      getItem: () => {
        throw new Error("blocked");
      },
    }),
    "ko",
  );
});

test("locale changes during operation loading do not reload or modify the GraphQL documents", async () => {
  const pending = deferred<Response>();
  const calls: string[] = [];
  const model = createExplorerState({
    request: (url: string) => {
      calls.push(url);
      return pending.promise;
    },
  });
  const loading = model.load();
  model.setLanguage("ko");
  model.setLanguage("en");
  assert.equal(model.state.operationsState, "loading");
  assert.deepEqual(calls, ["/operations"]);
  const operations = {
    "CatalogCards.graphql":
      'query CatalogCards { products(skus: ["demo"]) { sku } }',
  };
  pending.resolve(Response.json(operations));
  await loading;
  const loaded = model.state.operations;
  model.setLanguage("ko");
  assert.equal(model.state.operations, loaded);
  assert.deepEqual(loaded, operations);
  assert.deepEqual(calls, ["/operations"]);
});

test("switching during and after a request preserves its payload, prior result and exact partial/error evidence", async () => {
  const pending = deferred<Response>();
  const calls: Array<{ url: string; body: string }> = [];
  const partial = {
    data: {
      products: [{ sku: "demo", name: "Fixture name", availability: null }],
    },
    errors: [
      {
        message: "Synthetic inventory dependency is unavailable.",
        extensions: { code: "INVENTORY_UNAVAILABLE" },
      },
    ],
  };
  let count = 0;
  const model = createExplorerState({
    request: (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body) });
      count++;
      return count === 1
        ? Promise.resolve(Response.json(partial))
        : pending.promise;
    },
  });
  const selection = {
    operation: "CatalogCards.graphql",
    scenario: "inventory-error",
    duplicates: true,
  };
  await model.run(selection);
  const result = model.state.result;
  const original = JSON.stringify(result);
  Object.freeze(result);
  model.setLanguage("ko");
  assert.equal(model.state.result, result);
  assert.equal(JSON.stringify(model.state.result), original);
  const second = model.run(selection);
  model.setLanguage("en");
  model.setLanguage("ko");
  assert.equal(model.state.running, true);
  assert.equal(model.state.result, result);
  await model.run(selection); // Disabled UI is also guarded against concurrent execution.
  assert.deepEqual(
    calls,
    Array(2).fill({ url: "/run", body: JSON.stringify(selection) }),
  );
  pending.resolve(
    Response.json(
      { error: "Original server rejection <unchanged>" },
      { status: 400 },
    ),
  );
  await second;
  assert.equal(model.state.running, false);
  assert.equal(model.state.error, "Original server rejection <unchanged>");
  model.setLanguage("en");
  assert.equal(model.state.error, "Original server rejection <unchanged>");
  assert.equal(calls.length, 2);
});
