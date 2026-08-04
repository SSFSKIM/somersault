// tui/src/queue.ts — F5 Task 8: the type-ahead QUEUE's record shape (CM51) and the two pure halves of
// CM48's Up/ctrl+p drain. No React, no Ink, no fs: `useChat` owns the queue array, `ChatComposer` owns the
// buffer, and the two meet through the functions here so neither has to know the other's model.
//
// Transcribed from 2.1.220:
//  · `P5`   (L148879)   the EDITABLE predicate: `AKg(e.mode) && !e.isMeta && cee(e.origin)`, where
//                       `AKg(m) = !SKg.has(m)` and `SKg = new Set(["task-notification"])` (L149146).
//  · `V`    (L149093)   `popAllEditable(currentDraft, cursorOffset)` — the drain itself:
//                         let { editable: ce, nonEditable: se } = partition(queue, P5)
//                         if (ce.length === 0) return
//                         let ne = ce.map(Te => k0u(Te.value)),
//                             ee = [...ne, re].filter(Boolean).join("\n"),      // QUEUED FIRST, DRAFT LAST
//                             te = ne.join("\n").length + 1 + oe                 // the new cursor offset
//                         … e.length = 0, e.push(...se)                          // non-editable entries SURVIVE
//                         return { text: ee, cursorOffset: te, images: de }
//  · `GU`   (L495786)   the composer-side apply: `At(Wt.text)`, `Qe(Wt.cursorOffset)`, merge the images into
//                       `pastedContents`. Its `E("prompt")` is divergence 1 below.
//
// THREE recorded divergences:
//
//  1. THE DRAINED BUFFER KEEPS ITS `!`. Upstream forces the composer to prompt mode after a drain
//     (`E("prompt")`, L495789) because its mode is a separate piece of state. OURS is DERIVED from the
//     buffer (`editor.ts`'s `inputMode`), and a queued bash command is stored with the `!` the user typed,
//     so the drained buffer re-enters bash mode by itself. Same rule, same reason, as editorHistory.ts's
//     divergence 1 for a bash RECALL: the text is what the user typed, and the mode follows the text.
//
//  2. NO IMAGE PAYLOADS. `L0u` (L148911) lifts image/audio blocks out of a structured (non-string) queued
//     value. Every value this port enqueues is a plain string (`useChat.submit`), so `L0u` returns `[]` for
//     all of them and only the TEXT paste map has anything to merge. Recorded, not built.
//
//  3. THE EMPTY-DRAFT CURSOR IS CLAMPED. Upstream's `te` adds `+ 1` for the joining newline unconditionally,
//     so draining onto an EMPTY draft (which `filter(Boolean)` then drops from the join) returns an offset
//     one past the end of the text. Our cursor is a `{row, col}` into real lines and cannot be out of
//     range, so the empty-draft arm lands at the end of the queued text instead.
import { bufferText, rebuildChips, type EditorState, type PastedMap } from "./editor.js";

/** CM51. One entry of the type-ahead queue.
 *
 *  `value` is the RAW submitted text, prefix and all — a queued `!git status` stores the `!` (divergence 1).
 *  `mode` is upstream's own record field and is what `isEditableQueueEntry` reads; ours is derived from that
 *  same prefix at enqueue time, so it is redundant with the text by construction and nothing treats it as an
 *  independent authority. `priority` is upstream's `Wuo` key (`now`/`next`/`later`, L149146) — every entry we
 *  mint is `"now"` and the ladder that would use the other two (`getCommandsByMaxPriority`, L149130) is not
 *  ported, so the field is carried, not invented. `origin` is the other half of `P5`'s check. */
export interface QueueEntry {
  value: string;
  mode: "prompt" | "bash";
  priority: "now";
  pastedContents?: PastedMap;
  origin: "user";
}

/** `SKg` (L149146) — the one mode upstream refuses to hand back to the composer. */
const NON_EDITABLE_MODES = new Set<string>(["task-notification"]);

/** `P5` (L148879). Ours has no `isMeta` field (nothing in this port mints a meta entry) and one origin, so
 *  every entry the product enqueues today IS editable — the predicate is carried because the drain's whole
 *  shape depends on it (a non-editable entry must SURVIVE the drain, `e.push(...se)`), and because the day a
 *  non-user origin appears the drain must already know not to hand it to the user for editing. */
export function isEditableQueueEntry(e: QueueEntry): boolean {
  return !NON_EDITABLE_MODES.has(e.mode) && e.origin === "user";
}

/** The useChat half of `V`: fold every EDITABLE entry into one `\n`-joined text plus one paste map.
 *
 *  ID COLLISION, ours and not upstream's. Two queued entries were composed against two independent
 *  `pasteCounter`s, so both can carry a chip `#1`; merging their maps with `Object.assign` would keep one
 *  payload under that id and leave the other entry's `[Pasted text #1]` label pointing at it. Each entry is
 *  therefore run through `rebuildChips` against a RUNNING counter — the same re-mint editorHistory.ts does
 *  for a recalled entry, for the same reason — so the joined text and the merged map agree by construction.
 *  The counter starts at 0 here and the composer re-mints the whole pair a second time against the LIVE
 *  buffer's counter (`applyQueueDrain`), which is what keeps a queued chip from colliding with a draft one.
 *
 *  Returns null when nothing is editable, which is `V`'s `if (ce.length === 0) return`. */
export function joinQueuedForComposer(entries: readonly QueueEntry[]): { text: string; pastedContents?: PastedMap } | null {
  const editable = entries.filter(isEditableQueueEntry);
  if (editable.length === 0) return null;
  const merged: PastedMap = {};
  const parts: string[] = [];
  let counter = 0;
  for (const e of editable) {
    const built = rebuildChips({ display: e.value, pastedContents: e.pastedContents }, counter);
    counter = built.pasteCounter;
    for (const entry of Object.values(built.pastedContents)) merged[entry.id] = entry;
    parts.push(built.display);
  }
  const text = parts.filter(Boolean).join("\n");                                  // `[...ne, re].filter(Boolean)`
  return Object.keys(merged).length > 0 ? { text, pastedContents: merged } : { text };
}

/** The composer half of `GU`: land a drained batch ABOVE the live draft.
 *
 *  Cursor: upstream's `te = ne.join("\n").length + 1 + oe` keeps the caret exactly where it sat inside the
 *  draft, now offset past the queued text and its joining newline. Expressed on our `{row, col}` that is
 *  "the same column, `queuedLines` rows further down" — no flat-offset conversion, and no way to land out of
 *  range. With an empty draft the join drops it entirely and the caret goes to the end (divergence 3).
 *
 *  The old buffer's navigation/popup/undo state cannot survive text supplied from outside the editor, for
 *  the same reason `replaceBufferFromOutside` clears it — but the draft's own `pastedContents` MUST, since
 *  the draft itself is still in the buffer, chips and all. */
export function applyQueueDrain(s: EditorState, popped: { text: string; pastedContents?: PastedMap }): EditorState {
  const built = rebuildChips({ display: popped.text, pastedContents: popped.pastedContents }, s.pasteCounter);
  const draft = bufferText(s);
  const queuedLines = built.display.split("\n");
  const lines = [built.display, draft].filter(Boolean).join("\n").split("\n");
  const cursor = draft.length > 0
    ? { row: queuedLines.length + s.cursor.row, col: s.cursor.col }
    : { row: lines.length - 1, col: lines[lines.length - 1].length };
  return {
    ...s, lines, cursor,
    pastedContents: { ...s.pastedContents, ...built.pastedContents }, pasteCounter: built.pasteCounter,
    histIndex: null, stash: null, histEdits: new Map(), histMode: undefined, histRecalled: null,
    undo: [], mention: null, command: null, killRun: false, yankSite: null,
  };
}
