import {
  ExternalLog,
  type LogOptions as InternalLogOptions,
} from "../internal/externalLog.ts";

export type LogOptions = InternalLogOptions;
export const externalLog: ExternalLog = new ExternalLog();
