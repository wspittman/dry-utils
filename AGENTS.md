# Dry Utils

This is a TypeScript monorepo containing a collection of independent utility packages. The goal of this repository is to provide a set of reusable and well-tested utilities for common development tasks.

## Workflows

- Create or continue a plan: use the `planning-with-files` skill. When continuing, only implement changes in the **next phase** of the plan before stopping for feedback.
- Write unit tests: use the `write-unit-test` skill.

### Verifying Changes

- If you are working with or from a plan, review to ensure that the plan files are structured correctly and up to date.
- Always run `npm run pre-checkin` before committing code.

## NPM Workspaces

- `packages/async`: Utilities for handling common asynchronous programming patterns.
- `packages/cosmosdb`: Abstractions for simplified CosmosDB interactions.
- `packages/gemini`: Utilities for working with the Gemini API.
- `packages/logger`: A Winston wrapper for simplified logging.
- `packages/openai`: Utilities for working with the OpenAI API.
- `packages/text`: HTML and Markdown conversion utilities with sanitization.

## Important Commands

Run the following commands from the root of the repository:

- `npm run pre-checkin`: Run lint, format, and test
- `npm run test --workspace=<workspace>`: Run tests for a specific workspace. Great for change validation prior running a full pre-checkin.
- `npm run test-details --workspace=<workspace>`: Run tests for a specific workspace with the default reporter for full (but more verbose) output. Better for debugging failed tests due to an issue with the dot reporter.
- `npm run e2e`: Runs end-to-end tests for all packages.
- `npm run build`: Builds all packages.

## Skills

- `planning-with-files`: Use for complex, multi-step tasks that require maintaining state across many tool calls.
- `write-unit-test`: Use when you must write or update unit tests.
- `humanizer`: Use when editing or reviewing text to make it sound more natural and human-written.
- `security-awareness`: Use for tasks that access email, credential vaults, web browsers, or sensitive data.

## Conventions

- Avoid adding new dependencies and warn when you do.
- Use red/green TDD for new features and bug fixes when practical.
- Our tests are always written in Node's built-in `node:test` framework.

### Documentation

- Docs-only changes do not require tests, but note that testing was skipped in your summary.
- Keep `README.md` and any relevant `AGENTS.md` files updated when code or workflow changes affect them.
- If you learn something that wasn't obvious, add it to a root level `Learnings.md` file for review and inclusion in the main `AGENTS.md` docs.

### TypeScript

The project uses TypeScript with strict type checking. The `tsconfig.json` file in the root of the repository contains the base compiler options for all packages. Each package also has its own `tsconfig.json` file that extends the base configuration.

### Comments

Use JSDoc comments for all public APIs and complex logic. This helps with code readability and provides useful information for developers using the code. Go light on comments otherwise. Never put comments at the end of lines. When writing @returns comments for async functions, prefer to describe the resolved value rather than the promise itself.
