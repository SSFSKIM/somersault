// tui/editorHistory.ts — the composer's history-NAVIGATION model (F5 task 7), lifted out of editor.ts and
// then extended. Pure: no React, no Ink, no fs. Every disk touch (seeding the list, appending a submitted
// prompt, resolving a paste body) belongs to ChatComposer; what lives here is the walk itself.
//
// Transcribed from 2.1.220's `Z6f` (bundle L489521-L489633), the hook that owns the whole walk:
//  · L489524 `M`   the recall APPLY — `M(text, mode, pastedContents, cursorSpec)`; sets `H.current = text`
//                  (the "as recalled" text `historyEdited` compares against)
//  · L489529 `B`   the entry → buffer materialisation, and the one line this port has to bend:
//                  `let Y = mP(V.display), re = Y === "bash" ? V.display.slice(1) : V.display;`
//                  then `M(re, Y, V.pastedContents ?? {}, K)`. See BASH RECALL below.
//  · L489531 `W`   the read — the EDIT CACHE first (`w.current.get(V)`), the entry second
//  · L489540 `U`   CM55's latch, verbatim: `if (V === 0) T.current = re === "bash" ? re : void 0;`
//  · L489543       a latch CHANGE clears the list and the edit cache (`w.current.clear()`)
//  · L489547       the filter: `ce ? se.filter((ae) => mP(ae.display) === ce) : se` — by the DISPLAY
//  · L489578-580   the draft park (`f({ display, pastedContents, mode })`), only when nothing is recalled yet
//  · L489582-583   CM54's edit store: `w.current.set(V - 1, { display, pastedContents, mode })`
//  · L489587       CM56's hint trigger: `te >= 2 && !se && !m.current`
//  · L489609 `j`   the DOWN walk — store the edit, step back, and at index 1 restore the parked draft
//  · L494870 `AVf` CM4's label: `History ${Math.max(1, t - e + 1)}/${t}`, nothing while `e === 0` or edited
//
// FOUR recorded divergences, each forced by a real structural difference:
//
//  1. BASH RECALL PUTS THE `!` IN THE BUFFER. Upstream keeps `mode` in its own state and strips the prefix
//     off the display (L489529) so the buffer holds the bare command. OUR mode is DERIVED from the buffer
//     (`editor.ts`'s `inputMode`: a leading `!` is bash mode), so stripping it would land a recalled
//     `!git status` in prompt mode — the exact second-source-of-truth failure promptHistory.ts's divergence
//     4 exists to prevent. We therefore put the display back VERBATIM, prefix and all, which reproduces
//     upstream's OBSERVABLE state (bash border, bash glyph, the command ready to run) and is byte-identical
//     to the buffer the user had when they typed it.
//
//  2. INDEX DIRECTION. Upstream's `A.current` is a 1-based count of Up presses into a NEWEST-first array;
//     ours is a 0-based index into an OLDEST-first array (editor.ts has always modelled it that way, and
//     `readHistory` is reversed at the seam). `historyPosition` converts, so every transcribed formula —
//     the label above, the `>= 2` hint trigger — is applied to upstream's own `e`.
//
//  3. NO PAGING, NO ASYNC. Upstream walks the file backwards a page at a time (`VLb`) and re-reconciles
//     `_.current` when new entries arrive mid-walk (L489548-L489559). We seed the whole capped window
//     (≤100 entries) synchronously at mount, so the list cannot grow underneath a walk: the only in-session
//     append happens at submit, which ends the walk. The reconciliation, the loading `"History"` label
//     (`AVf`'s `t === null` arm) and the `$Ud`/`VLb` machinery are all unreachable here.
//
//  4. `V === k.current` COLLAPSES. Upstream guards its edit store on "the buffer really holds the entry we
//     last recalled", because `W()` can fail to materialise one. Ours cannot fail — `histIndex` is only ever
//     set by a successful recall — so `histIndex !== null` IS that guard.
//
// FRESH CHIP IDS, ours and not upstream's (t4 review closure). Upstream re-installs a recalled entry's paste
// map under its ORIGINAL ids. Those ids were minted in another session against another counter, so the first
// paste after a recall can mint an id the recalled buffer is already using — two `[Pasted text #1]` labels,
// one entry, and the older label silently expands to the newer payload. `rebuildChips` re-mints every
// recalled entry onto ids above the live `pasteCounter` and relabels the buffer text to match, so a recalled
// chip and a live one can never collide.
//
// IMPORT HYGIENE (t7 review, I2): the mode helpers come from `promptMode.ts`, a zero-import leaf, NOT from
// `promptHistory.ts`, which reaches `node:fs`/`node:crypto`/`node:os`. Traced: nothing this module or
// `editor.ts` pulls in reaches a `node:` builtin, so the reducer graph is filesystem-free and the disk lives
// only in ChatComposer. Keep it that way — see promptMode.ts's header.
import { chipLabel, chipSpans, newlineCount } from "./pasteChips.js";
import { composerMode } from "./promptMode.js";
import { bufferText, setBuffer, type EditorState, type InputMode, type PastedEntry, type PastedMap } from "./editor.js";

/** One entry of the composer's history list, OLDEST-FIRST in `EditorState.history` (see divergence 2).
 *
 *  `display` is canonical for the mode — it carries the `!` a bash prompt was submitted with (`hon`,
 *  L548774), which is what `composerMode` (`mP`) reads and what every persisted line stores. `mode` is
 *  upstream's own in-memory record field (L489583) and is carried here for the same reason it carries the
 *  paste map: it is what the record IS. In this port it is redundant with the prefix by construction — we
 *  only ever write `inputMode(state)`, which is itself derived from that text — so nothing reads it as an
 *  authority; the filter and every mode question go through `display`, exactly as upstream's do (L489547).
 *
 *  `pastedContents` holds RESOLVED bodies (`PastedEntry`, full `content`), not the persisted
 *  `content | contentHash` split: ChatComposer hydrates each entry once at seed time, which is upstream's
 *  own placement (`yDo` runs inside the read walk, L317510). */
export interface HistNavEntry { display: string; mode?: InputMode; pastedContents?: PastedMap }

/** The draft parked by the FIRST history Up and restored by the Down that walks off the newest end —
 *  upstream's `p`/`f` record, `{ display, pastedContents, mode }` (L489580). */
export interface DraftStash { display: string; pastedContents: PastedMap; mode?: InputMode }

/** CM54's per-index edit, upstream's `w.current` value (L489583). The SAME triple as the draft stash, and
 *  deliberately not just a string: a recalled entry the user edits still carries the chips that came back
 *  with it, and arrowing away and back has to bring the payloads back too, not just the labels. */
export interface HistEdit { display: string; pastedContents: PastedMap; mode?: InputMode }

/** CM55's latch value. `"bash"` filters the walk to bash entries; `undefined` is unfiltered. */
export type HistFilter = "bash" | undefined;

/** `mP(ae.display)`. The filter reads the DISPLAY, never the record's `mode` (L489547). Wave C Task 14 folded
 *  `modeOfDisplay` into `composerMode` — same reading, one function — so the `=== "bash"` is spelled here. */
export function historyEntryIsBash(e: HistNavEntry): boolean { return composerMode(e.display) === "bash"; }

/** The list the walk actually moves through: everything, or bash-only under the latch. Recomputed on every
 *  step rather than cached in state (upstream caches it in `_.current` only because it is paging it in). */
export function historyView(history: readonly HistNavEntry[], filter: HistFilter): HistNavEntry[] {
  return filter ? history.filter(historyEntryIsBash) : [...history];
}

/** Where the walk is, in UPSTREAM's terms: `index` is `A.current` (1-based, 1 = newest) and `total` is
 *  `_.current.length`. `null` when no walk is in progress, which is upstream's `e === 0`. */
export function historyPosition(s: EditorState): { index: number; total: number } | null {
  if (s.histIndex === null) return null;
  const total = historyView(s.history, s.histMode).length;
  return { index: total - s.histIndex, total };
}

/** `historyEdited` (L489632): `s > 0 && t !== H.current` — the live buffer no longer matches the text the
 *  recall installed. Restoring a cached EDIT re-arms `H.current` to that edit (L489534), so an edit you
 *  arrowed away from and came back to reads as unedited again, and its label returns. */
export function historyEdited(s: EditorState): boolean {
  return s.histIndex !== null && s.histRecalled !== null && bufferText(s) !== s.histRecalled;
}

/** `AVf` (L494870), applied to upstream's `e`. Its `t === null` arm ("History" with no counter) is the
 *  still-loading state of a paged walk and is unreachable here (divergence 3) — recorded, not built. */
export function historyLabel(s: EditorState): string | undefined {
  const at = historyPosition(s);
  if (!at || at.index === 0 || historyEdited(s)) return undefined;
  return `History ${Math.max(1, at.total - at.index + 1)}/${at.total}`;
}

/** Re-mint a recalled entry's chips onto ids above `pasteCounter`, relabelling the display to match (see
 *  FRESH CHIP IDS in the header). Ids are walked in ascending order so the visible numbering keeps the
 *  entry's own left-to-right sequence. A label whose id names no entry is left exactly as it is: it is
 *  either a lost paste ChatComposer already rewrote (`au_`) or characters the user typed. */
export function rebuildChips(entry: HistNavEntry, pasteCounter: number): { display: string; pastedContents: PastedMap; pasteCounter: number } {
  const src = entry.pastedContents ?? {};
  const ids = Object.keys(src).map(Number).filter((id) => src[id]?.type === "text").sort((a, b) => a - b);
  if (ids.length === 0) return { display: entry.display, pastedContents: {}, pasteCounter };
  const remap = new Map<number, PastedEntry>();
  const pastedContents: PastedMap = {};
  let next = pasteCounter;
  for (const id of ids) {
    const e = src[id];
    const fresh: PastedEntry = { id: ++next, type: "text", content: e.content, lineCount: e.lineCount ?? newlineCount(e.content) };
    remap.set(id, fresh);
    pastedContents[fresh.id] = fresh;
  }
  // Right to left within each line, `fSe`'s reason: every replacement changes the length of what follows it.
  const display = entry.display.split("\n").map((line) => {
    const spans = chipSpans(line);
    let out = line;
    for (let i = spans.length - 1; i >= 0; i--) {
      const fresh = remap.get(spans[i].id);
      if (!fresh) continue;
      out = out.slice(0, spans[i].start) + chipLabel(fresh.id, fresh.lineCount) + out.slice(spans[i].end);
    }
    return out;
  }).join("\n");
  return { display, pastedContents, pasteCounter: next };
}

/** `M`'s fourth argument (L489525): `n(re === "end" ? V.length : 0)`. An UP recall lands the caret at the end
 *  of the text and a DOWN recall at the very start — which is not decoration, it is what makes the vertical
 *  keys keep working on a MULTI-LINE entry: arriving from below you are on the last row, so another Up walks
 *  the text before it walks the history, and arriving from above you are on the first row, so another Down
 *  does the same in the other direction. Our `onUp`/`onDown` edge tests are exactly upstream's. */
type Caret = "start" | "end";
const place = (s: EditorState, t: string, at: Caret): EditorState =>
  at === "end" ? setBuffer(s, t) : { ...setBuffer(s, t), cursor: { row: 0, col: 0 } };

/** `W` (L489531): the edit cache first, the entry second. */
function recallAt(s: EditorState, view: readonly HistNavEntry[], idx: number, at: Caret): EditorState {
  const edit = s.histEdits.get(idx);
  if (edit) return { ...place(s, edit.display, at), pastedContents: edit.pastedContents, histIndex: idx, histRecalled: edit.display };
  const built = rebuildChips(view[idx], s.pasteCounter);
  return { ...place(s, built.display, at), pastedContents: built.pastedContents, pasteCounter: built.pasteCounter, histIndex: idx, histRecalled: built.display };
}

/** CM54's store (L489583 on the way up, L489615 on the way down). See divergence 4 for the missing guard. */
function storeEdit(s: EditorState, mode: InputMode): EditorState {
  if (s.histIndex === null) return s;
  const histEdits = new Map(s.histEdits);
  histEdits.set(s.histIndex, { display: bufferText(s), pastedContents: s.pastedContents, mode });
  return { ...s, histEdits };
}

/** `U` (L489538). `mode` is the composer's CURRENT input mode, passed in rather than read: this module owes
 *  editor.ts no runtime dependency in that direction, and `onUp` already has the value. */
export function historyPrev(s: EditorState, mode: InputMode): EditorState {
  if (s.histIndex === null) {
    // CM55, L489540-L489542 verbatim: `if (V === 0) T.current = re === "bash" ? re : void 0;`
    const histMode: HistFilter = mode === "bash" ? "bash" : undefined;
    // L489543: a latch CHANGE invalidates the list and the edit cache together.
    const histEdits = histMode === s.histMode ? s.histEdits : new Map<number, HistEdit>();
    const view = historyView(s.history, histMode);
    if (view.length === 0) return { ...s, histMode, histEdits };
    const idx = view.length - 1;
    // The draft park (L489578-L489580). Upstream parks nothing for a blank buffer; ours records it either
    // way, because `historyNext` restores `stash?.display ?? ""` and the two arms coincide there.
    const stash: DraftStash = { display: bufferText(s), pastedContents: s.pastedContents, mode };
    return recallAt({ ...s, histMode, histEdits, stash }, view, idx, "end");
  }
  const view = historyView(s.history, s.histMode);
  const idx = s.histIndex - 1;
  if (idx < 0) return s;                                   // `ne`'s `V >= _.current.length` bail: no move, no store
  return recallAt(storeEdit(s, mode), view, idx, "end");
}

/** `j` (L489609). The edit is stored on the way down too, then the walk steps toward the draft. */
export function historyNext(s: EditorState, mode: InputMode): EditorState {
  if (s.histIndex === null) return s;
  const view = historyView(s.history, s.histMode);
  const stored = storeEdit(s, mode);
  const idx = s.histIndex + 1;
  if (idx < view.length) return recallAt(stored, view, idx, "start");
  // Off the newest end: put the parked draft back, text AND map (L489620-L489624). The stash and the latch
  // both SURVIVE — upstream clears neither here, only `resetHistory` does — and the next Up re-parks and
  // re-latches anyway.
  return { ...place(stored, s.stash?.display ?? "", "start"), pastedContents: s.stash?.pastedContents ?? {}, histIndex: null, histRecalled: null };
}

/** The in-memory push every submit site shares: append, dropping ANY earlier entry with the same display.
 *
 *  WHOLE-SCAN, NEWEST-WINS, and it has to be (t7 review, I1). The old rule compared only against the newest
 *  entry, which is upstream's `cu_` (L317586) — but `cu_` is a suppressor on the PERSIST side, sitting in
 *  front of a file whose READER (`UUd`, L317460) then dedups the whole window by display and keeps the newest
 *  occurrence. Ours is the in-memory list that same reader seeds, so an adjacent-only rule made the two
 *  disagree the moment a prompt repeated non-adjacently: with `[ls, pwd]` on disk, submitting `ls` gave a
 *  three-entry walk (`ls` at 3/3, `pwd` at 2/3, `ls` again at 1/3) that collapsed back to two the next time
 *  the app started. Matching `readHistory`'s rule here makes the in-session walk and the reseeded walk the
 *  same list, which is the only version of this a user can reason about. The persisted FILE still keeps both
 *  lines — `readHistory` hides the older one — so nothing about the on-disk format changes. */
export function pushHistory(history: readonly HistNavEntry[], entry: HistNavEntry): HistNavEntry[] {
  return [...history.filter((e) => e.display !== entry.display), entry];
}
