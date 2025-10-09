import type { Content } from "@google/genai";
import type { ZodType } from "zod";

export type Bag = Record<string, unknown>;
export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

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
  thread?: Content[];
  content?: T;
  toolCalls?: {
    name: string;
    args: Record<string, unknown>;
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
