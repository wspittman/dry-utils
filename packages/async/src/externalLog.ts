import {
  ExternalLog,
  type LogOptions as InternalLogOptions,
} from "@dry-utils/shared";

export type LogOptions = InternalLogOptions;
export const externalLog: ExternalLog = new ExternalLog();
