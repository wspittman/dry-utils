import type { EmbedContentResponse } from "@google/genai";
import assert from "node:assert/strict";
import type { EmbeddingResponse } from "../src/types.ts";
import { ClientError } from "./generateResponse.ts";

export const EmbedResponseTemplates: Record<string, EmbedContentResponse> = {
  default: {
    embeddings: [{ values: [0.1, 0.2, 0.3] }],
  },
};

export const EmbedErrorTemplates: Record<
  string,
  [EmbedContentResponse, string]
> = {
  empty: [{ embeddings: [] }, "Gemini Embedding Empty Response"],
  missing: [{}, "Gemini Embedding Empty Response"],
};

export const EmbedThrownTemplates: Record<string, [ClientError, string]> = {
  error: [
    new ClientError('Error Time: { "error": { "code": 500 } }'),
    "Gemini Non-Backoff Error",
  ],
};

export const EmbedRateLimitTemplate: [
  ClientError,
  string,
  EmbedContentResponse,
] = [
  new ClientError('Error Time: { "error": { "code": 429 } }'),
  "Gemini Back Off Limit Exceeded",
  EmbedResponseTemplates["default"]!,
];

export function validateEmbedResponse(
  actual: EmbeddingResponse,
  used: EmbedContentResponse,
): void {
  assert.ok(!actual.error, `Should not have error: ${actual.error}`);
  assert.ok(actual.embeddings, "embeddings should exist");
  const expected = (used.embeddings ?? []).map((entry) => entry.values);
  assert.deepEqual(actual.embeddings, expected, "embedding values");
}

export function validateEmbedError(
  actual: EmbeddingResponse,
  expected: string,
): void {
  assert.ok(!actual.embeddings, "embeddings should not exist");
  assert.equal(actual.error, expected);
}
