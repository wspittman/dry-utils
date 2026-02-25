import assert from "node:assert/strict";
import { beforeEach, describe, mock, test } from "node:test";
import { connectDB } from "../src/dbInit.ts";
import { Container, subscribeCosmosDBLogging } from "../src/index.ts";

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
    mockDBOptions: {
      mockContainer: {
        data: structuredClone(mockDB),
        queries: [
          {
            matcher: "SELECT * FROM c WHERE c.val > @minValue",
            func: (items, getParam) => {
              const minValue = getParam<number>("@minValue") ?? 400;
              return items.filter((item) => item["val"] > minValue);
            },
          },
        ],
      },
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
    "getCount: success",
    testSuccess(async (c) => c.getCount(), mockDB.length),
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
        c.query<Pick<Entry, "id" | "val">>("SELECT c.id, c.val, c._ts FROM c"),
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
    "query: error",
    testError(async (c) =>
      c.query("SELECT * FROM c", { partitionKey: FORCE_ERROR }),
    ),
  );

  test(
    "upsertItem: success",
    testSuccess(
      async (c) =>
        c.upsertItem({ id: "1", pkey: "item", val: 999, _ts: 1234567899 }),
      undefined,
    ),
  );

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
});
