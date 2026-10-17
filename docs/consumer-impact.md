# The query validates. Does the existing consumer still compile?

[한국어](consumer-impact.ko.md) · [Schema analysis](schema-evolution.md) · [Project overview](../README.md)

Making `Product.name` nullable does not invalidate a query that selects it. But what happens to code that calls `product.name.toUpperCase()`? This experiment follows the change through real operation type generation and TypeScript compilation, keeping the consumer files fixed.

It extends the lab's existing [schema scenarios](../src/evolution-scenarios.ts), using Apollo composition, GraphQL validation, official GraphQL Code Generator and the installed TypeScript compiler. All inputs are synthetic. No resolver, UI or consumer function runs in this experiment.

## Run the experiment

```sh
pnpm consumer-impact
# JSON without a package-manager command banner:
node src/consumer-impact-cli.ts --format json
# Keep generated files, fixed consumers, configurations and diagnostics:
node src/consumer-impact-cli.ts --report-dir ./consumer-evidence
```

Install the pinned dependencies with `pnpm install --frozen-lockfile` first. The report directory must be new and its parent must exist. Without `--report-dir`, the command removes its temporary files after success or failure.

Exit `0` means the expected outcomes were observed, **including deliberate type errors**. Missing tools, generator failures, timeouts, unexpected compiler output or changed inputs fail the experiment with exit `1`. This command is not a deployment gate; [`pnpm contracts`](../README.md) checks the repository's checked-in schema and operations.

## Change the schema, keep the consumers

Both `CatalogOnly` and `CatalogCards` validate against every candidate below. The table uses freshly generated operation types with `futureProofEnums: false` and explicit strict compiler settings.

| Candidate schema | Direct name access | Null fallback | Exhaustive stock switch | Stock fallback |
| --- | --- | --- | --- | --- |
| Unchanged | Compiles | Compiles | Compiles | Compiles |
| Add unselected nullable `subtitle` | Compiles | Compiles | Compiles | Compiles |
| `name: String!` → `String` | **TS18047** | Compiles | Compiles | Compiles |
| Add `StockStatus.PREORDER` | Compiles | Compiles | **TS2345** | Compiles |

The [direct-name consumer](../fixtures/consumers/strict-name.ts) relies on the non-null guarantee. Regeneration changes its selected `name` type to `string | null`; the same source then produces:

```text
strict-name.ts(6,10): error TS18047: 'product.name' is possibly 'null'.
```

The [exhaustive stock consumer](../fixtures/consumers/exhaustive-status.ts) handles `IN_STOCK` and `SOLD_OUT`, then passes the remaining value to `assertNever`. Adding `PREORDER` leaves a value that is no longer `never`:

```text
exhaustive-status.ts(14,33): error TS2345: Argument of type '"PREORDER"' is not assignable to parameter of type 'never'.
```

The two [fallback](../fixtures/consumers/nullable-name.ts) [consumers](../fixtures/consumers/fallback-status.ts) still compile. That establishes a narrower point: these functions can represent the changed types. It does not establish that their fallback labels are the right product behavior.

The additive control also checks that an unselected field leaves both operation type files byte-identical. The enum addition leaves `CatalogOnly` unchanged because that operation does not select stock status. A schema change does not affect every consumer equally.

## A passing stale-type check misses the change

For the nullable-name and enum candidates, a separate control compiles the same consumers against **baseline generated types**. All four compile. The report records different `candidateSchemaSha256` and `generatedFromSchemaSha256` values so the stale result cannot be confused with regeneration.

This control deliberately supplies stale generated types. The compiler checks those types; a successful build cannot establish compatibility with schema changes they do not contain.

## `futureProofEnums` changes the starting contract

The experiment also generates the unchanged and enum-extended schemas with `futureProofEnums: true`. In this pinned configuration, Code Generator adds `"%future added value"` to the enum union. The closed exhaustive switch therefore fails **even against the unchanged schema**; the stock fallback compiles in both cases.

That result is a generator-policy choice, separate from the `PREORDER` schema change. The catch-all type entry does not decode an unknown wire value or rewrite it into the sentinel string. The consumer still has to decide how to handle an unfamiliar value at runtime.

## What the evidence can establish

`report.json` records schema classifications, successful operation validation, tool versions, generator and compiler options, input and generated-file hashes, and each compiler's exit code and diagnostics. It contains no timestamps or absolute local paths. Repeated runs with the same inputs and toolchain produce the same JSON. When files are retained, `report.json` is written last as the completion marker; an existing output directory is never overwritten.

The runner snapshots and verifies its schema, operation and consumer inputs. Each generator/compiler child has a 30-second limit and bounded output. On interruption, the runner requests termination of the owned process tree and waits for the direct child to close before temporary-file cleanup. Expected type errors must match the complete diagnostic from the pinned compiler. Extra stdout or any stderr is a failed experiment, not evidence of the intended type error.

The fixtures accept a non-null `Product` or `availability` value via `NonNullable`; handling an absent product or availability at the caller is outside their scope. No query response is fetched, no runtime failure is demonstrated, and no production or employer result is claimed. **A valid operation can generate a changed type that an unchanged, stricter consumer no longer accepts.**

Implementation: [runner](../src/consumer-impact.ts), [generator worker](../src/consumer-impact-worker.ts), [process boundary](../src/consumer-impact-process.ts), [tests](../tests/consumer-impact.test.ts).

Primary references: [Code Generator programmatic API](https://the-guild.dev/graphql/codegen/docs/advanced/programmatic-usage), [TypeScript operations plugin](https://the-guild.dev/graphql/codegen/plugins/typescript/typescript-operations), [operations v6 migration and enum configuration](https://the-guild.dev/graphql/codegen/docs/migration/operations-and-client-preset-from-5-0), [TypeScript exhaustiveness checking](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#exhaustiveness-checking).
