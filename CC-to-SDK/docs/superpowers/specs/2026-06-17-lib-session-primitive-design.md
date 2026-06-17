# Lib-Level Interactive Session Primitive — Design

**Date:** 2026-06-17
**Status:** Approved (brainstorm complete; ready for implementation plan)
**Session cluster:** sub-project **1 of 3** — the keystone. Specs 2 (`daemon-durable-sessions`) and 3
(`session-forking`) both depend on the `Session.sessionId` capture introduced here.
**Parity:** domain 5 (persistence) + domain 6 (context lifecycle) — see `docs/parity/coverage.md`
**Working dir:** `CC-to-SDK/harness/`
**Unblocks:** the architectural restriction recorded in memory `harden-and-ship-over-phase3` — "multi-turn /
on-demand capabilities are daemon-only, because `DaemonSession` is the harness's only multi-turn surface." This
spec dissolves that by promoting `DaemonSession`'s streaming core into a public, daemon-independent primitive.

## §1 Goal & context

The harness has two session shapes today:

- **One-shot** (`createHarness().run(prompt)`): a single `query()` over a string prompt. Captures `session_id`
  from the `system/init` frame (`harness.ts:86`), supports `resume` via `resumeHarness`. No multi-turn, no
  on-demand compaction, no live control surface after the turn ends.
- **Daemon** (`DaemonSession`): the real multi-turn engine — an `AsyncQueue` streaming input + a `readLoop` with
  FIFO waiters, `submit()`/`compact()`, the `ControllableSession` control surface, `getContextUsage`. But it is
  reachable **only through the UDS daemon** (`DaemonSupervisor` + `DaemonServer`), and it does **not** capture the
  SDK `session_id` (its `id` is a daemon-local `sess-N` handle).

The goal is a **third shape**: a public, library-usable, daemon-independent **`Session`** primitive — `open → submit
turns → compact/control/introspect → resume → dispose` — that a program embedding the harness can hold directly,
without spinning up the UDS daemon. Because `DaemonSession` already contains exactly this engine and has zero UDS
coupling, the work is **promotion, not rewrite**: lift the engine into a base `Session` class, add SDK `session_id`
capture, and make `DaemonSession extends Session`.

This universalizes three capabilities that are daemon-only today — on-demand `compact()`, the `cc-context`
introspection tool, and the live control surface — because they all already ride this engine.

## §2 Verification evidence (probed live 2026-06-17, model `claude-haiku-4-5-20251001`)

Probe `probe-lib-session.mjs` drove a real streaming-input `query()` (the exact `AsyncQueue`-fed mechanism
`DaemonSession` uses). Every load-bearing premise is verified — no reliance on the Feb snapshot:

- **`session_id` surfaces in streaming-input mode (G1):** the `system/init` frame carries `session_id`
  (`2278e344-…`) even when `prompt` is an async iterable — not just in string-prompt mode. So a live `Session` can
  expose `.sessionId` mid-life.
- **`init` fires per turn but the id is stable (G1b):** a 2-turn session emitted **2** `init` frames carrying **1
  distinct** `session_id`. ⇒ **capture-once** is correct and robust (re-reading every init would still yield the
  same value, but capture-once is the clean contract).
- **FIFO + in-session continuity:** 2 turns → 2 `type:"result"` frames, in order; turn 2 recalled turn 1's
  codeword. The waiter-FIFO model holds in streaming mode (already relied on by the daemon; reconfirmed).
- **Resume into a NEW streaming session works (G2):** a second streaming `query({options:{resume: capturedId}})`
  recalled the codeword across the session boundary — resume is not limited to one-shot string prompts.
- **Resume PRESERVES the id (G2b):** the resumed session reported the **identical** `session_id`. ⇒ `.sessionId` is
  a durable handle across `open → close → resume`. (Contrast: `forkSession` mints a *new* id — that is Spec 3's
  branch op, deliberately distinct from resume.)
- **Resume is fully multi-turn (G2 continue):** a second turn after resuming still streamed a result — a resumed
  `Session` is a normal live session, not a one-shot replay.

**Message shape relied on** (`sdk.d.ts`): `SDKSystemMessage` init = `{ type:"system", subtype:"init",
session_id: string, … }`.

## §3 Scope

**In:**
- `src/session/session.ts` — a public `Session` base class extracted from `DaemonSession`'s engine, **plus**
  `session_id` capture from `init` and a `.sessionId` getter.
- `src/session/index.ts` — `openSession(config?, deps?)` and `resumeSession(id, config?, deps?)` factories that run
  the harness config pipeline (`resolveOptions`) so a `Session` honours the same `HarnessConfig` as `createHarness`.
- `src/daemon/session.ts` — refactor `DaemonSession` to `extends Session` (keeps only its `sess-N` handle id and
  the supervisor's restart `done` hook); no behavior change for the daemon.
- `src/index.ts` — curated public exports (`openSession`, `resumeSession`, `Session`, types).

**Out (§8):** daemon registry/persistence rework (Spec 2); `forkSession` (Spec 3); surviving a daemon process
restart (Spec 2 non-goal too); any change to one-shot `createHarness`/`resumeHarness` (unchanged); a new
persistence substrate (`persistSession`/`sessionStore`/`enableFileCheckpointing`/`resume` are already plumbed
through `resolveOptions` and flow into a `Session` unchanged); concurrent multi-query orchestration inside one
`Session` (a `Session` drives exactly one `query`; turns are FIFO-serialized).

## §4 Design

### 4.1 `Session` base class — `src/session/session.ts` (NEW)

The engine is lifted verbatim from `DaemonSession` (its `AsyncQueue` input, `q`, `done`, `waiters`, `ended`,
`compactRequested`, `enqueueTurn`/`submit`/`compact`/`requestCompaction`, the control delegations, and the
`readLoop`). Two changes versus today's `DaemonSession`:

1. **No required `id` param.** The base takes `(deps, options, sessionOpts?)`. Error messages use a `label`
   (`sessionOpts.label ?? "session"`) instead of `this.id`. The `contextTool`/`compactTool`/`now` wiring moves into
   `sessionOpts`.
2. **`session_id` capture-once.** A private `_sessionId?: string`, set the first time `readLoop` sees a
   `system/init` frame; exposed read-only via `get sessionId()`.

```ts
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { AsyncQueue } from "../swarm/asyncQueue.js";
import type { QueryFn } from "../swarm/types.js";
import type { ControllableSession } from "../bridge/types.js";
import { withContextTool, type QueryHolder, type RawContextUsage } from "../context/server.js";
import { withCompactTool, parseCompactOutcome, type CompactHolder, type CompactOutcome } from "../compaction/server.js";

export interface SessionDeps { query: QueryFn; }
export interface SessionOpts { contextTool?: boolean; compactTool?: boolean; label?: string; now?: () => number; }

interface Waiter { onMessage: (m: unknown) => void; resolve: (r: { result: unknown }) => void; reject: (e: Error) => void; }
function userTurn(text: string): SDKUserMessage {
  return { type: "user", message: { role: "user", content: text }, parent_tool_use_id: null } as SDKUserMessage;
}

/** One long-lived query() session. A turn is submit(prompt,onMessage) → streamed messages → resolved result. */
export class Session implements ControllableSession {
  lastActiveAt: number;
  readonly done: Promise<void>;             // resolves when the read-loop ends (query disposed or died)
  protected input = new AsyncQueue<SDKUserMessage>();
  protected q: AsyncIterable<unknown>;
  protected waiters: Waiter[] = [];         // FIFO: one result per submitted turn, in order
  protected ended = false;
  protected compactRequested = false;
  protected now: () => number;
  protected label: string;
  private _sessionId?: string;              // captured from the first system/init (stable per probe G1b)

  constructor(deps: SessionDeps, options: Record<string, unknown>, sessionOpts: SessionOpts = {}) {
    this.now = sessionOpts.now ?? Date.now;
    this.label = sessionOpts.label ?? "session";
    this.lastActiveAt = this.now();
    let opts = options;
    let ctxHolder: QueryHolder | undefined; let compactHolder: CompactHolder | undefined;
    if (sessionOpts.contextTool) { ctxHolder = {}; opts = withContextTool(opts, ctxHolder); }
    if (sessionOpts.compactTool) { compactHolder = {}; opts = withCompactTool(opts, compactHolder); }
    this.q = deps.query({ prompt: this.input, options: opts });
    if (ctxHolder) ctxHolder.query = this.q as unknown as { getContextUsage(): Promise<RawContextUsage> };
    if (compactHolder) compactHolder.request = () => this.requestCompaction();
    this.done = this.readLoop().catch(() => {});
  }

  get sessionId(): string | undefined { return this._sessionId; }
  isEnded(): boolean { return this.ended; }

  private enqueueTurn(prompt: string, onMessage: (m: unknown) => void): Promise<{ result: unknown }> {
    return new Promise((resolve, reject) => { this.waiters.push({ onMessage, resolve, reject }); this.input.push(userTurn(prompt)); });
  }
  submit(prompt: string, onMessage: (m: unknown) => void = () => {}): Promise<{ result: unknown }> {
    if (this.ended) return Promise.reject(new Error(`${this.label} is not running`));
    return this.enqueueTurn(prompt, onMessage);
  }
  async compact(): Promise<CompactOutcome> {
    this.assertRunning();
    const frames: unknown[] = [];
    await this.enqueueTurn("/compact", (m) => {
      const mm = m as any;
      if (mm.type === "system" && (mm.subtype === "status" || mm.subtype === "compact_boundary")) frames.push(mm);
    });
    return parseCompactOutcome(frames);
  }
  requestCompaction(): void { this.compactRequested = true; }

  async dispose(): Promise<void> { this.input.close(); await this.done; }

  protected assertRunning(): void { if (this.ended) throw new Error(`${this.label} is not running`); }
  // ... callQ/callQValue + setModel/setPermissionMode/setMaxThinkingTokens/interrupt/getContextUsage/
  //     accountInfo/capabilities/rewind — lifted verbatim from DaemonSession (label-guarded). ...

  private async readLoop(): Promise<void> {
    try {
      for await (const m of this.q) {
        this.lastActiveAt = this.now();
        const mm = m as any;
        if (mm.type === "system" && mm.subtype === "init" && !this._sessionId) this._sessionId = mm.session_id;
        if (mm.type === "result") {
          this.waiters.shift()?.resolve({ result: mm.result });
          if (this.compactRequested && !this.ended) { this.compactRequested = false; void this.compact().catch(() => {}); }
        } else this.waiters[0]?.onMessage(m);
      }
    } finally {
      this.ended = true;
      for (const w of this.waiters.splice(0)) w.reject(new Error(`${this.label} disposed`));
    }
  }
}
```

**`rewind(userMessageId, opts?)`** is added to the base as a `callQ`-style delegation to the SDK's `rewindFiles`
(the one-shot harness already exposes it). Per memory `sdk-session-store-introspection-verified`, the rewind anchor
must be a real user-prompt UUID from the transcript, not a live-stream `type:"user"` frame — documented on the
method, not enforced.

### 4.2 `stream(prompt)` convenience — `Session`

A thin ergonomic wrapper over `submit` so callers can `for await` a single turn instead of passing a callback. It
yields the turn's intermediate messages and ends after the turn's result; implemented over `submit` + an internal
`AsyncQueue` (exact frame-shaping — whether the synthesized terminal frame echoes the raw result — is a plan
detail). `submit(prompt, onMessage)` remains THE documented core; `stream` is sugar.

### 4.3 Factories — `src/session/index.ts` (NEW)

```ts
import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import { resolveOptions } from "../config/resolveOptions.js";
import type { HarnessConfig } from "../config/types.js";
import { Session, type SessionDeps, type SessionOpts } from "./session.js";

export interface OpenSessionConfig extends HarnessConfig { contextTool?: boolean; compactTool?: boolean; }
export interface SessionDepsInput { query?: SessionDeps["query"]; }

export function openSession(config: OpenSessionConfig = {}, deps: SessionDepsInput = {}): Session {
  const query = deps.query ?? sdkQuery;
  return new Session({ query }, resolveOptions(config), { contextTool: config.contextTool, compactTool: config.compactTool });
}
/** Resume a prior session by id. `resume` PRESERVES the session_id (probe G2b), so the returned
 *  Session's .sessionId equals `id` once its first turn's init fires. */
export function resumeSession(id: string, config: OpenSessionConfig = {}, deps?: SessionDepsInput): Session {
  return openSession({ ...config, resume: id }, deps);
}
export { Session };
export type { SessionDeps, SessionOpts } from "./session.js";
```

`contextTool`/`compactTool` are session-level booleans (NOT SDK options) — same posture as the daemon's
`DaemonOptions.contextTool`/`compactTool`; they never leak into `resolveOptions`.

### 4.4 `DaemonSession` refactor — `src/daemon/session.ts`

`DaemonSession` becomes a thin subclass. It keeps its `sess-N` handle id (used as the base `label` for error
messages, and by the supervisor for the pool/registry keys) and inherits everything else. The supervisor's
construction call site (`new DaemonSession(id, { query }, options, now, { contextTool, compactTool })`,
`supervisor.ts:223`) is preserved by keeping the same constructor parameter order.

```ts
import { Session, type SessionDeps, type SessionOpts } from "../session/session.js";
import type { ControllableSession } from "../bridge/types.js";

export interface DaemonSessionDeps extends SessionDeps {}

export class DaemonSession extends Session implements ControllableSession {
  readonly id: string;
  constructor(
    id: string, deps: DaemonSessionDeps, options: Record<string, unknown>,
    now: () => number = Date.now, sessionOpts: { contextTool?: boolean; compactTool?: boolean } = {},
  ) {
    super(deps, options, { ...sessionOpts, label: id, now });
    this.id = id;
  }
}
```

Net effect: `daemon/session.ts` shrinks from ~129 lines to ~25; the engine lives once, in `Session`. The daemon's
`compact()`/`requestCompaction()`/control surface/`done`/`lastActiveAt` are all inherited unchanged, so the
daemon's existing behavior and tests hold.

## §5 Data flow

- **Open:** `openSession(config)` → `resolveOptions` → `new Session({query}, options, {contextTool,compactTool})` →
  `query({prompt: AsyncQueue, options})` starts; `readLoop` begins consuming.
- **First turn:** `submit(prompt, onMessage)` pushes a turn + waiter → SDK streams; the `init` frame sets
  `_sessionId` → intermediate frames go to `onMessage` → the `type:"result"` resolves the waiter. After this turn,
  `.sessionId` is populated.
- **Compact:** `compact()` (or the `cc-compact` tool's intent at a turn boundary) injects `/compact` with its own
  FIFO waiter → status/boundary frames → `parseCompactOutcome`.
- **Resume:** `resumeSession(id, config)` opens a new `Session` with `options.resume = id`; its first turn recalls
  prior context and its `.sessionId` equals `id` (resume preserves the id).
- **Dispose:** `dispose()` closes the input queue (in-flight turn finishes) and awaits `done`.

## §6 Error handling

- `submit` after the query has ended rejects (`"<label> is not running"`); the in-flight-turn-at-teardown contract
  is preserved — `readLoop`'s `finally` rejects every leftover waiter so no turn hangs forever.
- `.sessionId` is `undefined` until the first turn's `init` arrives. Callers needing the id for resume must take at
  least one turn first (documented). `resumeSession(id)` does not require the source `Session` to still be alive.
- `compact()` returning `{ ok:false, result:"failed" }` (e.g. "Not enough messages to compact.") is a normal
  outcome, not a thrown error (same contract as Spec B).
- A dead/errored query never rejects teardown (`done` is `.catch(()=>{})`-guarded); control methods are
  feature-detected (`callQ` rejects `unsupported: <name>` if the SDK lacks the method).

## §7 Testing

**Unit** (`test/unit/session.test.ts`, fake `QueryFn`):
- **sessionId capture-once:** a fake query emitting two `init` frames with the same id → `.sessionId` is that id;
  emitting init frames with different ids → `.sessionId` keeps the FIRST (capture-once contract).
- `.sessionId` is `undefined` before any turn completes; populated after the first turn.
- `submit` FIFO: two turns resolve in order with their own results; an `onMessage` only sees its own turn's frames.
- `compact()` injects `/compact` and returns the parsed outcome; `requestCompaction()` + a turn `result` triggers
  exactly one `/compact` injection and clears the flag; a human `submit` queued after still resolves with ITS OWN
  result (FIFO intact). (Lifted from the current `daemon-session` tests, which now target the base.)
- `submit`/`compact` after `dispose` reject; an in-flight turn at dispose rejects (teardown-liveness, per memory
  `teardown-liveness-review-pattern`).
- control delegations call the underlying query method and reject `unsupported` when absent.
- `openSession`/`resumeSession`: `resolveOptions` is applied; `resumeSession` sets `options.resume = id`;
  `contextTool`/`compactTool` wire the cc-context/cc-compact servers into the captured options (capturing fake
  query) and do NOT leak into `resolveOptions`.
- `daemon/session.ts`: `DaemonSession` still exposes `.id`, inherits `submit`/`compact`/control, and constructs
  with the unchanged `(id, deps, options, now, sessionOpts)` signature.

**Live** (`test/live/session.test.ts`, gated `ANTHROPIC_API_KEY ? describe : describe.skip`, `try/finally`):
- `openSession` → `submit` twice → `.sessionId` is truthy and stable across the two turns; turn 2 recalls turn 1's
  codeword.
- `compact()` after ~3 substantial turns → `result: "success"`, `postTokens < preTokens` (mirrors the Spec B live
  test, now via the public `Session`).
- **resume round-trip:** `openSession` → set a codeword → read `.sessionId` → `dispose` → `resumeSession(id)` →
  recalls the codeword; the resumed `.sessionId` equals the original id.

## §8 Non-goals (separate / later)

- ❌ Daemon registry/persistence rework — **Spec 2** (`daemon-durable-sessions`). This spec only ADDS
  `.sessionId` to the engine; it does not change how the daemon stores or resumes sessions.
- ❌ `forkSession` branching — **Spec 3** (`session-forking`).
- ❌ Surviving a full daemon process restart (boot rehydration) — deferred (Spec 2 non-goal).
- ❌ Any change to one-shot `createHarness`/`resumeHarness` — they remain the string-prompt path. (A future
  refactor could express them over `Session`, but YAGNI now.)
- ❌ A new persistence substrate — `resume`/`persistSession`/`sessionStore`/`enableFileCheckpointing` are already
  config-plumbed and flow into a `Session` unchanged.
- ❌ Concurrent multi-query orchestration within one `Session` (one query, FIFO turns). Parallel sessions = open
  multiple `Session`s.
