import { externalLog, type LogOptions } from "./externalLog.ts";

export { z } from "zod";
export { jsonCompletion, proseCompletion } from "./openai.ts";
export { zBoolean, zEnum, zNumber, zObj, zObjArray, zString } from "./zod.ts";

export function setAILogging(options: LogOptions): void {
  externalLog.setFn("OpenAI", options);
}
