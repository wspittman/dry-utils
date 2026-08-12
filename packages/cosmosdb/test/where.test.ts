import type { JSONValue } from "@azure/cosmos";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  type Condition,
  type RawWhere,
  Where,
  type WhereInput,
} from "../src/Where.ts";

describe("DB: Where", () => {
  const conditionCases: [
    condition: Condition,
    clause: string,
    values: JSONValue[],
  ][] = [
    [["str", "=", true], "c.str = @p0", [true]],
    [["obj.key", ">", 30], "c.obj.key > @p0", [30]],
    [["str", "CONTAINS", "text"], "CONTAINS(c.str, @p0, true)", ["text"]],
    [
      ["description", "FULLTEXTCONTAINS", "red bicycle"],
      "FULLTEXTCONTAINS(c.description, @p0)",
      ["red bicycle"],
    ],
    [
      ["description", "FULLTEXTCONTAINSALL", ["red", "bicycle"]],
      "FULLTEXTCONTAINSALL(c.description, @p0, @p1)",
      ["red", "bicycle"],
    ],
    [
      ["description", "FULLTEXTCONTAINSANY", ["bike", "scooter"]],
      "FULLTEXTCONTAINSANY(c.description, @p0, @p1)",
      ["bike", "scooter"],
    ],
    [
      ["status", "IN", ["active", "pending"]],
      "c.status IN (@p0, @p1)",
      ["active", "pending"],
    ],
  ];

  conditionCases.forEach(([condition, expectedClause, values]) => {
    test(`is: ${condition[0]} ${condition[1]}`, () => {
      const [clause, parameters] = Where.is(...condition).build();

      assert.equal(clause, expectedClause);
      assert.deepEqual(
        parameters,
        Object.fromEntries(values.map((value, index) => [`@p${index}`, value])),
      );
    });
  });

  test("is: rejects invalid field path", () => {
    assert.throws(() => Where.is("x; DROP TABLE c--", "=", "v"), {
      message: /Invalid property path/,
    });
  });

  (["IN", "FULLTEXTCONTAINSALL", "FULLTEXTCONTAINSANY"] as const).forEach(
    (operator) => {
      test(`is: ${operator} rejects an empty array`, () => {
        assert.throws(() => Where.is("description", operator, []), {
          message: `${operator} operator requires at least one value`,
        });
      });
    },
  );

  const rawCases: [name: string, raw: RawWhere, expected: RawWhere][] = [
    [
      "without parameters",
      ["IS_DEFINED(c.status)"],
      ["IS_DEFINED(c.status)", {}],
    ],
    [
      "renames declared parameters",
      ["c.status = @status", { "@status": "active" }],
      ["c.status = @p0", { "@p0": "active" }],
    ],
    [
      "removes an unused parameter",
      ["c.status = @status", { "@status": "active", "@unused": true }],
      ["c.status = @p0", { "@p0": "active" }],
    ],
    [
      "matches exact parameter tokens",
      [
        "c.tag = @tag AND c.tagDetail = @tag_detail",
        { "@tag": "short", "@tag_detail": "long" },
      ],
      ["c.tag = @p0 AND c.tagDetail = @p1", { "@p0": "short", "@p1": "long" }],
    ],
    [
      "leaves undeclared parameter tokens for CosmosDB",
      ["c.status = @missing"],
      ["c.status = @missing", {}],
    ],
  ];

  rawCases.forEach(([name, raw, expected]) => {
    test(`raw: ${name}`, () => {
      assert.deepEqual(Where.raw(...raw).build(), expected);
    });
  });

  test("raw: rejects a declared parameter without @", () => {
    assert.throws(() => Where.raw("c.status = @status", { status: "active" }), {
      message: 'Where: Parameter "status" must start with @',
    });
  });

  const originPoint = {
    type: "Point",
    coordinates: [-122.335167, 47.608013],
  } satisfies JSONValue;
  const distanceOperators = ["<=", ">="] as const;

  distanceOperators.forEach((operator) => {
    test(`distance: ${operator}`, () => {
      const [clause, parameters] = Where.distance(
        "primaryLocation.point",
        originPoint,
        operator,
        25_000,
      ).build();

      assert.equal(
        clause,
        `ST_DISTANCE(c.primaryLocation.point, @p0) ${operator} @p1`,
      );
      assert.deepEqual(parameters, {
        "@p0": originPoint,
        "@p1": 25_000,
      });
    });
  });

  test("distance: rejects invalid field path", () => {
    assert.throws(
      () => Where.distance("point); DROP TABLE c--", originPoint, "<=", 25_000),
      { message: /Invalid property path/ },
    );
  });

  test("any: accepts conditions, raw clauses, and Where instances", () => {
    const inputs = [
      ["status", "=", "active"],
      ["ARRAY_CONTAINS(c.tags, @tag)", { "@tag": "featured" }],
      Where.is("visibility", "=", "public"),
    ] satisfies WhereInput[];

    assert.deepEqual(Where.any(inputs).build(), [
      "(c.status = @p0) OR (ARRAY_CONTAINS(c.tags, @p1)) OR (c.visibility = @p2)",
      { "@p0": "active", "@p1": "featured", "@p2": "public" },
    ]);
  });

  test("all: allocates parameters depth-first through nested groups", () => {
    const where = Where.all([
      ["tenantId", "=", "tenant-1"],
      Where.any([
        ["status", "=", "active"],
        ["status", "=", "pending"],
      ]),
      Where.any([
        Where.all([
          ["type", "=", "article"],
          ["published", "=", true],
        ]),
        Where.all([
          ["type", "=", "video"],
          Where.any([
            ["visibility", "=", "public"],
            ["visibility", "=", "shared"],
          ]),
        ]),
      ]),
    ]);

    assert.deepEqual(where.build(), [
      "(c.tenantId = @p0) AND ((c.status = @p1) OR (c.status = @p2)) AND (((c.type = @p3) AND (c.published = @p4)) OR ((c.type = @p5) AND ((c.visibility = @p6) OR (c.visibility = @p7))))",
      {
        "@p0": "tenant-1",
        "@p1": "active",
        "@p2": "pending",
        "@p3": "article",
        "@p4": true,
        "@p5": "video",
        "@p6": "public",
        "@p7": "shared",
      },
    ]);
  });

  (["any", "all"] as const).forEach((operator) => {
    test(`${operator}: rejects an empty group`, () => {
      assert.throws(() => Where[operator]([]), {
        message: `Where.${operator} requires at least one clause`,
      });
    });

    test(`${operator}: permits a single clause`, () => {
      assert.deepEqual(Where[operator]([["status", "=", "active"]]).build(), [
        "c.status = @p0",
        { "@p0": "active" },
      ]);
    });
  });

  test("build: is deterministic and does not mutate the expression", () => {
    const where = Where.any([
      ["status", "=", "active"],
      ["status", "=", "pending"],
    ]);

    assert.deepEqual(where.build(), where.build());
  });
});
