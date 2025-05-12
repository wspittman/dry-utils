import { type Content } from "@google/genai";
import { mockExternalLog } from "dry-utils-shared";
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { z } from "zod";
import {
  jsonCompletion,
  proseCompletion,
  type CompletionOptions,
  type CompletionResponse,
  type Tool,
} from "../src/gemini.ts";
import { setAILogging } from "../src/index.ts";
import { MockGeminiSDK, type Mode } from "./mockGeminiSDK.ts";

const prompt = "system prompt";
const userInput = "user input";
const output = {
  key1: "value1",
  key2: "value2",
};
const toolOutput = {
  name: "tool1",
  args: { key1: "value1" },
};
const proseOutput = { content: "prose" };
const schema = z.object({
  key1: z.string(),
  key2: z.string(),
});

const msgMap: Record<
  "prompt" | "userInput" | "assistantOutput" | "proseOutput" | "toolUse",
  Content
> = {
  prompt: { role: "user", parts: [{ text: prompt }] },
  userInput: { role: "user", parts: [{ text: userInput }] },
  assistantOutput: {
    role: "model",
    parts: [
      {
        functionCall: {
          name: "response",
          args: output,
        },
      },
    ],
  },
  proseOutput: {
    role: "model",
    parts: [
      {
        functionCall: {
          name: "response",
          args: proseOutput,
        },
      },
    ],
  },
  toolUse: {
    role: "model",
    parts: [
      {
        functionCall: toolOutput,
      },
    ],
  },
};

interface CompletionParams {
  thread?: Content[] | string;
  input?: string | object;
  schema?: z.ZodType;
  context?: CompletionOptions["context"];
  tools?: Tool[];
  mode?: Mode;
  output?: Record<string, unknown>;
}

const defaultParams: Required<CompletionParams> = {
  thread: prompt,
  input: userInput,
  schema,
  context: [],
  tools: [],
  mode: "response",
  output,
};

const defaultResponse: CompletionResponse<unknown> = {
  thread: [msgMap.prompt, msgMap.userInput, msgMap.assistantOutput],
  content: output,
};

const toolResponse: CompletionResponse<unknown> = {
  thread: [msgMap.prompt, msgMap.userInput, msgMap.toolUse],
  toolCalls: [toolOutput],
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
  mode: "response",
  output,
};

describe("AI: Gemini", () => {
  const geminiSDK = new MockGeminiSDK();
  const { logOptions, logCounts, logReset } = mockExternalLog();
  setAILogging(logOptions);

  type LogParams = Parameters<typeof logCounts>[0];
  const errLog: LogParams = { error: 1 };
  const defaultLog: LogParams = { log: 1, ag: 1 };

  function clearCounts() {
    logReset();
    geminiSDK.resetCalls();
  }

  beforeEach(clearCounts);

  function callCounts(params: LogParams) {
    const { log = 0, ag = 0 } = params;
    // This just works out for gemini.ts
    const geminiCall = log - ag + 1;
    logCounts(params);
    assert.equal(geminiSDK.getCallCount(), geminiCall, "gemini call count");
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
    let { thread, input, schema, context, tools, mode, output } = {
      ...defaultParams,
      ...params,
    };

    geminiSDK.setBehavior(mode, output);

    const options = { context, tools };
    const result = useProse
      ? await proseCompletion(msg, thread, input, options)
      : await jsonCompletion(msg, thread, input, schema, options);

    geminiSDK.validateParams(thread, input, options, msg);

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
    ["rateLimit", { error: 1, log: 3 }, "Gemini Back Off Limit Exceeded"],
    ["error", errLog, "Gemini Non-Backoff Error"],
    ["refusal", defaultLog, `Refusal: SAFETY: undefined`],
    ["unknown", defaultLog, "Unexpected Finish Reason: UNKNOWN: undefined"],
    [{}, defaultLog, defaultResponse],
    ["rateLimitTemp", { ag: 1, log: 2 }, defaultResponse],
    [
      { mode: "toolCall", tools: fullParams.tools, output: toolOutput },
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
    ["error", errLog, "Gemini Non-Backoff Error"],
    [
      { output: proseOutput },
      defaultLog,
      {
        thread: [msgMap.prompt, msgMap.userInput, msgMap.proseOutput],
        content: proseOutput.content,
      },
    ],
    [
      { mode: "toolCall", tools: fullParams.tools, output: toolOutput },
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
