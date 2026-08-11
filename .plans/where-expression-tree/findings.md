# Findings: Where Expression Tree Migration

## User Requirements and Decisions

- This is intentionally a breaking API change.
- Boolean composition belongs in a standalone `Where` class.
- Public factories are `Where.is`, `Where.raw`, `Where.any`, and `Where.all`.
- Query-level predicates are combined and built once using
  `Where.all(this.#whereClauses).build()`.
- Raw predicates are self-contained by contract, but validation stays narrow:
  reject declared names without `@`, discard declared parameters not found in
  the clause via regex, and let CosmosDB diagnose undeclared tokens.
- The fluent `Query.where*`, `select`, `top`, and `orderBy` style should be
  replaced by constructor options if the caller audit confirms that queries
  are not incrementally passed around.
- `Where` gets its own module and the old tuple receives no compatibility alias.

## Existing Implementation Known Before Audit

- `Query` currently stores flat SQL strings and a query-wide parameter object.
- Each `where()` call appends a string and merges parameters eagerly.
- `build()` parenthesizes all stored strings and joins them with `AND`.
- `Query.condition()` eagerly derives parameter names from field paths, which
  causes collisions for repeated conditions on the same field.

## Audit Notes

### Query call sites

- All repository production and test call sites were enumerated with `rg`.
- Callers build query values inline and do not pass a partially configured
  `Query` around, confirming that a one-shot options API fits current usage.
- The only selector modes in callers/tests are the existing `*`, `ID`, and
  `COUNT`; the only ordering configuration is a field plus optional direction;
  the only limit configuration is `top`.
- `Container` accepts `Query | SqlQuerySpec` and immediately calls `build()` for
  a `Query`, so the public transport boundary can remain unchanged.
- E2E usage contains `new Query("COUNT", condition)` and must migrate with the
  unit tests and README examples.

### Mock query processing

- Mock tests inspect the final SQL and parameter arrays, not `Query` internals.
- The mock parser recognizes parameter tokens generically, so opaque `@pN`
  names should work; expectations and custom query definitions using exact SQL
  will still need migration.

### API design conclusions

- Use `QueryOptions` with `select`, `top`, `where`, and `orderBy`. `where` is a
  readonly list of inputs normalized through a root `Where.all`; `orderBy` is a
  readonly list of `[field, direction?]` tuples so multi-column ordering remains
  possible without fluent calls.
- To avoid tuple ambiguity, prefer `where: readonly WhereInput[]` consistently;
  a condition tuple alone is otherwise also an array at runtime.
- Preserve `new Query()` as the empty default and use
  `new Query({ ...options })` for configured queries.
- Keep selector values aligned with current behavior (`"*"`, `"ID"`, and
  `"COUNT"`) unless implementation review finds a strong reason to rename.
- Model empty root conjunction separately in `Query.build()` so an unfiltered
  query omits `WHERE`; public `Where.any([])` and `Where.all([])` should reject
  empty groups to avoid inventing SQL Boolean identities.
- `Where.build()` should be deterministic and non-mutating. Every query build
  creates a fresh counter and parameter record.
- Raw-parameter presence checks and replacements need escaped exact-token regex
  matching with `(?![A-Za-z0-9_])`. This boundary lets parameters retain record
  insertion order while preventing `@tag` from matching `@tag_detail`.

### Test contract added in Phase 2

- `Where.build()` returns a `RawWhere` using deterministic depth-first names
  `@p0`, `@p1`, and so on, and repeated builds return identical results.
- Single-child `any` and `all` groups render as the child without redundant
  group syntax; multi-child and nested groups parenthesize every child.
- Structured conditions preserve the existing operators and property-path
  validation, including non-empty requirements for multi-value operators.
- Raw parameters are renamed in record insertion order, unused declarations are
  discarded, invalid declared names are rejected, and undeclared tokens remain
  untouched.
- `QueryOptions` uses `select`, `top`, `where`, and tuple-valued `orderBy`; one
  query-level build sequence spans structured, raw, and nested predicates.
- A mock-container integration test covers a scalar predicate combined with a
  nested `Where.any` group.

### Implementation notes from Phase 3

- `Where` stores condition, raw, and group nodes and renders them recursively
  with a build-local counter and parameter record.
- `Where.all(this.#whereClauses).build()` gives `Query` one allocation context
  across all top-level predicates without exposing a build-context API.
- Raw parameter declarations are visited in record insertion order. An escaped
  global regex with an identifier boundary both detects usage and rewrites all
  occurrences to the allocated name.
- `Query` now validates and stores constructor options once and exposes only
  `build()`; it no longer owns a mutable parameter record or configuration
  methods.
- The focused `Where` and `Query` suites pass. The package build remains red on
  the legacy `Container` constructor calls and stale package export, which are
  explicitly assigned to Phase 4.

### Migration notes from Phase 4

- Repository callers construct queries inline, so every fluent call migrated
  directly to the equivalent `QueryOptions` property without compatibility
  helpers.
- Spatial predicates now use self-contained `Where.raw` inputs; there is no
  special-purpose distance method in the new API.
- Opaque parameter renaming means tests and custom mock matchers must target the
  final `@pN` names rather than names supplied to raw predicates.
- The mock's previous direct `AND` split could not evaluate nested OR groups.
  Recursive evaluation now splits `OR` and then `AND` only at parenthesis depth
  zero, preserving SQL precedence for expressions emitted by `Where`.
- `Where` and all related public types are exported directly from `Where.ts`;
  the old tuple export has no alias.
