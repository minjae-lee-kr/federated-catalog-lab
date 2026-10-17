# Which consumer does a schema change affect?

[한국어](schema-evolution.ko.md) · [Run the explorer](federation-explorer.md) · [Project overview](../README.md)

Run a hypothetical change against the checked-in API baseline and named consumer operations:

```sh
pnpm impact
pnpm impact --scenario weaken-name-nullability
pnpm impact --scenario remove-description --format json
```

For a JSON file without a package-manager command banner, redirect the Node entry point:

```sh
node src/schema-impact-cli.ts --format json > schema-impact.json
```

The command performs **in-memory schema analysis only**. It does not start servers, execute resolvers, modify SDL, refresh the baseline or approve a deployment. Exit `0` means the experiment completed—even when the selected hypothetical change is deliberately breaking. `pnpm contracts` remains the actual gate for the checked-in schema and operations.

## Read three independent results

| Synthetic change | Federation composition | API schema comparison | Named operations |
| --- | --- | --- | --- |
| Unchanged control | Composes | Compatible | Both validate |
| Add nullable `Product.subtitle` | Composes | Compatible | Both validate; neither selects the new field |
| Remove `Product.description` | Composes | Breaking | `CatalogOnly` is invalid; `CatalogCards` still validates |
| Weaken `Product.name: String!` to `String` | Composes | Breaking | Both still validate; both select the changed guarantee |
| Add required `Query.products(region: String!)` | Composes | Breaking | Both are invalid because neither supplies the argument |
| Add `StockStatus.PREORDER` | Composes | Review required | Both validate; only `CatalogCards` selects this enum |
| Give `Product.sku` incompatible types across subgraphs | Fails | **Not evaluated** | **Not evaluated** |

The most useful counterexample is the nullable name. A query can remain valid while the schema weakens a guarantee that generated client types or rendering code previously relied on:

```text
weaken-name-nullability: composition composed; schema breaking
  FIELD_CHANGED_KIND: Product.name changed type from String! to String.
  CatalogCards.graphql#CatalogCards: valid
    schema review: Product.name (String! -> String)
  CatalogOnly.graphql#CatalogOnly: valid
    schema review: Product.name (String! -> String)
```

This does **not** prove that either client will fail at runtime. The resolver may still return a name, or the client may already handle null. It identifies the changed contract and the consumers whose selections deserve review. GraphQL validation alone cannot answer that runtime question.

The [generated-consumer experiment](consumer-impact.md) follows this change through type regeneration and compilation of unchanged consumer files, with stale generated types as a control.

## What the JSON records

- The baseline schema digest and consumers identified by **document plus operation name**. Equal operation names in different files remain distinguishable.
- Structured Apollo composition errors, including their codes. A failed composition produces `null`/`not-evaluated` downstream results rather than empty arrays that look successful.
- GraphQL.js breaking and dangerous schema changes.
- Each operation's validation status, exact validation messages and source locations.
- Selected schema coordinates changed by these fixtures, including fields used through fragments and aliases. An alias changes the response key, not the schema coordinate.
- Separate lists of invalidated operations and still-valid operations that select changed schema coordinates.

`separateOperations` carries only each operation's referenced fragments. This matters when two consumers live in one document: deleting a field used by one fragment must not incorrectly blame the other operation. The baseline document is validated first, so duplicate names, invalid fragments or broken baseline queries cannot be mistaken for regressions caused by the candidate schema.

## Boundaries of the analysis

The field/type/enum projection is intentionally scoped to this lab's scenarios. It is not a complete schema usage analyzer, a traffic-based consumer registry or a substitute for established schema-checking services. Conditional selections are included conservatively; the tool does not know which variables a real caller will send.

The seven changes are applied through GraphQL AST edits to copies of the source SDL. Fixture preconditions fail visibly when the expected source field has drifted. The baseline is never silently rewritten to make a check pass.

The tests include unaffected consumers, alias/fragment use, multiple operations per file, identical names across files, invalid baseline documents, failed composition, deterministic output and unchanged source artifacts. They verify the distinction between these layers; they do not test business semantics, authorization or every possible schema evolution.

## Implementation and primary references

- `src/evolution-scenarios.ts`: explicit synthetic AST changes.
- `src/schema-impact.ts`: baseline validation, operation separation, schema comparison and selected-coordinate mapping.
- `src/schema-impact-cli.ts`: text/JSON reporting without writes.
- [GraphQL validation](https://www.graphql.org/learn/validation/): structural validation is a separate stage from execution.
- [GraphQL schemas and types](https://www.graphql.org/learn/schema/): nullable output and required argument contracts.
- [GraphQL.js 16 utilities](https://www.graphql-js.org/api-v16/utilities/): the installed `16.14.2` APIs used here are `separateOperations`, `findBreakingChanges`, `findDangerousChanges` and `TypeInfo`.
