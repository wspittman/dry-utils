# Findings: MockAzureContainer Improvements

## Current Mock Limitations

1. `SELECT * FROM c WHERE (...)` — falls through to custom matchers. Since the mock matches `SELECT * FROM c` first (exact), any query with a WHERE clause doesn't hit that branch. It goes to custom matchers instead.

2. `SELECT VALUE COUNT(1) FROM c WHERE (...)` — same problem as above.

3. `SELECT TOP n * FROM c [WHERE ...]` — no support at all.

4. `getCountBy` query — falls through and returns raw items (wrong shape). The test file does NOT currently have a `getCountBy` test.

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

## Refactoring `_query`

Current `_query` has ad-hoc if/else branches for each query type. After changes, suggest organizing into prioritized handlers:

1. Check for `getCountBy` GROUP BY pattern
2. Try to parse as Query-builder SQL (extract selector + WHERE + TOP)
3. Fall through to custom matchers
4. Return all items as fallback
