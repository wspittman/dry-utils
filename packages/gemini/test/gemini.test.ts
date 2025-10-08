import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { beforeEach, describe, mock, test } from "node:test";
import type { CompletionResponse, EmbeddingResponse } from "../src/types.ts";
import {
  ParamTemplates,
  validateAPIParams,
  type CompletionParams,
} from "./completionParams.ts";
import {
  EmbedParamTemplates,
  validateEmbedAPIParams,
  type EmbedParams,
} from "./embedParams.ts";
import {
  EmbedErrorTemplates,
  EmbedRateLimitTemplate,
  EmbedResponseTemplates,
  EmbedThrownTemplates,
  validateEmbedError,
  validateEmbedResponse,
} from "./embedResponse.ts";
import {
  RateLimitTemplate,
  ResponseErrorTemplates,
  ResponseTemplates,
  ResponseThrownTemplates,
  validateAPIError,
  validateAPIResponse,
} from "./generateResponse.ts";

const require = createRequire(import.meta.url);
const timers =
  require("node:timers/promises") as typeof import("node:timers/promises");
const originalSetTimeout = timers.setTimeout;
timers.setTimeout = (async (_delay: number, value: unknown) =>
  value) as typeof timers.setTimeout;

test.after(() => {
  timers.setTimeout = originalSetTimeout;
});

const { embed, jsonCompletion, proseCompletion, subscribeGeminiLogging } =
  await import("../src/index.ts");

const { MockGeminiClient } = await import("./mockGeminiClient.ts");

function proseCall(
  params: CompletionParams
): Promise<CompletionResponse<string>> {
  const { action, thread, input, context, tools, model, reasoningEffort } =
    params;

  return proseCompletion(action, thread, input, {
    context,
    tools,
    model,
    reasoningEffort,
  });
}

function jsonCall(
  params: CompletionParams
): Promise<CompletionResponse<unknown>> {
  const {
    action,
    thread,
    input,
    schema,
    context,
    tools,
    model,
    reasoningEffort,
  } = params;

  return jsonCompletion(action, thread, input, schema, {
    context,
    tools,
    model,
    reasoningEffort,
  });
}

function embedCall(params: EmbedParams): Promise<EmbeddingResponse> {
  const { action, input, model, dimensions } = params;

  return embed(action, input, { model, dimensions });
}

describe("AI: Gemini", () => {
  const geminiMock = new MockGeminiClient();
  const logFn = mock.fn();
  const errFn = mock.fn();
  const aggFn = mock.fn();
  subscribeGeminiLogging({ log: logFn, error: errFn, aggregate: aggFn });

  const errLog = { error: 1, generate: 1 };
  const defaultLog = { agg: 1, generate: 1 };
  const errEmbedLog = { error: 1, embed: 1 };
  const defaultEmbedLog = { agg: 1, embed: 1 };

  function clearCounts() {
    logFn.mock.resetCalls();
    errFn.mock.resetCalls();
    aggFn.mock.resetCalls();
    geminiMock.resetCalls();
  }

  beforeEach(clearCounts);

  function callCounts({
    log = 0,
    error = 0,
    agg = 0,
    generate = 0,
    embed = 0,
  }) {
    assert.equal(logFn.mock.callCount(), log, "logFn count");
    assert.equal(errFn.mock.callCount(), error, "errFn count");
    assert.equal(aggFn.mock.callCount(), agg, "aggFn count");
    assert.equal(geminiMock.getCallCount(), generate, "generate count");
    assert.equal(geminiMock.getEmbedCallCount(), embed, "embed count");
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

  Object.entries(EmbedParamTemplates).forEach(([name, params]) => {
    test(`Embed Params: ${name}`, async () => {
      geminiMock.mockEmbedResponseOnce(EmbedResponseTemplates["default"]!);
      await embedCall(params);

      callCounts(defaultEmbedLog);
      validateEmbedAPIParams(geminiMock.getLastEmbedCall(), params);
    });
  });

  Object.entries(EmbedResponseTemplates).forEach(([name, response]) => {
    test(`Embed Response: ${name}`, async () => {
      geminiMock.mockEmbedResponseOnce(response);
      const result = await embedCall(EmbedParamTemplates["default"]!);

      callCounts(defaultEmbedLog);
      validateEmbedResponse(result, response);
    });
  });

  Object.entries(EmbedErrorTemplates).forEach(
    ([name, [response, expected]]) => {
      test(`Embed Response Error: ${name}`, async () => {
        geminiMock.mockEmbedResponseOnce(response);
        const result = await embedCall(EmbedParamTemplates["default"]!);
        callCounts(defaultEmbedLog);
        validateEmbedError(result, expected);
      });
    }
  );

  Object.entries(EmbedThrownTemplates).forEach(([name, [error, expected]]) => {
    test(`Embed Response Thrown: ${name}`, async () => {
      geminiMock.mockEmbedErrorOnce(error);
      const result = await embedCall(EmbedParamTemplates["default"]!);
      callCounts(errEmbedLog);
      validateEmbedError(result, expected);
    });
  });

  test("Embed Rate Limit", async () => {
    const [error, expected] = EmbedRateLimitTemplate;
    geminiMock.mockEmbedMany([error, error, error, error]);
    const result = await embedCall(EmbedParamTemplates["default"]!);
    callCounts({ log: 3, error: 1, embed: 4 });
    validateEmbedError(result, expected);
  });

  test("Embed Rate Limit Transient", async () => {
    const [error, _, response] = EmbedRateLimitTemplate;
    geminiMock.mockEmbedMany([error, error, error, response]);
    const result = await embedCall(EmbedParamTemplates["default"]!);
    callCounts({ log: 3, agg: 1, embed: 4 });
    validateEmbedResponse(result, response);
  });
});
