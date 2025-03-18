import { setTimeout } from "node:timers/promises";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import type { ParsedChatCompletion } from "openai/resources/beta/chat/completions";
import { z, ZodType } from "zod";
import { externalLog } from "./externalLog";

const client = new OpenAI();
const MODEL = "gpt-4o-mini";
const MAX_RETRIES = 3;
const INITIAL_BACKOFF = 1000;

/**
 * Makes an OpenAI completion request with JSON response validation using a Zod schema.
 * Includes automatic retries with exponential backoff for rate limiting.
 * @param action The name of the action for logging purposes
 * @param prompt The system prompt
 * @param schema The Zod schema to validate the response
 * @param input The user input string or object
 * @returns The parsed and validated completion, or undefined if the request fails
 */
export async function jsonCompletion<T>(
  action: string,
  prompt: string,
  schema: ZodType<T>,
  input: string | object
) {
  let attempt = 0;

  while (true) {
    try {
      return await jsonComplete<T>(action, prompt, schema, input);
    } catch (error) {
      const errorType = getErrorType(error);
      if (errorType === "Too Long") {
        externalLog.error("OpenAI Context Too Long", error);
        throw new Error("OpenAI Context Too Long");
      } else if (errorType !== "429") {
        externalLog.error("OpenAI Non-Backoff Error", error);
        throw new Error("OpenAI Non-Backoff Error");
      } else if (attempt >= MAX_RETRIES) {
        externalLog.error("OpenAI Back Off Limit Exceeded", error);
        throw new Error("OpenAI Back Off Limit Exceeded");
      }

      await backoff(action, attempt);
      attempt++;
    }
  }
}

async function jsonComplete<T>(
  action: string,
  prompt: string,
  schema: ZodType<T>,
  input: string | object
) {
  input = typeof input === "string" ? input : JSON.stringify(input);

  const start = Date.now();
  const completion = await client.beta.chat.completions.parse({
    model: MODEL,
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: input },
    ],
    response_format: zodResponseFormat(schema, action),
  });
  const duration = Date.now() - start;

  const parsed = extractMessage(completion);

  logLLMAction(action, input, duration, completion, parsed);

  return parsed;
}

function extractMessage<T>(completion: ParsedChatCompletion<T>) {
  if (!completion.choices[0]) return;

  const { finish_reason, message } = completion.choices[0] ?? {};

  if (finish_reason === "stop" && message && !message.refusal) {
    return message.parsed;
  }
}

// #region setExtractedData

type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object
    ? DeepPartial<T[P]>
    : Exclude<T[P], null>;
};

/**
 * Fill a parent item with extracted data from matching keys in the LLM completion.
 * Ignores any undefined/null values in the completion object.
 * The typing is wild here but this function saves us a lot of boilerplate.
 * @param item The parent object to update with extracted data
 * @param completion The LLM completion object containing the extracted data
 */
export function setExtractedData<
  Item extends object,
  Schema extends ZodType,
  Key extends keyof Item & keyof z.infer<Schema>
>(item: Item, completion: Pick<z.infer<Schema>, Key>) {
  // Note: Assign isn't recursive, so top-level objects will be replaced
  Object.assign(item, removeNulls(completion));
}

function removeNulls<T extends object>(val: T): DeepPartial<T> | undefined {
  if (typeof val !== "object" || val == null) return val;

  if (Array.isArray(val)) {
    const cleanArray = val.map(removeNulls).filter(Boolean);
    return cleanArray.length ? (cleanArray as DeepPartial<T>) : undefined;
  }

  const entries = Object.entries(val)
    .map(([key, value]) => [key, removeNulls(value)])
    .filter(([_, value]) => value != null);

  return entries.length ? Object.fromEntries(entries) : undefined;
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
      log.finishReason = finish_reason;
    }

    if (message?.refusal) {
      log.refusal = message.refusal;
    }

    if (result) {
      log.out = result;
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

async function backoff(action: string, attempt: number) {
  externalLog.log(`OpenAI_${action}`, `backoff attempt ${attempt}`);
  return setTimeout(getBackoffDelay(attempt), true);
}

function getBackoffDelay(attempt: number) {
  const backoff = INITIAL_BACKOFF * Math.pow(2, attempt);
  const jitter = Math.random() * 0.1 * backoff;
  return backoff + jitter;
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
