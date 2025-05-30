import { z } from "zod";

type ZObj = Record<string, z.ZodType>;
type ZBoolean = z.ZodNullable<z.ZodBoolean>;
type ZNumber = z.ZodNullable<z.ZodNumber>;
type ZString = z.ZodNullable<z.ZodString>;
type ZEnum<T extends z.EnumLike> = z.ZodNullable<z.ZodNativeEnum<T>>;

/** Creates a nullable boolean Zod schema with a description. */
export const zBoolean = (desc: string): ZBoolean =>
  z.boolean().nullable().describe(desc);

/** Creates a nullable enum Zod schema with a description. */
export const zEnum = <T extends z.EnumLike>(v: T, desc: string): ZEnum<T> =>
  z.nativeEnum(v).nullable().describe(describeEnum(v, desc));

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

function describeEnum<T extends z.EnumLike>(v: T, desc: string) {
  if (isStringEnum(v)) {
    return desc;
  }

  // Pipe the full enum description since OpenAI only receives the enum values
  const entries = Object.entries(v)
    // Filter out numeric keys, since TS maps both ways
    .filter(([key]) => isNaN(Number(key)))
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
  return `${desc}. Possible values: [${entries}]`;
}

const isStringEnum = (v: z.EnumLike) =>
  Object.values(v).every((value) => typeof value === "string");
