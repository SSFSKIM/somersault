// tui/dialogs/dialogKeys.ts — KB1's pre-F6 letter shortcuts, in the one place every permission body reads
// them from. `a` allows once, `A` is the old in-memory session allowlist (`allow_always` — the ONE outcome no
// F6 dialog otherwise emits, permissions/types.ts), `d`/`D` deny.
//
// These ride `Select`'s `onUnhandledKey`, never a `useKeyFallback` of the dialog's own: `fallbackHandler`
// hands the keyboard to exactly one handler, and inside a Select that handler has to be the Select's (see
// BashPermission.tsx's header). The Select is silent while a text row has the cursor, which is what keeps
// `a` and `d` out of a half-typed feedback sentence without any key-sniffing here.
//
// Returns `undefined` for everything else — including a modified `ctrl+a`/`alt+d`, which are chords, not
// decisions. The caller decides nothing; it only forwards.

import { toKeyFlags } from "../keys/editorAdapter.js";
import type { KeyEvent, TextEvent } from "../keys/types.js";
import type { PermissionDecision } from "../../permissions/types.js";

export function legacyKeyDecision(e: KeyEvent | TextEvent): PermissionDecision | undefined {
  const { input, key } = toKeyFlags(e);
  // The ctrl/meta guard predates t9 but is now load-bearing for a SECOND reason: since SelectDecision binds
  // ctrl+u/ctrl+d (plan scroll), an unhandled ctrl+d TRAVERSES to onUnhandledKey in every decision dialog
  // (it used to die at the old `ctrl+d: null` unbind) — without this guard it would read as a bare `d` deny.
  if (key.ctrl || key.meta) return undefined;
  if (input === "a") return { kind: "allow_once" };
  if (input === "A") return { kind: "allow_always" };
  if (input === "d" || input === "D") return { kind: "deny" };
  return undefined;
}
