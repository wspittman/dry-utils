import type { Content } from "@google/genai";
import assert from "node:assert/strict";
import { afterEach, describe, mock, test } from "node:test";
import {
  embed,
  proseCompletion,
  subscribeGeminiLogging,
  z,
} from "../src/index.ts";

// GEMINI_API_KEY present in .env

const DEBUG = false;
const debugFn = (x: unknown) => console.dir(x, { depth: null });

const aiActionLog = { agg: 1 };

describe("Gemini E2E Flow", () => {
  // Note: Each test is dependent on the previous one
  let history: Content[] = [];

  const logFn = mock.fn(DEBUG ? debugFn : undefined);
  const errorFn = mock.fn(DEBUG ? debugFn : undefined);
  const aggFn = mock.fn(DEBUG ? debugFn : undefined);
  subscribeGeminiLogging({ log: logFn, error: errorFn, aggregate: aggFn });

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

  test("embedding: minimal", async () => {
    const { error, embeddings } = await embed("Min_Embed", "Embedding test");
    assert.ok(!error, "Should not return an error from embed");
    assert.ok(embeddings, "Should return embeddings from embed");
    assert.equal(embeddings?.length, 1, "Should return one embedding");
  });

  test("embedding: full", async () => {
    const { error, embeddings } = await embed(
      "Full_Embed",
      ["Embedding test", "This is a test of Gemini embeddings"],
      {
        model: "gemini-embedding-001",
        dimensions: 768,
      },
    );
    assert.ok(!error, "Should not return an error from embed");
    assert.ok(embeddings, "Should return embeddings from embed");
    assert.equal(embeddings?.length, 2, "Should return two embeddings");
    assert.equal(embeddings?.[0]?.length, 768, "Should return 768 dimensions");
  });

  test("embedding: error", async () => {
    const { error, embeddings } = await embed("Err_Embed", "Embedding test", {
      model: "nonexistent-model",
      dimensions: 123,
    });
    assert.ok(error, "Should return an error from embed");
    assert.ok(!embeddings, "Should not return embeddings from embed");
  });

  test("proseCompletion: minimal", async () => {
    const response = await proseCompletion(
      "Test_Simple",
      "Follow the user's instructions explicitly",
      "Repeat the word 'complete' back to me, only that single word",
    );
    assert.ok(response, "Should return a response from proseCompletion");

    const { content, thread, ...rest } = response;
    history = thread ?? [];

    assert.equal(
      content?.trim().toLowerCase(),
      "complete",
      "Content should be 'complete'",
    );
    assert.equal(thread?.length, 3, "Thread should have three messages");
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
                    .describe("Ignored zObjArray"),
                ),
              })
              .describe("Ignorable"),
          },
        ],
        model: "gemini-2.0-flash-lite",
      },
    );
    assert.ok(response, "Should return a response from proseCompletion");

    const { toolCalls, thread, ...rest } = response;
    history = thread ?? [];

    assert.deepEqual(
      toolCalls,
      [{ name: "Obey", args: { obey: true } }],
      "ToolCalls should be Obey tool",
    );

    assert.equal(thread?.length, 6, "Thread should have six messages");
    assert.deepEqual(rest, {}, "Rest should be empty object");
    logCounts(aiActionLog, "proseCompletion: full");
  });
});
