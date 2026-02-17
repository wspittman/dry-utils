import { setTimeout } from "node:timers/promises";
import OpenAI from "openai";
import type { CreateEmbeddingResponse } from "openai/resources";
import type {
  ParsedResponse,
  ResponseInputItem,
} from "openai/resources/responses/responses";
import type { ReasoningEffort } from "openai/resources/shared";
import { type ZodType } from "zod";
import { diag } from "./diagnostics.ts";
import {
  completionToResponse,
  createMessages,
  embeddingToResponse,
  getTextFormat,
  toolToOpenAITool,
} from "./shaping.ts";
import type {
  Bag,
  CompletionOptions,
  CompletionResponse,
  Context,
  EmbeddingOptions,
  EmbeddingResponse,
  Tool,
} from "./types.ts";
import { proseSchema } from "./zodUtils.ts";

const MAX_RETRIES = 3;
const INITIAL_BACKOFF = 1000;

// #region Completion

/**
 * Makes an OpenAI prose completion request.
 * Includes automatic retries with exponential backoff for rate limiting.
 * @param action The name of the action for logging purposes. Must satisfy pattern: ^[a-zA-Z0-9_-]+$
 * @param thread The conversation thread as returned by a *Completion function, or the initial developer prompt
 * @param input The input for generating the completion
 * @param options Optional object containing context and tool definitions
 * @returns An object containing response information
 */
export async function proseCompletion(
  action: string,
  thread: ResponseInputItem[] | string,
  input: string | object,
  options?: CompletionOptions,
): Promise<CompletionResponse<string>> {
  const { content, ...rest } = await jsonCompletion(
    action,
    thread,
    input,
    proseSchema,
    options,
  );

  if (content) {
    return { ...rest, content: content["content"] ?? undefined };
  }

  return rest;
}

/**
 * Makes an OpenAI json completion request.
 * Includes automatic retries with exponential backoff for rate limiting.
 * @param action The name of the action for logging purposes. Must satisfy pattern: ^[a-zA-Z0-9_-]+$
 * @param thread The conversation thread as returned by a *Completion function, or the initial developer prompt
 * @param input The input for generating the completion
 * @param schema The Zod schema for the completion response
 * @param options Optional object containing context and tool definitions
 * @returns An object containing response information
 */
export async function jsonCompletion<T extends object>(
  action: string,
  thread: ResponseInputItem[] | string,
  input: string | object,
  schema: ZodType<T>,
  {
    context,
    tools,
    model = "gpt-5-nano",
    reasoningEffort,
  }: CompletionOptions = {},
): Promise<CompletionResponse<T>> {
  const actionError = validateAction(action);
  if (actionError) {
    return actionError;
  }

  // Start thread from initial developer prompt
  if (typeof thread === "string") {
    thread = [{ role: "developer", content: thread }];
  }

  // Ensure input is a string
  if (typeof input !== "string") {
    input = JSON.stringify(input);
  }

  return await apiCompletion(
    model,
    action,
    thread,
    input,
    schema,
    context ?? [],
    tools ?? [],
    reasoningEffort,
  );
}

async function apiCompletion<T extends object>(
  model: string,
  action: string,
  thread: ResponseInputItem[],
  input: string,
  schema: ZodType<T>,
  context: Context[],
  simpleTools: Tool[],
  reasoningEffort?: ReasoningEffort,
): Promise<CompletionResponse<T>> {
  let attempt = 0;
  const messages = createMessages(thread, input, context);
  const body = {
    model,
    input: messages,
    text: getTextFormat(action, schema),
    tools: simpleTools.map((tool) => toolToOpenAITool(tool)),
    reasoning:
      reasoningEffort === undefined ? undefined : { effort: reasoningEffort },
  };

  while (true) {
    try {
      const start = Date.now();
      const completion = await getClient().responses.parse<typeof body, T>(
        body,
      );
      const duration = Date.now() - start;

      const response = completionToResponse(completion, messages);
      logLLMAction(action, input, duration, completion, response);
      return response;
    } catch (error) {
      const response = errorToResponse(error, attempt);
      if (response) return response;

      await backoff(action, attempt);
      attempt++;
    }
  }
}

// #endregion

// #region Embedding

/**
 * Generates embeddings for the provided text input.
 * Includes automatic retries with exponential backoff for rate limiting.
 * @param action The name of the action for logging purposes. Must satisfy pattern: ^[a-zA-Z0-9_-]+$
 * @param input The text or list of texts to embed.
 * @param options Optional object containing the model name and dimensionality.
 * @returns An object containing embedding vectors or an error.
 */
export async function embed(
  action: string,
  input: string | string[],
  { model = "text-embedding-3-small", dimensions }: EmbeddingOptions = {},
): Promise<EmbeddingResponse> {
  const actionError = validateAction(action);
  if (actionError) {
    return actionError;
  }

  const inputs = Array.isArray(input) ? input : [input];
  const body = {
    model,
    input: inputs,
    dimensions,
  };

  let attempt = 0;

  while (true) {
    try {
      const start = Date.now();
      const embeddingResponse = await getClient().embeddings.create(body);
      const duration = Date.now() - start;

      const result = embeddingToResponse(embeddingResponse);
      logEmbedAction(action, inputs, duration, embeddingResponse, result);
      return result;
    } catch (error) {
      const response = errorToResponse(error, attempt);
      if (response) return response;

      await backoff(action, attempt);
      attempt++;
    }
  }
}

// #endregion

// #region Client

let _client: OpenAI;
export function getClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI();
  }

  return _client;
}

// #endregion

// #region Errors

function validateAction(action: string) {
  // This regex comes from OpenAI, as required by response_format.json_schema.name
  if (!/^[a-zA-Z0-9_-]+$/.test(action)) {
    diag.error("OpenAI Invalid Action Name", action);
    return {
      error: `Invalid action name "${action}". Must match pattern ^[a-zA-Z0-9_-]+$`,
    };
  }
  return undefined;
}

function errorToResponse(
  error: unknown,
  attempt: number,
): CompletionResponse<never> | undefined {
  const errorType = getErrorType(error);

  if (errorType === "Too Long") {
    diag.error("Context Too Long", error);
    return { error: "OpenAI Context Too Long" };
  }

  if (errorType !== "429") {
    diag.error("Non-Backoff Error", error);
    return { error: "OpenAI Non-Backoff Error" };
  }

  if (attempt >= MAX_RETRIES) {
    diag.error("Back Off Limit Exceeded", error);
    return { error: "OpenAI Back Off Limit Exceeded" };
  }

  // Retry
  return;
}

function getErrorType(error: unknown): "429" | "Too Long" | "Other" {
  if (error instanceof OpenAI.APIError) {
    const code = error.code;
    const status = error.status as number;
    const innerError = error.error as object | undefined;
    if (
      code === "context_length_exceeded" ||
      (code === "rate_limit_exceeded" &&
        typeof innerError === "object" &&
        innerError !== null &&
        "message" in innerError &&
        typeof innerError.message === "string" &&
        innerError.message.startsWith("Request too large"))
    ) {
      return "Too Long";
    }
    if (status === 429) return "429";
  }
  return "Other";
}

async function backoff(action: string, attempt: number) {
  diag.log(`OpenAI_${action}`, `backoff attempt ${attempt}`);
  const backoff = INITIAL_BACKOFF * Math.pow(2, attempt);
  const jitter = Math.random() * 0.1 * backoff;
  return setTimeout(backoff + jitter, true);
}

// #endregion

// #region Telemetry

function logLLMAction<T>(
  action: string,
  input: string,
  duration: number,
  apiResponse: ParsedResponse<T>,
  response?: CompletionResponse<T>,
) {
  try {
    if (!apiResponse?.usage) return;

    const blob: Bag = {
      action,
      input,
      duration,
      apiResponse,
      response,
    };

    const { total_tokens, input_tokens, output_tokens } = apiResponse.usage;
    const { cached_tokens = 0 } = apiResponse.usage.input_tokens_details ?? {};
    const { reasoning_tokens = 0 } =
      apiResponse.usage.output_tokens_details ?? {};
    const { status } = apiResponse;

    const dense: Bag = {
      name: action,
      in: input.length > 100 ? input.slice(0, 97) + "..." : input,
      tokens: total_tokens,
      inTokens: input_tokens,
      outTokens: output_tokens,
      ms: duration,
    };

    if (cached_tokens) {
      dense["cacheTokens"] = cached_tokens;
    }

    if (reasoning_tokens) {
      dense["reasoningTokens"] = reasoning_tokens;
    }

    if (status !== "completed") {
      const reason = apiResponse.incomplete_details?.reason;
      dense["finishReason"] = `${status}${reason ? `: ${reason}` : ""}`;
    }

    const messages = apiResponse.output
      .filter((x) => x.type === "message")
      .map((x) => x.content[0]);
    const refusal = messages.find((x) => x?.type === "refusal");
    if (refusal) {
      dense["refusal"] = refusal.refusal;
    }

    if (response) {
      const { thread, ...rest } = response;
      dense["out"] = rest;
    }

    const metrics = createMetrics(dense, [
      "tokens",
      "inTokens",
      "outTokens",
      "cacheTokens",
      "reasoningTokens",
      "ms",
    ]);

    diag.aggregate(action, blob, dense, metrics);
  } catch (error) {
    diag.error("LogLLMAction", error);
  }
}

function logEmbedAction(
  action: string,
  inputs: string[],
  duration: number,
  apiResponse: CreateEmbeddingResponse,
  response: EmbeddingResponse,
) {
  try {
    const blob: Bag = {
      action,
      inputs,
      duration,
      apiResponse,
      response,
    };

    let preview = `${inputs.length} items: `;
    for (const item of inputs) {
      if (preview.length > 100) break;
      preview += `[${item}] | `;
    }

    const { total_tokens, prompt_tokens } = apiResponse.usage;

    const dense: Bag = {
      name: action,
      in: preview.length > 100 ? preview.slice(0, 97) + "..." : preview,
      count: (response.embeddings ?? []).length,
      tokens: total_tokens,
      inTokens: prompt_tokens,
      ms: duration,
    };

    const metrics = createMetrics(dense, ["tokens", "inTokens", "ms"]);

    diag.aggregate(action, blob, dense, metrics);
  } catch (error) {
    diag.error("LogEmbedAction", error);
  }
}

function createMetrics(dense: Bag, keys: string[]): Record<string, number> {
  const metrics: Record<string, number> = {};
  keys.forEach((x) => {
    if (typeof dense[x] === "number") {
      metrics[x] = dense[x];
    }
  });
  return metrics;
}

// #endregion
