import { externalLog, type LogOptions } from "./externalLog.ts";

export { batch } from "./batch.ts";

export function setAsyncLogging(options: LogOptions): void {
  externalLog.setFn("Async", options);
}
