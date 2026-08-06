// tui/src/bypassAccepted.ts — the ONE reading of "has this install already accepted the bypass-permissions
// disclaimer", split out of bypassConsent.tsx by the T15 fix round. Two callers must agree on it and they
// live on opposite sides of the React line: the dialog itself (`.tsx`, ink) and `cli/main.ts`, which must
// stay React-free so `-p` and `--bg` never pull ink into the process. Before this split main.ts could not
// import the canon predicate at all and re-implemented it as a raw prefs read — two readings of one SAFETY
// flag, free to drift. This module has NO runtime imports (the `CcxPrefs` import is type-only, erased at
// compile time), so it is a leaf of main.ts's static import graph: that is what makes part of the
// React-free guarantee structural rather than asserted, and test/unit/args-bypass.test.ts walks the graph
// transitively to hold it that way.
import type { CcxPrefs } from "./prefs.js";

/** Upstream's own flag name — bundle L554052's writer, `yi("userSettings", { skipDangerousModePermissionPrompt: !0 })`.
 *  Named once here so the reader below, the dialog's accept-arm write and the prefs field cannot drift apart. */
export const BYPASS_ACCEPTED_PREF = "skipDangerousModePermissionPrompt" as const;

/** Upstream's `M8()` (L43492), which ORs the flag across four settings scopes; ccx has one prefs file, so it
 *  is one read. Explicit `true` only — a hand-edited `"skipDangerousModePermissionPrompt": 1` must not pass
 *  a safety gate. */
export function hasAcceptedBypass(prefs: CcxPrefs): boolean { return prefs[BYPASS_ACCEPTED_PREF] === true; }
