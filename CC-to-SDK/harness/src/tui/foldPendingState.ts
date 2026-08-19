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
//
//   3. TS Task 11 adds the THIRD piece, and it is the fullscreen-gated one of the three: `startedAt`, the
//      per-member start stamp the elapsed ticker anchors on. The GATE lives at the render site (canon computes
//      its anchor only inside `if (s && Ns())`, 518532), not here — this class stays a plain clock-reading
//      store. The bash `(Ns · N lines)` suffix that sits beside the ticker in canon is CUT, not deferred:
//      probe 100 found no per-tool progress feed reachable headlessly (spec §3.1, Revision Notes round 4).
//      T11 REVIEW FIX: the stamp is written at INGEST (`stampToolStarts` below, called from `useChat` beside
//      `stampAgentCalls`) and only READ at render. Stamping lazily at the render site — for whichever single
//      member happened to hold the anchor, and only when a projection actually reached that line — made a
//      member's reported age a function of the renderer: an EXPANDED cluster returns above the ticker and
//      stamps nobody, so collapsing it 40 s later restarted the call's clock at zero, and a parallel
//      `tool_use` batch stamped only its newest member, so the anchor handing back to the older one restarted
//      that one too. Arrival is the one moment every in-flight member passes through exactly once.
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
  /** TS Task 11 — the elapsed ticker's anchor, keyed by TOOL-USE ID rather than by run anchor. A pure READ:
   *  `undefined` is a member that never arrived through ingest (a replayed frame), and the ticker then stays
   *  silent rather than inventing an age from the moment this client happened to attach. */
  startedAt(memberId: string): number | undefined;
}

/** The WRITE half of the same seam, for the ingest side. Separate from `FoldPendingHooks` because the
 *  projection must never be able to stamp: a render is not evidence that anything started. */
export interface FoldStartStamps { stamp(memberId: string): void }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** One arriving host message → the start stamps for every `tool_use` it carries, mirroring
 *  `agentProgress.stampAgentCalls` (which `useChat` calls on the line above this one) including its
 *  `!ev.replay` guard: a replay omits durations, it does not invent them. Every block is stamped, not just
 *  the newest — which member holds the ticker's anchor changes as calls settle, and a member unstamped at
 *  arrival can only be stamped late. First-write-wins lives in `stamp`, so a redelivered frame is inert. */
export function stampToolStarts(pending: FoldStartStamps, message: unknown): void {
  if (!isRecord(message) || message.type !== "assistant") return;
  const inner = message.message, content = isRecord(inner) ? inner.content : undefined;
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (!isRecord(block) || block.type !== "tool_use") continue;
    const id = block.id;
    if (typeof id === "string" && id !== "") pending.stamp(id);
  }
}

/** The counters upstream holds in refs. `mcpServerNames` is a growing Set upstream and `thoughtForMs`
 *  is monotonic on its own clock, so neither needs (or gets) a ratchet here.
 *  TS Task 4 adds the fifth, `bashCount`, which canon ratchets on the same line (2.1.234:518466 ends
 *  `P.current = Math.max(P.current, e.bashCount ?? 0)`). It is ratcheted GROSS and its companion
 *  `gitOpBashCount` is deliberately NOT here: canon subtracts the git tally from the ratcheted gross count at
 *  clause time (518467), and ratcheting the tally too would stop the shell clause ever falling back. */
type Latched = { readCount: number; searchCount: number; listCount: number; mcpCallCount: number; bashCount: number };
type HintState = {
  shown: string | undefined; acceptedAt: number; accepted: boolean;   // `e8p`'s state + its `i` ref (initially 0, so the FIRST value lands immediately)
  thinking: string | undefined; thinkingAt: number;                   // `QWp`'s state + its `i` ref (stamped only when the value CHANGES — its effect deps are `[e, t]`)
};

/** The maxima written back onto the counts to render. `bashCount` is written back only when there IS one: a
 *  classic run carries no such field, and inventing a `bashCount: 0` on it would hand the fullscreen clause chain
 *  a counter the classic renderer never had. Everything else — `gitOpBashCount`, the four op arrays, the server
 *  names, the thought clock — rides through unratcheted on the incoming spread. */
const applyLatched = (counts: GroupCounts, latched: Latched): GroupCounts => ({
  ...counts, readCount: latched.readCount, searchCount: latched.searchCount, listCount: latched.listCount, mcpCallCount: latched.mcpCallCount,
  ...(latched.bashCount > 0 ? { bashCount: latched.bashCount } : {}),
});

export class FoldPendingState implements FoldPendingHooks {
  private readonly now: () => number;
  private readonly counts = new Map<string, Latched>();
  private readonly hints = new Map<string, HintState>();
  private readonly starts = new Map<string, number>();
  constructor(deps: { now?: () => number } = {}) { this.now = deps.now ?? (() => Date.now()); }

  /** R3.2. Returns the counts to RENDER: the incoming ones with each ratcheted counter replaced by the
   *  maximum this anchor has ever reported. */
  latch(anchorId: string, counts: GroupCounts): GroupCounts {
    const prev = this.counts.get(anchorId);
    const next: Latched = {
      readCount: Math.max(prev?.readCount ?? 0, counts.readCount), searchCount: Math.max(prev?.searchCount ?? 0, counts.searchCount),
      listCount: Math.max(prev?.listCount ?? 0, counts.listCount), mcpCallCount: Math.max(prev?.mcpCallCount ?? 0, counts.mcpCallCount),
      bashCount: Math.max(prev?.bashCount ?? 0, counts.bashCount ?? 0),
    };
    this.counts.set(anchorId, next);
    return applyLatched(counts, next);
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

  /** TS Task 11 — the third piece of time-dependent row state, and the ONE that must never be ratcheted.
   *  Canon anchors its elapsed ticker on the wire timestamp of the newest message carrying an in-flight
   *  tool_use (518532–518543); P82 established our wire carries no timestamps at all, so a member's start is
   *  the local moment the frame announcing it ARRIVED — accurate to the delivery, and never invented from a
   *  field the SDK does not send. Stamped ONCE per member and keyed by tool-use id, NOT by run anchor: the
   *  ticker follows whichever member is newest in flight, and that can hand the anchor back to an older
   *  member when a newer one settles — a single per-run slot would then re-stamp it and report a long-running
   *  call as brand new. And unlike `latch`, the value this feeds is free to FALL: a fresh call's age is zero,
   *  which is exactly what a watermark would refuse to show. */
  stamp(memberId: string): void { if (!this.starts.has(memberId)) this.starts.set(memberId, this.now()); }

  /** The render-side READ, and only a read (see the type). A member with no stamp — a replayed frame, or one
   *  that arrived before a document swap cleared the map — gets no ticker at all. */
  startedAt(memberId: string): number | undefined { return this.starts.get(memberId); }

  /** The published-row read. Max against the stored latch WITHOUT writing anything back. */
  peek(anchorId: string, counts: GroupCounts): GroupCounts {
    const prev = this.counts.get(anchorId);
    if (prev === undefined) return counts;
    return applyLatched(counts, {
      readCount: Math.max(prev.readCount, counts.readCount), searchCount: Math.max(prev.searchCount, counts.searchCount),
      listCount: Math.max(prev.listCount, counts.listCount), mcpCallCount: Math.max(prev.mcpCallCount, counts.mcpCallCount),
      bashCount: Math.max(prev.bashCount, counts.bashCount ?? 0),
    });
  }

  /** Every document swap (rewind, `/resume`, `/clear`): the anchors of the rebuilt transcript are the same
   *  tool-use ids, so a stale maximum would otherwise be latched onto a run that is being re-read from disk. */
  reset(): void { this.counts.clear(); this.hints.clear(); this.starts.clear(); }
}
