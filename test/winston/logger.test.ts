import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { transports } from "winston";
import { createCustomLogger } from "../../src/winston/logger";

describe("Winston / Logger Module", () => {
  const customConfig = {
    level: "debug",
    filename: "custom.log",
    consoleLevel: "warn",
    fileLevel: "error",
  };

  [undefined, customConfig].forEach((config) => {
    test(`createCustomLogger: ${config ? "custom" : "default"}`, () => {
      const logger = createCustomLogger(config, true);
      assert.equal(
        logger.level,
        config?.level ?? "info",
        "Logger should have correct level"
      );
      assert.equal(logger.transports.length, 2);

      const consoleOut = logger.transports[0] as typeof transports.Console;
      assert.equal(consoleOut instanceof transports.Console, true);
      assert.equal(
        consoleOut.level,
        config?.consoleLevel ?? "info",
        "Console transport should have correct level"
      );

      const fileOut = logger.transports[1] as typeof transports.File;
      assert.equal(fileOut instanceof transports.File, true);
      assert.equal(
        fileOut.level,
        config?.fileLevel ?? "debug",
        "File transport should have correct level"
      );
      assert.equal(
        fileOut.filename,
        config?.filename ?? "app.log",
        "File transport should have correct filename"
      );
    });
  });
});
