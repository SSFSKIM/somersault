// tui/src/keys/doublePress.ts — Wave C Task 3 (EP-C7a): upstream's double-press primitive `Pee`
// (annex §C7.1, bundle L183445), lifted out of React so every "press it again to X" arm in this port shares
// ONE state machine instead of a hand-rolled ref/timer pair each. Upstream:
//
//   function Pee(e /*onArmChange*/, t /*onSecondPress*/, r /*onFirstPress*/, n = fpy) {
//     … useCallback(() => {
//       let l = Date.now();
//       if (l - i.current <= n && s.current !== void 0) { a(); e(!1); t(); }
//       else { r?.(); e(!0); a(); s.current = o.setTimeout(() => { e(!1); s.current = void 0 }, n) }
//       i.current = l;
//     }) }
//   var fpy = 800;                                                                            // L183463
//
// Read off that body, because all four are load-bearing and none is obvious:
//  · The FIRST press runs `onFirstPress` *and* arms. It is a side effect, not an alternative to arming —
//    upstream's Ctrl-C arm clears the draft on press one and still shows `Press Ctrl-C again to exit`.
//  · The second-press test is `elapsed <= windowMs` AND `handle !== undefined`. The handle half is what makes
//    an expired arm re-arm instead of firing: after the timeout the handle is gone, so a press 1 ms later
//    starts over even though `elapsed` is tiny.
//  · Only the timeout and the second press clear the arm. Reading any OTHER key does not — that asymmetry is
//    upstream's, and ChatComposer's Ctrl-D arm already documents deferring to it.
//  · The window is a per-call argument: 800 ms unless the caller says otherwise (the `/clear` chord passes
//    2000, annex §C7.2).
//
// TWO additions this port owes its callers, neither of which upstream needs because its state lives in a hook:
//  · `disarm()` — the busy-interrupt path must be able to cancel a pending arm (today's `disarmClear()` at
//    ChatComposer.tsx:555 does exactly this by hand). It notifies ONLY when actually armed, so a caller that
//    disarms defensively on every keystroke cannot spray `setState(false)` at React.
//  · `dispose()` — an armed timer firing `onArmChange` after unmount is a React warning and a leak
//    (plan-review finding #7). After it, the primitive is dead: `press`/`disarm` are inert, so a late event
//    delivered from a listener torn down one tick behind cannot resurrect the timer.
//
// Every timer goes through the `deps` seam (plan constraint 15) so the unit tests drive time synthetically.

/** Upstream `fpy` (L183463). The default for every arm except `/clear`'s 2000 ms one (annex §C7.2). */
export const DOUBLE_PRESS_WINDOW_MS = 800;

export interface DoublePressHandlers {
  /** Armed / disarmed. The hint copy ("Press Ctrl-C again to exit") is the caller's; this only reports state. */
  onArmChange(armed: boolean): void;
  /** The action, on a second press inside the window. Runs AFTER `onArmChange(false)`, as upstream orders it. */
  onSecondPress(): void;
  /** The first press's own side effect (clear the draft, stash it, …) — not a substitute for arming. */
  onFirstPress?(): void;
}
export interface DoublePressDeps {
  now?: () => number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (h: unknown) => void;
}
export interface DoublePress {
  press(): void;
  /** Cancel a pending arm without firing the action. No-op (and silent) when nothing is armed. */
  disarm(): void;
  /** Kill the primitive: cancels any pending timer and makes every later call inert. */
  dispose(): void;
}

export function createDoublePress(handlers: DoublePressHandlers, windowMs: number = DOUBLE_PRESS_WINDOW_MS, deps: DoublePressDeps = {}): DoublePress {
  const now = deps.now ?? Date.now;
  const schedule = deps.setTimeout ?? ((fn: () => void, ms: number): unknown => setTimeout(fn, ms));
  const cancel = deps.clearTimeout ?? ((h: unknown): void => { clearTimeout(h as ReturnType<typeof setTimeout>); });

  let last = 0;                                            // upstream's `i.current`, the previous press time
  let handle: unknown;                                     // upstream's `s.current`; `undefined` ⇔ not armed
  let disposed = false;
  const stop = (): void => { if (handle !== undefined) { cancel(handle); handle = undefined; } };

  return {
    press(): void {
      if (disposed) return;
      const t = now();
      // `handle !== undefined` reads FIRST for legibility, not for correctness: both operands are pure, so
      // either order decides the same way (an unarmed primitive fails the handle test however early `last`
      // still sits at 0). Leading with "am I armed?" says what the branch is about; upstream writes the
      // elapsed test first only because its handle lives in a ref.
      if (handle !== undefined && t - last <= windowMs) { stop(); handlers.onArmChange(false); handlers.onSecondPress(); }
      else {
        handlers.onFirstPress?.();
        handlers.onArmChange(true);
        stop();
        // Divergence, deliberate and tiny: upstream's expiry callback is `e(!1); s.current = void 0` — it
        // notifies BEFORE clearing the handle, so an `onArmChange` that synchronously pressed again would see
        // a live handle and read as a second press. Cleared first here; nothing else about the order moves.
        handle = schedule(() => { handle = undefined; handlers.onArmChange(false); }, windowMs);
      }
      last = t;
    },
    disarm(): void {
      if (disposed || handle === undefined) return;
      stop();
      handlers.onArmChange(false);
    },
    dispose(): void { disposed = true; stop(); },
  };
}
