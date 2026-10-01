import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test, type TestContext } from "node:test";
import { inspect, stripVTControlCharacters } from "node:util";
import { Logger, LogLevel, type ILogObj } from "tslog";
import {
  configureGlobal,
  createCustomLogger,
  logger,
  type LoggerConfig,
} from "../src/index.ts";

const testConfig: LoggerConfig = {
  level: "DEBUG",
  filename: "custom.log",
  consoleLevel: "WARN",
  fileLevel: "ERROR",
};

const date = new Date("2023-01-01T12:00:00Z");
const array = [1, 2, 3];
const formatTestCases: Record<string, { val: unknown; collapse?: boolean }> = {
  undefined: { val: undefined },
  number: { val: 42 },
  true: { val: true },
  false: { val: false },
  string: { val: "string" },
  date: { val: date },
  "simple array": { val: array, collapse: true },
  "long array": { val: Array(20).fill(1), collapse: true },
  "deep array": { val: Array(5).fill(Array(5).fill(Array(5).fill(array))) },
  "simple object": { val: { name: "test", value: 123 } },
  "deep object": {
    val: { level1: { level2: { level3: { deepValue: "too deep" } } } },
  },
};

function captureOutput(t: TestContext, config: LoggerConfig = {}) {
  t.mock.timers.enable({ apis: ["Date"], now: date.getTime() });
  const consoleOut = t.mock.method(console, "log", () => {});
  const log = createCustomLogger(config, true);
  const file = log.settings.attachedTransports[1];
  assert.ok(file);
  const fileOut = t.mock.method(file, "write", () => {});
  return { log, consoleOut, fileOut };
}

describe("TSLog/Logger: createCustomLogger", () => {
  [undefined, testConfig].forEach((config) => {
    test(`createCustomLogger: ${config ? "custom" : "default"}`, () => {
      const log = createCustomLogger(config, true);
      assert.ok(log instanceof Logger);
      assert.equal(log.settings.minLevel, LogLevel[config?.level ?? "SILLY"]);
      assert.equal(log.settings.attachedTransports.length, 2);
      const [consoleOut, fileOut] = log.settings.attachedTransports;
      assert.equal(consoleOut?.name, "console");
      assert.equal(consoleOut?.minLevel, config?.consoleLevel ?? "INFO");
      assert.equal(consoleOut?.format, "pretty");
      assert.equal(fileOut?.name, "file");
      assert.equal(fileOut?.minLevel, config?.fileLevel ?? "DEBUG");
      assert.equal(typeof fileOut?.format, "function");
    });
  });

  test("writes to the configured filename", async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "dry-utils-logger-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    t.mock.method(console, "log", () => {});
    const filename = join(directory, "custom.log");
    await using log = createCustomLogger({ filename }, true);
    log.info("file destination");
    await log.flush();
    assert.match(
      await readFile(filename, "utf8"),
      / INFO: "file destination"\n$/,
    );
  });

  test("filters logger and transport levels", (t) => {
    const { log, consoleOut, fileOut } = captureOutput(t, testConfig);
    log.trace("trace");
    log.debug("debug");
    log.info("info");
    log.warn("warn");
    log.error("error");
    assert.deepEqual(
      consoleOut.mock.calls.map(({ arguments: [line] }) =>
        stripVTControlCharacters(String(line)),
      ),
      [
        "2023-01-01 12:00:00.000 WARN warn",
        "2023-01-01 12:00:00.000 ERROR error",
      ],
    );
    assert.equal(fileOut.mock.callCount(), 1);
    assert.equal(
      fileOut.mock.calls[0]?.arguments[1],
      '2023-01-01T12:00:00.000Z ERROR: "error"',
    );
  });

  test("writes debug messages to the file with default levels", (t) => {
    const { log, consoleOut, fileOut } = captureOutput(t);
    log.debug("file debug");
    assert.equal(consoleOut.mock.callCount(), 0);
    assert.equal(fileOut.mock.callCount(), 1);
    assert.equal(
      fileOut.mock.calls[0]?.arguments[1],
      '2023-01-01T12:00:00.000Z DEBUG: "file debug"',
    );
  });

  test("honors a console level below the default logger level", (t) => {
    const { log, consoleOut, fileOut } = captureOutput(t, {
      consoleLevel: "DEBUG",
      fileLevel: "ERROR",
    });
    log.debug("console debug");
    assert.equal(fileOut.mock.callCount(), 0);
    assert.equal(consoleOut.mock.callCount(), 1);
    assert.equal(
      stripVTControlCharacters(String(consoleOut.mock.calls[0]?.arguments[0])),
      "2023-01-01 12:00:00.000 DEBUG console debug",
    );
  });
});

describe("TSLog/Logger: format", () => {
  Object.entries(formatTestCases).forEach(([name, { val }]) => {
    test(`format: ${name}`, (t) => {
      const { log, fileOut } = captureOutput(t);
      log.info(name, val);
      assert.equal(fileOut.mock.callCount(), 1);
      const record = fileOut.mock.calls[0]?.arguments[0];
      assert.ok(record);
      const { [log.settings.meta.property]: meta, ...values } = record;
      assert.deepEqual(Object.entries(values), [
        ["0", name],
        ["1", val],
      ]);
      assert.ok(meta);
      assert.equal(meta.logLevelId, LogLevel.INFO);
      assert.equal(meta.logLevelName, "INFO");
      assert.deepEqual(meta.date, date);
    });
  });
});

describe("TSLog/Logger: console format", () => {
  Object.entries(formatTestCases).forEach(([name, { val }]) => {
    test(`console format: ${name}`, (t) => {
      const { log, consoleOut } = captureOutput(t);
      log.info(name, val);
      assert.equal(consoleOut.mock.callCount(), 1);
      const result = stripVTControlCharacters(
        String(consoleOut.mock.calls[0]?.arguments[0]),
      );
      const message =
        typeof val === "string"
          ? val
          : inspect(val, { colors: false, maxArrayLength: 10 });
      assert.equal(result, `2023-01-01 12:00:00.000 INFO ${name} ${message}`);
    });
  });
});

describe("TSLog/Logger: file format", () => {
  const circular: Record<string, unknown> = { id: 42 };
  circular["self"] = circular;
  Object.entries({ circular, bigint: 42n }).forEach(([name, value]) => {
    test(`preserves the file entry for ${name} metadata`, (t) => {
      const { log, fileOut } = captureOutput(t);
      assert.doesNotThrow(() => log.info(name, value));
      assert.equal(fileOut.mock.callCount(), 1);
      assert.equal(
        stripVTControlCharacters(String(fileOut.mock.calls[0]?.arguments[1])),
        `2023-01-01T12:00:00.000Z INFO: "${name}": ${inspect(value, { colors: false, maxArrayLength: 10 })}`,
      );
    });
  });

  test("preserves nested native error details", (t) => {
    const { log, fileOut } = captureOutput(t);
    const error = new Error("database unavailable");
    error.stack = "Error: database unavailable\n    at database.ts:10:2";
    log.error("request failed", { error });
    assert.equal(fileOut.mock.callCount(), 1);
    assert.equal(
      fileOut.mock.calls[0]?.arguments[1],
      `2023-01-01T12:00:00.000Z ERROR: "request failed": ${JSON.stringify(
        {
          error: {
            name: error.name,
            message: error.message,
            stack: error.stack,
          },
        },
        null,
        2,
      )}`,
    );
  });

  Object.entries(formatTestCases).forEach(([name, { val, collapse }]) => {
    test(`file format: ${name}`, (t) => {
      const { log, fileOut } = captureOutput(t);
      log.info(name, val);
      assert.equal(fileOut.mock.callCount(), 1);
      const message = JSON.stringify(val, null, collapse ? undefined : 2);
      assert.equal(
        fileOut.mock.calls[0]?.arguments[1],
        `2023-01-01T12:00:00.000Z INFO: "${name}": ${message}`,
      );
    });
  });
});

describe("TSLog/Logger: globals", () => {
  test("preserves error details through the global wrapper", (t) => {
    const { log, fileOut } = captureOutput(t);
    const error = new Error("database unavailable");
    log.error("request failed", error);
    const expected = fileOut.mock.calls[0]?.arguments[1];
    assert.ok(expected);
    assert.match(expected, /"message": "database unavailable"/);
    assert.match(expected, /"stack":/);
    fileOut.mock.resetCalls();

    configureGlobal({ level: "ERROR" });
    t.after(() => configureGlobal({}));
    const attachTransport = Logger.prototype.attachTransport;
    t.mock.method(
      Logger.prototype,
      "attachTransport",
      function (
        this: Logger<ILogObj>,
        transport: Parameters<Logger<ILogObj>["attachTransport"]>[0],
      ) {
        if (typeof transport !== "function" && transport.name === "file") {
          transport.write = fileOut;
        }
        return attachTransport.call(this, transport);
      },
    );

    logger.error("request failed", error);
    assert.equal(fileOut.mock.callCount(), 1);
    assert.equal(fileOut.mock.calls[0]?.arguments[1], expected);
  });

  test("globals", (t) => {
    t.after(() => configureGlobal({}));
    const consoleOut = t.mock.method(console, "log", () => {});
    const attachTransport = Logger.prototype.attachTransport;
    t.mock.method(
      Logger.prototype,
      "attachTransport",
      function (
        this: Logger<ILogObj>,
        transport: Parameters<Logger<ILogObj>["attachTransport"]>[0],
      ) {
        if (typeof transport !== "function" && transport.name === "file") {
          transport.write = () => {};
        }
        return attachTransport.call(this, transport);
      },
    );

    [undefined, testConfig, {}].forEach((config) => {
      if (config) configureGlobal(config);
      consoleOut.mock.resetCalls();
      logger.debug("debug");
      logger.info("info");
      logger.warn("warn");
      const lines = consoleOut.mock.calls.map(({ arguments: [line] }) =>
        stripVTControlCharacters(String(line)),
      );
      if (config === testConfig) {
        assert.equal(lines.length, 1);
        assert.match(lines[0]!, / WARN warn$/);
      } else {
        assert.equal(lines.length, 3);
        assert.match(lines[0]!, / INFO Logger initialized @ /);
        assert.match(lines[1]!, / INFO info$/);
        assert.match(lines[2]!, / WARN warn$/);
      }
    });
  });
});
