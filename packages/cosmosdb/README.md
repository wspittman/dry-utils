# dry-utils-cosmosdb

CosmosDB abstractions for simplified database interactions.

I do not anticipate that you will find this repository useful. It is hyper-specific to my needs. If you do find something useful, feel free to use it, fork it, or liberally copy code out into your own projects.

## Prerequisites

- Node.js >=24.0.0
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

## Installation

```bash
npm install dry-utils-cosmosdb
```

## Features

- **Container Management**: Simplified container creation and initialization
- **Query Builder**: Helper class for building SQL queries with best practices
- **CRUD Operations**: Streamlined item operations (create, read, update, delete)
- **Logging**: Emits events for database operations via `node:diagnostics_channel`, including RU consumption tracking.

## Usage

### Connecting to CosmosDB

Connect to your database and initialize containers

- Use `indexExclusions` to specify paths to exclude from indexing for performance optimization. Set it to `"none"` to include all paths (default).
- Use `ttlSeconds` to configure a container-wide TTL for all items (in seconds). Set it to `-1` to disable expiration while still enabling the TTL system for per-item overrides.

```typescript
import { connectDB } from "dry-utils-cosmosdb";

const db = await connectDB({
  endpoint: "https://your-cosmos-instance.documents.azure.com:443/",
  key: "your-cosmos-db-key",
  name: "your-database-name",
  containers: [
    {
      name: "users",
      partitionKey: "userId",
      indexExclusions: ["paths", "to", "exclude"],
    },
    {
      name: "products",
      partitionKey: "category",
      indexExclusions: "none", // default
      ttlSeconds: 60 * 60 * 24 * 30, // 30 days
    },
  ],
});

// Access the containers
const usersContainer = db.users;
const productsContainer = db.products;
```

### Query Builder

Build SQL queries with best practices for performance:

```typescript
import { Query } from "dry-utils-cosmosdb";

// Create a query to find active/pending premium users, sorted by most recent first
const query = new Query()
  .whereCondition("status", "IN", ["active", "pending"])
  .whereCondition("userType", "=", "premium")
  .whereCondition("createdDate", ">", "2023-01-01")
  .orderBy("_ts", "DESC");

// Execute the query
const results = await container.query(query.top(100).build());
```

### Mock Database (Testing)

For tests, you can bypass Azure entirely by supplying `mockDBData` and optional `mockDBQueries`.

```typescript
import { connectDB } from "dry-utils-cosmosdb";

const db = await connectDB({
  endpoint: "unused-for-mock",
  key: "unused-for-mock",
  name: "unused-for-mock",
  containers: [{ name: "users", partitionKey: "userId" }],
  mockDBData: {
    users: [
      { id: "1", userId: "u-1", status: "active" },
      { id: "2", userId: "u-2", status: "inactive" },
    ],
  },
  mockDBFilters: {
    users: [
      {
        matcher: /c\.status = @status/,
        fn: ({ items, params }) => {
          const status = params["@status"];
          return items.filter((item) => item.status === status);
        },
      },
    ],
  },
});
```

The `mockDBFilters` matchers let you intercept WHERE clauses and return custom filtered results from fixture data. Use `mockDBProjects` the same way to intercept SELECT projections.

### Loading Mock Data from JSON

Use `loadMockDBData` to load mock data from an inline JSON string or a file path, rather than hard-coding it inline:

```typescript
import { connectDB, loadMockDBData } from "dry-utils-cosmosdb";

const db = await connectDB({
  endpoint: "unused-for-mock",
  key: "unused-for-mock",
  name: "unused-for-mock",
  containers: [{ name: "users", partitionKey: "userId" }],
  mockDBData: loadMockDBData({
    mockDataPath: "/path/to/fixtures.json", // JSON file keyed by container name
    mockDataJson: '{"users":[{"id":"override","userId":"u-0"}]}', // inline overrides
  }),
});
```

When both sources are supplied, inline JSON takes precedence for any duplicate container keys.

### CRUD Operations

Perform common database operations:

```typescript
// Get an item by ID
const user = await container.getItem("user123", "partition1");

// Create or update an item - returns the item as stored, including system properties
const stored = await container.upsertItem({
  id: "user123",
  userId: "partition1",
  name: "John Doe",
  email: "john@example.com",
});
console.log(stored._ts); // timestamp assigned by CosmosDB

// Delete an item
await container.deleteItem("user123", "partition1");

// Query items
const activeUsers = await container.query({
  query: "SELECT * FROM c WHERE c.status = @status",
  parameters: [{ name: "@status", value: "active" }],
});

// Count items, optionally scoped to a partition
const total = await container.getCount();
const partitionCount = await container.getCount(undefined, "partition1");

// Count items bucketed by a property value (supports dot-path notation)
const byStatus = await container.getCountBy("status");
const byRegion = await container.getCountBy("location.regionCode");
```

Item IDs are validated before use. IDs that are empty, contain `/`, `\`, or `#`, or exceed 1,023 bytes will throw immediately rather than failing at the service layer.

### Subscribing to Logging Events

This package uses [`node:diagnostics_channel`](https://nodejs.org/api/diagnostics_channel.html) to publish log, error, and aggregatable events. A helper function `subscribeCosmosDBLogging` is provided to simplify subscribing to these events.

The `subscribeCosmosDBLogging` function accepts an object with optional `log`, `error`, and `aggregate` callbacks.

- `log`: A function that receives log messages: `{ tag: string, val: unknown }`.
- `error`: A function that receives error messages: `{ tag: string, val: unknown }`.
- `aggregate`: A function that receives performance and metric data: `{ tag: string, blob: Record<string, unknown>, dense: Record<string, unknown>, metrics: Record<string, number> }`.

Here is an example of how to subscribe to these events.

```typescript
import { subscribeCosmosDBLogging } from "dry-utils-cosmosdb";

// Subscribe to log, error, and aggregate events
subscribeCosmosDBLogging({
  log: ({ tag, val }) => {
    console.log(`[DB LOG] ${tag}:`, val);
  },
  error: ({ tag, val }) => {
    console.error(`[DB ERROR] ${tag}:`, val);
  },
  aggregate: ({ tag, metrics }) => {
    console.log(`[DB PERF] ${tag}:`, metrics);
    // Example: [DB PERF] UPSERT: { ru: 1.29, ms: 12.3, bytes: 123, count: 1 }
  },
});
```
