import type { EmbedContentParameters } from "@google/genai";
import assert from "node:assert/strict";

/**
 * Flattened parameters for calling embed in tests
 */
export interface EmbedParams {
  action: string;
  input: string | string[];

  // Embedding Options
  model?: string;
  dimensions?: number;
}

const defaultParams: EmbedParams = {
  action: "embedTest",
  input: "hello world",
};

const mp = (x: Partial<EmbedParams>) => ({ ...defaultParams, ...x });

export const EmbedParamTemplates: Record<string, EmbedParams> = {
  default: defaultParams,
  arrayInput: mp({ input: ["alpha", "beta"] }),
  customModel: mp({ model: "gemini-embedding-001-custom" }),
  dimensions: mp({ dimensions: 16 }),
  singleArray: mp({ input: ["solo"] }),
};

export function validateEmbedAPIParams(
  actual: EmbedContentParameters,
  used: EmbedParams,
): void {
  const inputs = Array.isArray(used.input) ? used.input : [used.input];
  assert.equal(actual.model, used.model ?? "gemini-embedding-001", "model");
  assert.deepEqual(actual.contents, inputs, "contents");
  if (used.dimensions) {
    assert.equal(
      actual.config?.outputDimensionality,
      used.dimensions,
      "config.outputDimensionality",
    );
  } else {
    assert.equal(actual.config?.outputDimensionality, undefined);
  }
}
