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
- **Prose Completions**: Generate text responses with a simple API.
- **Tool Use**: Define tools that the model can call and receive structured arguments.
- **Conversation Threads**: Maintain conversation history by passing the thread between calls.
- **Embeddings**: Generate text embeddings with automatic retries and diagnostics logging.
- **Automatic Retries**: Built-in exponential backoff for rate limiting.
- **Error Handling**: Comprehensive error handling for common API issues.
- **Logging**: Detailed logging via `node:diagnostics_channel` for API calls, errors, and performance metrics.

## Usage

### JSON Completion

Generate structured responses with schema validation. You can also provide additional context and specify a model.

Completions default to `gpt-5-nano` and return the `thread` that you can feed back into later calls.

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
    model: "gpt-4.1", // Override the default model when needed
    context,
  }
);

if (result.content) {
  console.log("Recipe:", result.content);
}

// Later in the flow you can continue the conversation and opt into deeper reasoning:
if (result.thread) {
  const followUp = await jsonCompletion(
    "ModifyRecipe",
    result.thread,
    "Now produce a grocery list and explain your choices.",
    recipeSchema,
    {
      reasoningEffort: "medium",
    }
  );
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
  { model: "gpt-4o-mini" }
);

if (result.content) {
  console.log("Summary:", result.content);
}
```

### Embeddings

Create embedding vectors for one or more strings:

```typescript
import { embed } from "dry-utils-openai";

const result = await embed("VectorSearch", ["hello world", "hola mundo"], {
  model: "text-embedding-3-small",
  dimensions: 768,
});

if (result.embeddings) {
  console.log("First embedding length:", result.embeddings[0].length);
}
```

### Tool Use

Define tools that the model can call during a completion.

```typescript
import { jsonCompletion, z } from "dry-utils-openai";

// Define a tool
const searchTool = {
  name: "searchWeb",
  description: "Search the web for information",
  parameters: z
    .object({
      query: z.string().describe("The search query"),
    })
    .describe("Parameters for web search"),
};

// Make a completion request with the tool
const result = await jsonCompletion(
  "WebSearch",
  "You are a helpful assistant.",
  "Search the web for the capital of France.",
  z.object({
    answer: z.string().describe("The answer to the user's question"),
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

### Subscribing to Logging Events

This package uses [`node:diagnostics_channel`](https://nodejs.org/api/diagnostics_channel.html) to publish log, error, and aggregatable events. A helper function `subscribeOpenAILogging` is provided to simplify subscribing to these events.

The `subscribeOpenAILogging` function accepts an object with optional `log`, `error`, and `aggregate` callbacks.

- `log`: A function that receives log messages: `{ tag: string, val: unknown }`.
- `error`: A function that receives error messages: `{ tag: string, val: unknown }`.
- `aggregate`: A function that receives performance and metric data: `{ tag: string, blob: Record<string, unknown>, dense: Record<string, unknown>, metrics: Record<string, number> }`.

Example:

```typescript
import { subscribeOpenAILogging } from "dry-utils-openai";

// Subscribe to log, error, and aggregate events
subscribeOpenAILogging({
  log: ({ tag, val }) => {
    console.log(`[OpenAI Log: ${tag}]`, val);
  },
  error: ({ tag, val }) => {
    console.error(`[OpenAI Error: ${tag}]`, val);
  },
  aggregate: ({ tag, dense, metrics }) => {
    console.log(`[OpenAI Aggregate: ${tag}]`, { dense, metrics });
  },
});
```
