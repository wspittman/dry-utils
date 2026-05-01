import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { inspect } from "node:util";
import { transports } from "winston";
import { configureGlobal, createCustomLogger, logger } from "../src/index.ts";

const testConfig = {
  level: "debug",
  filename: "custom.log",
  consoleLevel: "warn",
  fileLevel: "error",
};

const date = new Date("2023-01-01T12:00:00Z");
const array = [1, 2, 3];
const longArray = Array(20).fill(1);
const deepArray = Array(5).fill(Array(5).fill(Array(5).fill(array)));
const object = { name: "test", value: 123 };
const deepObject = {
  level1: {
    level2: {
      level3: {
        deepValue: "too deep",
      },
    },
  },
};

describe("Winston/Logger: createCustomLogger", () => {
  [undefined, testConfig].forEach((config) => {
    test(`createCustomLogger: ${config ? "custom" : "default"}`, () => {
      const logger = createCustomLogger(config, true);
      assert.equal(
        logger.level,
        config?.level ?? "info",
        "Logger should have correct level",
      );
      assert.equal(logger.transports.length, 2);

      const consoleOut = logger.transports[0] as typeof transports.Console;
      assert.ok(consoleOut instanceof transports.Console);
      assert.equal(
        consoleOut.level,
        config?.consoleLevel ?? "info",
        "Console transport should have correct level",
      );

      const fileOut = logger.transports[1] as typeof transports.File;
      assert.ok(fileOut instanceof transports.File);
      assert.equal(
        fileOut.level,
        config?.fileLevel ?? "debug",
        "File transport should have correct level",
      );
      assert.equal(
        fileOut.filename,
        config?.filename ?? "app.log",
        "File transport should have correct filename",
      );
    });
  });
});

const formatTestCases: Record<string, { val: unknown; collapse?: boolean }> = {
  undefined: { val: undefined },
  number: { val: 42 },
  true: { val: true },
  false: { val: false },
  string: { val: "string" },
  date: { val: date },
  "simple array": { val: array, collapse: true },
  "long array": { val: longArray, collapse: true },
  "deep array": { val: deepArray },
  "simple object": { val: object },
  "deep object": { val: deepObject },
};

const getInitialInfo = (name: string, val: unknown) => ({
  level: "info",
  message: name,
  [Symbol.for("splat")]: val == null ? val : [val],
});

const getFullInfo = (name: string, val: unknown) => ({
  ...getInitialInfo(name, val),
  timestamp: "00:00.000",
  splat: val,
});

describe("Winston/Logger: format", () => {
  Object.entries(formatTestCases).forEach(([name, { val }]) => {
    test(`format: ${name}`, () => {
      const input = getInitialInfo(name, val);
      const expected = getFullInfo(name, val);
      const { format } = createCustomLogger(testConfig, true);
      const result = format.transform(input);

      if (typeof result !== "object") {
        assert.fail("Should return an object");
      }

      if (typeof result["timestamp"] !== "string") {
        assert.fail("Should add timestamp");
      }

      assert.match(
        result["timestamp"],
        /\d{2}:\d{2}.\d{3}/,
        "Should match timestamp format",
      );

      // To make sure it doesn't fail on the next assertion
      result["timestamp"] = expected.timestamp;

      assert.deepEqual(result, expected);
    });
  });
});

function getTransportTransform(index: number, name: string, val: unknown) {
  const input = getFullInfo(name, val);
  const logger = createCustomLogger(testConfig, true);
  const out = logger.transports[index];
  const result = out?.format?.transform(input);

  if (typeof result !== "object") {
    assert.fail("Should return an object from console format");
  }

  // For winston format objects, the final string is in the [Symbol.for('message')] property
  return result[Symbol.for("message")];
}

describe("Winston/Logger: console format", () => {
  Object.entries(formatTestCases).forEach(([name, { val }]) => {
    test(`console format: ${name}`, () => {
      const result = getTransportTransform(0, name, val);
      // Strip ANSI color codes for comparison
      // eslint-disable-next-line no-control-regex
      const stripped = String(result).replace(/\x1B\[[0-9;]*m/g, "");

      let message = "";
      if (val != null) {
        message = ": " + inspect(val, { colors: false, maxArrayLength: 10 });
      }

      assert.equal(stripped, `00:00.000 [INFO]: ${name}${message}`);
    });
  });
});

describe("Winston/Logger: file format", () => {
  Object.entries(formatTestCases).forEach(([name, { val, collapse }]) => {
    test(`file format: ${name}`, () => {
      const result = getTransportTransform(1, name, val);

      let message = "";
      if (val != null) {
        const spaceArg = collapse ? -1 : 2;
        message = `: ${JSON.stringify(val, null, spaceArg)}`;
      }

      assert.equal(result, `00:00.000 [INFO]: ${name}${message}`);
    });
  });
});

describe("Winston/Logger: globals", () => {
  test("globals", () => {
    // You should see a log line in the test console also during default logger initialization
    assert.equal(logger.level, "info");
    assert.equal(logger.level, "info");

    configureGlobal(testConfig);
    assert.equal(logger.level, "debug");
    assert.equal(logger.level, "debug");

    configureGlobal({});
    // You should see a log line in the test console also during default logger initialization
    assert.equal(logger.level, "info");
    assert.equal(logger.level, "info");
  });
});
