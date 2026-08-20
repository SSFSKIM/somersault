// tui/test/retry-row.test.tsx — Wave T Task 13: the retry/stalled row REPLACES the spinner. Task 12 built
// the recognition half (`retryStatusFrom` → `state.retryStatus`); this pins the rendering half against canon
// `qyn` (bundle L407975-408035, mounted at L407973) and pins the replacement at ChatApp's single live-turn
// indicator mount.
//
// Canon copy verified character for character at L407989-8001 (stalled — label L407992, tail L407997) and
// L408002-34 (retrying — tail L408007, label L408010); the ✻ is
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
// Wave C Task 6: the interrupt offer left the spinner tail for the footer hint list, so that copy can no
// longer tell "the spinner is up" from "a turn is running" — see helpers/spinnerRow.ts for the needle.
import { spinnerUp } from "./helpers/spinnerRow.js";

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

// F8 T6 REVIEW (Finding B). `reducedMotion` is a NEW prop on this component (RetryRow.tsx:47) and a new
// disarm path at RetryRow.tsx:48 (`useAnimationClock(reducedMotion ? null : 120, 0, now)`), and unlike
// TurnSpinner/CompactionRow — whose reduced-motion branches shipped with tests in earlier tasks — this file
// had never once mentioned the string `reducedMotion` before this block. `useAnimationClock`'s own contract
// (animationClock.ts:30) is that a `null` interval never even calls `setInterval`, so under reduced motion
// the row has NOTHING driving a self-triggered repaint — its 120 ms tick is the only thing that would; the
// countdown text still computes fresh off `now()` on any render RetryRow gets for an unrelated reason (a new
// wire frame, say), which is why this is framed as "no self-repaint" rather than "the text is frozen".
describe("RetryRow: reduced motion (F8 T6)", () => {
  it("disarms the periodic repaint — the countdown holds still across elapsed time with nothing else forcing a render", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);                                            // deterministic small `Date.now()`, not the real epoch
    try {
      const status = { kind: "retrying" as const, attempt: 2, maxRetries: 10, deadline: 20_000, label: "API error" };
      const { lastFrame } = render(<RetryRow status={status} reducedMotion />);   // `now` defaults to Date.now
      const first = lastFrame();
      await act(async () => { await vi.advanceTimersByTimeAsync(8_000); });   // far past the 120ms tick this disarms
      expect(lastFrame()).toBe(first);
    } finally { vi.useRealTimers(); }
  });

  it("stalled variant: reduced motion disarms the same tick (the glyph never animates in this branch anyway, but the seam is shared)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      const { lastFrame } = render(<RetryRow status={{ kind: "stalled" }} reducedMotion />);
      const first = lastFrame();
      await act(async () => { await vi.advanceTimersByTimeAsync(8_000); });
      expect(lastFrame()).toBe(first);
      expect(line(lastFrame)).toBe("✻ Waiting for API response · check your network");
    } finally { vi.useRealTimers(); }
  });

  it("WITHOUT reduced motion (the default), the same elapsed time DOES move the row — proving the freeze above is the prop, not a test artifact", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      const status = { kind: "retrying" as const, attempt: 2, maxRetries: 10, deadline: 20_000, label: "API error" };
      const { lastFrame } = render(<RetryRow status={status} />);   // reducedMotion defaults false
      const first = lastFrame();
      await act(async () => { await vi.advanceTimersByTimeAsync(8_000); });
      expect(lastFrame()).not.toBe(first);
    } finally { vi.useRealTimers(); }
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
  // network"` (L407997), and `{ kind: "stalled", deadline: Date.now() + Math.max(0, Kn - ss) }` is
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
    await waitFor(() => spinnerUp(line(lastFrame)));   // the spinner is up first
    fake.pushEvent({ kind: "message", data: retryFrame({ attempt: 4, error_status: 529, error: "overloaded", retry_delay_ms: 5000 }) });
    await waitFor(() => line(lastFrame).includes("Retrying in"));
    const f = line(lastFrame);
    expect(f).toContain("✻ API overloaded · Retrying in");                  // canon `rZp` prose, not the wire slug
    expect(f).toContain("· attempt 4/10");
    expect(spinnerUp(f)).toBe(false);                          // …and the spinner is GONE, not beside it
    unmount();
  });

  it("ten seconds of a turn with no frame at all paints the stalled row instead of the spinner", async () => {
    const fake = fakeRemote();
    const { lastFrame, unmount } = renderWithKeymap(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd="/work" />);
    await tick();
    vi.useFakeTimers();
    try {
      await act(async () => { fake.pushEvent({ kind: "turn", phase: "start", seq: 1 }); });
      await waitForFakeTimers(() => spinnerUp(line(lastFrame)));
      expect(line(lastFrame)).not.toContain("Waiting for API response");
      await waitForFakeTimers(() => line(lastFrame).includes("Waiting for API response"), 15_000);
      const f = line(lastFrame);
      expect(f).toContain("✻ Waiting for API response · check your network");
      expect(spinnerUp(f)).toBe(false);
    } finally { unmount(); }
  });

  // CRITICAL 1 regression. The watchdog is anchored to TURN START, not to a rolling frame gap: the first
  // frame that proves the API answered retires it for the rest of the turn. A rolling gap would paint
  // `✻ Waiting for API response · check your network` under `⏺ Bash(npm test)` after ten quiet seconds of a
  // perfectly healthy command — canon cannot produce that, because its `Ss` (L358804-22) measures silence
  // INSIDE the fetch. Our only mid-tool keepalive is `tool_progress` on a 30 s interval, three times this
  // threshold, so a rolling gap would also oscillate stalled → spinner → stalled for a one-minute command.
  it("a tool_use frame retires the watchdog — a long healthy tool run never paints the stalled row", async () => {
    const fake = fakeRemote();
    const { lastFrame, unmount } = renderWithKeymap(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd="/work" />);
    await tick();
    vi.useFakeTimers();
    try {
      await act(async () => { fake.pushEvent({ kind: "turn", phase: "start", seq: 1 }); });
      await act(async () => {
        fake.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "npm test" } }] } } });
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(12_000); });   // `npm test` is simply running
      expect(line(lastFrame)).not.toContain("Waiting for API response");
      expect(spinnerUp(line(lastFrame))).toBe(true);                   // the spinner, unchanged
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });   // …and it stays retired, no oscillation
      expect(line(lastFrame)).not.toContain("Waiting for API response");
    } finally { unmount(); }
  });

  // EXTERNAL REVIEW, the false NEGATIVE the fix above introduced. The shipped rule was "every frame that is
  // not api_retry retires the watchdog", and `system/init` is the CLI's OWN startup frame — local, carrying
  // the session's permissionMode, seen by probe 99 on every turn ~3.3 s in, before any model output exists.
  // On a blackholed endpoint probe 96 measured ~75 s of silence before the FIRST api_retry frame, so init
  // landed inside the 10 s window every single time and the stalled row never appeared in the one outage
  // this whole mechanism was built to surface. This test and the `tool_use` guard above pull in opposite
  // directions on purpose: retiring on too little re-creates the false alarm, retiring on too much re-creates
  // this silence. Both must stay green.
  it("the CLI's own system/init frame does NOT retire the watchdog — a dead upstream still paints stalled", async () => {
    const fake = fakeRemote();
    const { lastFrame, unmount } = renderWithKeymap(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd="/work" />);
    await tick();
    vi.useFakeTimers();
    try {
      await act(async () => { fake.pushEvent({ kind: "turn", phase: "start", seq: 1 }); });
      await waitForFakeTimers(() => spinnerUp(line(lastFrame)));
      await act(async () => { await vi.advanceTimersByTimeAsync(3_300); });      // probe 99's arrival time
      await act(async () => {
        fake.pushEvent({ kind: "message", data: { type: "system", subtype: "init", session_id: "s", uuid: "u1", permissionMode: "default", model: "claude-sonnet-4-5" } });
      });
      expect(line(lastFrame)).not.toContain("Waiting for API response");        // not yet — the timer is still armed
      await act(async () => { await vi.advanceTimersByTimeAsync(12_000); });     // …and nothing else ever arrives
      expect(line(lastFrame)).toContain("✻ Waiting for API response · check your network");
      expect(spinnerUp(line(lastFrame))).toBe(false);
    } finally { unmount(); }
  });

  it("a frame landing after the stalled row tears it down and gives the spinner back", async () => {
    const fake = fakeRemote();
    const { lastFrame, unmount } = renderWithKeymap(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd="/work" />);
    await tick();
    vi.useFakeTimers();
    try {
      await act(async () => { fake.pushEvent({ kind: "turn", phase: "start", seq: 1 }); });
      await waitForFakeTimers(() => line(lastFrame).includes("Waiting for API response"), 15_000);
      await act(async () => { fake.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "recovered" }] } } }); });
      await waitForFakeTimers(() => spinnerUp(line(lastFrame)));
      expect(line(lastFrame)).not.toContain("Waiting for API response");
    } finally { unmount(); }
  });

  // IMPORTANT 3 regression — the `if (retryRef.current) return;` guard in useChat's stall timer. An
  // api_retry frame is evidence of FAILURE, not of health, so it deliberately does NOT retire the watchdog;
  // probe 96's ladder delays run to 39 s, far past the 10 s timer, so without that guard a live
  // `Retrying in 33s · attempt 7/10` countdown gets overwritten mid-flight by the stalled GUESS.
  it("a live retrying countdown is never downgraded to the stalled guess", async () => {
    const fake = fakeRemote();
    const { lastFrame, unmount } = renderWithKeymap(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd="/work" />);
    await tick();
    vi.useFakeTimers();
    try {
      await act(async () => { fake.pushEvent({ kind: "turn", phase: "start", seq: 1 }); });
      await act(async () => { fake.pushEvent({ kind: "message", data: retryFrame({ attempt: 7, retry_delay_ms: 33_073 }) }); });
      await waitForFakeTimers(() => line(lastFrame).includes("Retrying in"));
      await act(async () => { await vi.advanceTimersByTimeAsync(12_000); });   // past the 10 s stall threshold
      const f = line(lastFrame);
      expect(f).not.toContain("Waiting for API response");
      expect(f).toContain("· attempt 7/10");
    } finally { unmount(); }
  });
});
