import type { CreateEmbeddingResponse } from "openai/resources";
import type {
  Tool as OpenAITool,
  ParsedResponse,
  ResponseInputItem,
  Responses,
  ResponseTextConfig,
} from "openai/resources/responses/responses";
import z, { toJSONSchema, type ZodType } from "zod";
import { initBagger } from "./bagUtils.ts";
import type {
  Bag,
  CompletionOptions,
  CompletionResponse,
  EmbeddingResponse,
  Tool,
} from "./types.ts";

const DEFAULT_MODEL = "gpt-5-nano";

export function toCompleteOptions(
  options: CompletionOptions,
): Required<CompletionOptions> {
  return {
    context: options.context ?? [],
    tools: options.tools ?? [],
    model: options.model ?? DEFAULT_MODEL,
    reasoningEffort: options.reasoningEffort ?? null,
    preferFlexProcessing: !!options.preferFlexProcessing,
  };
}

export function toLogOptions(options: Required<CompletionOptions>): [Bag, Bag] {
  const result: Bag = {};
  const bagger = initBagger(options, result);

  bagger("model");
  bagger("reasoningEffort");
  bagger("preferFlexProcessing");

  const dResult: Bag = { ...result };
  const dBagger = initBagger(options, dResult);

  bagger("context");
  dBagger("context", "contextCount", (context) => context.length);

  bagger("tools", "tools", (tools) => tools.map((t) => t.name).join(","));

  return [result, dResult];
}

export function createMessages(
  thread: ResponseInputItem[],
  input: string,
  { context = [] }: CompletionOptions,
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

export function toCompletionRequestBody<T extends object>(
  action: string,
  messages: ResponseInputItem[],
  schema: ZodType<T>,
  {
    tools,
    model,
    reasoningEffort,
    preferFlexProcessing,
  }: Required<CompletionOptions>,
): Parameters<Responses["parse"]>[0] {
  return {
    model,
    input: messages,
    text: getTextFormat(action, schema),
    tools: tools.map((tool) => toolToOpenAITool(tool)),
    reasoning:
      reasoningEffort == null ? undefined : { effort: reasoningEffort },
    service_tier: preferFlexProcessing ? ("flex" as const) : undefined,
  };
}

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
  const outputs = completion.output.filter(
    (x) =>
      x.type === "message" ||
      x.type === "function_call" ||
      x.type === "reasoning",
  );

  for (const output of outputs) {
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

  result.thread = [...thread, ...outputs];
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
