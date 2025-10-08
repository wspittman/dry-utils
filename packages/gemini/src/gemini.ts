import {
  EmbedContentResponse,
  FunctionCallingConfigMode,
  GenerateContentResponse,
  GoogleGenAI,
  type Content,
} from "@google/genai";
import { setTimeout } from "node:timers/promises";
import type { ZodType } from "zod";
import { diag } from "./diagnostics.ts";
import {
  completionToResponse,
  createContent,
  createMessages,
  embeddingToResponse,
  toolToGeminiTool,
} from "./shaping.ts";
import type {
  Bag,
  CompletionOptions,
  CompletionResponse,
  Context,
  EmbeddingOptions,
  EmbeddingResponse,
  ReasoningEffort,
  Tool,
} from "./types.ts";
import { proseSchema } from "./zodUtils.ts";

const MAX_RETRIES = 3;
const INITIAL_BACKOFF = 1000;

const REASONING_BUDGETS: Record<ReasoningEffort, number> = {
  minimal: 0,
  low: 1024,
  medium: 8192,
  high: 24576,
};

// #region Completion

/**
 * Makes a Gemini prose completion request.
 * Includes automatic retries with exponential backoff for rate limiting.
 * @param action The name of the action for logging purposes.
 * @param thread The conversation thread as returned by a *Completion function, or the initial developer prompt
 * @param input The input for generating the completion
 * @param options Optional object containing context and tool definitions
 * @returns An object containing response information
 */
export async function proseCompletion(
  action: string,
  thread: Content[] | string,
  input: string | object,
  options?: CompletionOptions
): Promise<CompletionResponse<string>> {
  const { content, ...rest } = await jsonCompletion(
    action,
    thread,
    input,
    proseSchema,
    options
  );

  if (content) {
    return { ...rest, content: content["content"] ?? undefined };
  }

  return rest;
}

/**
 * Makes a Gemini json completion request.
 * Includes automatic retries with exponential backoff for rate limiting.
 * @param action The name of the action for logging purposes.
 * @param thread The conversation thread as returned by a *Completion function, or the initial developer prompt
 * @param input The input for generating the completion
 * @param schema The Zod schema for the completion response
 * @param options Optional object containing context and tool definitions
 * @returns An object containing response information
 */
export async function jsonCompletion<T extends object>(
  action: string,
  thread: Content[] | string,
  input: string | object,
  schema: ZodType<T>,
  {
    context,
    tools,
    model = "gemini-2.0-flash-lite",
    reasoningEffort,
  }: CompletionOptions = {}
): Promise<CompletionResponse<T>> {
  // Start thread from initial developer prompt
  if (typeof thread === "string") {
    thread = [createContent(thread)];
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
    reasoningEffort
  );
}

async function apiCompletion<T extends object>(
  model: string,
  action: string,
  thread: Content[],
  input: string,
  schema: ZodType<T>,
  context: Context[],
  tools: Tool[],
  reasoningEffort?: ReasoningEffort
): Promise<CompletionResponse<T>> {
  let attempt = 0;
  const [systemPrompt, ...restOfThread] = thread;
  const isEmptySystemPrompt = !systemPrompt || !systemPrompt.parts?.[0]?.text;
  const messages = createMessages(restOfThread, input, context);
  const newThread = [systemPrompt ?? createContent(""), ...messages];

  /*
  https://github.com/google-gemini/cookbook/issues/393
  Gemini API refuses requests for "JSON response OR tool call"
  The request must be either for "JSON response" or "freeform response OR tool call".

  As a workaround, we
  - Remove the responseMimeType and responseSchema from the request.
  - Coerce the response schema to be included in the list of tools.
  - Set the tool config to force a tool selection.
  */
  tools = [
    ...tools,
    {
      name: "response",
      description: "A standard response to the user query. Use as a default.",
      parameters: schema,
    },
  ];

  const thinkingBudget =
    reasoningEffort === undefined
      ? undefined
      : REASONING_BUDGETS[reasoningEffort];
  const body = {
    model,
    contents: messages,
    config: {
      systemInstruction: isEmptySystemPrompt ? undefined : systemPrompt,
      //responseMimeType: "application/json",
      //responseSchema: zodToOpenAPISchema(schema),
      toolConfig: {
        functionCallingConfig: {
          mode: FunctionCallingConfigMode.ANY,
        },
      },
      tools: tools.map(toolToGeminiTool),
      ...(thinkingBudget !== undefined && {
        thinkingConfig: {
          thinkingBudget,
        },
      }),
    },
  };

  while (true) {
    try {
      const start = Date.now();
      const completion = await getClient().models.generateContent(body);
      const duration = Date.now() - start;

      const response = completionToResponse(completion, newThread, schema);
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
 * @param action The name of the action for logging purposes.
 * @param input The text or list of texts to embed.
 * @param options Optional object containing the model name and dimensionality.
 * @returns An object containing embedding vectors or an error.
 */
export async function embed(
  action: string,
  input: string | string[],
  { model = "gemini-embedding-001", dimensions }: EmbeddingOptions = {}
): Promise<EmbeddingResponse> {
  const inputs = Array.isArray(input) ? input : [input];
  const body = {
    model,
    contents: inputs,
    config: dimensions ? { outputDimensionality: dimensions } : undefined,
  };

  let attempt = 0;

  while (true) {
    try {
      const start = Date.now();
      const embeddingResponse = await getClient().models.embedContent(body);
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

let _client: GoogleGenAI;
export function getClient(): GoogleGenAI {
  if (!_client) {
    _client = new GoogleGenAI({
      apiKey: process.env["GEMINI_API_KEY"],
    });
  }

  return _client;
}

/**
 * For testing purposes only.
 * Sets the client to a mock or test client.
 */
export function setTestClient(client: unknown): void {
  _client = client as GoogleGenAI;
}

// #endregion

// #region Errors

function errorToResponse(
  error: unknown,
  attempt: number
): { error: string } | undefined {
  const errorType = getErrorType(error);

  if (errorType === "Too Long") {
    diag.error("Context Too Long", error);
    return { error: "Gemini Context Too Long" };
  }

  if (errorType !== "429") {
    diag.error("Non-Backoff Error", error);
    return { error: "Gemini Non-Backoff Error" };
  }

  if (attempt >= MAX_RETRIES) {
    diag.error("Back Off Limit Exceeded", error);
    return { error: "Gemini Back Off Limit Exceeded" };
  }

  // Retry
  return;
}

function getErrorType(error: unknown): "429" | "Too Long" | "Other" {
  if (error instanceof Error && error.name === "ClientError") {
    try {
      const embeddedMessage = error.message.slice(error.message.indexOf("{"));
      const parsed = JSON.parse(embeddedMessage);
      const { code } = parsed.error as {
        code: number;
        message: string;
        status: string;
      };

      if (code === 429) return "429";
    } catch (e) {
      diag.error("Error Parsing ClientError", e);
    }
  }
  return "Other";
}
async function backoff(action: string, attempt: number) {
  diag.log(action, `backoff attempt ${attempt}`);
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
  apiResponse: GenerateContentResponse,
  response?: CompletionResponse<T>
) {
  try {
    if (!apiResponse?.usageMetadata) return;

    const blob: Bag = {
      action,
      input,
      duration,
      apiResponse,
      response,
    };

    const {
      cachedContentTokenCount,
      candidatesTokenCount,
      promptTokenCount,
      thoughtsTokenCount,
      toolUsePromptTokenCount,
      totalTokenCount,
    } = apiResponse.usageMetadata;
    const { finishReason } = apiResponse.candidates?.[0] ?? {};

    const dense: Bag = {
      name: action,
      in: input.length > 100 ? input.slice(0, 97) + "..." : input,
      tokens: totalTokenCount,
      inTokens: promptTokenCount,
      outTokens: candidatesTokenCount,
      ms: duration,
    };

    if (thoughtsTokenCount) {
      dense["thoughtTokens"] = thoughtsTokenCount;
    }

    if (toolUsePromptTokenCount) {
      dense["toolTokens"] = toolUsePromptTokenCount;
    }

    if (cachedContentTokenCount) {
      dense["cacheTokens"] = cachedContentTokenCount;
    }

    if (finishReason !== "STOP") {
      dense["finishReason"] = finishReason;
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
      "thoughtTokens",
      "toolTokens",
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
  apiResponse: EmbedContentResponse,
  response: EmbeddingResponse
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

    const dense: Bag = {
      name: action,
      in: preview.length > 100 ? preview.slice(0, 97) + "..." : preview,
      count: (response.embeddings ?? []).length,
      ms: duration,
    };

    const metrics = createMetrics(dense, ["ms"]);

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
