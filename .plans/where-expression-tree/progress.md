# Progress: Where Expression Tree Migration

## 2026-08-11

- Read the root repository instructions and the `planning-with-files` skill.
- Confirmed there were no existing plan files and the working tree was clean.
- Created this task's three planning files before implementation work.
- Completed Phase 1 by auditing source, exports, README examples, tests, mocks,
  container boundaries, and all repository `Query` callers.
- Refined the future API around a `QueryOptions` object with list-valued
  `where` and `orderBy` properties and a standalone immutable `Where` tree.
- No production or test code was changed; implementation intentionally stops
  before Phase 2 for feedback, as required by the repository phased-plan
  workflow.

## 2026-08-11 — Phase 2

- Read the `write-unit-test` skill and its Node test style reference before
  editing tests.
- Replaced the legacy fluent-builder query tests with the desired one-shot
  `QueryOptions` contract.
- Added focused `Where` tests for all existing structured operators, raw clause
  handling, exact parameter replacement, nested groups, empty/single groups,
  and deterministic builds.
- Added a mock-container integration test for nested OR evaluation through the
  future public export.
- Confirmed the suite is red only at the expected implementation boundary:
  `Where.ts` and the `Where` package export do not exist yet. Stopped before
  Phase 3 implementation for feedback.

## 2026-08-11 — Phase 3

- Added `src/Where.ts` with an immutable private expression tree and public
  `is`, `raw`, `any`, `all`, and `build` APIs.
- Implemented one-pass, depth-first `@pN` allocation for structured and raw
  parameters, including unused raw declaration filtering and exact token
  replacement.
- Replaced the mutable fluent `Query` implementation with immutable
  constructor options and a single root `Where.all(...).build()` call.
- Confirmed all 33 focused `Where` and `Query` tests pass and CosmosDB lint is
  green.
- Confirmed the remaining build failures are limited to the Phase 4 caller and
  package-export migration. Stopped before Phase 4 for feedback.

## 2026-08-11 — Phase 4

- Migrated production `Container`, CosmosDB unit tests, and end-to-end tests to
  one-shot `QueryOptions` construction.
- Exported `Where`, `Query`, and their new supporting types directly from the
  package entry point without a compatibility alias.
- Extended the mock query processor to recursively evaluate nested `AND` and
  `OR` groups at the correct parenthesis depth.
- Updated parameter-sensitive mock expectations and custom matchers for opaque
  `@pN` names.
- Rewrote the README query, spatial, full-text, and mock examples for the new
  API.
- Added the non-obvious mock Boolean parsing constraint to root `Learnings.md`.
- CosmosDB lint, build, and all 169 workspace tests now pass. Stopped before
  Phase 5 full-repository verification for feedback.

## 2026-08-11 — Phase 5

- Re-read the complete plan and reviewed the cumulative branch diff.
- Confirmed no production, test, E2E, or README callers retain the removed
  fluent API and no compatibility alias or migration TODO remains.
- Attempted the CosmosDB E2E suite; it cannot run in this environment because
  `packages/cosmosdb/cosmosdbcert.cer` is absent, preventing database setup.
- Re-ran mandatory full-repository pre-checkin successfully.
- Reviewed all plan files, marked every phase complete, and prepared the final
  delivery commit.

## Verification Log

| Command | Result |
| --- | --- |
| `git status --short --branch` | Passed; branch `work` was clean before plan creation. |
| `find . -maxdepth 2 -type f ...` | Passed; no prior plan files found. |
| `rg -n "new Query|Query\\(" packages --glob '*.{ts,tsx,js,mjs,cjs,md}'` | Passed; caller inventory captured. |
| `rg -n "whereCondition|whereDistance|\\.where\\(|\\.top\\(|\\.select\\(|\\.orderBy\\(" packages/cosmosdb --glob '*.{ts,md}'` | Passed; fluent API usage inventoried. |
| Source and package metadata reads with `sed`, `cat`, and `nl` | Passed; API boundaries and scripts recorded. |
| `npm run pre-checkin` | Passed after plan-file formatting; 267 tests passed. |
| `npm run format --workspace=dry-utils-cosmosdb -- --log-level silent` | Passed after adding the Phase 2 tests. |
| `npm run test --workspace=dry-utils-cosmosdb` | Expected red state: 61 existing tests passed and the three files importing the future `Where` API failed. |
| `npm run test-details --workspace=dry-utils-cosmosdb` | Expected red state confirmed: failures are missing `src/Where.ts` and missing `Where` export only. |
| `npm run pre-checkin` | Expected red state: lint and formatting passed; the test stage stopped on the same three missing-implementation failures. |
| `node --import tsx --test packages/cosmosdb/test/query.test.ts packages/cosmosdb/test/where.test.ts` | Passed; 33 tests passed. |
| `npm run lint --workspace=dry-utils-cosmosdb` | Passed after retaining JSON array element types through an explicit type guard. |
| `npm run build --workspace=dry-utils-cosmosdb` | Expected Phase 4 failure: only legacy `Container` constructor calls and the stale `Where` index export remain. |
| `npm run pre-checkin` | Expected Phase 4 failure: lint and formatting passed; only the unmigrated container test file failed during tests. |
| `npm run test --workspace=dry-utils-cosmosdb` | Passed after caller and mock migration; 169 tests passed. |
| `npm run build --workspace=dry-utils-cosmosdb` | Passed after production callers and exports migrated. |
| `npm run lint --workspace=dry-utils-cosmosdb` | Passed after the Phase 4 migration. |
| `npm run pre-checkin` | Passed after Phase 4; all workspace lint, formatting, tests, and builds succeeded. |
| `rg` stale-API and compatibility scans | Passed; only the supported zero-option `new Query()` test remains. |
| `npm run e2e --workspace=dry-utils-cosmosdb` | Environment warning: database setup could not open the absent `cosmosdbcert.cer`. |

## Files Created

- `.plans/where-expression-tree/task_plan.md`
- `.plans/where-expression-tree/findings.md`
- `.plans/where-expression-tree/progress.md`

## Files Modified in Phase 2

- `packages/cosmosdb/test/query.test.ts`
- `packages/cosmosdb/test/container.test.ts`

## Files Created in Phase 2

- `packages/cosmosdb/test/where.test.ts`

## Files Modified in Phase 3

- `packages/cosmosdb/src/Query.ts`
- `.plans/where-expression-tree/task_plan.md`
- `.plans/where-expression-tree/findings.md`
- `.plans/where-expression-tree/progress.md`

## Files Created in Phase 3

- `packages/cosmosdb/src/Where.ts`

## Files Modified in Phase 4

- `packages/cosmosdb/README.md`
- `packages/cosmosdb/e2e/cosmos.test.ts`
- `packages/cosmosdb/src/container.ts`
- `packages/cosmosdb/src/index.ts`
- `packages/cosmosdb/src/mockQueryProcessor.ts`
- `packages/cosmosdb/test/container.test.ts`
- `.plans/where-expression-tree/task_plan.md`
- `.plans/where-expression-tree/findings.md`
- `.plans/where-expression-tree/progress.md`

## Files Created in Phase 4

- `Learnings.md`
