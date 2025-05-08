import assert from "node:assert/strict";
import { mock } from "node:test";
import { APIError } from "openai";
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources";
import {
  type ChatCompletionParseParams,
  Completions,
  type ParsedChatCompletionMessage,
} from "openai/resources/beta/chat/completions";
import { type CompletionOptions, type Tool } from "../src/openai.ts";

type Message =
  | ChatCompletionMessageParam
  | ParsedChatCompletionMessage<unknown>;
type ParseParams = ChatCompletionParseParams;

type MockError = "errRate" | "errLarge" | "errLong" | "error";
export type Mode =
  | MockError
  | "stop"
  | "tool_calls"
  | "errRateTemp"
  | "refusal"
  | "unknown";

const createErr = (status: number, code: string, message: string) =>
  new APIError(status, { status, message, code }, message, {});

const errMap: Record<MockError, APIError> = {
  errRate: createErr(429, "rate_limit_exceeded", "Rate limit exceeded"),
  errLarge: createErr(429, "rate_limit_exceeded", "Request too large..."),
  errLong: createErr(400, "context_length_exceeded", "This model's maximum..."),
  error: createErr(500, "mock_other_error", "This is a mock error..."),
};

export class MockOpenAISDK {
  private mockParse;
  private mode: Mode = "unknown";
  private output: string = "";

  constructor() {
    this.mockParse = mock.method(
      Completions.prototype,
      "parse",
      this.mockParseImpl.bind(this)
    );
  }

  resetCalls(): void {
    this.mockParse.mock.resetCalls();
  }

  setBehavior(mode: Mode, output: string): void {
    this.mode = mode;
    this.output = output;
  }

  getCallCount(): number {
    return this.mockParse.mock.callCount();
  }

  // #region Validation

  validateParams(
    thread: string | Message[],
    input: string | object,
    options: CompletionOptions,
    msg?: string
  ): void {
    if (this.getCallCount() < 1) {
      assert.fail("No calls made to parse.");
    }

    const actual = this.actualParams();
    const expected = this.expectedParams(thread, input, options);

    assert.deepEqual(
      actual.contents,
      expected.contents,
      `contents match ${msg}`
    );
    assert.deepEqual(actual.tools, expected.tools, `tools match ${msg}`);
  }

  private actualParams() {
    const { messages, tools } = this.mockParse.mock.calls[0]
      ?.arguments[0] as ParseParams;

    return {
      contents: messages.map((x) => x.content),
      tools: this.extractTools(tools),
    };
  }

  private expectedParams(
    thread: string | Message[],
    input: string | object,
    { context = [], tools = [] }: CompletionOptions
  ) {
    const contents =
      typeof thread === "string"
        ? [thread]
        : thread?.map(({ content }) => content as string);
    const inputExpected =
      typeof input === "string" ? input : JSON.stringify(input);
    const contextExpected = (context ?? []).map(
      ({ description, content }) =>
        `Useful context: ${description}\n${JSON.stringify(content)}`
    );

    return {
      contents: [...contents, ...contextExpected, inputExpected],
      tools: tools.map(({ name, description }) => ({ name, description })),
    };
  }

  private extractTools(tools: ChatCompletionTool[] = []): Tool[] {
    return tools.map((tool) => {
      const { name, description = "" } = tool.function;
      return { name, description };
    });
  }

  // #endregion

  // #region Mocking

  private mockParseImpl(_: ChatCompletionCreateParamsNonStreaming) {
    this.throwErrorIf();
    const { reason, message } = this.getChoice();

    return {
      choices: [
        {
          finish_reason: reason,
          index: 0,
          message: {
            role: "assistant",
            content: this.output,
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

  private throwErrorIf() {
    if (this.mode === "errRateTemp" && this.getCallCount() < 1) {
      throw errMap["errRate"];
    }

    if (errMap[this.mode as MockError]) {
      throw errMap[this.mode as MockError];
    }
  }

  private getChoice() {
    let reason: string = this.mode;
    let message: Record<string, unknown> = {};

    if (this.mode === "stop" || this.mode === "errRateTemp") {
      reason = "stop";
      message = { content: this.output, parsed: JSON.parse(this.output) };
    }

    if (this.mode === "refusal") {
      reason = "stop";
      message = { refusal: this.output };
    }

    if (this.mode === "tool_calls") {
      message = { tool_calls: JSON.parse(this.output) };
    }

    return { reason, message };
  }

  // #endregion
}
