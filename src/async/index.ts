import { externalLog, LogOptions } from "./externalLog";

export { batch } from "./batch";

export function setAsyncLogging(options: LogOptions) {
  externalLog.setFn("Async", options);
}
