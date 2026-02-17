import assert from "node:assert/strict";
import { APIError } from "openai";
import type {
  ParsedResponse,
  ParsedResponseOutputItem,
  ResponseStatus,
  ResponseUsage,
} from "openai/resources/responses/responses";
import type { CompletionResponse } from "../src/types.ts";

type Parsed = ParsedResponse<unknown>;
type Completion = CompletionResponse<unknown>;

const usage: ResponseUsage = {
  input_tokens: 500,
  input_tokens_details: { cached_tokens: 100 },
  output_tokens: 250,
  output_tokens_details: { reasoning_tokens: 50 },
  total_tokens: 750,
};

const defaultResponse = createResponse({
  type: "message",
  status: "completed",
  content: [
    {
      type: "output_text",
      annotations: [],
      logprobs: [],
      text: '{"content":"complete"}',
      parsed: { content: "complete" },
    },
  ],
  role: "assistant",
});

const createErr = (status: number, code: string, message: string) =>
  new APIError(status, { status, message, code }, message, undefined);

export const ResponseThrownTemplates: Record<string, [APIError, string]> = {
  errLarge: [
    createErr(429, "rate_limit_exceeded", "Request too large..."),
    "OpenAI Context Too Long",
  ],
  errLong: [
    createErr(400, "context_length_exceeded", "This model's maximum..."),
    "OpenAI Context Too Long",
  ],
  error: [
    createErr(500, "mock_other_error", "This is a mock error..."),
    "OpenAI Non-Backoff Error",
  ],
};

export const ResponseErrorTemplates: Record<string, [Parsed, string]> = {
  incompleteFiltered: [
    createResponse({}, "incomplete", "content_filter"),
    "Content filtered",
  ],
  incompleteOther: [
    createResponse({}, "incomplete", "max_output_tokens"),
    "Incomplete response",
  ],
  unexpectedStatus: [
    createResponse({}, "failed"),
    "Unexpected response status: failed",
  ],
  refusal: [
    createResponse({
      type: "message",
      status: "completed",
      content: [
        {
          type: "refusal",
          refusal: "ugly",
        },
      ],
      role: "assistant",
    }),
    "Refusal: ugly",
  ],
};

export const ResponseTemplates: Record<string, Parsed> = {
  default: defaultResponse,
  toolCall: createResponse({
    type: "function_call",
    status: "completed",
    name: "my_tool",
    parsed_arguments: { a: 1, b: "two" },
  }),
};

export const RateLimitTemplate: [APIError, string, Parsed] = [
  createErr(429, "rate_limit_exceeded", "Rate limit exceeded"),
  "OpenAI Back Off Limit Exceeded",
  defaultResponse,
];

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
  used: Parsed,
  contentOverride?: unknown,
): void {
  const expected = simpleCompletionResponse(used);

  assert.deepEqual(actual.thread, expected.thread, "thread");
  assert.deepEqual(
    actual.content,
    contentOverride ?? expected.content,
    "content",
  );
  assert.deepEqual(actual.toolCalls, expected.toolCalls, "toolCalls");
  assert.equal(actual.error, expected.error, "error");
}

function simpleCompletionResponse({ output }: Parsed): Completion {
  const outputOne = output[1];
  let content: unknown;
  let toolCalls: Completion["toolCalls"] | undefined;

  if (outputOne && "content" in outputOne) {
    const contentZero = outputOne.content?.[0];
    if (contentZero && "parsed" in contentZero) {
      content = contentZero.parsed;
    }
  }

  if (outputOne && "parsed_arguments" in outputOne) {
    toolCalls = [{ name: outputOne.name, args: outputOne.parsed_arguments }];
  }

  return {
    thread: [
      { role: "developer", content: "system prompt" },
      { role: "user", content: "user input" },
      ...output,
    ],
    content,
    toolCalls,
  };
}

function createResponse(
  output: Partial<ParsedResponseOutputItem<unknown>>,
  status: ResponseStatus = "completed",
  incompleteReason?: "max_output_tokens" | "content_filter",
) {
  const id = "68b0a7bfbdec819089297fac49dba44c07a2bc259d9e1681";
  const mergedResponse = {
    id: `resp_${id}`,
    object: "response",
    created_at: 1756407744,
    status,
    output: [
      {
        id: `rs_${id}`,
        type: "reasoning",
        summary: [],
      },
      {
        id: `msg_${id}`,
        ...output,
      },
    ],
    usage,
  } as Parsed;

  if (incompleteReason) {
    mergedResponse.incomplete_details = {
      reason: incompleteReason,
    };
  }

  return mergedResponse;
}
