import {
  FinishReason,
  type FunctionCall,
  type GenerateContentResponse,
  type GenerateContentResponseUsageMetadata,
} from "@google/genai";
import assert from "node:assert/strict";
import type { CompletionResponse } from "../src/gemini.ts";
import { proseSchema } from "../src/zodUtils.ts";

type Completion = CompletionResponse<unknown>;

const usage: GenerateContentResponseUsageMetadata = {
  promptTokenCount: 500,
  toolUsePromptTokenCount: 200,
  cachedContentTokenCount: 100,
  candidatesTokenCount: 250,
  thoughtsTokenCount: 50,
  totalTokenCount: 75,
};

const defaultResponse = createResponse(
  { content: "complete" },
  FinishReason.STOP
);

export class ClientError extends Error {
  override name = "ClientError";
}
const createErr = (code: number) =>
  new ClientError(`Error Time: { "error": { "code": ${code} }}`);

export const ResponseThrownTemplates: Record<string, [ClientError, string]> = {
  error: [createErr(500), "Gemini Non-Backoff Error"],
};

export const ResponseErrorTemplates: Record<
  string,
  [GenerateContentResponse, string]
> = {
  noFinishReason: [createResponse({}), "No finish reason in response"],
  refusal: [
    createResponse({}, FinishReason.SAFETY, "ugly"),
    "Refusal: SAFETY: ugly",
  ],
  emptyFunction: [
    createResponse({ name: "", args: {} }, FinishReason.STOP),
    "Function call returned, but name is empty",
  ],
};

export const ResponseTemplates: Record<string, GenerateContentResponse> = {
  default: defaultResponse,
  toolCall: createResponse(
    { name: "my_tool", args: { content: "tool call content" } },
    FinishReason.STOP
  ),
};

export const RateLimitTemplate: [ClientError, string, GenerateContentResponse] =
  [createErr(429), "Gemini Back Off Limit Exceeded", defaultResponse];

/**
 * Validate the error response from the API
 * @param actual The actual response from the API
 * @param expected The expected error message
 */
export function validateAPIError(actual: Completion, expected: string): void {
  assert.equal(actual.thread, undefined, "thread");
  assert.equal(actual.content, undefined, "content");
  assert.equal(actual.toolCalls, undefined, "toolCalls");
  assert.equal(actual.error, expected, "error");
}

/**
 * Validate the successful response from the API
 * @param actual The actual response from the API
 * @param used The parsed response that was used to generate the response
 * @param contentOverride An optional override for the expected content
 */
export function validateAPIResponse(
  actual: Completion,
  used: GenerateContentResponse,
  contentOverride?: unknown
): void {
  const expected = simpleCompletionResponse(used);

  assert.deepEqual(actual.thread, expected.thread, "thread");
  assert.deepEqual(
    actual.content,
    contentOverride ?? expected.content,
    "content"
  );
  assert.deepEqual(actual.toolCalls, expected.toolCalls, "toolCalls");
  assert.equal(actual.error, expected.error, "error");
}

function simpleCompletionResponse({
  candidates,
  functionCalls,
}: GenerateContentResponse): Completion {
  const content = candidates?.[0]?.content!;
  const fn = functionCalls![0]! as Required<FunctionCall>;
  const { name, args } = fn;

  return {
    thread: [
      { role: "user", parts: [{ text: "system prompt" }] },
      { role: "user", parts: [{ text: "user input" }] },
      content,
    ],
    content: name === "response" ? proseSchema.parse(args) : undefined,
    toolCalls: name === "response" ? undefined : [fn],
  };
}

function createResponse(
  output: Record<string, unknown>,
  finishReason?: FinishReason,
  finishMessage?: string
) {
  const response: GenerateContentResponse = {
    candidates: [
      {
        content: {
          role: "model",
          parts: [
            {
              functionCall:
                "name" in output && "args" in output
                  ? (output as FunctionCall)
                  : {
                      name: "response",
                      args: output,
                    },
            },
          ],
        },
        finishReason,
        finishMessage,
      },
    ],
    usageMetadata: usage,
    get functionCalls() {
      return [
        this.candidates?.[0]?.content?.parts?.[0]?.functionCall as FunctionCall,
      ];
    },
  } as GenerateContentResponse;

  return response;
}
