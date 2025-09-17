import { channel, subscribe, type Channel } from "node:diagnostics_channel";

/*
Just copy/paste this file to other libraries.
No ROI in trying to refactor to some kind of shared space.
On the rare occasion of edits, update other diagnostics.ts files.
*/

const ASYNC_LOG_CHANNEL = "dry-utils-async";
const ASYNC_ERR_CHANNEL = "dry-utils-async-err";

interface LogData {
  tag: string;
  val: unknown;
}

interface Subscriber {
  log?: (message: LogData) => void;
  error?: (message: LogData) => void;
}

/**
 * Diagnostic logging utility.
 * Publishes logs to node:diagnostics channels.
 */
class Diagnostics {
  private logChannel: Channel;
  private errChannel: Channel;

  constructor() {
    this.logChannel = channel(ASYNC_LOG_CHANNEL);
    this.errChannel = channel(ASYNC_ERR_CHANNEL);
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
}

// Singleton Export
export const diag: Diagnostics = new Diagnostics();

function toLogData(message: unknown): LogData {
  if (message && typeof message === "object" && "tag" in message) {
    return message as LogData;
  }
  return { tag: "unknown", val: message };
}

export function subscribeAsyncLogging({ log, error }: Subscriber): void {
  if (log) {
    subscribe(ASYNC_LOG_CHANNEL, (x) => log(toLogData(x)));
  }

  if (error) {
    subscribe(ASYNC_ERR_CHANNEL, (x) => error(toLogData(x)));
  }
}
