// tui/test/animationClock.test.tsx — F8 Task 3. Three properties, each of which a plausible wrong
// implementation gets wrong: a timer that STACKS on an interval change instead of re-arming; a quantizer
// with no high-water clamp (invisible until the mode flips); and a clock that trusts a non-positive
// `startedAt` and measures from 1970.
import React from "react";
import { render } from "ink-testing-library";
import { Text } from "ink";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { useAnimationClock } from "../../src/tui/animationClock.js";

function Probe({ interval, startedAt, now }: { interval: number | null; startedAt: number; now: () => number }) {
  return <Text>{`t=${useAnimationClock(interval, startedAt, now)}`}</Text>;
}

/** React commits passive effects on a task of its own, so a timer armed by `useEffect` is not there yet on
 *  the line after `render`/`rerender` — the count reads one mount behind and the assertions below would pin
 *  the wrong thing. Ink's reconciler schedules that task through `setImmediate`, which is why the fake
 *  timers below name what they replace instead of taking vitest's default set: faking `setImmediate` too
 *  would both strand the effects and make `getTimerCount()` count React's own scheduling. */
const flushEffects = () => new Promise<void>((r) => setImmediate(r));

describe("useAnimationClock", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] }));
  afterEach(() => vi.useRealTimers());

  it("arms one timer, none when null, and exactly one across a change", async () => {
    const now = () => 1000;
    const { rerender, unmount } = render(<Probe interval={50} startedAt={1000} now={now} />);
    await flushEffects();
    expect(vi.getTimerCount()).toBe(1);
    rerender(<Probe interval={100} startedAt={1000} now={now} />);
    await flushEffects();
    expect(vi.getTimerCount()).toBe(1);
    rerender(<Probe interval={null} startedAt={1000} now={now} />);
    await flushEffects();
    expect(vi.getTimerCount()).toBe(0);
    unmount();
    await flushEffects();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never runs backward across the 50ms -> 100ms transition", () => {
    let clock = 1150;                              // 150ms elapsed
    const now = () => clock;
    const { lastFrame, rerender } = render(<Probe interval={50} startedAt={1000} now={now} />);
    expect(lastFrame()).toBe("t=150");
    rerender(<Probe interval={100} startedAt={1000} now={now} />);   // naive requantize gives 100
    expect(lastFrame()).toBe("t=150");
  });

  it("treats a non-positive startedAt as 'just started' rather than 1970", () => {
    const { lastFrame } = render(<Probe interval={100} startedAt={0} now={() => 1_700_000_000_000} />);
    expect(lastFrame()).toBe("t=0");
  });

  // NOT IN THE BRIEF — added because the high-water ref is a hazard as well as a fix. The clamp is over
  // ELAPSED time, not over canon's absolute clock, so a component that outlives one turn and is handed a
  // FRESH `startedAt` would keep returning the old maximum: the glyph and the eased token count would both
  // stand still for the whole of the second turn. A restart resets the water line; nothing else does.
  it("restarts the clock when startedAt does, and only then", () => {
    let clock = 6000, started = 1000;
    const probe = () => <Probe interval={100} startedAt={started} now={() => clock} />;
    const { lastFrame, rerender } = render(probe());
    expect(lastFrame()).toBe("t=5000");
    clock = 4000; rerender(probe());                 // same turn, clock stumbles backwards
    expect(lastFrame()).toBe("t=5000");              // held by the high-water mark
    started = 4000; rerender(probe());               // a NEW turn stamped at 4000
    expect(lastFrame()).toBe("t=0");
  });
});
