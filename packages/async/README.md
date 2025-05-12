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

- **Batch Processing**: Process arrays of items in controlled batches with built-in error handling
- **Logging**: Configurable logging for async operations

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

### Configuring Logging

Configure how async operations are logged:

```typescript
import { setAsyncLogging } from "dry-utils-async";

// Use custom logging function
setAsyncLogging({
  logFn: (label, ...data) => {
    console.log(`[${new Date().toISOString()}] ${label}:`, ...data);
  },
  errorFn: (label, ...data) => {
    console.error(`[${new Date().toISOString()}] ERROR ${label}:`, ...data);
  },
});
```
