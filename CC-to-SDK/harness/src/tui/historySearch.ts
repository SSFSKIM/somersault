// tui/src/historySearch.ts — pure helpers shared by BOTH prompt-history search surfaces (bundle
// `HistorySearch` context): the inline reverse-i-search the composer owns (`r9f`/`xWf`, see
// historySearchInline.ts) and the full-screen picker (`qGf`, HistorySearchOverlay.tsx).
//
// Scopes cycle session → project → everywhere and start at "everywhere" — `SDo` (bundle L317659) for the
// order, `qGf`'s own `useState("everywhere")` (L492156) for the initial value, both re-verified in F5 t12.
// Ranking is the picker's two-class rule (`p`, L492196-L492205): substring matches first, then `oDb`
// subsequence matches, order preserved within each class.
//
// WHERE THE ENTRIES COME FROM changed in F5 task 12. Until then the picker derived them from persisted
// TRANSCRIPTS (`promptEntries`/`mergeEntries` over `sessions/rows.ts`), which disagreed with the prompt log
// on two things a search must get right: a transcript's prompt row has already lost the `!` that makes a
// line bash mode, and it never carried `pastedContents` at all, so a recalled paste-bearing prompt came back
// as text that could not be re-expanded. Both surfaces now read `promptHistory.ts`'s `readHistory` — upstream's
// `UUd`, the same file upstream's own picker scans — and those two transcript helpers are gone with no
// callers left. The cost is recorded in Task 13: prompts submitted before F5 task 6 started writing
// `history.jsonl` are not in the log and therefore drop out of search.
import type { PastedMap } from "./editor.js";

export const HISTORY_SCOPES = ["session", "project", "everywhere"] as const;
export type HistoryScope = (typeof HISTORY_SCOPES)[number];
export function nextScope(s: HistoryScope): HistoryScope { return HISTORY_SCOPES[(HISTORY_SCOPES.indexOf(s) + 1) % HISTORY_SCOPES.length]; }

/** One searchable prompt. `text` is the persisted DISPLAY verbatim — the `!` prefix included (this port's
 *  standing rule that the buffer, not a side channel, carries the mode; see editorHistory.ts divergence 1)
 *  and the `[Pasted text #N …]` chip labels included. `pastedContents` holds the RESOLVED bodies behind those
 *  labels (`hydrateEntry`), so accepting or executing a match can put the real payload back instead of
 *  sending the literal label. */
export interface HistEntry { text: string; ts: number; pastedContents?: PastedMap }

function isSubsequence(hay: string, needle: string): boolean {
  let r = 0;
  for (let i = 0; i < hay.length && r < needle.length; i++) if (hay[i] === needle[r]) r++;
  return r === needle.length;
}

/** Substring matches first, then subsequence matches, order preserved within each class. */
export function rankHistory(entries: HistEntry[], query: string): HistEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  const sub: HistEntry[] = [], seq: HistEntry[] = [];
  for (const e of entries) {
    const lower = e.text.toLowerCase();
    if (lower.includes(q)) sub.push(e);
    else if (isSubsequence(lower, q)) seq.push(e);
  }
  return sub.concat(seq);
}

export function ageLabel(ts: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60); if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// ───────────────────────────── CM59: the picker's preview pane (`qGf`, bundle L492153) ─────────────────────────────

/** `aci = 6` (bundle L492219) — the preview's content-line budget, and the `height: aci + 2` the bordered box
 *  is pinned to (six rows plus the two the round border occupies). */
export const PREVIEW_LINES = 6;
/** `f = n >= 100` (L492207): at 100 columns or more the preview sits BESIDE the list (`previewPosition:
 *  "right"`), below it otherwise. */
export const PREVIEW_SIDE_BY_SIDE_COLS = 100;
/** `WGf = 8` (L492245) — the width upstream reserves for the age column when it budgets the list's text. */
export const AGE_COL = 8;

/** `m`/`g`/`y` (L492207) verbatim: the list's own width, the list's TEXT width once the age column is paid
 *  for, and the preview's text width — all three derived from one terminal width so the two panes cannot
 *  disagree about who owns which columns. */
export function previewLayout(columns: number): { sideBySide: boolean; listWidth: number; textWidth: number; previewWidth: number } {
  const sideBySide = columns >= PREVIEW_SIDE_BY_SIDE_COLS;
  const listWidth = sideBySide ? Math.floor((columns - 6) * 0.5) : columns - 6;
  return {
    sideBySide,
    listWidth,
    textWidth: Math.max(20, listWidth - AGE_COL - 1),
    previewWidth: sideBySide ? Math.max(20, columns - listWidth - 12) : Math.max(20, columns - 10),
  };
}

/** `renderPreview` (L492219) verbatim, minus the JSX: hard-wrap the display to `width`, DROP every blank
 *  line, then keep six — or five plus a tail row when there are more than six, because the tail costs a row
 *  of the same six-row budget (`H = E.slice(0, A ? aci - 1 : aci)`). */
export function previewLines(display: string, width: number, max: number = PREVIEW_LINES): { lines: string[]; more: number } {
  const w = Math.max(1, Math.floor(width));
  const wrapped: string[] = [];
  for (const raw of display.split("\n")) {
    if (raw.length <= w) { wrapped.push(raw); continue; }
    for (let i = 0; i < raw.length; i += w) wrapped.push(raw.slice(i, i + w));
  }
  const kept = wrapped.filter((l) => l.trim() !== "");
  const over = kept.length > max;
  const lines = kept.slice(0, over ? max - 1 : max);
  return { lines, more: kept.length - lines.length };
}

/** `Bst` (bundle L107148): `… +${n} ${plural}` — an ELLIPSIS CHARACTER then the count, and nothing at all for
 *  a non-positive count (`bM` renders null in that case, L421395). */
export function moreLabel(n: number, unit = "line"): string {
  if (n <= 0) return "";
  return `… +${n} ${n === 1 ? unit : `${unit}s`}`;
}
