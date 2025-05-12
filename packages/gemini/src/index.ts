import { externalLog, type LogOptions } from "./externalLog.ts";

export { z } from "zod";
export { jsonCompletion, proseCompletion } from "./gemini.ts";
export { zBoolean, zEnum, zNumber, zObj, zObjArray, zString } from "./zod.ts";

export function setAILogging(options: LogOptions): void {
  externalLog.setFn("Gemini", options);
}
