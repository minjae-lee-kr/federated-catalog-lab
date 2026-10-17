import { validateOperation } from "./contract.mjs";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { graphql, buildSchema, parse, print } from "graphql";
import { sourceEvidence } from "./provenance.mjs";
import { scenarios, modes, querySource, slotSpec } from "./model.mjs";
const base = new URL("./", import.meta.url),
  sha = (b) => createHash("sha256").update(b).digest("hex");
const local = createRequire(import.meta.url),
  canonical = createRequire(new URL("../../package.json", import.meta.url));
const packages = {};
for (const name of [
  "react",
  "react-dom",
  "esbuild",
  "@apollo/client",
  "graphql",
]) {
  const resolver =
    name.startsWith("react") || name === "esbuild" ? local : canonical;
  packages[name] = JSON.parse(
    await readFile(resolver.resolve(name + "/package.json"), "utf8"),
  ).version;
}
for (const [name, version] of Object.entries({
  react: "19.3.1",
  "react-dom": "19.3.1",
  esbuild: "0.28.2",
  "@apollo/client": "4.3.3",
  graphql: "16.14.2",
}))
  if (packages[name] !== version) throw Error("Pinned dependency mismatch");
const sourceBefore = await sourceEvidence();
if (sourceBefore.git.dirty) throw Error("Clean checkout required");
const files = [
  "app.jsx",
  "app.js",
  "build-receipt.json",
  "server.mjs",
  "model.mjs",
  "model.test.mjs",
  "contract.mjs",
  "audit.mjs",
  "negative.mjs",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "build.mjs",
  "provenance.mjs",
  "index.html",
  "style.css",
];
const manifest = async () =>
  Promise.all(
    files.map(async (path) => {
      const b = await readFile(new URL(path, base));
      return { path, bytes: b.length, sha256: sha(b) };
    }),
  );
const harnessBefore = await manifest();
const sessionId = randomUUID(),
  token = randomUUID(),
  origin = "http://127.0.0.1:4354",
  records = [],
  releases = [],
  pending = new Map(),
  arrivals = new Map(),
  arrivalWaiters = new Map();
let stopped = false,
  saves = 0;
await mkdir(new URL("records/", base), { recursive: true });
const schema = buildSchema(
  "type Product { sku: ID!, warehouse: String!, quantity: Int! } type Query { product(sku: ID!, warehouse: String!): Product }",
);
const timeout = (promise, label) => {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error(label + " deadline")), 15000);
    }),
  ]).finally(() => clearTimeout(timer));
};
function send(res, status, data, type = "application/json") {
  if (res.destroyed) return;
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy":
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  });
  res.end(
    typeof data === "string" || Buffer.isBuffer(data)
      ? data
      : JSON.stringify(data),
  );
}
async function body(req, cap = 65536) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > cap) throw Error("Body cap");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
const cases = new Map();
for (const scenario of scenarios)
  for (const mode of modes)
    cases.set(`${scenario}-${mode}`, { scenario, mode });
const server = createServer(async (req, res) => {
  req.setTimeout(20000, () => req.destroy());
  try {
    if (
      stopped ||
      req.headers.host !== "127.0.0.1:4354" ||
      (req.headers.origin && req.headers.origin !== origin)
    )
      return send(res, 403, { error: "Local session only" });
    if (
      req.method === "GET" &&
      ["/", "/app.js", "/style.css"].includes(req.url)
    ) {
      const name = req.url === "/" ? "index.html" : req.url.slice(1);
      return send(
        res,
        200,
        await readFile(new URL(name, base)),
        name.endsWith("html")
          ? "text/html; charset=utf-8"
          : name.endsWith("css")
            ? "text/css"
            : "text/javascript",
      );
    }
    if (req.method === "GET" && req.url === "/config")
      return send(res, 200, {
        sessionId,
        token,
        sourceHead: sourceBefore.git.head,
      });
    if (
      req.method !== "POST" ||
      req.headers.origin !== origin ||
      req.headers["x-lab-session"] !== token
    )
      return send(res, 403, { error: "Session POST required" });
    if (req.url === "/stop") {
      send(res, 200, { stopping: true });
      setImmediate(() => close("manual"));
      return;
    }
    const text = await body(req, req.url === "/save" ? 4 * 1024 * 1024 : 65536),
      b = JSON.parse(text);
    if (req.url === "/save") {
      if (
        ++saves > 2 ||
        b.kind !== "react-attempts-observation" ||
        b.sessionId !== sessionId ||
        !Array.isArray(b.cases) ||
        b.cases.length < 1 ||
        b.cases.length > 10 ||
        !Array.isArray(b.faults) ||
        b.faults.length > 32
      )
        throw Error("Fixed complete report required");
      const sourceAfter = await sourceEvidence(),
        harnessAfter = await manifest();
      const raw = {
        kind: "react-attempts-recording",
        schema: 1,
        sessionId,
        generatedAt: new Date().toISOString(),
        sourceBefore,
        sourceAfter,
        sourceStable:
          JSON.stringify(sourceBefore) === JSON.stringify(sourceAfter),
        harnessBefore,
        harnessAfter,
        harnessStable:
          JSON.stringify(harnessBefore) === JSON.stringify(harnessAfter),
        tooling: {
          node: process.version,
          react: "19.3.1",
          apollo: "4.3.3",
          graphql: packages.graphql,
          packages,
        },
        serverObservedRequests: records,
        releases,
        browser: b,
      };
      const bytes = Buffer.from(JSON.stringify(raw, null, 2) + "\n"),
        file = `attempts-${sessionId}-${saves}.json`;
      await writeFile(new URL("records/" + file, base), bytes, { flag: "wx" });
      return send(res, 200, { file, bytes: bytes.length, sha256: sha(bytes) });
    }
    const config = cases.get(b.caseId);
    if (!config) throw Error("Fixed case required");
    const spec = slotSpec(config.scenario, b.slot),
      id = b.caseId + ":" + b.slot;
    if (req.url === "/await") {
      if (!arrivals.has(id))
        await timeout(
          new Promise((resolve) => arrivalWaiters.set(id, resolve)),
          "arrival",
        );
      return send(res, 200, { arrived: id });
    }
    if (req.url === "/release") {
      const resolve = pending.get(id);
      if (!resolve) throw Error("No held response");
      releases.push({
        sequence: releases.length + 1,
        caseId: b.caseId,
        slot: b.slot,
      });
      pending.delete(id);
      resolve();
      return send(res, 200, { released: id });
    }
    if (req.url === "/graphql") {
      if (records.length >= 40 || arrivals.has(id))
        throw Error("Request cap or duplicate slot");
      validateOperation(b.operation, spec.scope);
      const record = {
        sequence: records.length + 1,
        caseId: b.caseId,
        slot: b.slot,
        requestBodyText: JSON.stringify(b.operation),
        requestWireText: text,
        requestWireSha256: sha(text),
        receivedAt: new Date().toISOString(),
      };
      records.push(record);
      let release;
      const gate = new Promise((resolve) => (release = resolve));
      pending.set(id, release);
      arrivals.set(id, true);
      arrivalWaiters.get(id)?.();
      arrivalWaiters.delete(id);
      await timeout(gate, "release");
      const result = await graphql({
        schema,
        source: b.operation.query,
        variableValues: b.operation.variables,
        operationName: "Stock",
        rootValue: {
          product: () => {
            if (spec.fail) throw Error("Synthetic stock lookup failed");
            return { ...spec.scope, quantity: spec.quantity };
          },
        },
      });
      const responseText = JSON.stringify(result);
      record.response = {
        status: 200,
        bodyText: responseText,
        sha256: sha(responseText),
      };
      send(res, 200, responseText);
      return;
    }
    send(res, 404, { error: "Fixed endpoint only" });
  } catch (error) {
    send(res, 400, { error: error.message });
  }
});
server.requestTimeout = 20000;
server.headersTimeout = 6000;
server.keepAliveTimeout = 1000;
async function close(reason) {
  if (stopped) return;
  stopped = true;
  clearTimeout(deadline);
  for (const release of pending.values()) release();
  await new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  });
  await writeFile(
    new URL(`records/cleanup-${sessionId}.json`, base),
    JSON.stringify({
      sessionId,
      reason,
      ownedServerStopped: true,
      requests: records.length,
    }) + "\n",
    { flag: "wx" },
  );
  console.log(JSON.stringify({ stopped: true, reason }));
}
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(4354, "127.0.0.1", resolve);
});
const deadline = setTimeout(() => close("20-minute-deadline"), 20 * 60000);
process.once("SIGINT", () => close("SIGINT"));
process.once("SIGTERM", () => close("SIGTERM"));
console.log(
  JSON.stringify({ url: origin, sessionId, source: sourceBefore.git.head }),
);
