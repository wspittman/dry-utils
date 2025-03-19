import { externalLog, LogOptions } from "./externalLog";

export { jsonCompletion, proseCompletion } from "./openai";

export function setAILogging(options: LogOptions) {
  externalLog.setFn("AI", options);
}
