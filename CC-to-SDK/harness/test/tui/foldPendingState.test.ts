// tui/test/foldPendingState.test.ts — F3 Task 4 (plan 2026-08-04-tui-clone-f3): the pending region's two
// stateful behaviors, tested as pure state with an injected clock. The RENDER side (italic body, the
// `OAH` clamp, the latched row) is pinned in toolRenderer.test.tsx; this file owns the state machine.
import { describe, expect, it } from "vitest";
import { FoldPendingState, HINT_DEBOUNCE_MS, THINKING_LINGER_MS, stampToolStarts } from "../../src/tui/foldPendingState.js";
import { foldClauses, segmentRuns, type FoldAtom, type GroupCounts } from "../../src/tui/toolFold.js";

const counts = (patch: Partial<GroupCounts> = {}): GroupCounts =>
  ({ readCount: 0, searchCount: 0, listCount: 0, mcpCallCount: 0, mcpServerNames: [], ...patch });

describe("FoldPendingState: R3.2 ratcheting counters", () => {
  it("never lets a counter decrease for the same anchor, per counter", () => {
    const state = new FoldPendingState({ now: () => 0 });
    expect(state.latch("a", counts({ readCount: 5 }))).toMatchObject({ readCount: 5 });
    expect(state.latch("a", counts({ readCount: 3 }))).toMatchObject({ readCount: 5 });
    expect(state.latch("a", counts({ readCount: 7 }))).toMatchObject({ readCount: 7 });
    // Each counter ratchets on its own: a run that gains a search while its read count drops keeps both maxima.
    expect(state.latch("a", counts({ readCount: 0, searchCount: 2, listCount: 4, mcpCallCount: 1 })))
      .toMatchObject({ readCount: 7, searchCount: 2, listCount: 4, mcpCallCount: 1 });
    expect(state.latch("a", counts({ searchCount: 1, listCount: 0, mcpCallCount: 0 })))
      .toMatchObject({ readCount: 7, searchCount: 2, listCount: 4, mcpCallCount: 1 });
  });

  it("passes the non-ratcheted fields of the incoming counts straight through", () => {
    const state = new FoldPendingState({ now: () => 0 });
    state.latch("a", counts({ mcpCallCount: 3, mcpServerNames: ["one"] }));
    // `thoughtForMs` grows on its own clock and the server-name list is the live one — only the four
    // counters are held in refs upstream (R3.2), so nothing else may be frozen here.
    expect(state.latch("a", counts({ mcpCallCount: 1, mcpServerNames: ["one", "two"], thoughtForMs: 4200 })))
      .toEqual({ readCount: 0, searchCount: 0, listCount: 0, mcpCallCount: 3, mcpServerNames: ["one", "two"], thoughtForMs: 4200 });
  });

  it("keeps anchors isolated and forgets everything on reset", () => {
    const state = new FoldPendingState({ now: () => 0 });
    state.latch("a", counts({ readCount: 5 }));
    expect(state.latch("b", counts({ readCount: 1 }))).toMatchObject({ readCount: 1 });   // another run, its own maxima
    expect(state.latch("a", counts({ readCount: 1 }))).toMatchObject({ readCount: 5 });
    state.reset();                                                                        // document swap: rewind / resume / clear
    expect(state.latch("a", counts({ readCount: 1 }))).toMatchObject({ readCount: 1 });
  });

  // TS Task 4: `bashCount` is the FIFTH ratcheted counter (canon 518466 ends with
  // `P.current = Math.max(P.current, e.bashCount ?? 0)`), and it is ratcheted GROSS.
  it("ratchets bashCount like the four classic counters, and only ever reports it when it exists", () => {
    const state = new FoldPendingState({ now: () => 0 });
    expect(state.latch("a", counts({ bashCount: 2 }))).toMatchObject({ bashCount: 2 });
    expect(state.latch("a", counts({ bashCount: 1 }))).toMatchObject({ bashCount: 2 });
    expect(state.latch("a", counts({ bashCount: 4 }))).toMatchObject({ bashCount: 4 });
    expect(state.peek("a", counts({ bashCount: 1 }))).toMatchObject({ bashCount: 4 });
    // A classic run reports no `bashCount` at all, and latching one must not invent the key.
    expect(state.latch("classic", counts({ readCount: 1 }))).toEqual({ readCount: 1, searchCount: 0, listCount: 0, mcpCallCount: 0, mcpServerNames: [] });
    expect(state.peek("classic", counts({ readCount: 1 }))).toEqual({ readCount: 1, searchCount: 0, listCount: 0, mcpCallCount: 0, mcpServerNames: [] });
  });

  it("does NOT ratchet gitOpBashCount — the subtraction must be able to catch up with the watermark", () => {
    // Canon watermarks the gross count and reads `gitOpBashCount` raw (518466–518467). Ratcheting the git tally
    // too would be harmless here but would pin a stale maximum once a run's ops are re-derived downward.
    const state = new FoldPendingState({ now: () => 0 });
    state.latch("a", counts({ bashCount: 1, gitOpBashCount: 1 }));
    expect(state.latch("a", counts({ bashCount: 1, gitOpBashCount: 0 }))).toMatchObject({ bashCount: 1, gitOpBashCount: 0 });
  });

  it("lets the shell clause fall to nothing mid-run even though the watermark never falls", () => {
    // The live sequence the mechanism exists for: `git commit` starts (gross 1, no op yet) ⇒ "Running 1 shell
    // command"; its result is scraped (gross 1, op 1) ⇒ the clause vanishes and the commit takes its place.
    const state = new FoldPendingState({ now: () => 0 });
    const running = state.latch("anchor", counts({ bashCount: 1 }));
    expect(foldClauses(running, true, { fullscreen: true }).map((c) => c.text)).toEqual(["Running 1 shell command"]);
    const settled = state.latch("anchor", counts({ bashCount: 1, gitOpBashCount: 1, commits: [{ sha: "abc123f", kind: "committed" }] }));
    expect(foldClauses(settled, false, { fullscreen: true }).map((c) => c.text)).toEqual(["Committed abc123f"]);
  });

  it("ratchets the GROSS count, so a MIXED run keeps both clauses across the watermark", () => {
    // The whole chain on real atoms — `segmentRuns` → `latch` → `foldClauses` — with gross ≠ git-op, which is the
    // only shape that can tell a gross watermark from a net one. Watermarking `max(0, gross - gitOp)` instead
    // (the subtraction placed BEFORE the ratchet rather than after it) still reads "Committed abc123f" here but
    // silently loses the `npm test` clause, and every single-call cell above agrees with it.
    const bash = (sequence: number, command: string, output: string): FoldAtom => ({
      kind: "tool",
      event: { id: `tool-${sequence}`, name: "Bash", input: { command }, callSequence: sequence, route: "top-level", result: { content: output, isError: false, resultSequence: sequence + 1 } },
    });
    const items = segmentRuns([bash(1, "git commit -m x", "[main abc123f] wire the fold"), bash(3, "npm test", "ok")], { cwd: "/repo", home: "/home/u", fullscreen: true });
    const group = items.flatMap((i) => (i.kind === "group" ? [i.group] : []))[0]!;
    expect(group.counts).toMatchObject({ bashCount: 2, gitOpBashCount: 1 });
    const state = new FoldPendingState({ now: () => 0 });
    expect(foldClauses(state.latch(group.memberIds[0]!, group.counts), false, { fullscreen: true }).map((c) => c.text))
      .toEqual(["Committed abc123f", "ran 1 shell command"]);
  });
});

describe("FoldPendingState: R4.7 step 4 — the 700 ms hint debounce (upstream `MAH`/`e8p`)", () => {
  it("accepts the first value immediately and holds every later one for 700 ms", () => {
    const clock = { now: 0 };
    const state = new FoldPendingState({ now: () => clock.now });
    expect(state.hint("a", "a.ts", undefined)).toEqual({ text: "a.ts", italic: false });
    clock.now = 300;
    expect(state.hint("a", "b.ts", undefined)).toEqual({ text: "a.ts", italic: false });   // too soon
    clock.now = 699;
    expect(state.hint("a", "b.ts", undefined)).toEqual({ text: "a.ts", italic: false });
    clock.now = 700;
    expect(state.hint("a", "b.ts", undefined)).toEqual({ text: "b.ts", italic: false });   // exactly MAH is enough
    clock.now = 750;
    expect(state.hint("a", "c.ts", undefined)).toEqual({ text: "b.ts", italic: false });   // the window restarts at each ACCEPT
    clock.now = 1400;
    expect(state.hint("a", "c.ts", undefined)).toEqual({ text: "c.ts", italic: false });
  });

  it("re-shows the same value without restarting the window, and debounces the disappearance too", () => {
    const clock = { now: 0 };
    const state = new FoldPendingState({ now: () => clock.now });
    state.hint("a", "a.ts", undefined);
    clock.now = 600; expect(state.hint("a", "a.ts", undefined)).toEqual({ text: "a.ts", italic: false });
    clock.now = 700; expect(state.hint("a", "b.ts", undefined)).toEqual({ text: "b.ts", italic: false });
    clock.now = 900; expect(state.hint("a", undefined, undefined)).toEqual({ text: "b.ts", italic: false });
    clock.now = 1400; expect(state.hint("a", undefined, undefined)).toBeUndefined();
  });

  it("holds no hint at all when there never was one, and keeps anchors isolated", () => {
    const clock = { now: 0 };
    const state = new FoldPendingState({ now: () => clock.now });
    expect(state.hint("a", undefined, undefined)).toBeUndefined();
    expect(state.hint("a", "a.ts", undefined)).toEqual({ text: "a.ts", italic: false });   // first REAL value still lands at once
    expect(state.hint("b", "b.ts", undefined)).toEqual({ text: "b.ts", italic: false });   // b's own first value
    clock.now = 100;
    expect(state.hint("a", "z.ts", undefined)).toEqual({ text: "a.ts", italic: false });
    state.reset();
    expect(state.hint("a", "z.ts", undefined)).toEqual({ text: "z.ts", italic: false });
  });
});

describe("FoldPendingState: R4.7 step 5 — the thinking summary lingers 3000 ms (upstream `DAH`/`QWp`)", () => {
  it("wins over the ordinary hint for 3000 ms after the summary last CHANGED, italic-flagged", () => {
    const clock = { now: 0 };
    const state = new FoldPendingState({ now: () => clock.now });
    expect(state.hint("a", "a.ts", "weighing the options")).toEqual({ text: "weighing the options", italic: true });
    clock.now = 2999;
    expect(state.hint("a", "a.ts", "weighing the options")).toEqual({ text: "weighing the options", italic: true });
    clock.now = 3000;   // the linger is measured from the last CHANGE, not from the last sighting
    expect(state.hint("a", "a.ts", "weighing the options")).toEqual({ text: "a.ts", italic: false });
  });

  it("restarts the linger whenever the summary text changes", () => {
    const clock = { now: 0 };
    const state = new FoldPendingState({ now: () => clock.now });
    state.hint("a", "a.ts", "first thought");
    clock.now = 2500;
    expect(state.hint("a", "a.ts", "second thought")).toEqual({ text: "second thought", italic: true });
    clock.now = 5000;
    expect(state.hint("a", "a.ts", "second thought")).toEqual({ text: "second thought", italic: true });   // 2500 into the new linger
    clock.now = 5500;
    expect(state.hint("a", "a.ts", "second thought")).toEqual({ text: "a.ts", italic: false });
  });

  it("keeps debouncing the ordinary hint underneath, so the linger's expiry reveals the CURRENT value", () => {
    const clock = { now: 0 };
    const state = new FoldPendingState({ now: () => clock.now });
    expect(state.hint("a", "a.ts", "thinking")).toEqual({ text: "thinking", italic: true });
    clock.now = 1000; state.hint("a", "b.ts", "thinking");            // accepted underneath, invisible for now
    clock.now = 3000;
    expect(state.hint("a", "b.ts", "thinking")).toEqual({ text: "b.ts", italic: false });
  });

  it("still lingers a summary the caller has stopped passing, and reset clears it", () => {
    const clock = { now: 0 };
    const state = new FoldPendingState({ now: () => clock.now });
    state.hint("a", "a.ts", "a thought");
    clock.now = 1000;
    expect(state.hint("a", "a.ts", undefined)).toEqual({ text: "a thought", italic: true });
    state.reset();
    expect(state.hint("a", "a.ts", undefined)).toEqual({ text: "a.ts", italic: false });
  });

  it("exports upstream's constants under their contract values", () => {
    expect([HINT_DEBOUNCE_MS, THINKING_LINGER_MS]).toEqual([700, 3000]);
  });
});

// TS Task 11: the elapsed ticker's anchor. Canon reads it off the wire timestamp of the newest message holding
// an in-flight tool_use (518532–518543); our wire carries no timestamps (P82), so a member's start is the local
// moment its frame ARRIVED (`stampToolStarts`, called from `useChat`'s ingest beside `stampAgentCalls`). The read
// side never writes. It is the one piece of pending-row state that is deliberately NOT ratcheted.
describe("FoldPendingState: TS T11 — per-member start stamps", () => {
  it("stamps a member ONCE and never moves it, and gives each member its own stamp", () => {
    const clock = { now: 0 };
    const state = new FoldPendingState({ now: () => clock.now });
    state.stamp("m1");
    expect(state.startedAt("m1")).toBe(0);
    clock.now = 5000;
    state.stamp("m1"); state.stamp("m2");
    expect(state.startedAt("m1")).toBe(0);      // an existing stamp is a START, never re-stamped
    expect(state.startedAt("m2")).toBe(5000);   // …and the newcomer's own age begins now
    clock.now = 9000;
    expect(state.startedAt("m1")).toBe(0);      // the anchor can return to m1 at its true age
    expect(state.startedAt("m2")).toBe(5000);
  });

  // T11 REVIEW FIX: reading is not stamping. A member the ingest never saw — a replayed frame, whose arrival
  // is when this client attached and not when the work began — has NO age, and the row must say nothing rather
  // than start a clock at the moment somebody happened to look.
  it("never stamps on a READ: an unstamped member reports no start at all", () => {
    const clock = { now: 0 };
    const state = new FoldPendingState({ now: () => clock.now });
    expect(state.startedAt("m1")).toBeUndefined();
    clock.now = 40_000;
    expect(state.startedAt("m1")).toBeUndefined();   // ← a lazy stamp reports 40_000 as m1's start here
    state.stamp("m1");
    expect(state.startedAt("m1")).toBe(40_000);
  });

  it("does NOT ratchet: the elapsed time it anchors is free to FALL when a newer member takes the anchor", () => {
    // The whole reason this state lives beside the counter watermark rather than inside it. `latch` exists so a
    // live sentence never counts backwards; elapsed time must, or a fresh call would inherit the age of the one
    // before it. Read as canon does — `now - startedAt(newest in-flight)` — the value drops to zero.
    const clock = { now: 0 };
    const state = new FoldPendingState({ now: () => clock.now });
    const elapsed = (member: string) => clock.now - state.startedAt(member)!;
    state.stamp("m1");
    clock.now = 8000;
    state.stamp("m2");                          // the newer call ARRIVES here
    expect(elapsed("m1")).toBe(8000);
    expect(elapsed("m2")).toBe(0);              // ← a Math.max watermark reports 8000 here
  });

  it("keeps stamps out of the counter/hint maps and forgets them all on reset", () => {
    const clock = { now: 0 };
    const state = new FoldPendingState({ now: () => clock.now });
    state.latch("m1", counts({ readCount: 3 }));
    state.hint("m1", "a.ts", undefined);
    clock.now = 400;
    expect(state.startedAt("m1")).toBeUndefined();                                          // latching/hinting an id never stamps it
    state.stamp("m1");
    expect(state.startedAt("m1")).toBe(400);
    expect(state.latch("m1", counts({ readCount: 1 }))).toMatchObject({ readCount: 3 });   // …and vice versa
    state.reset();                              // document swap: rewind / resume / clear
    clock.now = 9000;
    expect(state.startedAt("m1")).toBeUndefined();
    state.stamp("m1");
    expect(state.startedAt("m1")).toBe(9000);
  });

  // The ingest walker itself: one arriving frame, every `tool_use` block it carries, first-write-wins.
  describe("stampToolStarts (the ingest half)", () => {
    const assistant = (...blocks: Record<string, unknown>[]) =>
      ({ type: "assistant", parent_tool_use_id: null, message: { id: "m1", content: blocks } }) as unknown;
    const use = (id: string) => ({ type: "tool_use", id, name: "Read", input: {} });
    it("stamps EVERY tool_use of a parallel batch, and never a non-tool block", () => {
      const clock = { now: 7 };
      const state = new FoldPendingState({ now: () => clock.now });
      stampToolStarts(state, assistant({ type: "text", text: "reading both" }, use("a"), use("b")));
      expect(state.startedAt("a")).toBe(7);
      expect(state.startedAt("b")).toBe(7);     // ← stamping only the newest leaves this undefined
      clock.now = 9000;
      stampToolStarts(state, assistant(use("a")));                       // a redelivered frame
      expect(state.startedAt("a")).toBe(7);
      stampToolStarts(state, { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "c" }] } });
      expect(state.startedAt("c")).toBeUndefined();                      // a RESULT starts nothing
      stampToolStarts(state, undefined); stampToolStarts(state, { type: "assistant" });   // junk is inert
    });
  });
});
