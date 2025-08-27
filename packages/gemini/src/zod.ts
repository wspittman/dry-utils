import { z } from "zod";
import type { JSONSchema } from "zod/v4/core";

type ZObj = Record<string, z.ZodType>;
type ZBoolean = z.ZodNullable<z.ZodBoolean>;
type ZNumber = z.ZodNullable<z.ZodNumber>;
type ZString = z.ZodNullable<z.ZodString>;
type ZEnum<T extends readonly [string, ...string[]]> = z.ZodNullable<
  z.ZodEnum<{ [k in T[number]]: k }>
>;

/** Creates a nullable boolean Zod schema with a description. */
export const zBoolean = (desc: string): ZBoolean =>
  z.boolean().nullable().describe(desc);

/**
 * Creates a nullable enum Zod schema with a description.
 * Enum MUST be defined as `const test = ["a", "b", "c"] as const;`. The "as const" is real important.
 */
export const zEnum = <T extends readonly [string, ...string[]]>(
  desc: string,
  v: T
): ZEnum<T> => z.enum(v).nullable().describe(desc);

/** Creates a nullable number Zod schema with a description. */
export const zNumber = (desc: string): ZNumber =>
  z.number().nullable().describe(desc);

/** Creates a nullable string Zod schema with a description. */
export const zString = (desc: string): ZString =>
  z.string().nullable().describe(desc);

/** Creates a Zod object schema with a description. */
export const zObj = <T extends ZObj>(
  desc: string,
  schema: T
): ReturnType<typeof z.object<T>> => z.object(schema).describe(desc);

/** Creates a Zod array schema containing objects, with a description. */
export const zObjArray = <T extends ZObj>(
  desc: string,
  schema: T
): ReturnType<typeof z.array> => z.array(z.object(schema)).describe(desc);

export const toJSONSchema = (schema: z.ZodType): JSONSchema.BaseSchema =>
  z.toJSONSchema(schema, {
    target: "openapi-3.0",
  });
