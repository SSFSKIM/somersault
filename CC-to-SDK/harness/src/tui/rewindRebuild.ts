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
 *   · `prevUuid` not among `rows` — the reader has already resolved onto the POST-rewind branch, where
 *     the anchor's successors are the user's new turns and cutting would delete them.
 *  The second fallback is also what makes the compaction hazard unreachable: this function can only
 *  remove rows the reader returned, never reach one it dropped. */
export function truncateAtAnchor<T extends { uuid?: unknown }>(rows: readonly T[], prevUuid?: string | null): T[] {
  if (!prevUuid) return [...rows];
  const at = rows.findIndex((r) => r?.uuid === prevUuid);
  return at === -1 ? [...rows] : rows.slice(0, at + 1);
}
