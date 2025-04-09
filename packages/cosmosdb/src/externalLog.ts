import {
  type AggregatorLogOptions,
  ExternalAggregatorLog,
} from "dry-utils-shared";

export type LogOptions = AggregatorLogOptions;
export const externalLog: ExternalAggregatorLog = new ExternalAggregatorLog();
