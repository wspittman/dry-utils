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

Connect to your database and initialize containers:

```typescript
import { dbConnect } from "dry-utils-cosmosdb";

const db = await dbConnect({
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

// Create a query to find active premium users
const query = new Query()
  .whereCondition("status", "=", "active")
  .whereCondition("userType", "=", "premium")
  .whereCondition("createdDate", ">", "2023-01-01");

// Execute the query
const results = await container.query(query.build(100));
```

### CRUD Operations

Perform common database operations:

```typescript
// Get an item by ID
const user = await container.getItem("user123", "partition1");

// Create or update an item
await container.upsertItem({
  id: "user123",
  userId: "partition1",
  name: "John Doe",
  email: "john@example.com",
});

// Delete an item
await container.deleteItem("user123", "partition1");

// Query items
const activeUsers = await container.query(
  "SELECT * FROM c WHERE c.status = @status",
  { parameters: [{ name: "@status", value: "active" }] },
);
```

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
