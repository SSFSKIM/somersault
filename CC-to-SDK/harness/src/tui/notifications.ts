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
// have to re-derive them: one `current` at a time; `priority:"immediate"` preempts `current` SYNCHRONOUSLY;
// the timeout clears `current` and pulls the next; a same-key `add` folds when the arrival carries a `fold`
// and otherwise REPLACES and restarts the timer; `invalidates` drops matching queue entries; `pinned:true`
// bypasses the queue entirely and accumulates.
//
// THREE recorded divergences (plan constraint 12):
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

/** `mXs` (L394050), minus the two fields this port has no producer for — divergence 1 in the header. */
function requeueOnPreempt(prev: CcxNotification, next: CcxNotification): boolean {
  return prev.priority !== "immediate" && !next.invalidates?.includes(prev.key);
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

  /** (Re)arm the expiry for whatever `current` is now. Always stops the old one first — this is what makes a
   *  same-key REPLACE restart the clock, which the `effort-level` hint's repeated `/effort` presses rely on. */
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
      const at = pinned.findIndex((p) => p.key === n.key);
      pinned = at >= 0 ? pinned.map((p, i) => (i === at ? (n.fold ? n.fold!(p, n) : n) : p)) : [...pinned, n];
      emit(); return;
    }
    if (n.invalidates?.length) { const drop = new Set(n.invalidates); queue = queue.filter((q) => !drop.has(q.key)); }
    if (current && current.key === n.key) {
      if (n.fold) current = n.fold(current, n);                         // a fold MERGES: the deadline keeps running
      else { current = n; startTimer(); }                               // a replace RESTARTS it
      emit(); return;
    }
    const at = queue.findIndex((q) => q.key === n.key);
    if (at >= 0) { queue = queue.map((q, i) => (i === at ? (n.fold ? n.fold!(q, n) : n) : q)); emit(); return; }
    if (!current) { current = n; startTimer(); emit(); return; }
    if ((n.priority ?? "low") === "immediate") {
      const prev = current;
      current = n;                                                      // synchronous preemption
      if (requeueOnPreempt(prev, n)) queue = [...queue, prev];
      startTimer(); emit(); return;
    }
    queue = [...queue, n]; emit();
  }

  function remove(key: string): void {
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
