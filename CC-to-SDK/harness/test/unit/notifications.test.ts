// tui/test/notifications.test.ts — Wave C Task 1 (EP-C1a). Pins the ephemeral-hint queue's semantics from
// annex §C1.6 (`Ds()`, L393965–L394047): one `current` at a time, lowest priority number wins from the queue,
// `immediate` preempts synchronously, the timeout clears `current` and pulls the next, `fold` merges a same-key
// re-add while a plain re-add REPLACES and RESTARTS the timer, `invalidates` drops queued entries, `pinned`
// bypasses the queue entirely.
//
// EVERY TIMER HERE IS INJECTED (plan constraint 15). `fakeClock` below is the whole clock: no `await sleep`,
// no vitest fake timers, so a test that mis-orders a timer fails deterministically instead of flaking.
import { describe, it, expect } from "vitest";
import { createNotificationStore, NOTIFICATION_DEFAULT_TIMEOUT_MS, type CcxNotification } from "../../src/tui/notifications.js";

/** A synthetic scheduler matching the store's `deps` seam: `setTimeout(fn, ms) → handle`, `clearTimeout(handle)`.
 *  `advance(ms)` fires every timer whose deadline lands in the window, in deadline order, so a callback that
 *  schedules another timer inside the same window still runs at its own deadline. */
function fakeClock() {
  let now = 0, seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    deps: {
      setTimeout: (fn: () => void, ms: number): unknown => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; },
      clearTimeout: (h: unknown): void => { timers.delete(h as number); },
    },
    advance(ms: number): void {
      const target = now + ms;
      for (;;) {
        let id = -1, at = Infinity;
        for (const [k, t] of timers) if (t.at <= target && t.at < at) { id = k; at = t.at; }
        if (id < 0) break;
        const t = timers.get(id)!; timers.delete(id); now = t.at; t.fn();
      }
      now = target;
    },
    pending: (): number => timers.size,
  };
}

const key = (n: CcxNotification | null) => n?.key ?? null;

describe("notification queue: priority ordering", () => {
  it("pulls the lowest priority NUMBER from the queue, not the earliest arrival (dBt, L394070)", () => {
    const clock = fakeClock();
    const store = createNotificationStore(clock.deps);
    store.add({ key: "a" });                                    // no current → becomes current immediately
    store.add({ key: "b" });                                    // default priority is "low" (3)
    store.add({ key: "c", priority: "high" });                  // 1
    store.add({ key: "d", priority: "medium" });                // 2
    expect(key(store.state().current)).toBe("a");
    clock.advance(NOTIFICATION_DEFAULT_TIMEOUT_MS);
    expect(key(store.state().current)).toBe("c");
    clock.advance(NOTIFICATION_DEFAULT_TIMEOUT_MS);
    expect(key(store.state().current)).toBe("d");
    clock.advance(NOTIFICATION_DEFAULT_TIMEOUT_MS);
    expect(key(store.state().current)).toBe("b");
    clock.advance(NOTIFICATION_DEFAULT_TIMEOUT_MS);
    expect(store.state().current).toBeNull();
    expect(clock.pending()).toBe(0);                            // the drained queue leaves no timer behind
  });

  it("keeps arrival order among equal priorities", () => {
    const clock = fakeClock();
    const store = createNotificationStore(clock.deps);
    store.add({ key: "cur" }); store.add({ key: "x" }); store.add({ key: "y" });
    clock.advance(NOTIFICATION_DEFAULT_TIMEOUT_MS);
    expect(key(store.state().current)).toBe("x");
    clock.advance(NOTIFICATION_DEFAULT_TIMEOUT_MS);
    expect(key(store.state().current)).toBe("y");
  });
});

describe("notification queue: immediate preemption", () => {
  it("takes the slot synchronously and re-queues the entry it displaced", () => {
    const clock = fakeClock();
    const store = createNotificationStore(clock.deps);
    store.add({ key: "token-warning", priority: "medium" });
    store.add({ key: "escape-again-to-clear", priority: "immediate", timeoutMs: 1000 });
    expect(key(store.state().current)).toBe("escape-again-to-clear");    // synchronous, no tick needed
    clock.advance(1000);
    expect(key(store.state().current)).toBe("token-warning");            // mXs re-queued it
  });

  it("does NOT re-queue a preempted immediate (mXs, L394050)", () => {
    const clock = fakeClock();
    const store = createNotificationStore(clock.deps);
    store.add({ key: "first", priority: "immediate", timeoutMs: 3000 });
    store.add({ key: "second", priority: "immediate", timeoutMs: 3000 });
    expect(key(store.state().current)).toBe("second");
    clock.advance(3000);
    expect(store.state().current).toBeNull();                            // "first" is gone, not re-queued
  });

  it("drops the preempted entry when the preemptor invalidates its key", () => {
    const clock = fakeClock();
    const store = createNotificationStore(clock.deps);
    store.add({ key: "effort-level", priority: "high" });
    store.add({ key: "model-switched", priority: "immediate", timeoutMs: 3000, invalidates: ["effort-level"] });
    clock.advance(3000);
    expect(store.state().current).toBeNull();
  });

  it("queues a non-immediate arrival instead of preempting", () => {
    const clock = fakeClock();
    const store = createNotificationStore(clock.deps);
    store.add({ key: "a", priority: "medium" });
    store.add({ key: "b", priority: "high" });
    expect(key(store.state().current)).toBe("a");                        // "high" beats "medium" in the QUEUE only
  });

  it("re-queues the preempted entry at the HEAD, so an equal-priority tie promotes IT first (L394001)", () => {
    const clock = fakeClock();
    const store = createNotificationStore(clock.deps);
    store.add({ key: "cur", priority: "medium" });
    store.add({ key: "waiting", priority: "medium" });                   // already in line, same rank
    store.add({ key: "flash", priority: "immediate", timeoutMs: 1000 });
    expect(key(store.state().current)).toBe("flash");
    clock.advance(1000);
    expect(key(store.state().current)).toBe("cur");                      // `[current, ...queue]`, and Iq_ keeps the first
    clock.advance(NOTIFICATION_DEFAULT_TIMEOUT_MS);
    expect(key(store.state().current)).toBe("waiting");
  });

  it("preempts even when the arriving key is already QUEUED (the immediate branch runs FIRST, L393987)", () => {
    const clock = fakeClock();
    const store = createNotificationStore(clock.deps);
    store.add({ key: "cur", priority: "medium" });
    store.add({ key: "x", text: "queued", priority: "medium" });
    store.add({ key: "x", text: "now", priority: "immediate", timeoutMs: 1000 });
    expect(key(store.state().current)).toBe("x");                        // NOT folded/replaced in place behind "cur"
    expect(store.state().current?.text).toBe("now");
  });
});

describe("notification queue: timeouts", () => {
  it("defaults to 8000ms (fXs, L394069)", () => {
    const clock = fakeClock();
    const store = createNotificationStore(clock.deps);
    store.add({ key: "a" });
    clock.advance(NOTIFICATION_DEFAULT_TIMEOUT_MS - 1);
    expect(key(store.state().current)).toBe("a");
    clock.advance(1);
    expect(store.state().current).toBeNull();
  });

  it("honours a per-entry timeoutMs", () => {
    const clock = fakeClock();
    const store = createNotificationStore(clock.deps);
    store.add({ key: "a", timeoutMs: 1000 });
    clock.advance(1000);
    expect(store.state().current).toBeNull();
  });

  it("RESTARTS the timer when the same key is re-added without a fold (the effort hint depends on this)", () => {
    const clock = fakeClock();
    const store = createNotificationStore(clock.deps);
    store.add({ key: "effort-level", text: "● high", priority: "high", timeoutMs: 10_000 });
    clock.advance(9_000);
    store.add({ key: "effort-level", text: "● max", priority: "high", timeoutMs: 10_000 });
    expect(store.state().current?.text).toBe("● max");                   // replaced
    clock.advance(9_000);
    expect(key(store.state().current)).toBe("effort-level");             // 18s in and still up — the clock restarted
    clock.advance(1_000);
    expect(store.state().current).toBeNull();
  });
});

describe("notification queue: fold", () => {
  it("merges a same-key re-add through fold(prev, next)", () => {
    const clock = fakeClock();
    const store = createNotificationStore(clock.deps);
    const fold = (prev: CcxNotification, next: CcxNotification): CcxNotification => ({ ...next, text: `${prev.text}+${next.text}` });
    store.add({ key: "env-hook", text: "one" });
    store.add({ key: "env-hook", text: "two", fold });
    expect(store.state().current?.text).toBe("one+two");
  });

  it("folds a QUEUED entry in place without disturbing the current one", () => {
    const clock = fakeClock();
    const store = createNotificationStore(clock.deps);
    const fold = (prev: CcxNotification, next: CcxNotification): CcxNotification => ({ ...next, text: `${prev.text}+${next.text}` });
    store.add({ key: "cur" });
    store.add({ key: "env-hook", text: "one" });
    store.add({ key: "env-hook", text: "two", fold });
    expect(key(store.state().current)).toBe("cur");
    clock.advance(NOTIFICATION_DEFAULT_TIMEOUT_MS);
    expect(store.state().current?.text).toBe("one+two");
  });

  it("RESTARTS the timer on a fold, off the FOLDED entry's own `timeoutMs ?? 8000` (L394010)", () => {
    const clock = fakeClock();
    const store = createNotificationStore(clock.deps);
    // The fold result deliberately drops `timeoutMs`, so the restarted deadline is the 8s DEFAULT: a store that
    // kept the arrival's 5s (or the original deadline) fails here rather than quietly reading the wrong entry.
    const fold = (prev: CcxNotification, next: CcxNotification): CcxNotification => ({ key: next.key, text: `${prev.text}+${next.text}` });
    store.add({ key: "env-hook", text: "one", timeoutMs: 5_000 });
    clock.advance(4_000);
    store.add({ key: "env-hook", text: "two", timeoutMs: 5_000, fold });
    clock.advance(1_000);                                                // t=5s — the ORIGINAL deadline no longer rules
    expect(store.state().current?.text).toBe("one+two");
    clock.advance(NOTIFICATION_DEFAULT_TIMEOUT_MS - 1_000 - 1);          // t=11_999
    expect(key(store.state().current)).toBe("env-hook");
    clock.advance(1);                                                    // t=12_000 = fold instant + 8s
    expect(store.state().current).toBeNull();
  });
});

describe("notification queue: invalidates", () => {
  it("drops matching queue entries", () => {
    const clock = fakeClock();
    const store = createNotificationStore(clock.deps);
    store.add({ key: "cur" });
    store.add({ key: "doomed" });
    store.add({ key: "kept" });
    store.add({ key: "arrival", invalidates: ["doomed"] });
    clock.advance(NOTIFICATION_DEFAULT_TIMEOUT_MS);
    expect(key(store.state().current)).toBe("kept");
    clock.advance(NOTIFICATION_DEFAULT_TIMEOUT_MS);
    expect(key(store.state().current)).toBe("arrival");
    clock.advance(NOTIFICATION_DEFAULT_TIMEOUT_MS);
    expect(store.state().current).toBeNull();                            // "doomed" never surfaced
  });

  it("CLEARS a matching current too, then promotes the best of what is left (L394027)", () => {
    const clock = fakeClock();
    const store = createNotificationStore(clock.deps);
    store.add({ key: "X" });                                             // current, "low"
    store.add({ key: "Z", priority: "high" });                           // queued behind it
    store.add({ key: "Y", priority: "medium", invalidates: ["X"] });     // non-immediate: no preemption, but X dies
    expect(key(store.state().current)).toBe("Z");                        // processQueue promoted the BEST, not the arrival
    clock.advance(NOTIFICATION_DEFAULT_TIMEOUT_MS);
    expect(key(store.state().current)).toBe("Y");
    clock.advance(NOTIFICATION_DEFAULT_TIMEOUT_MS);
    expect(store.state().current).toBeNull();                            // "X" never came back
  });
});

describe("notification queue: remove", () => {
  it("removes a QUEUED (non-current) key without touching the current one", () => {
    const clock = fakeClock();
    const store = createNotificationStore(clock.deps);
    store.add({ key: "cur", timeoutMs: 1000 });
    store.add({ key: "b" });
    store.add({ key: "c" });
    store.remove("b");
    expect(key(store.state().current)).toBe("cur");
    clock.advance(1000);
    expect(key(store.state().current)).toBe("c");
  });

  it("removing the current one advances the queue immediately", () => {
    const clock = fakeClock();
    const store = createNotificationStore(clock.deps);
    store.add({ key: "cur" }); store.add({ key: "next" });
    store.remove("cur");
    expect(key(store.state().current)).toBe("next");
    expect(clock.pending()).toBe(1);                                     // the old timer was cancelled, one new one runs
  });

  it("removing an unknown key is a no-op — and fires NO subscriber (upstream returns the same object)", () => {
    const clock = fakeClock();
    const store = createNotificationStore(clock.deps);
    store.add({ key: "cur" });
    let calls = 0;
    store.subscribe(() => { calls++; });
    store.remove("nope");
    expect(key(store.state().current)).toBe("cur");
    expect(calls).toBe(0);                                               // nothing changed, so nothing re-rendered
    store.remove("cur");
    expect(calls).toBe(1);                                               // …but a real removal does notify
  });
});

describe("notification queue: pinned", () => {
  it("bypasses the queue and accumulates, leaving current alone", () => {
    const clock = fakeClock();
    const store = createNotificationStore(clock.deps);
    store.add({ key: "cur" });
    store.add({ key: "p1", text: "one", pinned: true });
    store.add({ key: "p2", text: "two", pinned: true });
    expect(key(store.state().current)).toBe("cur");
    expect(store.state().pinned.map((p) => p.key)).toEqual(["p1", "p2"]);
    clock.advance(NOTIFICATION_DEFAULT_TIMEOUT_MS * 4);
    expect(store.state().pinned.map((p) => p.key)).toEqual(["p1", "p2"]);   // no timer ever touches a pinned entry
  });

  it("IGNORES a duplicate pinned key — never replaces, never folds (L393977) — and remove() drops it", () => {
    const clock = fakeClock();
    const store = createNotificationStore(clock.deps);
    const fold = (prev: CcxNotification, next: CcxNotification): CcxNotification => ({ ...next, text: `${prev.text}+${next.text}` });
    store.add({ key: "p1", text: "one", pinned: true });
    store.add({ key: "p2", text: "two", pinned: true });
    store.add({ key: "p1", text: "ONE", pinned: true, fold });
    expect(store.state().pinned.map((p) => p.text)).toEqual(["one", "two"]);   // the second p1 never landed
    store.remove("p1");
    expect(store.state().pinned.map((p) => p.key)).toEqual(["p2"]);            // a pinned entry only ever leaves via remove
  });
});

describe("notification queue: subscribe", () => {
  it("fires synchronously after every state change, including timer-driven ones", () => {
    const clock = fakeClock();
    const store = createNotificationStore(clock.deps);
    const seen: (string | null)[] = [];
    const off = store.subscribe(() => { seen.push(key(store.state().current)); });
    store.add({ key: "a", timeoutMs: 1000 });                            // → current a
    store.add({ key: "b" });                                             // → queued (state changed)
    clock.advance(1000);                                                 // → a expires, b promoted
    expect(seen).toEqual(["a", "a", "b"]);
    off();
    store.add({ key: "c" });
    expect(seen).toEqual(["a", "a", "b"]);                               // unsubscribed
  });

  it("supports several subscribers and unsubscribing one", () => {
    const clock = fakeClock();
    const store = createNotificationStore(clock.deps);
    let one = 0, two = 0;
    const offOne = store.subscribe(() => { one++; });
    store.subscribe(() => { two++; });
    store.add({ key: "a" });
    offOne();
    store.add({ key: "b" });
    expect([one, two]).toEqual([1, 2]);
  });
});

describe("notification queue: real timers by default", () => {
  it("constructs without deps (the production call site passes none)", () => {
    const store = createNotificationStore();
    store.add({ key: "a", text: "hi", timeoutMs: 60_000 });
    expect(store.state().current?.text).toBe("hi");
    store.remove("a");                                                   // cancels the real timer; nothing left running
    expect(store.state().current).toBeNull();
  });
});
