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
import { describe, it, expect, vi } from "vitest";
import { probeReflow, parseCursorReport, createCursorReports, DSR_CURSOR_QUERY } from "../../src/tui/reflowOracle.js";

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

  it("answers `reflow` when the re-wrap lands exactly on a row boundary (161 @ 80 → column 1)", async () => {
    const t = fakeTerminal();
    const verdict = probeReflow({ write: t.write, onReply: t.onReply, colBefore: 161, oldWidth: 120, newWidth: 80 });
    t.answer(9, 1);
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

  it("still probes one column short of that multiple (119 @ 120 → 60 lands on 59, which no truncator reports)", async () => {
    const t = fakeTerminal();
    const verdict = probeReflow({ write: t.write, onReply: t.onReply, colBefore: 119, oldWidth: 120, newWidth: 60 });
    expect(t.order).toEqual(["subscribe", "write:\x1b[6n"]);
    t.answer(3, 59);                                       // ((119−1) mod 60) + 1 === 59
    expect(await verdict).toBe("reflow");
  });

  it("still probes from the first column that CAN discriminate (newWidth + 1)", async () => {
    const t = fakeTerminal();
    const verdict = probeReflow({ write: t.write, onReply: t.onReply, colBefore: 81, oldWidth: 120, newWidth: 80 });
    expect(t.order).toEqual(["subscribe", "write:\x1b[6n"]);
    t.answer(3, 1);                                        // ((81−1) mod 80) + 1 === 1
    expect(await verdict).toBe("reflow");
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

  it("waits the documented 150 ms by default, and not a tick less", async () => {
    vi.useFakeTimers();
    try {
      const t = fakeTerminal();
      let settled: string | undefined;
      void probeReflow({ write: t.write, onReply: t.onReply, colBefore: 121, oldWidth: 120, newWidth: 80 }).then((v) => { settled = v; });
      await vi.advanceTimersByTimeAsync(149);
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
// stale column — a fact about the PREVIOUS geometry — to whichever probe is listening now. Below, the stale
// column is 1, and 1 is exactly what the second probe's own re-wrap arithmetic expects: the corrupted answer is
// "reflow", the verdict that erases live transcript rows. So a probe stays installed after it gives up, long
// enough to eat its own late answer, and the bus hands each reply to ONE probe, oldest first.
describe("probeReflow — a late reply belongs to the probe that asked for it", () => {
  it("does not let a timed-out probe's late answer resolve the NEXT probe", async () => {
    const reports = createCursorReports();
    const a = await probeReflow({ write: () => {}, onReply: reports.onReply, colBefore: 161, oldWidth: 120, newWidth: 80, timeoutMs: 1 });
    expect(a).toBe("unknown");                             // A gave up: ((161−1) mod 80) + 1 === 1 never arrived
    const b = probeReflow({ write: () => {}, onReply: reports.onReply, colBefore: 121, oldWidth: 120, newWidth: 60, timeoutMs: 25 });
    reports.deliver("\x1b[9;1R");                          // …and now it does — but ((121−1) mod 60) + 1 is ALSO 1
    expect(await b).toBe("unknown");                       // B timed out honestly; it was not fed A's answer
  });

  it("still answers the next probe from ITS OWN reply once the stale one has been eaten", async () => {
    const reports = createCursorReports();
    expect(await probeReflow({ write: () => {}, onReply: reports.onReply, colBefore: 161, oldWidth: 120, newWidth: 80, timeoutMs: 1 })).toBe("unknown");
    const b = probeReflow({ write: () => {}, onReply: reports.onReply, colBefore: 121, oldWidth: 120, newWidth: 60, timeoutMs: 500 });
    reports.deliver("\x1b[9;1R");                          // A's, swallowed
    reports.deliver("\x1b[3;1R");                          // B's own — the swallower must be out of the way by now
    expect(await b).toBe("reflow");
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
