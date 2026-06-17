# Lib-Level Interactive Session Primitive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote `DaemonSession`'s streaming engine into a public, daemon-independent `Session` class (with SDK `session_id` capture) plus `openSession`/`resumeSession` factories, so multi-turn sessions, on-demand compaction, the `cc-context` tool, and the live control surface work as a library — not only through the UDS daemon.

**Architecture:** Extract the engine (AsyncQueue streaming input + FIFO-waiter `readLoop` + `submit`/`compact`/control surface + `dispose`) from `src/daemon/session.ts` into a new base class `src/session/session.ts`, adding `session_id` capture-once from the `system/init` frame and a `.sessionId` getter. `DaemonSession` becomes a thin `extends Session` subclass keeping only its `sess-N` handle id. Factories in `src/session/index.ts` run the existing `resolveOptions` config pipeline. This is an atomic *move* (Task 1) — the engine lives in exactly one place at all times, never duplicated.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), `@anthropic-ai/claude-agent-sdk@0.3.178`, Vitest. Reuses `AsyncQueue` (`src/swarm/asyncQueue.ts`), `QueryFn` (`src/swarm/types.ts`), `ControllableSession` (`src/bridge/types.ts`), `withContextTool`/`withCompactTool`/`parseCompactOutcome` (`src/context/server.ts`, `src/compaction/server.ts`), `resolveOptions` (`src/config/resolveOptions.ts`).

## Global Constraints

- **Working dir:** `CC-to-SDK/harness/`. Every `npx`/`npm`/`git` command runs from there.
- **ESM specifiers:** every relative import ends in `.js` (even though sources are `.ts`).
- **No Prettier.** Match the dense one-line-method hand-style of `src/daemon/session.ts` and `src/context/server.ts` (compact bodies, inline args). Keep modules small (<500 LoC).
- **DI by deps:** production takes `{ query }`; unit tests inject a fake `QueryFn` (an async generator over the `prompt` async-iterable). Unit tests NEVER hit the network.
- **`session_id` capture-once:** capture from the FIRST `system/init` frame only; `.sessionId` is `undefined` until the first turn produces an init frame.
- **`contextTool`/`compactTool` are session-level booleans** (`SessionOpts` / `OpenSessionConfig`), NOT SDK options — they must never appear in the resolved SDK options object passed to `query()`.
- **Preserve `DaemonSession`'s public surface:** constructor `(id, deps, options, now?, sessionOpts?)`, the `.id` field, the `done` promise, and every inherited method. The supervisor call site (`src/daemon/supervisor.ts:223`) must not need any change.
- **Commits:** to the current branch `main`, **no `Co-Authored-By` / attribution lines**, **never push**.
- **Commands:** unit test a file → `npx vitest run test/unit/<file>` (add `-t "<name>"` to filter); typecheck → `npm run typecheck`; build → `npm run build`. Live tests gate on `ANTHROPIC_API_KEY` and SKIP without it (the implementer will see them skipped — that is the expected green; the controller runs the keyed pass).

---

### Task 1: Extract `Session` base + refactor `DaemonSession extends Session`

The atomic move: create the base, retarget the engine tests to it (adding `session_id` capture tests), and reduce `DaemonSession` to a subclass. After this task the engine exists once, the daemon behaves identically, and `.sessionId` is captured.

**Files:**
- Create: `src/session/session.ts`
- Create: `test/unit/session.test.ts`
- Modify: `src/daemon/session.ts` (replace entire contents)
- Modify: `test/unit/daemon-session.test.ts` (replace entire contents — slim to subclass-specific checks)

**Interfaces:**
- Consumes: `AsyncQueue` (`src/swarm/asyncQueue.js`), `QueryFn` (`src/swarm/types.js`), `ControllableSession` (`src/bridge/types.js`), `withContextTool`/`QueryHolder`/`RawContextUsage` (`src/context/server.js`), `withCompactTool`/`parseCompactOutcome`/`CompactHolder`/`CompactOutcome` (`src/compaction/server.js`).
- Produces:
  - `class Session implements ControllableSession` with `constructor(deps: SessionDeps, options: Record<string, unknown>, sessionOpts?: SessionOpts)`; fields/methods: `lastActiveAt: number`, `readonly done: Promise<void>`, `get sessionId(): string | undefined`, `isEnded(): boolean`, `submit(prompt: string, onMessage?: (m: unknown) => void): Promise<{ result: unknown }>`, `compact(): Promise<CompactOutcome>`, `requestCompaction(): void`, `dispose(): Promise<void>`, `setModel(model?: string)`, `setPermissionMode(mode: string)`, `setMaxThinkingTokens(maxTokens: number | null)`, `interrupt()`, `getContextUsage()`, `accountInfo()`, `rewind(userMessageId: string, opts?: { dryRun?: boolean })`, `capabilities()`.
  - `interface SessionDeps { query: QueryFn }`
  - `interface SessionOpts { contextTool?: boolean; compactTool?: boolean; label?: string; now?: () => number }`
  - `class DaemonSession extends Session` with `readonly id: string` and constructor `(id, deps, options, now?, sessionOpts?: { contextTool?: boolean; compactTool?: boolean })`.

- [ ] **Step 1: Write the failing engine + sessionId tests**

Create `test/unit/session.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Session } from "../../src/session/session.js";

function fakeQuery({ prompt }: any) {
  return (async function* () {
    for await (const turn of prompt) {
      const text = turn.message.content;
      yield { type: "assistant", message: { content: [{ type: "text", text: "ack:" + text }] } };
      yield { type: "result", subtype: "success", result: "did:" + text };
    }
  })();
}
function captureQuery(sink: any[]) {
  return ({ prompt, options }: any) => { sink.push(options); return (async function* () { for await (const t of prompt) yield { type: "result", result: "ok:" + t.message.content }; })(); };
}
function compactQuery(seen: string[]) {
  return ({ prompt }: any) => (async function* () {
    for await (const t of prompt) {
      const text = t.message.content; seen.push(text);
      if (text === "/compact") {
        yield { type: "system", subtype: "status", status: "compacting" };
        yield { type: "system", subtype: "compact_boundary", compact_metadata: { trigger: "manual", pre_tokens: 1000, post_tokens: 200 } };
        yield { type: "system", subtype: "status", status: null, compact_result: "success" };
        yield { type: "result", subtype: "success", result: "compacted" };
      } else yield { type: "result", subtype: "success", result: "did:" + text };
    }
  })();
}
// emits a system/init carrying session_id before each turn's result
function initQuery(ids: string[]) {
  return ({ prompt }: any) => (async function* () {
    let i = 0;
    for await (const t of prompt) {
      yield { type: "system", subtype: "init", session_id: ids[Math.min(i, ids.length - 1)] }; i++;
      yield { type: "result", subtype: "success", result: "did:" + t.message.content };
    }
  })();
}

describe("Session", () => {
  it("submit streams non-result messages then resolves with the turn result", async () => {
    const chunks: any[] = [];
    const s = new Session({ query: fakeQuery }, {});
    const r = await s.submit("hello", (m) => chunks.push(m));
    expect(r.result).toBe("did:hello");
    expect(chunks.map((c: any) => c.type)).toEqual(["assistant"]);
    await s.dispose();
  });
  it("submit defaults onMessage to a no-op (callable with just a prompt)", async () => {
    const s = new Session({ query: fakeQuery }, {});
    expect((await s.submit("x")).result).toBe("did:x");
    await s.dispose();
  });
  it("advances lastActiveAt off an injected clock", async () => {
    let t = 100;
    const s = new Session({ query: fakeQuery }, {}, { now: () => t });
    expect(s.lastActiveAt).toBe(100);
    t = 250;
    await s.submit("x");
    expect(s.lastActiveAt).toBe(250);
    await s.dispose();
  });
  it("handles two sequential submits in FIFO order", async () => {
    const s = new Session({ query: fakeQuery }, {});
    expect((await s.submit("a")).result).toBe("did:a");
    expect((await s.submit("b")).result).toBe("did:b");
    await s.dispose();
  });
  it("rejects submit once ended, using the label in the message", async () => {
    const s = new Session({ query: fakeQuery }, {}, { label: "lib-sess" });
    await s.submit("a");
    await s.dispose();
    await expect(s.submit("b")).rejects.toThrow(/lib-sess is not running/);
  });
  it("rejects an in-flight submit when disposed mid-turn", async () => {
    const fq = ({ prompt }: any) => (async function* () { for await (const t of prompt) { void t; } })();
    const s = new Session({ query: fq }, {});
    const p = s.submit("x");
    await s.dispose();
    await expect(p).rejects.toThrow(/disposed/);
  });
  it("exposes a done promise that resolves when the query ends", async () => {
    const s = new Session({ query: fakeQuery }, {});
    let ended = false;
    s.done.then(() => { ended = true; });
    await s.dispose();
    await Promise.resolve();
    expect(ended).toBe(true);
  });
  it("captures session_id from the first init frame; undefined before the first turn", async () => {
    const s = new Session({ query: initQuery(["sid-A"]) }, {});
    expect(s.sessionId).toBeUndefined();
    await s.submit("hi");
    expect(s.sessionId).toBe("sid-A");
    await s.dispose();
  });
  it("captures session_id ONCE and keeps the first id across turns", async () => {
    const s = new Session({ query: initQuery(["sid-1", "sid-2"]) }, {});
    await s.submit("a");
    await s.submit("b");
    expect(s.sessionId).toBe("sid-1");
    await s.dispose();
  });
  it("contextTool wires cc-context into the query options", async () => {
    const sink: any[] = [];
    const s = new Session({ query: captureQuery(sink) }, {}, { contextTool: true });
    expect((sink[0].mcpServers as any)["cc-context"]).toBeTruthy();
    expect(sink[0].allowedTools).toContain("mcp__cc-context__GetContextUsage");
    await s.dispose();
  });
  it("no tools → options reach the query untouched", async () => {
    const sink: any[] = [];
    const s = new Session({ query: captureQuery(sink) }, {});
    expect(sink[0].mcpServers).toBeUndefined();
    await s.dispose();
  });
  it("contextTool + compactTool both merge their servers", async () => {
    const sink: any[] = [];
    const s = new Session({ query: captureQuery(sink) }, {}, { contextTool: true, compactTool: true });
    expect((sink[0].mcpServers as any)["cc-context"]).toBeTruthy();
    expect((sink[0].mcpServers as any)["cc-compact"]).toBeTruthy();
    expect(sink[0].allowedTools).toEqual(expect.arrayContaining(["mcp__cc-context__GetContextUsage", "mcp__cc-compact__RequestCompaction"]));
    await s.dispose();
  });
  it("compact() injects /compact and returns the parsed outcome", async () => {
    const seen: string[] = [];
    const s = new Session({ query: compactQuery(seen) }, {});
    expect(await s.compact()).toEqual({ ok: true, result: "success", error: undefined, preTokens: 1000, postTokens: 200 });
    expect(seen).toEqual(["/compact"]);
    await s.dispose();
  });
  it("requestCompaction fires exactly one /compact at the turn boundary; FIFO intact", async () => {
    const seen: string[] = [];
    const s = new Session({ query: compactQuery(seen) }, {});
    s.requestCompaction();
    expect((await s.submit("hello")).result).toBe("did:hello");
    expect((await s.submit("world")).result).toBe("did:world");
    await s.dispose();
    expect(seen).toEqual(["hello", "/compact", "world"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/session.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/session/session.js"` (module does not exist yet).

- [ ] **Step 3: Create the `Session` base class**

Create `src/session/session.ts`:

```ts
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { AsyncQueue } from "../swarm/asyncQueue.js";
import type { QueryFn } from "../swarm/types.js";
import type { ControllableSession } from "../bridge/types.js";
import { withContextTool, type QueryHolder, type RawContextUsage } from "../context/server.js";
import { withCompactTool, parseCompactOutcome, type CompactHolder, type CompactOutcome } from "../compaction/server.js";

export interface SessionDeps { query: QueryFn; }
export interface SessionOpts { contextTool?: boolean; compactTool?: boolean; label?: string; now?: () => number; }

function userTurn(text: string): SDKUserMessage {
  return { type: "user", message: { role: "user", content: text }, parent_tool_use_id: null } as SDKUserMessage;
}

interface Waiter { onMessage: (m: unknown) => void; resolve: (r: { result: unknown }) => void; reject: (e: Error) => void; }

/** One long-lived query() session. A turn is submit(prompt,onMessage) → streamed messages → resolved result.
 *  Captures the SDK session_id from the first system/init frame (stable per probe) → .sessionId. */
export class Session implements ControllableSession {
  lastActiveAt: number;
  readonly done: Promise<void>;            // resolves when the read-loop ends (query disposed or died)
  protected input = new AsyncQueue<SDKUserMessage>();
  protected q: AsyncIterable<unknown>;
  protected waiters: Waiter[] = [];        // FIFO: query emits one result per submitted turn, in order
  protected ended = false;
  protected compactRequested = false;      // set by the cc-compact tool; fires one /compact at the next boundary
  protected now: () => number;
  protected label: string;                 // used only in error messages
  private _sessionId?: string;             // captured from the first system/init frame

  constructor(deps: SessionDeps, options: Record<string, unknown>, sessionOpts: SessionOpts = {}) {
    this.now = sessionOpts.now ?? Date.now;
    this.label = sessionOpts.label ?? "session";
    this.lastActiveAt = this.now();
    let opts = options;
    let ctxHolder: QueryHolder | undefined;
    let compactHolder: CompactHolder | undefined;
    if (sessionOpts.contextTool) { ctxHolder = {}; opts = withContextTool(opts, ctxHolder); }
    if (sessionOpts.compactTool) { compactHolder = {}; opts = withCompactTool(opts, compactHolder); }
    this.q = deps.query({ prompt: this.input, options: opts });
    if (ctxHolder) ctxHolder.query = this.q as unknown as { getContextUsage(): Promise<RawContextUsage> };
    if (compactHolder) compactHolder.request = () => this.requestCompaction();
    this.done = this.readLoop().catch(() => {});
  }

  /** The SDK session_id, available after the first turn's init frame; undefined before then. */
  get sessionId(): string | undefined { return this._sessionId; }
  isEnded(): boolean { return this.ended; }

  /** Push a turn + its waiter onto the FIFO. Shared by submit() and compact() so every injected turn
   *  gets its own waiter (its result resolves ITS waiter, never another turn's). */
  private enqueueTurn(prompt: string, onMessage: (m: unknown) => void): Promise<{ result: unknown }> {
    return new Promise((resolve, reject) => { this.waiters.push({ onMessage, resolve, reject }); this.input.push(userTurn(prompt)); });
  }

  /** Run one turn; non-result messages stream to onMessage; resolves with the turn's result.
   *  Rejects immediately if the underlying query has already ended (else the waiter would never drain). */
  submit(prompt: string, onMessage: (m: unknown) => void = () => {}): Promise<{ result: unknown }> {
    if (this.ended) return Promise.reject(new Error(`${this.label} is not running`));
    return this.enqueueTurn(prompt, onMessage);
  }

  /** Inject `/compact` as a turn (its own FIFO waiter) and return the structured outcome. */
  async compact(): Promise<CompactOutcome> {
    this.assertRunning();
    const frames: unknown[] = [];
    await this.enqueueTurn("/compact", (m) => {
      const mm = m as any;
      if (mm.type === "system" && (mm.subtype === "status" || mm.subtype === "compact_boundary")) frames.push(mm);
    });
    return parseCompactOutcome(frames);
  }

  /** Record intent (set by the cc-compact tool); consumed at the next turn boundary in readLoop. */
  requestCompaction(): void { this.compactRequested = true; }

  /** End the query (in-flight turn finishes) and wait for the read-loop. */
  async dispose(): Promise<void> { this.input.close(); await this.done; }

  protected assertRunning(): void { if (this.ended) throw new Error(`${this.label} is not running`); }

  private callQ(name: string, ...args: unknown[]): Promise<void> {
    const fn = (this.q as any)[name];
    if (typeof fn !== "function") return Promise.reject(new Error(`unsupported: ${name}`));
    return fn.apply(this.q, args);
  }
  private callQValue(name: string): Promise<unknown> {
    const fn = (this.q as any)[name];
    if (typeof fn !== "function") return Promise.reject(new Error(`unsupported: ${name}`));
    return fn.apply(this.q);
  }

  async setModel(model?: string): Promise<void> { this.assertRunning(); await this.callQ("setModel", model); }
  async setPermissionMode(mode: string): Promise<void> { this.assertRunning(); await this.callQ("setPermissionMode", mode); }
  async setMaxThinkingTokens(maxTokens: number | null): Promise<void> { this.assertRunning(); await this.callQ("setMaxThinkingTokens", maxTokens); }
  async interrupt(): Promise<void> { await this.callQ("interrupt"); } // benign no-op when idle; unsupported if absent

  async getContextUsage(): Promise<unknown> { this.assertRunning(); return this.callQValue("getContextUsage"); }
  async accountInfo(): Promise<unknown> { this.assertRunning(); return this.callQValue("accountInfo"); }

  /** Rewind the file checkpoint to a prior user-prompt message. The anchor must be a real user-prompt UUID
   *  from the transcript (getSessionMessages), NOT a live-stream type:"user" frame. */
  async rewind(userMessageId: string, opts?: { dryRun?: boolean }): Promise<unknown> {
    this.assertRunning();
    const fn = (this.q as any).rewindFiles;
    if (typeof fn !== "function") return Promise.reject(new Error("unsupported: rewindFiles"));
    return fn.call(this.q, userMessageId, opts);
  }

  async capabilities(): Promise<{ models: unknown[]; commands: unknown[]; mcpServers: unknown[] }> {
    const q = this.q as any;
    const [models, commands, mcpServers] = await Promise.all([
      q.supportedModels?.() ?? [], q.supportedCommands?.() ?? [], q.mcpServerStatus?.() ?? [],
    ]);
    return { models, commands, mcpServers };
  }

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

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/session.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 5: Refactor `DaemonSession` to extend `Session`**

Replace the ENTIRE contents of `src/daemon/session.ts` with:

```ts
import { Session, type SessionDeps } from "../session/session.js";

export interface DaemonSessionDeps extends SessionDeps {}

/** A daemon-managed Session: adds the daemon's sess-N handle id (used as the error label) on top of the
 *  shared streaming engine. The supervisor attaches its restart end-hook to the inherited `done`. */
export class DaemonSession extends Session {
  readonly id: string;
  constructor(
    id: string,
    deps: DaemonSessionDeps,
    options: Record<string, unknown>,
    now: () => number = Date.now,
    sessionOpts: { contextTool?: boolean; compactTool?: boolean } = {},
  ) {
    super(deps, options, { ...sessionOpts, label: id, now });
    this.id = id;
  }
}
```

- [ ] **Step 6: Slim the daemon-session test to subclass-specific checks**

Replace the ENTIRE contents of `test/unit/daemon-session.test.ts` with:

```ts
import { describe, it, expect } from "vitest";
import { DaemonSession } from "../../src/daemon/session.js";

function fakeQuery({ prompt }: any) {
  return (async function* () { for await (const turn of prompt) yield { type: "result", subtype: "success", result: "did:" + turn.message.content }; })();
}
function captureQuery(sink: any[]) {
  return ({ prompt, options }: any) => { sink.push(options); return (async function* () { for await (const t of prompt) yield { type: "result", result: "ok:" + t.message.content }; })(); };
}

describe("DaemonSession (subclass of Session)", () => {
  it("exposes the daemon handle id", async () => {
    const s = new DaemonSession("sess-7", { query: fakeQuery }, {});
    expect(s.id).toBe("sess-7");
    await s.dispose();
  });
  it("inherits submit + dispose from Session", async () => {
    const s = new DaemonSession("sess-1", { query: fakeQuery }, {});
    expect((await s.submit("hi", () => {})).result).toBe("did:hi");
    await s.dispose();
  });
  it("threads the 5th-arg contextTool/compactTool through to the base", async () => {
    const sink: any[] = [];
    const s = new DaemonSession("s-both", { query: captureQuery(sink) }, {}, Date.now, { contextTool: true, compactTool: true });
    expect((sink[0].mcpServers as any)["cc-context"]).toBeTruthy();
    expect((sink[0].mcpServers as any)["cc-compact"]).toBeTruthy();
    expect(sink[0].allowedTools).toEqual(expect.arrayContaining(["mcp__cc-context__GetContextUsage", "mcp__cc-compact__RequestCompaction"]));
    await s.dispose();
  });
  it("uses the daemon id as the error label once ended", async () => {
    const s = new DaemonSession("sess-9", { query: fakeQuery }, {});
    await s.submit("a", () => {});
    await s.dispose();
    await expect(s.submit("b", () => {})).rejects.toThrow(/sess-9 is not running/);
  });
});
```

- [ ] **Step 7: Run daemon tests + typecheck (no regression)**

Run: `npx vitest run test/unit/daemon-session.test.ts test/unit/daemon-supervisor.test.ts && npm run typecheck`
Expected: PASS (daemon-session 4 tests; daemon-supervisor unchanged and green); typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add src/session/session.ts test/unit/session.test.ts src/daemon/session.ts test/unit/daemon-session.test.ts
git commit -m "feat(harness): extract Session base from DaemonSession + capture SDK session_id (spec 1 task 1)"
```

---

### Task 2: `stream(prompt)` convenience method

A per-turn async-generator wrapper over `submit`, for callers who prefer `for await` to a callback.

**Files:**
- Modify: `src/session/session.ts` (add one method)
- Modify: `test/unit/session.test.ts` (add two tests)

**Interfaces:**
- Consumes: `Session.submit` (Task 1), `AsyncQueue` (already imported in `session.ts`).
- Produces: `Session.stream(prompt: string): AsyncGenerator<unknown>` — yields the turn's streamed (non-result) messages, then a terminal `{ type: "result", result }` frame, or `{ type: "error", error }` if the turn rejects.

- [ ] **Step 1: Write the failing tests**

Add to `test/unit/session.test.ts` (inside the `describe("Session", …)` block):

```ts
  it("stream yields the turn's messages then a terminal result frame", async () => {
    const s = new Session({ query: fakeQuery }, {});
    const seen: any[] = [];
    for await (const m of s.stream("hi")) seen.push(m);
    expect(seen.map((m: any) => m.type)).toEqual(["assistant", "result"]);
    expect(seen[seen.length - 1]).toEqual({ type: "result", result: "did:hi" });
    await s.dispose();
  });
  it("stream yields a terminal error frame when the turn rejects (session ended)", async () => {
    const s = new Session({ query: fakeQuery }, {}, { label: "x" });
    await s.dispose();
    const seen: any[] = [];
    for await (const m of s.stream("hi")) seen.push(m);
    expect(seen).toEqual([{ type: "error", error: "x is not running" }]);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/unit/session.test.ts -t "stream"`
Expected: FAIL — `s.stream is not a function`.

- [ ] **Step 3: Implement `stream`**

Add this method to the `Session` class in `src/session/session.ts` (place it directly after `submit`):

```ts
  /** Convenience: run one turn as an async generator. Yields the turn's streamed (non-result) messages,
   *  then a terminal { type:"result", result } (or { type:"error", error } if the turn rejects). Sugar over submit. */
  async *stream(prompt: string): AsyncGenerator<unknown> {
    const out = new AsyncQueue<unknown>();
    const done = this.submit(prompt, (m) => out.push(m)).then(
      (r) => out.push({ type: "result", result: r.result }),
      (e) => out.push({ type: "error", error: (e as Error).message }),
    ).finally(() => out.close());
    for await (const m of out) yield m;
    await done;
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/unit/session.test.ts`
Expected: PASS (16 tests).

- [ ] **Step 5: Commit**

```bash
git add src/session/session.ts test/unit/session.test.ts
git commit -m "feat(harness): Session.stream() per-turn async-generator convenience (spec 1 task 2)"
```

---

### Task 3: `openSession` / `resumeSession` factories

Public factories that run the existing `resolveOptions` config pipeline and construct a `Session`.

**Files:**
- Create: `src/session/index.ts`
- Create: `test/unit/session-factories.test.ts`

**Interfaces:**
- Consumes: `query` (`@anthropic-ai/claude-agent-sdk`), `resolveOptions` (`src/config/resolveOptions.js`), `HarnessConfig` (`src/config/types.js`), `Session`/`SessionDeps`/`SessionOpts` (Task 1).
- Produces:
  - `interface OpenSessionConfig extends HarnessConfig { contextTool?: boolean; compactTool?: boolean }`
  - `interface SessionDepsInput { query?: SessionDeps["query"] }`
  - `function openSession(config?: OpenSessionConfig, deps?: SessionDepsInput): Session`
  - `function resumeSession(id: string, config?: OpenSessionConfig, deps?: SessionDepsInput): Session`
  - re-exports `Session` (value) and types `SessionDeps`, `SessionOpts`, `OpenSessionConfig`, `SessionDepsInput`.

- [ ] **Step 1: Write the failing tests**

Create `test/unit/session-factories.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { openSession, resumeSession, Session } from "../../src/session/index.js";

function captureQuery(sink: any[]) {
  return ({ prompt, options }: any) => { sink.push(options); return (async function* () { for await (const t of prompt) yield { type: "result", result: "ok:" + t.message.content }; })(); };
}

describe("openSession / resumeSession", () => {
  it("openSession returns a Session and applies resolveOptions", async () => {
    const sink: any[] = [];
    const s = openSession({ model: "m" }, { query: captureQuery(sink) });
    expect(s).toBeInstanceOf(Session);
    await s.submit("x");
    expect(sink[0].model).toBe("m");
    expect(sink[0].settingSources).toBeDefined();   // proves resolveOptions ran (not a bare options object)
    await s.dispose();
  });
  it("contextTool/compactTool wire the servers but do NOT leak into resolveOptions output", async () => {
    const sink: any[] = [];
    const s = openSession({ contextTool: true, compactTool: true }, { query: captureQuery(sink) });
    await s.submit("x");
    expect((sink[0].mcpServers as any)["cc-context"]).toBeTruthy();
    expect((sink[0].mcpServers as any)["cc-compact"]).toBeTruthy();
    expect(sink[0].contextTool).toBeUndefined();
    expect(sink[0].compactTool).toBeUndefined();
    await s.dispose();
  });
  it("resumeSession sets options.resume to the given id", async () => {
    const sink: any[] = [];
    const s = resumeSession("sid-xyz", {}, { query: captureQuery(sink) });
    await s.submit("x");
    expect(sink[0].resume).toBe("sid-xyz");
    await s.dispose();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/unit/session-factories.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/session/index.js"`.

- [ ] **Step 3: Implement the factories**

Create `src/session/index.ts`:

```ts
import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import { resolveOptions } from "../config/resolveOptions.js";
import type { HarnessConfig } from "../config/types.js";
import { Session, type SessionDeps } from "./session.js";

export interface OpenSessionConfig extends HarnessConfig { contextTool?: boolean; compactTool?: boolean; }
export interface SessionDepsInput { query?: SessionDeps["query"]; }

/** Open a new interactive multi-turn session. Honors the full HarnessConfig (via resolveOptions).
 *  `contextTool`/`compactTool` are session-level booleans — they wire the in-process MCP tools, never SDK options. */
export function openSession(config: OpenSessionConfig = {}, deps: SessionDepsInput = {}): Session {
  const query = deps.query ?? sdkQuery;
  return new Session({ query }, resolveOptions(config), { contextTool: config.contextTool, compactTool: config.compactTool });
}

/** Resume a prior session by id. `resume` PRESERVES the session_id, so the returned Session's
 *  .sessionId equals `id` once its first turn's init fires. */
export function resumeSession(id: string, config: OpenSessionConfig = {}, deps?: SessionDepsInput): Session {
  return openSession({ ...config, resume: id }, deps);
}

export { Session };
export type { SessionDeps, SessionOpts } from "./session.js";
```

(`OpenSessionConfig` and `SessionDepsInput` are exported by their `export interface` declarations above.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/unit/session-factories.test.ts && npm run typecheck`
Expected: PASS (3 tests); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/session/index.ts test/unit/session-factories.test.ts
git commit -m "feat(harness): openSession/resumeSession factories over resolveOptions (spec 1 task 3)"
```

---

### Task 4: Public exports

Surface the primitive on the package's public API barrel.

**Files:**
- Modify: `src/index.ts:20-21` (add session exports after the compaction exports)
- Modify: `test/unit/index.test.ts` (assert the new exports)

**Interfaces:**
- Consumes: everything from `src/session/index.ts` (Task 3).
- Produces: `openSession`, `resumeSession`, `Session` (values) and `OpenSessionConfig`, `SessionDepsInput`, `SessionDeps`, `SessionOpts` (types) on `src/index.ts`.

- [ ] **Step 1: Add the failing export assertions**

In `test/unit/index.test.ts`, add these three lines inside the `it(...)` body (after the existing `parseCompactOutcome` assertion on line 17):

```ts
    expect(typeof api.openSession).toBe("function");
    expect(typeof api.resumeSession).toBe("function");
    expect(typeof api.Session).toBe("function");
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/unit/index.test.ts`
Expected: FAIL — `expected undefined to be "function"` for `api.openSession`.

- [ ] **Step 3: Add the exports**

In `src/index.ts`, add these two lines immediately after the `COMPACT_TOOL` export block (after line 21):

```ts
export { openSession, resumeSession, Session } from "./session/index.js";
export type { OpenSessionConfig, SessionDepsInput, SessionDeps, SessionOpts } from "./session/index.js";
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/unit/index.test.ts && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts test/unit/index.test.ts
git commit -m "feat(harness): export openSession/resumeSession/Session from public barrel (spec 1 task 4)"
```

---

### Task 5: Live test (gated)

Prove the primitive against the real SDK: streaming `session_id` capture + stability, on-demand `compact()`, and a resume round-trip that preserves the id.

**Files:**
- Create: `test/live/session.test.ts`

**Interfaces:**
- Consumes: `openSession`, `resumeSession` (public barrel, Task 4).

- [ ] **Step 1: Write the gated live test**

Create `test/live/session.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSession, resumeSession } from "../../src/index.js";

const live = process.env.ANTHROPIC_API_KEY ? describe : describe.skip;
const MODEL = "claude-haiku-4-5-20251001";

live("live interactive Session (real SDK)", () => {
  it("multi-turn: captures a stable sessionId and recalls across turns", async () => {
    const s = openSession({ model: MODEL, permissionMode: "bypassPermissions" });
    try {
      await s.submit("Remember this codeword: ZEBRA77. Reply OK only.");
      const id1 = s.sessionId;
      const r2 = await s.submit("What was the codeword? Reply with just the word.");
      expect(id1).toBeTruthy();
      expect(s.sessionId).toBe(id1);                       // stable across turns
      expect(String(r2.result)).toMatch(/ZEBRA77/);
    } finally { await s.dispose(); }
  }, 60_000);

  it("compact() performs a real manual compaction (postTokens < preTokens)", async () => {
    const s = openSession({ model: MODEL, permissionMode: "bypassPermissions" });
    try {
      await s.submit("In ~400 words, explain how DNS resolution works end to end.");
      await s.submit("In ~400 words, explain how the TLS 1.3 handshake works.");
      await s.submit("In ~400 words, explain how TCP congestion control works.");
      const outcome = await s.compact();
      expect(outcome.result).toBe("success");
      expect(outcome.postTokens!).toBeLessThan(outcome.preTokens!);
    } finally { await s.dispose(); }
  }, 120_000);

  it("resume round-trip: a new Session resumes the id and recalls context", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "cc-session-live-"));
    let id: string | undefined;
    const first = openSession({ model: MODEL, permissionMode: "bypassPermissions", cwd });
    try {
      await first.submit("Remember this codeword: MANGO9. Reply OK only.");
      id = first.sessionId;
      expect(id).toBeTruthy();
    } finally { await first.dispose(); }
    const second = resumeSession(id!, { model: MODEL, permissionMode: "bypassPermissions", cwd });
    try {
      const r = await second.submit("What codeword did I give you earlier? Reply with just the word.");
      expect(String(r.result)).toMatch(/MANGO9/);
      expect(second.sessionId).toBe(id);                   // resume preserves the id
    } finally {
      await second.dispose();
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 90_000);
});
```

- [ ] **Step 2: Run to verify it skips cleanly (no API key in the implementer env)**

Run: `npx vitest run test/live/session.test.ts`
Expected: the `live(...)` suite is SKIPPED (0 failures). This confirms the gate works. (The keyed pass is run by the controller, who loads `../.env`.)

- [ ] **Step 3: Commit**

```bash
git add test/live/session.test.ts
git commit -m "test(harness): gated live test for the interactive Session primitive (spec 1 task 5)"
```

---

## Self-Review

**1. Spec coverage** (against `2026-06-17-lib-session-primitive-design.md`):
- §4.1 `Session` base + `session_id` capture-once + `.sessionId` getter → Task 1 (Steps 3, plus the two capture tests in Step 1). ✓
- §4.1 `rewind` on the base → Task 1 Step 3 (`rewind` method). ✓
- §4.2 `stream(prompt)` convenience → Task 2. ✓
- §4.3 `openSession`/`resumeSession` factories running `resolveOptions`; `contextTool`/`compactTool` no-leak → Task 3. ✓
- §4.4 `DaemonSession extends Session`, ctor signature preserved, `.id` kept → Task 1 Steps 5-7. ✓
- §3 public exports → Task 4. ✓
- §7 unit tests (capture-once, FIFO, compact-parse, control surface via inherited methods, resume passthrough, dispose-rejects-inflight, contextTool/compactTool wiring + no-leak) → Tasks 1 & 3. Live tests (sessionId stable, compact, resume round-trip) → Task 5. ✓
- §8 non-goals (no `createHarness`/`resumeHarness` change; no daemon registry/persistence change; no fork) → respected; no task touches those. ✓

**2. Placeholder scan:** No `TBD`/`TODO`/"handle edge cases"/"similar to". Every code step shows complete code; every run step shows the command and expected result. ✓

**3. Type consistency:** `Session` ctor `(deps, options, sessionOpts?)` is used identically in Tasks 1-3 and in the `DaemonSession super(...)` call. `SessionDeps`/`SessionOpts`/`OpenSessionConfig`/`SessionDepsInput` names match across Tasks 1, 3, 4. `submit(prompt, onMessage?)`, `compact(): Promise<CompactOutcome>`, `get sessionId(): string | undefined`, `stream(prompt): AsyncGenerator<unknown>` signatures are consistent between the Produces blocks, the implementations, and the tests. The `withContextTool`/`withCompactTool` tool ids (`mcp__cc-context__GetContextUsage`, `mcp__cc-compact__RequestCompaction`) match the asserted strings. ✓

One cross-task note for the implementer: Task 2 and Task 1 both edit `test/unit/session.test.ts`; Task 2's tests are ADDED inside the existing `describe` block, not a new file.
