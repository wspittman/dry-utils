import { externalLog, LogOptions } from "./externalLog.ts";

export { jsonCompletion, proseCompletion } from "./openai.ts";
export { zBoolean, zEnum, zNumber, zObj, zObjArray, zString } from "./zod.ts";

export function setAILogging(options: LogOptions) {
  externalLog.setFn("AI", options);
}
