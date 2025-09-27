import assert from "node:assert/strict";
import { beforeEach, describe, mock, test } from "node:test";
import type { CompletionResponse } from "../src/gemini.ts";
import {
  jsonCompletion,
  proseCompletion,
  subscribeGeminiLogging,
} from "../src/index.ts";
import {
  ParamTemplates,
  validateAPIParams,
  type CompletionParams,
} from "./completionParams.ts";
import {
  RateLimitTemplate,
  ResponseErrorTemplates,
  ResponseTemplates,
  ResponseThrownTemplates,
  validateAPIError,
  validateAPIResponse,
} from "./generateResponse.ts";
import { MockGeminiClient } from "./mockGeminiClient.ts";

function proseCall(
  params: CompletionParams
): Promise<CompletionResponse<string>> {
  const { action, thread, input, context, tools, model } = params;

  return proseCompletion(action, thread, input, { context, tools, model });
}

function jsonCall(
  params: CompletionParams
): Promise<CompletionResponse<unknown>> {
  const { action, thread, input, schema, context, tools, model } = params;

  return jsonCompletion(action, thread, input, schema, {
    context,
    tools,
    model,
  });
}

describe("AI: Gemini", () => {
  const geminiMock = new MockGeminiClient();
  const logFn = mock.fn();
  const errFn = mock.fn();
  const aggFn = mock.fn();
  subscribeGeminiLogging({ log: logFn, error: errFn, aggregate: aggFn });

  const errLog = { error: 1, generate: 1 };
  const defaultLog = { agg: 1, generate: 1 };

  function clearCounts() {
    logFn.mock.resetCalls();
    errFn.mock.resetCalls();
    aggFn.mock.resetCalls();
    geminiMock.resetCalls();
  }

  beforeEach(clearCounts);

  function callCounts({ log = 0, error = 0, agg = 0, generate = 0 }) {
    assert.equal(logFn.mock.callCount(), log, "logFn count");
    assert.equal(errFn.mock.callCount(), error, "errFn count");
    assert.equal(aggFn.mock.callCount(), agg, "aggFn count");
    assert.equal(geminiMock.getCallCount(), generate, "generate count");
  }

  Object.entries(ParamTemplates).forEach(([name, params]) => {
    test(`Params: ${name}`, async () => {
      await jsonCall(params);

      callCounts(defaultLog);
      validateAPIParams(geminiMock.getLastCall(), params);
    });
  });

  Object.entries(ResponseThrownTemplates).forEach(
    ([name, [error, expected]]) => {
      test(`Response Thrown: ${name}`, async () => {
        geminiMock.mockErrorOnce(error);
        const result = await jsonCall(ParamTemplates["default"]!);

        callCounts(errLog);
        validateAPIError(result, expected);
      });
    }
  );

  Object.entries(ResponseErrorTemplates).forEach(
    ([name, [response, expected]]) => {
      test(`Response Error: ${name}`, async () => {
        geminiMock.mockResponseOnce(response);
        const result = await jsonCall(ParamTemplates["default"]!);

        callCounts(defaultLog);
        validateAPIError(result, expected);
      });
    }
  );

  Object.entries(ResponseTemplates).forEach(([name, response]) => {
    test(`Response: ${name}`, async () => {
      geminiMock.mockResponseOnce(response);
      const result = await jsonCall(ParamTemplates["default"]!);

      callCounts(defaultLog);
      validateAPIResponse(result, response);
    });
  });

  test("Prose Completion", async () => {
    geminiMock.mockResponseOnce(ResponseTemplates["default"]!);
    const result = await proseCall(ParamTemplates["default"]!);

    callCounts(defaultLog);
    validateAPIResponse(result, ResponseTemplates["default"]!, "complete");
  });

  test("jsonCompletion preserves thread entries for empty thread", async () => {
    geminiMock.mockResponseOnce(ResponseTemplates["default"]!);
    const result = await jsonCall(ParamTemplates["threadArrayEmpty"]!);

    callCounts(defaultLog);
    assert.ok(result.thread, "thread should be defined");
    assert.ok(
      result.thread!.every(
        (message) => message && typeof message.role === "string"
      ),
      "thread entries should all be Content objects"
    );
  });

  test("Response Rate Limit", async () => {
    const [error, expected] = RateLimitTemplate;
    geminiMock.mockMany([error, error, error, error]);
    const result = await jsonCall(ParamTemplates["default"]!);
    callCounts({ log: 3, error: 1, generate: 4 });
    validateAPIError(result, expected);
  });

  test("Response Rate Limit Transient", async () => {
    const [error, _, response] = RateLimitTemplate;
    geminiMock.mockMany([error, error, error, response]);
    const result = await jsonCall(ParamTemplates["default"]!);
    callCounts({ log: 3, agg: 1, generate: 4 });
    validateAPIResponse(result, response);
  });
});
