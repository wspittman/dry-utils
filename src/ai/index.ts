import { externalLog, LogOptions } from "./externalLog";

export function setAILogging(options: LogOptions) {
  externalLog.setFn("AI", options);
}
