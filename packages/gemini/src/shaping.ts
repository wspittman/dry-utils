import type {
  Content,
  EmbedContentResponse,
  Tool as GeminiTool,
  GenerateContentResponse,
} from "@google/genai";
import type { ZodType } from "zod";
import type {
  Bag,
  CompletionResponse,
  Context,
  EmbeddingResponse,
  Tool,
} from "./types.ts";
import { toJSONSchema } from "./zodUtils.ts";

export function toolToGeminiTool({
  name,
  description,
  parameters,
}: Tool): GeminiTool {
  return {
    functionDeclarations: [
      {
        name,
        description,
        parameters: parameters ? (toJSONSchema(parameters) as Bag) : undefined,
      },
    ],
  };
}

export function createMessages(
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

export function createContent(text: string, role: string = "user"): Content {
  return {
    role,
    parts: [{ text }],
  };
}

export function completionToResponse<T>(
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

export function embeddingToResponse({
  embeddings,
}: EmbedContentResponse): EmbeddingResponse {
  if (!embeddings || embeddings.length === 0) {
    return { error: "Gemini Embedding Empty Response" };
  }

  return { embeddings: embeddings?.map((entry) => entry.values ?? []) };
}
