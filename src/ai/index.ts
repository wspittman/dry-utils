import { externalLog, LogOptions } from "./externalLog";

export { jsonCompletion, proseCompletion } from "./openai";
export { zBoolean, zEnum, zNumber, zObj, zObjArray, zString } from "./zod";

export function setAILogging(options: LogOptions) {
  externalLog.setFn("AI", options);
}
