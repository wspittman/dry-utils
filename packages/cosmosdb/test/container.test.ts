import type { JSONValue } from "@azure/cosmos";
import assert from "node:assert/strict";
import { beforeEach, describe, mock, test } from "node:test";
import { connectDB } from "../src/dbInit.ts";
import {
  Container,
  Query,
  subscribeCosmosDBLogging,
  type MockQueryDef,
  Where,
} from "../src/index.ts";

const FORCE_ERROR = "FORCE_ERROR";

type ContainerFn = (c: Container<Entry>) => Promise<unknown>;

interface Entry {
  id: string;
  pkey: string;
  val: number;
  _ts: number;
}

interface SpatialEntry {
  id: string;
  pkey: string;
  status: "active" | "inactive";
  primaryLocation?: { point?: JSONValue };
}

interface FullTextEntry {
  id: string;
  pkey: string;
  status: "active" | "inactive";
  content?: { description?: JSONValue };
}

type FullTextFunction =
  "FULLTEXTCONTAINS" | "FULLTEXTCONTAINSALL" | "FULLTEXTCONTAINSANY";

const mockDB: Entry[] = [
  { id: "1", pkey: "item", val: 123, _ts: 1234567890 },
  { id: "2", pkey: "item", val: 456, _ts: 1234567891 },
  { id: "3", pkey: "item", val: 789, _ts: 1234567892 },
];

const originPoint = {
  type: "Point",
  coordinates: [10, 60],
} satisfies JSONValue;

const spatialDB: SpatialEntry[] = [
  {
    id: "far",
    pkey: "item",
    status: "active",
    primaryLocation: {
      point: { type: "Point", coordinates: [12, 60] },
    },
  },
  {
    id: "near",
    pkey: "item",
    status: "active",
    primaryLocation: {
      point: { type: "Point", coordinates: [11, 60] },
    },
  },
  {
    id: "same",
    pkey: "item",
    status: "inactive",
    primaryLocation: { point: structuredClone(originPoint) },
  },
  { id: "missing", pkey: "item", status: "active" },
  {
    id: "malformed",
    pkey: "item",
    status: "active",
    primaryLocation: {
      point: { type: "Point", coordinates: [10, "invalid"] },
    },
  },
  {
    id: "not-point",
    pkey: "item",
    status: "active",
    primaryLocation: { point: { type: "Polygon", coordinates: [] } },
  },
];

const fullTextDB: FullTextEntry[] = [
  {
    id: "nonmatch-first",
    pkey: "item",
    status: "active",
    content: { description: "An ordinary commuter bike." },
  },
  {
    id: "phrase",
    pkey: "item",
    status: "active",
    content: { description: "A RED bicycle waits by the river." },
  },
  {
    id: "split-terms",
    pkey: "item",
    status: "active",
    content: { description: "A red lightweight city bicycle." },
  },
  {
    id: "skateboard",
    pkey: "item",
    status: "inactive",
    content: { description: "Blue skateboard with a carbon deck." },
  },
  { id: "missing", pkey: "item", status: "active" },
  {
    id: "null",
    pkey: "item",
    status: "active",
    content: { description: null },
  },
  {
    id: "number",
    pkey: "item",
    status: "active",
    content: { description: 42 },
  },
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

async function getSpatialContainer() {
  const containerMap = await connectDB({
    ...connectOptions,
    mockDBData: { mockContainer: structuredClone(spatialDB) },
  });
  return containerMap["mockContainer"] as Container<SpatialEntry>;
}

async function getFullTextContainer(filters?: MockQueryDef[]) {
  const containerMap = await connectDB({
    ...connectOptions,
    mockDBData: { mockContainer: structuredClone(fullTextDB) },
    mockDBFilters: filters ? { mockContainer: filters } : undefined,
  });
  return containerMap["mockContainer"] as Container<FullTextEntry>;
}

function getFullTextQuery(
  fn: FullTextFunction,
  parameterNames: string[],
  parameters: Record<string, JSONValue>,
) {
  const clause = `${fn}(c.content.description, ${parameterNames.join(", ")})`;
  return new Query({ where: [[clause, parameters]] });
}

const distanceClause =
  "ST_DISTANCE(c.primaryLocation.point, @origin) <= @radiusMeters";

function getDistanceQuery(origin: JSONValue, distanceMeters: number) {
  return new Query({
    where: [
      [distanceClause, { "@origin": origin, "@radiusMeters": distanceMeters }],
    ],
  });
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
      async (c) => c.query<Entry>(new Query({ where: [["val", ">", 456]] })),
      mockDB.filter((item) => item.val > 456),
    ),
  );

  test(
    "query: IN operator filters correctly",
    testSuccess(
      async (c) =>
        c.query<Entry>(new Query({ where: [["id", "IN", ["1", "3"]]] })),
      mockDB.filter((item) => item.id === "1" || item.id === "3"),
    ),
  );

  test(
    "query: orderBy ASC",
    testSuccess(
      async (c) => c.query<Entry>(new Query({ orderBy: [["val"]] })),
      [...mockDB].sort((a, b) => a.val - b.val),
    ),
  );

  test(
    "query: orderBy DESC",
    testSuccess(
      async (c) => c.query<Entry>(new Query({ orderBy: [["val", "DESC"]] })),
      [...mockDB].sort((a, b) => b.val - a.val),
    ),
  );

  const ascOrderByIds = [
    "missing",
    "null",
    "false",
    "true",
    "number-low",
    "number-high",
    "string-a",
    "string-b",
    "array",
    "object",
  ];

  for (const [direction, expectedIds] of [
    ["ASC", ascOrderByIds],
    ["DESC", ascOrderByIds.toReversed()],
  ] as const) {
    test(`query: orderBy ${direction} uses Cosmos DB type precedence`, async () => {
      const containerMap = await connectDB({
        ...connectOptions,
        mockDBData: {
          mockContainer: [
            { id: "object", pkey: "item", val: {} },
            { id: "string-b", pkey: "item", val: "b" },
            { id: "true", pkey: "item", val: true },
            { id: "number-high", pkey: "item", val: 20 },
            { id: "null", pkey: "item", val: null },
            { id: "missing", pkey: "item" },
            { id: "array", pkey: "item", val: [] },
            { id: "number-low", pkey: "item", val: 10 },
            { id: "false", pkey: "item", val: false },
            { id: "string-a", pkey: "item", val: "a" },
          ],
        },
      });
      const container = containerMap["mockContainer"]!;

      const result = await container.query<{ id: string }>(
        new Query({ orderBy: [["val", direction]] }),
      );

      assert.deepEqual(
        result.map(({ id }) => id),
        expectedIds,
      );
    });
  }

  test(
    "query: WHERE CONTAINS condition from Query builder",
    testSuccess(
      async (c) =>
        c.query<Entry>(new Query({ where: [["id", "CONTAINS", "1"]] })),
      mockDB.filter((item) => item.id.includes("1")),
    ),
  );

  test(
    "query: WHERE multiple conditions from Query builder",
    testSuccess(
      async (c) =>
        c.query<Entry>(
          new Query({
            where: [
              ["pkey", "=", "item"],
              ["val", ">", 456],
            ],
          }),
        ),
      mockDB.filter((item) => item.pkey === "item" && item.val > 456),
    ),
  );

  test(
    "query: nested WHERE groups from Query options",
    testSuccess(
      async (c) =>
        c.query<Entry>(
          new Query({
            where: [
              ["pkey", "=", "item"],
              Where.any([
                ["val", "=", 123],
                ["val", ">", 789],
              ]),
            ],
          }),
        ),
      mockDB.filter(
        (item) => item.pkey === "item" && (item.val === 123 || item.val > 789),
      ),
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

  test("query: ST_DISTANCE filters nested Points in meters", async () => {
    const c = await getSpatialContainer();

    const result = await c.query<SpatialEntry>(
      getDistanceQuery(originPoint, 75_000),
    );

    assert.deepEqual(
      result.map(({ id }) => id),
      ["near", "same"],
    );
    logCounts({ ag: 1 });
  });

  test("query: ST_DISTANCE includes the radius boundary", async () => {
    const c = await getSpatialContainer();

    const result = await c.query<SpatialEntry>(
      getDistanceQuery(originPoint, 0),
    );

    assert.deepEqual(
      result.map(({ id }) => id),
      ["same"],
    );
    logCounts({ ag: 1 });
  });

  test("query: ST_DISTANCE with a negative radius matches nothing", async () => {
    const c = await getSpatialContainer();

    const result = await c.query<SpatialEntry>(
      getDistanceQuery(originPoint, -1),
    );

    assert.deepEqual(result, []);
    logCounts({ ag: 1 });
  });

  test("query: ST_DISTANCE is case-insensitive and whitespace-tolerant", async () => {
    const c = await getSpatialContainer();

    const result = await c.query<SpatialEntry>({
      query:
        "select * from c where st_distance ( c.primaryLocation.point , @origin ) <= @radiusMeters",
      parameters: [
        { name: "@origin", value: originPoint },
        { name: "@radiusMeters", value: 75_000 },
      ],
    });

    assert.deepEqual(
      result.map(({ id }) => id),
      ["near", "same"],
    );
    logCounts({ ag: 1 });
  });

  test("query: ST_DISTANCE combines with scalar filters before TOP", async () => {
    const c = await getSpatialContainer();
    const query = new Query({
      top: 1,
      where: [
        ["status", "=", "active"],
        [distanceClause, { "@origin": originPoint, "@radiusMeters": 75_000 }],
      ],
    });

    const result = await c.query<SpatialEntry>(query);

    assert.deepEqual(
      result.map(({ id }) => id),
      ["near"],
    );
    logCounts({ ag: 1 });
  });

  const invalidSpatialParameterCases: [
    string,
    Record<string, JSONValue>,
    string,
  ][] = [
    [
      "missing origin",
      { "@radiusMeters": 75_000 },
      "Invalid ST_DISTANCE origin parameter @origin: expected a GeoJSON Point with finite longitude [-180, 180] and latitude [-90, 90]",
    ],
    [
      "non-Point origin",
      {
        "@origin": { type: "Polygon", coordinates: [] },
        "@radiusMeters": 75_000,
      },
      "Invalid ST_DISTANCE origin parameter @p0: expected a GeoJSON Point with finite longitude [-180, 180] and latitude [-90, 90]",
    ],
    [
      "out-of-range origin",
      {
        "@origin": { type: "Point", coordinates: [181, 60] },
        "@radiusMeters": 75_000,
      },
      "Invalid ST_DISTANCE origin parameter @p0: expected a GeoJSON Point with finite longitude [-180, 180] and latitude [-90, 90]",
    ],
    [
      "missing radius",
      { "@origin": originPoint },
      "Invalid ST_DISTANCE radius parameter @radiusMeters: expected a finite number",
    ],
    [
      "non-number radius",
      { "@origin": originPoint, "@radiusMeters": "75000" },
      "Invalid ST_DISTANCE radius parameter @p1: expected a finite number",
    ],
    [
      "non-finite radius",
      { "@origin": originPoint, "@radiusMeters": Infinity },
      "Invalid ST_DISTANCE radius parameter @p1: expected a finite number",
    ],
  ];

  invalidSpatialParameterCases.forEach(([name, parameters, message]) => {
    test(`query: ST_DISTANCE rejects ${name}`, async () => {
      const c = await getSpatialContainer();

      await assert.rejects(
        c.query(
          new Query({
            where: [[distanceClause, structuredClone(parameters)]],
          }),
        ),
        { message },
      );
      logCounts({ error: 1 });
    });
  });

  const unsupportedSpatialClauses = [
    "ST_DISTANCE(@origin, c.primaryLocation.point) <= @radiusMeters",
    "ST_DISTANCE(c.primaryLocation.point, @origin) < @radiusMeters",
  ];

  unsupportedSpatialClauses.forEach((clause) => {
    test(`query: rejects unsupported spatial clause ${clause}`, async () => {
      const c = await getSpatialContainer();

      const [builtClause] = Where.raw([
        clause,
        { "@origin": originPoint, "@radiusMeters": 75_000 },
      ]).build();
      await assert.rejects(
        c.query(
          new Query({
            where: [
              [clause, { "@origin": originPoint, "@radiusMeters": 75_000 }],
            ],
          }),
        ),
        { message: `Unsupported WHERE condition in mock: ${builtClause}` },
      );
      logCounts({ error: 1 });
    });
  });

  const fullTextFilterCases: [
    string,
    FullTextFunction,
    Record<string, JSONValue>,
    string[],
  ][] = [
    [
      "FULLTEXTCONTAINS matches one contiguous phrase case-insensitively",
      "FULLTEXTCONTAINS",
      { "@phrase": "red bicycle" },
      ["phrase"],
    ],
    [
      "FULLTEXTCONTAINS does not match separated or reversed phrases",
      "FULLTEXTCONTAINS",
      { "@phrase": "bicycle red" },
      [],
    ],
    [
      "FULLTEXTCONTAINSALL requires every term without requiring adjacency",
      "FULLTEXTCONTAINSALL",
      { "@color": "red", "@vehicle": "bicycle" },
      ["phrase", "split-terms"],
    ],
    [
      "FULLTEXTCONTAINSANY requires at least one term",
      "FULLTEXTCONTAINSANY",
      { "@vehicle": "bicycle", "@board": "skateboard" },
      ["phrase", "split-terms", "skateboard"],
    ],
  ];

  fullTextFilterCases.forEach(([name, fn, parameters, expectedIds]) => {
    test(`query: ${name}`, async () => {
      const c = await getFullTextContainer();

      const result = await c.query<FullTextEntry>(
        getFullTextQuery(fn, Object.keys(parameters), parameters),
      );

      assert.deepEqual(
        result.map(({ id }) => id),
        expectedIds,
      );
      logCounts({ ag: 1 });
    });
  });

  test("query: full-text functions are case-insensitive and whitespace-tolerant", async () => {
    const c = await getFullTextContainer();

    const result = await c.query<FullTextEntry>({
      query:
        "select * from c where fulltextcontainsany ( c.content.description , @vehicle , @board )",
      parameters: [
        { name: "@vehicle", value: "bicycle" },
        { name: "@board", value: "skateboard" },
      ],
    });

    assert.deepEqual(
      result.map(({ id }) => id),
      ["phrase", "split-terms", "skateboard"],
    );
    logCounts({ ag: 1 });
  });

  test("query: full-text functions combine with scalar filters before TOP", async () => {
    const c = await getFullTextContainer();
    const query = new Query({
      top: 1,
      where: [
        ["status", "=", "active"],
        [
          "FULLTEXTCONTAINSANY(c.content.description, @vehicle, @board)",
          { "@vehicle": "bicycle", "@board": "skateboard" },
        ],
      ],
    });

    const result = await c.query<FullTextEntry>(query);

    assert.deepEqual(
      result.map(({ id }) => id),
      ["phrase"],
    );
    logCounts({ ag: 1 });
  });

  const invalidFullTextParameterCases: [
    string,
    FullTextFunction,
    string[],
    Record<string, JSONValue>,
    string,
  ][] = [
    [
      "missing parameter",
      "FULLTEXTCONTAINS",
      ["@term"],
      {},
      "Invalid FULLTEXTCONTAINS parameter @term: expected a string",
    ],
    [
      "non-string parameter",
      "FULLTEXTCONTAINS",
      ["@term"],
      { "@term": 42 },
      "Invalid FULLTEXTCONTAINS parameter @p0: expected a string",
    ],
    [
      "missing ALL parameter",
      "FULLTEXTCONTAINSALL",
      ["@first", "@second"],
      { "@first": "red" },
      "Invalid FULLTEXTCONTAINSALL parameter @second: expected a string",
    ],
    [
      "non-string ANY parameter",
      "FULLTEXTCONTAINSANY",
      ["@first", "@second"],
      { "@first": "red", "@second": { term: "bicycle" } },
      "Invalid FULLTEXTCONTAINSANY parameter @p1: expected a string",
    ],
  ];

  invalidFullTextParameterCases.forEach(
    ([name, fn, parameterNames, parameters, message]) => {
      test(`query: ${fn} rejects ${name}`, async () => {
        const c = await getFullTextContainer();

        await assert.rejects(
          c.query(getFullTextQuery(fn, parameterNames, parameters)),
          { message },
        );
        logCounts({ error: 1 });
      });
    },
  );

  const unsupportedFullTextClauses = [
    'FULLTEXTCONTAINS(c.content.description, "red")',
    'FULLTEXTCONTAINS(c.content.description, {"term":"red","distance":1})',
    "FULLTEXTCONTAINS(@term, c.content.description)",
    "FULLTEXTCONTAINS(c.content.description, @first, @second)",
    "FULLTEXTCONTAINSALL(c.content.description)",
    "FULLTEXTSCORE(c.content.description, @term)",
  ];

  unsupportedFullTextClauses.forEach((clause) => {
    test(`query: rejects unsupported full-text clause ${clause}`, async () => {
      const c = await getFullTextContainer();

      const parameters = {
        "@term": "red",
        "@first": "red",
        "@second": "bicycle",
      };
      const [builtClause] = Where.raw([clause, parameters]).build();
      await assert.rejects(
        c.query(
          new Query({
            where: [[clause, parameters]],
          }),
        ),
        { message: `Unsupported WHERE condition in mock: ${builtClause}` },
      );
      logCounts({ error: 1 });
    });
  });

  test("query: custom filter takes precedence over built-in full-text evaluation", async () => {
    const clause = "FULLTEXTCONTAINS(c.content.description, @term)";
    const customFilter: MockQueryDef = {
      matcher: "FULLTEXTCONTAINS(c.content.description, @p0)",
      fn: ({ items }) => items.filter((item) => item["id"] === "skateboard"),
    };
    const c = await getFullTextContainer([customFilter]);

    const result = await c.query<FullTextEntry>(
      new Query({ where: [[clause, { "@term": "red bicycle" }]] }),
    );

    assert.deepEqual(
      result.map(({ id }) => id),
      ["skateboard"],
    );
    logCounts({ ag: 1 });
  });

  test(
    "query: TOP without WHERE",
    testSuccess(
      async (c) => c.query<Entry>(new Query({ top: 2 })),
      mockDB.slice(0, 2),
    ),
  );

  test(
    "query: TOP with WHERE from Query builder",
    testSuccess(
      async (c) =>
        c.query<Entry>(new Query({ top: 1, where: [["val", ">", 100]] })),
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
        message: `Invalid property path "${invalid}". Only A-Za-z0-9_ identifiers separated by '.' are allowed.`,
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

  test("item operations: allow IDs containing percent signs", async () => {
    const c = await getContainer();
    const item = { id: "50%off", pkey: "item", val: 42, _ts: 0 };
    assert.deepEqual(await c.upsertItem(item), item);
    assert.deepEqual(await c.getItem(item.id, item.pkey), item);
    await c.deleteItem(item.id, item.pkey);
    assert.equal(await c.getItem(item.id, item.pkey), undefined);
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
});
