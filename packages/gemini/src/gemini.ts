import {
  FunctionCallingConfigMode,
  GenerateContentResponse,
  GoogleGenAI,
  type Content,
} from "@google/genai";
import { setTimeout } from "node:timers/promises";
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
  thread?: Content[];
  content?: T;
  toolCalls?: {
    name: string;
    args: Record<string, unknown>;
  }[];
  error?: string;
}

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
export async function jsonCompletion<T extends object>(
  action: string,
  thread: Content[] | string,
  input: string | object,
  schema: ZodType<T>,
  { context, tools, model = "gemini-2.0-flash-lite" }: CompletionOptions = {}
): Promise<CompletionResponse<T>> {
  // Start thread from initial developer prompt
  if (typeof thread === "string") {
    thread = [createContent(thread)];
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
  thread: Content[],
  input: string,
  schema: ZodType<T>,
  context: Context[],
  tools: Tool[]
): Promise<CompletionResponse<T>> {
  let attempt = 0;
  const [systemPrompt, ...restOfThread] = thread;
  const messages = createMessages(restOfThread, input, context);
  const newThread = [systemPrompt!, ...messages];

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

  const body = {
    model,
    contents: messages,
    config: {
      systemInstruction: systemPrompt,
      //responseMimeType: "application/json",
      //responseSchema: zodToOpenAPISchema(schema),
      toolConfig: {
        functionCallingConfig: {
          mode: FunctionCallingConfigMode.ANY,
        },
      },
      tools: tools.map(toolToGeminiTool),
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
export function getClient() {
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

// #region Object Creation

function toolToGeminiTool({ name, description, parameters }: Tool) {
  return {
    functionDeclarations: [
      {
        name,
        description,
        parameters: parameters
          ? (toJSONSchema(parameters) as Record<string, unknown>)
          : undefined,
      },
    ],
  };
}

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

    const [functionCall] = completion.functionCalls ?? [];

    if (functionCall && functionCall.name !== "response") {
      const { name, args } = functionCall;

      return !name
        ? { error: "Function call returned, but name is empty" }
        : {
            toolCalls: [
              {
                name,
                args: args ?? {},
              },
            ],
            thread: [...thread, content],
          };
    }

    /*
    https://github.com/google-gemini/cookbook/issues/393
    Gemini API refuses requests for "JSON response OR tool call"
    The request must be either for "JSON response" or "freeform response OR tool call".

    As a workaround, we forced the response to be a tool call.
    We should never receive raw text.
    */
    //const rawText = completion.text;
    //if (rawText) {
    //  const parsed = JSON.parse(rawText);
    if (functionCall?.name === "response") {
      const moreParsed = schema.parse(functionCall.args);

      return {
        content: moreParsed,
        thread: [...thread, content],
      };
    }

    return { error: "Finish reason STOP, but no text provided" };
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

    const blob: Record<string, unknown> = {
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

    const dense: Record<string, unknown> = {
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

    const metrics: Record<string, number> = {};
    [
      "tokens",
      "inTokens",
      "outTokens",
      "cacheTokens",
      "thoughtTokens",
      "toolTokens",
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
