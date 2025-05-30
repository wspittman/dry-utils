import assert from "node:assert/strict";
import { type Mock, mock } from "node:test";
import type { Aggregator } from "./externalLog.ts";

type MockFn = Mock<(msg: string, val?: unknown) => void>;

function dir(fn: MockFn) {
  console.dir(
    fn.mock.calls.map((x) => x.arguments),
    { depth: null }
  );
}

export function mockExternalLog(): {
  logOptions: {
    logFn: MockFn;
    errorFn: MockFn;
    aggregatorFn: Mock<() => Aggregator>;
    logCallFn: MockFn;
  };
  logCounts: (
    { log, error, ag }: Partial<Record<"log" | "error" | "ag", number>>,
    msg?: string
  ) => void;
  logReset: () => void;
  debug: () => void;
} {
  const logFn = mock.fn();
  const errorFn = mock.fn();
  const aggregatorFn = mock.fn((): Aggregator => ({ count: 0, counts: {} }));

  return {
    logOptions: {
      logFn,
      errorFn,
      aggregatorFn,
      logCallFn: logFn,
    },
    logCounts: ({ log, error, ag }, msg = "") => {
      const check = (name: string, fn: MockFn, count: number = 0) => {
        assert.equal(fn.mock.callCount(), count, `${name} count ${msg}`);
      };
      check("logFn", logFn, log);
      check("errorFn", errorFn, error);
      check("aggregatorFn", aggregatorFn, ag);
    },
    logReset: () => {
      logFn.mock.resetCalls();
      errorFn.mock.resetCalls();
      aggregatorFn.mock.resetCalls();
    },
    debug: () => {
      dir(logFn);
      dir(errorFn);
    },
  };
}
