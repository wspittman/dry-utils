import assert from "node:assert/strict";
import fs from "node:fs";
import { afterEach, beforeEach, describe, mock, test } from "node:test";
import { loadMockDBData } from "../src/mockDbData.ts";

describe("DB: loadMockDBData", () => {
  describe("returns undefined when no sources configured", () => {
    const emptyCases: [string, object][] = [
      ["no options", {}],
      ["empty strings", { mockDataJson: "", mockDataPath: "" }],
      ["whitespace strings", { mockDataJson: "  ", mockDataPath: "  " }],
    ];

    emptyCases.forEach(([label, options]) => {
      test(label, () => {
        assert.equal(loadMockDBData(options), undefined);
      });
    });
  });

  describe("inline JSON", () => {
    test("parses valid JSON object", () => {
      const data = { users: [{ id: "1", pkey: "a" }] };
      const result = loadMockDBData({ mockDataJson: JSON.stringify(data) });
      assert.deepEqual(result, data);
    });

    test("throws on invalid JSON", () => {
      assert.throws(
        () => loadMockDBData({ mockDataJson: "not-json" }),
        /Invalid Cosmos DB mock data JSON in mockDataJson/,
      );
    });

    test("throws when JSON is an array", () => {
      assert.throws(
        () => loadMockDBData({ mockDataJson: "[]" }),
        /must be a JSON object keyed by container name/,
      );
    });

    test("throws when JSON is a primitive", () => {
      assert.throws(
        () => loadMockDBData({ mockDataJson: "42" }),
        /must be a JSON object keyed by container name/,
      );
    });
  });

  describe("file path", () => {
    let readFileSyncMock: ReturnType<typeof mock.method>;

    beforeEach(() => {
      readFileSyncMock = mock.method(fs, "readFileSync", () =>
        JSON.stringify({ orders: [{ id: "2", pkey: "b" }] }),
      );
    });

    afterEach(() => {
      readFileSyncMock.mock.restore();
    });

    test("reads and parses file", () => {
      const result = loadMockDBData({ mockDataPath: "/data/mock-data.json" });
      assert.deepEqual(result, { orders: [{ id: "2", pkey: "b" }] });
      assert.equal(readFileSyncMock.mock.calls.length, 1);
    });

    test("throws on file read error", () => {
      readFileSyncMock.mock.mockImplementation(() => {
        throw new Error("file not found");
      });
      assert.throws(
        () => loadMockDBData({ mockDataPath: "/data/missing.json" }),
        /file not found/,
      );
    });

    test("throws when file JSON is an array", () => {
      readFileSyncMock.mock.mockImplementation(() => "[]");
      assert.throws(
        () => loadMockDBData({ mockDataPath: "bad.json" }),
        /must be a JSON object keyed by container name/,
      );
    });
  });

  describe("merging sources", () => {
    let readFileSyncMock: ReturnType<typeof mock.method>;

    beforeEach(() => {
      readFileSyncMock = mock.method(fs, "readFileSync", () =>
        JSON.stringify({
          orders: [{ id: "2", pkey: "b" }],
          shared: [{ id: "file" }],
        }),
      );
    });

    afterEach(() => {
      readFileSyncMock.mock.restore();
    });

    test("inline JSON overrides duplicate keys from file", () => {
      const inlineData = {
        users: [{ id: "1", pkey: "a" }],
        shared: [{ id: "inline" }],
      };
      const result = loadMockDBData({
        mockDataJson: JSON.stringify(inlineData),
        mockDataPath: "mock-data.json",
      });
      assert.deepEqual(result, {
        orders: [{ id: "2", pkey: "b" }],
        users: [{ id: "1", pkey: "a" }],
        shared: [{ id: "inline" }],
      });
    });
  });
});
