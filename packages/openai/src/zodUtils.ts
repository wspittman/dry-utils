import { z } from "zod";
import type { JSONSchema } from "zod/v4/core";

export const toJSONSchema = (schema: z.ZodType): JSONSchema.BaseSchema =>
  z.toJSONSchema(schema, { target: "openapi-3.0" });

export const proseSchema: z.ZodObject<{ content: z.ZodNullable<z.ZodString> }> =
  z
    .object({
      content: z.string().nullable().describe("The completion content"),
    })
    .describe("A wrapper around the completion content");
