// test/unit/appserver/router.test.ts — Task 8a: per-thread frame router skeleton (spec D-M2-6, D-M2-8).
// Exercises installRouter() directly against a bare ThreadRecord + an engine-faithful fake session, rather
// than through the full AppServer RPC surface: onFrame returns an unsubscribe, and frames are pushed
// manually between "turns" (the real Session's frames arrive between turns, not synchronously with any
// call the test makes).
import { describe, it, expect } from "vitest";
import { installRouter } from "../../../src/appserver/router.js";
import type { ThreadRecord, EngineSession } from "../../../src/appserver/registry.js";
import type { AppServer } from "../../../src/appserver/server.js";

const tick = () => new Promise((r) => setTimeout(r, 0));

function fakeSession(overrides: Partial<EngineSession> = {}): { session: EngineSession; push: (f: unknown) => void } {
  const cbs = new Set<(m: unknown) => void>();
  const session: EngineSession = {
    submit: async () => ({ result: {} }),
    interrupt: async () => ({}),
    dispose: async () => {},
    onFrame: (cb) => { cbs.add(cb); return () => cbs.delete(cb); },
    sessionId: undefined,
    ...overrides,
  };
  return { session, push: (f: unknown) => { for (const cb of [...cbs]) cb(f); } };
}

function mkRecord(session: EngineSession, extra: Partial<ThreadRecord> = {}): ThreadRecord {
  return {
    id: "t1", origin: "inProcess", session, unattended: "park", busy: false, turnSeq: 0,
    interruptRequested: false, buffer: [], subscribers: new Set(), chain: Promise.resolve(),
    createdAt: 0, updatedAt: 0, settings: {}, epoch: 0,
    ...extra,
  };
}

const srv = {} as AppServer; // installRouter's `srv` param is unused until Task 8b's new routes need to broadcast

describe("frame router skeleton (spec D-M2-6, D-M2-8)", () => {
  it("latches sessionId from the init frame (absorbed latchSessionId)", () => {
    const { session, push } = fakeSession();
    const record = mkRecord(session);
    installRouter(srv, record);
    expect(record.sessionId).toBeUndefined();
    push({ type: "system", subtype: "init", session_id: "sess-abc" });
    expect(record.sessionId).toBe("sess-abc");
  });

  it("a status frame while planUpgradePending calls the setter exactly once", async () => {
    const modes: string[] = [];
    const { session, push } = fakeSession({ setPermissionMode: async (m: string) => { modes.push(m); } });
    const record = mkRecord(session, { planUpgradePending: true });
    installRouter(srv, record);

    push({ type: "system", subtype: "status", permissionMode: "plan" });
    await tick();
    expect(modes).toEqual(["acceptEdits"]);
    expect(record.planUpgradePending).toBe(false);

    // the flag is cleared after applying — a second status frame must not re-fire the setter
    push({ type: "system", subtype: "status", permissionMode: "acceptEdits" });
    await tick();
    expect(modes).toEqual(["acceptEdits"]);
  });

  it("a status frame with no permissionMode does not apply an armed upgrade (the CLI's own flip has not been observed yet); a later one carrying permissionMode then applies it exactly once", async () => {
    const modes: string[] = [];
    const { session, push } = fakeSession({ setPermissionMode: async (m: string) => { modes.push(m); } });
    const record = mkRecord(session, { planUpgradePending: true });
    installRouter(srv, record);

    // e.g. a compaction-only status frame (compact_result, no permissionMode) — see compaction/server.ts
    push({ type: "system", subtype: "status", compact_result: "success" });
    await tick();
    expect(modes).toEqual([]);
    expect(record.planUpgradePending).toBe(true); // still armed — nothing consumed it

    push({ type: "system", subtype: "status", permissionMode: "plan" });
    await tick();
    expect(modes).toEqual(["acceptEdits"]);
    expect(record.planUpgradePending).toBe(false);
  });

  it("a status frame with planUpgradePending false calls nothing", async () => {
    const modes: string[] = [];
    const { session, push } = fakeSession({ setPermissionMode: async (m: string) => { modes.push(m); } });
    const record = mkRecord(session, { planUpgradePending: false });
    installRouter(srv, record);

    push({ type: "system", subtype: "status", permissionMode: "plan" });
    await tick();
    expect(modes).toEqual([]);
  });

  it("uninstalling the router (routerOff) stops all routing", () => {
    const { session, push } = fakeSession();
    const record = mkRecord(session);
    installRouter(srv, record);
    record.routerOff?.();

    push({ type: "system", subtype: "init", session_id: "sess-late" });
    expect(record.sessionId).toBeUndefined();
  });

  it("a frame arriving after record.epoch changed is dropped (stale-engine guard)", () => {
    const { session, push } = fakeSession();
    const record = mkRecord(session);
    installRouter(srv, record); // captures epoch 0 at install time
    record.epoch = 1; // simulates a rewind's engine swap bumping the generation counter

    push({ type: "system", subtype: "init", session_id: "sess-stale" });
    expect(record.sessionId).toBeUndefined();
  });

  it("one route throwing does not starve the others on the same frame", async () => {
    const modes: string[] = [];
    const { session, push } = fakeSession({ setPermissionMode: async (m: string) => { modes.push(m); } });
    const record = mkRecord(session, { planUpgradePending: true });
    // routeInit's very first statement reads record.sessionId; make that throw unconditionally so it fails
    // on ANY frame, independent of subtype — a stand-in for "a route blows up" that still lets a single
    // frame exercise both routes.
    Object.defineProperty(record, "sessionId", { configurable: true, get() { throw new Error("boom — simulated route fault"); }, set() {} });
    installRouter(srv, record);

    push({ type: "system", subtype: "status", permissionMode: "plan" });
    await tick();
    expect(modes).toEqual(["acceptEdits"]); // routeStatus still ran despite routeInit throwing on the same frame
  });
});
