import type { CreateEmbeddingResponse } from "openai/resources";
import type {
  Tool as OpenAITool,
  ParsedResponse,
  ResponseInputItem,
  ResponseTextConfig,
} from "openai/resources/responses/responses";
import z, { toJSONSchema, type ZodType } from "zod";
import type {
  Bag,
  CompletionResponse,
  Context,
  EmbeddingResponse,
  Tool,
} from "./types.ts";

export function getTextFormat<T>(
  action: string,
  schema: ZodType<T>,
): ResponseTextConfig {
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

export function toolToOpenAITool({
  name,
  description,
  parameters,
}: Tool): OpenAITool {
  // Don't use OpenAI's built-in Zod helpers because they don't work with Zod v4

  // Parameters are optional in our Tool type but required by OpenAI
  const defaultParams = parameters ?? z.object({}).describe("No parameters");

  return {
    type: "function" as const,
    name,
    description,
    parameters: toJSONSchema(defaultParams),
    strict: true,
  };
}

export function createMessages(
  thread: ResponseInputItem[],
  input: string,
  context: Context[],
): ResponseInputItem[] {
  return [
    ...thread,
    ...context.map(
      ({ description, content }) =>
        ({
          role: "user",
          content: `Useful context: ${description}\n${JSON.stringify(content)}`,
        }) as ResponseInputItem,
    ),
    { role: "user", content: input },
  ];
}

export function completionToResponse<T>(
  completion: ParsedResponse<T>,
  thread: ResponseInputItem[],
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

      let args = output.parsed_arguments as Bag;

      // I'm seeing an issue where this just repeats the output block for one level nested
      if (
        args &&
        typeof args === "object" &&
        "call_id" in args &&
        "parsed_arguments" in args
      ) {
        args = args["parsed_arguments"] as Bag;
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

export function embeddingToResponse({
  data,
}: CreateEmbeddingResponse): EmbeddingResponse {
  if (!data || data.length === 0) {
    return { error: "OpenAI Embedding Empty Response" };
  }

  return { embeddings: data?.map((entry) => entry.embedding ?? []) };
}
