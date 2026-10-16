# A five-minute review

## First minute: break the visible product

Run `pnpm dev`, open `http://127.0.0.1:4181/`, then compare Healthy, Dependency error and Response timeout. Check that names, prices and merchant details survive while unknown availability is never represented as sold out. Open the raw response to inspect the errors.

## Second minute: follow the keys

Read `schemas/catalog.graphql`, `inventory.graphql` and `merchants.graphql`. Follow `Product.sku` and `Merchant.id` into `src/subgraphs.ts`. The entity references are real Federation representations, not a manually stitched final response.

## Third minute: inspect the batch boundary

Read `src/loaders.ts`. Each batch remaps results to the input key order and each HTTP request receives fresh loaders. Repeat one SKU in the UI; inspect output positions and the unique batch keys in the raw response.

## Fourth minute: compare two kinds of breakage

Read `tests/contracts.test.ts`. A field removal breaks both the schema contract and a named operation. A nullability weakening breaks the schema contract while the queries still validate. This is why operation validation alone is insufficient.

## Fifth minute: challenge the limits

Read `src/lab.ts`, `tests/integration.test.ts`, `src/http-server.ts` and `SECURITY.md`. Confirm the timeout code and cleanup, then note the gaps: remote work is not cancelled, stores are in memory, identity is absent, no production complexity/rate controls exist, and upstream dependency findings are disclosed.

The strongest evidence is the executable behavior and the explicit boundary of each claim—not the number of technologies in the dependency list.
