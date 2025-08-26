import { mockExternalLog } from "dry-utils-shared";
import assert from "node:assert/strict";
import { after, afterEach, describe, test } from "node:test";
import path from "node:path";
import { Container, dbConnect, Query, setDBLogging } from "../src/index.ts";

// Local Emulator config, default key not private
const DATABASE_URL = "https://localhost:8081";
const DATABASE_KEY =
  "C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==";
const DATABASE_LOCAL_CERT_PATH = path.resolve(
  process.cwd(),
  "cosmosdbcert.cer"
);

export interface Model {
  // Keys
  id: string;
}

const id = "test-item-1";
const dbActionLog = { log: 1, ag: 1 };

describe("CosmosDB E2E Flow", () => {
  // Note: Each test is dependent on the previous one
  const containerName = `Test_${Date.now()}`;
  const { logOptions, logCounts, logReset } = mockExternalLog();
  let container: Container<Model> | undefined = undefined;

  afterEach(() => {
    logReset();
  });

  after(() => {
    // Cleanup: Delete the container after all tests
    if (container) {
      container.container.delete().catch((error) => {
        console.error("Error deleting container:", error);
      });
    }
  });

  test("dbConnect", async () => {
    setDBLogging(logOptions);

    const containers = await dbConnect({
      endpoint: DATABASE_URL,
      key: DATABASE_KEY,
      name: "test_db",
      localCertPath: DATABASE_LOCAL_CERT_PATH,
      containers: [
        {
          name: containerName,
          partitionKey: "id",
        },
      ],
    });

    assert.ok(containers, "dbConnect returns containers map");
    assert.equal(Object.keys(containers).length, 1, "Containers has one item");

    container = containers[containerName] as Container<Model>;

    assert.ok(container, "testContainer should be created");
    logCounts({ log: 1 }, "dbConnect");
  });

  test("upsertItem", async () => {
    assert.ok(container, "Container should be defined");

    const testItem: Model = { id };
    await container.upsertItem(testItem);

    logCounts(dbActionLog, "upsertItem");
  });

  test("getItem", async () => {
    assert.ok(container, "Container should be defined");

    const item = await container.getItem(id, id);

    assert.ok(item, "Item should be retrieved");
    assert.equal(item.id, id, "Retrieved item should have correct ID");
    logCounts(dbActionLog, "getItem");
  });

  test("getItemsByPartitionKey", async () => {
    assert.ok(container, "Container should be defined");

    const items = await container.getItemsByPartitionKey(id);

    assert.ok(Array.isArray(items), "Result should be an array");
    assert.equal(items.length, 1, "Should retrieve one item");
    assert.equal(items[0]?.id, id, "Retrieved item should have correct ID");
    logCounts(dbActionLog, "getItemsByPartitionKey");

    const noItems = await container.getItemsByPartitionKey("nonexistent");

    assert.ok(Array.isArray(noItems), "Result should be an array");
    assert.equal(noItems.length, 0, "Should retrieve no items");
  });

  test("getIdsByPartitionKey", async () => {
    assert.ok(container, "Container should be defined");

    const ids = await container.getIdsByPartitionKey(id);

    assert.ok(Array.isArray(ids), "Result should be an array");
    assert.equal(ids.length, 1, "Should retrieve one ID");
    assert.equal(ids[0], id, "Retrieved ID should match");
    logCounts(dbActionLog, "getIdsByPartitionKey");

    const noIds = await container.getIdsByPartitionKey("nonexistent");

    assert.ok(Array.isArray(noIds), "Result should be an array");
    assert.equal(noIds.length, 0, "Should retrieve no IDs");
  });

  test("getCount", async () => {
    assert.ok(container, "Container should be defined");

    const count = await container.getCount();

    assert.equal(count, 1, "Should have 1 item in the container");
    logCounts(dbActionLog, "getCount");
  });

  test("query", async () => {
    assert.ok(container, "Container should be defined");

    const query = new Query().whereCondition("id", "=", id).build();
    const results = await container.query<Model>(query);

    assert.ok(Array.isArray(results), "Result should be an array");
    assert.equal(results.length, 1, "Should find 1 matching item");
    assert.equal(results[0]?.id, id, "Query should find the correct item");
    logCounts(dbActionLog, "query");
  });

  test("deleteItem", async () => {
    assert.ok(container, "Container should be defined");

    await container.deleteItem(id, id);

    logCounts(dbActionLog, "deleteItem");
  });
});
