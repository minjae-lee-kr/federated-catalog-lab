const byId = (id) => document.getElementById(id);
const notes = {
  healthy:
    "All three subgraphs answer. Look for one inventory batch and two unique merchant keys.",
  "inventory-error":
    "Inventory throws a field error. Product and merchant data should remain readable.",
  "inventory-timeout":
    "Inventory exceeds a synthetic deadline. The gateway stops waiting; other fields survive.",
  "missing-inventory":
    "The lamp has no inventory record. Unknown remains distinct from sold out, without a transport error.",
};
const operations = await fetch("/operations")
  .then((response) => response.json())
  .catch(() => null);
function updateGraph(services) {
  document
    .querySelectorAll("[data-domain]")
    .forEach((node) =>
      node.classList.toggle(
        "inactive",
        !services.includes(node.dataset.domain),
      ),
    );
  byId("branches").classList.toggle(
    "inactive",
    !services.includes("inventory") && !services.includes("merchants"),
  );
  byId("graph").setAttribute(
    "aria-label",
    services.length === 1
      ? "Catalog is selected. Inventory and merchants are not fetched."
      : "Catalog resolves first, then inventory and merchants.",
  );
}
function updateQuery() {
  byId("query").textContent =
    operations?.[byId("operation").value] ??
    "Could not load operations. Restart the local lab and reload.";
  byId("scenario-note").textContent =
    byId("operation").value === "CatalogOnly.graphql"
      ? "Catalog-only selections do not fetch inventory or merchants. Inventory faults should have no effect."
      : notes[byId("scenario").value];
  updateGraph(
    byId("operation").value === "CatalogOnly.graphql"
      ? ["catalog"]
      : ["catalog", "inventory", "merchants"],
  );
}
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function render(result) {
  const fetches = result.extensions?.lab?.fetches ?? [];
  const errors = result.errors ?? [];
  updateGraph(fetches.map((trace) => trace.service));
  byId("fetch-count").textContent =
    `${fetches.length} SUBGRAPH FETCH${fetches.length === 1 ? "" : "ES"}`;
  byId("trace").replaceChildren(
    ...fetches.map((trace) => {
      const row = element(
        "div",
        undefined,
        `trace-row${trace.outcome === "ok" ? "" : " bad"}`,
      );
      const count = trace.batches.reduce(
        (sum, batch) => sum + batch.keys.length,
        0,
      );
      row.append(
        element("strong", trace.service),
        element(
          "span",
          trace.batches.length
            ? `${trace.batches.length} batch · ${count} unique keys`
            : "No batch result received",
          "batch",
        ),
        element("span", `${trace.durationMs} ms`, "time"),
      );
      row.title = `${trace.outcome}\n${trace.batches.flatMap((batch) => batch.keys).join(", ")}`;
      return row;
    }),
  );
  byId("cards").replaceChildren(
    ...(result.data?.products ?? []).map((product, index) => {
      const card = element("article", undefined, "product");
      if (!product) {
        card.append(element("h3", `Product ${index + 1} not found`));
        return card;
      }
      card.append(
        element("span", product.sku, "sku"),
        element("h3", product.name),
      );
      if (Object.hasOwn(product, "description"))
        card.append(element("p", product.description, "description"));
      if (Object.hasOwn(product, "merchant"))
        card.append(
          element(
            "p",
            product.merchant
              ? `${product.merchant.name} / ${product.merchant.city}`
              : "Merchant unavailable",
            "merchant",
          ),
        );
      const footer = element("div", undefined, "product-foot");
      const availabilitySelected = Object.hasOwn(product, "availability");
      let state = "UNKNOWN",
        className = "badge unknown";
      if (availabilitySelected && product.availability === null) {
        state = "UNKNOWN";
        className = "badge unknown";
      }
      if (product.availability) {
        state =
          product.availability.status === "SOLD_OUT"
            ? "SOLD OUT"
            : `${product.availability.quantity} AVAILABLE`;
        className = `badge${product.availability.status === "SOLD_OUT" ? " sold" : ""}`;
      }
      if (product.price)
        footer.append(
          element(
            "span",
            new Intl.NumberFormat("en-US", {
              style: "currency",
              currency: product.price.currency,
            }).format(product.price.amountMinor / 100),
            "price",
          ),
        );
      if (availabilitySelected)
        footer.append(element("span", state, className));
      if (footer.childElementCount) card.append(footer);
      return card;
    }),
  );
  const unknown = (result.data?.products ?? []).filter(
    (product) =>
      product &&
      Object.hasOwn(product, "availability") &&
      product.availability === null,
  ).length;
  byId("status").textContent = errors.length
    ? `Partial data · ${errors.length} error${errors.length === 1 ? "" : "s"} · availability is unknown`
    : unknown
      ? `Response received · ${unknown} unknown inventory record`
      : "Response complete · selected fields resolved";
  byId("status").className = errors.length || unknown ? "warning" : "";
  byId("response").textContent = JSON.stringify(result, null, 2);
}
byId("operation").addEventListener("change", updateQuery);
byId("scenario").addEventListener("change", updateQuery);
byId("run").addEventListener("click", async () => {
  byId("run").disabled = true;
  byId("status").textContent = "Running the selected operation…";
  byId("status").className = "";
  try {
    const response = await fetch("/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: byId("operation").value,
        scenario: byId("scenario").value,
        duplicates: byId("duplicates").checked,
      }),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(
        result.error ?? result.errors?.[0]?.message ?? "Request rejected",
      );
    render(result);
  } catch (error) {
    byId("status").textContent = `Could not run query: ${error.message}`;
    byId("status").className = "warning";
    byId("cards").replaceChildren();
    byId("trace").replaceChildren(
      element(
        "p",
        "No current trace. Check that the local server is running.",
        "empty",
      ),
    );
    byId("fetch-count").textContent = "NO RESULT";
    byId("response").textContent = JSON.stringify(
      { error: error.message },
      null,
      2,
    );
  } finally {
    byId("run").disabled = false;
  }
});
updateQuery();
