export interface TurnBufferOpts { maxMessages: number; maxBytes: number }

/** The current turn, kept in memory so a client that attaches mid-turn sees it from the start rather
 *  than from the moment it connected. Bounded on both counts because this lives in a detached process
 *  that may run for hours: a message cap alone loses to one enormous tool result, a byte cap alone
 *  loses to a flood of tiny stream deltas. */
export class TurnBuffer {
  private messages: unknown[] = [];
  private sizes: number[] = [];
  private bytes = 0;
  private truncated = false;

  constructor(private opts: TurnBufferOpts) {}

  push(m: unknown): void {
    const size = JSON.stringify(m)?.length ?? 0;
    this.messages.push(m); this.sizes.push(size); this.bytes += size;
    // `length > 1` on the byte trim: a lone message over the cap is kept. Replaying one oversized
    // message is a worse view than replaying all of them, but replaying NOTHING is worse than both,
    // and that is what an unguarded while-loop produces for a single 2 MiB tool result.
    while (this.messages.length > this.opts.maxMessages
      || (this.bytes > this.opts.maxBytes && this.messages.length > 1)) {
      this.messages.shift(); this.bytes -= this.sizes.shift() ?? 0; this.truncated = true;
    }
  }

  snapshot(): { messages: unknown[]; truncated: boolean } {
    return { messages: [...this.messages], truncated: this.truncated };
  }

  reset(): void { this.messages = []; this.sizes = []; this.bytes = 0; this.truncated = false; }
}
