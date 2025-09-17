import type { Content, GenerateContentParameters } from "@google/genai";
import assert from "node:assert/strict";
import { z } from "zod";
import type { Context, Tool } from "../src/gemini.ts";
import { toJSONSchema, zObj, zString } from "../src/zod.ts";

/**
 * Flattened parameters for calling jsonCompletion or proseCompletion in tests
 */
export interface CompletionParams {
  action: string;
  thread: Content[] | string;
  input: string | object;

  // jsonCompletion only
  schema: z.ZodObject;

  // Completion Options
  context?: Context[];
  tools?: Tool[];
  model?: string;
}

const defaultSchema = zObj("A wrapper around the completion content", {
  content: zString("The completion content"),
});

const defaultParams: CompletionParams = {
  action: "test",
  thread: "system prompt",
  input: "user input",
  schema: defaultSchema,
};

const fullThread: Content[] = [
  { role: "user", parts: [{ text: "system prompt" }] },
  { role: "user", parts: [{ text: "user input" }] },
  {
    parts: [
      {
        functionCall: { name: "response", args: { content: "complete" } },
      },
    ],
    role: "model",
  },
];

const fullTools: Tool[] = [
  { name: "tool1", description: "desc1" },
  {
    name: "tool2",
    description: "desc2",
    parameters: zObj("Tool 2 params", { a: z.string() }),
  },
];

const mp = (x: Partial<CompletionParams>) => ({ ...defaultParams, ...x });

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
  schemaMinimal: mp({ schema: zObj("Empty object", {}) }),
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
  model: mp({ model: "gemini-2.0-flash-lite-fake" }),
};

/**
 * Validate the parameters sent to Gemini's API
 * @param actual The actual parameters sent to Gemini's API
 * @param used The parameters sent to jsonCompletion or proseCompletion
 */
export function validateAPIParams(
  actual: GenerateContentParameters,
  used: CompletionParams
): void {
  const { thread, input, schema, context, tools, model } = used;

  const fullThread: Content[] =
    typeof thread === "string" ? [createContent(thread)] : thread;
  const [systemPrompt, ...restOfThread] = fullThread;

  const fullInput = typeof input === "string" ? input : JSON.stringify(input);

  const toolsWithSchema = [
    ...(tools ?? []),
    {
      name: "response",
      description: "A standard response to the user query. Use as a default.",
      parameters: schema,
    },
  ];

  assert.equal(actual.model, model ?? "gemini-2.0-flash-lite", "model");
  assert.deepEqual(
    actual.contents,
    createMessages(restOfThread, fullInput, context ?? []),
    "contents"
  );
  assert.deepEqual(
    actual.config?.systemInstruction,
    systemPrompt,
    "config.systemInstruction"
  );
  assert.deepEqual(
    actual.config?.tools,
    toolsWithSchema.map(toolToGeminiTool),
    "config.tools"
  );
}

// #region Reformatting Helpers, copy/pasted from gemini.ts

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

// #endregion
