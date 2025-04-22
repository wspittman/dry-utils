import {
  GenerateContentResponse,
  GoogleGenAI,
  type Content,
} from "@google/genai";
import { setTimeout } from "node:timers/promises";
import type { ZodType } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { externalLog } from "./externalLog.ts";
import { zObj, zString } from "./zod.ts";

const MODEL = "gemini-2.0-flash";
const MAX_RETRIES = 3;
const INITIAL_BACKOFF = 1000;

export interface Context {
  description: string;
  content: Record<string, unknown>;
}

export interface CompletionOptions {
  context?: Context[];
}

export interface CompletionResponse<T> {
  thread?: Content[];
  content?: T;
  error?: string;
}

export async function proseCompletion(
  action: string,
  thread: Content[] | string,
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
 * Makes a Gemini json completion request.
 * Includes automatic retries with exponential backoff for rate limiting.
 * @param action The name of the action for logging purposes.
 * @param thread The conversation thread as returned by a *Completion function, or the initial developer prompt
 * @param input The input for generating the completion
 * @param schema The Zod schema for the completion response
 * @param options Optional object containing context and tool definitions
 * @returns An object containing response information
 */
export async function jsonCompletion<T>(
  action: string,
  thread: Content[] | string,
  input: string | object,
  schema: ZodType<T>,
  { context }: CompletionOptions = {}
): Promise<CompletionResponse<T>> {
  // Start thread from initial developer prompt
  if (typeof thread === "string") {
    thread = [createContent(thread)];
  }

  // Ensure input is a string
  if (typeof input !== "string") {
    input = JSON.stringify(input);
  }

  return await apiCall(MODEL, action, thread, input, schema, context ?? []);
}

async function apiCall<T>(
  model: string,
  action: string,
  thread: Content[],
  input: string,
  schema: ZodType<T>,
  context: Context[]
  //simpleTools: Required<Tool>[]
): Promise<CompletionResponse<T>> {
  let attempt = 0;
  const [systemPrompt, ...restOfThread] = thread;
  const messages = createMessages(restOfThread, input, context);
  const newThread = [systemPrompt!, ...messages];

  const body = {
    model,
    contents: messages,
    config: {
      systemInstruction: systemPrompt,
      responseMimeType: "application/json",
      responseSchema: zodToJsonSchema(schema, {
        name: action,
        target: "openApi3",
      }).definitions![action],
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

let _client: GoogleGenAI;
function getClient() {
  if (!_client) {
    _client = new GoogleGenAI({
      apiKey: process.env["GEMINI_API_KEY"],
    });
  }

  return _client;
}

// #region Object Creation

function createContent(text: string, role: string = "user"): Content {
  return {
    role,
    parts: [{ text }],
  };
}

function createMessages(
  thread: Content[],
  input: string,
  context: Context[]
): Content[] {
  return [
    ...thread,
    ...context.map(({ description, content }) =>
      createContent(
        `Useful context: ${description}\n${JSON.stringify(content)}`
      )
    ),
    createContent(input),
  ];
}

function completionToResponse<T>(
  completion: GenerateContentResponse,
  thread: Content[],
  schema: ZodType<T>
): CompletionResponse<T> {
  const { content, finishReason, finishMessage } =
    completion.candidates?.[0] ?? {};

  if (!finishReason) {
    return { error: "No finish reason in response" };
  }

  if (["SAFETY", "BLOCKLIST", "PROHIBITED_CONTENT"].includes(finishReason)) {
    return { error: `Refusal: ${finishReason}: ${finishMessage}` };
  }

  if (finishReason === "STOP") {
    if (!content) {
      return { error: "Finish reason STOP, but content is empty" };
    }

    const rawText = completion.text;

    if (!rawText) {
      return { error: "Finish reason STOP, but no text provided" };
    }

    const parsed = JSON.parse(rawText);
    const moreParsed = schema.parse(parsed);

    return {
      content: moreParsed,
      thread: [...thread, content],
    };
  }

  return {
    error: `Unexpected Finish Reason: ${finishReason}: ${finishMessage}`,
  };
}

// #endregion

// #region Errors

function errorToResponse(
  error: unknown,
  attempt: number
): CompletionResponse<never> | undefined {
  const errorType = getErrorType(error);

  if (errorType === "Too Long") {
    externalLog.error("Context Too Long", error);
    return { error: "Gemini Context Too Long" };
  }

  if (errorType !== "429") {
    externalLog.error("Non-Backoff Error", error);
    return { error: "Gemini Non-Backoff Error" };
  }

  if (attempt >= MAX_RETRIES) {
    externalLog.error("Back Off Limit Exceeded", error);
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
      const { code, message, status } = parsed.error as {
        code: number;
        message: string;
        status: string;
      };

      if (code === 429) return "429";
    } catch (e) {
      externalLog.error("Error Parsing ClientError", e);
    }
  }
  return "Other";
}
async function backoff(action: string, attempt: number) {
  externalLog.log(action, `backoff attempt ${attempt}`);
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
  { usageMetadata, candidates }: GenerateContentResponse,
  response?: unknown
) {
  try {
    if (!usageMetadata) return;

    const {
      cachedContentTokenCount,
      candidatesTokenCount,
      promptTokenCount,
      thoughtsTokenCount,
      toolUsePromptTokenCount,
      totalTokenCount,
    } = usageMetadata;
    const { finishReason } = candidates?.[0] ?? {};

    const log: Record<string, unknown> = {
      name: action,
      in: input.length > 100 ? input.slice(0, 97) + "..." : input,
      tokens: totalTokenCount,
      inTokens: promptTokenCount,
      outTokens: candidatesTokenCount,
      ms: duration,
    };

    if (thoughtsTokenCount) {
      log["thoughtTokens"] = thoughtsTokenCount;
    }

    if (toolUsePromptTokenCount) {
      log["toolTokens"] = toolUsePromptTokenCount;
    }

    if (cachedContentTokenCount) {
      log["cacheTokens"] = cachedContentTokenCount;
    }

    if (finishReason !== "STOP") {
      log["finishReason"] = finishReason;
    }

    if (response) {
      /*
      For now, discard the thread to decrease the size of the log and stay under Azure limits.
      A better long-term solutions would be to give the user more control via the storeCalls option.
      They should be able to add to the same log, log separate with logFn or provide a separate logging function.
      */
      //const { thread, ...rest } = response;
      log["out"] = response;
    }

    externalLog.aggregate(action, log, [
      "tokens",
      "inTokens",
      "outTokens",
      "cacheTokens",
      "thoughtTokens",
      "toolTokens",
      "ms",
    ]);
  } catch (error) {
    externalLog.error("LogLLMAction", error);
  }
}

// #endregion
