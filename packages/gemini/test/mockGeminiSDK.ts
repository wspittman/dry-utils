import type {
  Content,
  ContentListUnion,
  GenerateContentParameters,
  ToolListUnion,
} from "@google/genai";
import assert from "node:assert/strict";
import { mock } from "node:test";
import {
  setTestClient,
  type CompletionOptions,
  type Tool,
} from "../src/gemini.ts";

type MockError = "rateLimit" | "error";
export type Mode =
  | MockError
  | "response"
  | "toolCall"
  | "rateLimitTemp"
  | "refusal"
  | "unknown";

class ClientError extends Error {
  override name = "ClientError";
}
const createErr = (code: number) =>
  new ClientError(`Error Time: { "error": { "code": ${code} }}`);

const errMap: Record<MockError, Error> = {
  rateLimit: createErr(429),
  error: createErr(500),
};

export class MockGeminiSDK {
  private spyGenerateContent;
  private mode: Mode = "unknown";
  private output: Record<string, unknown> = {};

  constructor() {
    this.spyGenerateContent = mock.fn(this.mockGenerateContent.bind(this));
    setTestClient({
      models: {
        generateContent: this.spyGenerateContent,
      },
    });
  }

  resetCalls(): void {
    this.spyGenerateContent.mock.resetCalls();
  }

  setBehavior(mode: Mode, output: Record<string, unknown>): void {
    this.mode = mode;
    this.output = output;
  }

  getCallCount(): number {
    return this.spyGenerateContent.mock.callCount();
  }

  // #region Validation

  validateParams(
    thread: string | Content[],
    input: string | object,
    options: CompletionOptions,
    msg?: string
  ): void {
    if (this.getCallCount() < 1) {
      assert.fail("No calls made to generate content.");
    }

    const actual = this.actualParams();
    const expected = this.expectedParams(thread, input, options);

    assert.equal(actual.system, expected.system, `system match ${msg}`);
    assert.deepEqual(
      actual.contents,
      expected.contents,
      `contents match ${msg}`
    );
    assert.deepEqual(actual.tools, expected.tools, `tools match ${msg}`);
  }

  private actualParams() {
    const { contents, config } = this.spyGenerateContent.mock.calls[0]
      ?.arguments[0] as GenerateContentParameters;

    return {
      system: this.extractStrings(config?.systemInstruction)[0] ?? "",
      contents: this.extractStrings(contents),
      tools: this.extractTools(config?.tools),
    };
  }

  private expectedParams(
    thread: string | Content[],
    input: string | object,
    { context = [], tools = [] }: CompletionOptions
  ) {
    const threadStrings =
      typeof thread === "string" ? [thread] : this.extractStrings(thread);
    const inputExpected =
      typeof input === "string" ? input : JSON.stringify(input);
    const contextExpected = context.map(
      ({ description, content }) =>
        `Useful context: ${description}\n${JSON.stringify(content)}`
    );

    return {
      system: threadStrings[0] ?? "",
      contents: [...threadStrings.slice(1), ...contextExpected, inputExpected],
      tools: [
        ...tools.map(({ name, description }) => ({ name, description })),
        {
          name: "response",
          description:
            "A standard response to the user query. Use as a default.",
        },
      ],
    };
  }

  private extractStrings(contents: ContentListUnion = []): string[] {
    if (!Array.isArray(contents)) {
      contents = [contents as Content];
    }

    return contents.map((x) => (x as Content)?.parts?.[0]?.text ?? "");
  }

  private extractTools(tools: ToolListUnion = []): Tool[] {
    return tools.map((tool) => {
      const { name = "", description = "" } =
        tool.functionDeclarations?.[0] ?? {};
      return { name, description };
    });
  }

  // #endregion

  // #region Mocking

  private mockGenerateContent(_: GenerateContentParameters) {
    this.throwErrorIf();

    return {
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              {
                functionCall:
                  this.mode === "toolCall"
                    ? this.output
                    : {
                        name: "response",
                        args: this.output,
                      },
              },
            ],
          },
          finishReason: this.getFinishReason(),
        },
      ],
      usageMetadata: {
        totalTokenCount: 75,
        promptTokenCount: 50,
        candidatesTokenCount: 25,
        cachedContentTokenCount: 0,
      },
      get functionCalls() {
        return [this.candidates[0]?.content.parts[0]?.functionCall];
      },
    };
  }

  private throwErrorIf() {
    if (this.mode === "rateLimitTemp" && this.getCallCount() < 1) {
      throw errMap["rateLimit"];
    }

    if (errMap[this.mode as MockError]) {
      throw errMap[this.mode as MockError];
    }
  }

  private getFinishReason(): string {
    switch (this.mode) {
      case "refusal":
        return "SAFETY";
      case "unknown":
        return "UNKNOWN";
      default:
        return "STOP";
    }
  }

  // #endregion
}
