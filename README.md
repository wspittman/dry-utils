# dry-utils

This repository contains a variety of abstractions and helpers for my projects. It is an evolving collection of utilities that I find myself otherwise copying and pasting between projects. The goal is to make it easier to share code between projects, and to make it easier to use the same code in different contexts.

I do not anticipate that you will find this repository useful. It is hyper-specific to my needs. If you do find something useful, feel free to use it, fork it, or liberally copy code out into your own projects.

## Packages

This repository is structured as a monorepo containing several packages:

- [dry-utils-async](#dry-utils-async) - Utilities for handling common asynchronous programming patterns
- [dry-utils-cosmosdb](#dry-utils-cosmosdb) - CosmosDB abstractions for simplified database interactions
- [dry-utils-gemini](#dry-utils-gemini) - Utilities for working with the Gemini API
- [dry-utils-logger](#dry-utils-logger) - Winston wrapper logger with simplified configuration
- [dry-utils-openai](#dry-utils-openai) - Utilities for working with the OpenAI API
- [dry-utils-text](#dry-utils-text) - HTML and Markdown conversion utilities with sanitization

## Prerequisites

All packages require Node.js >=22.0.0

### CosmosDB

- [Azure CosmosDB Emulator](https://learn.microsoft.com/en-us/azure/cosmos-db/local-emulator)
- [Azure CosmosDB Account](https://azure.microsoft.com/en-us/services/cosmos-db/)

CosmosDB has a local emulator that you can use for development. These instructions have been used on a direct-install emulator on Windows 10. A similar process should work on other versions of Windows or using the Docker-hosted emulator.

- Install the [Azure CosmosDB Emulator](https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-develop-emulator)
- Export the Azure CosmosDB Emulator certificate
  - Open the Windows Certificate Manager
  - Navigate to `Trusted Root Certification Authorities` > `Certificates`
  - Find the certificate for Issued To: `localhost`, Friendly Name: `DocumentDbEmulatorCertificate`
  - Right-click the certificate and select `All Tasks` > `Export...`
  - No, do not export the private key
  - Base-64 encoded X.509 (.CER)
  - Save the file

### Gemini

When using Gemini, you will need to setup a Gemini account and create an API key. The Gemini code expects .env to contain GEMINI_API_KEY, which is referenced directly in the dry-utils-gemini package.

### OpenAI

When using OpenAI, you will need to setup an OpenAI account and create an API key. The OpenAI code expects .env to contain OPENAI_API_KEY, which is referenced directly in the OpenAI SDK.

## Installation

dry-utils packages are available on npm.

```sh
# Install the specific package you need
npm install dry-utils-async
npm install dry-utils-cosmosdb
npm install dry-utils-gemini
npm install dry-utils-logger
npm install dry-utils-openai
npm install dry-utils-text
```

## Package Details

### dry-utils-async

A collection of async utilities for handling common asynchronous programming patterns.

**Features:**

- Batch Processing: Process arrays of items in controlled batches with built-in error handling
- Logging: Configurable logging for async operations

[View dry-utils-async documentation](./packages/async/README.md)

### dry-utils-cosmosdb

CosmosDB abstractions for simplified database interactions.

**Features:**

- Container Management: Simplified container creation and initialization
- Query Builder: Helper class for building SQL queries with best practices
- CRUD Operations: Streamlined item operations (create, read, update, delete)
- Logging: Built-in logging for database operations with RU consumption tracking

[View dry-utils-cosmosdb documentation](./packages/cosmosdb/README.md)

### dry-utils-gemini

Utilities for working with the Gemini API, focusing on structured responses, error handling, and logging.

**Features:**

- JSON Schema Validation: Create structured responses with Zod schemas
- Prose Completions: Generate text responses with simple API
- Automatic Retries: Built-in exponential backoff for rate limiting
- Error Handling: Comprehensive error handling for common API issues

[View dry-utils-gemini documentation](./packages/gemini/README.md)

### dry-utils-logger

A Winston wrapper logger for Node.js applications with simplified configuration.

**Features:**

- Simplified API: Easy-to-use wrapper around Winston
- Dual Output: Console-friendly simplified output and detailed file logging
- Smart Formatting: Automatically simplifies complex objects for console output
- Configurable: Customize log levels for different transport methods

[View dry-utils-logger documentation](./packages/logger/README.md)

### dry-utils-openai

Utilities for working with the OpenAI API, focusing on structured responses, error handling, and logging.

**Features:**

- JSON Schema Validation: Create structured responses with Zod schemas
- Prose Completions: Generate text responses with simple API
- Automatic Retries: Built-in exponential backoff for rate limiting
- Error Handling: Comprehensive error handling for common API issues

[View dry-utils-openai documentation](./packages/openai/README.md)

### dry-utils-text

HTML and Markdown conversion utilities with sanitization for safe rendering.

**Features:**

- Markdown to HTML: Convert Markdown content to sanitized HTML
- HTML Sanitization: Clean and sanitize HTML content for secure rendering
- HTML Standardization: Normalize untrusted HTML through a Markdown conversion cycle

[View dry-utils-text documentation](./packages/text/README.md)

## Development Scripts

This monorepo provides several npm scripts to help with development:

- `npm run clean` - Clean the repository by removing all untracked files and directories
- `npm run build` - Build all packages in the monorepo
- `npm run test` - Run tests for all packages
- `npm run e2e` - Run end-to-end tests for all packages
- `npm run link` - Create symbolic links for all packages to use them locally
- `npm run unlink` - Remove symbolic links created by the link command
- `npm run publish-packages` - Publish packages to npm registry
