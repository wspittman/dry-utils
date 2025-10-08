import assert from "node:assert/strict";
import { APIError } from "openai";
import type { CreateEmbeddingResponse } from "openai/resources";
import type { EmbeddingResponse } from "../src/types.ts";

const createErr = (status: number, code: string, message: string) =>
  new APIError(status, { status, message, code }, message, undefined);

export const EmbedResponseTemplates: Record<string, CreateEmbeddingResponse> = {
  default: {
    data: [{ embedding: [0.1, 0.2, 0.3], index: 0, object: "embedding" }],
    model: "text-embedding-3-small",
    object: "list",
    usage: { prompt_tokens: 5, total_tokens: 5 },
  },
};

export const EmbedErrorTemplates: Record<
  string,
  [CreateEmbeddingResponse, string]
> = {
  empty: [
    {
      data: [],
      model: "text-embedding-3-small",
      object: "list",
      usage: { prompt_tokens: 0, total_tokens: 0 },
    },
    "OpenAI Embedding Empty Response",
  ],
};

export const EmbedThrownTemplates: Record<string, [APIError, string]> = {
  error: [
    createErr(500, "mock_other_error", "This is a mock error..."),
    "OpenAI Non-Backoff Error",
  ],
};

export const EmbedRateLimitTemplate: [
  APIError,
  string,
  CreateEmbeddingResponse
] = [
  createErr(429, "rate_limit_exceeded", "Rate limit exceeded"),
  "OpenAI Back Off Limit Exceeded",
  EmbedResponseTemplates["default"]!,
];

export function validateEmbedResponse(
  actual: EmbeddingResponse,
  used: CreateEmbeddingResponse
): void {
  assert.ok(!actual.error, `Should not have error: ${actual.error}`);
  assert.ok(actual.embeddings, "embeddings should exist");
  const expected = (used.data ?? []).map((entry) => entry.embedding ?? []);
  assert.deepEqual(actual.embeddings, expected, "embedding values");
}

export function validateEmbedError(
  actual: EmbeddingResponse,
  expected: string
): void {
  assert.ok(!actual.embeddings, "embeddings should not exist");
  assert.equal(actual.error, expected);
}
