import { mockExternalLog } from "dry-utils-shared";
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import type { ChatCompletionMessageParam } from "openai/resources";
import { proseCompletion, setAILogging, zBoolean, zObj } from "../src/index.ts";

// OPENAI_API_KEY present in .env, referenced directly in OpenAI SDK

const aiActionLog = { log: 1, ag: 1 };

describe("OpenAI E2E Flow", () => {
  // Note: Each test is dependent on the previous one
  const { logOptions, logCounts, logReset } = mockExternalLog();
  let history: ChatCompletionMessageParam[] = [];

  afterEach(() => {
    logReset();
  });

  test("setAILogging", () => {
    setAILogging(logOptions);
    assert.ok(true);
    logCounts({}, "setAILogging");
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

    assert.equal(content, "complete", "Content should be 'complete'");
    assert.equal(thread?.length, 3, "Thread should have three messages");
    assert.deepEqual(rest, {}, "Rest should be empty object");
    logCounts(aiActionLog, "proseCompletion: simple");
  });

  test("proseCompletion: full", async () => {
    const response = await proseCompletion(
      "Test_Full",
      history,
      {
        instructions: "Select the Obey tool with no parameters",
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
            parameters: zObj("Just say true", {
              obey: zBoolean("Choose to obey?"),
            }),
          },
          { name: "Reject", description: "Reject the user" },
        ],
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
    assert.equal(thread?.length, 6, "Thread should have five messages");
    assert.deepEqual(rest, {}, "Rest should be empty object");
    logCounts(aiActionLog, "proseCompletion: full");
  });
});
