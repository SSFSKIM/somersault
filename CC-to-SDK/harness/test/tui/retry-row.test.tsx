// tui/test/retry-row.test.tsx — Wave T Task 13: the retry/stalled row REPLACES the spinner. Task 12 built
// the recognition half (`retryStatusFrom` → `state.retryStatus`); this pins the rendering half against canon
// `qyn` (bundle L407973-408034) and pins the replacement at ChatApp's single live-turn indicator mount.
//
// Canon copy verified character for character at L407989-8001 (stalled) and L408002-34 (retrying); the ✻ is
// `i5 = "✻"` (L41482), the same glyph the spinner animates. The ONE deliberate divergence is the
// stalled row's ` · will retry in <dur>` clause — see the stalled test's comment.
import { describe, it, expect, afterEach, vi } from "vitest";
import React, { act } from "react";
import { render } from "ink-testing-library";
import { renderWithKeymap, tick } from "./keysTestUtil.js";
import { RetryRow, retryCountdown } from "../../src/tui/RetryRow.js";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { fakeRemote } from "./helpers/fakeRemote.js";
import { setTheme } from "../../src/tui/theme.js";

afterEach(() => { setTheme("auto"); vi.useRealTimers(); });

const plain = (s: string | undefined) => (s ?? "").replace(/\x1b\[[0-9;]*m/g, "");
const line = (f: () => string | undefined) => plain(f()).replace(/\n/g, " ").replace(/\s+/g, " ").trim();
const retryFrame = (over: Record<string, unknown> = {}) => ({
  type: "system", subtype: "api_retry", attempt: 1, max_retries: 10, retry_delay_ms: 5000, error_status: null, error: "unknown", ...over,
});
async function waitForFakeTimers(cond: () => boolean, timeout = 2_000) {
  for (let elapsed = 0; elapsed <= timeout; elapsed += 5) {
    if (cond()) return;
    await act(async () => { await vi.advanceTimersByTimeAsync(5); });
  }
  throw new Error("waitForFakeTimers timeout");
}
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) return; if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}

describe("RetryRow: the retrying variant", () => {
  it("paints the canon row at a fixed injected now", () => {
    const { lastFrame } = render(<RetryRow status={{ kind: "retrying", attempt: 3, maxRetries: 10, deadline: 5_000, label: "authentication_failed" }} now={() => 2_000} />);
    expect(line(lastFrame)).toBe("✻ authentication_failed · Retrying in 3s · attempt 3/10");
  });

  it("counts down as `now` advances, and floors at 0s past the deadline", () => {
    let clock = 2_000;
    const status = { kind: "retrying" as const, attempt: 1, maxRetries: 10, deadline: 5_000, label: "API error" };
    const { lastFrame, rerender } = render(<RetryRow status={status} now={() => clock} />);
    expect(line(lastFrame)).toBe("✻ API error · Retrying in 3s · attempt 1/10");
    clock = 4_100; rerender(<RetryRow status={status} now={() => clock} />);
    expect(line(lastFrame)).toBe("✻ API error · Retrying in 1s · attempt 1/10");
    clock = 9_000; rerender(<RetryRow status={status} now={() => clock} />);
    expect(line(lastFrame)).toBe("✻ API error · Retrying in 0s · attempt 1/10");
  });
});

describe("retryCountdown: canon `ra` restricted to whole-second remainders", () => {
  it("prints bare seconds under a minute", () => {
    expect(retryCountdown(0)).toBe("0s");
    expect(retryCountdown(-5_000)).toBe("0s");        // Math.max(0, …) — a passed deadline never goes negative
    expect(retryCountdown(1)).toBe("1s");             // …and Math.ceil — any remainder at all still reads as a second
    expect(retryCountdown(12_000)).toBe("12s");
    expect(retryCountdown(59_400)).toBe("1m 0s");     // canon tests the CEILED value: ceil(59.4)s = 60000ms is not < 60000
  });
  it("prints minutes and seconds from a minute to five", () => {
    expect(retryCountdown(60_000)).toBe("1m 0s");
    expect(retryCountdown(65_000)).toBe("1m 5s");
    expect(retryCountdown(299_000)).toBe("4m 59s");
  });
  it("collapses to the most significant unit at five minutes (canon `mostSignificantOnly`)", () => {
    expect(retryCountdown(300_000)).toBe("5m");
    expect(retryCountdown(3_600_000)).toBe("1h");
    expect(retryCountdown(86_400_000)).toBe("1d");
  });
});

describe("RetryRow: the stalled variant", () => {
  // DELIBERATE DIVERGENCE, one clause. Canon's `qyn` computes `$ra` from `GLe.deadline` BEFORE it branches
  // on `kind`, so upstream's stalled row DOES carry a duration: `" · will retry in ", $ra, " · check your
  // network"` (L407989-8001), and `{ kind: "stalled", deadline: Date.now() + Math.max(0, Kn - ss) }` is
  // minted at L358821 — `Kn` being `Math.min(pYi(…), watchdog)`, the request's own abort timeout, read from
  // INSIDE the fetch that stalled. We are outside that fetch: the timeout is chosen per request by env vars
  // and a gate (`dYi`/`pYi`, L99030-99044) inside the `claude` CLI subprocess, no frame reports it, and our
  // stall is measured from the REPL's turn clock, a different origin. So the clause has no honest source
  // here and is dropped rather than faked — the same reduction Task 12 documents for upstream's `b0p`
  // disjunction. Everything else is verbatim.
  it("paints the canon row with no countdown clause", () => {
    const { lastFrame } = render(<RetryRow status={{ kind: "stalled" }} now={() => 2_000} />);
    expect(line(lastFrame)).toBe("✻ Waiting for API response · check your network");
  });
});

describe("ChatApp: the row replaces the spinner", () => {
  it("an api_retry frame swaps the spinner out for the retry row", async () => {
    const fake = fakeRemote();
    const { lastFrame, unmount } = renderWithKeymap(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd="/work" />);
    await tick();
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    await waitFor(() => line(lastFrame).includes("esc to interrupt"));   // the spinner is up first
    fake.pushEvent({ kind: "message", data: retryFrame({ attempt: 4, error: "overloaded", retry_delay_ms: 5000 }) });
    await waitFor(() => line(lastFrame).includes("Retrying in"));
    const f = line(lastFrame);
    expect(f).toContain("✻ overloaded · Retrying in");
    expect(f).toContain("· attempt 4/10");
    expect(f).not.toContain("esc to interrupt");                          // …and the spinner is GONE, not beside it
    unmount();
  });

  it("ten seconds of a turn with no frame at all paints the stalled row instead of the spinner", async () => {
    const fake = fakeRemote();
    const { lastFrame, unmount } = renderWithKeymap(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd="/work" />);
    await tick();
    vi.useFakeTimers();
    try {
      await act(async () => { fake.pushEvent({ kind: "turn", phase: "start", seq: 1 }); });
      await waitForFakeTimers(() => line(lastFrame).includes("esc to interrupt"));
      expect(line(lastFrame)).not.toContain("Waiting for API response");
      await waitForFakeTimers(() => line(lastFrame).includes("Waiting for API response"), 15_000);
      const f = line(lastFrame);
      expect(f).toContain("✻ Waiting for API response · check your network");
      expect(f).not.toContain("esc to interrupt");
    } finally { unmount(); }
  });

  it("a frame arriving inside the window restarts the stall clock, and a later frame clears the row", async () => {
    const fake = fakeRemote();
    const { lastFrame, unmount } = renderWithKeymap(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd="/work" />);
    await tick();
    vi.useFakeTimers();
    try {
      await act(async () => { fake.pushEvent({ kind: "turn", phase: "start", seq: 1 }); });
      await act(async () => { await vi.advanceTimersByTimeAsync(8_000); });
      await act(async () => { fake.pushEvent({ kind: "message", data: { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hi" } } } }); });
      await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });   // 13 s into the turn, 5 s since the frame
      expect(line(lastFrame)).not.toContain("Waiting for API response");
      await waitForFakeTimers(() => line(lastFrame).includes("Waiting for API response"), 15_000);
      // …and a frame that finally lands tears the row down and gives the spinner back.
      await act(async () => { fake.pushEvent({ kind: "message", data: { type: "assistant", message: { content: [{ type: "text", text: "recovered" }] } } }); });
      await waitForFakeTimers(() => line(lastFrame).includes("esc to interrupt"));
      expect(line(lastFrame)).not.toContain("Waiting for API response");
    } finally { unmount(); }
  });
});
