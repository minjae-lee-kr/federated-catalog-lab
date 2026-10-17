import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { audit } from "./audit.mjs";
const file = process.argv[2];
assert.match(file ?? "", /^attempts-[a-f0-9-]+-[12]\.json$/);
const raw = JSON.parse(
  await readFile(new URL("records/" + file, import.meta.url)),
);
audit(raw);
const controls = [
  ["missing intermediate stage", (r) => r.browser.cases[0].steps.splice(1, 1)],
  [
    "altered decision token",
    (r) => (r.browser.cases[0].decisions[0].token.epoch = 99),
  ],
  [
    "altered request wire",
    (r) => (r.browser.cases[0].requests[0].requestWireText += " "),
  ],
  [
    "visible quantity",
    (r) => {
      const s = r.browser.cases[0].steps[0];
      s.dom.html = s.dom.html.replace("<dd>3</dd>", "<dd>999</dd>");
    },
  ],
  [
    "server bytes",
    (r) => (r.serverObservedRequests[0].response.bodyText += " "),
  ],
  ["release order", (r) => r.releases.reverse()],
  [
    "epoch",
    (r) =>
      (r.browser.cases.find((c) => c.scenario === "aba").steps.at(-1).epoch =
        1),
  ],
  [
    "invented accepted old result",
    (r) =>
      (r.browser.cases[0].decisions.find(
        (d) => d.token.slot === "old",
      ).accepted = true),
  ],
  ["dirty source", (r) => (r.sourceBefore.git.dirty = true)],
  [
    "hidden cache pollution removed",
    (r) => {
      const c = r.browser.cases.find(
        (c) => c.scenario === "product-switch" && c.mode === "status-only",
      );
      for (const v of Object.values(c.steps.at(-1).cache))
        if (v?.sku === "demo-a") v.quantity = 3;
    },
  ],
];
for (const [name, mutate] of controls) {
  const copy = structuredClone(raw);
  mutate(copy);
  assert.throws(() => audit(copy), undefined, name);
}
console.log(
  JSON.stringify({
    record: file,
    negativeControlsRejected: controls.map(([name]) => name),
    scope: "Synthetic changes to copies, not additional execution",
  }),
);
