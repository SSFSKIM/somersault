// tui/autoModeNotice.ts — upstream's AUTO_MODE_DESCRIPTION (2.1.220 L547286) and the once-per-install gate
// around it (L547935-955: a mode-keyed effect, an 800ms delay, and the hasSeenAutoModeEntryWarning
// app-config flag). Upstream appends it as a transcript `notice` message via ml(text, "notice") — NOT a
// dialog and NOT a styled block, which is why this module exports only the string and the predicate.
//
// RECORDED DIVERGENCE: upstream's gate `OMa` (L454515-517) is hasSeenAutoModeEntryWarning OR
// `skipAutoPermissionPrompt` at policy/user/flag scope. ccx keeps only the first half — it has no
// settings-scope equivalent for the second.
import type { CcxPrefs } from "./prefs.js";

/** L547286, verbatim — one string, not four lines. */
export const AUTO_MODE_DESCRIPTION =
  "Auto mode lets Claude handle permission prompts automatically — Claude checks each tool call for risky actions and prompt injection before executing. Actions Claude identifies as safe are executed, while actions Claude identifies as risky are blocked and Claude may try a different approach. Ideal for long-running tasks. Sessions are slightly more expensive. Claude can make mistakes that allow harmful commands to run, it's recommended to only use in isolated environments. Shift+Tab to change mode.";

export function shouldShowAutoModeNotice(prefs: CcxPrefs): boolean { return prefs.hasSeenAutoModeEntryWarning !== true; }

/** L547955. */
export const AUTO_MODE_NOTICE_DELAY_MS = 800;
