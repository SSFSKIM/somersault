// test/unit/retry-status.test.ts — Wave T Task 12: the SDK's `system/api_retry` frame (probe 96) becomes
// a live-turn retry status. Pins the canon label rule (`b0p`, L408007-11) and the snake_case → camelCase
// wire mapping. Rendering is Task 13's; this file is recognition only.
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

  it("attempt 3 of 10 shows the real error text — showDetail flips at min(3, maxRetries)", () => {
    expect(retryStatusFrom(retryFrame({ attempt: 3, error: "authentication_failed" }), 0)).toMatchObject({
      label: "authentication_failed",
    });
    expect(retryStatusFrom(retryFrame({ attempt: 7, error: "unknown" }), 0)).toMatchObject({ label: "unknown" });
  });

  it("a ceiling below 3 flips showDetail early — min(3, maxRetries), not a bare 3", () => {
    expect(retryStatusFrom(retryFrame({ attempt: 2, max_retries: 2, error: "overloaded" }), 0)).toMatchObject({
      label: "overloaded", maxRetries: 2,
    });
  });

  it("showDetail with no error text on the frame falls back to the literal", () => {
    expect(retryStatusFrom(retryFrame({ attempt: 5, error: "" }), 0)).toMatchObject({ label: "API error" });
    expect(retryStatusFrom(retryFrame({ attempt: 5, error: undefined }), 0)).toMatchObject({ label: "API error" });
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
