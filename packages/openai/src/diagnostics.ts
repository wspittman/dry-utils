import { channel, type Channel } from "node:diagnostics_channel";

/*
Just copy/paste this file to other libraries.
No ROI in trying to refactor to some kind of shared space.
On the rare occasion of edits, update other diagnostics.ts files.
*/

export const OPENAI_LOG_CHANNEL = "dry-utils-openai";
export const OPENAI_ERR_CHANNEL = "dry-utils-openai-err";
export const OPENAI_AGG_CHANNEL = "dry-utils-openai-agg";

/**
 * Diagnostic logging utility.
 * Publishes logs to node:diagnostics channels.
 */
class Diagnostics {
  private logChannel: Channel;
  private errChannel: Channel;
  private aggChannel: Channel;

  constructor() {
    this.logChannel = channel(OPENAI_LOG_CHANNEL);
    this.errChannel = channel(OPENAI_ERR_CHANNEL);
    this.aggChannel = channel(OPENAI_AGG_CHANNEL);
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
