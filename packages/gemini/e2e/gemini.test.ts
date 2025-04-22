import type { Content } from "@google/genai";
import { mockExternalLog } from "dry-utils-shared";
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { proseCompletion } from "../src/gemini.ts";
import { setAILogging } from "../src/index.ts";

// GEMINI_API_KEY present in .env, referenced directly in Gemini SDK

const aiActionLog = { log: 1, ag: 1 };

describe("Gemini E2E Flow", () => {
  // Note: Each test is dependent on the previous one
  const { logOptions, logCounts, logReset, debug } = mockExternalLog();
  let history: Content[] = [];

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

    debug();

    const { content, thread, ...rest } = response;
    history = thread ?? [];

    assert.equal(
      content?.trim().toLowerCase(),
      "complete",
      "Content should be 'complete'"
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
        instructions:
          "Repeat the word 'complete' back to me, only that single word",
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
      }
    );
    assert.ok(response, "Should return a response from proseCompletion");

    debug();

    const { content, thread, ...rest } = response;
    history = thread ?? [];

    assert.equal(
      content?.trim().toLowerCase(),
      "complete",
      "Content should be 'complete'"
    );

    assert.equal(thread?.length, 6, "Thread should have six messages");
    assert.deepEqual(rest, {}, "Rest should be empty object");
    logCounts(aiActionLog, "proseCompletion: full");
  });
});
