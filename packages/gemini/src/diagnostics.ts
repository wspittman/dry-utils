import { channel, subscribe, type Channel } from "node:diagnostics_channel";

/*
Just copy/paste this file to other libraries.
No ROI in trying to refactor to some kind of shared space.
On the rare occasion of edits, update other diagnostics.ts files.
*/

const GEMINI_LOG_CHANNEL = "dry-utils-gemini";
const GEMINI_ERR_CHANNEL = "dry-utils-gemini-err";
const GEMINI_AGG_CHANNEL = "dry-utils-gemini-agg";

interface LogData {
  tag: string;
  val: unknown;
}

interface AggregateData {
  tag: string;
  blob: Record<string, unknown>;
  dense: Record<string, unknown>;
  metrics: Record<string, number>;
}

interface Subscriber {
  log?: (message: LogData) => void;
  error?: (message: LogData) => void;
  aggregate?: (message: AggregateData) => void;
}

/**
 * Diagnostic logging utility.
 * Publishes logs to node:diagnostics channels.
 */
class Diagnostics {
  private logChannel: Channel;
  private errChannel: Channel;
  private aggChannel: Channel;

  constructor() {
    this.logChannel = channel(GEMINI_LOG_CHANNEL);
    this.errChannel = channel(GEMINI_ERR_CHANNEL);
    this.aggChannel = channel(GEMINI_AGG_CHANNEL);
  }

  log(tag: string, val: unknown): void {
    if (this.logChannel.hasSubscribers) {
      this.logChannel.publish({ tag, val });
    }
  }

  error(tag: string, val: unknown): void {
    if (this.errChannel.hasSubscribers) {
      this.errChannel.publish({ tag, val });
    }
  }

  aggregate(
    tag: string,
    blob: Record<string, unknown>,
    dense: Record<string, unknown>,
    metrics: Record<string, number>
  ): void {
    if (this.aggChannel.hasSubscribers) {
      this.aggChannel.publish({ tag, blob, dense, metrics });
    }
  }
}

// Singleton Export
export const diag: Diagnostics = new Diagnostics();

function toLogData(message: unknown): LogData {
  if (message && typeof message === "object" && "tag" in message) {
    return message as LogData;
  }
  return { tag: "unknown", val: message };
}

function toAggregateData(message: unknown): AggregateData {
  if (
    message &&
    typeof message === "object" &&
    "tag" in message &&
    "blob" in message &&
    "dense" in message &&
    "metrics" in message
  ) {
    return message as AggregateData;
  }
  return { tag: "unknown", blob: {}, dense: {}, metrics: {} };
}

export function subscribeGeminiLogging({
  log,
  error,
  aggregate,
}: Subscriber): void {
  if (log) {
    subscribe(GEMINI_LOG_CHANNEL, (x) => log(toLogData(x)));
  }

  if (error) {
    subscribe(GEMINI_ERR_CHANNEL, (x) => error(toLogData(x)));
  }

  if (aggregate) {
    subscribe(GEMINI_AGG_CHANNEL, (x) => aggregate(toAggregateData(x)));
  }
}
