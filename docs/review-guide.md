# Review the federation explorer

This guide covers the original query explorer (`pnpm dev`). For permit ownership and cooperative cancellation, follow the separate [Cancellation Debt case study](cancellation-debt.md).

## 1. Break the visible product

Run `pnpm dev`, open `http://127.0.0.1:4181/`, then compare Healthy, Dependency error and Response timeout. Check that names, prices and merchant details survive while unknown availability is never represented as sold out. Open the raw response to inspect the errors.

## 2. Follow the keys

Read `schemas/catalog.graphql`, `inventory.graphql` and `merchants.graphql`. Follow `Product.sku` and `Merchant.id` into `src/subgraphs.ts`. The entity references are real Federation representations, not a manually stitched final response.

## 3. Inspect the batch boundary

Read `src/loaders.ts`. Each batch remaps results to the input key order and each HTTP request receives fresh loaders. Repeat one SKU in the UI; inspect output positions and the unique batch keys in the raw response.

## 4. Compare two kinds of breakage

Read `tests/contracts.test.ts`. A field removal breaks both the schema contract and a named operation. A nullability weakening breaks the schema contract while the queries still validate. This is why operation validation alone is insufficient.

## 5. Challenge the limits

Read `src/lab.ts`, `tests/integration.test.ts`, `src/http-server.ts` and `SECURITY.md`. The original explorer stops waiting without cancelling its dependency; the separate cooperative-cancellation experiment wires that signal explicitly. Both use in-memory stores, have no authentication or production complexity/rate controls, and disclose upstream dependency findings.

The strongest evidence is the executable behavior and the explicit boundary of each claim—not the number of technologies in the dependency list.
