import type { ResponseInputItem } from "openai/resources/responses/responses";
import type { ReasoningEffort } from "openai/resources/shared";
import type { ZodType } from "zod";

export type Bag = Record<string, unknown>;

// #region Completion

export interface CompletionOptions {
  context?: Context[];
  tools?: Tool[];
  model?: string;
  reasoningEffort?: ReasoningEffort;
}

export interface Context {
  description: string;
  content: Bag;
}

export interface Tool {
  name: string;
  description: string;
  parameters?: ZodType<object>;
}

export interface CompletionResponse<T> {
  thread?: ResponseInputItem[];
  content?: T;
  toolCalls?: {
    name: string;
    args: Bag;
  }[];
  error?: string;
}

// #endregion

// #region Embedding

export interface EmbeddingOptions {
  model?: string;
  dimensions?: number;
}

export interface EmbeddingResponse {
  embeddings?: number[][];
  error?: string;
}

// #endregion
