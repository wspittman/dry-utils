import assert from "node:assert";
import { test } from "node:test";
import { capitalize } from "../src/example.js";

test("capitalize function", async (t) => {
  await t.test("capitalizes first letter and lowercases the rest", () => {
    assert.strictEqual(capitalize("hello"), "Hello");
    assert.strictEqual(capitalize("WORLD"), "World");
    assert.strictEqual(capitalize("javascript"), "Javascript");
  });

  await t.test("handles empty strings", () => {
    assert.strictEqual(capitalize(""), "");
  });

  await t.test("handles already capitalized strings", () => {
    assert.strictEqual(capitalize("Hello"), "Hello");
  });
});
