import { describe, expect, it } from "vitest";
import { Session } from "../../src/session/session.js";
import { turnFailureOf } from "../../src/session/turnResult.js";
import { AsyncQueue } from "../../src/swarm/asyncQueue.js";

function fakeQuery() {
  const frames = new AsyncQueue<unknown>();
  const query = (() => ({ [Symbol.asyncIterator]: () => frames[Symbol.asyncIterator]() })) as any;
  return { frames, query };
}

describe("Session.onFrame", () => {
  it("fires for BETWEEN-TURN system frames (no waiter — the old path dropped them)", async () => {
    const { frames, query } = fakeQuery();
    const s = new Session({ query }, {});
    const seen: unknown[] = [];
    s.onFrame((m) => seen.push(m));
    frames.push({ type: "system", subtype: "background_tasks_changed", tasks: [{ task_id: "t1", task_type: "bash", description: "sleep" }] });
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toHaveLength(1);
    expect(s.backgroundTasks).toEqual([{ task_id: "t1", task_type: "bash", description: "sleep" }]);
    frames.close(); await s.done;
  });

  it("unsubscribe stops delivery; a throwing subscriber does not break the loop", async () => {
    const { frames, query } = fakeQuery();
    const s = new Session({ query }, {});
    const seen: unknown[] = [];
    s.onFrame(() => { throw new Error("boom"); });
    const off = s.onFrame((m) => seen.push(m));
    frames.push({ type: "system", subtype: "status", permissionMode: "default" });
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toHaveLength(1);
    off();
    frames.push({ type: "system", subtype: "status", permissionMode: "plan" });
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toHaveLength(1);
    frames.close(); await s.done;
  });
});

// ── Wave T Task 14 — the probe-96 terminal frame ─────────────────────────────────────────────────────
// Frames transcribed key-for-key from probe 96 variant C's live trace (`probe96-C.log`): a synthetic
// assistant message followed by a result whose `subtype` is STILL "success" while `is_error` is true, and
// then the async iterator throwing. `user_message_uuid` is the one field probe 96 could not observe (it
// ran with a STRING prompt, which never mints one), so both shapes are covered — the SDK's correlation
// stamp must not be what decides whether a failed turn is reported honestly.
const SYNTHETIC_ASSISTANT = {
  type: "assistant", model: "<synthetic>", is_api_error_message: true, error: "authentication_failed", uuid: "a1", session_id: "sid",
  message: { role: "assistant", content: [{ type: "text", text: "Failed to authenticate. API Error: 401 probe 96 synthetic 401" }] },
};
const API_ERROR_TEXT = "Failed to authenticate. API Error: 401 probe 96 synthetic 401";
function apiErrorResult(uuid?: string) {
  return {
    type: "result", subtype: "success", is_error: true, terminal_reason: "api_error", api_error_status: 401,
    result: API_ERROR_TEXT, duration_ms: 4419, duration_api_ms: 0, num_turns: 1, stop_reason: "stop_sequence",
    total_cost_usd: 0, usage: {}, modelUsage: {}, permission_denials: [], fast_mode_state: "off",
    session_id: "sid", uuid: "r1", ...(uuid === undefined ? {} : { user_message_uuid: uuid }),
  };
}
/** Probe 96's full two-part ending: the terminal frames, THEN the throw. */
function probe96Query(stampUuid: boolean) {
  return ({ prompt }: any) => (async function* () {
    for await (const t of prompt) {
      yield SYNTHETIC_ASSISTANT;
      yield apiErrorResult(stampUuid ? t.uuid : undefined);
      throw new Error(`Claude Code returned an error result: ${API_ERROR_TEXT}`);
    }
  })();
}

describe("turnFailureOf: classify a result frame by is_error, never by subtype", () => {
  it("probe 96's subtype:\"success\" + is_error:true frame is a FAILURE", () => {
    expect(turnFailureOf(apiErrorResult("u1"))).toEqual({ message: API_ERROR_TEXT, terminalReason: "api_error", apiErrorStatus: 401 });
  });
  it("a genuine success is undefined even when it carries a terminal_reason", () => {
    expect(turnFailureOf({ type: "result", subtype: "success", is_error: false, terminal_reason: "completed", result: "done" })).toBeUndefined();
  });
  it("an SDKResultError has no `result` text — the message falls back to errors[], then terminal_reason", () => {
    expect(turnFailureOf({ type: "result", subtype: "error_during_execution", is_error: true, errors: ["boom", ""] }))
      .toEqual({ message: "boom" });
    expect(turnFailureOf({ type: "result", subtype: "error_max_turns", is_error: true, errors: [], terminal_reason: "max_turns" }))
      .toEqual({ message: "max_turns", terminalReason: "max_turns" });
  });
  it("api_error_status alone is enough — it is only ever set on an API error", () => {
    expect(turnFailureOf({ type: "result", subtype: "success", api_error_status: 529, result: "overloaded" })?.apiErrorStatus).toBe(529);
  });
  it("a null api_error_status is not a number and never decides on its own", () => {
    expect(turnFailureOf({ type: "result", subtype: "success", is_error: false, api_error_status: null, result: "ok" })).toBeUndefined();
    expect(turnFailureOf({ type: "result", subtype: "success", is_error: true, api_error_status: null, result: "x" })).toEqual({ message: "x" });
  });
  it("non-result frames classify as nothing", () => {
    expect(turnFailureOf(SYNTHETIC_ASSISTANT)).toBeUndefined();
    expect(turnFailureOf(undefined)).toBeUndefined();
  });
});

describe("Session: probe 96's terminal frame RESOLVES submit() with an error tag", () => {
  // THE SEMANTIC DECISION (Task 14). A turn that reached a terminal result frame is not a transport
  // exception: it has a session id, usage, cost and an error text. submit() therefore still RESOLVES —
  // the failure rides as an additive `error` tag, which is strictly more information than today and
  // breaks none of the four consumers (createHarness, the daemon supervisor, the app-server, the REPL host).
  it("with a user_message_uuid: resolves, result text intact, error tag attached", async () => {
    const s = new Session({ query: probe96Query(true) as any }, {});
    const seen: any[] = [];
    const r = await s.submit("hi", (m) => seen.push(m));
    expect(r.result).toBe(API_ERROR_TEXT);
    expect(r.error).toEqual({ message: API_ERROR_TEXT, terminalReason: "api_error", apiErrorStatus: 401 });
    // The synthetic assistant message still streams — it is the ONE row the transcript paints (canon
    // `JG`/`lca` warning bullet), and the error tag must not mint a second one.
    expect(seen).toEqual([SYNTHETIC_ASSISTANT]);
  });

  it("WITHOUT a user_message_uuid: still resolves error-tagged, never rejects `session disposed`", async () => {
    // Pre-Task-14 this fell through fifoWaiter (the frame carries no `origin` and the waiter is a normal
    // turn), so nothing settled it and readLoop's `finally` rejected it "session disposed" — a message
    // that names the wrong cause and printed a SECOND, wrong line under the honest one.
    const s = new Session({ query: probe96Query(false) as any }, {});
    const r = await s.submit("hi");
    expect(r.result).toBe(API_ERROR_TEXT);
    expect(r.error?.terminalReason).toBe("api_error");
  });

  it("a clean turn carries NO error tag", async () => {
    const clean = ({ prompt }: any) => (async function* () {
      for await (const t of prompt) yield { type: "result", subtype: "success", is_error: false, terminal_reason: "completed", result: "ok", user_message_uuid: t.uuid };
    })();
    const s = new Session({ query: clean as any }, {});
    const r = await s.submit("hi");
    expect(r.result).toBe("ok");
    expect(r.error).toBeUndefined();
    s.dispose();
  });

  it("a query that dies WITHOUT any terminal frame still rejects — that is a real transport exception", async () => {
    const dead = () => (async function* () { yield { type: "system", subtype: "init", session_id: "sid" }; throw new Error("Claude Code process exited with code 1"); })();
    const s = new Session({ query: dead as any }, {}, { label: "session" });
    await expect(s.submit("hi")).rejects.toThrow("session disposed");
  });
});
