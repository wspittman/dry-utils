import {
  ExternalLog,
  LogOptions as InternalLogOptions,
} from "../internal/externalLog.ts";

export type LogOptions = InternalLogOptions;
export const externalLog = new ExternalLog();
