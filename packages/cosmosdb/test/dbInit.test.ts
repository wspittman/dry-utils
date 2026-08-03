import {
  ClientContext,
  Container,
  type ContainerRequest,
  Containers,
  CosmosClient,
  Database,
  Databases,
  SpatialType,
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
let containerRequests: ContainerRequest[] = [];
mock.method(
  Containers.prototype,
  "createIfNotExists",
  function (request: ContainerRequest) {
    containerRequests.push(structuredClone(request));
    const { id = "oops", partitionKey, indexingPolicy, defaultTtl } = request;
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
      defaultTtl !== undefined ? defaultTtl : "",
    ].join("~");

    return {
      container: new Container(
        { id: "MockDatabase" } as unknown as Database,
        dataId,
        {} as unknown as ClientContext,
      ),
    };
  },
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
    containerRequests = [];
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

  const indexCases: [Partial<ContainerOptions>, string][] = [
    [{ indexExclusions: "none" }, "id~/pkey~none~none~"],
    [{ indexExclusions: "all" }, "id~/pkey~none~/*~"],
    [{ indexExclusions: [] }, 'id~/pkey~/*~/"_etag"/?~'],
    [{ indexExclusions: ["prop1"] }, 'id~/pkey~/*~/"_etag"/?,prop1~'],
    [
      { indexExclusions: ["prop1", "prop2", "prop3"] },
      'id~/pkey~/*~/"_etag"/?,prop1,prop2,prop3~',
    ],
    [{ ttlSeconds: -1 }, "id~/pkey~none~none~-1"],
    [{ ttlSeconds: 1 }, "id~/pkey~none~none~1"],
    [{ ttlSeconds: 60 * 60 * 24 * 30 }, "id~/pkey~none~none~2592000"],
  ];

  indexCases.forEach(([testOpts, expected]) => {
    test(`ConnectDB w/ ${JSON.stringify(testOpts)}`, async () => {
      const options = {
        ...connectOptions,
        containers: [{ name: "id", partitionKey: "pkey", ...testOpts }],
      };

      const result = await connectDB(options);

      assert.equal(Object.keys(result).length, 1, "ContainerMap");
      callCounts(1, 0);
      // The mock hacks the container ID to include the id, pkey, and index exclusions
      assert.equal(result["id"]?.container.id, expected, "Container ID");
    });
  });

  const emptySpatialIndexCases: Partial<ContainerOptions>[] = [
    {},
    { spatialIndexes: [] },
  ];

  emptySpatialIndexCases.forEach((testOpts) => {
    test(`ConnectDB w/ no spatial policy ${JSON.stringify(testOpts)}`, async () => {
      await connectDB({
        ...connectOptions,
        containers: [{ name: "id", partitionKey: "pkey", ...testOpts }],
      });

      assert.equal(containerRequests.length, 1);
      assert.equal(containerRequests[0]?.indexingPolicy, undefined);
    });
  });

  const spatialIndexCases: [
    Partial<ContainerOptions>,
    NonNullable<ContainerRequest["indexingPolicy"]>,
  ][] = [
    [
      {
        indexExclusions: "none",
        spatialIndexes: ["/primaryLocation/point/*"],
      },
      {
        includedPaths: [{ path: "/*" }],
        excludedPaths: [{ path: '/"_etag"/?' }],
        spatialIndexes: [
          {
            path: "/primaryLocation/point/*",
            types: [SpatialType.Point],
          },
        ],
      },
    ],
    [
      { spatialIndexes: ["/primaryLocation/point/*", "/office/point/*"] },
      {
        includedPaths: [{ path: "/*" }],
        excludedPaths: [{ path: '/"_etag"/?' }],
        spatialIndexes: [
          {
            path: "/primaryLocation/point/*",
            types: [SpatialType.Point],
          },
          { path: "/office/point/*", types: [SpatialType.Point] },
        ],
      },
    ],
    [
      {
        indexExclusions: ["/largePayload/*"],
        spatialIndexes: ["/primaryLocation/point/*"],
      },
      {
        includedPaths: [{ path: "/*" }],
        excludedPaths: [{ path: '/"_etag"/?' }, { path: "/largePayload/*" }],
        spatialIndexes: [
          {
            path: "/primaryLocation/point/*",
            types: [SpatialType.Point],
          },
        ],
      },
    ],
    [
      {
        indexExclusions: "all",
        spatialIndexes: ["/primaryLocation/point/*"],
      },
      {
        excludedPaths: [{ path: "/*" }],
        spatialIndexes: [
          {
            path: "/primaryLocation/point/*",
            types: [SpatialType.Point],
          },
        ],
      },
    ],
  ];

  spatialIndexCases.forEach(([testOpts, expected]) => {
    test(`ConnectDB w/ spatial policy ${JSON.stringify(testOpts)}`, async () => {
      const originalOptions = structuredClone(testOpts);

      await connectDB({
        ...connectOptions,
        containers: [{ name: "id", partitionKey: "pkey", ...testOpts }],
      });

      assert.equal(containerRequests.length, 1);
      assert.deepEqual(containerRequests[0]?.indexingPolicy, expected);
      assert.deepEqual(testOpts, originalOptions);
    });
  });

  const emptyFullTextIndexCases: Partial<ContainerOptions>[] = [
    {},
    { fullTextIndexes: [] },
  ];

  emptyFullTextIndexCases.forEach((testOpts) => {
    test(`ConnectDB w/ no full-text policy ${JSON.stringify(testOpts)}`, async () => {
      await connectDB({
        ...connectOptions,
        containers: [{ name: "id", partitionKey: "pkey", ...testOpts }],
      });

      assert.equal(containerRequests.length, 1);
      assert.equal(containerRequests[0]?.indexingPolicy, undefined);
      assert.equal(containerRequests[0]?.fullTextPolicy, undefined);
    });
  });

  const fullTextIndexCases: [
    Partial<ContainerOptions>,
    NonNullable<ContainerRequest["indexingPolicy"]>,
    NonNullable<ContainerRequest["fullTextPolicy"]>,
  ][] = [
    [
      { fullTextIndexes: ["/description"] },
      {
        includedPaths: [{ path: "/*" }],
        excludedPaths: [{ path: '/"_etag"/?' }],
        fullTextIndexes: [{ path: "/description" }],
      },
      {
        defaultLanguage: "en-US",
        fullTextPaths: [{ path: "/description", language: "en-US" }],
      },
    ],
    [
      { fullTextIndexes: ["/title", "/description"] },
      {
        includedPaths: [{ path: "/*" }],
        excludedPaths: [{ path: '/"_etag"/?' }],
        fullTextIndexes: [{ path: "/title" }, { path: "/description" }],
      },
      {
        defaultLanguage: "en-US",
        fullTextPaths: [
          { path: "/title", language: "en-US" },
          { path: "/description", language: "en-US" },
        ],
      },
    ],
    [
      {
        indexExclusions: ["/raw/*"],
        fullTextIndexes: ["/description"],
      },
      {
        includedPaths: [{ path: "/*" }],
        excludedPaths: [{ path: '/"_etag"/?' }, { path: "/raw/*" }],
        fullTextIndexes: [{ path: "/description" }],
      },
      {
        defaultLanguage: "en-US",
        fullTextPaths: [{ path: "/description", language: "en-US" }],
      },
    ],
    [
      {
        indexExclusions: "all",
        fullTextIndexes: ["/description"],
      },
      {
        excludedPaths: [{ path: "/*" }],
        fullTextIndexes: [{ path: "/description" }],
      },
      {
        defaultLanguage: "en-US",
        fullTextPaths: [{ path: "/description", language: "en-US" }],
      },
    ],
    [
      {
        indexExclusions: ["/raw/*"],
        spatialIndexes: ["/primaryLocation/point/*"],
        fullTextIndexes: ["/description"],
      },
      {
        includedPaths: [{ path: "/*" }],
        excludedPaths: [{ path: '/"_etag"/?' }, { path: "/raw/*" }],
        spatialIndexes: [
          {
            path: "/primaryLocation/point/*",
            types: [SpatialType.Point],
          },
        ],
        fullTextIndexes: [{ path: "/description" }],
      },
      {
        defaultLanguage: "en-US",
        fullTextPaths: [{ path: "/description", language: "en-US" }],
      },
    ],
  ];

  fullTextIndexCases.forEach(
    ([testOpts, expectedIndexingPolicy, expectedFullTextPolicy]) => {
      test(`ConnectDB w/ full-text policy ${JSON.stringify(testOpts)}`, async () => {
        const originalOptions = structuredClone(testOpts);

        await connectDB({
          ...connectOptions,
          containers: [{ name: "id", partitionKey: "pkey", ...testOpts }],
        });

        assert.equal(containerRequests.length, 1);
        assert.deepEqual(
          containerRequests[0]?.indexingPolicy,
          expectedIndexingPolicy,
        );
        assert.deepEqual(
          containerRequests[0]?.fullTextPolicy,
          expectedFullTextPolicy,
        );
        assert.deepEqual(testOpts, originalOptions);
      });
    },
  );

  const ttlInvalidCases: number[] = [0, -2, 1.5];

  ttlInvalidCases.forEach((ttlSeconds) => {
    test(`ConnectDB w/ invalid ttlSeconds=${ttlSeconds}`, async () => {
      const options = {
        ...connectOptions,
        containers: [{ name: "id", partitionKey: "pkey", ttlSeconds }],
      };

      await assert.rejects(connectDB(options), {
        message: `Container "id": Invalid ttlSeconds=${ttlSeconds}`,
      });
    });
  });

  test("ConnectDB w/ mock data", async () => {
    const options = {
      ...connectOptions,
      containers: [{ name: "id", partitionKey: "pkey" }],
      mockDBData: {
        id: [
          { id: "item1", pkey: "p1", value: "test1" },
          { id: "item2", pkey: "p1", value: "test2" },
          { id: "item3", pkey: "p2", value: "test3" },
        ],
      },
    };

    const result = await connectDB(options);

    assert.equal(Object.keys(result).length, 1, "ContainerMap");
    callCounts(1, 0, "Mock Data");

    const container = result["id"];
    assert.ok(container, "Container should be created");

    const items = await container.getItemsByPartitionKey("p1");
    assert.equal(items.length, 2, "Should retrieve correct number of items");
    assert.equal(items[0]?.["value"], "test1", "First item value match");
    assert.equal(items[1]?.["value"], "test2", "Second item value match");
  });
});
