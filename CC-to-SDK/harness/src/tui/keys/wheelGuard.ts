// tui/keys/wheelGuard.ts — canon's ALTERNATE-SCROLL suppression (bundle L168579-168585, `Hay = 75`), as one
// stateful predicate over the input stream. Pure: no React, no Ink, no I/O; the clock is injected.
//
// THE PROBLEM IT SOLVES IS NOT THE ABSENCE OF MOUSE REPORTING, IT IS THE SEAM. A terminal on the alternate
// screen with tracking off answers a wheel tick with bare arrow keys — the "alternate scroll" fallback — and
// those arrows are indistinguishable from the user's own. Arming `?1000h ?1006h` with the screen (altScreen.ts)
// fixes the steady state; it cannot fix the window in which BOTH arrive: the enable is in flight, a multiplexer
// or a terminal without the mode keeps translating, or a fast scroll straddles the flip. Canon's answer is a
// clock rather than a mode flag, and it is deliberately blunt: for 75 ms after a wheel event, a bare up/down is
// assumed to be that same wheel arriving the other way and is DROPPED. A user cannot press an arrow inside the
// tick they just scrolled; a terminal can very easily send both.
//
// WHAT IS DELIBERATELY NOT PORTED: canon's `bay = 250` / `Rmo()` limb, which REWRITES a wheelup as a wheeldown
// shortly after a wheeldown. That is a workaround for a macOS momentum-scrolling setting, not a property of the
// protocol, and rewriting the direction of a gesture the user made is the kind of correction that is worse than
// the bug when the premise does not hold.
import type { InputEvent } from "./types.js";

/** canon `Hay` (L168589). */
export const WHEEL_FALLBACK_MS = 75;

/** `keep(ev)` — false for an event the stream should swallow. Stateful (it remembers the last wheel tick) and
 *  therefore one instance per input stream, held by whoever owns that stream. */
export function createWheelGuard(now: () => number): (ev: InputEvent) => boolean {
  let lastWheel = Number.NEGATIVE_INFINITY;
  return (ev) => {
    // Only KEYS are candidates. That is also where canon's `!s.isPasted` clause lands for us: a bracketed
    // paste carrying `\x1b[A` reaches the provider as a `text` event with its provenance already attached, so
    // pasted arrow bytes are never key events in the first place and cannot be dropped here.
    if (ev.kind !== "key") return true;
    if (ev.name === "wheelup" || ev.name === "wheeldown") { lastWheel = now(); return true; }
    if (ev.name !== "up" && ev.name !== "down") return true;
    if (ev.ctrl || ev.alt || ev.shift || ev.super) return true;      // canon's bare-key requirement
    return now() - lastWheel >= WHEEL_FALLBACK_MS;
  };
}
