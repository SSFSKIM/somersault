// tui/src/modeTable.ts — Wave C Task 2 (EP-C1b): upstream's permission-mode table, transcribed verbatim.
//
// Canon is `gGl` (2.1.220 `cli.pretty.js` L41556) with the accessors at L41522–L41531 —
// `Que(e) = n4r(e).indicator`, `t1e(e) = n4r(e).symbol`, `$O(e) = n4r(e).color`, `TCe(e) = n4r(e).title` —
// over `n4r(e) = gGl[e] ?? gGl.default` (L41497), which is the unknown-mode fallback reproduced below.
// Annex §C4.c is the normative copy of the table; every string here is from it, `Don't Ask`'s apostrophe and
// `DontAsk`'s missing one included.
//
// It lives in its own module rather than inside `Footer.tsx` for two reasons: it is pure (a Footer import
// would drag React into every consumer's graph) and it is what `ChatStatusBar.modeColor` used to be — the
// one place a permission mode becomes a colour, which the settings/banner surfaces read too.
//
// THE ONE FIELD NOT CARRIED is `external` (`TD(e)`, the wire spelling a remote client is handed). ccx has no
// consumer for it: the app-server speaks the same key the table is indexed by. Add it here, not at a call
// site, if one ever appears.
//
// RECORDED DIVERGENCE (plan constraint 12). `modeColor("default")` was `success` in `ChatStatusBar.tsx:15`
// and is `inactive` here, which is upstream's own token for the home state. The old mapping was invented
// (green "you are safe"); upstream paints the manual chip grey precisely because it is the state that does
// nothing. Two more moved with it: `auto` was `permission` and is `warning`, `plan` had no entry at all.
import { resolveThemeColor, themeTokens, type ThemeTokenName } from "./theme.js";

export interface ModeEntry {
  /** `TCe` — the long name, used by dialogs and the banner. */
  title: string;
  /** The short name upstream squeezes into narrow chrome. */
  shortTitle: string;
  /** `Que` — the words in the footer chip (`{symbol} {indicator} on`). */
  indicator: string;
  /** `t1e` — the glyph, rendered `aria-hidden` so a screen reader gets only the words. */
  symbol: string;
  /** `$O`, as a §2.2 semantic token name; `modeColor` resolves it for Ink at call time. */
  color: ThemeTokenName;
}

/** `gGl` (L41556) — insertion order is upstream's own, and `modeTable` tests pin it. */
export const MODE_TABLE: Readonly<Record<string, ModeEntry>> = {
  default:           { title: "Manual",             shortTitle: "Manual",  indicator: "manual mode",        symbol: "⏸",  color: "inactive" },
  plan:              { title: "Plan",               shortTitle: "Plan",    indicator: "plan mode",          symbol: "⏸",  color: "planMode" },
  acceptEdits:       { title: "Accept edits",       shortTitle: "Accept",  indicator: "accept edits",       symbol: "⏵⏵", color: "autoAccept" },
  bypassPermissions: { title: "Bypass Permissions", shortTitle: "Bypass",  indicator: "bypass permissions", symbol: "⏵⏵", color: "error" },
  dontAsk:           { title: "Don't Ask",          shortTitle: "DontAsk", indicator: "don't ask",          symbol: "⏵⏵", color: "error" },
  auto:              { title: "Auto",               shortTitle: "Auto",    indicator: "auto mode",          symbol: "⏵⏵", color: "warning" },
};

/** `n4r` (L41497): every accessor below goes through it, so an unknown or absent mode reads as `default`
 *  rather than throwing or printing a hole. A remote client on a newer protocol is the realistic producer. */
export function modeEntry(mode: string | undefined): ModeEntry { return (mode !== undefined && MODE_TABLE[mode]) || MODE_TABLE.default!; }

export function modeIndicator(mode: string | undefined): string { return modeEntry(mode).indicator; }
export function modeSymbol(mode: string | undefined): string { return modeEntry(mode).symbol; }
export function modeTitle(mode: string | undefined): string { return modeEntry(mode).title; }
export function modeShortTitle(mode: string | undefined): string { return modeEntry(mode).shortTitle; }
/** Resolved for Ink AT CALL TIME, never cached: a mid-session `/theme` change must repaint the chip on the
 *  very next frame, which is the same per-render discipline `ChatStatusBar` held before this module. */
export function modeColor(mode: string | undefined): string { return resolveThemeColor(themeTokens()[modeEntry(mode).color]); }

/** `aPi` (L41510): `e === "default" || e === void 0`. The home state — the ONE mode whose chip carries no
 *  `(shift+tab to cycle)` parenthetical and the one that lets `? for shortcuts` through (annex §C1.3 #3). */
export function isHomeMode(mode: string | undefined): boolean { return mode === "default" || mode === undefined; }
