import assert from "node:assert/strict";
import { beforeEach, describe, mock, test } from "node:test";
import { APIError } from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources";
import {
  ChatCompletionParseParams,
  Completions,
  ParsedChatCompletionMessage,
} from "openai/resources/beta/chat/completions";
import { z } from "zod";
import { setAILogging } from "../../src/ai/index";
import {
  CompletionOptions,
  CompletionResponse,
  jsonCompletion,
} from "../../src/ai/openai";
import { mockExternalLog } from "../testUtils";

process.env.OPENAI_API_KEY = "mock_openai_key";

type Message =
  | ChatCompletionMessageParam
  | ParsedChatCompletionMessage<unknown>;
type Tool = ChatCompletionTool;
type ParseParams = ChatCompletionParseParams;

type MockError = "errRate" | "errLarge" | "errLong" | "error";
type MockReason = "stop" | "tool_calls" | "unknown";
type Mode = MockError | MockReason | "errRateTemp" | "refusal";

const prompt = "system prompt";
const userInput = "user input";
const parsedString = "string content";
const encodedString = JSON.stringify(parsedString);

const msgMap: Record<string, Message> = {
  prompt: { role: "developer", content: prompt },
  userInput: { role: "user", name: "Agent", content: userInput },
  stringContent: {
    role: "assistant",
    parsed: parsedString,
    content: encodedString,
  },
  toolUse: {
    content: "[]",
    role: "assistant",
    tool_calls: [],
  },
};

interface CompletionParams {
  thread?: Message[] | string;
  input?: string | object;
  schema?: z.ZodType;
  context?: CompletionOptions["context"];
  tools?: Tool[];
  mode?: Mode;
  parsedOutput?: unknown;
}

const defaultParams: Required<CompletionParams> = {
  thread: prompt,
  input: userInput,
  schema: z.string(),
  context: [],
  tools: [],
  mode: "stop",
  parsedOutput: parsedString,
};

const defaultResponse: CompletionResponse<unknown> = {
  thread: [msgMap.prompt, msgMap.userInput, msgMap.stringContent],
  content: parsedString,
};

const fullParams: Required<CompletionParams> = {
  thread: [msgMap.prompt, msgMap.userInput],
  input: { content: parsedString },
  schema: z.string(),
  context: [
    { description: "one", content: { val: 1 } },
    { description: "two", content: { val: 2 } },
  ],
  tools: [
    { type: "function", function: { name: "tool1" } },
    { type: "function", function: { name: "tool2" } },
  ],
  mode: "stop",
  parsedOutput: parsedString,
};

// #region Mock

const createErr = (status: number, code: string, message: string) =>
  new APIError(status, { status, message, code }, message, {});

const errMap: Record<MockError, APIError> = {
  errRate: createErr(429, "rate_limit_exceeded", "Rate limit exceeded"),
  errLarge: createErr(429, "rate_limit_exceeded", "Request too large..."),
  errLong: createErr(400, "context_length_exceeded", "This model's maximum..."),
  error: createErr(500, "mock_other_error", "This is a mock error..."),
};

function checkError(action: Mode) {
  if (action === "errRateTemp" && mockParse.mock.callCount() < 1) {
    action = "errRate";
  }

  if (errMap[action]) {
    throw errMap[action];
  }
}

function getChoice(action: Mode, content: string) {
  let reason: string = action;
  let message: Record<string, unknown> = {};

  if (action === "stop" || action === "errRateTemp") {
    reason = "stop";
    message = { content, parsed: JSON.parse(content) };
  }

  if (action === "refusal") {
    reason = "stop";
    message = { refusal: content };
  }

  if (action === "tool_calls") {
    message = { tool_calls: JSON.parse(content) };
  }

  return { reason, message };
}

const mockParse = mock.method(
  Completions.prototype,
  "parse",
  function ({ response_format }) {
    // We stuffed what we wanted in the action parameter, which becomes name here
    const stuffed = response_format.json_schema.name as string;
    const [action, content] = stuffed.split("~") as [Mode, string];

    checkError(action);
    const { reason, message } = getChoice(action, content);

    return {
      choices: [
        {
          finish_reason: reason,
          index: 0,
          message: {
            role: "assistant",
            content: content,
            ...message,
          },
        },
      ],
      usage: {
        total_tokens: 75,
        prompt_tokens: 50,
        completion_tokens: 25,
        prompt_tokens_details: {
          cached_tokens: 0,
        },
      },
    };
  }
);

// #endregion

describe("AI: OpenAI", () => {
  const { logOptions, logCounts, logReset, debug } = mockExternalLog();
  setAILogging(logOptions);

  type LogParams = Parameters<typeof logCounts>[0];
  const errLog: LogParams = { error: 1 };
  const defaultLog: LogParams = { log: 1, ag: 1 };

  function clearCounts() {
    logReset();
    mockParse.mock.resetCalls();
  }

  beforeEach(clearCounts);

  function callCounts(params: LogParams) {
    const { log = 0, ag = 0 } = params;
    // This just works out for openai.ts
    const parse = log - ag + 1;
    logCounts(params);
    assert.equal(mockParse.mock.callCount(), parse, "parse count");
  }

  function validateParams(
    expectedContents: string[],
    expectedTools?: Tool[],
    msg?: string
  ) {
    const { model, messages, tools } = mockParse.mock.calls[0]
      .arguments[0] as ParseParams;
    const contents = messages.map((x) => x.content);

    assert.equal(model, "gpt-4o-mini", `input model match ${msg}`);
    assert.deepEqual(contents, expectedContents, `input contents match ${msg}`);
    assert.deepEqual(tools, expectedTools, `input tools match ${msg}`);
  }

  function validateResponse(
    response: CompletionResponse<unknown>,
    expected: CompletionResponse<unknown>
  ) {
    assert.deepEqual(response.thread, expected.thread);
    assert.equal(response.content, expected.content);
    assert.equal(response.error, expected.error);
    assert.deepEqual(response.toolCalls, expected.toolCalls);
  }

  function msgString(value: unknown) {
    const str = JSON.stringify(value);
    return str.length > 50 ? str.slice(0, 47) + "..." : str;
  }

  async function runJsonCompletion(params: CompletionParams = {}) {
    const msg = msgString(params);
    let { thread, input, schema, context, tools, mode, parsedOutput } = {
      ...defaultParams,
      ...params,
    };

    const action = [mode, JSON.stringify(parsedOutput)].join("~");
    const options = { context, tools };
    const contents =
      typeof thread === "string"
        ? [thread]
        : thread?.map(({ content }) => content as string);
    const inputIn = typeof input === "string" ? input : JSON.stringify(input);
    const contextIn = (context ?? []).map(
      ({ description, content }) =>
        `Useful context: ${description}\n${JSON.stringify(content)}`
    );

    const result = await jsonCompletion(action, thread, input, schema, options);

    validateParams([...contents, ...contextIn, inputIn], tools, msg);

    return result;
  }

  const paramCases: [string, CompletionParams][] = [
    ["defaults", {}],
    ["thread empty", { thread: [] }],
    ["thread single", { thread: fullParams.thread.slice(0, 1) }],
    ["thread full", { thread: fullParams.thread }],
    ["input object", { input: fullParams.input }],
    ["context undefined", { context: undefined }],
    ["context single", { context: fullParams.context.slice(0, 1) }],
    ["context full", { context: fullParams.context }],
    ["tools undefined", { tools: undefined }],
    ["tools single", { tools: fullParams.tools.slice(0, 1) }],
    ["tools full", { tools: fullParams.tools }],
  ];

  paramCases.forEach(([name, params]) => {
    test(`jsonCompletion params: ${name}`, async () => {
      await runJsonCompletion(params);
      callCounts(defaultLog);
    });
  });

  test("jsonCompletion params: rolling threads", async () => {
    let result = await runJsonCompletion();
    clearCounts();

    result = await runJsonCompletion({ thread: result.thread });
    clearCounts();

    result = await runJsonCompletion({ thread: result.thread });
  });

  const cases: [
    CompletionParams | Mode,
    LogParams,
    CompletionResponse<unknown> | string
  ][] = [
    ["errRate", { error: 1, log: 3 }, "OpenAI Back Off Limit Exceeded"],
    ["errLarge", errLog, "OpenAI Context Too Long"],
    ["errLong", errLog, "OpenAI Context Too Long"],
    ["error", errLog, "OpenAI Non-Backoff Error"],
    ["refusal", defaultLog, `Refusal: ${encodedString}`],
    ["unknown", defaultLog, "Unexpected Finish Reason: unknown"],
    [{}, defaultLog, defaultResponse],
    ["errRateTemp", { ag: 1, log: 2 }, defaultResponse],
    [
      { mode: "tool_calls", tools: fullParams.tools, parsedOutput: [] },
      defaultLog,
      {
        thread: [msgMap.prompt, msgMap.userInput, msgMap.toolUse],
        toolCalls: [],
      },
    ],
  ];

  cases.forEach(([params, logParams, expected]) => {
    test(`jsonCompletion response: ${msgString(params)}`, async () => {
      expected = typeof expected === "string" ? { error: expected } : expected;
      params = typeof params === "string" ? { mode: params } : params;

      const resp = await runJsonCompletion(params);

      callCounts(logParams);
      validateResponse(resp, expected);
    });
  });
});
