# Daemon Core (D1) — In-Process Session Host — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A long-running `cc-harness daemon` process that hosts a pool of persistent `query()` sessions, exposes them for `ps`-style listing + lifecycle (spawn / submit / list / stop / shutdown) over a Unix-domain socket, reaps idle sessions, and shuts down cleanly.

**Architecture:** One supervised Node process. `DaemonSession` = `query()` + the reused `AsyncQueue` (a turn is `submit(prompt, onMessage)` → streamed messages → resolved result). `DaemonSupervisor` owns the session pool + a JSON `SessionRegistry` (one record per session under `~/.claude/cc-daemon/`) + an idle reaper. `DaemonServer` is a `net` UDS listener speaking NDJSON ops; the thin CLI is a client. Every stateful unit takes an injected `query` (DI) so the whole thing unit-tests with zero network.

**Tech Stack:** TypeScript, `@anthropic-ai/claude-agent-sdk`, Node `net`/`fs`, vitest, zod/v4.

**Reference spec:** `docs/superpowers/specs/2026-06-16-daemon-d1-core-design.md`

**Verified premise:** the SDK has **no daemon/server runtime** (grep-confirmed: only per-session `background` agent tasks + `forkSession`/`persistSession`). We build the host ourselves with `query()` as the per-session engine.

**Conventions to match (from `src/swarm/`):**
- Long-lived session = `query({ prompt: asyncQueue, options })`; seed/turns are `userTurn(text)` objects; read-loop wrapped in `.catch(() => {})` so a dead query never rejects teardown.
- DI: inject `query` (the `QueryFn` type) and a `now` clock for testable time.
- Reuse `AsyncQueue` from `../swarm/asyncQueue.js` and `QueryFn` from `../swarm/types.js` (generic primitives that happen to live in `swarm/`; a later refactor may hoist them to `src/util/` — out of scope).

Run all commands from `CC-to-SDK/harness/`. Per task: `npx vitest run <file>` then `npm run typecheck` before committing. Commit to `main` (no branch), no `Co-Authored-By`/attribution.

---

### Task 1: Protocol + types

**Files:**
- Create: `src/daemon/types.ts`
- Test: `test/unit/daemon-types.test.ts`

- [ ] **Step 1: Write the failing test** — create `test/unit/daemon-types.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { daemonOp, DaemonError } from "../../src/daemon/types.js";

describe("daemon protocol", () => {
  it("parses each op and rejects unknown/invalid ops", () => {
    expect(daemonOp.parse({ op: "spawn" }).op).toBe("spawn");
    expect(daemonOp.parse({ op: "spawn", model: "claude-haiku-4-5-20251001" }).model).toBe("claude-haiku-4-5-20251001");
    expect(daemonOp.parse({ op: "submit", id: "sess-1", prompt: "hi" }).prompt).toBe("hi");
    expect(daemonOp.parse({ op: "list" }).op).toBe("list");
    expect(daemonOp.parse({ op: "stop", id: "sess-1" }).id).toBe("sess-1");
    expect(daemonOp.parse({ op: "shutdown" }).op).toBe("shutdown");
    expect(() => daemonOp.parse({ op: "bogus" })).toThrow();
    expect(() => daemonOp.parse({ op: "submit", id: "sess-1" })).toThrow(); // missing prompt
  });
  it("DaemonError is an Error subclass", () => {
    expect(new DaemonError("x")).toBeInstanceOf(Error);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/daemon-types.test.ts`
Expected: FAIL — module `../../src/daemon/types.js` does not exist.

- [ ] **Step 3: Implement `src/daemon/types.ts`**

```ts
import { z } from "zod/v4";

export class DaemonError extends Error {}

export type SessionStatus = "idle" | "busy" | "errored";

export interface SessionRecord {
  id: string;
  daemonPid: number;
  status: SessionStatus;
  model?: string;
  createdAt: number;
  lastActiveAt: number;
}

export interface DaemonOptions {
  dir?: string;            // registry dir (default ~/.claude/cc-daemon/sessions)
  maxSessions?: number;    // default 32
  idleTimeoutMs?: number;  // default 30 min; 0 disables idle reaping
  reapEvery?: number;      // reaper interval ms; default 30_000
  now?: () => number;      // injectable clock (testing)
}

// NDJSON op protocol (one request per client connection).
const spawnOp = z.object({ op: z.literal("spawn"), model: z.string().optional() });
const submitOp = z.object({ op: z.literal("submit"), id: z.string(), prompt: z.string() });
const listOp = z.object({ op: z.literal("list") });
const stopOp = z.object({ op: z.literal("stop"), id: z.string() });
const shutdownOp = z.object({ op: z.literal("shutdown") });

export const daemonOp = z.discriminatedUnion("op", [spawnOp, submitOp, listOp, stopOp, shutdownOp]);
export type DaemonOp = z.infer<typeof daemonOp>;
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run test/unit/daemon-types.test.ts && npm run typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add CC-to-SDK/harness/src/daemon/types.ts CC-to-SDK/harness/test/unit/daemon-types.test.ts
git commit -m "feat(harness): daemon D1 protocol + types"
```

---

### Task 2: SessionRegistry (the `ps` foundation)

**Files:**
- Create: `src/daemon/registry.ts`
- Test: `test/unit/daemon-registry.test.ts`

- [ ] **Step 1: Write the failing test** — create `test/unit/daemon-registry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionRegistry } from "../../src/daemon/registry.js";
import type { SessionRecord } from "../../src/daemon/types.js";

const dir = () => mkdtempSync(join(tmpdir(), "cc-daemon-"));
const rec = (id: string, pid = process.pid): SessionRecord =>
  ({ id, daemonPid: pid, status: "idle", createdAt: 1, lastActiveAt: 1 });

describe("SessionRegistry", () => {
  it("registers, gets, lists (sorted by createdAt), updates, and removes", () => {
    const r = new SessionRegistry({ dir: dir() });
    r.register({ ...rec("sess-2"), createdAt: 20 });
    r.register({ ...rec("sess-1"), createdAt: 10 });
    expect(r.list().map((x) => x.id)).toEqual(["sess-1", "sess-2"]); // createdAt order
    expect(r.get("sess-1")?.status).toBe("idle");
    r.update("sess-1", { status: "busy" });
    expect(r.get("sess-1")?.status).toBe("busy");
    r.remove("sess-1");
    expect(r.get("sess-1")).toBeUndefined();
    expect(r.list().map((x) => x.id)).toEqual(["sess-2"]);
  });
  it("reapStale drops records whose daemonPid is dead", () => {
    const r = new SessionRegistry({ dir: dir(), isAlive: (pid) => pid === 100 });
    r.register({ ...rec("live", 100) });
    r.register({ ...rec("dead", 999) });
    expect(r.reapStale()).toBe(1);
    expect(r.list().map((x) => x.id)).toEqual(["live"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/daemon-registry.test.ts`
Expected: FAIL — `registry.js` does not exist.

- [ ] **Step 3: Implement `src/daemon/registry.ts`**

```ts
import { mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SessionRecord } from "./types.js";

export interface SessionRegistryOptions {
  dir?: string;
  isAlive?: (pid: number) => boolean;
}

function defaultIsAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** JSON record store, one file per session under <dir>/<id>.json — the `ps` foundation (33.3). */
export class SessionRegistry {
  private dir: string;
  private isAlive: (pid: number) => boolean;

  constructor(opts: SessionRegistryOptions = {}) {
    this.dir = opts.dir ?? join(homedir(), ".claude", "cc-daemon", "sessions");
    this.isAlive = opts.isAlive ?? defaultIsAlive;
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
  }

  register(rec: SessionRecord): void {
    writeFileSync(this.path(rec.id), JSON.stringify(rec), { mode: 0o600 });
  }

  update(id: string, patch: Partial<SessionRecord>): void {
    const cur = this.get(id);
    if (cur) this.register({ ...cur, ...patch });
  }

  get(id: string): SessionRecord | undefined {
    try { return JSON.parse(readFileSync(this.path(id), "utf8")) as SessionRecord; } catch { return undefined; }
  }

  list(): SessionRecord[] {
    return readdirSync(this.dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => { try { return JSON.parse(readFileSync(join(this.dir, f), "utf8")) as SessionRecord; } catch { return undefined; } })
      .filter((r): r is SessionRecord => r !== undefined)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  remove(id: string): void { rmSync(this.path(id), { force: true }); }

  /** Drop records whose owning daemon pid is gone (orphaned by a prior crash). Returns the count. */
  reapStale(): number {
    let n = 0;
    for (const r of this.list()) if (!this.isAlive(r.daemonPid)) { this.remove(r.id); n++; }
    return n;
  }

  private path(id: string): string { return join(this.dir, `${id}.json`); }
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run test/unit/daemon-registry.test.ts && npm run typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add CC-to-SDK/harness/src/daemon/registry.ts CC-to-SDK/harness/test/unit/daemon-registry.test.ts
git commit -m "feat(harness): daemon SessionRegistry (ps foundation + stale reaping)"
```

---

### Task 3: DaemonSession (one hosted query)

**Files:**
- Create: `src/daemon/session.ts`
- Test: `test/unit/daemon-session.test.ts`

- [ ] **Step 1: Write the failing test** — create `test/unit/daemon-session.test.ts`. The fake query yields an assistant message + a result per pushed turn:

```ts
import { describe, it, expect } from "vitest";
import { DaemonSession } from "../../src/daemon/session.js";

function fakeQuery({ prompt }: any) {
  return (async function* () {
    for await (const turn of prompt) {
      const text = turn.message.content;
      yield { type: "assistant", message: { content: [{ type: "text", text: "ack:" + text }] } };
      yield { type: "result", subtype: "success", result: "did:" + text };
    }
  })();
}

describe("DaemonSession", () => {
  it("submit streams non-result messages then resolves with the turn result", async () => {
    const chunks: any[] = [];
    const s = new DaemonSession("sess-1", { query: fakeQuery }, {});
    const r = await s.submit("hello", (m) => chunks.push(m));
    expect(r.result).toBe("did:hello");
    expect(chunks.map((c: any) => c.type)).toEqual(["assistant"]); // result is NOT streamed as a chunk
    await s.dispose();
  });
  it("advances lastActiveAt off an injected clock as messages flow", async () => {
    let t = 100;
    const s = new DaemonSession("sess-1", { query: fakeQuery }, {}, () => t);
    expect(s.lastActiveAt).toBe(100);
    t = 250;
    await s.submit("x", () => {});
    expect(s.lastActiveAt).toBe(250);
    await s.dispose();
  });
  it("handles two sequential submits in FIFO order", async () => {
    const s = new DaemonSession("sess-1", { query: fakeQuery }, {});
    expect((await s.submit("a", () => {})).result).toBe("did:a");
    expect((await s.submit("b", () => {})).result).toBe("did:b");
    await s.dispose();
  });
  it("dispose ends the underlying query", async () => {
    let ended = false;
    const fq = ({ prompt }: any) => (async function* () {
      try { for await (const t of prompt) { void t; yield { type: "result", result: "r" }; } } finally { ended = true; }
    })();
    const s = new DaemonSession("sess-1", { query: fq }, {});
    await s.submit("x", () => {});
    await s.dispose();
    expect(ended).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/daemon-session.test.ts`
Expected: FAIL — `session.js` does not exist.

- [ ] **Step 3: Implement `src/daemon/session.ts`**

```ts
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { AsyncQueue } from "../swarm/asyncQueue.js";
import type { QueryFn } from "../swarm/types.js";

export interface DaemonSessionDeps { query: QueryFn; }

function userTurn(text: string): SDKUserMessage {
  return { type: "user", message: { role: "user", content: text }, parent_tool_use_id: null } as SDKUserMessage;
}

interface Waiter { onMessage: (m: unknown) => void; resolve: (r: { result: unknown }) => void; }

/** One long-lived query() session. A turn is submit(prompt,onMessage) → streamed messages → resolved result. */
export class DaemonSession {
  readonly id: string;
  lastActiveAt: number;
  private input = new AsyncQueue<SDKUserMessage>();
  private q: AsyncIterable<unknown>;
  private done: Promise<void>;
  private waiters: Waiter[] = []; // FIFO: query emits one result per submitted turn, in order

  constructor(id: string, deps: DaemonSessionDeps, options: Record<string, unknown>, private now: () => number = Date.now) {
    this.id = id;
    this.lastActiveAt = now();
    this.q = deps.query({ prompt: this.input, options });
    // A dead/errored query must not reject teardown (dispose awaits this).
    this.done = this.readLoop().catch(() => {});
  }

  /** Run one turn; non-result messages stream to onMessage; resolves with the turn's result. */
  submit(prompt: string, onMessage: (m: unknown) => void): Promise<{ result: unknown }> {
    return new Promise((resolve) => {
      this.waiters.push({ onMessage, resolve });
      this.input.push(userTurn(prompt));
    });
  }

  /** End the query (in-flight turn finishes) and wait for the read-loop. */
  async dispose(): Promise<void> { this.input.close(); await this.done; }

  private async readLoop(): Promise<void> {
    try {
      for await (const m of this.q) {
        this.lastActiveAt = this.now();
        const w = this.waiters[0];
        if ((m as any).type === "result") { this.waiters.shift(); w?.resolve({ result: (m as any).result }); }
        else w?.onMessage(m);
      }
    } finally {
      for (const w of this.waiters.splice(0)) w.resolve({ result: undefined }); // release callers on teardown
    }
  }
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run test/unit/daemon-session.test.ts && npm run typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add CC-to-SDK/harness/src/daemon/session.ts CC-to-SDK/harness/test/unit/daemon-session.test.ts
git commit -m "feat(harness): DaemonSession — one hosted query() turn-streamed via submit"
```

---

### Task 4: DaemonSupervisor (pool + lifecycle + idle reaper)

**Files:**
- Create: `src/daemon/supervisor.ts`
- Test: `test/unit/daemon-supervisor.test.ts`

- [ ] **Step 1: Write the failing test** — create `test/unit/daemon-supervisor.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonSupervisor } from "../../src/daemon/supervisor.js";
import { DaemonError } from "../../src/daemon/types.js";

const dir = () => mkdtempSync(join(tmpdir(), "cc-daemon-"));
function fakeQuery({ prompt }: any) {
  return (async function* () { for await (const t of prompt) yield { type: "result", result: "did:" + t.message.content }; })();
}

describe("DaemonSupervisor", () => {
  it("spawn registers an idle record; submit flips busy→idle and returns the result", async () => {
    const sup = new DaemonSupervisor({ query: fakeQuery }, { dir: dir() });
    const id = sup.spawn({ model: "m1" });
    expect(sup.list()).toEqual([expect.objectContaining({ id, status: "idle", model: "m1" })]);
    const r = await sup.submit(id, "hi", () => {});
    expect(r.result).toBe("did:hi");
    expect(sup.list()[0].status).toBe("idle");
    await sup.shutdown();
  });
  it("enforces maxSessions and throws on unknown ids", async () => {
    const sup = new DaemonSupervisor({ query: fakeQuery }, { dir: dir(), maxSessions: 1 });
    sup.spawn();
    expect(() => sup.spawn()).toThrow(DaemonError);
    await expect(sup.submit("ghost", "x", () => {})).rejects.toThrow(/unknown session/);
    await expect(sup.stop("ghost")).rejects.toThrow(/unknown session/);
    await sup.shutdown();
  });
  it("stop disposes the session and removes its record", async () => {
    const sup = new DaemonSupervisor({ query: fakeQuery }, { dir: dir() });
    const id = sup.spawn();
    await sup.stop(id);
    expect(sup.list()).toEqual([]);
    await sup.shutdown();
  });
  it("reapIdle stops sessions idle past the timeout (injected clock)", async () => {
    let t = 1000;
    const sup = new DaemonSupervisor({ query: fakeQuery }, { dir: dir(), idleTimeoutMs: 500, now: () => t });
    const id = sup.spawn();
    t = 1400; await sup.reapIdle();           // 400ms idle < 500 → kept
    expect(sup.list().map((s) => s.id)).toEqual([id]);
    t = 1600; await sup.reapIdle();           // 600ms idle > 500 → reaped
    expect(sup.list()).toEqual([]);
    await sup.shutdown();
  });
  it("shutdown disposes all sessions and clears the registry", async () => {
    const sup = new DaemonSupervisor({ query: fakeQuery }, { dir: dir() });
    sup.spawn(); sup.spawn();
    await sup.shutdown();
    expect(sup.list()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/daemon-supervisor.test.ts`
Expected: FAIL — `supervisor.js` does not exist.

- [ ] **Step 3: Implement `src/daemon/supervisor.ts`**

```ts
import { SessionRegistry } from "./registry.js";
import { DaemonSession } from "./session.js";
import { DaemonError } from "./types.js";
import type { DaemonOptions, SessionRecord } from "./types.js";
import type { QueryFn } from "../swarm/types.js";

export interface DaemonDeps { query: QueryFn; }

/** Owns the in-process session pool + the registry + an idle reaper. */
export class DaemonSupervisor {
  private pool = new Map<string, DaemonSession>();
  private registry: SessionRegistry;
  private seq = 0;
  private maxSessions: number;
  private idleTimeoutMs: number;
  private now: () => number;
  private reaper?: ReturnType<typeof setInterval>;

  constructor(private deps: DaemonDeps, opts: DaemonOptions = {}) {
    this.registry = new SessionRegistry({ dir: opts.dir });
    this.maxSessions = opts.maxSessions ?? 32;
    this.idleTimeoutMs = opts.idleTimeoutMs ?? 30 * 60_000;
    this.now = opts.now ?? Date.now;
    this.registry.reapStale(); // clear records orphaned by a prior crash
    if (this.idleTimeoutMs > 0) {
      this.reaper = setInterval(() => { void this.reapIdle(); }, opts.reapEvery ?? 30_000);
      this.reaper.unref?.(); // don't keep the process alive for the reaper
    }
  }

  spawn(opts: { model?: string } = {}): string {
    if (this.pool.size >= this.maxSessions) throw new DaemonError(`max sessions (${this.maxSessions}) reached`);
    const id = `sess-${++this.seq}`;
    const session = new DaemonSession(id, { query: this.deps.query }, opts.model ? { model: opts.model } : {}, this.now);
    this.pool.set(id, session);
    const t = this.now();
    this.registry.register({ id, daemonPid: process.pid, status: "idle", model: opts.model, createdAt: t, lastActiveAt: t });
    return id;
  }

  async submit(id: string, prompt: string, onMessage: (m: unknown) => void): Promise<{ result: unknown }> {
    const session = this.pool.get(id);
    if (!session) throw new DaemonError(`unknown session ${id}`);
    this.registry.update(id, { status: "busy" });
    try {
      const r = await session.submit(prompt, onMessage);
      this.registry.update(id, { status: "idle", lastActiveAt: session.lastActiveAt });
      return r;
    } catch (e) {
      this.registry.update(id, { status: "errored" });
      throw e;
    }
  }

  list(): SessionRecord[] { return this.registry.list(); }

  async stop(id: string): Promise<void> {
    const session = this.pool.get(id);
    if (!session) throw new DaemonError(`unknown session ${id}`);
    await session.dispose();
    this.pool.delete(id);
    this.registry.remove(id);
  }

  async shutdown(): Promise<void> {
    if (this.reaper) clearInterval(this.reaper);
    await Promise.all([...this.pool].map(async ([id, s]) => { await s.dispose(); this.registry.remove(id); }));
    this.pool.clear();
  }

  /** Stop sessions whose last activity is older than the idle timeout. Public + async so the reaper
   * fires it (void) and tests can await it deterministically. */
  async reapIdle(): Promise<void> {
    const cutoff = this.now() - this.idleTimeoutMs;
    const stale = [...this.pool].filter(([, s]) => s.lastActiveAt < cutoff).map(([id]) => id);
    await Promise.all(stale.map((id) => this.stop(id)));
  }
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run test/unit/daemon-supervisor.test.ts && npm run typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add CC-to-SDK/harness/src/daemon/supervisor.ts CC-to-SDK/harness/test/unit/daemon-supervisor.test.ts
git commit -m "feat(harness): DaemonSupervisor — session pool, lifecycle, idle reaper"
```

---

### Task 5: DaemonServer + client (UDS NDJSON) — integration test

**Files:**
- Create: `src/daemon/server.ts`
- Create: `src/daemon/client.ts`
- Test: `test/unit/daemon-server.test.ts`

- [ ] **Step 1: Write the failing integration test** — create `test/unit/daemon-server.test.ts`. Real UDS socket, fake query:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonSupervisor } from "../../src/daemon/supervisor.js";
import { DaemonServer } from "../../src/daemon/server.js";
import { daemonRequest } from "../../src/daemon/client.js";

const tmp = () => mkdtempSync(join(tmpdir(), "cc-daemon-"));
function fakeQuery({ prompt }: any) {
  return (async function* () {
    for await (const turn of prompt) {
      yield { type: "assistant", message: { content: [{ type: "text", text: "ack" }] } };
      yield { type: "result", result: "did:" + turn.message.content };
    }
  })();
}

describe("DaemonServer over a real UDS", () => {
  it("round-trips spawn → submit (streamed) → list → stop → shutdown", async () => {
    const d = tmp();
    const sock = join(d, "sock");
    const sup = new DaemonSupervisor({ query: fakeQuery }, { dir: join(d, "sessions") });
    const server = new DaemonServer(sup, sock);
    await server.listen();

    const spawn = await daemonRequest(sock, { op: "spawn", model: "m1" });
    const id = spawn[0].id;
    expect(spawn[0]).toEqual({ ok: true, id });

    const lines: any[] = [];
    await daemonRequest(sock, { op: "submit", id, prompt: "hi" }, (o) => lines.push(o));
    expect(lines.find((l) => l.type === "chunk")).toBeTruthy();
    expect(lines.find((l) => l.type === "done")?.result).toBe("did:hi");

    const list = await daemonRequest(sock, { op: "list" });
    expect(list[0].sessions.map((s: any) => s.id)).toEqual([id]);

    expect((await daemonRequest(sock, { op: "stop", id }))[0]).toEqual({ ok: true });
    expect((await daemonRequest(sock, { op: "list" }))[0].sessions).toEqual([]);

    await daemonRequest(sock, { op: "shutdown" });
    await server.closed;
  });
  it("refuses to start a second daemon on a live socket", async () => {
    const d = tmp();
    const sock = join(d, "sock");
    const a = new DaemonServer(new DaemonSupervisor({ query: fakeQuery }, { dir: join(d, "s1") }), sock);
    await a.listen();
    const b = new DaemonServer(new DaemonSupervisor({ query: fakeQuery }, { dir: join(d, "s2") }), sock);
    await expect(b.listen()).rejects.toThrow(/already running/);
    await a.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/daemon-server.test.ts`
Expected: FAIL — `server.js` / `client.js` do not exist.

- [ ] **Step 3: Implement `src/daemon/client.ts`**

```ts
import { connect } from "node:net";

/** Send one NDJSON op over the daemon UDS; resolve with all response lines (onLine streams them live). */
export function daemonRequest(socketPath: string, op: unknown, onLine?: (o: unknown) => void): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const lines: any[] = [];
    let buf = "";
    const sock = connect(socketPath);
    sock.on("connect", () => sock.write(JSON.stringify(op) + "\n"));
    sock.on("data", (d) => {
      buf += d.toString("utf8");
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        if (!line) continue;
        const o = JSON.parse(line); lines.push(o); onLine?.(o);
      }
    });
    sock.on("end", () => resolve(lines));
    sock.on("close", () => resolve(lines)); // daemon may close after shutdown without a clean end
    sock.on("error", reject);
  });
}
```

- [ ] **Step 4: Implement `src/daemon/server.ts`**

```ts
import { createServer, connect } from "node:net";
import type { Server, Socket } from "node:net";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { daemonOp } from "./types.js";
import type { DaemonSupervisor } from "./supervisor.js";

/** UDS listener speaking the NDJSON op protocol; routes ops to a DaemonSupervisor. */
export class DaemonServer {
  private server: Server;
  private closeResolve!: () => void;
  readonly closed: Promise<void> = new Promise((r) => { this.closeResolve = r; });

  constructor(private supervisor: DaemonSupervisor, private socketPath: string) {
    this.server = createServer((sock) => this.onConnection(sock));
  }

  async listen(): Promise<void> {
    await this.ensureFreeSocket();
    mkdirSync(dirname(this.socketPath), { recursive: true, mode: 0o700 });
    await new Promise<void>((resolve, reject) => {
      const onErr = (e: Error) => reject(e);
      this.server.once("error", onErr);
      this.server.listen(this.socketPath, () => { this.server.off("error", onErr); resolve(); });
    });
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
    rmSync(this.socketPath, { force: true });
    this.closeResolve();
  }

  /** Single-daemon invariant: refuse if a live daemon answers; clear a stale socket otherwise. */
  private async ensureFreeSocket(): Promise<void> {
    if (!existsSync(this.socketPath)) return;
    const alive = await new Promise<boolean>((resolve) => {
      const c = connect(this.socketPath)
        .on("connect", () => { c.destroy(); resolve(true); })
        .on("error", () => resolve(false));
    });
    if (alive) throw new Error(`daemon already running at ${this.socketPath}`);
    rmSync(this.socketPath, { force: true });
  }

  private onConnection(sock: Socket): void {
    let buf = "";
    const onData = (d: Buffer) => {
      buf += d.toString("utf8");
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      sock.off("data", onData);              // one op per connection (first line)
      void this.handle(sock, buf.slice(0, nl));
    };
    sock.on("data", onData);
    sock.on("error", () => {});               // ignore client-side resets
  }

  private async handle(sock: Socket, line: string): Promise<void> {
    const send = (o: unknown) => sock.write(JSON.stringify(o) + "\n");
    let op;
    try { op = daemonOp.parse(JSON.parse(line)); }
    catch (e) { send({ ok: false, error: `bad request: ${(e as Error).message}` }); sock.end(); return; }
    try {
      switch (op.op) {
        case "spawn": send({ ok: true, id: this.supervisor.spawn({ model: op.model }) }); sock.end(); break;
        case "list": send({ ok: true, sessions: this.supervisor.list() }); sock.end(); break;
        case "stop": await this.supervisor.stop(op.id); send({ ok: true }); sock.end(); break;
        case "submit": {
          const r = await this.supervisor.submit(op.id, op.prompt, (m) => send({ type: "chunk", message: m }));
          send({ type: "done", result: r.result }); sock.end(); break;
        }
        case "shutdown":
          send({ ok: true }); sock.end();
          await this.supervisor.shutdown();
          await this.close();
          break;
      }
    } catch (e) { send({ ok: false, error: (e as Error).message }); sock.end(); }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/unit/daemon-server.test.ts && npm run typecheck`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add CC-to-SDK/harness/src/daemon/server.ts CC-to-SDK/harness/src/daemon/client.ts CC-to-SDK/harness/test/unit/daemon-server.test.ts
git commit -m "feat(harness): DaemonServer + client — UDS NDJSON op protocol"
```

---

### Task 6: CLI subcommands + public exports

**Files:**
- Create: `src/daemon/index.ts`
- Create: `src/daemon/paths.ts`
- Modify: `src/index.ts`
- Modify: `src/cli.ts`
- Test: `test/unit/daemon-paths.test.ts`

- [ ] **Step 1: Write the failing test** — create `test/unit/daemon-paths.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { daemonSocketPath } from "../../src/daemon/paths.js";

describe("daemonSocketPath", () => {
  it("honors CC_DAEMON_SOCK override, else defaults under ~/.claude/cc-daemon", () => {
    expect(daemonSocketPath({ CC_DAEMON_SOCK: "/tmp/x.sock" })).toBe("/tmp/x.sock");
    expect(daemonSocketPath({ HOME: "/home/u" })).toBe("/home/u/.claude/cc-daemon/sock");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/daemon-paths.test.ts`
Expected: FAIL — `paths.js` does not exist.

- [ ] **Step 3: Implement `src/daemon/paths.ts`**

```ts
import { homedir } from "node:os";
import { join } from "node:path";

/** Default daemon socket path, overridable via CC_DAEMON_SOCK (env injectable for tests). */
export function daemonSocketPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.CC_DAEMON_SOCK) return env.CC_DAEMON_SOCK;
  const home = env.HOME ?? homedir();
  return join(home, ".claude", "cc-daemon", "sock");
}
```

- [ ] **Step 4: Implement `src/daemon/index.ts`**

```ts
export { SessionRegistry } from "./registry.js";
export { DaemonSession } from "./session.js";
export { DaemonSupervisor } from "./supervisor.js";
export { DaemonServer } from "./server.js";
export { daemonRequest } from "./client.js";
export { daemonSocketPath } from "./paths.js";
export { DaemonError } from "./types.js";
export type { SessionRecord, SessionStatus, DaemonOptions, DaemonOp } from "./types.js";
```

- [ ] **Step 5: Extend `src/index.ts`** — add after the swarm exports:

```ts
export { DaemonSupervisor, DaemonServer, SessionRegistry, daemonRequest, daemonSocketPath, DaemonError } from "./daemon/index.js";
export type { SessionRecord, SessionStatus, DaemonOptions } from "./daemon/index.js";
```

- [ ] **Step 6: Add subcommand routing to `src/cli.ts`** — at the top of `main()`, before the existing single-shot path, branch on the first arg. Insert after `const argv = process.argv.slice(2);` (introduce that binding) and route `daemon` / `ps` / `submit` to the daemon, leaving the existing prompt path as the default:

```ts
import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import { DaemonSupervisor } from "./daemon/supervisor.js";
import { DaemonServer } from "./daemon/server.js";
import { daemonRequest } from "./daemon/client.js";
import { daemonSocketPath } from "./daemon/paths.js";

async function runDaemon(): Promise<void> {
  const sock = daemonSocketPath();
  const sup = new DaemonSupervisor({ query: sdkQuery }, {});
  const server = new DaemonServer(sup, sock);
  await server.listen();
  const stop = async () => { await sup.shutdown().catch(() => {}); await server.close().catch(() => {}); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  console.error(`cc-harness daemon listening at ${sock}`);
  await server.closed; // resolves on `shutdown` op or signal
}

async function daemonCli(args: string[]): Promise<boolean> {
  const sock = daemonSocketPath();
  if (args[0] === "daemon" && args[1] === "stop") { await daemonRequest(sock, { op: "shutdown" }); return true; }
  if (args[0] === "daemon") { await runDaemon(); return true; }
  if (args[0] === "ps") {
    const [{ sessions }] = await daemonRequest(sock, { op: "list" });
    for (const s of sessions) console.log(`${s.id}\t${s.status}\t${s.model ?? "-"}`);
    return true;
  }
  if (args[0] === "submit") {
    await daemonRequest(sock, { op: "submit", id: args[1], prompt: args.slice(2).join(" ") }, (o: any) => {
      if (o.type === "chunk") for (const b of o.message?.message?.content ?? []) if (b.type === "text") process.stdout.write(b.text);
      else if (o.type === "done") process.stdout.write("\n");
    });
    return true;
  }
  return false;
}
```

Then in `main()`, before composing the prompt:

```ts
  const argv = process.argv.slice(2);
  if (await daemonCli(argv)) return;
```

(The existing `parseArgs(process.argv.slice(2))` / prompt flow stays as the default branch for non-daemon invocations.)

- [ ] **Step 7: Run paths test + typecheck**

Run: `npx vitest run test/unit/daemon-paths.test.ts && npm run typecheck`
Expected: PASS, clean. **Coverage note:** the `cli.ts` subcommand routing is a thin wrapper over already-tested units (`daemonRequest`, `DaemonSupervisor`, `DaemonServer`); only `daemonSocketPath` is unit-tested here. A subprocess-level CLI smoke test (spawning the `daemon` then `ps`/`submit`) is deliberately deferred — it's heavy/flaky and adds little over the library tests. Manually smoke it once: `npx tsx src/cli.ts daemon &` then `npx tsx src/cli.ts ps`.

- [ ] **Step 8: Commit**

```bash
git add CC-to-SDK/harness/src/daemon/index.ts CC-to-SDK/harness/src/daemon/paths.ts CC-to-SDK/harness/src/index.ts CC-to-SDK/harness/src/cli.ts CC-to-SDK/harness/test/unit/daemon-paths.test.ts
git commit -m "feat(harness): daemon CLI subcommands (daemon/ps/submit) + public exports"
```

---

### Task 7: Live end-to-end test (real SDK, gated on ANTHROPIC_API_KEY)

**Files:**
- Create: `test/live/daemon.test.ts`

- [ ] **Step 1: Write the live test** — create `test/live/daemon.test.ts`. Real `query`, real UDS, in-process server:

```ts
import { describe, it, expect } from "vitest";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonSupervisor } from "../../src/daemon/supervisor.js";
import { DaemonServer } from "../../src/daemon/server.js";
import { daemonRequest } from "../../src/daemon/client.js";

const live = process.env.ANTHROPIC_API_KEY ? describe : describe.skip;

live("live daemon (real SDK)", () => {
  it("hosts a real session: spawn → submit → streamed PONG result", async () => {
    const d = mkdtempSync(join(tmpdir(), "cc-daemon-live-"));
    const sock = join(d, "sock");
    const sup = new DaemonSupervisor({ query }, { dir: join(d, "sessions") });
    const server = new DaemonServer(sup, sock);
    await server.listen();

    const id = (await daemonRequest(sock, { op: "spawn" }))[0].id;
    const lines: any[] = [];
    await daemonRequest(
      sock,
      { op: "submit", id, prompt: "Reply with exactly the single word PONG and nothing else. Do not use any tools." },
      (o) => lines.push(o),
    );
    const done = lines.find((l) => l.type === "done");
    expect(String(done?.result)).toMatch(/PONG/i);

    await daemonRequest(sock, { op: "shutdown" });
    await server.closed;
  }, 60_000);
});
```

- [ ] **Step 2: Run the live test**

Run: `node --env-file=../.env node_modules/.bin/vitest run test/live/daemon.test.ts`
Expected: PASS — a real SDK session is hosted by the daemon and returns `PONG` over the socket. If it fails to stream a `done`, inspect (don't silence) — it's a real integration finding.

- [ ] **Step 3: Commit**

```bash
git add CC-to-SDK/harness/test/live/daemon.test.ts
git commit -m "test(harness): live daemon end-to-end (real SDK session over UDS)"
```

---

### Final verification (after all tasks)

- [ ] Full unit suite: `npm run test:unit` — expect all green (prior 145 + the new daemon tests).
- [ ] `npm run typecheck` — clean.
- [ ] `git status` — clean tree, no scratch files, no `.env`.
- [ ] Then invoke **superpowers:finishing-a-development-branch**.

**Spec-coverage check:** Task 1 ⇒ §4 types + §8 protocol; Task 2 ⇒ §5 registry; Task 3 ⇒ §6 session; Task 4 ⇒ §7 supervisor + idle reaper; Task 5 ⇒ §8 IPC + §9 stale-socket/error handling; Task 6 ⇒ §4 CLI/exports; Task 7 ⇒ §10 live. Success criteria §11 are exercised by Tasks 4–5 (lifecycle + socket) and 7 (real session end-to-end).
