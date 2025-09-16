# dry-utils-openai

A collection of utilities for working with the OpenAI API, focusing on structured responses, error handling, and logging.

I do not anticipate that you will find this repository useful. It is hyper-specific to my needs. If you do find something useful, feel free to use it, fork it, or liberally copy code out into your own projects.

## Installation

Prerequisites:

- Node.js >=22.0.0
- When using OpenAI, you will need to set up an OpenAI account and create an API key. The OpenAI code expect .env to contain OPENAI_API_KEY, which is referenced directly in the OpenAI SDK.

Install:

```bash
npm install dry-utils-openai
```

## Features

- **Structured JSON Responses**: Create structured responses with Zod schemas using `json_schema` mode.
- **Tool Use**: Define tools that the model can call and receive structured arguments.
- **Prose Completions**: Generate text responses with a simple API.
- **Automatic Retries**: Built-in exponential backoff for rate limiting.
- **Error Handling**: Comprehensive error handling for common API issues.
- **Logging**: Detailed logging via `node:diagnostics_channel` for API calls, errors, and performance metrics.

## Usage

### JSON Completion

Generate structured responses with schema validation. You can also provide additional context and specify a model.

```typescript
import { jsonCompletion, z } from "dry-utils-openai";

// Define a schema for the response
const recipeSchema = z
  .object({
    title: z.string(),
    ingredients: z.array(z.string()),
    steps: z.array(z.string()),
    prepTime: z.number(),
  })
  .describe("A recipe with ingredients and steps");

// Optional: Provide additional context for the model
const context = [
  {
    description: "Dietary preferences",
    content: {
      diet: "vegan",
      allergies: ["nuts"],
    },
  },
];

// Make a completion request
const result = await jsonCompletion(
  "GenerateRecipe", // Action name for logging
  "You are a helpful cooking assistant", // Initial prompt
  "Create a recipe for chocolate chip cookies", // User input
  recipeSchema, // Schema for validation
  {
    model: "gpt-4-turbo", // Specify the model to use
    context,
  }
);

if (result.content) {
  console.log("Recipe:", result.content);
}
```

### Prose Completion

Generate simple text responses:

```typescript
import { proseCompletion } from "dry-utils-openai";

// Make a prose completion request
const result = await proseCompletion(
  "SummarizeArticle", // Action name for logging
  "You are a helpful summarization assistant", // Initial prompt
  "Summarize this article in 3 bullet points: " + articleText, // User input
  { model: "gpt-4-turbo" }
);

if (result.content) {
  console.log("Summary:", result.content);
}
```

### Tool Use

Define tools that the model can call during a completion.

```typescript
import { jsonCompletion, z, zObj, zString } from "dry-utils-openai";

// Define a tool
const searchTool = {
  name: "searchWeb",
  description: "Search the web for information",
  parameters: zObj("Search parameters", {
    query: zString("The search query"),
  }),
};

// Make a completion request with the tool
const result = await jsonCompletion(
  "WebSearch",
  "You are a helpful assistant.",
  "Search the web for the capital of France.",
  zObj("Response", {
    answer: zString("The answer to the user's question"),
  }),
  {
    tools: [searchTool],
  }
);

if (result.toolCalls) {
  for (const toolCall of result.toolCalls) {
    console.log(`Tool call: ${toolCall.name}`, toolCall.args);
    // You would typically execute the tool here and return the result
    // to the model in a subsequent call.
  }
}
```

### Schema Creation Helpers

Create Zod schemas with descriptions for OpenAI:

```typescript
import { zObj, zString, zNumber, zBoolean, zObjArray } from "dry-utils-openai";

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

- `OPENAI_LOG_CHANNEL`: For general log messages. The message is an object `{ tag: string, val: unknown }`.
- `OPENAI_ERR_CHANNEL`: For error messages. The message is an object `{ tag: string, val: unknown }`.
- `OPENAI_AGG_CHANNEL`: For aggregated metrics on API calls. The message is an object `{ tag: string, blob: Record<string, unknown>, dense: Record<string, unknown>, metrics: Record<string, number> }`.

Example:
```typescript
import { subscribe } from "node:diagnostics_channel";
import {
  OPENAI_LOG_CHANNEL,
  OPENAI_ERR_CHANNEL,
  OPENAI_AGG_CHANNEL,
} from "dry-utils-openai";

// Subscribe to log events
subscribe(OPENAI_LOG_CHANNEL, ({ tag, val }) => {
  console.log(`[OpenAI Log: ${tag}]`, val);
});

// Subscribe to error events
subscribe(OPENAI_ERR_CHANNEL, ({ tag, val }) => {
  console.error(`[OpenAI Error: ${tag}]`, val);
});

// Subscribe to aggregate events
subscribe(OPENAI_AGG_CHANNEL, ({ tag, dense, metrics }) => {
  console.log(`[OpenAI Aggregate: ${tag}]`, { dense, metrics });
});
```