// test/unit/retry-status.test.ts — Wave T Task 12: the SDK's `system/api_retry` frame (probe 96) becomes
// a live-turn retry status. Pins the canon label rule (`b0p` L408007, label L408010), canon's `error_status`
// prose table (`rZp`, L437178-437190) and the snake_case → camelCase wire mapping. Rendering is Task 13's;
// this file is recognition only.
import { describe, it, expect } from "vitest";
import { retryStatusFrom, provesApiAnswered } from "../../src/tui/retryStatus.js";

// The exact wire shape probe 96 observed, field for field.
const retryFrame = (over: Record<string, unknown> = {}) => ({
  type: "system", subtype: "api_retry", attempt: 1, max_retries: 10, retry_delay_ms: 563,
  error_status: null, error: "unknown", session_id: "s", uuid: "u", ...over,
});

describe("retryStatusFrom: the api_retry frame becomes a live retry status", () => {
  it("maps the wire fields onto the status and seeds the deadline at now + retry_delay_ms", () => {
    expect(retryStatusFrom(retryFrame({ attempt: 2, max_retries: 10, retry_delay_ms: 1215 }), 1_000)).toEqual({
      kind: "retrying", attempt: 2, maxRetries: 10, deadline: 2_215, label: "API error",
    });
  });

  it("attempt 1 of 10 reads the literal `API error` — showDetail is false below min(3, maxRetries)", () => {
    expect(retryStatusFrom(retryFrame({ attempt: 1 }), 0)).toMatchObject({ label: "API error" });
    expect(retryStatusFrom(retryFrame({ attempt: 2 }), 0)).toMatchObject({ label: "API error" });
  });

  it("attempt 3 of 10 shows the detail — showDetail flips at min(3, maxRetries), and it is canon PROSE", () => {
    expect(retryStatusFrom(retryFrame({ attempt: 3, error_status: 401, error: "authentication_failed" }), 0)).toMatchObject({
      label: "Authentication failed",
    });
    expect(retryStatusFrom(retryFrame({ attempt: 3, error_status: 403 }), 0)).toMatchObject({ label: "Authentication failed" });
    expect(retryStatusFrom(retryFrame({ attempt: 4, error_status: 429, error: "rate_limit" }), 0)).toMatchObject({ label: "Rate limited" });
    expect(retryStatusFrom(retryFrame({ attempt: 5, error_status: 529, error: "overloaded" }), 0)).toMatchObject({ label: "API overloaded" });
    expect(retryStatusFrom(retryFrame({ attempt: 6, error_status: 500, error: "server_error" }), 0)).toMatchObject({ label: "API error" });
  });

  it("a ceiling below 3 flips showDetail early — min(3, maxRetries), not a bare 3", () => {
    expect(retryStatusFrom(retryFrame({ attempt: 2, max_retries: 2, error_status: 529 }), 0)).toMatchObject({
      label: "API overloaded", maxRetries: 2,
    });
  });

  // The exact outage this feature exists for: probe 96's own recorded sample is `error_status:null` with
  // `error:"unknown"`. Neither `unknown` nor any other `pir` slug appears anywhere in canon's UI, so the
  // wire's `error` field is never printed — `rZp`'s default arm keeps the canon literal standing.
  it("no response at all keeps the `API error` literal, never a raw wire slug", () => {
    expect(retryStatusFrom(retryFrame({ attempt: 7, error_status: null, error: "unknown" }), 0)).toMatchObject({ label: "API error" });
    expect(retryStatusFrom(retryFrame({ attempt: 5, error_status: undefined, error: "overloaded" }), 0)).toMatchObject({ label: "API error" });
    expect(retryStatusFrom(retryFrame({ attempt: 5, error_status: "401" }), 0)).toMatchObject({ label: "API error" });
  });

  // MINOR 6: `max_retries` absent coerces to 0, and a bare `Math.min(3, 0)` would fire showDetail on attempt
  // 0. A ceiling of 0 is not a ceiling — an absent one falls back to canon's own constant 3.
  it("a frame with no max_retries does not flip showDetail at attempt 0", () => {
    expect(retryStatusFrom({ type: "system", subtype: "api_retry", attempt: 0, error_status: 401 }, 0)).toMatchObject({
      label: "API error", attempt: 0, maxRetries: 0,
    });
    expect(retryStatusFrom({ type: "system", subtype: "api_retry", attempt: 2, error_status: 401 }, 0)).toMatchObject({ label: "API error" });
    expect(retryStatusFrom({ type: "system", subtype: "api_retry", attempt: 3, error_status: 401 }, 0)).toMatchObject({ label: "Authentication failed" });
  });

  it("anything that is not an api_retry frame maps to undefined", () => {
    expect(retryStatusFrom({ type: "system", subtype: "compact_boundary", compact_metadata: {} }, 0)).toBeUndefined();
    expect(retryStatusFrom({ type: "system", subtype: "init", content: "hi" }, 0)).toBeUndefined();
    expect(retryStatusFrom({ type: "assistant", message: { content: [] } }, 0)).toBeUndefined();
    expect(retryStatusFrom({ type: "stream_event" }, 0)).toBeUndefined();
    expect(retryStatusFrom(undefined, 0)).toBeUndefined();
    expect(retryStatusFrom(null, 0)).toBeUndefined();
    expect(retryStatusFrom("api_retry", 0)).toBeUndefined();
  });
});

// ── provesApiAnswered — Task 13-fix (external review) ────────────────────────────────────────────────
// The watchdog's teardown condition, moved out of `useChat` and made a set instead of a negation. The bug it
// closes: `system/init` is the CLI's LOCAL startup frame (probe 99 — every turn, ~3.3 s in, carrying the
// session's permissionMode) and the old rule "anything that is not api_retry" let it disarm a 10 s watchdog
// roughly 70 s before a blackholed endpoint's first api_retry frame (probe 96). `retry-row.test.tsx` pins the
// consequence end to end; this pins the classification frame by frame.
describe("provesApiAnswered: which frames are evidence the API answered", () => {
  it("takes model output, its deltas, tool/agent progress and the terminal frame", () => {
    for (const f of [
      { type: "assistant", message: { content: [{ type: "text", text: "hi" }] } },
      { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: {} }] } },
      { type: "stream_event", event: { type: "content_block_delta" } },
      { type: "tool_progress", tool_use_id: "t1", tool_name: "Bash", elapsed_time_seconds: 30 },
      { type: "tool_use_summary" },
      { type: "result", subtype: "success", is_error: false },
      { type: "system", subtype: "thinking_tokens", estimated_tokens: 120, estimated_tokens_delta: 12 },
      { type: "system", subtype: "task_progress", task_id: "a" },
      { type: "system", subtype: "model_refusal_fallback", content: "no" },
    ]) expect(provesApiAnswered(f)).toBe(true);
  });

  it("refuses the CLI's own local frames — init above all, and every other system bookkeeping subtype", () => {
    for (const f of [
      { type: "system", subtype: "init", permissionMode: "default", model: "claude-sonnet-4-5" },
      { type: "system", subtype: "status", permissionMode: "plan" },
      { type: "system", subtype: "compact_boundary", compact_metadata: {} },
      { type: "system", subtype: "hook_started", hook_name: "PreToolUse" },
      { type: "system", subtype: "session_state_changed" },
      { type: "system", subtype: "commands_changed" },
      { type: "system", subtype: "files_persisted" },
      { type: "system", subtype: "api_retry", attempt: 1 },     // failure, not health — the caller returns before asking
      { type: "system" },
    ]) expect(provesApiAnswered(f)).toBe(false);
  });

  it("refuses a `user` frame: the SDK replays our own prompt as one, and a real tool_result always trails an assistant frame", () => {
    expect(provesApiAnswered({ type: "user", message: { role: "user", content: [{ type: "text", text: "do it" }] } })).toBe(false);
    expect(provesApiAnswered({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1" }] } })).toBe(false);
  });

  it("refuses anything that is not a frame at all", () => {
    for (const f of [undefined, null, "assistant", 7, {}, { type: 42 }]) expect(provesApiAnswered(f)).toBe(false);
  });
});
