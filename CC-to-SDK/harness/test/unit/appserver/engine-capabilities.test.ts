// test/unit/appserver/engine-capabilities.test.ts — F10 T-IMGREACH Task 9 (I3c): the SECOND optional
// EngineSession capability (`steerContent`, alongside Task 8's `submitContent`) and the three gate
// helpers/refusals that keep a content turn from ever reaching an engine — or an ORIGIN — that cannot
// carry it. Three groups below, each its own layer:
//
//  1. the in-process engine (Session) implements both optional members — one line each over the
//     existing machinery (`submit`/`steer` already accept `UserTurnInput`), proven against a real Session
//     rather than a fake so a normalization regression in `userTurn` would show up here too;
//  2. the two capability-gate helpers (turns.ts's `requireSubmitContent`/`requireSteerContent`) throw BY
//     NAME, synchronously, before any engine call — proven against DI fakes so a mis-route through the
//     wrong capability is a test failure here, not a live-only discovery;
//  3. the fleet-origin content gate (fleetEngine.ts's `refuseFleetContent`) refuses BOTH content ops
//     with a fleet-specific message, distinct from either engine-capability refusal above, because F10
//     ships no fleet staging client (spec non-goals) — the refusal is a fact about the ORIGIN. The wire
//     handlers that call this gate (`turn/startContent`, `turn/steerContent`) are Tasks 10/11's — this
//     file proves the GATE itself, which is what those handlers will call first, before any staged-image
//     reservation.
import { describe, it, expect, vi } from "vitest";
import { Session } from "../../../src/session/session.js";
import { AsyncQueue } from "../../../src/swarm/asyncQueue.js";
import { AppServer } from "../../../src/appserver/server.js";
import { submitRunner, requireSubmitContent, requireSteerContent, EngineCapabilityError } from "../../../src/appserver/turns.js";
import { TurnMapper } from "../../../src/appserver/items/mapper.js";
import { emptyFlagPerms, ORIGIN_REFUSAL_MESSAGE, type EngineSession, type ThreadRecord } from "../../../src/appserver/registry.js";
import { refuseFleetContent, FLEET_CONTENT_REFUSAL_MESSAGE } from "../../../src/appserver/fleetEngine.js";
import { ERR } from "../../../src/appserver/rpc.js";
import type { UserContentBlock } from "../../../src/session/turnInput.js";

const tick = () => new Promise((r) => setTimeout(r, 0));
// A genuine 1x1 PNG (session.test.ts's own fixture): `normalizeTurnInput` re-decodes each block's OWN
// bytes (spec v3.1), so an arbitrary base64 string like "hello" fails validation and is REPLACED with an
// error-label text block — these tests need real image bytes to observe the block surviving intact.
const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
function img(): UserContentBlock { return { type: "image", source: { type: "base64", media_type: "image/png", data: PNG_1X1 } }; }

/** A bare, string-only engine: the four required `EngineSession` members and nothing else — no
 *  `submitContent`, no `steerContent`. Optional members are added per-test so "this engine lacks the
 *  member" is a deliberate statement, matching origin-gate.test.ts's `fakeSession` convention. */
function stringOnlyEngine(): EngineSession {
  return { submit: async () => ({ result: {} }), interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {} };
}

/** A minimal standalone `ThreadRecord` — never registered on any `Registry` — just enough for
 *  `submitRunner`'s `emitItems` call to run without crashing (`srv.broadcast` no-ops on an unregistered
 *  thread id, server.ts:889-896). */
function fakeRecord(session: EngineSession, over: Partial<ThreadRecord> = {}): ThreadRecord {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: "thr_test", origin: "inProcess", session, unattended: "park", busy: false, turnSeq: 0,
    interruptRequested: false, buffer: [], queue: [], subscribers: new Set(), chain: Promise.resolve(),
    createdAt: now, updatedAt: now, settings: {}, flagPerms: emptyFlagPerms(), mcpToggles: {}, mcpOverrides: {}, epoch: 0,
    ...over,
  } as unknown as ThreadRecord;
}

describe("I3c: the in-process engine (Session) implements both optional content capabilities", () => {
  it("submitContent resolves the same TurnOutcome shape submit does, with both blocks intact on the pushed message", async () => {
    const pushed: any[] = [];
    const query = ({ prompt }: any) => (async function* () {
      for await (const t of prompt) { pushed.push(t); yield { type: "result", subtype: "success", result: "blue", user_message_uuid: t.uuid }; }
    })();
    const s = new Session({ query }, {});
    const blocks: UserContentBlock[] = [{ type: "text", text: "what colour" }, img()];
    const outcome = await s.submitContent(blocks);
    expect(outcome.result).toBe("blue");
    expect(pushed).toHaveLength(1);
    expect(pushed[0].message.content).toEqual(blocks); // EXACT blocks — not flattened, not re-ordered
    await s.dispose();
  });

  it("steerContent pushes a turn onto the live prompt stream WITHOUT registering a new waiter — the pending submit stays unsettled", async () => {
    const pushes: any[] = [];
    const out = new AsyncQueue<unknown>();
    // Mirrors session-steer-reload.test.ts's `rig()`: the consumer draining `prompt` closes `out` once
    // `prompt` itself ends (dispose() closing `this.input`) — without this, readLoop's `for await (const
    // m of this.q)` never sees an end and dispose() hangs forever awaiting it.
    const query = ({ prompt }: any) => {
      void (async () => { for await (const m of prompt) pushes.push(m); out.close(); })();
      return out as unknown as AsyncIterable<unknown>;
    };
    const s = new Session({ query }, {});
    const turn = s.submit("count to 30");
    const blocks: UserContentBlock[] = [{ type: "text", text: "stop, look at this" }, img()];
    s.steerContent(blocks);
    await tick();

    expect(pushes).toHaveLength(2); // the submit's own push, plus the steer's — turns.length grew
    expect(pushes[1].message.content).toEqual(blocks);

    let settled = false;
    turn.then(() => { settled = true; });
    await tick();
    expect(settled).toBe(false); // no waiter was added for the steer — the submit's own waiter is the only one

    out.push({ type: "result", subtype: "success", result: "counted", user_message_uuid: pushes[0].uuid });
    await expect(turn).resolves.toMatchObject({ result: "counted" });
    await s.dispose();
  });

  it("a Session satisfies EngineSession, including both submitContent and steerContent", async () => {
    const query = ({ prompt }: any) => (async function* () { for await (const _t of prompt) { /* dispose() ends this */ } })();
    const s = new Session({ query }, {});
    const _typeCheck: EngineSession = s; // compile-time: Session structurally satisfies EngineSession with both optional members declared
    void _typeCheck;
    expect(typeof s.submitContent).toBe("function");
    expect(typeof s.steerContent).toBe("function");
    await s.dispose();
  });
});

describe("I3c: the capability-gate helpers (turns.ts) refuse BY NAME, synchronously", () => {
  it("requireSubmitContent / requireSteerContent throw EngineCapabilityError naming the missing capability", () => {
    expect(() => requireSubmitContent(stringOnlyEngine())).toThrow(/engine does not support content submission/);
    expect(() => requireSteerContent(stringOnlyEngine())).toThrow(/engine does not support content steering/);
    let caught: unknown;
    try { requireSubmitContent(stringOnlyEngine()); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(EngineCapabilityError);
  });

  it("I3c: an engine WITHOUT submitContent refuses content submission by name", () => {
    const srv = new AppServer({}, {});
    const record = fakeRecord(stringOnlyEngine());
    let caught: unknown;
    try { submitRunner(srv, record, [img()])("t1", new TurnMapper()); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(EngineCapabilityError);
    expect((caught as Error).message).toMatch(/engine does not support content submission/);
  });

  it("I3c: an engine WITH submitContent but WITHOUT steerContent still refuses steering", () => {
    // A mis-route through submitContent would start a NEW TURN mid-turn — the failure this cell exists
    // to guard against. requireSteerContent must refuse without ever touching submitContent.
    const engine = { ...stringOnlyEngine(), submitContent: vi.fn() };
    expect(() => requireSteerContent(engine)).toThrow(/engine does not support content steering/);
    expect(engine.submitContent).not.toHaveBeenCalled();
  });
});

describe("I3c: the fleet-origin content gate (fleetEngine.ts's refuseFleetContent)", () => {
  it("refuses a fleet-origin thread with ERR.UNSUPPORTED_FOR_ORIGIN and the fleet-specific message", () => {
    expect(refuseFleetContent("fleet")).toEqual({ code: ERR.UNSUPPORTED_FOR_ORIGIN, message: "fleet threads cannot carry images" });
  });

  it("lets an inProcess-origin thread through untouched — the gate is origin-scoped, not engine-scoped", () => {
    expect(refuseFleetContent("inProcess")).toBeNull();
  });

  it("the message is its OWN string, distinct from the generic ORIGIN_REFUSAL_MESSAGE — a fleet thread must never read a permanent architectural fact as a retryable wire gap", () => {
    expect(FLEET_CONTENT_REFUSAL_MESSAGE).not.toBe(ORIGIN_REFUSAL_MESSAGE);
    expect(refuseFleetContent("fleet")!.message).toBe(FLEET_CONTENT_REFUSAL_MESSAGE);
  });

  it("the gate is checked as a standalone step BEFORE any staged-image claim: refusing it never runs a claim function", () => {
    // Stands in for Tasks 10/11's real handler ordering: `turn/startContent`/`turn/steerContent` must
    // call `refuseFleetContent` first and only reach the image stage registry's reservation if it
    // returns null. The gate itself takes no `stagedImageIds` argument at all — it cannot possibly
    // touch the stage — which is what makes that ordering trivial for the handler to get right.
    const claimStagedImages = vi.fn();
    const refusal = refuseFleetContent("fleet");
    if (!refusal) claimStagedImages();
    expect(refusal).not.toBeNull();
    expect(claimStagedImages).not.toHaveBeenCalled();
  });
});
