import assert from "assert/strict";
import { createRequire } from "node:module";
import { beforeEach, describe, mock, test } from "node:test";
import type { CompletionResponse, EmbeddingResponse } from "../src/types.ts";
import {
  ParamErrorTemplates,
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
import { MockOpenAIClient } from "./mockOpenAIClient.ts";
import {
  RateLimitTemplate,
  ResponseErrorTemplates,
  ResponseTemplates,
  ResponseThrownTemplates,
  validateAPIError,
  validateAPIResponse,
} from "./parsedResponse.ts";

const require = createRequire(import.meta.url);
const timers =
  require("node:timers/promises") as typeof import("node:timers/promises");
const originalSetTimeout = timers.setTimeout;
timers.setTimeout = (async (_delay: number, value: unknown) =>
  value) as typeof timers.setTimeout;

test.after(() => {
  timers.setTimeout = originalSetTimeout;
});

process.env["OPENAI_API_KEY"] = "mock_openai_key";

const { embed, jsonCompletion, proseCompletion, subscribeOpenAILogging } =
  await import("../src/index.ts");

const DEBUG = false;
const debugFn = (x: unknown) => console.dir(x, { depth: null });

function proseCall(
  params: CompletionParams,
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
  params: CompletionParams,
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

describe("AI: OpenAI", () => {
  const openAIMock = new MockOpenAIClient();
  const logFn = mock.fn(DEBUG ? debugFn : undefined);
  const errFn = mock.fn(DEBUG ? debugFn : undefined);
  const aggFn = mock.fn(DEBUG ? debugFn : undefined);
  subscribeOpenAILogging({ log: logFn, error: errFn, aggregate: aggFn });

  const errLog = { error: 1, parse: 1 };
  const defaultLog = { agg: 1, parse: 1 };
  const errEmbedLog = { error: 1, embed: 1 };
  const defaultEmbedLog = { agg: 1, embed: 1 };

  function clearCounts() {
    logFn.mock.resetCalls();
    errFn.mock.resetCalls();
    aggFn.mock.resetCalls();
    openAIMock.resetCalls();
  }

  beforeEach(clearCounts);

  function callCounts({ log = 0, error = 0, agg = 0, parse = 0, embed = 0 }) {
    assert.equal(logFn.mock.callCount(), log, "logFn count");
    assert.equal(errFn.mock.callCount(), error, "errFn count");
    assert.equal(aggFn.mock.callCount(), agg, "aggFn count");
    assert.equal(openAIMock.getCallCount(), parse, "parse count");
    assert.equal(openAIMock.getEmbedCallCount(), embed, "embed count");
  }

  function getLastAggregate() {
    return aggFn.mock.calls.at(-1)?.arguments[0] as {
      blob: Record<string, unknown>;
      dense: Record<string, unknown>;
    };
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
    },
  );

  Object.entries(ResponseErrorTemplates).forEach(
    ([name, [response, expected]]) => {
      test(`Response Error: ${name}`, async () => {
        openAIMock.mockResponseOnce(response);
        const result = await jsonCall(ParamTemplates["default"]!);

        callCounts(defaultLog);
        validateAPIError(result, expected);
      });
    },
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

  test("Aggregate logs include completion model and context", async () => {
    await jsonCall(ParamTemplates["contextTwo"]!);

    callCounts(defaultLog);
    const aggregate = getLastAggregate();
    assert.equal(aggregate.blob["model"], "gpt-5-nano");
    assert.deepEqual(aggregate.blob["context"], [
      { description: "desc1", content: { a: 1 } },
      { description: "desc2", content: { b: 2 } },
    ]);
    assert.equal(aggregate.dense["model"], "gpt-5-nano");
    assert.equal(aggregate.dense["contextCount"], 2);
  });

  test("Aggregate logs include embedding model", async () => {
    openAIMock.mockEmbedResponseOnce(EmbedResponseTemplates["default"]!);
    await embedCall(EmbedParamTemplates["customModel"]!);

    callCounts(defaultEmbedLog);
    const aggregate = getLastAggregate();
    assert.equal(aggregate.blob["model"], "text-embedding-3-small-custom");
    assert.equal(aggregate.dense["model"], "text-embedding-3-small-custom");
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

  Object.entries(EmbedParamTemplates).forEach(([name, params]) => {
    test(`Embed Params: ${name}`, async () => {
      openAIMock.mockEmbedResponseOnce(EmbedResponseTemplates["default"]!);
      await embedCall(params);

      callCounts(defaultEmbedLog);
      validateEmbedAPIParams(openAIMock.getLastEmbedCall(), params);
    });
  });

  Object.entries(EmbedResponseTemplates).forEach(([name, response]) => {
    test(`Embed Response: ${name}`, async () => {
      openAIMock.mockEmbedResponseOnce(response);
      const result = await embedCall(EmbedParamTemplates["default"]!);

      callCounts(defaultEmbedLog);
      validateEmbedResponse(result, response);
    });
  });

  Object.entries(EmbedErrorTemplates).forEach(
    ([name, [response, expected]]) => {
      test(`Embed Response Error: ${name}`, async () => {
        openAIMock.mockEmbedResponseOnce(response);
        const result = await embedCall(EmbedParamTemplates["default"]!);
        callCounts(defaultEmbedLog);
        validateEmbedError(result, expected);
      });
    },
  );

  Object.entries(EmbedThrownTemplates).forEach(([name, [error, expected]]) => {
    test(`Embed Response Thrown: ${name}`, async () => {
      openAIMock.mockEmbedErrorOnce(error);
      const result = await embedCall(EmbedParamTemplates["default"]!);
      callCounts(errEmbedLog);
      validateEmbedError(result, expected);
    });
  });

  test("Embed Rate Limit", async () => {
    const [error, expected] = EmbedRateLimitTemplate;
    openAIMock.mockEmbedMany([error, error, error, error]);
    const result = await embedCall(EmbedParamTemplates["default"]!);
    callCounts({ log: 3, error: 1, embed: 4 });
    validateEmbedError(result, expected);
  });

  test("Embed Rate Limit Transient", async () => {
    const [error, _, response] = EmbedRateLimitTemplate;
    openAIMock.mockEmbedMany([error, error, error, response]);
    const result = await embedCall(EmbedParamTemplates["default"]!);
    callCounts({ log: 3, agg: 1, embed: 4 });
    validateEmbedResponse(result, response);
  });
});
