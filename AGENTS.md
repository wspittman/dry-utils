# Project Overview

This is a TypeScript monorepo containing a collection of independent utility packages. The goal of this repository is to provide a set of reusable and well-tested utilities for common development tasks.

## Packages

The monorepo is structured with the following packages:

- **async**: Utilities for handling common asynchronous programming patterns.
- **cosmosdb**: Abstractions for simplified CosmosDB interactions.
- **gemini**: Utilities for working with the Gemini API.
- **logger**: A Winston wrapper for simplified logging.
- **openai**: Utilities for working with the OpenAI API.
- **text**: HTML and Markdown conversion utilities with sanitization.

## Building and Running

### Prerequisites

- Node.js >=22.0.0

### Installation

To install the dependencies for all packages, run the following command from the root of the repository:

```sh
npm install
```

### Building

To build all packages, run the following command from the root of the repository:

```sh
npm run build
```

### Testing

To run the tests for all packages, run the following command from the root of the repository:

```sh
npm run test
```

To run the end-to-end tests for all packages, run the following command from the root of the repository:

```sh
npm run e2e
```

## Development Conventions

### TypeScript

The project uses TypeScript with strict type checking. The `tsconfig.json` file in the root of the repository contains the base compiler options for all packages. Each package also has its own `tsconfig.json` file that extends the base configuration.

### Comments

Use JSDoc comments for all public APIs and complex logic. This helps with code readability and provides useful information for developers using the code. Go light on comments otherwise. Never put comments at the end of lines.

### Dependencies

Avoid adding new dependencies and warn when you do.

### Linting

The project uses ESLint for linting. The `.eslintrc.js` file in the root of the repository contains the base linting rules for all packages.

### Testing

Our tests are always written in Node's built-in `node:test` framework.
