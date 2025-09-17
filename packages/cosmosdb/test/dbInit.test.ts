import {
  ClientContext,
  Container,
  type ContainerRequest,
  Containers,
  CosmosClient,
  Database,
  Databases,
} from "@azure/cosmos";
import assert from "node:assert/strict";
import { beforeEach, describe, mock, test } from "node:test";
import { connectDB, type ContainerOptions } from "../src/dbInit.ts";
import { subscribeCosmosDBLogging } from "../src/index.ts";

// #region Mock

const connectOptions = {
  endpoint: "https://localhost:8081",
  key: "mockKey",
  name: "mockName",
  containers: [],
};

mock.method(Databases.prototype, "createIfNotExists", function () {
  return {
    database: new Database({} as CosmosClient, "test", {} as ClientContext),
  };
});

let retryMap: Record<string, boolean> = {};
mock.method(
  Containers.prototype,
  "createIfNotExists",
  function ({ id = "oops", partitionKey, indexingPolicy }: ContainerRequest) {
    if (id === "err") throw new Error("Error Time");

    if (id.startsWith("retry") && !retryMap[id]) {
      retryMap[id] = true;
      throw new Error("Error Time");
    } else {
      retryMap[id] = false;
    }

    const dataId = [
      id,
      typeof partitionKey === "string"
        ? partitionKey
        : partitionKey?.paths?.[0],
      indexingPolicy?.includedPaths?.map((p) => p.path).join(",") ?? "none",
      indexingPolicy?.excludedPaths?.map((p) => p.path).join(",") ?? "none",
    ].join("~");

    return {
      container: new Container(
        { id: "MockDatabase" } as any,
        dataId,
        {} as any
      ),
    };
  }
);

// #endregion

describe("DB: DBInit", () => {
  const logFn = mock.fn();
  const errorFn = mock.fn();
  subscribeCosmosDBLogging({ log: logFn, error: errorFn });

  function callCounts(log: number, error: number, msg = "") {
    assert.equal(logFn.mock.callCount(), log, `logFn count ${msg}`);
    assert.equal(errorFn.mock.callCount(), error, `errorFn count ${msg}`);
  }

  beforeEach(() => {
    logFn.mock.resetCalls();
    errorFn.mock.resetCalls();
    retryMap = {};
  });

  const containerCases: [string, string[], number, number, boolean][] = [
    ["No Containers", [], 1, 0, false],
    ["All Success", ["id1", "id2", "id3"], 1, 0, false],
    ["All Fail", ["err", "err", "err"], 0, 9, true],
    ["All Retry Success", ["retry1", "retry2", "retry3"], 1, 3, false],
    ["One Each", ["id1", "retry1", "err"], 0, 4, true],
  ];

  containerCases.forEach(([name, ids, logCount, errorCount, expectError]) => {
    test(`ConnectDB: ${name}`, async () => {
      const options = {
        ...connectOptions,
        containers: ids.map((id) => ({ name: id, partitionKey: "pkey" })),
      };

      if (expectError) {
        const errMsg = `Failed to initialize containers: ${ids
          .filter((x) => x === "err")
          .join(", ")}`;
        await assert.rejects(connectDB(options), { message: errMsg });
      } else {
        const result = await connectDB(options);
        assert.equal(Object.keys(result).length, ids.length, "ContainerMap");
      }

      callCounts(logCount, errorCount, name);
    });
  });

  const indexCases: [string, ContainerOptions["indexExclusions"], string][] = [
    ["none", "none", "id~/pkey~none~none"],
    ["all", "all", "id~/pkey~none~/*"],
    ["empty", [], 'id~/pkey~/*~/"_etag"/?'],
    ["one prop", ["prop1"], 'id~/pkey~/*~/"_etag"/?,prop1'],
    [
      "three props",
      ["prop1", "prop2", "prop3"],
      'id~/pkey~/*~/"_etag"/?,prop1,prop2,prop3',
    ],
  ];

  indexCases.forEach(([name, indexExclusions, expected]) => {
    test(`ConnectDB w/ index exclusions: ${name}`, async () => {
      const options = {
        ...connectOptions,
        containers: [{ name: "id", partitionKey: "pkey", indexExclusions }],
      };

      const result = await connectDB(options);

      assert.equal(Object.keys(result).length, 1, "ContainerMap");
      callCounts(1, 0, name);
      // The mock hacks the container ID to include the id, pkey, and index exclusions
      assert.equal(result["id"]?.container.id, expected, "Container ID");
    });
  });
});
