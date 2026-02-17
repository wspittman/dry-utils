import type { Content, GenerateContentParameters } from "@google/genai";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  createContent,
  createMessages,
  toolToGeminiTool,
} from "../src/shaping.ts";
import type {
  CompletionOptions,
  Context,
  ReasoningEffort,
  Tool,
} from "../src/types.ts";
import { proseSchema } from "../src/zodUtils.ts";

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
  reasoningEffort?: CompletionOptions["reasoningEffort"];
}

const defaultParams: CompletionParams = {
  action: "test",
  thread: "system prompt",
  input: "user input",
  schema: proseSchema,
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
    parameters: z.object({ a: z.string() }).describe("Tool 2 params"),
  },
];

const mp = (x: Partial<CompletionParams>) => ({ ...defaultParams, ...x });

const REASONING_BUDGETS: Record<ReasoningEffort, number> = {
  minimal: 0,
  low: 1024,
  medium: 8192,
  high: 24576,
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
  model: mp({ model: "gemini-2.0-flash-lite-fake" }),
  reasoningMinimal: mp({ reasoningEffort: "minimal" }),
  reasoningLow: mp({ reasoningEffort: "low" }),
  reasoningMedium: mp({ reasoningEffort: "medium" }),
  reasoningHigh: mp({ reasoningEffort: "high" }),
};

/**
 * Validate the parameters sent to Gemini's API
 * @param actual The actual parameters sent to Gemini's API
 * @param used The parameters sent to jsonCompletion or proseCompletion
 */
export function validateAPIParams(
  actual: GenerateContentParameters,
  used: CompletionParams,
): void {
  const { thread, input, schema, context, tools, model, reasoningEffort } =
    used;

  const fullThread: Content[] =
    typeof thread === "string" ? [createContent(thread)] : thread;
  const [systemPrompt, ...restOfThread] = fullThread;
  const isEmptySystemPrompt = !systemPrompt || !systemPrompt.parts?.[0]?.text;

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
    "contents",
  );
  assert.deepEqual(
    actual.config?.systemInstruction,
    isEmptySystemPrompt ? undefined : systemPrompt,
    "config.systemInstruction",
  );
  assert.deepEqual(
    actual.config?.tools,
    toolsWithSchema.map(toolToGeminiTool),
    "config.tools",
  );
  const expectedThinkingBudget =
    reasoningEffort === undefined
      ? undefined
      : REASONING_BUDGETS[reasoningEffort];
  assert.deepEqual(
    actual.config?.thinkingConfig,
    expectedThinkingBudget === undefined
      ? undefined
      : { thinkingBudget: expectedThinkingBudget },
    "config.thinkingConfig",
  );
}
