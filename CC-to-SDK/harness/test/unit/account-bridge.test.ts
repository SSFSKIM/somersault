// test/unit/account-bridge.test.ts — F10 T-MAINT item 1: the carrier for the LIVE `accountInfo()`
// promise the banner's 1500 ms race throws away. Deliberately timer-free — the deadline is the
// reader's (useChat's), because only the reader knows when its own clock started.
import { describe, it, expect } from "vitest";
import { createAccountBridge } from "../../src/tui/accountBridge.js";

describe("createAccountBridge", () => {
  it("resolves undefined when nothing was ever offered — `ccx attach` has no handshake to wait for", async () => {
    await expect(createAccountBridge().read()).resolves.toBeUndefined();
  });

  it("delivers the offered facts, and delivers them to every later read", async () => {
    const bridge = createAccountBridge();
    bridge.offer(Promise.resolve({ apiProvider: "firstParty", tokenSource: "CLAUDE_CODE_OAUTH_TOKEN" }));
    await expect(bridge.read()).resolves.toEqual({ apiProvider: "firstParty", tokenSource: "CLAUDE_CODE_OAUTH_TOKEN" });
    await expect(bridge.read()).resolves.toEqual({ apiProvider: "firstParty", tokenSource: "CLAUDE_CODE_OAUTH_TOKEN" });
  });

  it("swallows a rejection AT OFFER TIME, so a credential-less host cannot produce an unhandled rejection on a path nobody reads", async () => {
    const seen: unknown[] = [];
    const onUnhandled = (r: unknown) => seen.push(r);
    process.on("unhandledRejection", onUnhandled);
    try {
      const bridge = createAccountBridge();
      bridge.offer(Promise.reject(new Error("no credentials")));
      await new Promise((r) => setTimeout(r, 20));       // past the tick a stray rejection would surface on
      expect(seen).toEqual([]);
      await expect(bridge.read()).resolves.toBeUndefined();
    } finally { process.off("unhandledRejection", onUnhandled); }
  });

  it("a read taken BEFORE the offer settles still gets the answer", async () => {
    const bridge = createAccountBridge();
    let settle!: (f: { tokenSource: string }) => void;
    bridge.offer(new Promise((r) => { settle = r; }));
    const pending = bridge.read();
    settle({ tokenSource: "ANTHROPIC_API_KEY" });
    await expect(pending).resolves.toEqual({ tokenSource: "ANTHROPIC_API_KEY" });
  });
});
