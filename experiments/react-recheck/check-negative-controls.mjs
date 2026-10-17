// Negative controls against a supplied capture; does not run or alter that capture.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { audit } from "./audit-record.mjs";
const file = process.argv[2];
assert.match(file ?? "", /^react-[a-f0-9-]+-[1-4]\.json$/);
const raw = JSON.parse(
  await readFile(new URL(`records/${file}`, import.meta.url)),
);
audit(raw);
function changeRequest(r, change) {
  const c = r.browser.cases[0],
    b = c.requests[0],
    s = r.serverObservedRequests.find(
      (s) => s.caseId === c.caseId && s.phase === "warm",
    );
  const body = JSON.parse(b.requestBodyText);
  change(body);
  b.requestBodyText = s.requestBodyText = JSON.stringify(body);
}
const controls = [
  [
    "coherently altered query",
    (r) =>
      changeRequest(r, (b) => {
        b.query = b.query.replace("quantity", "quantity price");
      }),
  ],
  [
    "coherently altered variables",
    (r) =>
      changeRequest(r, (b) => {
        b.variables.skus[1] = "different-product";
      }),
  ],
  [
    "healthy quantity and response hash altered",
    (r) => {
      const c = r.browser.cases[0],
        b = c.requests[0],
        s = r.serverObservedRequests.find(
          (s) => s.caseId === c.caseId && s.phase === "warm",
        );
      const body = JSON.parse(b.response.bodyText);
      body.data.products[1].availability.quantity = 999;
      for (const response of [b.response, s.response]) {
        response.bodyText = JSON.stringify(body);
        response.sha256 = createHash("sha256")
          .update(response.bodyText)
          .digest("hex");
      }
    },
  ],
  [
    "card differs from hook",
    (r) => {
      const d = r.browser.cases[0].domObservations.find((d) =>
        d.dom.html.includes("<strong>3</strong>"),
      );
      assert.ok(d);
      d.dom.html = d.dom.html.replace(
        "<strong>3</strong>",
        "<strong>999</strong>",
      );
    },
  ],
  [
    "status differs from hook",
    (r) => {
      const d = r.browser.cases[0].domObservations.find((d) =>
        d.dom.html.includes("<dd>3</dd>"),
      );
      assert.ok(d);
      d.dom.html = d.dom.html.replace("<dd>3</dd>", "<dd>999</dd>");
    },
  ],
  [
    "server body differs",
    (r) => (r.serverObservedRequests[0].response.bodyText += " "),
  ],
  [
    "unobserved HTTP claimed",
    (r) => (r.browser.cases[0].steps[2].requestCount = 1),
  ],
  [
    "missing policy",
    (r) =>
      (r.browser.cases = r.browser.cases.filter(
        (c) => c.errorPolicy === "all",
      )),
  ],
  ["dirty provenance", (r) => (r.sourceBefore.git.dirty = true)],
  [
    "invented previousData",
    (r) =>
      (r.browser.cases.find(
        (c) => c.errorPolicy === "none",
      ).steps[1].after.latestHook.previousDataPresent = true),
  ],
];
for (const [name, change] of controls) {
  const copy = structuredClone(raw);
  change(copy);
  assert.throws(() => audit(copy), undefined, name);
}
console.log(
  JSON.stringify({
    record: file,
    baselineAccepted: true,
    negativeControlsRejected: controls.map(([name]) => name),
    scope:
      "Synthetic mutations of a captured record; no new HTTP or React execution.",
  }),
);
