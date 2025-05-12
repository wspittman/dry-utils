import {
  Container as AzureContainer,
  Item,
  Items,
  QueryIterator,
  type SqlQuerySpec,
} from "@azure/cosmos";
import { mockExternalLog } from "dry-utils-shared";
import assert from "node:assert/strict";
import { beforeEach, describe, mock, test } from "node:test";
import { Container, setDBLogging } from "../src/index.ts";

// #region Mock

type ContainerFn = (c: Container<Entry>) => Promise<unknown>;

interface Entry {
  id: string;
  pkey: string;
  val: number;
}

const mockDB: Entry[] = [
  { id: "1", pkey: "item", val: 123 },
  { id: "2", pkey: "item", val: 456 },
  { id: "3", pkey: "item", val: 789 },
];

const mockResponse = (resource: unknown) => {
  const response: Record<string, unknown> = {
    requestCharge: 1,
    diagnostics: {
      clientSideRequestStatistics: {
        requestDurationInMs: 100,
        totalResponsePayloadLengthInBytes: 123,
      },
    },
  };

  if (resource) {
    if (Array.isArray(resource)) {
      response["resources"] = resource;
    } else {
      response["resource"] = resource;
    }
  }

  return response;
};

function stringifyQuery(q: string | SqlQuerySpec) {
  if (typeof q === "string") return q;

  const { query, parameters } = q as SqlQuerySpec;
  let result = query;

  parameters?.forEach(({ name, value }) => {
    result = result.replace(name, String(value));
  });

  return result;
}

mock.method(Item.prototype, "read", function () {
  // @ts-ignore
  let { id, partitionKey: pkey } = this;
  pkey = Array.isArray(pkey) ? pkey[0] : pkey;

  if (id === "err") throw new Error("Error Time");

  const entry = mockDB.find((item) => item.id === id && item.pkey === pkey);
  return mockResponse(entry);
});

mock.method(QueryIterator.prototype, "fetchAll", function () {
  // @ts-ignore
  const { query, options: { partitionKey: pkey } = {} } = this;

  if (pkey === "err") throw new Error("Error Time");

  const partition = pkey ? mockDB.filter((x) => x.pkey === pkey) : mockDB;
  let result: unknown = partition;

  if (query) {
    const sQuery = stringifyQuery(query);

    if (sQuery.includes("SELECT c.id FROM c")) {
      result = partition.map((item) => ({ id: item.id }));
    } else if (sQuery.includes("SELECT VALUE COUNT(1)")) {
      result = [partition.length];
    } else if (sQuery.includes("WHERE c.val >")) {
      result = partition.filter((item) => item.val > 400);
    }
  }

  return mockResponse(result);
});

mock.method(Items.prototype, "upsert", function (item: { id: string }) {
  if (item.id === "err") throw new Error("Error Time");
  return mockResponse(item);
});

mock.method(Item.prototype, "delete", function () {
  // @ts-ignore
  if (this.id === "err") throw new Error("Error Time");
  return mockResponse({});
});

function getContainer() {
  const ac = new AzureContainer(
    { id: "MockDatabase" } as any,
    "MockContainer",
    {} as any
  );
  return new Container<Entry>("MockContainer", ac);
}

// #endregion

describe("DB: Container", () => {
  const { logOptions, logCounts, logReset } = mockExternalLog();
  setDBLogging(logOptions);

  beforeEach(() => {
    logReset();
  });

  function testSuccess(fn: ContainerFn, expected: unknown) {
    return async () => {
      const c = getContainer();
      const result = await fn(c);
      assert.deepEqual(result, expected);
      logCounts({ log: 1, ag: 1 });
    };
  }

  function testError(fn: ContainerFn) {
    return async () => {
      const c = getContainer();
      await assert.rejects(fn(c), { message: "Error Time" });
      logCounts({ error: 1 });
    };
  }

  test(
    "getItem: found",
    testSuccess(async (c) => c.getItem("1", "item"), mockDB[0])
  );

  test(
    "getItem: not found",
    testSuccess(async (c) => c.getItem("-1", "item"), undefined)
  );

  test(
    "getItem: error",
    testError(async (c) => c.getItem("err", "item"))
  );

  test(
    "getItemsByPartitionKey: found",
    testSuccess(async (c) => c.getItemsByPartitionKey("item"), mockDB)
  );

  test(
    "getItemsByPartitionKey: not found",
    testSuccess(async (c) => c.getItemsByPartitionKey("nonexistent"), [])
  );

  test(
    "getItemsByPartitionKey: error",
    testError(async (c) => c.getItemsByPartitionKey("err"))
  );

  test(
    "getIdsByPartitionKey: found",
    testSuccess(
      async (c) => c.getIdsByPartitionKey("item"),
      mockDB.map((item) => item.id)
    )
  );

  test(
    "getIdsByPartitionKey: not found",
    testSuccess(async (c) => c.getIdsByPartitionKey("nonexistent"), [])
  );

  test(
    "getIdsByPartitionKey: error",
    testError(async (c) => c.getIdsByPartitionKey("err"))
  );

  test(
    "getCount: success",
    testSuccess(async (c) => c.getCount(), mockDB.length)
  );

  test(
    "query: all",
    testSuccess(async (c) => c.query<Entry>("SELECT * FROM c"), mockDB)
  );

  test(
    "query: with partition key",
    testSuccess(
      async (c) => c.query<Entry>("SELECT * FROM c", { partitionKey: "item" }),
      mockDB
    )
  );

  test(
    "query: not found",
    testSuccess(
      async (c) =>
        c.query<Entry>("SELECT * FROM c", { partitionKey: "nonexistent" }),
      []
    )
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
      mockDB.filter((item) => item.val > 400)
    )
  );

  test(
    "query: error",
    testError(async (c) => c.query("SELECT * FROM c", { partitionKey: "err" }))
  );

  test(
    "upsertItem: success",
    testSuccess(
      async (c) => c.upsertItem({ id: "1", pkey: "item", val: 999 }),
      undefined
    )
  );

  test(
    "upsertItem: error",
    testError(async (c) => c.upsertItem({ id: "err", pkey: "item", val: 500 }))
  );

  test(
    "deleteItem: success",
    testSuccess(async (c) => c.deleteItem("1", "item"), undefined)
  );

  test(
    "deleteItem: error",
    testError(async (c) => c.deleteItem("err", "item"))
  );
});
