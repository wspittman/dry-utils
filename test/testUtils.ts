import assert from "node:assert/strict";
import { Mock, mock } from "node:test";

type MockFn = Mock<Function>;

function dir(fn: MockFn) {
  console.dir(
    fn.mock.calls.map((x) => x.arguments),
    { depth: null }
  );
}

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
