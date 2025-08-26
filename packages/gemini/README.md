# dry-utils-gemini

A collection of utilities for working with the Gemini API, focusing on structured responses, error handling, and logging.

I do not anticipate that you will find this repository useful. It is hyper-specific to my needs. If you do find something useful, feel free to use it, fork it, or liberally copy code out into your own projects.

## Installation

Prerequisites:

- Node.js >=22.0.0
- When using Gemini, you will need to set up a Gemini account and create an API key. The Gemini code expect .env to contain GEMINI_API_KEY, which is referenced directly in the Gemini SDK.

Install:

```bash
npm install dry-utils-gemini
```

## Features

- **JSON Schema Validation**: Create structured responses with Zod schemas
- **Prose Completions**: Generate text responses with simple API
- **Automatic Retries**: Built-in exponential backoff for rate limiting
- **Error Handling**: Comprehensive error handling for common API issues
- **Logging**: Detailed logging via `node:diagnostics_channel` for API calls, errors, and performance metrics.

## Usage

### JSON Completion

Generate structured responses with schema validation:

```typescript
import { jsonCompletion, z } from "dry-utils-gemini";

// Define a schema for the response
const recipeSchema = z
  .object({
    title: z.string(),
    ingredients: z.array(z.string()),
    steps: z.array(z.string()),
    prepTime: z.number(),
  })
  .describe("A recipe with ingredients and steps");

// Make a completion request
const result = await jsonCompletion(
  "GenerateRecipe", // Action name for logging
  "You are a helpful cooking assistant", // Initial prompt
  "Create a recipe for chocolate chip cookies", // User input
  recipeSchema // Schema for validation
);

if (result.content) {
  console.log("Recipe:", result.content);
}
```

### Prose Completion

Generate simple text responses:

```typescript
import { proseCompletion } from "dry-utils-gemini";

// Make a prose completion request
const result = await proseCompletion(
  "SummarizeArticle", // Action name for logging
  "You are a helpful summarization assistant", // Initial prompt
  "Summarize this article in 3 bullet points: " + articleText // User input
);

if (result.content) {
  console.log("Summary:", result.content);
}
```

### Schema Creation Helpers

Create Zod schemas with descriptions for Gemini:

```typescript
import { zObj, zString, zNumber, zBoolean, zObjArray } from "dry-utils-gemini";

// Create a schema with helper functions
const userSchema = zObj("User information", {
  name: zString("The user's full name"),
  age: zNumber("The user's age in years"),
  isPremium: zBoolean("Whether the user has a premium subscription"),
  addresses: zObjArray("List of user addresses", {
    street: zString("Street address"),
    city: zString("City name"),
    zipCode: zString("Postal code"),
  }),
});
```

### Logging

This package uses `node:diagnostics_channel` for logging. You can subscribe to these channels to receive log, error, and aggregate metric events.

- `GEMINI_LOG_CHANNEL`: For general log messages. The message is an object `{ tag: string, val: unknown }`.
- `GEMINI_ERR_CHANNEL`: For error messages. The message is an object `{ tag: string, val: unknown }`.
- `GEMINI_AGG_CHANNEL`: For aggregated metrics on API calls. The message is an object `{ tag: string, blob: Record<string, unknown>, dense: Record<string, unknown>, metrics: Record<string, number> }`.

Example:
```typescript
import { subscribe } from "node:diagnostics_channel";
import {
  GEMINI_LOG_CHANNEL,
  GEMINI_ERR_CHANNEL,
  GEMINI_AGG_CHANNEL,
} from "dry-utils-gemini";

// Subscribe to log events
subscribe(GEMINI_LOG_CHANNEL, ({ tag, val }) => {
  console.log(`[Gemini Log: ${tag}]`, val);
});

// Subscribe to error events
subscribe(GEMINI_ERR_CHANNEL, ({ tag, val }) => {
  console.error(`[Gemini Error: ${tag}]`, val);
});

// Subscribe to aggregate events
subscribe(GEMINI_AGG_CHANNEL, ({ tag, dense, metrics }) => {
  console.log(`[Gemini Aggregate: ${tag}]`, { dense, metrics });
});
```
