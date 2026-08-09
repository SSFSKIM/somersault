// tui/src/notifications.ts — Wave C Task 1 (EP-C1a): the ephemeral-hint QUEUE, pure. No React, no Ink, no
// timers of its own — every timer goes through the `deps` seam so the unit tests drive time synthetically
// (plan constraint 15) and so `useChat`, which owns the single instance, can be tested without a real clock.
//
// Transcribed from 2.1.220 (annex §C1.6, `Ds()` at L393965–L394047, state shape `{current, queue, pinned}` at
// L399223):
//  · `fXs = 8000`                                        (L394069)  the default timeoutMs
//  · `dBt = {immediate:0, high:1, medium:2, low:3}`      (L394070)  priority order — the LOWEST number wins
//  · `Iq_`                                                          picks that lowest-numbered entry from the queue
//  · `mXs(e, t)`                                         (L394050)  whether a PREEMPTED entry goes back on the queue
//
// The rules this file owes upstream, in one place because four later tasks post to it and none of them should
// have to re-derive them: one `current` at a time; `priority:"immediate"` preempts `current` SYNCHRONOUSLY and
// the entry it displaces goes back on the HEAD of the queue (`[current, ...queue]`, L394001), so an equal-rank
// tie promotes it ahead of whatever was already waiting; the immediate branch runs BEFORE any same-key handling
// (L393987), so an immediate arrival preempts even when its key is already queued; the timeout clears `current`
// and pulls the next; a same-key `add` into `current` folds when the arrival carries a `fold` and otherwise
// REPLACES — either way the timer RESTARTS, off the resulting entry's own `timeoutMs ?? 8000` (L394010);
// `invalidates` drops matching queue entries AND clears a matching `current`, after which `processQueue`
// promotes the best of what is left rather than the arrival (L394027); `pinned:true` bypasses the queue
// entirely, accumulates, IGNORES a duplicate key outright (L393977) and only ever leaves via `remove`; and a
// `remove` of a key that is nowhere does not notify (upstream returns the same state object, L394040).
//
// FOUR recorded divergences (plan constraint 12):
//
//  1. `mXs`'s SECOND AND THIRD DISJUNCTS ARE DROPPED. Upstream re-queues a preempted entry when
//     `(e.priority !== "immediate" || e.requeueOnPreempt === true || e.heldDuringDiffPanel === true)
//      && !t.invalidates?.includes(e.key)`. Neither `requeueOnPreempt` nor `heldDuringDiffPanel` is on this
//     port's `CcxNotification` — no producer in the Wave C hint inventory sets either — so the predicate here
//     is the surviving `e.priority !== "immediate" && !t.invalidates?.includes(e.key)`. Add the fields to the
//     interface, not a special case at the call site, if a producer ever needs them.
//
//  2. NO DIFF-PANEL HOLD. Upstream suppresses preemption while its diff panel is visible and marks the held
//     entry `heldDuringDiffPanel` (hence `exemptFromDiffPanelHold`); ccx has no diff panel, so preemption is
//     unconditional. This is the same omission as divergence 1 seen from the other side.
//
//  3. NO `segments` ARM. Upstream's renderer (`$Rr`, L488834) has three arms — `jsx`, `segments`, plain text.
//     This port carries `jsx` and text; nothing in the Wave C inventory mints a `segments` entry, and a
//     pre-built node covers the one case that needs structure (`token-warning`). See NotificationSlot.tsx.
//
//  4. A SAME-KEY RE-ADD REPLACES; UPSTREAM DROPS IT. Upstream's non-immediate path dedups by key — past the
//     `fold` arms it returns the state untouched when the key is already `current` or already queued
//     (L394022), so a plain re-add of a live key changes nothing. Restarting the clock is achieved at the
//     PRODUCER instead: the effort hint calls `hp("effort-level")` (`removeNotification`) and only then
//     `Nd({key:"effort-level", …})` (L496132), and that remove-then-add is what makes every `/effort` press
//     restart the 10s deadline. This port keeps replace-and-restart as a deliberate SUPERSET: a producer that
//     does the upstream remove-then-add dance still gets upstream's behaviour, and one that just re-adds gets
//     the same visible result instead of a silently swallowed hint. Nothing here depends on the swallow.
//
// Entries are stored BY IDENTITY, never normalized into a copy: `state().current` is the very object that was
// added, so `useChat` can mirror it into React state and a consumer can compare by reference. Defaults are
// applied at read time by `priorityRank` / `timeoutOf` instead.

/** `dBt`'s four levels (L394070). */
export type NotificationPriority = "immediate" | "high" | "medium" | "low";

/** One entry. `text` renders dim unless `color` is set; `jsx` is a pre-built node that wins over both. */
export interface CcxNotification {
  key: string;
  text?: string;
  color?: string;
  jsx?: unknown;
  /** Default `"low"`. `"immediate"` preempts the current entry synchronously. */
  priority?: NotificationPriority;
  /** Default `NOTIFICATION_DEFAULT_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** Same-key merge. Present on the ARRIVAL, applied as `fold(existing, arrival)`; without it a same-key add
   *  replaces the entry and restarts its timer. */
  fold?: (prev: CcxNotification, next: CcxNotification) => CcxNotification;
  /** Keys to drop from the queue on arrival (and to refuse re-queueing on preemption). */
  invalidates?: string[];
  /** Bypasses the queue entirely: never becomes `current`, never expires, only `remove` clears it. */
  pinned?: boolean;
}

export interface NotificationStore {
  add(n: CcxNotification): void;
  remove(key: string): void;
  state(): { current: CcxNotification | null; pinned: CcxNotification[] };
  /** Fires synchronously after EVERY state change. Returns its own unsubscribe. */
  subscribe(fn: () => void): () => void;
}

/** The `deps` seam. Handles are opaque so a synthetic scheduler can hand back whatever it likes. */
export interface NotificationDeps {
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (h: unknown) => void;
}

/** `fXs` (L394069). */
export const NOTIFICATION_DEFAULT_TIMEOUT_MS = 8000;

/** `dBt` (L394070) — lowest number wins. */
export const NOTIFICATION_PRIORITY_ORDER: Record<NotificationPriority, number> = { immediate: 0, high: 1, medium: 2, low: 3 };

/** Read-time default: an entry with no `priority` is `"low"`. */
export function priorityRank(n: CcxNotification): number { return NOTIFICATION_PRIORITY_ORDER[n.priority ?? "low"]; }

function timeoutOf(n: CcxNotification): number { return n.timeoutMs ?? NOTIFICATION_DEFAULT_TIMEOUT_MS; }

/** `mXs` (L394050), minus the two fields this port has no producer for — divergence 1 in the header. Upstream
 *  applies it as a FILTER over `[current, ...queue]` when an immediate arrives, which is how the preempted
 *  entry lands at the head; `invalidated` is the arrival's `invalidates` set. */
function survivesPreempt(e: CcxNotification, invalidated: Set<string> | null): boolean {
  return e.priority !== "immediate" && !invalidated?.has(e.key);
}

export function createNotificationStore(deps: NotificationDeps = {}): NotificationStore {
  const schedule = deps.setTimeout ?? ((fn: () => void, ms: number): unknown => setTimeout(fn, ms));
  const cancel = deps.clearTimeout ?? ((h: unknown): void => { clearTimeout(h as ReturnType<typeof setTimeout>); });

  let current: CcxNotification | null = null;
  let queue: CcxNotification[] = [];
  let pinned: CcxNotification[] = [];
  let handle: unknown = null;
  const subs = new Set<() => void>();

  // Copy before iterating: a subscriber that unsubscribes (or subscribes) from inside its own callback must not
  // mutate the set being walked. `useChat` mirrors into React state here, so re-entrancy is not hypothetical.
  const emit = (): void => { for (const fn of [...subs]) fn(); };

  const stopTimer = (): void => { if (handle !== null) { cancel(handle); handle = null; } };

  /** (Re)arm the expiry for whatever `current` is now, off THAT entry's `timeoutMs ?? 8000`. Always stops the
   *  old one first — this is what makes a same-key fold or replace restart the clock, which the `effort-level`
   *  hint's repeated `/effort` presses rely on. */
  const startTimer = (): void => {
    stopTimer();
    const n = current;
    if (!n) return;
    handle = schedule(() => { handle = null; current = null; processQueue(); emit(); }, timeoutOf(n));
  };

  /** `Iq_`: promote the lowest-numbered priority, ties broken by arrival order. No-op while a `current` holds. */
  function processQueue(): void {
    if (current || queue.length === 0) return;
    let at = 0;
    for (let i = 1; i < queue.length; i++) if (priorityRank(queue[i]) < priorityRank(queue[at])) at = i;
    current = queue[at];
    queue = queue.filter((_, i) => i !== at);
    startTimer();
  }

  function add(n: CcxNotification): void {
    if (n.pinned) {                                                     // bypasses the queue entirely
      if (pinned.some((p) => p.key === n.key)) return;                  // a duplicate pinned key is ignored outright
      pinned = [...pinned, n]; emit(); return;
    }
    const invalidated = n.invalidates?.length ? new Set(n.invalidates) : null;
    if ((n.priority ?? "low") === "immediate") {                        // FIRST — before any same-key handling
      queue = (current ? [current, ...queue] : queue).filter((q) => survivesPreempt(q, invalidated));
      current = n; startTimer(); emit(); return;                        // synchronous preemption, displaced entry at the head
    }
    if (current && current.key === n.key) {
      current = n.fold ? n.fold(current, n) : n;                        // a fold MERGES, a plain re-add REPLACES…
      startTimer(); emit(); return;                                     // …and either way the deadline restarts
    }
    const at = queue.findIndex((q) => q.key === n.key);
    if (at >= 0) { queue = queue.map((q, i) => (i === at ? (n.fold ? n.fold(q, n) : n) : q)); emit(); return; }
    if (invalidated) {
      queue = queue.filter((q) => !invalidated.has(q.key));
      if (current && invalidated.has(current.key)) { stopTimer(); current = null; }   // the current one dies too
    }
    queue = [...queue, n]; processQueue(); emit();                      // promotes the BEST entry, not necessarily `n`
  }

  function remove(key: string): void {
    if (current?.key !== key && !queue.some((q) => q.key === key) && !pinned.some((p) => p.key === key)) return;
    pinned = pinned.filter((p) => p.key !== key);
    queue = queue.filter((q) => q.key !== key);
    if (current && current.key === key) { stopTimer(); current = null; processQueue(); }
    emit();
  }

  return {
    add, remove,
    state: () => ({ current, pinned: [...pinned] }),
    subscribe(fn: () => void): () => void { subs.add(fn); return () => { subs.delete(fn); }; },
  };
}
