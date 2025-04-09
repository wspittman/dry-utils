import assert from "node:assert/strict";
import { beforeEach, describe, mock, test, TestContext } from "node:test";
// Note: Destructuring functions such as import { setTimeout } from 'node:timers' is currently not supported by [Mock Timers] API.
import { mockExternalLog } from "dry-utils-shared";
import timers from "node:timers/promises";
import { batch } from "../src/batch.ts";
import { setAsyncLogging } from "../src/index.ts";

/**
 * Mocks timers for testing
 * Note: MockTimers in node:test is still Stability: 1 - Experimental in Node v22
 * @param context - The test context
 * @returns A function to tick the mocked timers
 */
function mockTimers(context: TestContext) {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  return async (ms: number) => {
    // Advance the mocked timers by the given number of milliseconds
    context.mock.timers.tick(ms);
    // Force the event loop to run all pending callbacks
    await timers.setImmediate();
  };
}

describe("Async/Batch", () => {
  const { logOptions, logCounts, logReset } = mockExternalLog();
  setAsyncLogging(logOptions);
  const batchFn = mock.fn(async (val: number) => {
    await timers.setTimeout(100);
    if (val < 0) throw new Error("Negative");
  });

  function callCounts(log: number, error: number, batch: number, msg = "") {
    logCounts({ log, error }, msg);
    assert.equal(batchFn.mock.callCount(), batch, `batchFn count ${msg}`);
  }

  beforeEach(() => {
    logReset();
    batchFn.mock.resetCalls();
  });

  test("batch: empty", async () => {
    await batch("empty", [], batchFn);
    callCounts(0, 0, 0);
  });

  const testAr = (count: number, fn?: (i: number) => number) => {
    const ar = Array(count).fill(0);
    return fn ? ar.map((_, i) => fn(i)) : ar;
  };

  const cases: [string, number[]][] = [
    ["single", testAr(1)],
    ["four", testAr(4)],
    ["five", testAr(5)],
    ["six", testAr(6)],
    ["twenty five", testAr(25)],
    ["one error somewhere", testAr(25, (i) => (i === 13 ? -1 : 0))],
    ["one error per batch", testAr(25, (i) => (i % 5 ? 0 : -1))],
    ["all errors", testAr(25, () => -1)],
  ];

  for (const [name, values] of cases) {
    test(`batch: ${name}`, async (context) => {
      const tick = mockTimers(context);

      let isPending = true;
      batch(name, values, batchFn).then(() => (isPending = false));

      const errsForBatch = (n: number) =>
        values.slice(n * 5, (n + 1) * 5).filter(Boolean).length;

      const totalBatches = Math.ceil(values.length / 5);
      let currentBatch = 0;
      let errCount = 0;

      while (currentBatch < totalBatches) {
        const expectedCount = Math.min((currentBatch + 1) * 5, values.length);
        callCounts(1, errCount, expectedCount, `at batch ${currentBatch}`);
        assert.ok(isPending, `Should be pending at batch ${currentBatch}`);

        await tick(100);

        errCount += errsForBatch(currentBatch);
        currentBatch++;
      }

      callCounts(2, errCount, values.length, "after completion");
      assert.ok(!isPending, "Batch should be complete");
    });
  }
});
