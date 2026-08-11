# Where Expression Tree Migration Plan

## Goal

Replace the CosmosDB package's tuple-based `Where` API and mutable `Query`
builder with a composable `Where` expression-tree class and a one-shot,
options-based `Query` API. The resulting API must support nested `AND`/`OR`
groups, allocate collision-free parameters during one build traversal, and
update all repository callers, tests, exports, and documentation as a breaking
change.

## Confirmed Decisions

- Move `Where` into `packages/cosmosdb/src/Where.ts`.
- Export `RawWhere`, but provide no compatibility alias for the old `Where`
  tuple.
- Expose `Where.is`, `Where.raw`, `Where.any`, and `Where.all`.
- Treat raw clauses as self-contained while keeping validation lenient:
  declared names must start with `@`; declared parameters absent from the SQL
  clause are removed using a regex check; undeclared SQL parameter tokens are
  left for CosmosDB to validate.
- Build all query predicates once with
  `Where.all(this.#whereClauses).build()` so one depth-first counter owns all
  generated parameter names.
- Remove fluent `where*` methods and replace the remaining query configuration
  methods with an options-based, one-shot `Query` API after auditing callers.
- Add no new dependencies.

## Phases

### Phase 1: Repository audit and final API design — complete

- Inspect `Query`, package exports, package documentation, tests, mocks, and all
  repository call sites.
- Record current behaviors that must be preserved or intentionally broken.
- Define the exact `Where` tree, `Query` options, build output, validation, and
  migration mapping.

### Phase 2: Red/green tests for `Where` and the new `Query` API — complete

- Use the `write-unit-test` skill before editing tests.
- Replace tuple/builder expectations with tests for condition leaves, raw
  leaves, nested groups, deterministic global parameter allocation, raw
  parameter filtering, and invalid declared names.
- Update affected container/mock tests to express the new public API.
- Run the CosmosDB workspace tests and confirm failures are caused by the
  intentionally missing implementation.

### Phase 3: Implement `Where` and simplify `Query` — complete

- Add the immutable expression-tree implementation in `src/Where.ts`.
- Move condition rendering and operator types out of `Query.ts` as appropriate.
- Replace mutable `Query` configuration with the final options-based API.
- Build all predicates through a single root `Where.all(...)` traversal.
- Remove obsolete mutable parameter and fluent builder code.
- Run targeted CosmosDB tests until green.

### Phase 4: Migrate callers, exports, mocks, and documentation — complete

- Update all repository call sites to construct queries in one shot.
- Update package exports and type exports without a legacy alias.
- Adapt mock-query behavior if generated parameter naming affects it.
- Rewrite the CosmosDB README examples and API descriptions.
- Add a root `Learnings.md` entry only if implementation reveals a non-obvious
  repository fact not already captured by instructions or documentation.

### Phase 5: Full verification and delivery — complete

- Review all three plan files for accuracy and mark phases complete.
- Run targeted tests, build/type checks as useful, and mandatory
  `npm run pre-checkin`.
- Review the final diff for accidental compatibility remnants or stale docs.
- Commit the changes on the current branch and create a pull request.

## Validated Design

- `RawWhere` remains a SQL fragment tuple with an optional parameter record.
- `WhereInput` accepts `Condition | RawWhere | Where`.
- `Where` stores private discriminated nodes rather than eagerly rendered SQL.
- A build traversal assigns opaque names such as `@p0`, `@p1`, and so on.
- Raw declared parameters are rewritten to generated names only when their
  exact token occurs in the raw clause.
- `Where.any([])` and `Where.all([])` reject empty groups; query construction
  without filters handles the empty root separately and omits `WHERE`.
- `Query` should become a value-like object configured entirely at
  construction and built without being passed around or incrementally mutated.
- `QueryOptions` has `select`, `top`, list-valued `where`, and list-valued
  `orderBy` properties; `Query` retains `build()` but no configuration methods.

## Errors Encountered

| Error | Attempt | Resolution |
| --- | --- | --- |
| CosmosDB tests fail because `src/Where.ts` and its public export do not exist | 1 | Confirmed with the detailed reporter that this is the intended red state; implementation is Phase 3. |
| ESLint inferred array entries as `any` after `Array.isArray` | 1 | An explicit annotation remained unsafe; attempt 2 added a `JSONValue[]` type guard so narrowing retains the element type. |
| CosmosDB build reports legacy `container.ts` constructor calls and the stale index export | 1 | Confirmed these are the caller/export migrations assigned to Phase 4; fixed the unrelated optional raw-parameter typing in `Query`. |
| Combined Phase 4 plan-file patch did not match findings context | 1 | Re-read the file tails and applied smaller patches against the exact current text. |
| CosmosDB E2E suite could not open `cosmosdbcert.cer` | 1 | Recorded as an environment limitation; unit tests and full pre-checkin remain authoritative in this container. |
