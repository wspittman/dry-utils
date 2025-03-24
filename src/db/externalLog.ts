import {
  AggregatorLogOptions,
  ExternalAggregatorLog,
} from "../internal/externalLog.ts";

export type LogOptions = AggregatorLogOptions;
export const externalLog = new ExternalAggregatorLog();
