# dry-utils-cdbemulator

Minimal in-memory emulator for a small `@azure/cosmos` API subset used by `dry-utils-cosmosdb`.

## Scope

This package is designed for local tests and agent workflows.

Implemented:

- `CosmosClient`
- `databases.createIfNotExists`
- `containers.createIfNotExists`
- `container.item(...).read()` and `.delete()`
- `container.items.upsert(...)`
- `container.items.readAll(...).fetchAll()`
- `container.items.query(...).fetchAll()` with a small SQL subset
- Response diagnostics fields consumed by `dry-utils-cosmosdb`

Not implemented:

- Full Cosmos SQL grammar
- Transport/auth/protocol parity
- RU fidelity
