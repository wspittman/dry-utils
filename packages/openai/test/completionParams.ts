import assert from "node:assert/strict";
import {
  type ResponseCreateParams,
  type ResponseInputItem,
} from "openai/resources/responses/responses";
import { z, ZodType } from "zod";
import {
  type CompletionOptions,
  type Context,
  type Tool,
} from "../src/openai.ts";
import { proseSchema, toJSONSchema } from "../src/zodUtils.ts";

/**
 * Flattened parameters for calling jsonCompletion or proseCompletion in tests
 */
export interface CompletionParams {
  action: string;
  thread: ResponseInputItem[] | string;
  input: string | object;

  // jsonCompletion only
  schema: z.ZodObject;

  // Completion Options
  context?: CompletionOptions["context"];
  tools?: Tool[];
  model?: string;
}

const defaultParams: CompletionParams = {
  action: "test",
  thread: "system prompt",
  input: "user input",
  schema: proseSchema,
};

const fullThread: ResponseInputItem[] = [
  { role: "developer", content: "system prompt" },
  { role: "user", content: "user input" },
  {
    id: "rs_68b0a7bfbdec819089297fac49dba44c07a2bc259d9e1681",
    type: "reasoning",
    summary: [],
  },
  {
    id: "msg_68b0a7bfbdec819089297fac49dba44c07a2bc259d9e1681",
    type: "message",
    status: "completed",
    content: [
      {
        type: "output_text",
        annotations: [],
        logprobs: [],
        text: '{"content":"complete"}',
      },
    ],
    role: "assistant",
  },
];

const fullTools: Tool[] = [
  { name: "tool1", description: "desc1" },
  {
    name: "tool2",
    description: "desc2",
    parameters: z.object({ a: z.string() }).describe("Tool 2 params"),
  },
];

const mp = (x: Partial<CompletionParams>) => ({ ...defaultParams, ...x });

/**
 * Templates for parameters that should cause an error
 */
export const ParamErrorTemplates: Record<string, CompletionParams> = {
  actionEmpty: mp({ action: "" }),
  actionBadFormat: mp({ action: "bad action format" }),
};

/**
 * Templates for valid parameters
 */
export const ParamTemplates: Record<string, CompletionParams> = {
  default: defaultParams,
  threadStringEmpty: mp({ thread: "" }),
  threadArrayEmpty: mp({ thread: [] }),
  threadOne: mp({ thread: fullThread.slice(0, 1) }),
  threadTwo: mp({ thread: fullThread.slice(0, 2) }),
  threadFull: mp({ thread: fullThread }),
  inputStringEmpty: mp({ input: "" }),
  inputObjectEmpty: mp({ input: {} }),
  inputObject: mp({ input: { key1: "value1", key2: "value2" } }),
  schemaMinimal: mp({ schema: z.object({}).describe("Empty object") }),
  contextEmpty: mp({ context: [] }),
  contextOne: mp({ context: [{ description: "desc1", content: { a: 1 } }] }),
  contextTwo: mp({
    context: [
      { description: "desc1", content: { a: 1 } },
      { description: "desc2", content: { b: 2 } },
    ],
  }),
  toolsEmpty: mp({ tools: [] }),
  toolsOne: mp({ tools: fullTools.slice(0, 1) }),
  toolsFull: mp({ tools: fullTools }),
  model: mp({ model: "gpt-5-fake" }),
};

/**
 * Validate the parameters sent to OpenAI's API
 * @param actual The actual parameters sent to OpenAI's API
 * @param used The parameters sent to jsonCompletion or proseCompletion
 */
export function validateAPIParams(
  actual: ResponseCreateParams,
  used: CompletionParams
): void {
  const { action, thread, input, schema, context, tools, model } = used;

  const fullThread: ResponseInputItem[] =
    typeof thread === "string"
      ? [{ role: "developer", content: thread }]
      : thread;

  const fullInput = typeof input === "string" ? input : JSON.stringify(input);

  assert.equal(actual.model, model ?? "gpt-5-nano", "model");
  assert.deepEqual(
    actual.input,
    createMessages(fullThread, fullInput, context ?? []),
    "input"
  );
  assert.deepEqual(actual.text, getTextFormat(action, schema), "text");
  assert.deepEqual(
    actual.tools,
    tools?.map((x) => toolToOpenAITool(x)) ?? [],
    "tools"
  );
}

// #region Reformatting Helpers, copy/pasted from openai.ts

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
  const defaultParams = parameters ?? z.object({}).describe("No parameters");

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

// #endregion
