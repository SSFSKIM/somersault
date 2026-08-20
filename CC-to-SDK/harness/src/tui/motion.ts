// tui/src/motion.ts — F8 Task 6: one resolver for "should anything be animating right now".
//
// It is NOT the setting alone. Canon's value is `hx(S.prefersReducedMotion) || hl()` (L507998) — the
// persisted preference OR the screen-reader signal. Threading only the preference leaves a screen-reader
// user with a spinning glyph, an animating retry row and a braille-alternating tab title: precisely the
// population the behaviour exists for. Canon performs no operating-system query anywhere, so neither do
// we — `prefersReducedMotion` is a setting and `CLAUDE_AX_SCREEN_READER` is an env var, and that is all.
import type { CcxPrefs } from "./prefs.js";
import { screenReaderEnabled } from "./renderer.js";

export function reducedMotion(prefs: Pick<CcxPrefs, "prefersReducedMotion">, env: NodeJS.ProcessEnv = process.env): boolean {
  return prefs.prefersReducedMotion === true || screenReaderEnabled(env);
}
