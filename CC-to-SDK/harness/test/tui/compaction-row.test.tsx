// tui/test/compaction-row.test.tsx — Wave S Task 11 (W-S7), the rendering half. `compaction-bar.test.ts`
// pins the arithmetic; this pins what a reader actually sees and, more importantly, WHICH row owns the one
// live-turn indicator slot when two candidates want it at once.
import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { renderWithKeymap, tick } from "./keysTestUtil.js";
import { CompactionRow } from "../../src/tui/CompactionRow.js";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { fakeRemote } from "./helpers/fakeRemote.js";

const plain = (s: string | undefined) => (s ?? "").replace(/\x1b\[[0-9;]*m/g, "");
const line = (f: () => string | undefined) => plain(f()).replace(/\n/g, " ").replace(/\s+/g, " ").trim();
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) return; if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}

describe("CompactionRow", () => {
  it("paints the verb, the bar and the trailing percent at an injected clock", () => {
    const { lastFrame } = render(<CompactionRow startedAt={1_000} now={() => 91_000} columns={50} />);
    const f = line(lastFrame);
    expect(f).toContain("Compacting conversation…");
    expect(f).toContain("▰".repeat(25) + "▱".repeat(15) + " 63%");   // 90 s on the curve; width min(40, 50-8)=40
  });

  it("keeps the verb but drops the bar on a terminal too narrow to hold one", () => {
    const { lastFrame } = render(<CompactionRow startedAt={1_000} now={() => 91_000} columns={14} />);
    const f = line(lastFrame);
    expect(f).toContain("Compacting conversation…");
    expect(f).not.toContain("▱");
    expect(f).not.toContain("63%");
  });

  it("never walks backwards when the clock does", () => {
    let clock = 91_000;
    const { lastFrame, rerender } = render(<CompactionRow startedAt={1_000} now={() => clock} columns={50} />);
    expect(line(lastFrame)).toContain("63%");
    clock = 31_000; rerender(<CompactionRow startedAt={1_000} now={() => clock} columns={50} />);
    expect(line(lastFrame)).toContain("63%");                        // not 28% — monotonic
  });
});

describe("ChatApp: compaction owns the live-turn slot", () => {
  it("a system/status compacting frame swaps the ordinary spinner out for the compaction row", async () => {
    const fake = fakeRemote();
    const { lastFrame, unmount } = renderWithKeymap(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd="/work" />);
    await tick();
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    await waitFor(() => line(lastFrame).includes("esc to interrupt"));          // the ordinary spinner first
    fake.pushEvent({ kind: "message", data: { type: "system", subtype: "status", status: "compacting" } });
    await waitFor(() => line(lastFrame).includes("Compacting conversation…"));
    expect(line(lastFrame)).not.toContain("esc to interrupt");                  // replaced, not stacked beside it
    fake.pushEvent({ kind: "message", data: { type: "system", subtype: "compact_boundary", uuid: "cb-1" } });
    await waitFor(() => !line(lastFrame).includes("Compacting conversation…"));
    expect(line(lastFrame)).toContain("esc to interrupt");                      // the turn is still running
    unmount();
  });

  // The precedence question this task had to answer. RetryRow wins: it already owns the whole slot because a
  // pulsing anything beside "Retrying in 4s" reads as "nothing is wrong", and that does not weaken when the
  // thing being retried is a compaction — the API not answering is the more urgent and the rarer news.
  it("a retry during a compaction still wins the slot", async () => {
    const fake = fakeRemote();
    const { lastFrame, unmount } = renderWithKeymap(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd="/work" />);
    await tick();
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent({ kind: "message", data: { type: "system", subtype: "status", status: "compacting" } });
    await waitFor(() => line(lastFrame).includes("Compacting conversation…"));
    fake.pushEvent({ kind: "message", data: { type: "system", subtype: "api_retry", attempt: 2, max_retries: 10, retry_delay_ms: 5000, error_status: 529, error: "overloaded" } });
    await waitFor(() => line(lastFrame).includes("Retrying in"));
    expect(line(lastFrame)).not.toContain("Compacting conversation…");
    unmount();
  });

  // `/compact` runs NO turn — `state.busy` is false for the whole pass — so the slot's gate had to widen
  // beyond `busy` or the typed path would have shown nothing at all for 30–120 s.
  it("a typed /compact shows the row even though no turn is running", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const fake = fakeRemote({ compact: async () => { await gate; return { ok: true, preTokens: 9000, postTokens: 2000 }; }, getContextUsage: async () => ({ totalTokens: 5, maxTokens: 100 }) });
    const { lastFrame, stdin, unmount } = renderWithKeymap(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd="/work" />);
    await tick();
    stdin.write("/compact"); await tick();
    stdin.write("\r");
    await waitFor(() => line(lastFrame).includes("Compacting conversation…"));
    expect(line(lastFrame)).not.toContain("esc to interrupt");
    release();
    await waitFor(() => line(lastFrame).includes("compacted 9k → 2k"));
    expect(line(lastFrame)).not.toContain("Compacting conversation…");          // ephemeral: only the result row persists
    unmount();
  });
});
