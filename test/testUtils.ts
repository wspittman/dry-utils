import assert from "node:assert/strict";
import { Mock, mock } from "node:test";

export function mockExternalLog() {
  const logFn = mock.fn();
  const errorFn = mock.fn();
  const aggregatorFn = mock.fn(() => ({ count: 0, counts: {} }));

  return {
    logOptions: { logFn, errorFn, aggregatorFn },
    logCounts: (
      { log, error, ag }: Partial<Record<"log" | "error" | "ag", number>>,
      msg = ""
    ) => {
      const check = (name: string, fn: Mock<Function>, count: number = 0) => {
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
  };
}
