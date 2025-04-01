import { setTimeout } from "node:timers/promises";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources";
import type {
  ParsedChatCompletion,
  ParsedFunctionToolCall,
} from "openai/resources/beta/chat/completions";
import type { ZodType } from "zod";
import { externalLog } from "./externalLog.ts";
import { zObj, zString } from "./zod.ts";

const MODEL = "gpt-4o-mini";
const MAX_RETRIES = 3;
const INITIAL_BACKOFF = 1000;

export interface CompletionOptions {
  context?: {
    description: string;
    content: Record<string, unknown>;
  }[];
  tools?: ChatCompletionTool[];
}

export interface CompletionResponse<T> {
  thread?: ChatCompletionMessageParam[];
  content?: T;
  toolCalls?: {
    name: string;
    args: Record<string, unknown>;
  }[];
  error?: string;
}

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
  thread: ChatCompletionMessageParam[] | string,
  input: string | object,
  options?: CompletionOptions
): Promise<CompletionResponse<string>> {
  const schema = zObj("A wrapper around the completion content", {
    content: zString("The completion content"),
  });
  const result = await jsonCompletion(action, thread, input, schema, options);
  return {
    ...result,
    content: result.content?.["content"] ?? undefined,
  };
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
  thread: ChatCompletionMessageParam[] | string,
  input: string | object,
  schema: ZodType<T>,
  options?: CompletionOptions
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

  return await apiCall(MODEL, action, thread, input, schema, options);
}

async function apiCall<T extends object>(
  model: string,
  action: string,
  thread: ChatCompletionMessageParam[],
  input: string,
  schema: ZodType<T>,
  { context, tools }: CompletionOptions = {}
): Promise<CompletionResponse<T>> {
  let attempt = 0;
  const messages = createMessages(thread, input, context);
  const body = {
    model,
    messages,
    response_format: zodResponseFormat(schema, action),
    tools,
  };

  while (true) {
    try {
      const start = Date.now();
      const completion = await getClient().beta.chat.completions.parse(body);
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

let _client: OpenAI;
function getClient() {
  if (!_client) {
    _client = new OpenAI();
  }

  return _client;
}

// #region Object Creation

function createMessages(
  thread: ChatCompletionMessageParam[],
  input: string,
  context: CompletionOptions["context"] = []
): ChatCompletionMessageParam[] {
  return [
    ...thread,
    ...context.map(
      ({ description, content }) =>
        ({
          role: "user",
          name: "Context_Provider",
          content: `Useful context: ${description}\n${JSON.stringify(content)}`,
        } as ChatCompletionMessageParam)
    ),
    { role: "user", name: "Agent", content: input },
  ];
}

function completionToResponse<T>(
  completion: ParsedChatCompletion<T>,
  thread: ChatCompletionMessageParam[]
): CompletionResponse<T> {
  const { finish_reason, message } = completion.choices[0] ?? {};

  if (message?.refusal) {
    return { error: `Refusal: ${message.refusal}` };
  }

  if (finish_reason === "tool_calls") {
    return !message
      ? { error: "Finish reason tool_calls, but message is empty" }
      : {
          toolCalls: message.tool_calls?.map(extractToolCall),
          thread: [...thread, message],
        };
  }

  if (finish_reason === "stop") {
    return !message
      ? { error: "Finish reason stop, but message is empty" }
      : {
          content: message.parsed ?? undefined,
          thread: [...thread, message],
        };
  }

  return { error: `Unexpected Finish Reason: ${finish_reason}` };
}

function extractToolCall({ function: fn }: ParsedFunctionToolCall) {
  return {
    name: fn.name,
    args: fn.parsed_arguments as Record<string, unknown>,
  };
}

// #endregion

// #region Errors

function validateAction(action: string) {
  // This regex comes from OpenAI, as required by response_format.json_schema.name
  if (!/^[a-zA-Z0-9_-]+$/.test(action)) {
    externalLog.error("OpenAI Invalid Action Name", action);
    return {
      error: `Invalid action name "${action}". Must match pattern ^[a-zA-Z0-9_-]+$`,
    };
  }
  return undefined;
}

function errorToResponse(
  error: unknown,
  attempt: number
): CompletionResponse<never> | undefined {
  const errorType = getErrorType(error);

  if (errorType === "Too Long") {
    externalLog.error("OpenAI Context Too Long", error);
    return { error: "OpenAI Context Too Long" };
  }

  if (errorType !== "429") {
    externalLog.error("OpenAI Non-Backoff Error", error);
    return { error: "OpenAI Non-Backoff Error" };
  }

  if (attempt >= MAX_RETRIES) {
    externalLog.error("OpenAI Back Off Limit Exceeded", error);
    return { error: "OpenAI Back Off Limit Exceeded" };
  }

  return;
}

function getErrorType(error: unknown): "429" | "Too Long" | "Other" {
  if (error instanceof OpenAI.APIError) {
    const { code, status, error: innerError } = error;
    if (
      code === "context_length_exceeded" ||
      (code === "rate_limit_exceeded" &&
        innerError.message.startsWith("Request too large"))
    ) {
      return "Too Long";
    }
    if (status === 429) return "429";
  }
  return "Other";
}

async function backoff(action: string, attempt: number) {
  externalLog.log(`OpenAI_${action}`, `backoff attempt ${attempt}`);
  const backoff = INITIAL_BACKOFF * Math.pow(2, attempt);
  const jitter = Math.random() * 0.1 * backoff;
  return setTimeout(backoff + jitter, true);
}

// #endregion

// #region Telemetry

function logLLMAction(
  action: string,
  input: string,
  duration: number,
  { usage, choices }: OpenAI.ChatCompletion,
  result?: unknown
) {
  try {
    if (!usage) return;

    const { total_tokens, prompt_tokens, completion_tokens } = usage;
    const { cached_tokens = 0 } = usage.prompt_tokens_details ?? {};
    const { finish_reason, message } = choices[0] ?? {};

    const log: Record<string, unknown> = {
      name: action,
      in: input.length > 100 ? input.slice(0, 97) + "..." : input,
      tokens: total_tokens,
      inTokens: prompt_tokens,
      outTokens: completion_tokens,
      cacheTokens: cached_tokens,
      ms: duration,
    };

    if (finish_reason !== "stop") {
      log["finishReason"] = finish_reason;
    }

    if (message?.refusal) {
      log["refusal"] = message.refusal;
    }

    if (result) {
      log["out"] = result;
    }

    externalLog.aggregate(action, log, [
      "tokens",
      "inTokens",
      "outTokens",
      "cacheTokens",
      "ms",
    ]);
  } catch (error) {
    externalLog.error("OpenAI_LogLLMAction", error);
  }
}

// #endregion
