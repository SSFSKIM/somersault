// test/unit/retry-status.test.ts — Wave T Task 12: the SDK's `system/api_retry` frame (probe 96) becomes
// a live-turn retry status. Pins the canon label rule (`b0p` L408007, label L408010), canon's `error_status`
// prose table (`rZp`, L437178-437190) and the snake_case → camelCase wire mapping. Rendering is Task 13's;
// this file is recognition only.
import { describe, it, expect } from "vitest";
import { retryStatusFrom } from "../../src/tui/retryStatus.js";

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
