# Phase 2 C — Proactive Heartbeat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a transport-agnostic `ProactiveLoop` (self-wakes a live session on a timer, backs off when idle, stops on bounds) plus a thin daemon binding (`start_proactive`/`stop_proactive` ops, auto-pause around human `submit`, lifecycle-safe teardown).

**Architecture:** Mirror `src/bridge/` exactly — a pure `src/proactive/` core that knows nothing about sessions or networks (unit-tested against a fake `runTurn` + a manual scheduler), consumed directly by `DaemonSupervisor`. The loop is the only stateful unit; the daemon is one binding. terminalFocus (31.5) is out of scope; `/goal` (31.7) is a future second policy.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Zod v4 (`zod/v4`), Vitest. Run from `CC-to-SDK/harness/`.

**Spec:** `docs/superpowers/specs/2026-06-17-phase2-c-proactive-heartbeat-design.md`

**Conventions (match the existing harness — do NOT reformat):**
- This harness has **no Prettier** config/script. Match the existing compact hand-style by hand. Never run `prettier`.
- Verify with `npm run typecheck` and `npm test` (vitest) from `harness/`. Unit only: `npm run test:unit`.
- Commit messages use the existing style: `feat(harness): …` / `test(harness): …`. **No `Co-Authored-By` / attribution lines.** Commit to the current branch; never push.
- Internal modules import siblings with explicit `.js` (e.g. `from "./types.js"`), matching `src/bridge/*`.

**Deviation from spec (deliberate, YAGNI):** spec §5 lists `now: () => number` in `ProactiveDeps`. The loop's bounding is count-based (`intervalMs * factor**n`), so it never reads a wall-clock — only `schedule` is a time seam. We omit `now` from `ProactiveDeps`. The spec's DI intent ("same discipline as the supervisor") is satisfied by `schedule`.

---

## File Structure

```
src/proactive/ (NEW)
  prompts.ts  DEFAULT_TICK_PROMPT, defaultIdleDetector, AUTONOMOUS_SECTION, applyProactivePersona (31.4)
  types.ts    ProactiveConfig/Status/Deps/State; proactiveConfig zod; DEFAULT_PROACTIVE_CONFIG; resolveProactiveConfig
  loop.ts     ProactiveLoop — the four-state machine (the only stateful unit)
  index.ts    re-exports (internal organization; not added to src/index.ts, matching bridge)

src/daemon/ (EXTEND)
  types.ts      daemonOp += startProactiveOp / stopProactiveOp (import proactiveConfig)
  server.ts     route "start_proactive" / "stop_proactive"
  supervisor.ts proactive map; startProactive / stopProactive / proactiveStatus / runProactiveTurn;
                submit() pause/resume wrap; stop loops in stop()/shutdown(); reapIdle() skip

test/ (NEW/EXTEND)
  test/unit/proactive-prompts.test.ts   (Task 1)
  test/unit/proactive-loop.test.ts      (Task 2)
  test/unit/daemon-supervisor.test.ts   (Task 3 — extend existing)
  test/live/daemon.test.ts              (Task 4 — extend existing)
```

Dependency direction: `daemon → proactive`. The core imports nothing from `daemon/` (same as bridge).

---

## Task 1: Proactive prompts & config

**Files:**
- Create: `src/proactive/prompts.ts`
- Create: `src/proactive/types.ts`
- Test: `test/unit/proactive-prompts.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/unit/proactive-prompts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { DEFAULT_TICK_PROMPT, defaultIdleDetector, AUTONOMOUS_SECTION, applyProactivePersona } from "../../src/proactive/prompts.js";
import { resolveProactiveConfig, proactiveConfig } from "../../src/proactive/types.js";
import { DEFAULT_PROACTIVE_CONFIG } from "../../src/proactive/types.js";

describe("proactive prompts & config", () => {
  it("defaultIdleDetector matches an exact IDLE result, case/space-insensitive; non-string → false", () => {
    expect(defaultIdleDetector("IDLE")).toBe(true);
    expect(defaultIdleDetector("  idle \n")).toBe(true);
    expect(defaultIdleDetector("I did some work")).toBe(false);
    expect(defaultIdleDetector(undefined)).toBe(false);
    expect(defaultIdleDetector(42)).toBe(false);
  });
  it("DEFAULT_TICK_PROMPT instructs the IDLE sentinel", () => {
    expect(DEFAULT_TICK_PROMPT).toMatch(/IDLE/);
  });
  it("applyProactivePersona sets a preset append on bare options", () => {
    const o: Record<string, unknown> = {};
    applyProactivePersona(o);
    expect(o.systemPrompt).toEqual({ type: "preset", preset: "claude_code", append: AUTONOMOUS_SECTION });
  });
  it("applyProactivePersona concatenates onto an existing append", () => {
    const o: Record<string, unknown> = { systemPrompt: { type: "preset", preset: "claude_code", append: "X" } };
    applyProactivePersona(o);
    expect((o.systemPrompt as any).append).toBe("X\n\n" + AUTONOMOUS_SECTION);
  });
  it("resolveProactiveConfig fills defaults and merges a partial nested backoff", () => {
    const c = resolveProactiveConfig({ intervalMs: 5, idleBackoff: { stopAfterIdle: 1 } });
    expect(c.intervalMs).toBe(5);
    expect(c.tickPrompt).toBe(DEFAULT_TICK_PROMPT);
    expect(c.idleBackoff.stopAfterIdle).toBe(1);    // overridden
    expect(c.idleBackoff.factor).toBe(2);           // default preserved
    expect(c.errorBackoff.stopAfterErrors).toBe(5); // untouched default
    expect(c.maxTicks).toBeUndefined();
  });
  it("resolveProactiveConfig() with no input equals the defaults", () => {
    expect(resolveProactiveConfig()).toEqual(DEFAULT_PROACTIVE_CONFIG);
  });
  it("proactiveConfig zod accepts partial/empty configs and rejects a bad field type", () => {
    expect(proactiveConfig.safeParse({ intervalMs: 10 }).success).toBe(true);
    expect(proactiveConfig.safeParse({}).success).toBe(true);
    expect(proactiveConfig.safeParse({ idleBackoff: { stopAfterIdle: 1 } }).success).toBe(true);
    expect(proactiveConfig.safeParse({ intervalMs: "ten" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd harness && npx vitest run test/unit/proactive-prompts.test.ts`
Expected: FAIL — cannot resolve `../../src/proactive/prompts.js` / `types.js`.

- [ ] **Step 3: Implement `src/proactive/prompts.ts`**

```ts
/** The synthetic message injected on each heartbeat tick (config-overridable). */
export const DEFAULT_TICK_PROMPT =
  "<heartbeat> Autonomous tick — no human is waiting. If there's a concrete next step toward the current " +
  "goal, take it now. If there's nothing useful to do, reply with exactly IDLE and nothing else.";

/** True when a tick produced no work — the model replied with the bare IDLE sentinel. */
export function defaultIdleDetector(result: unknown): boolean {
  return typeof result === "string" && result.trim().toUpperCase() === "IDLE";
}

/** Standing autonomous-work instructions (parity 31.4). Applied as an opt-in systemPrompt append at spawn. */
export const AUTONOMOUS_SECTION = [
  "You may be driven by an autonomous heartbeat that wakes you between human turns.",
  "On a heartbeat tick, advance the current goal with the next concrete step if there is one.",
  "If there is genuinely nothing useful to do, reply with exactly IDLE so the heartbeat can back off.",
  "Do not ask the human questions on a tick; either act or report IDLE.",
].join(" ");

/** Mutate resolved SDK options to append the autonomous section (mirrors applyCoordinatorPersona). */
export function applyProactivePersona(options: Record<string, unknown>): void {
  const sp = options.systemPrompt as { type?: string; preset?: string; append?: string } | string | undefined;
  if (sp && typeof sp === "object") {
    options.systemPrompt = { ...sp, append: (sp.append ? sp.append + "\n\n" : "") + AUTONOMOUS_SECTION };
  } else {
    options.systemPrompt = { type: "preset", preset: "claude_code", append: AUTONOMOUS_SECTION };
  }
}
```

- [ ] **Step 4: Implement `src/proactive/types.ts`**

```ts
import { z } from "zod/v4";
import { DEFAULT_TICK_PROMPT } from "./prompts.js";

export type ProactiveState = "idle" | "running" | "paused" | "stopped";

export interface ProactiveStatus {
  state: ProactiveState;
  tickCount: number;
  idleCount: number;
  errorCount: number;
  reason?: string;
}

/** Injected seams — the loop knows nothing about sessions or networks. */
export interface ProactiveDeps {
  runTurn: (prompt: string) => Promise<{ result: unknown }>; // daemon passes a session.submit wrapper
  schedule: (fn: () => void, ms: number) => () => void;      // returns a cancel (mirrors scheduleRestart)
  idleDetector: (result: unknown) => boolean;                // "did this tick do nothing?"
  interrupt?: () => Promise<void>;                           // bridge.interrupt — pause an in-flight tick
}

export interface ProactiveConfig {
  tickPrompt: string;
  intervalMs: number;
  maxTicks?: number;                                          // undefined → rely on idle/error stop
  idleBackoff: { factor: number; maxIntervalMs: number; stopAfterIdle: number };
  errorBackoff: { factor: number; maxIntervalMs: number; stopAfterErrors: number };
}

const backoffInput = z.object({ factor: z.number().optional(), maxIntervalMs: z.number().optional() });
export const proactiveConfig = z.object({
  tickPrompt: z.string().optional(),
  intervalMs: z.number().optional(),
  maxTicks: z.number().optional(),
  idleBackoff: backoffInput.extend({ stopAfterIdle: z.number().optional() }).optional(),
  errorBackoff: backoffInput.extend({ stopAfterErrors: z.number().optional() }).optional(),
});
export type ProactiveConfigInput = z.infer<typeof proactiveConfig>;

export const DEFAULT_PROACTIVE_CONFIG: ProactiveConfig = {
  tickPrompt: DEFAULT_TICK_PROMPT,
  intervalMs: 60_000,
  idleBackoff: { factor: 2, maxIntervalMs: 900_000, stopAfterIdle: 3 },
  errorBackoff: { factor: 2, maxIntervalMs: 300_000, stopAfterErrors: 5 },
};

/** Fill defaults over a partial input; nested backoff objects merge field-by-field. */
export function resolveProactiveConfig(input?: ProactiveConfigInput): ProactiveConfig {
  return {
    tickPrompt: input?.tickPrompt ?? DEFAULT_PROACTIVE_CONFIG.tickPrompt,
    intervalMs: input?.intervalMs ?? DEFAULT_PROACTIVE_CONFIG.intervalMs,
    maxTicks: input?.maxTicks ?? DEFAULT_PROACTIVE_CONFIG.maxTicks,
    idleBackoff: { ...DEFAULT_PROACTIVE_CONFIG.idleBackoff, ...(input?.idleBackoff ?? {}) },
    errorBackoff: { ...DEFAULT_PROACTIVE_CONFIG.errorBackoff, ...(input?.errorBackoff ?? {}) },
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd harness && npx vitest run test/unit/proactive-prompts.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Typecheck**

Run: `cd harness && npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add harness/src/proactive/prompts.ts harness/src/proactive/types.ts harness/test/unit/proactive-prompts.test.ts
git commit -m "feat(harness): proactive prompts + config (phase2-c)"
```

---

## Task 2: `ProactiveLoop` core (state machine, ticking, backoff, teardown)

**Files:**
- Create: `src/proactive/loop.ts`
- Create: `src/proactive/index.ts`
- Test: `test/unit/proactive-loop.test.ts`

This task builds the whole loop test-first. The four **teardown-liveness** tests are written in the same step as the behavioral tests and are non-negotiable (the recurring bug class for this codebase: parked promises that hang/leak on teardown).

- [ ] **Step 1: Write the failing tests**

Create `test/unit/proactive-loop.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ProactiveLoop } from "../../src/proactive/loop.js";
import { resolveProactiveConfig } from "../../src/proactive/types.js";
import type { ProactiveConfigInput, ProactiveDeps } from "../../src/proactive/types.js";

// A manual scheduler: records scheduled callbacks; the test fires them explicitly (no real timers).
function manualScheduler() {
  const entries: { fn: () => void; ms: number; live: boolean }[] = [];
  const schedule = (fn: () => void, ms: number) => {
    const e = { fn, ms, live: true };
    entries.push(e);
    return () => { e.live = false; };
  };
  // Fire the latest still-live scheduled tick, then let runTurn microtasks drain.
  const fire = async () => {
    const e = [...entries].reverse().find((x) => x.live);
    if (!e) throw new Error("nothing scheduled to fire");
    e.live = false;
    e.fn();
    await new Promise((r) => setTimeout(r, 0));
  };
  const lastDelay = () => entries.at(-1)?.ms;
  return { schedule, fire, lastDelay, entries };
}

function harness(
  cfg: ProactiveConfigInput,
  opts: {
    results?: unknown[];
    idle?: (r: unknown) => boolean;
    runTurn?: (p: string) => Promise<{ result: unknown }>;
    interrupt?: () => Promise<void>;
  } = {},
) {
  const ticks: string[] = [];
  const sched = manualScheduler();
  let i = 0;
  const runTurn = opts.runTurn ?? (async (p: string) => { ticks.push(p); return { result: opts.results ? opts.results[i++] : "ok" }; });
  const interruptCalls: number[] = [];
  const deps: ProactiveDeps = {
    runTurn,
    schedule: sched.schedule,
    idleDetector: opts.idle ?? (() => false),
    interrupt: opts.interrupt ?? (async () => { interruptCalls.push(1); }),
  };
  const loop = new ProactiveLoop(resolveProactiveConfig(cfg), deps);
  return { loop, ticks, sched, interruptCalls };
}

describe("ProactiveLoop — ticking & bounds", () => {
  it("start() schedules the first tick; firing injects the tickPrompt and reschedules at base interval", async () => {
    const h = harness({ tickPrompt: "T", intervalMs: 1000 });
    expect(h.loop.status().state).toBe("idle");
    h.loop.start();
    expect(h.loop.status().state).toBe("running");
    expect(h.sched.lastDelay()).toBe(1000);
    await h.sched.fire();
    expect(h.ticks).toEqual(["T"]);
    expect(h.loop.status().tickCount).toBe(1);
    expect(h.sched.lastDelay()).toBe(1000); // non-idle → base cadence
  });

  it("stops with reason 'maxTicks' exactly after N productive ticks", async () => {
    const h = harness({ intervalMs: 1000, maxTicks: 2 });
    h.loop.start();
    await h.sched.fire();                 // tick 1
    await h.sched.fire();                 // tick 2 → maxTicks reached
    expect(h.loop.status()).toMatchObject({ state: "stopped", reason: "maxTicks", tickCount: 2 });
    await expect(h.loop.done).resolves.toBeUndefined();
  });

  it("start() is idempotent (no-op when not idle)", async () => {
    const h = harness({ intervalMs: 1000 });
    h.loop.start();
    const n = h.sched.entries.length;
    h.loop.start();                       // already running
    expect(h.sched.entries.length).toBe(n);
  });
});

describe("ProactiveLoop — idle backoff", () => {
  it("consecutive idle ticks grow the interval by factor**idleCount and stop after stopAfterIdle", async () => {
    const h = harness(
      { intervalMs: 100, idleBackoff: { factor: 2, maxIntervalMs: 10_000, stopAfterIdle: 3 } },
      { idle: () => true },
    );
    h.loop.start();
    await h.sched.fire();                 // idle 1 → delay 100*2^1 = 200
    expect(h.loop.status().idleCount).toBe(1);
    expect(h.sched.lastDelay()).toBe(200);
    await h.sched.fire();                 // idle 2 → delay 100*2^2 = 400
    expect(h.sched.lastDelay()).toBe(400);
    await h.sched.fire();                 // idle 3 → stop
    expect(h.loop.status()).toMatchObject({ state: "stopped", reason: "idle", idleCount: 3 });
  });

  it("a non-idle tick resets idleCount and the interval", async () => {
    const h = harness(
      { intervalMs: 100, idleBackoff: { factor: 2, maxIntervalMs: 10_000, stopAfterIdle: 5 } },
      { results: ["IDLE", "did work"], idle: (r) => r === "IDLE" },
    );
    h.loop.start();
    await h.sched.fire();                 // idle → idleCount 1, delay 200
    expect(h.sched.lastDelay()).toBe(200);
    await h.sched.fire();                 // non-idle → reset
    expect(h.loop.status().idleCount).toBe(0);
    expect(h.sched.lastDelay()).toBe(100);
  });
});

describe("ProactiveLoop — error backoff", () => {
  it("a rejecting runTurn grows errorCount, backs off, and stops after stopAfterErrors", async () => {
    const h = harness(
      { intervalMs: 100, errorBackoff: { factor: 2, maxIntervalMs: 10_000, stopAfterErrors: 2 } },
      { runTurn: async () => { throw new Error("dead session"); } },
    );
    h.loop.start();
    await h.sched.fire();                 // error 1 → delay 100*2^1 = 200
    expect(h.loop.status().errorCount).toBe(1);
    expect(h.sched.lastDelay()).toBe(200);
    await h.sched.fire();                 // error 2 → stop
    expect(h.loop.status()).toMatchObject({ state: "stopped", reason: "error", errorCount: 2 });
  });
});

describe("ProactiveLoop — pause / resume", () => {
  it("pause() cancels the pending tick; resume() reschedules at base cadence", async () => {
    const h = harness({ intervalMs: 1000 });
    h.loop.start();
    await h.loop.pause();
    expect(h.loop.status().state).toBe("paused");
    await expect(h.sched.fire()).rejects.toThrow(/nothing scheduled/); // pending was cancelled
    h.loop.resume();
    expect(h.loop.status().state).toBe("running");
    await h.sched.fire();
    expect(h.loop.status().tickCount).toBe(1);
  });

  it("pause() interrupts an in-flight tick", async () => {
    let release!: (v: { result: unknown }) => void;
    const gate = new Promise<{ result: unknown }>((r) => { release = r; });
    const h = harness({ intervalMs: 1000 }, { runTurn: () => gate });
    h.loop.start();
    await h.sched.fire();                 // tick is now awaiting the gate (in flight)
    const pauseP = h.loop.pause();
    expect(h.interruptCalls.length).toBe(1); // interrupt fired for the in-flight tick
    release({ result: "ok" });
    await pauseP;
    expect(h.loop.status().state).toBe("paused");
  });
});

describe("ProactiveLoop — teardown liveness (the four)", () => {
  it("stop() while idle resolves done and prevents further ticks", async () => {
    const h = harness({ intervalMs: 1000 });
    h.loop.start();
    await h.loop.stop("manual");
    expect(h.loop.status()).toMatchObject({ state: "stopped", reason: "manual" });
    await expect(h.loop.done).resolves.toBeUndefined();
    await expect(h.sched.fire()).rejects.toThrow(/nothing scheduled/); // pending cancelled, none rescheduled
  });

  it("stop() while a tick is in flight drains cleanly and never reschedules", async () => {
    let release!: (v: { result: unknown }) => void;
    const gate = new Promise<{ result: unknown }>((r) => { release = r; });
    const h = harness({ intervalMs: 1000 }, { runTurn: () => gate });
    h.loop.start();
    await h.sched.fire();                 // tick in flight, awaiting gate
    const stopP = h.loop.stop("manual");
    release({ result: "ok" });            // let the in-flight runTurn settle
    await stopP;
    await expect(h.loop.done).resolves.toBeUndefined();
    const n = h.sched.entries.filter((e) => e.live).length;
    expect(n).toBe(0);                    // no live scheduled tick survived teardown
  });

  it("stop() is idempotent and keeps the first reason", async () => {
    const h = harness({ intervalMs: 1000 });
    h.loop.start();
    await h.loop.stop("first");
    await h.loop.stop("second");
    expect(h.loop.status().reason).toBe("first");
    await expect(h.loop.done).resolves.toBeUndefined();
  });

  it("pause() then stop() settles without a hang", async () => {
    const h = harness({ intervalMs: 1000 });
    h.loop.start();
    await h.loop.pause();
    await h.loop.stop("manual");
    expect(h.loop.status().state).toBe("stopped");
    await expect(h.loop.done).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd harness && npx vitest run test/unit/proactive-loop.test.ts`
Expected: FAIL — cannot resolve `../../src/proactive/loop.js`.

- [ ] **Step 3: Implement `src/proactive/loop.ts`**

```ts
import type { ProactiveConfig, ProactiveDeps, ProactiveState, ProactiveStatus } from "./types.js";

/** A pacing/gating loop over a live session: self-wakes via `schedule`, injects `tickPrompt` through
 *  `runTurn`, backs off on idle/error, and stops on a bound. Never throws out of a tick. */
export class ProactiveLoop {
  private state: ProactiveState = "idle";
  private tickCount = 0;
  private idleCount = 0;
  private errorCount = 0;
  private reason?: string;
  private pending?: () => void;          // cancel the scheduled next tick
  private inFlight?: Promise<{ result: unknown }>; // the awaiting runTurn (for clean teardown)
  private resolveDone!: () => void;
  readonly done: Promise<void>;

  constructor(private cfg: ProactiveConfig, private deps: ProactiveDeps) {
    this.done = new Promise((r) => { this.resolveDone = r; });
  }

  status(): ProactiveStatus {
    return { state: this.state, tickCount: this.tickCount, idleCount: this.idleCount, errorCount: this.errorCount, reason: this.reason };
  }

  start(): void {
    if (this.state !== "idle") return;
    this.state = "running";
    this.scheduleNext(this.cfg.intervalMs);
  }

  async pause(): Promise<void> {
    if (this.state !== "running") return;
    this.state = "paused";
    this.cancelPending();
    if (this.inFlight) await this.deps.interrupt?.();
  }

  resume(): void {
    if (this.state !== "paused") return;
    this.state = "running";
    this.scheduleNext(this.cfg.intervalMs);
  }

  /** External terminal stop. Drains any in-flight tick before resolving `done`. Idempotent. */
  async stop(reason: string): Promise<void> {
    if (this.state === "stopped") { await this.done; return; }
    this.state = "stopped";
    this.reason = reason;
    this.cancelPending();
    const flight = this.inFlight;
    if (flight) { try { await flight; } catch { /* the runTurn outcome is irrelevant once stopped */ } }
    this.resolveDone();
  }

  private scheduleNext(delay: number): void {
    this.pending = this.deps.schedule(() => { void this.tick(); }, delay);
  }
  private cancelPending(): void { this.pending?.(); this.pending = undefined; }

  /** Internal terminal stop, called from inside a tick when a bound is hit. Synchronous (no self-await). */
  private finish(reason: string): void {
    if (this.state === "stopped") return;
    this.state = "stopped";
    this.reason = reason;
    this.cancelPending();
    this.resolveDone();
  }

  private async tick(): Promise<void> {
    this.pending = undefined;
    if (this.state !== "running") return;
    let delay = this.cfg.intervalMs;
    this.inFlight = this.deps.runTurn(this.cfg.tickPrompt);
    try {
      const { result } = await this.inFlight;
      this.tickCount++;
      if (this.deps.idleDetector(result)) {
        this.idleCount++; this.errorCount = 0;
        if (this.idleCount >= this.cfg.idleBackoff.stopAfterIdle) return this.finish("idle");
        delay = Math.min(this.cfg.intervalMs * this.cfg.idleBackoff.factor ** this.idleCount, this.cfg.idleBackoff.maxIntervalMs);
      } else {
        this.idleCount = 0; this.errorCount = 0;
      }
      if (this.cfg.maxTicks != null && this.tickCount >= this.cfg.maxTicks) return this.finish("maxTicks");
    } catch {
      this.errorCount++;
      if (this.errorCount >= this.cfg.errorBackoff.stopAfterErrors) return this.finish("error");
      delay = Math.min(this.cfg.intervalMs * this.cfg.errorBackoff.factor ** this.errorCount, this.cfg.errorBackoff.maxIntervalMs);
    } finally {
      this.inFlight = undefined;
    }
    if (this.state === "running") this.scheduleNext(delay);
  }
}
```

> **Why this is teardown-safe.** `stop()` flips `state` synchronously, so any in-flight tick that resumes after its `await` hits `if (this.state === "running")` and refuses to reschedule — no leaked timer, no hang. `stop()` awaits the captured `inFlight` so `done` only resolves once the real `runTurn` has settled (the same drain shape as `DaemonSession.dispose()` awaiting `this.done`). `finish()` is synchronous precisely because it runs *inside* a tick — awaiting `inFlight` there would await the tick's own settled `runTurn` needlessly.

- [ ] **Step 4: Implement `src/proactive/index.ts`**

```ts
export { ProactiveLoop } from "./loop.js";
export { DEFAULT_TICK_PROMPT, defaultIdleDetector, AUTONOMOUS_SECTION, applyProactivePersona } from "./prompts.js";
export { proactiveConfig, resolveProactiveConfig, DEFAULT_PROACTIVE_CONFIG } from "./types.js";
export type { ProactiveConfig, ProactiveConfigInput, ProactiveDeps, ProactiveStatus, ProactiveState } from "./types.js";
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd harness && npx vitest run test/unit/proactive-loop.test.ts`
Expected: PASS (all describe blocks; 12 tests).

- [ ] **Step 6: Typecheck**

Run: `cd harness && npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add harness/src/proactive/loop.ts harness/src/proactive/index.ts harness/test/unit/proactive-loop.test.ts
git commit -m "feat(harness): ProactiveLoop core — ticking, backoff, teardown (phase2-c)"
```

---

## Task 3: Daemon binding (ops + supervisor + server)

**Files:**
- Modify: `src/daemon/types.ts` (add two ops to the `daemonOp` union)
- Modify: `src/daemon/supervisor.ts` (proactive map, methods, submit wrap, lifecycle)
- Modify: `src/daemon/server.ts` (route the two ops)
- Test: `test/unit/daemon-supervisor.test.ts` (extend existing)

- [ ] **Step 1: Write the failing tests**

Append to `test/unit/daemon-supervisor.test.ts`, inside the top-level `describe("DaemonSupervisor", …)` block, after the Phase 2 B control tests (before the closing `});` at line 276). These reuse the existing `dir`, `healthyQuery`, `dyingQuery`, and `flush` helpers already defined in the file.

```ts
  // ---- Phase 2 C: proactive heartbeat ----
  // A scheduler the test controls: capture pending tick callbacks, fire them on demand.
  function captureSched() {
    const pend: (() => void)[] = [];
    const scheduleRestart = (fn: () => void) => { pend.push(fn); return () => {}; };
    const fire = async () => { const fn = pend.pop(); if (fn) { fn(); await flush(); } };
    return { scheduleRestart, fire };
  }

  it("startProactive: unknown id throws, double-start throws, returns running status", async () => {
    const s = captureSched();
    const sup = new DaemonSupervisor({ query: healthyQuery }, { dir: dir(), scheduleRestart: s.scheduleRestart });
    expect(() => sup.startProactive("ghost")).toThrow(/unknown session/);
    const id = sup.spawn();
    expect(sup.startProactive(id, { intervalMs: 1000 })).toMatchObject({ state: "running", tickCount: 0 });
    expect(() => sup.startProactive(id)).toThrow(/already proactive/);
    await sup.shutdown();
  });

  it("a fired heartbeat tick submits the tickPrompt into the session", async () => {
    const s = captureSched();
    const seen: string[] = [];
    const recordingQuery = ({ prompt }: any) => (async function* () {
      for await (const t of prompt) { seen.push(t.message.content); yield { type: "result", result: "ok" }; }
    })();
    const sup = new DaemonSupervisor({ query: recordingQuery }, { dir: dir(), scheduleRestart: s.scheduleRestart });
    const id = sup.spawn();
    sup.startProactive(id, { tickPrompt: "HB", intervalMs: 1000 });
    await s.fire();                                  // fire the first scheduled tick
    expect(seen).toContain("HB");
    expect(sup.proactiveStatus(id)!.tickCount).toBe(1);
    await sup.shutdown();
  });

  it("submit auto-pauses the heartbeat and resumes it after the human turn", async () => {
    const s = captureSched();
    const sup = new DaemonSupervisor({ query: healthyQuery }, { dir: dir(), scheduleRestart: s.scheduleRestart });
    const id = sup.spawn();
    sup.startProactive(id, { intervalMs: 1000 });
    expect((await sup.submit(id, "hi", () => {})).result).toBe("ok:hi");
    expect(sup.proactiveStatus(id)!.state).toBe("running"); // resumed, not stuck paused
    await sup.shutdown();
  });

  it("submit does NOT resume a heartbeat that already self-stopped (lingers in the map)", async () => {
    const s = captureSched();
    const idleQuery = ({ prompt }: any) => (async function* () {
      for await (const _t of prompt) yield { type: "result", result: "IDLE" };
    })();
    const sup = new DaemonSupervisor({ query: idleQuery }, { dir: dir(), scheduleRestart: s.scheduleRestart });
    const id = sup.spawn();
    sup.startProactive(id, { intervalMs: 1000, idleBackoff: { stopAfterIdle: 1 } });
    await s.fire();                                  // one idle tick → loop self-stops
    expect(sup.proactiveStatus(id)!.state).toBe("stopped");
    await sup.submit(id, "hi", () => {});            // must not throw / must not resume
    expect(sup.proactiveStatus(id)!.state).toBe("stopped");
    await sup.shutdown();
  });

  it("stop(id) tears the heartbeat down before disposing the session", async () => {
    const s = captureSched();
    const sup = new DaemonSupervisor({ query: healthyQuery }, { dir: dir(), scheduleRestart: s.scheduleRestart });
    const id = sup.spawn();
    sup.startProactive(id, { intervalMs: 1000 });
    await sup.stop(id);
    expect(sup.proactiveStatus(id)).toBeUndefined();
    expect(sup.list()).toEqual([]);
    await sup.shutdown();
  });

  it("stopProactive on a non-proactive session throws", async () => {
    const sup = new DaemonSupervisor({ query: healthyQuery }, { dir: dir() });
    const id = sup.spawn();
    await expect(sup.stopProactive(id)).rejects.toThrow(/not proactive/);
    await sup.shutdown();
  });

  it("reapIdle skips a session with an active heartbeat", async () => {
    let t = 1000;
    const s = captureSched();
    const sup = new DaemonSupervisor({ query: healthyQuery }, { dir: dir(), idleTimeoutMs: 500, now: () => t, scheduleRestart: s.scheduleRestart });
    const id = sup.spawn();
    sup.startProactive(id, { intervalMs: 1000 });
    t = 5000; await sup.reapIdle();                 // way past the timeout, but proactive → kept
    expect(sup.list().map((x) => x.id)).toEqual([id]);
    await sup.shutdown();
  });

  it("daemonOp accepts start_proactive (with/without config) and stop_proactive", () => {
    expect(daemonOp.safeParse({ op: "start_proactive", id: "s1" }).success).toBe(true);
    expect(daemonOp.safeParse({ op: "start_proactive", id: "s1", config: { intervalMs: 10 } }).success).toBe(true);
    expect(daemonOp.safeParse({ op: "start_proactive", id: "s1", config: { intervalMs: "x" } }).success).toBe(false);
    expect(daemonOp.safeParse({ op: "stop_proactive", id: "s1" }).success).toBe(true);
  });
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `cd harness && npx vitest run test/unit/daemon-supervisor.test.ts`
Expected: FAIL — `startProactive`/`stopProactive`/`proactiveStatus` are not methods; `daemonOp` rejects the new ops.

- [ ] **Step 3: Add the two ops to `src/daemon/types.ts`**

Add the import near the existing bridge import (after line 2):

```ts
import { proactiveConfig } from "../proactive/types.js";
```

Add the two op schemas after `controlOp` (line 40):

```ts
const startProactiveOp = z.object({ op: z.literal("start_proactive"), id: z.string(), config: proactiveConfig.optional() });
const stopProactiveOp = z.object({ op: z.literal("stop_proactive"), id: z.string() });
```

Replace the `daemonOp` union (line 42) to include them:

```ts
export const daemonOp = z.discriminatedUnion("op", [spawnOp, submitOp, listOp, stopOp, shutdownOp, controlOp, startProactiveOp, stopProactiveOp]);
```

- [ ] **Step 4: Extend `src/daemon/supervisor.ts`**

Add imports after the bridge imports (after line 10):

```ts
import { ProactiveLoop } from "../proactive/loop.js";
import { resolveProactiveConfig } from "../proactive/types.js";
import type { ProactiveConfigInput, ProactiveStatus } from "../proactive/types.js";
import { defaultIdleDetector } from "../proactive/prompts.js";
```

Add the map field next to `pool` (after line 19, `private pool = …`):

```ts
  private proactive = new Map<string, ProactiveLoop>(); // active heartbeats by session id (Phase 2 C)
```

Add the proactive methods immediately after the existing `control(...)` method (after line 104, before `async stop(`):

```ts
  startProactive(id: string, config?: ProactiveConfigInput): ProactiveStatus {
    const session = this.pool.get(id);
    if (!session || session.isEnded()) {
      const rec = this.registry.get(id);
      throw new DaemonError(rec ? `session ${id} is ${rec.status}` : `unknown session ${id}`);
    }
    if (this.proactive.has(id)) throw new DaemonError(`session ${id} already proactive`);
    const loop = new ProactiveLoop(resolveProactiveConfig(config), {
      runTurn: (p) => this.runProactiveTurn(id, p),
      schedule: this.scheduleRestart,                 // reuse the injected scheduler
      idleDetector: defaultIdleDetector,
      interrupt: () => session.interrupt(),           // bridge.interrupt pauses an in-flight tick
    });
    this.proactive.set(id, loop);
    loop.start();
    return loop.status();
  }

  async stopProactive(id: string): Promise<{ ok: true }> {
    const loop = this.proactive.get(id);
    if (!loop) throw new DaemonError(`session ${id} is not proactive`);
    await loop.stop("stopped");
    this.proactive.delete(id);
    return { ok: true };
  }

  proactiveStatus(id: string): ProactiveStatus | undefined { return this.proactive.get(id)?.status(); }

  private runProactiveTurn(id: string, prompt: string): Promise<{ result: unknown }> {
    const session = this.pool.get(id);
    if (!session || session.isEnded()) {
      const rec = this.registry.get(id);
      throw new DaemonError(rec ? `session ${id} is ${rec.status}` : `unknown session ${id}`);
    }
    return session.submit(prompt, () => {});          // tick output discarded; result drives idleDetector
  }
```

Modify `submit(...)` (lines 78–93) to pause/resume the heartbeat around the human turn. Replace the existing method body with:

```ts
  async submit(id: string, prompt: string, onMessage: (m: unknown) => void): Promise<{ result: unknown }> {
    const session = this.pool.get(id);
    if (!session) {
      const rec = this.registry.get(id);
      throw new DaemonError(rec ? `session ${id} is ${rec.status}` : `unknown session ${id}`);
    }
    const loop = this.proactive.get(id);
    if (loop) await loop.pause();                     // human turn preempts the heartbeat
    this.registry.update(id, { status: "busy" });
    try {
      const r = await session.submit(prompt, onMessage);
      this.registry.update(id, { status: "idle", lastActiveAt: session.lastActiveAt });
      return r;
    } catch (e) {
      this.registry.update(id, { status: "errored" });
      throw e;
    } finally {
      if (loop && loop.status().state !== "stopped") loop.resume();
    }
  }
```

Modify `stop(...)` (lines 106–116) to tear down the loop before disposing the session. Replace with:

```ts
  async stop(id: string): Promise<void> {
    const session = this.pool.get(id);
    if (!session && !this.registry.get(id)) throw new DaemonError(`unknown session ${id}`);
    const loop = this.proactive.get(id);
    if (loop) { await loop.stop("session stopped"); this.proactive.delete(id); }
    this.stopping.add(id);                       // flag BEFORE dispose so the end hook won't restart
    this.cancelRestart(id);
    if (session) await session.dispose();
    this.pool.delete(id);
    this.configs.delete(id);
    this.registry.remove(id);
    this.stopping.delete(id);
  }
```

Modify `shutdown(...)` (lines 118–126) to stop all loops before disposing sessions. Replace with:

```ts
  async shutdown(): Promise<void> {
    this.shuttingDown = true;                    // end hooks early-return from here on
    if (this.reaper) clearInterval(this.reaper);
    for (const cancel of this.restartCancels.values()) cancel();
    this.restartCancels.clear();
    await Promise.all([...this.proactive.values()].map((l) => l.stop("shutdown")));
    this.proactive.clear();
    await Promise.all([...this.pool].map(async ([id, s]) => { await s.dispose(); this.registry.remove(id); }));
    this.pool.clear();
    this.configs.clear();
  }
```

Modify `reapIdle(...)` (lines 129–133) to skip sessions with an active loop. Replace the `stale` filter line:

```ts
  async reapIdle(): Promise<void> {
    const cutoff = this.now() - this.idleTimeoutMs;
    const stale = [...this.pool].filter(([id, s]) => !this.proactive.has(id) && s.lastActiveAt < cutoff).map(([id]) => id);
    await Promise.all(stale.map((id) => this.stop(id)));
  }
```

- [ ] **Step 5: Route the ops in `src/daemon/server.ts`**

Add two cases inside the `switch (op.op)` (after the `case "control":` line 73):

```ts
        case "start_proactive": send({ ok: true, status: this.supervisor.startProactive(op.id, op.config) }); sock.end(); break;
        case "stop_proactive": send(await this.supervisor.stopProactive(op.id)); sock.end(); break;
```

(`startProactive` throwing a `DaemonError` is caught by the outer `try/catch` at line 86 → `{ ok:false, error }`, same as every other op.)

- [ ] **Step 6: Run the full unit suite to verify it passes**

Run: `cd harness && npm run test:unit`
Expected: PASS — all prior unit tests plus the 8 new supervisor tests.

- [ ] **Step 7: Typecheck**

Run: `cd harness && npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add harness/src/daemon/types.ts harness/src/daemon/supervisor.ts harness/src/daemon/server.ts harness/test/unit/daemon-supervisor.test.ts
git commit -m "feat(harness): daemon proactive op binding — start/stop, auto-pause, lifecycle (phase2-c)"
```

---

## Task 4: Live end-to-end test

**Files:**
- Test: `test/live/daemon.test.ts` (extend existing)

- [ ] **Step 1: Write the live test**

Append this `it(...)` inside the existing `live("live daemon (real SDK)", …)` block in `test/live/daemon.test.ts`, before the block's closing `});` (line 91). It reuses the file's existing imports (`query`, `mkdtempSync`, `tmpdir`, `join`, `DaemonSupervisor`, `DaemonServer`, `daemonRequest`).

The end-to-end claim worth proving live is **real self-wake**: that `start_proactive` actually drives the live Query to take a tick turn on its own, with no human in the loop. We make a tick observable by giving it a side effect in a shared task store (the same mechanism the `sharedTasks` live test above already trusts), then poll the store for evidence. Idle-backoff math, auto-pause ordering, and teardown races are covered deterministically by the unit tests; this test proves the integration is real.

```ts
  it("proactive heartbeat self-wakes a real session (a tick fires with no human turn)", async () => {
    const d = mkdtempSync(join(tmpdir(), "cc-daemon-proactive-"));
    const sock = join(d, "sock");
    const sup = new DaemonSupervisor({ query }, { dir: join(d, "sessions"), sharedTasks: { dir: join(d, "tasks") } });
    const server = new DaemonServer(sup, sock);
    await server.listen();
    const id = (await daemonRequest(sock, { op: "spawn" }))[0].id;

    // A tick with an OBSERVABLE side effect: create a task, then report IDLE. High stopAfterIdle so it keeps ticking.
    const started = (await daemonRequest(sock, {
      op: "start_proactive", id,
      config: {
        tickPrompt: "Use the TaskCreate tool to create a task with subject HEARTBEAT_TICK. Then reply with exactly IDLE.",
        intervalMs: 1500,
        idleBackoff: { stopAfterIdle: 100 },
      },
    }))[0];
    expect(started.ok).toBe(true);
    expect(started.status.state).toBe("running");

    // No human submits at all — if a tick fires, the shared store gains a HEARTBEAT_TICK task.
    const sawTick = await new Promise<boolean>((resolve) => {
      const t0 = Date.now();
      const poll = async () => {
        const items = await sup.tasks!.list();
        if (items.some((t) => /HEARTBEAT_TICK/i.test(t.subject))) return resolve(true);
        if (Date.now() - t0 > 60_000) return resolve(false);
        setTimeout(poll, 2000);
      };
      void poll();
    });
    expect(sawTick).toBe(true); // a real heartbeat tick ran with no human in the loop

    // Clean teardown of the control plane.
    expect((await daemonRequest(sock, { op: "stop_proactive", id }))[0].ok).toBe(true);
    await daemonRequest(sock, { op: "shutdown" });
    await server.closed;
  }, 120_000);
```

> **Why a side effect, not a remote state read.** There is no op to read a loop's `state` remotely, and `stop_proactive` resolves `{ ok:true }` whether the loop is still running or has self-stopped (idempotent `loop.stop`) — so neither can witness "a tick fired." A task landing in the shared store is unambiguous proof that the loop drove a real turn with no human submit. The generous 60s window spans ~20 ticks at 1.5s cadence, so a single compliant tick passes the test.

- [ ] **Step 2: Run the live test (requires `ANTHROPIC_API_KEY`)**

Run: `cd harness && node --env-file=../.env node_modules/.bin/vitest run test/live/daemon.test.ts`
Expected: PASS (all live daemon tests, including the new proactive one). The proactive test should: report `running`, get a `PONG` through a human submit while the heartbeat is active, and converge to a stopped heartbeat within the timeout.

If `ANTHROPIC_API_KEY` is unset, the `live(...)` block is skipped — that is expected, not a failure. Do not block the task on a missing key; note it and proceed.

- [ ] **Step 3: Commit**

```bash
git add harness/test/live/daemon.test.ts
git commit -m "test(harness): live proactive heartbeat control-plane (phase2-c)"
```

---

## Final verification (after all tasks)

- [ ] `cd harness && npm run typecheck` — clean.
- [ ] `cd harness && npm run test:unit` — all unit tests green (prompts + loop + extended supervisor).
- [ ] `cd harness && node --env-file=../.env node_modules/.bin/vitest run test/live/daemon.test.ts` — live green (or cleanly skipped if no key).
- [ ] `git log --oneline -4` shows the four task commits; `git status` clean; no `.env`/secret staged.
- [ ] Dispatch the two-stage review (spec compliance, then code quality) per subagent-driven-development; for both, prefer a codex subagent via `/codex:rescue --model gpt-5.5 --effort high`, falling back to Claude if codex is unavailable.

---

## Self-Review (plan ↔ spec)

**Spec coverage:**
- §3 module layout → Tasks 1–3 create exactly `src/proactive/{prompts,types,loop,index}.ts` + the three daemon edits. ✓
- §5 loop core (state machine, tick algorithm, control surface, `done`-drain) → Task 2 (with the four teardown tests). ✓ (`now` seam intentionally omitted — see Deviation note.)
- §6 daemon binding (start/stop, `runProactiveTurn`, submit pause/resume, lifecycle-safe `stop`/`shutdown`, `reapIdle` skip) → Task 3. ✓
- §7 defaults + 31.4 `applyProactivePersona` + `defaultIdleDetector` + `maxTicks`-not-budget → Tasks 1 (prompts/config) & 2 (maxTicks bound). ✓
- §8 error handling (zod boundary, missing/dead session `DaemonError`, double-start, tick error-backoff, teardown race) → Task 3 tests + Task 2 error/teardown tests. ✓
- §9 verification (unit loop, unit daemon, one live) → Tasks 2, 3, 4. ✓
- §10 success criteria (self-wake, self-quiet, auto-pause, clean teardown, transport-agnostic core, 31.4 opt-in, 31.5 deferred, prior behavior unchanged) → covered across tasks; "prior behavior unchanged when no op sent" holds because all new wiring is gated on `this.proactive.has(id)`. ✓

**Type consistency:** `ProactiveConfig`/`ProactiveDeps`/`ProactiveStatus`/`ProactiveState`, `resolveProactiveConfig`, `proactiveConfig`, `defaultIdleDetector`, `applyProactivePersona`, `startProactive(id, config?)→ProactiveStatus`, `stopProactive(id)→{ok:true}`, `proactiveStatus(id)`, `runProactiveTurn(id, prompt)`, and the op names `start_proactive`/`stop_proactive` are used identically across Tasks 1–4. ✓

**Placeholder scan:** every code/test step contains complete code; no TBD/"handle errors"/"similar to". ✓
