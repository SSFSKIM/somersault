// tui/src/foldPendingState.ts — F3 Task 4: the two pieces of group-row state that live OUTSIDE the pure
// projection, because they are functions of TIME rather than of the document. Upstream keeps both inside
// the row component `Ima` (L427895–428064), whose instance survives every re-render of a growing run; our
// projection is rebuilt from scratch on every 600 ms repaint, so the equivalent state has to be owned by
// `useChat` and keyed by the run's ANCHOR (its first member's tool-use id, the one id that does not change
// as the run grows).
//
//   1. R3.2 — the counters are held in refs and monotonically ratcheted (`w.current = Math.max(w.current, c)`,
//      L427896–427897). This matters because our counts can genuinely DROP mid-run: R1.5's read quirk counts
//      distinct `file_path`s OR bare read operations and only one of the two survives, so two `Bash("cat …")`
//      reads followed by a `Read(file_path)` would take a live row from "Reading 2 files" back to 1.
//   2. R4.7 steps 4–5 — the hint is throttled (`e8p(te, MAH)`, MAH = 700 ms) and a thinking summary outranks
//      it while it is fresh (`QWp(latestThinkingSummary, DAH)`, DAH = 3000 ms), rendered italic.
//
// NEITHER is `ds()`-gated: only the elapsed `· Ns` anchor (R4.10) and the bash progress suffix are, which is
// what the F1-era comment in toolRenderer.tsx got wrong.
import type { GroupCounts } from "./toolFold.js";

/** Upstream `MAH` (L428157): the hint updates at most this often. */
export const HINT_DEBOUNCE_MS = 700;
/** Upstream `DAH` (L428157): how long a thinking summary keeps the hint slot after it last changed. */
export const THINKING_LINGER_MS = 3000;

/** What the renderer puts in the `⎿` slot: the resolved text plus which of the two variants won. */
export interface HintView { text: string; italic: boolean }
/** The seam `ProjectionContext` carries — a narrow structural type so the projection never depends on the
 *  class (and a test can hand it a stub). */
export interface FoldPendingHooks {
  latch(anchorId: string, counts: GroupCounts): GroupCounts;
  /** Non-mutating read of the same maximum, for the PUBLISHED row (task-4 review): upstream's ratchet
   *  assignment is unconditional across renders of the mounted row, so the on-screen row never downgrades
   *  when the run settles — but sweeping a replayed transcript must not CREATE latch entries, hence a peek
   *  rather than a latch. An anchor never latched (fresh mount/replay) reads back exactly its own counts,
   *  which is upstream's fresh-mount recompute. */
  peek(anchorId: string, counts: GroupCounts): GroupCounts;
  hint(anchorId: string, candidate: string | undefined, thinking: string | undefined): HintView | undefined;
}

/** The four counters upstream holds in refs. `mcpServerNames` is a growing Set upstream and `thoughtForMs`
 *  is monotonic on its own clock, so neither needs (or gets) a ratchet here. */
type Latched = { readCount: number; searchCount: number; listCount: number; mcpCallCount: number };
type HintState = {
  shown: string | undefined; acceptedAt: number; accepted: boolean;   // `e8p`'s state + its `i` ref (initially 0, so the FIRST value lands immediately)
  thinking: string | undefined; thinkingAt: number;                   // `QWp`'s state + its `i` ref (stamped only when the value CHANGES — its effect deps are `[e, t]`)
};

export class FoldPendingState implements FoldPendingHooks {
  private readonly now: () => number;
  private readonly counts = new Map<string, Latched>();
  private readonly hints = new Map<string, HintState>();
  constructor(deps: { now?: () => number } = {}) { this.now = deps.now ?? (() => Date.now()); }

  /** R3.2. Returns the counts to RENDER: the incoming ones with each ratcheted counter replaced by the
   *  maximum this anchor has ever reported. */
  latch(anchorId: string, counts: GroupCounts): GroupCounts {
    const prev = this.counts.get(anchorId);
    const next: Latched = {
      readCount: Math.max(prev?.readCount ?? 0, counts.readCount), searchCount: Math.max(prev?.searchCount ?? 0, counts.searchCount),
      listCount: Math.max(prev?.listCount ?? 0, counts.listCount), mcpCallCount: Math.max(prev?.mcpCallCount ?? 0, counts.mcpCallCount),
    };
    this.counts.set(anchorId, next);
    return { ...counts, ...next };
  }

  /** R4.7 steps 4–5. The debounce runs FIRST and unconditionally — upstream's `e8p` is a hook, so it keeps
   *  advancing while the summary happens to be occupying the slot, and the moment the linger expires the
   *  CURRENT hint is already there rather than one 700 ms window behind.
   *
   *  DELIBERATE DIVERGENCE from `QWp`, adjudicated with Task 3's finding: upstream clears
   *  `latestThinkingSummary` at the top of its tool-absorption branch (L302197) and `QWp` then lingers the
   *  last value `DAH` past that clear. We never clear the field — one of our fold groups IS a tool run, so
   *  the clear would zero the summary before it could ever render — so the linger is measured from the
   *  summary's last CHANGE instead. Same 3000 ms, same italic, same "then the ordinary hint returns". */
  hint(anchorId: string, candidate: string | undefined, thinking: string | undefined): HintView | undefined {
    const now = this.now();
    let state = this.hints.get(anchorId);
    if (state === undefined) { state = { shown: undefined, acceptedAt: 0, accepted: false, thinking: undefined, thinkingAt: 0 }; this.hints.set(anchorId, state); }
    if (candidate !== state.shown && (!state.accepted || now - state.acceptedAt >= HINT_DEBOUNCE_MS)) { state.shown = candidate; state.acceptedAt = now; state.accepted = true; }
    if (thinking !== undefined && thinking !== state.thinking) { state.thinking = thinking; state.thinkingAt = now; }
    if (state.thinking !== undefined && now - state.thinkingAt < THINKING_LINGER_MS) return { text: state.thinking, italic: true };
    return state.shown === undefined ? undefined : { text: state.shown, italic: false };
  }

  /** The published-row read. Max against the stored latch WITHOUT writing anything back. */
  peek(anchorId: string, counts: GroupCounts): GroupCounts {
    const prev = this.counts.get(anchorId);
    if (prev === undefined) return counts;
    return { ...counts, readCount: Math.max(prev.readCount, counts.readCount), searchCount: Math.max(prev.searchCount, counts.searchCount), listCount: Math.max(prev.listCount, counts.listCount), mcpCallCount: Math.max(prev.mcpCallCount, counts.mcpCallCount) };
  }

  /** Every document swap (rewind, `/resume`, `/clear`): the anchors of the rebuilt transcript are the same
   *  tool-use ids, so a stale maximum would otherwise be latched onto a run that is being re-read from disk. */
  reset(): void { this.counts.clear(); this.hints.clear(); }
}
