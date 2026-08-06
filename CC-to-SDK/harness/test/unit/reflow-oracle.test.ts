// test/unit/reflow-oracle.test.ts — Wave R task 3, the GATE on the resize correction (W-R6). Task 4's erase is
// only correct on an emulator that RE-WRAPS already-painted text when the window narrows; on one that truncates
// there is no defect to fix and the same erase destroys live transcript rows (SP-R0 destroyed six of them). So
// the correction has to ask the terminal what it did, and act only on a "reflow" answer.
//
// WHY THE COLUMN AND NOT THE ROW: SP-R0 measured a DSR (`\x1b[6n`) round-trip across a 120→80 narrowing under
// tmux and the cursor reported the SAME ROW both times — tmux pins the cursor's screen row and scrolls the
// excess off the top, so re-wrapping and scrolling cancel out exactly. The COLUMN is not pinned: it moved
// 121 → 41, which is `((121−1) mod 80) + 1`, while a truncating emulator destroys that cell instead. Do not
// "simplify" any of this to use the row.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { probeReflow, parseCursorReport, createCursorReports, DSR_CURSOR_QUERY, resetReflowProbingForTest } from "../../src/tui/reflowOracle.js";

// ONE TIMEOUT ENDS PROBING FOR THE PROCESS (see the module header), so the give-up latch is process-wide state and
// every test here has to start from a fresh process's worth of it — otherwise the first timeout test silently
// disables the probe for every test after it and they all pass for the wrong reason.
beforeEach(() => { resetReflowProbingForTest(); });

/** The two seams `probeReflow` takes, wired to a fake terminal: `write` records the query, `onReply` records the
 *  subscription so a test can answer it (or deliberately never answer it). `order` proves the subscription is in
 *  place BEFORE the query goes out — a terminal that answers instantly must not answer into nothing. */
function fakeTerminal() {
  const order: string[] = [];
  let reply: ((row: number, col: number) => void) | null = null;
  let unsubscribes = 0;
  return {
    order,
    get subscribed() { return reply !== null; },
    get unsubscribes() { return unsubscribes; },
    write: (s: string) => { order.push(`write:${s}`); },
    onReply: (cb: (row: number, col: number) => void) => {
      order.push("subscribe");
      reply = cb;
      return () => { unsubscribes++; reply = null; };
    },
    answer: (row: number, col: number) => { reply?.(row, col); },
  };
}

describe("probeReflow — the verdict", () => {
  it("answers `reflow` when the column is where a re-wrap would have put it (SP-R0's 120→80, 121 → 41)", async () => {
    const t = fakeTerminal();
    const verdict = probeReflow({ write: t.write, onReply: t.onReply, colBefore: 121, oldWidth: 120, newWidth: 80 });
    t.answer(3, 41);
    expect(await verdict).toBe("reflow");
  });

  it("answers `truncate` for any other answered column — the cell was destroyed, not moved", async () => {
    for (const col of [121, 80, 42, 1]) {
      const t = fakeTerminal();
      const verdict = probeReflow({ write: t.write, onReply: t.onReply, colBefore: 121, oldWidth: 120, newWidth: 80 });
      t.answer(3, col);
      expect(await verdict, `column ${col}`).toBe("truncate");
    }
  });

  // The verdict is only ever evidence about a SHRINK: widening cannot re-wrap already-painted text. A real grow
  // is refused by the guard above (the cursor cannot have been past the WIDER edge), which is the answer that
  // matters for Task 4's cache: "unknown" is re-probeable, where a cached "truncate" would disable the fix for
  // the life of the process just because the user happened to widen the window first.
  it("carries no verdict across a widening — the round-trip is not even taken", async () => {
    const t = fakeTerminal();
    expect(await probeReflow({ write: t.write, onReply: t.onReply, colBefore: 41, oldWidth: 80, newWidth: 120 })).toBe("unknown");
    expect(t.order).toEqual([]);
  });

  // A HEIGHT-ONLY DRAG KEEPS THE WIDTH, and it must not be answerable. Task 4 caches the verdict, so if an
  // equal-width probe came back "truncate" — as it did before this guard — one height drag would silently
  // disable the correction for the rest of the session. Non-shrinks are "unknown": re-probeable, uncacheable.
  it("takes no round-trip when the width did not shrink, even if the arithmetic would match", async () => {
    const t = fakeTerminal();
    const verdict = probeReflow({ write: t.write, onReply: t.onReply, colBefore: 121, oldWidth: 120, newWidth: 120 });
    t.answer(3, 1);                                        // ((121−1) mod 120) + 1 === 1, and yet: not a shrink
    expect(await verdict).toBe("unknown");
    expect(t.order).toEqual([]);
  });

  it("takes no round-trip on a widening either, whatever column the cursor held", async () => {
    for (const colBefore of [41, 121, 161]) {
      const t = fakeTerminal();
      const verdict = probeReflow({ write: t.write, onReply: t.onReply, colBefore, oldWidth: 80, newWidth: 120 });
      t.answer(3, 41);
      expect(await verdict, `colBefore ${colBefore}`).toBe("unknown");
      expect(t.order, `colBefore ${colBefore}`).toEqual([]);
    }
  });

  // THE PROBE ONLY DISCRIMINATES FROM PAST THE NEW EDGE. SP-R0 parked the cursor at column 121 of an
  // 80-column screen for a reason: a cursor at column 5 satisfies `((5−1) mod 80) + 1 === 5` on a REFLOWING
  // terminal and sits untouched at column 5 on a TRUNCATING one, so both answer 5 and the arithmetic would
  // call a truncating terminal "reflow" — the false positive that over-erases live transcript rows, which is
  // the one failure this whole oracle exists to prevent. There is no information in that round-trip, so it is
  // not taken: the honest verdict is "unknown" (re-probeable), never "truncate" (which Task 4 caches).
  it("refuses to probe when the cursor was NOT past the new right edge — the answer would be identical either way", async () => {
    for (const colBefore of [5, 80]) {
      const t = fakeTerminal();
      const verdict = probeReflow({ write: t.write, onReply: t.onReply, colBefore, oldWidth: 120, newWidth: 80 });
      expect(await verdict, `colBefore ${colBefore}`).toBe("unknown");
      expect(t.order, `colBefore ${colBefore}`).toEqual([]);   // no query written, nothing subscribed
    }
  });

  // THE OTHER ARM OF THE SAME AMBIGUITY. A truncating emulator that CLAMPS the cursor to the new right margin
  // (xterm's documented behaviour on a narrowing resize) answers `newWidth`, and the re-wrap arithmetic ALSO
  // lands on `newWidth` whenever `colBefore` is an exact multiple of it — so a half-width drag (120→60 with the
  // cursor at the old last column) reads as "reflow" and over-erases. Dragging a window to half width is the
  // most ordinary resize there is, so this is refused too, and for the same reason: no information in it.
  it("refuses the column whose re-wrap lands on the new right margin — a clamping truncator answers the same", async () => {
    const t = fakeTerminal();
    const verdict = probeReflow({ write: t.write, onReply: t.onReply, colBefore: 120, oldWidth: 120, newWidth: 60 });
    t.answer(3, 60);                                       // ((120−1) mod 60) + 1 === 60, and so does the clamp
    expect(await verdict).toBe("unknown");
    expect(t.order).toEqual([]);                           // no query written, nothing subscribed
  });

  // THE MARGINS ARE NOT TRUSTWORTHY EITHER — the "a truncator reports only `colBefore` or `newWidth`" model was an
  // unprobed premise, and both of its plausible third behaviours live at a margin: an emulator that HOMES or wraps
  // the cursor answers 1, and one that clamps a cell short of the edge answers `newWidth − 1`. Either would read as
  // "reflow" and over-erase. Nobody has measured a non-reflowing emulator to rule them out, so the whole boundary
  // band is refused: only an INTERIOR re-wrap column (`1 < wrapped < newWidth − 1`) is evidence.
  it("refuses a re-wrap that lands on column 1 — a terminal that homes the cursor answers 1 too (81 @ 120 → 80)", async () => {
    for (const colBefore of [81, 161]) {                   // both re-wrap to ((c−1) mod 80) + 1 === 1
      const t = fakeTerminal();
      const verdict = probeReflow({ write: t.write, onReply: t.onReply, colBefore, oldWidth: 120, newWidth: 80 });
      expect(await verdict, `colBefore ${colBefore}`).toBe("unknown");
      expect(t.order, `colBefore ${colBefore}`).toEqual([]);
    }
  });

  it("refuses a re-wrap that lands one short of the new margin — a clamping truncator can answer that too", async () => {
    const t = fakeTerminal();
    const verdict = probeReflow({ write: t.write, onReply: t.onReply, colBefore: 119, oldWidth: 120, newWidth: 60 });
    expect(await verdict).toBe("unknown");                 // ((119−1) mod 60) + 1 === 59 === newWidth − 1
    expect(t.order).toEqual([]);
  });

  // …and what SURVIVES all of that: an interior column, which is still the ordinary case. `oldWidth − 1` (the column
  // Task 4 parks at) re-wraps to 39 on the canonical 120→80 drag — nowhere near either margin.
  it("still probes, and still answers `reflow`, from an interior re-wrap column (119 @ 120 → 80 lands on 39)", async () => {
    const t = fakeTerminal();
    const verdict = probeReflow({ write: t.write, onReply: t.onReply, colBefore: 119, oldWidth: 120, newWidth: 80 });
    expect(t.order).toEqual(["subscribe", "write:\x1b[6n"]);
    t.answer(3, 39);                                       // ((119−1) mod 80) + 1 === 39
    expect(await verdict).toBe("reflow");
  });

  // `process.stdout.columns` is 0 off a tty, and `colBefore % 0` is NaN — which is not `=== 0`, so the old refusal
  // waved it through, spent a round-trip, compared against a NaN wrapped column and answered "truncate": the
  // CACHEABLE verdict, which would disable Task 4's correction for the life of the process on a bogus width.
  it("takes no round-trip when the new width is not a real width", async () => {
    for (const newWidth of [0, 1, -5, NaN]) {
      const t = fakeTerminal();
      const verdict = probeReflow({ write: t.write, onReply: t.onReply, colBefore: 121, oldWidth: 120, newWidth });
      expect(await verdict, `newWidth ${newWidth}`).toBe("unknown");
      expect(t.order, `newWidth ${newWidth}`).toEqual([]);
    }
  });

  it("takes no round-trip on a non-finite column either (same cacheable-`truncate` trap)", async () => {
    const t = fakeTerminal();
    const verdict = probeReflow({ write: t.write, onReply: t.onReply, colBefore: Infinity, oldWidth: 120, newWidth: 80 });
    expect(await verdict).toBe("unknown");
    expect(t.order).toEqual([]);
  });

  it("ignores the reported ROW entirely (tmux pins it; SP-R0 refuted using it)", async () => {
    for (const row of [1, 3, 40]) {
      const t = fakeTerminal();
      const verdict = probeReflow({ write: t.write, onReply: t.onReply, colBefore: 121, oldWidth: 120, newWidth: 80 });
      t.answer(row, 41);
      expect(await verdict, `row ${row}`).toBe("reflow");
    }
  });
});

describe("probeReflow — the query", () => {
  it("subscribes BEFORE writing the DSR query, and writes exactly `\\x1b[6n`", async () => {
    const t = fakeTerminal();
    const verdict = probeReflow({ write: t.write, onReply: t.onReply, colBefore: 121, oldWidth: 120, newWidth: 80 });
    expect(t.order).toEqual(["subscribe", "write:\x1b[6n"]);
    expect(DSR_CURSOR_QUERY).toBe("\x1b[6n");
    t.answer(3, 41);
    await verdict;
  });

  // The write is a real syscall on a real handle and it can throw synchronously (write-after-end, EPIPE while the
  // terminal is tearing down). Inside the promise executor an uncaught throw REJECTS — on a path whose whole
  // contract is "resolves `unknown` rather than hanging", and an unhandled rejection is worse than the hang.
  it("settles `unknown` instead of rejecting when the write throws, and leaves nothing behind", async () => {
    vi.useFakeTimers();
    try {
      const t = fakeTerminal();
      const verdict = probeReflow({ write: () => { throw new Error("EPIPE"); }, onReply: t.onReply, colBefore: 121, oldWidth: 120, newWidth: 80 });
      await expect(verdict).resolves.toBe("unknown");
      expect(t.subscribed).toBe(false);                    // …and it does not sit at the head of the bus eating replies
      expect(t.unsubscribes).toBe(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it("unsubscribes once the answer lands, and never settles twice", async () => {
    const t = fakeTerminal();
    const verdict = probeReflow({ write: t.write, onReply: t.onReply, colBefore: 121, oldWidth: 120, newWidth: 80 });
    t.answer(3, 41);
    expect(await verdict).toBe("reflow");
    expect(t.unsubscribes).toBe(1);
    expect(t.subscribed).toBe(false);                      // a later stray report reaches nothing
  });
});

// THE TIMEOUT PATH IS NOT A FORMALITY. Many terminals never answer a cursor query at all, and this promise is
// awaited on the resize path — a hang here freezes the UI. "unknown" is also what stops Task 4 from erasing on
// a terminal we could not measure (the asymmetry rule: under-erase is cosmetic, over-erase destroys rows).
describe("probeReflow — the timeout", () => {
  it("RESOLVES `unknown` when the terminal never answers, rather than hanging", async () => {
    const t = fakeTerminal();
    expect(await probeReflow({ write: t.write, onReply: t.onReply, colBefore: 121, oldWidth: 120, newWidth: 80, timeoutMs: 1 })).toBe("unknown");
  });

  // Raised from 150 by task 4: the timeout is a ONE-SHOT FUSE (a single timeout ends probing for the process), so
  // a default shorter than a slow link's round trip would disable the correction permanently on the first shrink.
  it("waits the documented 750 ms by default, and not a tick less", async () => {
    vi.useFakeTimers();
    try {
      const t = fakeTerminal();
      let settled: string | undefined;
      void probeReflow({ write: t.write, onReply: t.onReply, colBefore: 121, oldWidth: 120, newWidth: 80 }).then((v) => { settled = v; });
      await vi.advanceTimersByTimeAsync(749);
      expect(settled).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toBe("unknown");
    } finally { vi.useRealTimers(); }
  });

  // The timeout path leaks no listener either — but it lets go a beat later than the answered path, because the
  // straggler it is holding the line for is the whole point (see "a late reply belongs to the probe that asked").
  it("leaves at most the swallower behind on the timeout path, and a late report is harmless", async () => {
    const t = fakeTerminal();
    expect(await probeReflow({ write: t.write, onReply: t.onReply, colBefore: 121, oldWidth: 120, newWidth: 80, timeoutMs: 1 })).toBe("unknown");
    t.answer(3, 41);                                       // the terminal answering late must not throw
    expect(t.unsubscribes).toBe(1);
    expect(t.subscribed).toBe(false);
  });

  it("cancels the timer when the answer lands, so a pending probe cannot hold the process open", async () => {
    vi.useFakeTimers();
    try {
      const t = fakeTerminal();
      const verdict = probeReflow({ write: t.write, onReply: t.onReply, colBefore: 121, oldWidth: 120, newWidth: 80 });
      t.answer(3, 41);
      expect(await verdict).toBe("reflow");
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});

// A DSR REPLY CARRIES NO CORRELATION TOKEN, so nothing in the bytes says which query it answers. A probe that
// times out on a slow link (ssh, tmux over latency) and is answered a moment later would otherwise hand that
// stale column — a fact about the PREVIOUS geometry — to whichever probe is listening now, and that stale column
// can be exactly the later probe's own "reflow" value: the verdict that erases live transcript rows. A grace
// window only narrows that hole (a reply later than `2 × timeoutMs` outlives the swallower and lands on the next
// probe — demonstrated live). Closing it takes the blunt rule: ONE TIMEOUT ENDS PROBING FOR THE PROCESS.
describe("probeReflow — one timeout ends probing", () => {
  it("refuses every later probe once one has timed out — no query, no subscription, and the straggler lands on nothing", async () => {
    const reports = createCursorReports();
    const a = await probeReflow({ write: () => {}, onReply: reports.onReply, colBefore: 121, oldWidth: 120, newWidth: 80, timeoutMs: 1 });
    expect(a).toBe("unknown");                             // A gave up: ((121−1) mod 80) + 1 === 41 never arrived
    const t = fakeTerminal();
    const b = probeReflow({ write: t.write, onReply: t.onReply, colBefore: 121, oldWidth: 120, newWidth: 80, timeoutMs: 25 });
    expect(t.order).toEqual([]);                           // B never asked, so no answer can be mistaken for its own
    expect(await b).toBe("unknown");
    reports.deliver("\x1b[9;41R");                         // A's straggler, arriving past every window: harmless
    expect(await b).toBe("unknown");
    expect(t.subscribed).toBe(false);
  });

  // The latch is per PROCESS, not per bus or per caller: the fact it records is "this terminal did not answer",
  // and there is only one terminal. A fresh `createCursorReports` does not buy a second chance.
  it("stays latched across a fresh reports bus, and refuses without spending the timeout", async () => {
    expect(await probeReflow({ write: () => {}, onReply: createCursorReports().onReply, colBefore: 121, oldWidth: 120, newWidth: 80, timeoutMs: 1 })).toBe("unknown");
    vi.useFakeTimers();
    try {
      const t = fakeTerminal();
      let settled: string | undefined;
      void probeReflow({ write: t.write, onReply: t.onReply, colBefore: 121, oldWidth: 120, newWidth: 80 }).then((v) => { settled = v; });
      await vi.advanceTimersByTimeAsync(0);                // settles on the spot, not 150 ms later
      expect(settled).toBe("unknown");
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it("swallows its own late answer and hands the subscription back at that moment", async () => {
    const t = fakeTerminal();
    expect(await probeReflow({ write: t.write, onReply: t.onReply, colBefore: 121, oldWidth: 120, newWidth: 80, timeoutMs: 1 })).toBe("unknown");
    expect(t.subscribed).toBe(true);                       // still listening, purely to eat the straggler
    t.answer(3, 41);
    expect(t.subscribed).toBe(false);
    expect(t.unsubscribes).toBe(1);
  });

  it("hands the subscription back after the grace window even when the straggler never comes", async () => {
    vi.useFakeTimers();
    try {
      const t = fakeTerminal();
      let settled: string | undefined;
      void probeReflow({ write: t.write, onReply: t.onReply, colBefore: 121, oldWidth: 120, newWidth: 80, timeoutMs: 10 }).then((v) => { settled = v; });
      await vi.advanceTimersByTimeAsync(10);
      expect(settled).toBe("unknown");                     // resolves ON the timeout, not after the grace
      expect(t.subscribed).toBe(true);
      await vi.advanceTimersByTimeAsync(10);
      expect(t.subscribed).toBe(false);
      expect(t.unsubscribes).toBe(1);
      expect(vi.getTimerCount()).toBe(0);                  // and nothing is left to hold the process open
    } finally { vi.useRealTimers(); }
  });
});

// The reply arrives as a raw byte string (`keys/parse.ts` hands it over verbatim as `ignored("unknown-sequence")`
// — `CSI_LETTER` has no `R`), so the oracle owns the decode.
describe("parseCursorReport", () => {
  it("decodes a DSR cursor report", () => {
    expect(parseCursorReport("\x1b[3;41R")).toEqual({ row: 3, col: 41 });
    expect(parseCursorReport("\x1b[38;121R")).toEqual({ row: 38, col: 121 });
  });

  it("rejects everything that is not one", () => {
    for (const raw of ["\x1b[I", "\x1b[O", "\x1b[<0;10;5M", "\x1b[200~", "\x1b[41R", "\x1b[3;41", "\x1b[3;41Rx", "", "\x1b[?3;41R"])
      expect(parseCursorReport(raw), JSON.stringify(raw)).toBeNull();
  });
});

// The adapter between the two shapes: `KeymapDeps.onUnknownSequence` is ONE raw-string sink (the provider owns
// the single stdin reader — a second one would race), while `probeReflow` wants a subscribe/unsubscribe seam.
describe("createCursorReports", () => {
  it("delivers a decoded report to its subscriber", () => {
    const reports = createCursorReports();
    const seen: Array<[number, number]> = [];
    reports.onReply((row, col) => { seen.push([row, col]); });
    reports.deliver("\x1b[3;41R");
    expect(seen).toEqual([[3, 41]]);
  });

  it("drops raw sequences that are not cursor reports", () => {
    const reports = createCursorReports();
    const seen: Array<[number, number]> = [];
    reports.onReply((row, col) => { seen.push([row, col]); });
    reports.deliver("\x1b[?1;2c");                          // a DA reply: not ours
    reports.deliver("\x1b[200~");
    expect(seen).toEqual([]);
  });

  it("stops delivering once unsubscribed, and delivering with no subscriber is a no-op", () => {
    const reports = createCursorReports();
    const seen: Array<[number, number]> = [];
    const off = reports.onReply((row, col) => { seen.push([row, col]); });
    reports.deliver("\x1b[3;41R");
    off();
    reports.deliver("\x1b[9;1R");
    expect(seen).toEqual([[3, 41]]);
  });

  // Request/response, not broadcast: the Nth reply answers the Nth outstanding query, so it goes to exactly one
  // subscriber and it is the oldest one. Fanning out instead would resolve every listening probe from a single
  // reply — which is how a stale answer reaches a probe it knows nothing about. Task 4 should still keep one
  // probe in flight per resize: a second one queued behind the first is starved until the first lets go.
  it("hands each reply to ONE subscriber, oldest first", () => {
    const reports = createCursorReports();
    const first: Array<[number, number]> = [], second: Array<[number, number]> = [];
    const off = reports.onReply((row, col) => { first.push([row, col]); });
    reports.onReply((row, col) => { second.push([row, col]); });
    reports.deliver("\x1b[3;41R");
    expect(first).toEqual([[3, 41]]);
    expect(second).toEqual([]);                             // NOT fanned out
    off();
    reports.deliver("\x1b[9;1R");
    expect(second).toEqual([[9, 1]]);                       // now it is at the head of the queue
    expect(first).toEqual([[3, 41]]);
  });

  it("carries a real probe end to end", async () => {
    const reports = createCursorReports();
    const verdict = probeReflow({ write: () => {}, onReply: reports.onReply, colBefore: 121, oldWidth: 120, newWidth: 80 });
    reports.deliver("\x1b[3;41R");
    expect(await verdict).toBe("reflow");
  });
});
