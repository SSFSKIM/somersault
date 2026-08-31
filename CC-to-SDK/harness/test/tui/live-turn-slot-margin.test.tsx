// test/tui/live-turn-slot-margin.test.tsx — T-SPACE Task 3 fix wave (review finding 1, Important).
//
// `ChatApp.tsx`'s live-turn slot wraps ALL THREE of RetryRow/CompactionRow/TurnSpinner in one shared
// `<Box marginTop={1}>` (spec §2.2/D16, canon `Gn` cli.pretty.js:77727 — an unconditional margin on the
// slot, not on any one verb component). Nothing in the suite pinned that "all three" — the review's
// mutation 3 moved the margin off the shared wrapper onto `TurnSpinner` alone (so RetryRow/CompactionRow
// silently lose their leading blank) and the entire 4949-test suite stayed green. These three tests close
// that gap: each drives ChatApp into exactly one of the slot's three states and asserts the leading blank
// row is there, directly, rather than relying on `chrome-margin-tallwrite.test.tsx`'s tall-write proxy
// (which cannot distinguish "margin present" from "margin absent" — a shorter band can never overflow).
//
// Mutation evidence (recorded by hand, not committed): with the wrapper narrowed to only `TurnSpinner`
// (`ChatApp.tsx`'s slot rewritten so RetryRow/CompactionRow render bare and only the TurnSpinner arm keeps
// its own `<Box marginTop={1}>`), the retry and compaction tests below FAIL (their row 0 becomes the
// content line instead of blank); the spinner test stays green, as expected, since TurnSpinner keeps its
// margin under that exact mutation — it is a control proving the assertion technique is sound, not a gap.
import { describe, it, expect } from "vitest";
import React from "react";
import { renderWithKeymap, tick } from "./keysTestUtil.js";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { fakeRemote } from "./helpers/fakeRemote.js";
import { spinnerUp } from "./helpers/spinnerRow.js";

const plain = (s: string | undefined) => (s ?? "").replace(/\x1b\[[0-9;]*m/g, "");
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) return; if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}

describe("T-SPACE Task 3 fix wave: the live-turn slot's marginTop covers all three verb components", () => {
  it("TurnSpinner: the slot's blank row sits directly above the spinner content", async () => {
    const fake = fakeRemote();
    const { lastFrame, unmount } = renderWithKeymap(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd="/work" />);
    await tick();
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    await waitFor(() => spinnerUp(plain(lastFrame())));
    const lines = plain(lastFrame()).split("\n");
    expect(lines[0]).toBe("");                // the slot's marginTop — no other chrome precedes it here
    expect(spinnerUp(lines[1] ?? "")).toBe(true);
    unmount();
  });

  it("RetryRow: the slot's blank row sits directly above the retry row, with no spinner beside it", async () => {
    const fake = fakeRemote();
    const { lastFrame, unmount } = renderWithKeymap(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd="/work" />);
    await tick();
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent({ kind: "message", data: { type: "system", subtype: "api_retry", attempt: 1, max_retries: 10, retry_delay_ms: 5000, error_status: null, error: "unknown" } });
    await waitFor(() => plain(lastFrame()).includes("Retrying"));
    const lines = plain(lastFrame()).split("\n");
    expect(lines[0]).toBe("");
    expect(lines[1]).toContain("Retrying");
    unmount();
  });

  it("CompactionRow: the slot's blank row sits directly above the compaction row", async () => {
    const fake = fakeRemote();
    const { lastFrame, unmount } = renderWithKeymap(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd="/work" />);
    await tick();
    fake.pushEvent({ kind: "message", data: { type: "system", subtype: "status", status: "compacting" } });
    await waitFor(() => plain(lastFrame()).includes("Compacting"));
    const lines = plain(lastFrame()).split("\n");
    expect(lines[0]).toBe("");
    expect(lines[1]).toContain("Compacting");
    unmount();
  });
});
