import assert from "node:assert/strict";
import type { EmbeddingCreateParams } from "openai/resources";

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
  customModel: mp({ model: "text-embedding-3-small-custom" }),
  dimensions: mp({ dimensions: 16 }),
  singleArray: mp({ input: ["solo"] }),
};

export function validateEmbedAPIParams(
  actual: EmbeddingCreateParams,
  used: EmbedParams,
): void {
  const inputs = Array.isArray(used.input) ? used.input : [used.input];
  assert.equal(actual.model, used.model ?? "text-embedding-3-small", "model");
  assert.deepEqual(actual.input, inputs, "input");
  if (used.dimensions) {
    assert.equal(actual.dimensions, used.dimensions, "dimensions");
  } else {
    assert.equal(actual.dimensions, undefined);
  }
}
