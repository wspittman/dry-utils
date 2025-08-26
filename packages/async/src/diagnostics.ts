import diagnostics_channel, { type Channel } from "node:diagnostics_channel";

/*
Just copy/paste this file to other libraries.
No ROI in trying to refactor to some kind of shared space.
On the rare occasion of edits, update other diagnostics.ts files.
*/

export const ASYNC_LOG_CHANNEL = "dry-utils-async";
export const ASYNC_ERR_CHANNEL = "dry-utils-async-err";

/**
 * Diagnostic logging utility.
 * Publishes logs to node:diagnostics channels.
 */
class Diagnostics {
  private logChannel: Channel;
  private errChannel: Channel;

  constructor() {
    this.logChannel = diagnostics_channel.channel(ASYNC_LOG_CHANNEL);
    this.errChannel = diagnostics_channel.channel(ASYNC_ERR_CHANNEL);
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
