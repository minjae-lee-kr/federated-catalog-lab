import { validateOperation, validateReport } from "./contract.mjs";
import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { startLab } from "../../src/lab.ts";
import { schemaSources, loadOperations } from "../../src/schema.ts";
import { sourceEvidence } from "./provenance.mjs";

const root = new URL("./", import.meta.url),
  local = createRequire(import.meta.url);
const canonical = createRequire(new URL("../../package.json", import.meta.url));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sessionId = randomUUID(),
  token = randomUUID(),
  start = performance.now();
const requests = [],
  labs = [],
  abort = new AbortController();
const files = [
  "package.json",
  "pnpm-lock.yaml",
  "app.jsx",
  "app.js",
  "index.html",
  "style.css",
  "build.mjs",
  "build-receipt.json",
  "server.mjs",
  "contract.mjs",
  "audit-record.mjs",
  "pnpm-workspace.yaml",
  "contract.test.mjs",
  "fixtures/apollo-request.json",
  "check-negative-controls.mjs",
  "provenance.mjs",
  ".gitignore",
];
const manifest = async () =>
  Promise.all(
    files.map(async (path) => {
      const bytes = await readFile(new URL(path, root));
      return { path, sha256: sha(bytes), bytes: bytes.length };
    }),
  );
const harnessBefore = await manifest(),
  sourceBefore = await sourceEvidence();
if (!sourceBefore.git || sourceBefore.git.dirty)
  throw new Error("Canonical source must be clean");
const packages = {};
for (const name of [
  "react",
  "react-dom",
  "esbuild",
  "@apollo/client",
  "graphql",
  "rxjs",
]) {
  const resolver = ["react", "react-dom", "esbuild"].includes(name)
    ? local
    : canonical;
  packages[name] = JSON.parse(
    await readFile(resolver.resolve(name + "/package.json"), "utf8"),
  ).version;
}
if (
  packages.react !== "19.3.1" ||
  packages["react-dom"] !== "19.3.1" ||
  packages["@apollo/client"] !== "4.3.3" ||
  packages.graphql !== "16.14.2" ||
  packages.rxjs !== "7.8.2"
)
  throw new Error("Pinned dependency mismatch");
const assets = new Map();
for (const [path, file, contentType] of [
  ["/", "index.html", "text/html; charset=utf-8"],
  ["/app.js", "app.js", "text/javascript"],
  ["/style.css", "style.css", "text/css"],
])
  assets.set(path, { bytes: await readFile(new URL(file, root)), contentType });
const querySource = loadOperations()["CatalogCards.graphql"];
let origin,
  stopping = false,
  saves = 0,
  timer;
await mkdir(new URL("records/", root), { recursive: true });
async function boundedBody(req, cap) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > cap) throw new Error("Request body exceeds limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function send(res, status, body, type = "application/json") {
  if (res.destroyed) return;
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy":
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  });
  res.end(
    typeof body === "string" || Buffer.isBuffer(body)
      ? body
      : JSON.stringify(body),
  );
}
const server = createServer(async (req, res) => {
  req.setTimeout(6000, () => req.destroy());
  try {
    if (
      stopping ||
      req.headers.host !== new URL(origin).host ||
      (req.headers.origin && req.headers.origin !== origin)
    )
      return send(res, 403, { error: "Local session only" });
    const path = req.url;
    if (req.method === "GET" && assets.has(path)) {
      const asset = assets.get(path);
      return send(res, 200, asset.bytes, asset.contentType);
    }
    if (req.method === "GET" && path === "/config")
      return send(res, 200, {
        sessionId,
        sessionToken: token,
        querySource,
        sourceHead: sourceBefore.git.head,
        packages,
      });
    if (
      req.method !== "POST" ||
      req.headers["x-lab-session"] !== token ||
      req.headers.origin !== origin
    )
      return send(res, 403, { error: "POST requires this local session" });
    if (path === "/shutdown") {
      send(res, 200, { stopping: true });
      setImmediate(() => close("manual"));
      return;
    }
    if (path === "/graphql/healthy" || path === "/graphql/failure") {
      if (requests.length >= 12)
        return send(res, 429, { error: "Session request cap reached" });
      const caseId = req.headers["x-lab-case"],
        phase = req.headers["x-lab-phase"];
      if (
        !/^case-[1-4]$/.test(caseId ?? "") ||
        !["warm", "failed", "cache-first"].includes(phase)
      )
        throw new Error("Fixed case/phase required");
      const bytes = await boundedBody(req, 65536),
        body = JSON.parse(bytes);
      validateOperation(body, querySource);
      const endpoint = path.endsWith("healthy") ? "healthy" : "failure";
      const record = {
        sequence: requests.length + 1,
        caseId,
        phase,
        endpoint,
        startedAtMs: performance.now() - start,
        requestBodyText: bytes.toString("utf8"),
      };
      requests.push(record);
      try {
        const response = await fetch(labs[endpoint === "healthy" ? 0 : 1].url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: bytes,
          redirect: "error",
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(5000)]),
        });
        const reader = response.body.getReader(),
          chunks = [];
        let size = 0;
        try {
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.length;
            if (size > 1_048_576) {
              await reader.cancel();
              throw new Error("Upstream body cap");
            }
            chunks.push(part.value);
          }
        } finally {
          reader.releaseLock();
        }
        const raw = Buffer.concat(chunks);
        record.response = {
          status: response.status,
          bodyText: raw.toString("utf8"),
          sha256: sha(raw),
        };
        send(res, response.status, raw);
      } catch (error) {
        record.transportError = { name: error.name, message: error.message };
        throw error;
      } finally {
        record.completedAtMs = performance.now() - start;
      }
      return;
    }
    if (path === "/save") {
      if (++saves > 4) return send(res, 429, { error: "Save cap reached" });
      const report = JSON.parse(await boundedBody(req, 2_097_152));
      validateReport(report, sessionId);
      const sourceAfter = await sourceEvidence(),
        harnessAfter = await manifest();
      const envelope = {
        kind: "react-useQuery-dom-recording",
        generatedAt: new Date().toISOString(),
        sessionId,
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
          platform: process.platform,
          arch: process.arch,
          packages,
        },
        serverObservedRequests: structuredClone(requests),
        browser: report,
        limits: [
          "Manual browser observations, not all commits or paints.",
          "Same-origin fixed proxy forwards to two real loopback Apollo gateways.",
          "Browser payload is locally supplied evidence, not independently authenticated telemetry.",
        ],
      };
      const bytes = Buffer.from(JSON.stringify(envelope, null, 2) + "\n");
      const file = `react-${sessionId}-${saves}.json`;
      await writeFile(new URL(`records/${file}`, root), bytes, { flag: "wx" });
      return send(res, 200, {
        file,
        sha256: sha(bytes),
        bytes: bytes.length,
        sourceStable: envelope.sourceStable,
        harnessStable: envelope.harnessStable,
      });
    }
    send(res, 404, { error: "Fixed endpoint only" });
  } catch (error) {
    send(res, 400, { error: error.message });
  }
});
server.requestTimeout = 6000;
server.headersTimeout = 6000;
server.keepAliveTimeout = 1000;
async function close(reason) {
  if (stopping) return;
  stopping = true;
  clearTimeout(timer);
  abort.abort();
  await new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  });
  const outcomes = await Promise.allSettled(labs.map((lab) => lab.stop()));
  const receipt = {
    sessionId,
    reason,
    closedAt: new Date().toISOString(),
    requestCount: requests.length,
    sourceAfter: await sourceEvidence(),
    ownedServersStopped: outcomes.every((x) => x.status === "fulfilled"),
    harnessAfter: await manifest(),
  };
  await writeFile(
    new URL(`records/cleanup-${sessionId}.json`, root),
    JSON.stringify(receipt, null, 2) + "\n",
    { flag: "wx" },
  );
  console.log(
    JSON.stringify({
      stopped: true,
      sessionId,
      reason,
      ownedServersStopped: receipt.ownedServersStopped,
    }),
  );
  if (!receipt.ownedServersStopped) process.exitCode = 1;
}
try {
  labs.push(
    await startLab({
      subgraphTimeoutMs: 2000,
      fixture: { sources: schemaSources, captureResponses: true },
    }),
  );
  labs.push(
    await startLab({
      subgraphTimeoutMs: 2000,
      fixture: {
        sources: schemaSources,
        captureResponses: true,
        inventoryFailure: { mode: "per-key", sku: "demo-lamp" },
      },
    }),
  );
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(4352, "127.0.0.1", resolve);
  });
  origin = "http://127.0.0.1:4352";
  timer = setTimeout(() => close("20-minute-session-deadline"), 20 * 60_000);
  process.once("SIGINT", () => close("SIGINT"));
  process.once("SIGTERM", () => close("SIGTERM"));
  console.log(
    JSON.stringify({
      url: origin,
      sessionId,
      source: sourceBefore.git.head,
      packages,
      deadlineMinutes: 20,
    }),
  );
} catch (error) {
  await Promise.allSettled(labs.map((lab) => lab.stop()));
  server.closeAllConnections();
  server.close();
  throw error;
}
