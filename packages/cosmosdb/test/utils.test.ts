import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { validateItemId, validatePropPath } from "../src/utils.ts";

describe("DB: Utils", () => {
  const validPropPaths = ["id", "_ts", "location.code", "a1.b2_c3"];

  validPropPaths.forEach((value) => {
    test(`validatePropPath: accepts ${value}`, () => {
      assert.doesNotThrow(() => validatePropPath(value));
    });
  });

  const invalidPropPaths = ["", ".a", "a.", "a..b", "a b", "a/b"];

  invalidPropPaths.forEach((value) => {
    test(`validatePropPath: rejects ${value || "empty string"}`, () => {
      assert.throws(() => validatePropPath(value), {
        message: `Invalid property path "${value}". Only A-Za-z0-9_ identifiers separated by '.' are allowed.`,
      });
    });
  });

  const validItemIds = ["1", "50%off", "a".repeat(1023), "\u00e9".repeat(511)];

  validItemIds.forEach((id) => {
    test(`validateItemId: accepts ${id.length} character ID`, () => {
      assert.doesNotThrow(() => validateItemId(id));
    });
  });

  test("validateItemId: rejects empty IDs", () => {
    assert.throws(() => validateItemId(""), {
      message: "Item ID must not be empty.",
    });
  });

  ["/", "\\", "#", "?"].forEach((character) => {
    test(`validateItemId: rejects IDs containing ${character}`, () => {
      assert.throws(() => validateItemId(`a${character}b`), {
        message: `Item ID contains an invalid character ('/', '\\', '#', or '?'). These are not allowed in Cosmos DB item IDs.`,
      });
    });
  });

  test("validateItemId: rejects IDs exceeding 1023 bytes", () => {
    assert.throws(() => validateItemId("a".repeat(1024)), {
      message: "Item ID exceeds the maximum allowed length of 1023 bytes.",
    });
  });
});
