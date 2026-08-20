// tui/src/animationClock.ts — F8 Task 3: canon's `Cg` (L204972), the clock every ccx spinner reads.
// Returns MONOTONE elapsed milliseconds, quantized to the repaint interval, and arms no timer at all
// when the interval is null.
//
// THE CLAMP IS THE POINT. Quantizing elapsed time by a VARYING interval is not monotone: at 150ms,
// floor(150/50)*50 = 150 but floor(150/100)*100 = 100, so a turn leaving `requesting` would step its
// clock BACKWARD 50ms — reversing the glyph's cosine and handing the token easing a negative delta.
// Canon has the same hazard and the same fix (`u.current = Math.max(u.current, Math.floor(now/c)*c)`).
// Nothing about this is visible until the mode flips, which is why the lifecycle test exists.
//
// AND THE CLAMP IS ALSO A HAZARD, which canon does not have: canon's `Cg` clamps an ABSOLUTE clock, so it
// rises forever, while ours clamps time ELAPSED SINCE `startedAt`. A component that outlives one turn and
// is handed a fresh stamp would keep returning the previous turn's maximum — a glyph and an eased token
// count frozen for the whole of the second turn. A changed `startedAt` therefore resets the water line;
// nothing else does.
//
// `null` FREEZES. It disarms the timer — under reduced motion the component does no periodic work at all —
// and it also stops the water line where it stands: a disarmed clock that still recomputed `now() - startedAt`
// on every unrelated parent rerender would hand its callers a RISING value with no repaints behind it, which
// is how CompactionRow ended up with a frozen glyph over a creeping bar. Callers write `null` meaning "hold
// still", so hold still. The one thing that still moves a frozen clock is a NEW `startedAt`, which resets it
// to 0 on the disarmed path exactly as on the armed one — that is the turn boundary, not an animation.
import { useEffect, useRef, useState } from "react";

export function useAnimationClock(intervalMs: number | null, startedAt: number, now: () => number = Date.now): number {
  const [, setTick] = useState(0);
  const highWater = useRef(0);
  const stamp = useRef(startedAt);
  useEffect(() => {
    if (intervalMs === null) return;
    const h = setInterval(() => setTick((n) => n + 1), intervalMs);
    return () => clearInterval(h);
  }, [intervalMs]);
  if (stamp.current !== startedAt) { stamp.current = startedAt; highWater.current = 0; }
  if (intervalMs === null) return highWater.current;      // frozen: do not even ask the clock what time it is
  // A non-positive stamp reads as "just started" — `useChat` sets busy and the start stamp in two
  // setStates that do not commit together, so one painted frame can hold busy=true and startedAt=0, and
  // `now() - 0` rendered as "(29758130m 59s)" in a real binary (pty acceptance, w3.9).
  const elapsed = startedAt > 0 ? Math.max(0, now() - startedAt) : 0;
  const quantized = Math.floor(elapsed / intervalMs) * intervalMs;
  if (quantized > highWater.current) highWater.current = quantized;
  return highWater.current;
}
