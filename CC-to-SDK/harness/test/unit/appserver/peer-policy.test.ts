// test/unit/appserver/peer-policy.test.ts — the policy's doors. The property under test is not "the key
// is set" but "nothing else can decide it": not a settings file on disk, not a client's escape hatch, not
// the generic settings RPC, and not an engine swap. Every case that admits a thread runs against BOTH
// admission spines, because thread/start and thread/resume are different functions in this server
// (`createThread` and `startThread`) and a policy that only one of them applies is a policy.
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyPeerPolicy, DEFAULT_INBOUND, SETTINGS_KEY } from "../../../src/appserver/peerPolicy.js";
import { swapBaseConfig } from "../../../src/appserver/rewind.js";
import { AppServer } from "../../../src/appserver/server.js";
import { ERR } from "../../../src/appserver/rpc.js";
import type { PeerSink } from "../../../src/appserver/peer.js";

const settingsOf = (c: Record<string, unknown>) => c.settings as Record<string, unknown>;

describe("applyPeerPolicy", () => {
  it("defaults to refuse and always writes the key explicitly", () => {
    expect(DEFAULT_INBOUND).toBe("refuse");
    // Explicitly, never by omission: the CLI's own default for an absent key is not this server's to
    // assume, and probe 117 measured that an EXPLICIT value beats mode parity in both directions.
    expect(settingsOf(applyPeerPolicy({}, "refuse"))[SETTINGS_KEY]).toBe("refuse");
    expect(settingsOf(applyPeerPolicy(undefined, "accept"))[SETTINGS_KEY]).toBe("accept");
  });

  it("passes --replay-user-messages on EVERY thread, including a refusing one", () => {
    // The flag is what makes a peer message VISIBLE in the stream at all. A refusing thread still needs
    // it: `refuse` is measured by observing that nothing arrives, and an invisible stream cannot
    // distinguish "refused" from "never sent".
    for (const v of ["accept", "hold", "refuse"] as const) {
      expect((applyPeerPolicy({}, v).extraArgs as Record<string, unknown>)["replay-user-messages"]).toBeNull();
    }
  });

  it("MERGES a client's settings rather than dropping them", () => {
    const out = applyPeerPolicy({ settings: { autoCompactEnabled: true, [SETTINGS_KEY]: "accept" } }, "refuse");
    expect(settingsOf(out)).toEqual({ autoCompactEnabled: true, [SETTINGS_KEY]: "refuse" });
  });

  it("overrides the key in every OBJECT carrier a client can reach", () => {
    const out = applyPeerPolicy({
      settings: { [SETTINGS_KEY]: "accept" },
      extraArgs: { settings: JSON.stringify({ [SETTINGS_KEY]: "accept" }) },
      extraOptions: {
        settings: { [SETTINGS_KEY]: "accept" },
        extraArgs: { settings: JSON.stringify({ [SETTINGS_KEY]: "accept" }) },
      },
    }, "refuse");
    expect(settingsOf(out)[SETTINGS_KEY]).toBe("refuse");
    expect(JSON.parse((out.extraArgs as Record<string, string>).settings)[SETTINGS_KEY]).toBe("refuse");
    const hatch = out.extraOptions as Record<string, Record<string, string>>;
    expect(hatch.settings[SETTINGS_KEY]).toBe("refuse");
    expect(JSON.parse(hatch.extraArgs.settings)[SETTINGS_KEY]).toBe("refuse");
  });

  it("handles the equals-encoding of an argv settings key", () => {
    const out = applyPeerPolicy({ extraArgs: { "settings={\"crossSessionInbound\":\"accept\"}": null } }, "refuse");
    const args = out.extraArgs as Record<string, unknown>;
    const key = Object.keys(args).find((k) => k.startsWith("settings"));
    const json = key!.includes("=") ? key!.slice(key!.indexOf("=") + 1) : String(args[key!]);
    expect(JSON.parse(json)[SETTINGS_KEY]).toBe("refuse");
  });

  // THE HOLE THE SDK's OWN TYPE OPENS. `Options.settings` is `string | Settings`
  // (node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts), and a string there is a PATH to a settings
  // file on disk — not JSON this server could rewrite. `resolveOptions` spreads `extraOptions` last, so an
  // admitted path would replace the whole settings object, `crossSessionInbound` included. A path cannot
  // be sanitized without rewriting somebody else's file, so it is REFUSED instead.
  it("refuses a settings carrier this server cannot sanitize", () => {
    for (const carrier of [
      { extraOptions: { settings: "/tmp/mine.json" } },
      { extraOptions: { settings: 7 } },
      { extraOptions: { settings: null } },
      { settings: "/tmp/mine.json" },
    ]) {
      let code: number | undefined;
      try { applyPeerPolicy(carrier, "refuse"); } catch (e) { code = (e as { code?: number }).code; }
      expect(code).toBe(ERR.INVALID_PARAMS);
    }
  });

  it("refuses an unparseable argv settings string rather than discarding it", () => {
    // Discarding it would silently drop settings the client asked for; admitting it would admit an
    // unsanitizable carrier. Refusing is the only answer that is true to both.
    let code: number | undefined;
    try { applyPeerPolicy({ extraArgs: { settings: "{not json" } }, "refuse"); } catch (e) { code = (e as { code?: number }).code; }
    expect(code).toBe(ERR.INVALID_PARAMS);
  });

  it("strips a client-supplied replay-user-messages, which is ours now", () => {
    const out = applyPeerPolicy({ extraArgs: { "replay-user-messages": "no" } }, "refuse");
    expect((out.extraArgs as Record<string, unknown>)["replay-user-messages"]).toBeNull();
  });

  it("leaves every other config key alone", () => {
    const out = applyPeerPolicy({ model: "opus", extraArgs: { verbose: null } }, "hold");
    expect(out.model).toBe("opus");
    expect((out.extraArgs as Record<string, unknown>).verbose).toBeNull();
  });

  // DURABILITY, stated where it is actually enforced. Every replacement engine in this server is built
  // from `swapBaseConfig(record.config)`; a policy that survives that function survives all four swaps at
  // once, and this asserts the composition rather than trusting four call sites to remember.
  it("survives swapBaseConfig, which is what every replacement engine is built from", () => {
    const admitted = applyPeerPolicy({ model: "opus" }, "accept");
    const replacement = swapBaseConfig(admitted);
    expect(settingsOf(replacement)[SETTINGS_KEY]).toBe("accept");
    expect((replacement.extraArgs as Record<string, unknown>)["replay-user-messages"]).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------
// The wire half — both spines, one loop.

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const send = (c: { feed(ch: string): void }, obj: object) => c.feed(JSON.stringify(obj) + "\n");
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l));
const replyTo = (lines: string[], id: number) => parsed(lines).find((f) => f.id === id);
const tick = () => new Promise((r) => setTimeout(r, 0));

/** The house fake, copied from settings.test.ts's `fakeSession`: every setter is `async` exactly where the
 *  real EngineSession is, so a chain-ordering assertion cannot pass by synchronicity. */
const fakeEngine = () => ({
  submit: async () => ({ result: {} }),
  interrupt: async () => ({}),
  dispose: async () => {},
  onFrame: () => () => {},
  sessionId: undefined,
  setModel: async () => {},
  setPermissionMode: async () => {},
  setMaxThinkingTokens: async () => {},
  applyFlagSettings: async () => {},
});

/** One throwaway archive-marker root for this whole file: `thread/resume` ends in `autoUnarchive`, which
 *  reads the marker directory — resolved as `deps.ccxDir ?? fleetRoot()`, i.e. the operator's real
 *  ~/.claude/ccx without this. */
const fileCcxDir = mkdtempSync(join(tmpdir(), "m8ccx-peer-policy-"));
afterAll(() => { rmSync(fileCcxDir, { recursive: true, force: true }); });

const boot = (sessionFactory: (cfg: Record<string, unknown>) => unknown) => {
  const srv = new AppServer({}, { ccxDir: fileCcxDir, listSessions: async () => [], sessionFactory: sessionFactory as never });
  const { lines, sink } = mkSink();
  const c = srv.connect(sink);
  send(c, { id: 1, method: "initialize", params: { clientInfo: { name: "t" } } });
  return { srv, lines, c };
};

/** Both admission spines, described the way a test can drive them. `thread/start` and `thread/resume`
 *  are separate functions (server.ts's `createThread` and `startThread`), and every policy assertion
 *  below runs against both — a policy only one spine applies is the defect this table exists to catch. */
const SPINES = [
  { name: "thread/start", method: "thread/start", extra: {} as Record<string, unknown> },
  { name: "thread/resume", method: "thread/resume", extra: { sessionId: "11111111-1111-4111-8111-111111111111" } },
];

describe("crossSessionInbound at admission", () => {
  for (const spine of SPINES) {
    it(`${spine.name} defaults to refuse, records it, and publishes it on the thread view`, async () => {
      const seen: Record<string, unknown>[] = [];
      const { srv, lines, c } = boot((cfg) => { seen.push(cfg); return fakeEngine(); });
      send(c, { id: 2, method: spine.method, params: { ...spine.extra } });
      await tick(); await tick();
      expect((seen[0].settings as Record<string, unknown>)[SETTINGS_KEY]).toBe("refuse");
      const reply = replyTo(lines, 2);
      expect(reply.error).toBeUndefined();
      expect(reply.result.thread.crossSessionInbound).toBe("refuse");
      // The record and the config it mirrors are one fact, written together (peerPolicy.ts's header).
      const record = srv.registry.get(reply.result.thread.id)!;
      expect(record.crossSessionInbound).toBe("refuse");
      expect((record.config!.settings as Record<string, unknown>)[SETTINGS_KEY]).toBe("refuse");
    });

    it(`${spine.name} honors an explicit accept, and the thread view reports it`, async () => {
      const seen: Record<string, unknown>[] = [];
      const { srv, lines, c } = boot((cfg) => { seen.push(cfg); return fakeEngine(); });
      send(c, { id: 2, method: spine.method, params: { ...spine.extra, crossSessionInbound: "accept" } });
      await tick(); await tick();
      expect((seen[0].settings as Record<string, unknown>)[SETTINGS_KEY]).toBe("accept");
      const thread = replyTo(lines, 2).result.thread;
      expect(thread.crossSessionInbound).toBe("accept");
      expect(srv.registry.get(thread.id)!.crossSessionInbound).toBe("accept");
    });

    it(`${spine.name} refuses a settings carrier it cannot sanitize, as -32602 rather than -32603`, async () => {
      const { srv, lines, c } = boot(() => fakeEngine());
      send(c, { id: 2, method: spine.method, params: { ...spine.extra, config: { extraOptions: { settings: "/tmp/mine.json" } } } });
      await tick(); await tick();
      // -32602 and not the generic internal error: a request the client can fix must say so, and the
      // resume spine is `async`, so its refusal takes a different path out to dispatch's catch.
      expect(replyTo(lines, 2).error.code).toBe(ERR.INVALID_PARAMS);
      // Refused before anything was minted.
      expect(srv.registry.list()).toEqual([]);
    });

    it(`${spine.name} refuses a value that is not one of the three`, async () => {
      const { lines, c } = boot(() => fakeEngine());
      send(c, { id: 2, method: spine.method, params: { ...spine.extra, crossSessionInbound: "maybe" } });
      await tick(); await tick();
      expect(replyTo(lines, 2).error.code).toBe(ERR.INVALID_PARAMS);
    });
  }

  it("thread/settings/apply cannot reach the reserved key", async () => {
    const { lines, c } = boot(() => fakeEngine());
    send(c, { id: 2, method: "thread/start", params: {} });
    await tick(); await tick();
    const threadId = replyTo(lines, 2).result.thread.id;
    send(c, { id: 3, method: "thread/settings/apply", params: { threadId, settings: { [SETTINGS_KEY]: "accept" } } });
    await tick(); await tick();
    expect(replyTo(lines, 3).error.code).toBe(ERR.INVALID_PARAMS);
    // …and the ordinary key still goes through, so the reservation is a KEY gate and not a method gate.
    send(c, { id: 4, method: "thread/settings/apply", params: { threadId, settings: { autoCompactEnabled: true } } });
    await tick(); await tick();
    expect(replyTo(lines, 4).result).toEqual({ ok: true });
  });
});
