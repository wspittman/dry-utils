import assert from "node:assert/strict";
import { beforeEach, describe, mock, test } from "node:test";
import { connectDB } from "../src/dbInit.ts";
import {
  Container,
  Query,
  subscribeCosmosDBLogging,
  type MockQueryDef,
} from "../src/index.ts";

const FORCE_ERROR = "FORCE_ERROR";

type ContainerFn = (c: Container<Entry>) => Promise<unknown>;

interface Entry {
  id: string;
  pkey: string;
  val: number;
  _ts: number;
}

const mockDB: Entry[] = [
  { id: "1", pkey: "item", val: 123, _ts: 1234567890 },
  { id: "2", pkey: "item", val: 456, _ts: 1234567891 },
  { id: "3", pkey: "item", val: 789, _ts: 1234567892 },
];

const connectOptions = {
  endpoint: "mockEndpoint",
  key: "mockKey",
  name: "mockName",
  containers: [{ name: "mockContainer", partitionKey: "pkey" }],
};

async function getContainer() {
  const containerMap = await connectDB({
    ...connectOptions,
    mockDBData: {
      mockContainer: structuredClone(mockDB),
    },
  });
  return containerMap["mockContainer"] as Container<Entry>;
}

describe("DB: Container", () => {
  const logFn = mock.fn();
  const errFn = mock.fn();
  const aggFn = mock.fn();
  subscribeCosmosDBLogging({ log: logFn, error: errFn, aggregate: aggFn });

  beforeEach(() => {
    logFn.mock.resetCalls();
    errFn.mock.resetCalls();
    aggFn.mock.resetCalls();
  });

  function logCounts({ log = 1, error = 0, ag = 0 }) {
    assert.equal(logFn.mock.callCount(), log, "logFn count");
    assert.equal(errFn.mock.callCount(), error, "errFn count");
    assert.equal(aggFn.mock.callCount(), ag, "aggFn count");
  }

  function testSuccess(fn: ContainerFn, expected: unknown) {
    return async () => {
      const c = await getContainer();
      const result = await fn(c);
      assert.deepEqual(result, expected);
      logCounts({ ag: 1 });
    };
  }

  function testError(fn: ContainerFn) {
    return async () => {
      const c = await getContainer();
      await assert.rejects(fn(c), { message: "Error Time" });
      logCounts({ error: 1 });
    };
  }

  test(
    "getItem: found",
    testSuccess(async (c) => c.getItem("1", "item"), mockDB[0]),
  );

  test(
    "getItem: not found",
    testSuccess(async (c) => c.getItem("-1", "item"), undefined),
  );

  test(
    "getItem: error",
    testError(async (c) => c.getItem("1", FORCE_ERROR)),
  );

  test(
    "getItemsByPartitionKey: found",
    testSuccess(async (c) => c.getItemsByPartitionKey("item"), mockDB),
  );

  test(
    "getItemsByPartitionKey: not found",
    testSuccess(async (c) => c.getItemsByPartitionKey("nonexistent"), []),
  );

  test(
    "getItemsByPartitionKey: error",
    testError(async (c) => c.getItemsByPartitionKey(FORCE_ERROR)),
  );

  test(
    "getIdsByPartitionKey: found",
    testSuccess(
      async (c) => c.getIdsByPartitionKey("item"),
      mockDB.map((item) => item.id),
    ),
  );

  test(
    "getIdsByPartitionKey: not found",
    testSuccess(async (c) => c.getIdsByPartitionKey("nonexistent"), []),
  );

  test(
    "getIdsByPartitionKey: error",
    testError(async (c) => c.getIdsByPartitionKey(FORCE_ERROR)),
  );

  test(
    "getCount: no where clause",
    testSuccess(async (c) => c.getCount(), mockDB.length),
  );

  test(
    "getCount: with partition key",
    testSuccess(async (c) => c.getCount(undefined, "item"), mockDB.length),
  );

  test(
    "getCount: with partition key (no match)",
    testSuccess(async (c) => c.getCount(undefined, "nonexistent"), 0),
  );

  test(
    "query: VALUE COUNT(1) is case-insensitive",
    testSuccess(
      async (c) =>
        c.query<number>({
          query: "select value count(1) from c",
          parameters: [],
        }),
      [mockDB.length],
    ),
  );

  test(
    "getCount: with condition",
    testSuccess(
      async (c) => c.getCount(["val", ">", 400]),
      mockDB.filter((item) => item.val > 400).length,
    ),
  );

  test(
    "query: all",
    testSuccess(async (c) => c.query<Entry>("SELECT * FROM c"), mockDB),
  );

  test(
    "query: with partition key",
    testSuccess(
      async (c) => c.query<Entry>("SELECT * FROM c", { partitionKey: "item" }),
      mockDB,
    ),
  );

  test(
    "query: not found",
    testSuccess(
      async (c) =>
        c.query<Entry>("SELECT * FROM c", { partitionKey: "nonexistent" }),
      [],
    ),
  );

  test(
    "query: with SqlQuerySpec",
    testSuccess(
      async (c) => {
        const querySpec = {
          query: "SELECT * FROM c WHERE c.val > @minValue",
          parameters: [{ name: "@minValue", value: 400 }],
        };
        return c.query<Entry>(querySpec);
      },
      mockDB.filter((item) => item.val > 400),
    ),
  );

  test(
    "query: simple projection multiple properties",
    testSuccess(
      async (c) =>
        c.query<Pick<Entry, "id" | "val">>(
          // 2x normal values, 1x starts with _, 1x not in item, 1x not in item but on object prototype
          "SELECT c.id, c.val, c._ts, c.notFound, c.toString FROM c",
        ),
      mockDB.map((item) => ({ id: item.id, val: item.val, _ts: item._ts })),
    ),
  );

  test(
    "query: simple projection id only",
    testSuccess(
      async (c) => c.query<Pick<Entry, "id">>("SELECT c.id FROM c"),
      mockDB.map((item) => ({ id: item.id })),
    ),
  );

  test(
    "query: WHERE condition from Query builder",
    testSuccess(
      async (c) => c.query<Entry>(new Query().whereCondition("val", ">", 456)),
      mockDB.filter((item) => item.val > 456),
    ),
  );

  test(
    "query: IN operator filters correctly",
    testSuccess(
      async (c) =>
        c.query<Entry>(new Query().whereCondition("id", "IN", ["1", "3"])),
      mockDB.filter((item) => item.id === "1" || item.id === "3"),
    ),
  );

  test(
    "query: orderBy ASC",
    testSuccess(
      async (c) => c.query<Entry>(new Query().orderBy("val")),
      [...mockDB].sort((a, b) => a.val - b.val),
    ),
  );

  test(
    "query: orderBy DESC",
    testSuccess(
      async (c) => c.query<Entry>(new Query().orderBy("val", "DESC")),
      [...mockDB].sort((a, b) => b.val - a.val),
    ),
  );

  test(
    "query: WHERE CONTAINS condition from Query builder",
    testSuccess(
      async (c) =>
        c.query<Entry>(new Query().whereCondition("id", "CONTAINS", "1")),
      mockDB.filter((item) => item.id.includes("1")),
    ),
  );

  test(
    "query: WHERE multiple conditions from Query builder",
    testSuccess(
      async (c) =>
        c.query<Entry>(
          new Query()
            .whereCondition("pkey", "=", "item")
            .whereCondition("val", ">", 456),
        ),
      mockDB.filter((item) => item.pkey === "item" && item.val > 456),
    ),
  );

  test(
    "query: WHERE multiple conditions with lowercase",
    testSuccess(
      async (c) =>
        c.query<Entry>({
          query: "select * from c where (c.pkey = @pkey) and (c.val > @val)",
          parameters: [
            { name: "@pkey", value: "item" },
            { name: "@val", value: 456 },
          ],
        }),
      mockDB.filter((item) => item.pkey === "item" && item.val > 456),
    ),
  );

  test(
    "query: TOP without WHERE",
    testSuccess(
      async (c) => c.query<Entry>(new Query().top(2)),
      mockDB.slice(0, 2),
    ),
  );

  test(
    "query: TOP with WHERE from Query builder",
    testSuccess(
      async (c) =>
        c.query<Entry>(new Query().top(1).whereCondition("val", ">", 100)),
      mockDB.filter((item) => item.val > 100).slice(0, 1),
    ),
  );

  test(
    "getCountBy: groups items by field",
    testSuccess(
      async (c) => c.getCountBy("pkey"),
      [{ name: "item", count: mockDB.length }],
    ),
  );

  test("getCountBy: includes empty string and non-string scalar groups", async () => {
    type TagEntry = { id: string; pkey: string; tag: unknown };
    const tagData: TagEntry[] = [
      { id: "1", pkey: "a", tag: "x" },
      { id: "2", pkey: "a", tag: "" },
      { id: "3", pkey: "b", tag: "" },
      { id: "4", pkey: "b", tag: 42 },
      { id: "5", pkey: "c", tag: true },
      { id: "6", pkey: "c", tag: { test: "value" } },
    ];
    const containerMap = await connectDB({
      ...connectOptions,
      mockDBData: { mockContainer: tagData },
    });
    const c = containerMap["mockContainer"] as Container<TagEntry>;
    const result = await c.getCountBy("tag");
    assert.deepEqual(result, [
      { name: "x", count: 1 },
      { name: "", count: 2 },
      { name: 42, count: 1 },
      { name: true, count: 1 },
      { name: { test: "value" }, count: 1 },
    ]);
    logCounts({ ag: 1 });
  });

  test("getCountBy: groups items by nested property path", async () => {
    type LocationEntry = {
      id: string;
      pkey: string;
      location: { code: string };
    };
    const locationData: LocationEntry[] = [
      { id: "1", pkey: "a", location: { code: "US" } },
      { id: "2", pkey: "a", location: { code: "US" } },
      { id: "3", pkey: "b", location: { code: "CA" } },
    ];
    const containerMap = await connectDB({
      ...connectOptions,
      mockDBData: { mockContainer: locationData },
    });
    const c = containerMap["mockContainer"] as Container<LocationEntry>;
    const result = await c.getCountBy("location.code");
    assert.deepEqual(result, [
      { name: "US", count: 2 },
      { name: "CA", count: 1 },
    ]);
    logCounts({ ag: 1 });
  });

  test("getCountBy: rejects invalid property paths", async () => {
    const c = await getContainer();
    for (const invalid of [".a", "a.", "a..b", "a b", "a/b"]) {
      await assert.rejects(c.getCountBy(invalid), {
        message: `Invalid property "${invalid}". Only 'A-Za-z0-9_' allowed.`,
      });
    }
  });

  test("query: custom filter takes precedence over built-in", async () => {
    // Built-in would return all 3 items for val > 100; custom filter ignores the param and only passes val > 400.
    const customFilter: MockQueryDef = {
      matcher: /^\(c\.val > @val\)$/i,
      fn: ({ items }) => items.filter((item) => (item["val"] as number) > 400),
    };
    const containerMap = await connectDB({
      ...connectOptions,
      mockDBData: { mockContainer: structuredClone(mockDB) },
      mockDBFilters: { mockContainer: [customFilter] },
    });
    const c = containerMap["mockContainer"] as Container<Entry>;
    const result = await c.query<Entry>({
      query: "SELECT * FROM c WHERE (c.val > @val)",
      parameters: [{ name: "@val", value: 100 }],
    });
    assert.deepEqual(
      result,
      mockDB.filter((item) => item.val > 400),
    );
  });

  test("query: custom project takes precedence over built-in", async () => {
    // Built-in '*' returns all fields; custom project returns only id.
    const customProject: MockQueryDef = {
      matcher: "*",
      fn: ({ items }) => items.map((item) => ({ id: item["id"] })),
    };
    const containerMap = await connectDB({
      ...connectOptions,
      mockDBData: { mockContainer: structuredClone(mockDB) },
      mockDBProjects: { mockContainer: [customProject] },
    });
    const c = containerMap["mockContainer"] as Container<Entry>;
    const result = await c.query<Pick<Entry, "id">>("SELECT * FROM c");
    assert.deepEqual(
      result,
      mockDB.map((item) => ({ id: item.id })),
    );
  });

  test(
    "query: error",
    testError(async (c) =>
      c.query("SELECT * FROM c", { partitionKey: FORCE_ERROR }),
    ),
  );

  test(
    "upsertItem: success",
    testSuccess(
      async (c) => {
        const item = { id: "1", pkey: "item", val: 999, _ts: 1234567899 };
        return c.upsertItem(item);
      },
      { id: "1", pkey: "item", val: 999, _ts: 1234567899 },
    ),
  );

  test("upsertItem: returns the upserted item", async () => {
    const c = await getContainer();
    const item = { id: "new", pkey: "item", val: 42, _ts: 0 };
    const result = await c.upsertItem(item);
    assert.deepEqual(result, item);
    const fetched = await c.getItem("new", "item");
    assert.deepEqual(fetched, item);
  });

  test(
    "upsertItem: error",
    testError(async (c) =>
      c.upsertItem({ id: "1", pkey: FORCE_ERROR, val: 500, _ts: 1234567899 }),
    ),
  );

  test(
    "deleteItem: success",
    testSuccess(async (c) => c.deleteItem("1", "item"), undefined),
  );

  test(
    "deleteItem: error",
    testError(async (c) => c.deleteItem("1", FORCE_ERROR)),
  );

  test("getItem: rejects empty ID", async () => {
    const c = await getContainer();
    await assert.rejects(c.getItem("", "item"), {
      message: "Item ID must not be empty.",
    });
  });

  test("getItem: rejects IDs with forbidden characters", async () => {
    const c = await getContainer();
    for (const id of ["a/b", "a\\b", "a#b"]) {
      await assert.rejects(c.getItem(id, "item"), {
        message: `Item ID contains an invalid character ('/', '\\', or '#'). These are not allowed in Cosmos DB item IDs.`,
      });
    }
  });

  test("getItem: rejects IDs exceeding 1023 bytes", async () => {
    const c = await getContainer();
    await assert.rejects(c.getItem("a".repeat(1024), "item"), {
      message: "Item ID exceeds the maximum allowed length of 1023 bytes.",
    });
  });

  test("upsertItem: rejects item with invalid ID", async () => {
    const c = await getContainer();
    await assert.rejects(
      c.upsertItem({ id: "a/b", pkey: "item", val: 1, _ts: 0 }),
      {
        message: `Item ID contains an invalid character ('/', '\\', or '#'). These are not allowed in Cosmos DB item IDs.`,
      },
    );
  });

  test("deleteItem: rejects invalid ID", async () => {
    const c = await getContainer();
    await assert.rejects(c.deleteItem("a/b", "item"), {
      message: `Item ID contains an invalid character ('/', '\\', or '#'). These are not allowed in Cosmos DB item IDs.`,
    });
  });
});
