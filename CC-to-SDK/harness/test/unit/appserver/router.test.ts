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

/** A fake `AppServer` whose only live method is `broadcast` — every 8b route calls `srv.broadcast(...)`,
 *  never `Peer.notify` directly, so a plain collector is enough to assert what each route sent without
 *  wiring real Peers/connections (the real `AppServer.broadcast` already fans out through `Peer.notify`,
 *  which is exercised by server.ts/peer.ts's own tests, not re-proven here). */
function fakeSrv(): { srv: AppServer; calls: { threadId: string; method: string; params: Record<string, unknown> }[] } {
  const calls: { threadId: string; method: string; params: Record<string, unknown> }[] = [];
  const srv = { broadcast: (threadId: string, method: string, params: Record<string, unknown>) => { calls.push({ threadId, method, params }); } } as unknown as AppServer;
  return { srv, calls };
}

// Review fix: this MUST be a live `fakeSrv()`, not a bare `{} as AppServer`. routeSettingsMirror (Task 8b)
// calls `srv.broadcast(...)` on every system/status frame carrying permissionMode/model — including the
// status frames this describe block's own pre-8b tests push. An unbacked stub let that call throw, and the
// per-route try/catch in installRouter swallowed it silently: every test below still passed even if
// routeSettingsMirror were completely broken, and "one route throwing does not starve the others" had a
// second, UNINTENDED thrower (routeSettingsMirror) muddying its premise of isolating exactly one deliberate
// fault (routeInit's sabotaged getter). A working broadcast collector removes both problems.
const { srv } = fakeSrv();

describe("frame router skeleton (spec D-M2-6, D-M2-8)", () => {
  it("latches sessionId from the init frame (absorbed latchSessionId)", () => {
    const { session, push } = fakeSession();
    const record = mkRecord(session);
    installRouter(srv, record);
    expect(record.sessionId).toBeUndefined();
    push({ type: "system", subtype: "init", session_id: "sess-abc" });
    expect(record.sessionId).toBe("sess-abc");
  });

  it("latches sessionId off `session.sessionId` on a NON-init frame, when the getter only populates after the init frame (absorbed latchSessionId's unconditional per-frame getter read)", () => {
    // Engine-faithful: the init frame itself carries no session_id (some engines latch their id off some
    // other frame entirely), and the getter is still undefined AT the init frame — it only resolves later,
    // between turns. A router that only reads the getter when frame.subtype === "init" would never see it.
    const { session, push } = fakeSession();
    const record = mkRecord(session);
    installRouter(srv, record);

    push({ type: "system", subtype: "init" }); // no session_id, and the getter has nothing yet either
    expect(record.sessionId).toBeUndefined();

    (session as { sessionId?: string }).sessionId = "sess-late-getter"; // the getter populates between turns
    push({ type: "system", subtype: "status", permissionMode: "plan" }); // a NON-init frame
    expect(record.sessionId).toBe("sess-late-getter");
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

describe("frame router routes (spec Wave 1, D-M2-6)", () => {
  it("a status frame with a NEW permissionMode updates the mirror and broadcasts source:'engine'", () => {
    const { session, push } = fakeSession();
    const { srv, calls } = fakeSrv();
    const record = mkRecord(session, { settings: { permissionMode: "default" } });
    installRouter(srv, record);

    push({ type: "system", subtype: "status", permissionMode: "plan" });

    expect(record.settings.permissionMode).toBe("plan");
    const evt = calls.find((c) => c.method === "thread/settings/changed");
    expect(evt?.params).toEqual({ threadId: "t1", source: "engine", model: undefined, permissionMode: "plan", thinkingTokens: undefined });
  });

  it("a status frame echoing the mirror's value broadcasts NOTHING (echo-dedup)", () => {
    const { session, push } = fakeSession();
    const { srv, calls } = fakeSrv();
    const record = mkRecord(session, { settings: { permissionMode: "plan" } });
    installRouter(srv, record);

    push({ type: "system", subtype: "status", permissionMode: "plan" }); // same value as the mirror already holds

    expect(calls.find((c) => c.method === "thread/settings/changed")).toBeUndefined();
  });

  it("an echo-deduped status frame STILL applies a pending plan upgrade (8a's route is not gated by dedup)", async () => {
    const modes: string[] = [];
    const { session, push } = fakeSession({ setPermissionMode: async (m: string) => { modes.push(m); } });
    const { srv, calls } = fakeSrv();
    const record = mkRecord(session, { settings: { permissionMode: "plan" }, planUpgradePending: true });
    installRouter(srv, record);

    push({ type: "system", subtype: "status", permissionMode: "plan" }); // echoes the mirror exactly
    await tick();

    expect(calls.find((c) => c.method === "thread/settings/changed")).toBeUndefined(); // dedup still suppresses the broadcast
    expect(modes).toEqual(["acceptEdits"]); // but routeStatus's plan-upgrade consult still ran, independent of dedup
    expect(record.planUpgradePending).toBe(false);
  });

  it("a status frame with a NEW model updates the mirror and broadcasts source:'engine' (empirical: SDK status frames may never carry model; route stays harmless if never hit)", () => {
    const { session, push } = fakeSession();
    const { srv, calls } = fakeSrv();
    const record = mkRecord(session, { settings: { model: "claude-a" } });
    installRouter(srv, record);

    push({ type: "system", subtype: "status", model: "claude-b" });

    expect(record.settings.model).toBe("claude-b");
    expect(calls.find((c) => c.method === "thread/settings/changed")?.params).toMatchObject({ source: "engine", model: "claude-b" });
  });

  it("compact_boundary → thread/compacted with the current turnId", () => {
    const { session, push } = fakeSession();
    const { srv, calls } = fakeSrv();
    const record = mkRecord(session, { currentTurnId: "turn-9" });
    installRouter(srv, record);

    const frame = { type: "system", subtype: "compact_boundary", compact_metadata: { trigger: "auto", pre_tokens: 100 } };
    push(frame);

    const evt = calls.find((c) => c.method === "thread/compacted");
    expect(evt?.params).toEqual({ threadId: "t1", turnId: "turn-9", outcome: frame });
  });

  it("a result frame with usage → thread/tokenUsage/updated", () => {
    const { session, push } = fakeSession();
    const { srv, calls } = fakeSrv();
    const record = mkRecord(session);
    installRouter(srv, record);

    push({ type: "result", usage: { input_tokens: 5, output_tokens: 7 }, modelUsage: { "claude-x": { inputTokens: 5 } } });

    const evt = calls.find((c) => c.method === "thread/tokenUsage/updated");
    expect(evt?.params).toEqual({ threadId: "t1", usage: { input_tokens: 5, output_tokens: 7, modelUsage: { "claude-x": { inputTokens: 5 } } } });
  });

  it("a result frame with neither usage nor modelUsage does not broadcast tokenUsage", () => {
    const { session, push } = fakeSession();
    const { srv, calls } = fakeSrv();
    const record = mkRecord(session);
    installRouter(srv, record);

    push({ type: "result", result: "ok" });

    expect(calls.find((c) => c.method === "thread/tokenUsage/updated")).toBeUndefined();
  });

  it("a rejected rate_limit_event → thread/limits/updated (condition + payload from limits/classify.ts's classifyLimitMessage, the existing consumer of exactly these two frame types)", () => {
    const { session, push } = fakeSession();
    const { srv, calls } = fakeSrv();
    const record = mkRecord(session);
    installRouter(srv, record);

    push({ type: "rate_limit_event", rate_limit_info: { status: "rejected", rateLimitType: "five_hour", resetsAt: 1234 } });

    const evt = calls.find((c) => c.method === "thread/limits/updated");
    expect(evt?.params).toEqual({ threadId: "t1", limits: { kind: "rate-limit", message: "rate limited (five_hour)", resetsAt: 1234 } });
  });

  it("an allowed rate_limit_event broadcasts nothing (healthy state — no limit fields for classifyLimitMessage to extract)", () => {
    const { session, push } = fakeSession();
    const { srv, calls } = fakeSrv();
    const record = mkRecord(session);
    installRouter(srv, record);

    push({ type: "rate_limit_event", rate_limit_info: { status: "allowed" } });

    expect(calls.find((c) => c.method === "thread/limits/updated")).toBeUndefined();
  });

  it("background_tasks_changed → task/changed with the full snapshot", () => {
    const { session, push } = fakeSession();
    const { srv, calls } = fakeSrv();
    const record = mkRecord(session);
    installRouter(srv, record);

    const tasks = [{ task_id: "1", task_type: "x", description: "d" }];
    push({ type: "system", subtype: "background_tasks_changed", tasks });

    const evt = calls.find((c) => c.method === "task/changed");
    expect(evt?.params).toEqual({ threadId: "t1", tasks });
  });

  it("task_notification as a system-subtype frame → task/event with the raw frame", () => {
    const { session, push } = fakeSession();
    const { srv, calls } = fakeSrv();
    const record = mkRecord(session);
    installRouter(srv, record);

    const frame = { type: "system", subtype: "task_notification", task_id: "1", status: "completed" };
    push(frame);

    const evt = calls.find((c) => c.method === "task/event");
    expect(evt?.params).toEqual({ threadId: "t1", event: frame });
  });

  it("task_notification as a BARE type tag (no system wrapper) still → task/event (mirrors host.ts's onSessionFrame normalization: `const sub = mm?.type === \"system\" ? mm.subtype : mm?.type`)", () => {
    const { session, push } = fakeSession();
    const { srv, calls } = fakeSrv();
    const record = mkRecord(session);
    installRouter(srv, record);

    const frame = { type: "task_notification", task_id: "1", status: "completed" }; // no `system` wrapper at all
    push(frame);

    const evt = calls.find((c) => c.method === "task/event");
    expect(evt?.params).toEqual({ threadId: "t1", event: frame });
  });

  it("a sibling task-lifecycle subtype (task_progress) also → task/event (host.ts treats task_started/task_progress/task_updated/task_notification as one family — a client that only sees completions can't render a live task list)", () => {
    const { session, push } = fakeSession();
    const { srv, calls } = fakeSrv();
    const record = mkRecord(session);
    installRouter(srv, record);

    const frame = { type: "system", subtype: "task_progress", task_id: "1", description: "working" };
    push(frame);

    const evt = calls.find((c) => c.method === "task/event");
    expect(evt?.params).toEqual({ threadId: "t1", event: frame });
  });

  it("an UNRELATED system subtype does not fire task/event (the family match is not a bare frame.type !== undefined check)", () => {
    const { session, push } = fakeSession();
    const { srv, calls } = fakeSrv();
    const record = mkRecord(session);
    installRouter(srv, record);

    push({ type: "system", subtype: "status", permissionMode: "plan" });
    push({ type: "system", subtype: "mirror_error", error: "boom" });

    expect(calls.find((c) => c.method === "task/event")).toBeUndefined();
  });

  it("a commands_changed system frame → thread/capabilities/changed (a ping — no command list in the payload)", () => {
    const { session, push } = fakeSession();
    const { srv, calls } = fakeSrv();
    const record = mkRecord(session);
    installRouter(srv, record);

    push({ type: "system", subtype: "commands_changed", commands: ["/foo"] });

    const evt = calls.find((c) => c.method === "thread/capabilities/changed");
    expect(evt?.params).toEqual({ threadId: "t1" });
  });

  it("system/init's own slash_commands snapshot does NOT fire the capabilities push (that is the initial snapshot, not a mid-session push)", () => {
    const { session, push } = fakeSession();
    const { srv, calls } = fakeSrv();
    const record = mkRecord(session);
    installRouter(srv, record);

    push({ type: "system", subtype: "init", session_id: "s1", slash_commands: ["/foo"] });

    expect(calls.find((c) => c.method === "thread/capabilities/changed")).toBeUndefined();
  });

  it("an assistant frame carrying a TodoWrite tool_use → turn/todo/updated with the todos snapshot", () => {
    const { session, push } = fakeSession();
    const { srv, calls } = fakeSrv();
    const record = mkRecord(session, { currentTurnId: "turn-5" });
    installRouter(srv, record);

    const todos = [{ content: "a", status: "pending" }];
    push({ type: "assistant", message: { content: [{ type: "tool_use", name: "TodoWrite", input: { todos } }] } });

    const evt = calls.find((c) => c.method === "turn/todo/updated");
    expect(evt?.params).toEqual({ threadId: "t1", turnId: "turn-5", todos });
  });

  it("a nested/subagent assistant frame's TodoWrite is NOT relayed as the main turn's todos (mirrors items/mapper.ts's parent_tool_use_id discard)", () => {
    const { session, push } = fakeSession();
    const { srv, calls } = fakeSrv();
    const record = mkRecord(session, { currentTurnId: "turn-5" });
    installRouter(srv, record);

    push({ type: "assistant", parent_tool_use_id: "agent-1", message: { content: [{ type: "tool_use", name: "TodoWrite", input: { todos: [] } }] } });

    expect(calls.find((c) => c.method === "turn/todo/updated")).toBeUndefined();
  });

  it("a malformed TodoWrite block (input.todos not an array) is NOT relayed — snapshot-replace semantics mean a client would wipe its todo list on garbage input", () => {
    const { session, push } = fakeSession();
    const { srv, calls } = fakeSrv();
    const record = mkRecord(session, { currentTurnId: "turn-5" });
    installRouter(srv, record);

    push({ type: "assistant", message: { content: [{ type: "tool_use", name: "TodoWrite", input: {} }] } }); // no `todos` key at all
    push({ type: "assistant", message: { content: [{ type: "tool_use", name: "TodoWrite" }] } }); // no `input` at all

    expect(calls.find((c) => c.method === "turn/todo/updated")).toBeUndefined();
  });

  it("a genuine (non-echo) settings-mirror write bumps record.updatedAt", () => {
    const { session, push } = fakeSession();
    const { srv } = fakeSrv();
    const record = mkRecord(session, { settings: { permissionMode: "default" }, updatedAt: 0 });
    installRouter(srv, record);

    push({ type: "system", subtype: "status", permissionMode: "plan" });

    expect(record.updatedAt).toBeGreaterThan(0);
  });

  it("an echo-deduped settings-mirror frame does NOT bump record.updatedAt", () => {
    const { session, push } = fakeSession();
    const { srv } = fakeSrv();
    const record = mkRecord(session, { settings: { permissionMode: "plan" }, updatedAt: 0 });
    installRouter(srv, record);

    push({ type: "system", subtype: "status", permissionMode: "plan" }); // same value as the mirror

    expect(record.updatedAt).toBe(0);
  });
});
