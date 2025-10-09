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

- **JSON Schema Validation**: Create structured responses with Zod schemas.
- **Prose Completions**: Generate text responses with a simple API.
- **Tool Usage**: Define custom tools that the model can request to call.
- **Conversation Threads**: Maintain conversation history by passing the thread between calls.
- **Embeddings**: Generate text embeddings with automatic retries and diagnostics logging.
- **Automatic Retries**: Built-in exponential backoff for rate limiting.
- **Error Handling**: Comprehensive error handling for common API issues.
- **Logging**: Detailed logging via `node:diagnostics_channel` for API calls, errors, and performance metrics.

## Usage

### JSON Completion

Generate structured responses with schema validation. The `jsonCompletion` and `proseCompletion` functions return a `thread` object that can be passed to subsequent calls to maintain conversation history.

By default completions target `gemini-2.0-flash-lite`. You can override the model or opt into deeper reasoning per request with the `model` and `reasoningEffort` options.

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

// Make the first completion request
const result1 = await jsonCompletion(
  "GenerateRecipe", // Action name for logging
  "You are a helpful cooking assistant", // Initial prompt
  "Create a recipe for chocolate chip cookies", // User input
  recipeSchema // Schema for validation
);

if (result1.content && result1.thread) {
  console.log("Recipe:", result1.content);

  // Make a follow-up request using the thread from the first response
  const result2 = await jsonCompletion(
    "ModifyRecipe",
    result1.thread, // Continue the conversation
    "Now, make it gluten-free.",
    recipeSchema
  );

  if (result2.content) {
    console.log("Gluten-Free Recipe:", result2.content);
  }
}
```

To opt into deeper reasoning on a follow-up request you can supply the `reasoningEffort` option. Valid values are `"minimal"`, `"low"`, `"medium"`, and `"high"`.

```typescript
if (result1.thread) {
  const result3 = await jsonCompletion(
    "ModifyRecipeWithReasoning",
    result1.thread,
    "Double-check the ingredient amounts and explain any changes.",
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

### Embeddings

Create embedding vectors for one or more strings:

```typescript
import { embed } from "dry-utils-gemini";

const result = await embed("VectorSearch", ["hello world", "hola mundo"], {
  model: "gemini-embedding-001",
  dimensions: 768,
});

if (result.embeddings) {
  console.log("First embedding length:", result.embeddings[0].length);
}
```

## Advanced Usage

The `jsonCompletion` and `proseCompletion` functions accept an optional `options` object to enable advanced features like tool usage, context injection, and model selection.

### Tool Usage

You can define tools that the model can ask to call. The model may either call one of your tools or respond directly.

```typescript
import { jsonCompletion, z } from "dry-utils-gemini";

// 1. Define a tool the model can use
const getCurrentWeatherTool = {
  name: "getCurrentWeather",
  description: "Get the current weather in a given location",
  parameters: z
    .object({
      location: z
        .string()
        .describe("The city and state, e.g. San Francisco, CA"),
    })
    .describe("The location for which to get the weather"),
};

// 2. Define the schema for the model's final response to the user
const responseSchema = z.object({
  answer: z.string().describe("The final, user-facing answer."),
});

// 3. Make the request
const result = await jsonCompletion(
  "Assistant",
  "You are a helpful assistant that can get the weather.",
  "What's the weather in Boston?",
  responseSchema,
  {
    tools: [getCurrentWeatherTool],
  }
);

// 4. Handle the response
if (result.toolCalls) {
  // The model wants to call a tool
  const toolCall = result.toolCalls[0];
  if (toolCall.name === "getCurrentWeather") {
    console.log(
      `The model wants to know the weather in ${toolCall.args.location}`
    );
    // In a real app, you would execute the tool and send the result back to the model.
  }
} else if (result.content) {
  // The model provided a final answer directly
  console.log("Final Answer:", result.content.answer);
}
```

### Providing Context

You can provide additional context to the model for more relevant responses.

```typescript
import { jsonCompletion, z } from "dry-utils-gemini";

const userProfile = {
  name: "Jane Doe",
  dietaryRestrictions: ["gluten-free", "vegetarian"],
};

const recipeSchema = z.object({
  // ...
});

const result = await jsonCompletion(
  "GenerateRecipeWithContext",
  "You are a helpful cooking assistant",
  "Suggest a dinner recipe for me.",
  recipeSchema,
  {
    context: [
      {
        description: "User Profile",
        content: userProfile,
      },
    ],
  }
);
```

### Model Selection

You can specify a different Gemini model using the `model` property in the `options` object. The default is `gemini-2.0-flash-lite`.

```typescript
const result = await jsonCompletion("...", "...", "...", someSchema, {
  model: "gemini-1.5-pro-latest", // Specify a different model
  reasoningEffort: "low", // Optional reasoning budget
});
```

### Subscribing to Logging Events

This package uses [`node:diagnostics_channel`](https://nodejs.org/api/diagnostics_channel.html) to publish log, error, and aggregatable events. A helper function `subscribeGeminiLogging` is provided to simplify subscribing to these events.

The `subscribeGeminiLogging` function accepts an object with optional `log`, `error`, and `aggregate` callbacks.

- `log`: A function that receives log messages: `{ tag: string, val: unknown }`.
- `error`: A function that receives error messages: `{ tag: string, val: unknown }`.
- `aggregate`: A function that receives performance and metric data: `{ tag: string, blob: Record<string, unknown>, dense: Record<string, unknown>, metrics: Record<string, number> }`.

Example:

```typescript
import { subscribeGeminiLogging } from "dry-utils-gemini";

// Subscribe to log, error, and aggregate events
subscribeGeminiLogging({
  log: ({ tag, val }) => {
    console.log(`[Gemini Log: ${tag}]`, val);
  },
  error: ({ tag, val }) => {
    console.error(`[Gemini Error: ${tag}]`, val);
  },
  aggregate: ({ tag, dense, metrics }) => {
    console.log(`[Gemini Aggregate: ${tag}]`, { dense, metrics });
  },
});
```
