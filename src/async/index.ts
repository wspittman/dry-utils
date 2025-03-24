import { externalLog, LogOptions } from "./externalLog.ts";

export { batch } from "./batch.ts";

export function setAsyncLogging(options: LogOptions) {
  externalLog.setFn("Async", options);
}
