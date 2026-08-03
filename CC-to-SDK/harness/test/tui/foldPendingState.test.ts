// tui/test/foldPendingState.test.ts — F3 Task 4 (plan 2026-08-04-tui-clone-f3): the pending region's two
// stateful behaviors, tested as pure state with an injected clock. The RENDER side (italic body, the
// `OAH` clamp, the latched row) is pinned in toolRenderer.test.tsx; this file owns the state machine.
import { describe, expect, it } from "vitest";
import { FoldPendingState, HINT_DEBOUNCE_MS, THINKING_LINGER_MS } from "../../src/tui/foldPendingState.js";
import type { GroupCounts } from "../../src/tui/toolFold.js";

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
