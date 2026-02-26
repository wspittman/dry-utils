# Project Overview

This is a TypeScript monorepo containing a collection of independent utility packages. The goal of this repository is to provide a set of reusable and well-tested utilities for common development tasks.

## Workspaces

- `packages/async`: Utilities for handling common asynchronous programming patterns.
- `packages/cosmosdb`: Abstractions for simplified CosmosDB interactions.
- `packages/gemini`: Utilities for working with the Gemini API.
- `packages/logger`: A Winston wrapper for simplified logging.
- `packages/openai`: Utilities for working with the OpenAI API.
- `packages/text`: HTML and Markdown conversion utilities with sanitization.

# Building and Running

## Prerequisites

- Node.js >=24.0.0
- For `packages/cosmosdb`, a Azure CosmosDB Emulator or an Azure CosmosDB account

## Installation

Install dependencies from the root directory:

```bash
npm install
```

## Available Commands

Run the following commands from the root of the repository:

- `npm run pre-checkin`: Runs lint, format:write, and test
- `npm run lint`: Lints all packages.
- `npm run format`: Checks code formatting for all packages.
- `npm run format:write`: Formats code for all packages.
- `npm run test`: Runs tests for all packages.
- `npm run e2e`: Runs end-to-end tests for all packages.
- `npm run build`: Builds all packages.

Individual packages support all of these commands except for `npm run pre-checkin`.

# Development Conventions

- The project uses a monorepo structure using npm workspaces.
- Documentation: Keep `README.md` and any relevant `AGENTS.md` files updated when code or workflow changes affect them.
- Dependencies: Avoid adding new dependencies and warn when you do.
- Quality checks: Always run `npm run pre-checkin` before committing code.
- Knowledge sharing: If you learn something that wasn't obvious, add it to a root level `Learnings.md` file for review and inclusion in the main `AGENTS.md` docs.

## TypeScript

The project uses TypeScript with strict type checking. The `tsconfig.json` file in the root of the repository contains the base compiler options for all packages. Each package also has its own `tsconfig.json` file that extends the base configuration.

## Comments

Use JSDoc comments for all public APIs and complex logic. This helps with code readability and provides useful information for developers using the code. Go light on comments otherwise. Never put comments at the end of lines. When writing @returns comments for async functions, prefer to describe the resolved value rather than the promise itself.

## Testing

- Our tests are always written in Node's built-in `node:test` framework.
- Use red/green TDD whenever possible.
- Docs-only changes do not require tests, but note that testing was skipped in your summary.
