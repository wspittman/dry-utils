import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CosmosClient, type SqlQuerySpec } from "../src/index.ts";

describe("cdbemulator", () => {
  async function setup() {
    const client = new CosmosClient({
      endpoint: "http://localhost",
      key: "local",
    });
    const db1 = await client.databases.createIfNotExists({ id: "db" });
    const db2 = await client.databases.createIfNotExists({ id: "db" });
    assert.equal(db1.database, db2.database);

    const containerRequest = {
      id: "items",
      partitionKey: { paths: ["/tenantId"] },
    };
    const c1 =
      await db1.database.containers.createIfNotExists(containerRequest);
    const c2 =
      await db1.database.containers.createIfNotExists(containerRequest);
    assert.equal(c1.container, c2.container);

    return c1.container;
  }

  test("upsert/read/delete lifecycle with partition key", async () => {
    const container = await setup();

    const upserted = await container.items.upsert({
      id: "1",
      tenantId: "acme",
      facets: { experience: 7 },
      title: "Hello Cosmos",
    });
    assert.equal(upserted.resource?.id, "1");
    assert.ok(upserted.requestCharge >= 0);
    assert.ok(
      upserted.diagnostics.clientSideRequestStatistics.requestDurationInMs >= 0,
    );

    const readHit = await container
      .item("1", "acme")
      .read<{ id: string; title: string }>();
    assert.equal(readHit.resource?.title, "Hello Cosmos");

    const readMiss = await container.item("missing", "acme").read();
    assert.equal(readMiss.resource, undefined);

    await container.item("1", "acme").delete();

    await assert.rejects(
      container.item("1", "acme").delete(),
      (error: unknown) => {
        return (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === 404
        );
      },
    );
  });

  test("readAll and simple select queries", async () => {
    const container = await setup();

    await container.items.upsert({
      id: "1",
      tenantId: "a",
      score: 10,
      text: "Alpha",
    });
    await container.items.upsert({
      id: "2",
      tenantId: "a",
      score: 20,
      text: "Beta",
    });
    await container.items.upsert({
      id: "3",
      tenantId: "b",
      score: 30,
      text: "Gamma",
    });

    const all = await container.items.readAll().fetchAll();
    assert.equal(all.resources.length, 3);

    const byPartition = await container.items
      .readAll({ partitionKey: "a" })
      .fetchAll();
    assert.deepEqual(byPartition.resources.map((x) => x.id).sort(), ["1", "2"]);

    const ids = await container.items
      .query<{ id: string }>("SELECT c.id FROM c")
      .fetchAll();
    assert.deepEqual(ids.resources.map((x) => x.id).sort(), ["1", "2", "3"]);

    const count = await container.items
      .query<number>("SELECT VALUE COUNT(1) FROM c")
      .fetchAll();
    assert.deepEqual(count.resources, [3]);
  });

  test("TOP, comparisons, contains, params, and partitionKey option", async () => {
    const container = await setup();

    await container.items.upsert({
      id: "1",
      tenantId: "x",
      facets: { experience: 3 },
      title: "first match",
    });
    await container.items.upsert({
      id: "2",
      tenantId: "x",
      facets: { experience: 9 },
      title: "SECOND MATCH",
    });
    await container.items.upsert({
      id: "3",
      tenantId: "y",
      facets: { experience: 11 },
      title: "third match",
    });

    const query: SqlQuerySpec = {
      query:
        "SELECT TOP 1 * FROM c WHERE (c.facets.experience >= @min) AND (CONTAINS(c.title, @term, true))",
      parameters: [
        { name: "@min", value: 5 },
        { name: "@term", value: "match" },
      ],
    };

    const result = await container.items
      .query<{ id: string; tenantId: string }>(query, { partitionKey: "x" })
      .fetchAll();

    assert.equal(result.resources.length, 1);
    assert.equal(result.resources[0]?.id, "2");
    assert.equal(result.resources[0]?.tenantId, "x");
    assert.ok(
      result.diagnostics.clientSideRequestStatistics
        .totalResponsePayloadLengthInBytes > 0,
    );
  });
});
