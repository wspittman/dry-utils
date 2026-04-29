import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { type Condition, Query } from "../src/Query.ts";

describe("DB: Query", () => {
  const conditionCases: [...Condition, string][] = [
    ["str", "=", true, "c.str = @str"],
    ["obj.key1.key2", ">", 30, "c.obj.key1.key2 > @obj_key1_key2"],
    ["str", "CONTAINS", "text", "CONTAINS(c.str, @str, true)"],
    [
      "obj.key1.key2",
      "CONTAINS",
      "text",
      "CONTAINS(c.obj.key1.key2, @obj_key1_key2, true)",
    ],
  ];

  conditionCases.forEach(([field, operator, value, expected]) => {
    test(`Condition: ${field} ${operator} ${value}`, () => {
      const [clause, params] = Query.condition(field, operator, value);

      const expectedParam = field.replace(/\./g, "_");
      assert.equal(clause, expected);
      assert.deepEqual(params, { [`@${expectedParam}`]: value });
    });
  });

  conditionCases.forEach(([field, operator, value, expected]) => {
    test(`WhereCondition: ${field} ${operator} ${value}`, () => {
      const query = new Query();
      query.whereCondition(field, operator, value);
      const result = query.build();

      const expectedParam = field.replace(/\./g, "_");
      assert.equal(result.query, `SELECT * FROM c WHERE (${expected})`);
      assert.deepEqual(result.parameters, [
        { name: `@${expectedParam}`, value },
      ]);
    });
  });

  const whereCases: [string, string[]][] = [
    ["str = 'text'", []],
    ["str = @str", ["@str"]],
    ["str = @str AND obj.key > @obj_key", ["@str", "@obj_key"]],
  ];

  whereCases.forEach(([expected, params]) => {
    test(`Where: ${expected}`, () => {
      const query = new Query();
      query.where([
        expected,
        Object.fromEntries(params.map((param) => [param, "value"])),
      ]);
      const result = query.build();

      assert.equal(result.query, `SELECT * FROM c WHERE (${expected})`);
      assert.deepEqual(
        result.parameters,
        params.map((param) => ({
          name: param,
          value: "value",
        })),
      );
    });
  });

  test("top: applies TOP clause", () => {
    const result = new Query().top(24).build();

    assert.equal(result.query, "SELECT TOP 24 * FROM c");
    assert.deepEqual(result.parameters, []);
  });

  test("top: throws when max < 1", () => {
    assert.throws(() => new Query().top(0), {
      message: "Query: Max results must be greater than 0",
    });
  });

  test("select: ID", () => {
    const result = new Query().select("ID").build();
    assert.equal(result.query, "SELECT c.id FROM c");
    assert.deepEqual(result.parameters, []);
  });

  test("select: COUNT", () => {
    const result = new Query().select("COUNT").build();
    assert.equal(result.query, "SELECT VALUE COUNT(1) FROM c");
    assert.deepEqual(result.parameters, []);
  });

  test("constructor: with selector", () => {
    const result = new Query("ID").build();
    assert.equal(result.query, "SELECT c.id FROM c");
    assert.deepEqual(result.parameters, []);
  });

  test("constructor: with selector and condition", () => {
    const result = new Query("COUNT", ["status", "=", "active"]).build();
    assert.equal(
      result.query,
      "SELECT VALUE COUNT(1) FROM c WHERE (c.status = @status)",
    );
    assert.deepEqual(result.parameters, [{ name: "@status", value: "active" }]);
  });

  test("build: stacked clauses", () => {
    const result = new Query()
      .whereCondition("str", "=", "text")
      .where(["ARRAY_CONTAINS(c.tags, @tag)", { "@tag": "sale" }])
      .whereCondition("str2", "CONTAINS", "text")
      .where(["c.obj.key > @key", { "@key": 30 }])
      .build();

    assert.equal(
      result.query,
      `SELECT * FROM c WHERE (c.str = @str) AND (ARRAY_CONTAINS(c.tags, @tag)) AND (CONTAINS(c.str2, @str2, true)) AND (c.obj.key > @key)`,
    );
    assert.deepEqual(result.parameters, [
      { name: "@str", value: "text" },
      { name: "@tag", value: "sale" },
      { name: "@str2", value: "text" },
      { name: "@key", value: 30 },
    ]);
  });

  test("build: stacked clauses with overlapping parameters", () => {
    const result = new Query()
      .whereCondition("str", "=", "text")
      .where(["ARRAY_CONTAINS(c.tags, @tag)", { "@tag": 30 }])
      .whereCondition("str", "CONTAINS", "text")
      .where(["c.obj.key > @tag"])
      .build();

    assert.equal(
      result.query,
      `SELECT * FROM c WHERE (c.str = @str) AND (ARRAY_CONTAINS(c.tags, @tag)) AND (CONTAINS(c.str, @str, true)) AND (c.obj.key > @tag)`,
    );
    assert.deepEqual(result.parameters, [
      { name: "@str", value: "text" },
      { name: "@tag", value: 30 },
    ]);
  });
});
