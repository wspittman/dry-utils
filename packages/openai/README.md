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

- **JSON Schema Validation**: Create structured responses with Zod schemas
- **Prose Completions**: Generate text responses with simple API
- **Automatic Retries**: Built-in exponential backoff for rate limiting
- **Error Handling**: Comprehensive error handling for common API issues
- **Logging**: Configurable logging for API calls with performance metrics

## Usage

### JSON Completion

Generate structured responses with schema validation:

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
import { proseCompletion } from "dry-utils-openai";

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

### Configuring Logging

Configure how API calls are logged:

```typescript
import { setAILogging } from "dry-utils-openai";

// Use custom logging function
setAILogging({
  logFn: (label, ...data) => {
    console.log(`[AI-${label}]`, ...data);
  },
  errorFn: (label, ...data) => {
    console.error(`[AI-ERROR-${label}]`, ...data);
  },
});
```
