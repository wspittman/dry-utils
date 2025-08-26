# dry-utils-async

A collection of async utilities for handling common asynchronous programming patterns.

I do not anticipate that you will find this repository useful. It is hyper-specific to my needs. If you do find something useful, feel free to use it, fork it, or liberally copy code out into your own projects.

## Installation

Prerequisites:

- Node.js >=22.0.0

Install:

```bash
npm install dry-utils-async
```

## Features

- **Batch Processing**: Process arrays of items in controlled batches with built-in error handling.
- **Logging**: Emits events for async operations via `node:diagnostics_channel`.

## Usage

### Batch Processing

Process an array of items in batches with controlled concurrency:

```typescript
import { batch } from "dry-utils-async";

// Example: Process user IDs in batches of 3
const userIds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

await batch(
  "ProcessUsers", // Operation name for logging
  userIds, // Array of values to process
  async (id) => {
    // Async function to process each value
    const user = await fetchUser(id);
    await updateUserStatus(user);
  },
  3 // Batch size (3 concurrent operations)
);
```

### Subscribing to Logging Events

This package uses [`node:diagnostics_channel`](https://nodejs.org/api/diagnostics_channel.html) to publish log and error events. To consume them, you need to subscribe to the channels exported by the package.

- `ASYNC_LOG_CHANNEL`: For general logging. The published message is `{ tag: string, val: unknown }`.
- `ASYNC_ERR_CHANNEL`: For errors. The published message is `{ tag: string, val: unknown }`.

Here is an example of how to subscribe to the channels and see the output from the `batch` function.

```typescript
import diagnostics_channel from "node:diagnostics_channel";
import { batch, ASYNC_LOG_CHANNEL, ASYNC_ERR_CHANNEL } from "dry-utils-async";

// Subscribe to log events
diagnostics_channel.subscribe(ASYNC_LOG_CHANNEL, ({ tag, val }) => {
  // Example: [LOG] Batch_ProcessUsers: 10
  // Example: [LOG] Batch_ProcessUsers: Complete
  console.log(`[LOG] ${tag}:`, val);
});

// Subscribe to error events
diagnostics_channel.subscribe(ASYNC_ERR_CHANNEL, ({ tag, val }) => {
  // Example: [ERROR] Batch_ProcessUsers: at values[4]: Error: Invalid ID: -5
  console.error(`[ERROR] ${tag}:`, val);
});
```
