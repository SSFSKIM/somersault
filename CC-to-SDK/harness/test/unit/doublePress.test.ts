// tui/test/unit/doublePress.test.ts — Wave C Task 3 (EP-C7a). Pins upstream's double-press primitive `Pee`
// (annex §C7.1, bundle L183445) and its 800 ms default (`fpy`, L183463): the first press runs the
// `onFirstPress` side effect AND arms, a second press inside the window disarms and runs the action, and the
// arm auto-clears on expiry. Plus the two additions this port owes its callers — `disarm` (the busy-interrupt
// path must be able to cancel a pending arm) and `dispose` (an armed timer firing `setState` after unmount).
//
// EVERY TIMER HERE IS INJECTED (plan constraint 15): `fakeClock` below is the whole clock — no `await sleep`,
// no vitest fake timers — so an ordering mistake fails deterministically instead of flaking.
import { describe, it, expect } from "vitest";
import { createDoublePress, DOUBLE_PRESS_WINDOW_MS } from "../../src/tui/keys/doublePress.js";

/** The primitive's `deps` seam driven synthetically: `now()` reads the same virtual clock `advance(ms)` moves,
 *  so a press "at t = 799" and a timer "due at t = 800" cannot disagree about which came first. */
function fakeClock() {
  let now = 0, seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    deps: {
      now: (): number => now,
      setTimeout: (fn: () => void, ms: number): unknown => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; },
      clearTimeout: (h: unknown): void => { timers.delete(h as number); },
    },
    /** Move the clock WITHOUT running anything due. `advance` fires due timers before it returns, so a press
     *  "at exactly the window" can never be observed through it — the expiry has already disarmed. This is the
     *  only way to reach the state the `<=` in `press` actually decides: elapsed == windowMs, handle still
     *  live. (Real time can produce it: the event loop delivers a keypress before a same-millisecond timer.) */
    jump(ms: number): void { now += ms; },
    advance(ms: number): void {
      const target = now + ms;
      for (;;) {
        let id = -1, at = Infinity;
        for (const [k, t] of timers) if (t.at <= target && t.at < at) { id = k; at = t.at; }
        if (id < 0) break;
        const t = timers.get(id)!; timers.delete(id); now = t.at; t.fn();
      }
      now = target;
    },
    pending: (): number => timers.size,
  };
}

/** One press-recorder per test: `arms` is the `onArmChange` transcript, so an assertion can pin the ORDER of
 *  arm/disarm as well as the counts. */
function spy() {
  const arms: boolean[] = [];
  let first = 0, second = 0;
  return {
    arms, get first() { return first; }, get second() { return second; },
    handlers: { onArmChange: (a: boolean) => { arms.push(a); }, onSecondPress: () => { second++; }, onFirstPress: () => { first++; } },
  };
}

describe("createDoublePress — the arm (annex §C7.1, `Pee` L183445)", () => {
  it("first press runs onFirstPress AND arms, without firing the action", () => {
    const clock = fakeClock(), s = spy();
    const dp = createDoublePress(s.handlers, 800, clock.deps);
    dp.press();
    expect(s.first).toBe(1);
    expect(s.arms).toEqual([true]);
    expect(s.second).toBe(0);
    expect(clock.pending()).toBe(1);                       // the expiry is scheduled, not run
  });
  it("second press inside the window disarms, fires the action, and does NOT re-run onFirstPress", () => {
    const clock = fakeClock(), s = spy();
    const dp = createDoublePress(s.handlers, 800, clock.deps);
    dp.press();
    clock.advance(799);
    dp.press();
    expect(s.second).toBe(1);
    expect(s.first).toBe(1);                               // `r?.()` lives only in the else branch
    expect(s.arms).toEqual([true, false]);
    expect(clock.pending()).toBe(0);                       // `a()` cancelled the expiry
  });
  it("expiry disarms through onArmChange(false) and never fires the action", () => {
    const clock = fakeClock(), s = spy();
    const dp = createDoublePress(s.handlers, 800, clock.deps);
    dp.press();
    clock.advance(800);
    expect(s.arms).toEqual([true, false]);
    expect(s.second).toBe(0);
    expect(clock.pending()).toBe(0);
  });
  it("a press after expiry re-arms rather than firing the action (upstream's `s.current !== void 0` guard)", () => {
    const clock = fakeClock(), s = spy();
    const dp = createDoublePress(s.handlers, 800, clock.deps);
    dp.press();
    clock.advance(800);                                    // armed → expired
    dp.press();                                            // 0 ms after the expiry, but the handle is gone
    expect(s.second).toBe(0);
    expect(s.first).toBe(2);
    expect(s.arms).toEqual([true, false, true]);
  });
  it("a press at EXACTLY the window boundary still fires the action (upstream's `<=`, not `<`)", () => {
    const clock = fakeClock(), s = spy();
    const dp = createDoublePress(s.handlers, 800, clock.deps);
    dp.press();
    clock.jump(800);                                       // t = 800 with the expiry still pending, not yet run
    expect(clock.pending()).toBe(1);                       // the arm is live — this is the boundary, not after it
    dp.press();
    expect(s.second).toBe(1);                              // `l - i.current <= n`: 800 <= 800 is a SECOND press
    expect(s.first).toBe(1);
    expect(s.arms).toEqual([true, false]);
    expect(clock.pending()).toBe(0);
  });
  it("three presses inside one window are second-press, then re-arm — the arm is not sticky", () => {
    const clock = fakeClock(), s = spy();
    const dp = createDoublePress(s.handlers, 800, clock.deps);
    dp.press(); clock.advance(10); dp.press();             // → action
    clock.advance(10); dp.press();                         // → a fresh arm, not a second action
    expect(s.second).toBe(1);
    expect(s.arms).toEqual([true, false, true]);
  });
  it("defaults its window to 800 ms (upstream `fpy`, L183463)", () => {
    expect(DOUBLE_PRESS_WINDOW_MS).toBe(800);
    const clock = fakeClock(), s = spy();
    const dp = createDoublePress(s.handlers, undefined, clock.deps);
    dp.press();
    clock.advance(799);
    expect(s.arms).toEqual([true]);                        // still armed one tick shy of the default window
    clock.advance(1);
    expect(s.arms).toEqual([true, false]);
  });
  it("onFirstPress is optional", () => {
    const clock = fakeClock();
    const arms: boolean[] = []; let second = 0;
    const dp = createDoublePress({ onArmChange: (a) => { arms.push(a); }, onSecondPress: () => { second++; } }, 800, clock.deps);
    dp.press(); clock.advance(1); dp.press();
    expect([arms, second]).toEqual([[true, false], 1]);
  });
});

describe("createDoublePress — disarm and dispose", () => {
  it("disarm cancels a pending arm: onArmChange(false), timer gone, and the next press is a FIRST press", () => {
    const clock = fakeClock(), s = spy();
    const dp = createDoublePress(s.handlers, 800, clock.deps);
    dp.press();
    dp.disarm();
    expect(s.arms).toEqual([true, false]);
    expect(clock.pending()).toBe(0);
    clock.advance(10);
    dp.press();                                            // well inside the ORIGINAL window — still a first press
    expect(s.second).toBe(0);
    expect(s.first).toBe(2);
    expect(s.arms).toEqual([true, false, true]);
  });
  it("disarm on an unarmed primitive notifies nothing (no spurious setState)", () => {
    const clock = fakeClock(), s = spy();
    const dp = createDoublePress(s.handlers, 800, clock.deps);
    dp.disarm();
    expect(s.arms).toEqual([]);
    dp.press(); clock.advance(800);                        // armed → expired
    dp.disarm();
    expect(s.arms).toEqual([true, false]);
  });
  it("dispose stops an armed timer from ever firing (plan-review #7: no setState after unmount)", () => {
    const clock = fakeClock(), s = spy();
    const dp = createDoublePress(s.handlers, 800, clock.deps);
    dp.press();
    dp.dispose();
    expect(clock.pending()).toBe(0);
    clock.advance(5000);
    expect(s.arms).toEqual([true]);                        // no disarm notification after unmount
  });
  it("a press or disarm after dispose is inert — it cannot schedule a new timer", () => {
    const clock = fakeClock(), s = spy();
    const dp = createDoublePress(s.handlers, 800, clock.deps);
    dp.dispose();
    dp.press(); dp.disarm();
    expect(s.arms).toEqual([]);
    expect(s.first).toBe(0);
    expect(clock.pending()).toBe(0);
  });
});
