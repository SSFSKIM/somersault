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
import { ORIGIN_REFUSAL_MESSAGE, emptyFlagPerms, type ThreadRecord } from "../../../src/appserver/registry.js";
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

// ---------------------------------------------------------------------------------------------------
// THE RUNTIME SETTER, WHICH IS A RATCHET.
//
// Probes 120/120b measured all six single flips against a fixed baseline: accept→refuse, accept→hold and
// hold→refuse each changed the disposition of the very next inbound message, while hold→accept,
// refuse→accept and refuse→hold changed nothing at all, in silence. Ordered by permissiveness
// (accept > hold > refuse), every tightening move took effect and every loosening move was ignored.
//
// So the cases below are not "does the setter work" — they are the two halves of the contract. A tightening
// move must land everywhere at once (engine, record, config, wire), and a loosening move must land NOWHERE,
// including on the wire: this server refuses it because the engine would ignore it in silence, and
// reporting success for a change that did not happen is the one failure this method exists to avoid.

const notifsOf = (lines: string[], method: string) => parsed(lines).filter((f) => f.method === method);

/** The full canonical `thread/settings/changed` payload for a thread admitted with no settings config —
 *  spelled out ONCE, so each case below asserts the whole shape rather than the one key it cares about. A
 *  payload assertion that reads only its own key passes while the other four are wrong. */
const changedPayload = (threadId: string, crossSessionInbound: string) => ({
  threadId, source: "client",
  model: undefined, permissionMode: undefined, thinkingTokens: undefined,
  crossSessionInbound,
});

/** An engine fake that records every `applyFlagSettings` push, so a case can assert the ENGINE was asked —
 *  not merely that the server wrote its own mirror. `push`/`live` expose the frame seam for the adoption
 *  case (peer-inbound.test.ts's `pushEngine`, narrowed to what is needed here). */
function recordingEngine(overrides: Record<string, unknown> = {}) {
  const applied: Record<string, unknown>[] = [];
  const frameSubs = new Set<(f: unknown) => void>();
  const engine = {
    ...fakeEngine(),
    onFrame: (cb: (f: unknown) => void) => { frameSubs.add(cb); return () => frameSubs.delete(cb); },
    applyFlagSettings: async (s: Record<string, unknown>) => { applied.push(s); },
    ...overrides,
  };
  return { engine, applied, push: (f: unknown) => { for (const s of [...frameSubs]) s(f); }, live: () => frameSubs.size };
}

/** One admitted thread with TWO subscribed connections. Two, deliberately: a notification is a FAN-OUT, and
 *  a single subscriber cannot show that the second one was served the same payload — the same
 *  "second client sees the first client's change" shadow settings.test.ts boots for its own setters. */
async function admit(value: string | undefined, engine: unknown = fakeEngine()) {
  const srv = new AppServer({}, { ccxDir: fileCcxDir, listSessions: async () => [], sessionFactory: (() => engine) as never });
  const a = mkSink(); const connA = srv.connect(a.sink);
  const b = mkSink(); const connB = srv.connect(b.sink);
  send(connA, { id: 1, method: "initialize", params: { clientInfo: { name: "A" } } });
  send(connB, { id: 1, method: "initialize", params: { clientInfo: { name: "B" } } });
  send(connA, { id: 2, method: "thread/start", params: value ? { crossSessionInbound: value } : {} });
  await tick(); await tick();
  const threadId = replyTo(a.lines, 2).result.thread.id;
  send(connA, { id: 90, method: "thread/subscribe", params: { threadId } });
  send(connB, { id: 91, method: "thread/subscribe", params: { threadId } });
  await tick();
  a.lines.length = 0; b.lines.length = 0;
  return { srv, a, b, connA, connB, threadId, record: srv.registry.get(threadId)! };
}

const setInbound = async (conn: { feed(ch: string): void }, id: number, threadId: string, value: string) => {
  send(conn, { id, method: "thread/crossSessionInbound/set", params: { threadId, value } });
  await tick(); await tick();
};

describe("thread/crossSessionInbound/set — the tightening ratchet", () => {
  it("a tightening move reaches the engine, the record, the config and BOTH subscribers, as the whole canonical payload", async () => {
    const e = recordingEngine();
    const { a, b, connA, threadId, record } = await admit("accept", e.engine);
    record.updatedAt = 0; // unix SECONDS: a set inside the same second would otherwise be indistinguishable

    await setInbound(connA, 3, threadId, "hold");

    expect(replyTo(a.lines, 3).result).toEqual({ ok: true });
    expect(e.applied).toEqual([{ [SETTINGS_KEY]: "hold" }]);
    expect(record.crossSessionInbound).toBe("hold");
    // The record and the config are ONE fact: without the config write the next engine swap would rebuild
    // from the launch config and silently restore `accept`.
    expect(settingsOf(record.config!)[SETTINGS_KEY]).toBe("hold");
    expect(record.updatedAt).toBeGreaterThan(0);
    for (const lines of [a.lines, b.lines]) {
      const evts = notifsOf(lines, "thread/settings/changed");
      expect(evts).toHaveLength(1);
      expect(evts[0].params).toEqual(changedPayload(threadId, "hold"));
    }
  });

  it("an EQUAL-value move applies idempotently and still announces — a tightening move of size zero is not an error", async () => {
    const e = recordingEngine();
    const { a, connA, threadId, record } = await admit("hold", e.engine);

    await setInbound(connA, 3, threadId, "hold");

    expect(replyTo(a.lines, 3).result).toEqual({ ok: true });
    expect(e.applied).toEqual([{ [SETTINGS_KEY]: "hold" }]);
    expect(record.crossSessionInbound).toBe("hold");
    // Announced, not suppressed: refusing or silencing a re-statement would make a client's retry an error.
    expect(notifsOf(a.lines, "thread/settings/changed")[0].params).toEqual(changedPayload(threadId, "hold"));
  });

  it.each([["hold", "accept"], ["refuse", "accept"], ["refuse", "hold"]])(
    "a LOOSENING move (%s -> %s) is refused -32602 and changes nothing anywhere — no engine call, no record write, no config write, no timestamp, NO notification",
    async (from, to) => {
      const e = recordingEngine();
      const { a, b, connA, threadId, record } = await admit(from, e.engine);
      const before = { ...record.config } as Record<string, unknown>;
      record.updatedAt = 0;

      await setInbound(connA, 3, threadId, to);

      const err = replyTo(a.lines, 3).error;
      expect(err.code).toBe(ERR.INVALID_PARAMS);
      // The refusal names BOTH values and says whose refusal it is. The engine does not refuse a loosening
      // write — it ACCEPTS it and ignores it — so the message must not claim otherwise, and must point at
      // the only thing that does widen the policy: an engine built with the wider value.
      expect(err.message).toContain(`"${from}" -> "${to}"`);
      expect(err.message).toMatch(/ignored in silence/);
      expect(err.message).toMatch(/thread\/start/);
      expect(e.applied).toEqual([]);
      expect(record.crossSessionInbound).toBe(from);
      expect(record.config).toEqual(before);
      expect(record.updatedAt).toBe(0);
      // The ABSENCE, asserted: a refusal that still broadcast would tell every subscriber the policy moved.
      for (const lines of [a.lines, b.lines]) expect(notifsOf(lines, "thread/settings/changed")).toEqual([]);
    });

  it("the refusal is answered at ARRIVAL time — it never enters the chain, so it cannot serialize behind a running turn", async () => {
    // A chain deliberately left unresolved: anything deferred into it stays deferred for the whole test.
    const { a, connA, threadId, record } = await admit("refuse");
    record.chain = new Promise(() => {});

    await setInbound(connA, 3, threadId, "accept");

    expect(replyTo(a.lines, 3).error.code).toBe(ERR.INVALID_PARAMS);
  });

  it("an engine that DIED mid-setter answers -33005, not -32603", async () => {
    // The body is chain-deferred, so it runs after dispatch's arrival-time -33005 gate has already let the
    // request through: the engine can die in between, and scoring that throw -32603 would report a
    // server-internal fault for a dead read loop the caller can see for itself (engineThrow.ts).
    let ended = false;
    const e = recordingEngine({
      isEnded: () => ended,
      applyFlagSettings: async () => { ended = true; throw new Error("Session is not running"); },
    });
    const { a, connA, threadId, record } = await admit("accept", e.engine);

    await setInbound(connA, 3, threadId, "refuse");

    expect(replyTo(a.lines, 3).error.code).toBe(ERR.ENGINE_GONE);
    expect(record.crossSessionInbound).toBe("accept"); // the engine kept its value; the mirror must too
    expect(notifsOf(a.lines, "thread/settings/changed")).toEqual([]);
  });

  it("a FLEET-origin thread answers -33006 — this server did not build that engine and cannot inject a settings key into it", async () => {
    const { srv, a, connA } = await admit("accept");
    // A fleet record as `thread/attach` admits one (fleet.ts), minus the socket — enough for the one
    // question this origin raises here. It seeds an `accept` policy on purpose, so the refusal below cannot
    // be the ratchet's doing.
    const fleet: ThreadRecord = {
      id: srv.registry.mint(), origin: "fleet", session: fakeEngine() as never, unattended: "park",
      crossSessionInbound: "accept", busy: false, turnSeq: 0, interruptRequested: false, buffer: [], queue: [],
      subscribers: new Set(), chain: Promise.resolve(), sessionId: "sess-fleet", createdAt: 1, updatedAt: 1,
      settings: {}, flagPerms: emptyFlagPerms(), mcpToggles: {}, mcpOverrides: {}, epoch: 0,
    };
    srv.registry.add(fleet);

    await setInbound(connA, 3, fleet.id, "refuse");

    const err = replyTo(a.lines, 3).error;
    expect(err.code).toBe(ERR.UNSUPPORTED_FOR_ORIGIN);
    expect(err.message).toBe(ORIGIN_REFUSAL_MESSAGE); // the one string every origin refusal carries
    expect(fleet.crossSessionInbound).toBe("accept");
  });

  it("accept -> refuse detaches the arrival path: a foreign lifecycle frame is NOT adopted afterwards", async () => {
    const e = recordingEngine();
    const { a, connA, threadId } = await admit("accept", e.engine);
    // TWO frame subscribers on a non-refusing thread: the per-thread router (router.ts, on every thread)
    // and the arrival observer (peerInbound.ts, on non-refusing threads only). The router is what must
    // still be there afterwards — this flip detaches the arrival path, not the thread's own frame routing.
    expect(e.live()).toBe(2);

    await setInbound(connA, 3, threadId, "refuse");
    expect(replyTo(a.lines, 3).result).toEqual({ ok: true });
    expect(e.live()).toBe(1);

    e.push({ type: "command_lifecycle", command_uuid: "foreign-1", state: "started", session_id: "s", uuid: "f" });
    await tick(); await tick();
    // No turn, and nothing to render one from: the policy moved and the arrival path moved with it.
    expect(notifsOf(a.lines, "turn/started")).toEqual([]);
  });

  it("a turn ALREADY adopted when the flip lands is settled, not abandoned — detaching the observer must not leave the thread busy forever", async () => {
    // The hazard the close and swap paths already pair `settleAdopted` with `uninstallPeerInbound` for:
    // the terminal `command_lifecycle` of an adopted turn arrives on the very observer this flip detaches,
    // so settling nothing would leave `busy` true and every later turn refused. `cancelled` says THIS
    // SERVER stopped following the turn — the engine survives the flip, unlike at those two sites.
    const e = recordingEngine();
    const { a, connA, threadId, record } = await admit("accept", e.engine);
    e.push({ type: "command_lifecycle", command_uuid: "foreign-9", state: "started", session_id: "s", uuid: "f" });
    await tick(); await tick();
    expect(notifsOf(a.lines, "turn/started")).toHaveLength(1);

    await setInbound(connA, 3, threadId, "refuse");

    const done = notifsOf(a.lines, "turn/completed");
    expect(done).toHaveLength(1);
    expect(done[0].params.turn.status).toBe("cancelled");
    expect(record.busy).toBe(false);
  });

  it("the value the setter put there survives swapBaseConfig, which is what every replacement engine is built from", async () => {
    const { connA, threadId, record } = await admit("accept");

    await setInbound(connA, 3, threadId, "refuse");

    // Composed rather than trusted to four call sites: `thread/rewind`, `thread/clear`, `thread/reopen` and
    // the fork path all rebuild from this one function, so a policy that survives it survives all of them.
    const replacement = swapBaseConfig(record.config);
    expect(settingsOf(replacement)[SETTINGS_KEY]).toBe("refuse");
    expect((replacement.extraArgs as Record<string, unknown>)["replay-user-messages"]).toBeNull();
  });
});
