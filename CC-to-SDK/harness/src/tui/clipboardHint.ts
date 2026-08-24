// tui/src/clipboardHint.ts — F10 T-IMGREACH Task 13 (I6): THE PURE MODEL behind the ambient clipboard hint.
// No React, no Ink, no process — a fake-timer-testable state machine over exactly the facts canon's own
// `y6i` (L199656-199657 region) tracks: has the terminal told us it is focused, and when did we last actually
// post the hint. Everything with a clock or a subprocess (the debounce timer, the check-only seam, the
// notification post) is the CALLER's job — `ChatComposer.tsx` owns those — so this file answers three
// narrower questions instead: does an edge arm or cancel, and is a fire allowed right now.
//
// THE PRIMARY TRIGGER is DECSET 1004 focus reporting (`altScreen.ts`'s `FOCUS_ON`, routed here through
// `KeymapProvider`'s `onFocusChange`): a false→true transition arms a debounce, a blur cancels it.
//
// THE SECONDARY TRIGGER (canon's own fallback, same region) is the session's FIRST keypress when focus state
// is still `"unknown"` — the terminal never sent a single 1004 byte, so there is no OTHER signal the user is
// even in front of the terminal. It fires exactly once per session: after the first keypress, state moves to
// `"focused"` and every later keypress is ordinary input.
//
// THE THROTTLE is 30 s between actual fires, and only actual fires reset its clock — a debounce that armed
// and then got cancelled, or one that lost the throttle race, must not push the next opportunity out.
export const CLIPBOARD_HINT_KEY = "image-in-clipboard";
/** canon `vUT`. */
export const CLIPBOARD_HINT_DEBOUNCE_MS = 1000;
/** canon `TUT`. */
export const CLIPBOARD_HINT_THROTTLE_MS = 30_000;
/** canon's own `timeoutMs` on the posted notification (r3 §3, `cli.pretty.js` L493296). */
export const CLIPBOARD_HINT_TIMEOUT_MS = 8000;

/** `"unknown"` is canon's own initial value (L188364): no 1004 byte has arrived yet, so a plain terminal
 *  (no focus-reporting support at all) reads as permanently unknown and leans entirely on the keypress
 *  fallback. `"focused"`/`"blurred"` are the two states 1004 (or the fallback) can actually report. */
export type FocusState = "unknown" | "focused" | "blurred";

export interface ClipboardHintModel {
  /** A false→true focus transition ARMS the debounce; a blur CANCELS it. Any transition into "focused"
   *  from anything other than "focused" arms; every blur cancels, whether or not one was pending — cancelling
   *  nothing is a harmless no-op for the caller's timer. */
  onFocus(focused: boolean): "arm" | "cancel" | "none";
  /** canon's SECONDARY trigger (L199656-199657): the initial state is "unknown" (canon L188364), so the
   *  very FIRST keystroke of a session is itself a false→true transition — which is what makes the hint
   *  work in terminals that never send 1004 at all. Once focus state is known (by either route), an
   *  ordinary keypress arms nothing — it is just input. */
  onKeypress(): "arm" | "none";
  /** True when the debounce elapsed and the throttle window is clear. Records the fire time itself — the
   *  timestamp updates ONLY when a hint actually fires (canon), never on a suppressed attempt, so a fire
   *  throttled away does not push the next real opportunity further out. */
  shouldFire(nowMs: number): boolean;
  state(): FocusState;
}

export function createClipboardHintModel(): ClipboardHintModel {
  let focus: FocusState = "unknown";
  let lastFireMs: number | null = null;
  return {
    onFocus(focused) {
      if (focused) {
        if (focus === "focused") return "none";
        focus = "focused";
        return "arm";
      }
      focus = "blurred";
      return "cancel";
    },
    onKeypress() {
      if (focus !== "unknown") return "none";
      focus = "focused";
      return "arm";
    },
    shouldFire(nowMs) {
      // `<=`, not `<`: a second opportunity exactly THROTTLE_MS after the last fire is still inside the
      // window that fire opened, and only the millisecond past it is clear (canon's own boundary).
      if (lastFireMs !== null && nowMs - lastFireMs <= CLIPBOARD_HINT_THROTTLE_MS) return false;
      lastFireMs = nowMs;
      return true;
    },
    state() { return focus; },
  };
}
