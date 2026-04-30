# Findings: MockAzureContainer Improvements

## Current Mock Limitations (post-overhaul)

1. `getCountBy` query — still falls through and returns raw items (wrong shape). No `getCountBy` test exists yet. This is the remaining Phase 2 work.

2. The `mockDBFilters` entry in `getContainer()` (`c.val > @minValue`) is now redundant — `evaluateCondition` handles this natively. Should be removed in Phase 3 cleanup.

## Resolved Limitations

- `SELECT * FROM c WHERE (...)` — ✅ handled natively by `evaluateWhere` + built-in filter
- `SELECT VALUE COUNT(1) FROM c WHERE (...)` — ✅ handled natively
- `SELECT TOP n * FROM c [WHERE ...]` — ✅ handled via `topN` slice in `processQuery`
- `CONTAINS(c.field, @param, true)` — ✅ handled by `evaluateCondition`
- AND-joined multi-condition WHERE — ✅ handled by `evaluateWhere`

## Query Builder Output Format

`Query.whereCondition(field, op, value)` produces clauses like:

- `c.val > @val` with parameter `{ name: "@val", value: ... }`
- `CONTAINS(c.field, @field, true)` for CONTAINS op

When `Query.build()` is called with multiple conditions, WHERE is:

```
WHERE (c.x > @x) AND (c.y = @y)
```

Dot notation in field paths maps to underscores in param names (e.g., `facets.score` → `@facets_score`).

## Test Coverage Gaps

The test file currently covers:

- `getCount()` — no condition ✅
- `getCount([field, op, val])` — with condition ✅ (but via custom regex matcher)
- `getCountBy` — NOT TESTED at all
- `Query` with `top()` — NOT TESTED

## Key Implementation Note

The `_query` method receives `SqlQuerySpec` (always), and `pkey?` (string | undefined).

The WHERE parser just needs to:

1. Strip `SELECT ... FROM c` prefix and ` WHERE (...)` suffix
2. Split on `) AND (` to get individual conditions
3. For each condition, detect operator and resolve `@param` from `query.parameters`

`CONTAINS(c.field, @param, true)` can be detected with a regex.
Simple comparisons like `c.field op @param` can also be parsed with a regex.

## Approach for `getCountBy`

The `getCountBy` raw query: `SELECT c.{prop} AS name, COUNT(1) AS count FROM c WHERE IS_DEFINED(c.{prop}) GROUP BY c.{prop}`

A regex can extract `{prop}`. The implementation groups items by `item[prop]` and counts per group.

## Architecture (as implemented)

`processQuery` in `mockQueryProcessor.ts`:

1. Match query against `querySplitter` regex to extract `select`, `where`, `top`
2. Run `where` clause through `processDefs([...customFilters, ...builtInFilters])` to filter items
3. Run `select` clause through `processDefs([...customProjects, ...builtInProjects])` to shape output
4. Apply `TOP n` slice if present
5. `getCountBy` pattern does not yet fit this model — needs a pre-pass or dedicated handler

`processDefs` tries matchers in order: exact string match first, then `RegExp.match`. Built-in filter catches everything via `/^(.+)$/`.
