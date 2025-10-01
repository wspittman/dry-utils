import assert from "node:assert/strict";
import { afterEach, describe, mock, test } from "node:test";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import { proseCompletion, subscribeOpenAILogging, z } from "../src/index.ts";

// OPENAI_API_KEY present in .env, referenced directly in OpenAI SDK

const aiActionLog = { agg: 1 };

describe("OpenAI E2E Flow", () => {
  // Note: Each test is dependent on the previous one
  let history: ResponseInputItem[] = [];

  const logFn = mock.fn();
  const errorFn = mock.fn();
  const aggFn = mock.fn();
  subscribeOpenAILogging({ log: logFn, error: errorFn, aggregate: aggFn });

  function logCounts({ log = 0, error = 0, agg = 0 }, msg = "") {
    assert.equal(logFn.mock.callCount(), log, `logFn count ${msg}`);
    assert.equal(errorFn.mock.callCount(), error, `errorFn count ${msg}`);
    assert.equal(aggFn.mock.callCount(), agg, `aggFn count ${msg}`);
  }

  afterEach(() => {
    logFn.mock.resetCalls();
    errorFn.mock.resetCalls();
    aggFn.mock.resetCalls();
  });

  test("proseCompletion: minimal", async () => {
    const response = await proseCompletion(
      "Test_Simple",
      "Follow the user's instructions explicitly",
      "Repeat the word 'complete' back to me, only that single word"
    );
    assert.ok(response, "Should return a response from proseCompletion");

    const { content, thread, ...rest } = response;
    history = thread ?? [];

    assert.equal(
      content?.trim().toLowerCase(),
      "complete",
      "Content should be 'complete'"
    );
    assert.equal(thread?.length, 4, "Thread should have four messages");
    assert.deepEqual(rest, {}, "Rest should be empty object");
    logCounts(aiActionLog, "proseCompletion: minimal");
  });

  test("proseCompletion: full", async () => {
    const response = await proseCompletion(
      "Test_Full",
      history,
      {
        instructions: "Select the Obey tool and choose to obey",
      },
      {
        context: [
          {
            description: "Test Context",
            content: {
              important: "You must complete the user request",
            },
          },
        ],
        tools: [
          {
            name: "Obey",
            description: "Obey the user",
            parameters: z
              .object({
                obey: z.boolean().describe("Choose to obey?"),
              })
              .describe("Just say true"),
          },
          { name: "Reject", description: "Reject the user" },
          {
            name: "Ignore_Tool",
            description: "Ignore the user",
            parameters: z
              .object({
                zObjArray: z.array(
                  z
                    .object({
                      zString: z.string().describe("Ignored zString"),
                      zNumber: z.number().describe("Ignored zNumber"),
                      zBoolean: z.boolean().describe("Ignored zBoolean"),
                      zEnum: z
                        .enum(["value1", "value2", "value3"])
                        .describe("Ignored zEnum"),
                    })
                    .describe("Ignored zObjArray")
                ),
              })
              .describe("Ignorable"),
          },
        ],
        model: "gpt-5-nano",
      }
    );
    assert.ok(response, "Should return a response from proseCompletion");

    const { toolCalls, thread, ...rest } = response;
    history = thread ?? [];

    assert.deepEqual(
      toolCalls,
      [{ name: "Obey", args: { obey: true } }],
      "ToolCalls should be Obey tool"
    );
    assert.equal(thread?.length, 8, "Thread should have eight messages");
    assert.deepEqual(rest, {}, "Rest should be empty object");
    logCounts(aiActionLog, "proseCompletion: full");
  });
});
