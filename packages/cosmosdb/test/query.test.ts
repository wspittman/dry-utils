import type { JSONValue } from "@azure/cosmos";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Query } from "../src/Query.ts";
import { Where } from "../src/Where.ts";

describe("DB: Query", () => {
  test("build: empty options", () => {
    assert.deepEqual(new Query().build(), {
      query: "SELECT * FROM c",
      parameters: [],
    });
  });

  test("build: applies all options", () => {
    const result = new Query({
      select: "ID",
      top: 24,
      where: [
        ["status", "=", "active"],
        Where.any([
          ["type", "=", "article"],
          ["type", "=", "video"],
        ]),
      ],
      orderBy: [["status"], ["_ts", "DESC"]],
    }).build();

    assert.equal(
      result.query,
      "SELECT TOP 24 c.id FROM c WHERE (c.status = @p0) AND ((c.type = @p1) OR (c.type = @p2)) ORDER BY c.status ASC, c._ts DESC",
    );
    assert.deepEqual(result.parameters, [
      { name: "@p0", value: "active" },
      { name: "@p1", value: "article" },
      { name: "@p2", value: "video" },
    ]);
  });

  const selectorCases = [
    ["*", "SELECT * FROM c"],
    ["ID", "SELECT c.id FROM c"],
    ["COUNT", "SELECT VALUE COUNT(1) FROM c"],
  ] as const;

  selectorCases.forEach(([select, expected]) => {
    test(`build: ${select} selector`, () => {
      assert.equal(new Query({ select }).build().query, expected);
    });
  });

  test("constructor: rejects top below one", () => {
    assert.throws(() => new Query({ top: 0 }), {
      message: "Query: Max results must be greater than 0",
    });
  });

  test("constructor: rejects invalid order field", () => {
    assert.throws(() => new Query({ orderBy: [["status; DROP TABLE c--"]] }), {
      message: /Invalid property path/,
    });
  });

  test("build: one parameter sequence spans every top-level predicate", () => {
    const origin = {
      type: "Point",
      coordinates: [-122.335167, 47.608013],
    } satisfies JSONValue;
    const result = new Query({
      where: [
        ["status", "=", "active"],
        Where.raw([
          "ST_DISTANCE(c.location, @origin) <= @distance",
          { "@origin": origin, "@distance": 25_000 },
        ]),
        ["status", "=", "pending"],
      ],
    }).build();

    assert.equal(
      result.query,
      "SELECT * FROM c WHERE (c.status = @p0) AND (ST_DISTANCE(c.location, @p1) <= @p2) AND (c.status = @p3)",
    );
    assert.deepEqual(result.parameters, [
      { name: "@p0", value: "active" },
      { name: "@p1", value: origin },
      { name: "@p2", value: 25_000 },
      { name: "@p3", value: "pending" },
    ]);
  });

  test("build: is deterministic", () => {
    const query = new Query({
      where: [
        ["status", "=", "active"],
        ["status", "=", "pending"],
      ],
    });

    assert.deepEqual(query.build(), query.build());
  });
});
