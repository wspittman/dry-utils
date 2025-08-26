import diagnostics_channel, { type Channel } from "node:diagnostics_channel";

/*
Just copy/paste this file to other libraries.
No ROI in trying to refactor to some kind of shared space.
On the rare occasion of edits, update other diagnostics.ts files.
*/

export const GEMINI_LOG_CHANNEL = "dry-utils-gemini";
export const GEMINI_ERR_CHANNEL = "dry-utils-gemini-err";
export const GEMINI_AGG_CHANNEL = "dry-utils-gemini-agg";

/**
 * Diagnostic logging utility.
 * Publishes logs to node:diagnostics channels.
 */
class Diagnostics {
  private logChannel: Channel;
  private errChannel: Channel;
  private aggChannel: Channel;

  constructor() {
    this.logChannel = diagnostics_channel.channel(GEMINI_LOG_CHANNEL);
    this.errChannel = diagnostics_channel.channel(GEMINI_ERR_CHANNEL);
    this.aggChannel = diagnostics_channel.channel(GEMINI_AGG_CHANNEL);
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
