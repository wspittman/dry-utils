import { mockExternalLog } from "dry-utils-shared";
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import type { ChatCompletionMessageParam } from "openai/resources";
import { type ParsedChatCompletionMessage } from "openai/resources/beta/chat/completions";
import { z } from "zod";
import { setAILogging } from "../src/index.ts";
import {
  type CompletionOptions,
  type CompletionResponse,
  jsonCompletion,
  proseCompletion,
  type Tool,
} from "../src/openai.ts";
import { MockOpenAISDK, type Mode } from "./mockOpenAISDK.ts";

process.env["OPENAI_API_KEY"] = "mock_openai_key";

type Message =
  | ChatCompletionMessageParam
  | ParsedChatCompletionMessage<unknown>;

const prompt = "system prompt";
const userInput = "user input";
const parsedOutput = {
  key1: "value1",
  key2: "value2",
};
const encodedOutput = JSON.stringify(parsedOutput);
const parsedProseOutput = { content: "prose" };
const encodedProseOutput = JSON.stringify(parsedProseOutput);
const schema = z.object({
  key1: z.string(),
  key2: z.string(),
});

const msgMap: Record<
  "prompt" | "userInput" | "assistantOutput" | "proseOutput" | "toolUse",
  Message
> = {
  prompt: { role: "developer", content: prompt },
  userInput: { role: "user", name: "Agent", content: userInput },
  assistantOutput: {
    role: "assistant",
    parsed: parsedOutput,
    content: encodedOutput,
  },
  proseOutput: {
    role: "assistant",
    parsed: parsedProseOutput,
    content: encodedProseOutput,
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
  schema,
  context: [],
  tools: [],
  mode: "stop",
  parsedOutput,
};

const defaultResponse: CompletionResponse<unknown> = {
  thread: [msgMap.prompt, msgMap.userInput, msgMap.assistantOutput],
  content: parsedOutput,
};

const toolResponse: CompletionResponse<unknown> = {
  thread: [msgMap.prompt, msgMap.userInput, msgMap.toolUse],
  toolCalls: [],
};

const fullParams: Required<CompletionParams> = {
  thread: [msgMap.prompt, msgMap.userInput],
  input: { content: userInput },
  schema,
  context: [
    { description: "one", content: { val: 1 } },
    { description: "two", content: { val: 2 } },
  ],
  tools: [
    { name: "tool1", description: "tool1 description", parameters: schema },
    { name: "tool2", description: "tool2 description" },
  ],
  mode: "stop",
  parsedOutput,
};

describe("AI: OpenAI", () => {
  const openAISDK = new MockOpenAISDK();
  const { logOptions, logCounts, logReset } = mockExternalLog();
  setAILogging(logOptions);

  type LogParams = Parameters<typeof logCounts>[0];
  const errLog: LogParams = { error: 1 };
  const defaultLog: LogParams = { log: 1, ag: 1 };

  function clearCounts() {
    logReset();
    openAISDK.resetCalls();
  }

  beforeEach(clearCounts);

  function callCounts(params: LogParams) {
    const { log = 0, ag = 0 } = params;
    // This just works out for openai.ts
    const parse = log - ag + 1;
    logCounts(params);
    assert.equal(openAISDK.getCallCount(), parse, "parse count");
  }

  function validateResponse(
    response: CompletionResponse<unknown>,
    expected: CompletionResponse<unknown>
  ) {
    assert.deepEqual(response.thread, expected.thread);
    assert.deepEqual(response.content, expected.content);
    assert.equal(response.error, expected.error);
    assert.deepEqual(response.toolCalls, expected.toolCalls);
  }

  function msgString(value: unknown) {
    const str = JSON.stringify(value);
    return str.length > 50 ? str.slice(0, 47) + "..." : str;
  }

  async function runCompletion(
    params: CompletionParams = {},
    useProse = false
  ) {
    const msg = msgString(params);
    let { thread, input, schema, context, tools, mode, parsedOutput } = {
      ...defaultParams,
      ...params,
    };

    openAISDK.setBehavior(mode, JSON.stringify(parsedOutput));

    const options = { context, tools };
    const result = useProse
      ? await proseCompletion("test", thread, input, options)
      : await jsonCompletion("test", thread, input, schema, options);

    openAISDK.validateParams(thread, input, options, msg);

    return result;
  }

  test("jsonCompletion: bad action format", async () => {
    const action = "bad action format";
    const { thread, input, schema } = fullParams;
    const result = await jsonCompletion(action, thread, input, schema);
    assert.equal(
      result.error,
      `Invalid action name "${action}". Must match pattern ^[a-zA-Z0-9_-]+$`
    );
    logCounts({ error: 1 });
  });

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
      await runCompletion(params);
      callCounts(defaultLog);
    });
  });

  test("jsonCompletion params: rolling threads", async () => {
    let result = await runCompletion();
    clearCounts();

    result = await runCompletion({ thread: result.thread });
    clearCounts();

    result = await runCompletion({ thread: result.thread });
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
    ["refusal", defaultLog, `Refusal: ${encodedOutput}`],
    ["unknown", defaultLog, "Unexpected Finish Reason: unknown"],
    [{}, defaultLog, defaultResponse],
    ["errRateTemp", { ag: 1, log: 2 }, defaultResponse],
    [
      { mode: "tool_calls", tools: fullParams.tools, parsedOutput: [] },
      defaultLog,
      toolResponse,
    ],
  ];

  cases.forEach(([params, logParams, expected]) => {
    test(`jsonCompletion response: ${msgString(params)}`, async () => {
      expected = typeof expected === "string" ? { error: expected } : expected;
      params = typeof params === "string" ? { mode: params } : params;

      const resp = await runCompletion(params);

      callCounts(logParams);
      validateResponse(resp, expected);
    });
  });

  const proseCases: typeof cases = [
    ["error", errLog, "OpenAI Non-Backoff Error"],
    [
      { parsedOutput: parsedProseOutput },
      defaultLog,
      {
        thread: [msgMap.prompt, msgMap.userInput, msgMap.proseOutput],
        content: parsedProseOutput.content,
      },
    ],
    [
      { mode: "tool_calls", tools: fullParams.tools, parsedOutput: [] },
      defaultLog,
      toolResponse,
    ],
  ];

  proseCases.forEach(([params, logParams, expected]) => {
    test(`proseCompletion response: ${msgString(params)}`, async () => {
      expected = typeof expected === "string" ? { error: expected } : expected;
      params = typeof params === "string" ? { mode: params } : params;

      const resp = await runCompletion(params, true);

      callCounts(logParams);
      validateResponse(resp, expected);
    });
  });
});
