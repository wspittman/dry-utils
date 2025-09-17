import assert from "assert/strict";
import { beforeEach, describe, mock, test } from "node:test";
import {
  jsonCompletion,
  proseCompletion,
  subscribeOpenAILogging,
} from "../src/index.ts";
import type { CompletionResponse } from "../src/openai.ts";
import {
  ParamErrorTemplates,
  ParamTemplates,
  validateAPIParams,
  type CompletionParams,
} from "./completionParams.ts";
import { MockOpenAIClient } from "./mockOpenAIClient.ts";
import {
  RateLimitTemplate,
  ResponseErrorTemplates,
  ResponseTemplates,
  ResponseThrownTemplates,
  validateAPIError,
  validateAPIResponse,
} from "./parsedResponse.ts";

process.env["OPENAI_API_KEY"] = "mock_openai_key";

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

describe("AI: OpenAI", () => {
  const openAIMock = new MockOpenAIClient();
  const logFn = mock.fn();
  const errFn = mock.fn();
  const aggFn = mock.fn();
  subscribeOpenAILogging({ log: logFn, error: errFn, aggregate: aggFn });

  const errLog = { error: 1, parse: 1 };
  const defaultLog = { agg: 1, parse: 1 };

  function clearCounts() {
    logFn.mock.resetCalls();
    errFn.mock.resetCalls();
    aggFn.mock.resetCalls();
    openAIMock.resetCalls();
  }

  beforeEach(clearCounts);

  function callCounts({ log = 0, error = 0, agg = 0, parse = 0 }) {
    assert.equal(logFn.mock.callCount(), log, "logFn count");
    assert.equal(errFn.mock.callCount(), error, "errFn count");
    assert.equal(aggFn.mock.callCount(), agg, "aggFn count");
    assert.equal(openAIMock.getCallCount(), parse, "parse count");
  }

  Object.entries(ParamErrorTemplates).forEach(([name, params]) => {
    test(`Params Error: ${name}`, async () => {
      const result = await jsonCall(params);

      callCounts({ error: 1 });
      assert.ok(result.error);
    });
  });

  Object.entries(ParamTemplates).forEach(([name, params]) => {
    test(`Params: ${name}`, async () => {
      await jsonCall(params);

      callCounts(defaultLog);
      validateAPIParams(openAIMock.getLastCall(), params);
    });
  });

  Object.entries(ResponseThrownTemplates).forEach(
    ([name, [error, expected]]) => {
      test(`Response Thrown: ${name}`, async () => {
        openAIMock.mockErrorOnce(error);
        const result = await jsonCall(ParamTemplates["default"]!);

        callCounts(errLog);
        validateAPIError(result, expected);
      });
    }
  );

  Object.entries(ResponseErrorTemplates).forEach(
    ([name, [response, expected]]) => {
      test(`Response Error: ${name}`, async () => {
        openAIMock.mockResponseOnce(response);
        const result = await jsonCall(ParamTemplates["default"]!);

        callCounts(defaultLog);
        validateAPIError(result, expected);
      });
    }
  );

  Object.entries(ResponseTemplates).forEach(([name, response]) => {
    test(`Response: ${name}`, async () => {
      openAIMock.mockResponseOnce(response);
      const result = await jsonCall(ParamTemplates["default"]!);

      callCounts(defaultLog);
      validateAPIResponse(result, response);
    });
  });

  test("Prose Completion", async () => {
    openAIMock.mockResponseOnce(ResponseTemplates["default"]!);
    const result = await proseCall(ParamTemplates["default"]!);

    callCounts(defaultLog);
    validateAPIResponse(result, ResponseTemplates["default"]!, "complete");
  });

  test("Response Rate Limit", async () => {
    const [error, expected] = RateLimitTemplate;
    openAIMock.mockMany([error, error, error, error]);
    const result = await jsonCall(ParamTemplates["default"]!);
    callCounts({ log: 3, error: 1, parse: 4 });
    validateAPIError(result, expected);
  });

  test("Response Rate Limit Transient", async () => {
    const [error, _, response] = RateLimitTemplate;
    openAIMock.mockMany([error, error, error, response]);
    const result = await jsonCall(ParamTemplates["default"]!);
    callCounts({ log: 3, agg: 1, parse: 4 });
    validateAPIResponse(result, response);
  });
});
