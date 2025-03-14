import {
  ExternalLog,
  LogOptions as InternalLogOptions,
} from "../internal/externalLog";

export type LogOptions = InternalLogOptions;
export const externalLog = new ExternalLog();
