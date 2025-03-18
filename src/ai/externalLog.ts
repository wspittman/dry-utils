import {
  AggregatorLogOptions,
  ExternalAggregatorLog,
} from "../internal/externalLog";

export type LogOptions = AggregatorLogOptions;
export const externalLog = new ExternalAggregatorLog();
