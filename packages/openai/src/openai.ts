import { setTimeout } from "node:timers/promises";
import OpenAI from "openai";
import type {
  ParsedResponse,
  ResponseInputItem,
} from "openai/resources/responses/responses";
import type { ZodType } from "zod";
import { diag } from "./diagnostics.ts";
import { toJSONSchema, zObj, zString } from "./zod.ts";

const MAX_RETRIES = 3;
const INITIAL_BACKOFF = 1000;

export interface Context {
  description: string;
  content: Record<string, unknown>;
}

export interface Tool {
  name: string;
  description: string;
  parameters?: ZodType<object>;
}

export interface CompletionOptions {
  context?: Context[];
  tools?: Tool[];
  model?: string;
}

export interface CompletionResponse<T> {
  thread?: ResponseInputItem[];
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
  thread: ResponseInputItem[] | string,
  input: string | object,
  options?: CompletionOptions
): Promise<CompletionResponse<string>> {
  const schema = zObj("A wrapper around the completion content", {
    content: zString("The completion content"),
  });
  const { content, ...rest } = await jsonCompletion(
    action,
    thread,
    input,
    schema,
    options
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
  { context, tools, model = "gpt-5-nano" }: CompletionOptions = {}
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

  return await apiCall(
    model,
    action,
    thread,
    input,
    schema,
    context ?? [],
    tools ?? []
  );
}

async function apiCall<T extends object>(
  model: string,
  action: string,
  thread: ResponseInputItem[],
  input: string,
  schema: ZodType<T>,
  context: Context[],
  simpleTools?: Tool[]
): Promise<CompletionResponse<T>> {
  let attempt = 0;
  const messages = createMessages(thread, input, context);
  const body = {
    model,
    input: messages,
    text: getTextFormat(action, schema),
    tools: simpleTools?.map((tool) => toolToOpenAITool(tool)) ?? undefined,
    reasoning: { effort: "minimal" as const },
  };

  while (true) {
    try {
      const start = Date.now();
      const completion = await getClient().responses.parse<typeof body, T>(
        body
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

let _client: OpenAI;
function getClient() {
  if (!_client) {
    _client = new OpenAI();
  }

  return _client;
}

// #region Object Creation

function getTextFormat<T>(action: string, schema: ZodType<T>) {
  return {
    // Don't use OpenAI's built-in Zod helpers because they don't work with Zod v4
    format: {
      name: action,
      schema: toJSONSchema(schema),
      type: "json_schema" as const,
      strict: true,
    },
  };
}

function toolToOpenAITool({ name, description, parameters }: Tool) {
  // Don't use OpenAI's built-in Zod helpers because they don't work with Zod v4

  // Parameters are optional in our Tool type but required by OpenAI
  const defaultParams = parameters ?? zObj("No parameters", {});

  return {
    type: "function" as const,
    name,
    description,
    parameters: toJSONSchema(defaultParams),
    strict: true,
  };
}

function createMessages(
  thread: ResponseInputItem[],
  input: string,
  context: Context[]
): ResponseInputItem[] {
  return [
    ...thread,
    ...context.map(
      ({ description, content }) =>
        ({
          role: "user",
          content: `Useful context: ${description}\n${JSON.stringify(content)}`,
        } as ResponseInputItem)
    ),
    { role: "user", content: input },
  ];
}

function completionToResponse<T>(
  completion: ParsedResponse<T>,
  thread: ResponseInputItem[]
): CompletionResponse<T> {
  if (completion.status === "incomplete") {
    const reason = completion.incomplete_details?.reason;
    return {
      error:
        reason === "content_filter"
          ? "Content filtered"
          : "Incomplete response",
    };
  }

  if (completion.status !== "completed") {
    return { error: `Unexpected response status: ${completion.status}` };
  }

  const result: CompletionResponse<T> = {};

  for (const output of completion.output) {
    if (output.type === "message") {
      const content = output.content[0];

      if (content?.type === "refusal") {
        return { error: `Refusal: ${content.refusal}` };
      } else if (content?.type === "output_text") {
        result.content = content.parsed ?? undefined;
      } else {
        return { error: "No content on message output" };
      }
    } else if (output.type === "function_call") {
      result.toolCalls ??= [];

      let args = output.parsed_arguments;

      // I'm seeing an issue where this just repeats the output block for one level nested
      if ("call_id" in output.parsed_arguments) {
        args = output.parsed_arguments.parsed_arguments;
      }

      result.toolCalls.push({
        name: output.name,
        args,
      });
    }
  }

  result.thread = [...thread, ...completion.output];
  return result;
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
  attempt: number
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
  response?: CompletionResponse<T>
) {
  try {
    if (!apiResponse?.usage) return;

    const blob: Record<string, unknown> = {
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

    const dense: Record<string, unknown> = {
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

    const metrics: Record<string, number> = {};
    [
      "tokens",
      "inTokens",
      "outTokens",
      "cacheTokens",
      "reasoningTokens",
      "ms",
    ].forEach((x) => {
      if (typeof dense[x] === "number") {
        metrics[x] = dense[x];
      }
    });

    diag.aggregate(action, blob, dense, metrics);
  } catch (error) {
    diag.error("LogLLMAction", error);
  }
}

// #endregion
