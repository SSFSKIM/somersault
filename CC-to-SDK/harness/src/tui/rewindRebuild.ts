// tui/rewindRebuild.ts — the arithmetic EP-S1 needs. No React, no I/O.
//
// THE DISTINCTION THIS MODULE EXISTS FOR (Wave S, W-S1; conflating the two is what made three earlier
// fixes wrong). The persisted session FILE is append-only JSONL holding every branch ever written.
// `getSessionMessages` returns a RESOLVED conversation chain — leaf-selected, parentUuid-walked,
// compaction-relinked via compactMetadata.preservedMessages — and it STRIPS parentUuid from the rows it
// hands back (measured on a real rewound session, 2026-08-07: the returned keys are type, uuid,
// session_id, message, parent_tool_use_id, parent_agent_id, timestamp). So nothing here walks a parent
// chain: the SDK already did, better than we could, and the field is not even present to walk.
//
// WHY A CUT IS NEEDED AT ALL. `rebuildAfterRewind` runs the instant the engine swap settles, and at that
// moment the row that MOVES the leaf onto the new branch has not been written — the row appended then is
// a `last-prompt` row, which is neither user nor assistant and therefore moves no leaf. The reader is
// still resolving the PRE-rewind chain and returns the very turns the rewind discarded. The anchor's
// `prevUuid` is the exact uuid the host handed `resumeSessionAt`, so it is the last row the restored
// conversation keeps: cutting there is race-free and correct whether or not the file has moved on.

/** The reader's rows, cut after the row whose uuid is `prevUuid` (inclusive).
 *
 *  Two fallbacks, both returning the rows UNCHANGED, and both deliberately on the side of showing more
 *  rather than fewer — the side the pre-fix code was already on, and the only safe side when the input is
 *  ambiguous:
 *   · no `prevUuid` — a rewind we did not initiate whose anchor never reached us;
 *   · `prevUuid` not among `rows` — the anchor is one the reader DROPPED. Measured case (probe 68e): a
 *     pre-compaction anchor, which `getSessionMessages` does not return at all once a boundary has been
 *     written. Cutting is impossible there and showing what the reader gave us is the honest answer.
 *  So this function can only ever REMOVE rows the reader returned; it has no way to reach one the reader
 *  dropped, which is exactly what a hand-rolled parentUuid walk would do (W-S1(c)).
 *
 *  WHAT THE SECOND FALLBACK DOES **NOT** COVER, corrected after the t1 review claimed otherwise in an
 *  earlier draft of this comment: it does not protect a reader that has already resolved onto the
 *  POST-rewind branch. There `prevUuid` IS present — it is the last preserved row — so the cut runs and
 *  would drop any turns taken since. That is unreachable today (post-rewind the file is non-empty on the
 *  first read, so the poll never lingers long enough for a new turn to land mid-rebuild, and the
 *  confirming client is held behind the `rewinding` modal), but it is a real edge, not a guarded one. */
export function truncateAtAnchor<T extends { uuid?: unknown }>(rows: readonly T[], prevUuid?: string | null): T[] {
  if (!prevUuid) return [...rows];
  const at = rows.findIndex((r) => r?.uuid === prevUuid);
  return at === -1 ? [...rows] : rows.slice(0, at + 1);
}
