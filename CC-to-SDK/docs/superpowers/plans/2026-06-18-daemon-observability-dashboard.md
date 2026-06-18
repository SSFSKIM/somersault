# Daemon Observability Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `cc-harness top` — a read-only, auto-refreshing terminal dashboard that attaches to a running `cc-harness` daemon over its UDS op protocol and renders the live session pool (id, status, model, context %, token usage, age) plus the proactive-heartbeat state.

**Architecture:** A self-contained `src/monitor/` module — a pure snapshot collector (`collect`) over a tiny injected daemon-client interface, a pure string renderer (`render`), a thin real `daemonRequest` adapter (`daemonMonitorClient`), and a lifecycle loop with idempotent teardown (`runMonitor`) — wired to a new `cc-harness top` CLI subcommand. One surgical change outside the module enriches the daemon `list` *response* with each session's proactive status (no `SessionRecord`/op change). Polling is forced by the wire (one request per connection, no push).

**Tech Stack:** TypeScript (ESM, `.js` specifiers), Node `net` UDS, Vitest (DI, keyless unit + real-UDS integration; one gated live e2e). No new runtime dependencies (no Ink/React).

## Global Constraints

Copy these verbatim into every task's working context:

- **Run all commands from `CC-to-SDK/harness/`.** Typecheck: `npm run typecheck`. One test file: `npx vitest run test/unit/<file>`.
- **Dense hand-style, NO Prettier.** Match the surrounding code (compact, multi-statement lines where the file already does so). Do not reformat existing code.
- **ESM:** every import specifier ends in `.js` (e.g. `from "./snapshot.js"`) even though sources are `.ts`.
- **DI-by-deps:** inject IO/SDK functions (client, `out`, `input`, `now`, `schedule`) so unit tests run keyless with fakes; mirror the existing `deps = { ... }` / options-object default-param pattern. Never hit the network in a unit test.
- **TDD:** failing test → run red → minimal impl → run green → `npm run typecheck`. New behavior gets a test.
- **`src/monitor/` stays CLI-internal.** Do **NOT** add any monitor export to `src/index.ts` — the frozen 44-export public surface (pinned by `test/unit/index.test.ts`) must not change. If `index.test.ts` runs, it must stay green untouched.
- **One surgical change outside `src/monitor/`:** enrich the daemon `list` *response* with proactive status (`src/daemon/server.ts` + a `ListEntry` type in `src/daemon/types.ts`). Do **not** change `SessionRecord`, the op union, or `supervisor.list()`'s return type.
- **Commit to the current branch (`main`); no `Co-Authored-By`/attribution; do NOT push.**
- **Live tests are gated** on `ANTHROPIC_API_KEY` (`const live = process.env.ANTHROPIC_API_KEY ? describe : describe.skip`) and must skip cleanly without a key. The controller runs them; implementers stop at the clean keyless skip.

**Spec:** `CC-to-SDK/docs/superpowers/specs/2026-06-18-daemon-observability-dashboard-design.md`

**Grounding facts (verified against source):**
- `daemonRequest(socketPath, op, onLine?): Promise<any[]>` resolves with all response lines (`src/daemon/client.ts`).
- `{ op: "list" }` → `[{ ok: true, sessions: SessionRecord[] }]`. `SessionRecord` = `{ id, daemonPid, status: "idle"|"busy"|"errored"|"restarting", model?, restart?, sessionId?, createdAt, lastActiveAt, restarts? }` (`src/daemon/types.ts:10`).
- `{ op: "control", id, frame: { type: "context_usage" } }` → `[{ ok: true, usage: <RawContextUsage> }]`. `RawContextUsage = { totalTokens?, maxTokens?, autoCompactThreshold?, isAutoCompactEnabled? }` (`src/context/server.ts:7`). **There is no `percentUsed` field** — compute it: `maxTokens > 0 ? round(totalTokens/maxTokens*100) : undefined` (`src/context/server.ts:18`). A session that has not run a turn errors on this op → treat as no data (`—`).
- `supervisor.proactiveStatus(id): ProactiveStatus | undefined` (`src/daemon/supervisor.ts:224`); `ProactiveStatus = { state: "idle"|"running"|"paused"|"stopped", tickCount, idleCount, errorCount, reason? }` (`src/proactive/types.ts:6`). Returns `undefined` when the session has no proactive loop.
- Default socket: `daemonSocketPath()` → `~/.claude/cc-daemon/sock`, override `CC_DAEMON_SOCK` (`src/daemon/paths.ts`).
- The repo uses **explicit `toEqual`/substring assertions, not vitest snapshots** — render tests assert on golden substrings/lines.

---

### Task 1: Enrich the daemon `list` response with proactive status

**Files:**
- Modify: `src/daemon/types.ts` (add the `ListEntry` type)
- Modify: `src/daemon/server.ts:72` (the `case "list"` handler)
- Test: `test/unit/daemon-list-proactive.test.ts` (create)

**Interfaces:**
- Consumes: `SessionRecord`, `ProactiveStatus` (`src/proactive/types.js`), `DaemonSupervisor.list()`, `DaemonSupervisor.proactiveStatus(id)`.
- Produces: `export type ListEntry = SessionRecord & { proactive?: ProactiveStatus }` in `src/daemon/types.ts`; the `list` wire response now sends `ListEntry[]` (a session with no proactive loop has `proactive` absent/undefined).

- [ ] **Step 1: Write the failing test**

Create `test/unit/daemon-list-proactive.test.ts`:
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
  return (async function* () { for await (const t of prompt) yield { type: "result", result: "did:" + t.message.content }; })();
}

describe("list response carries proactive status", () => {
  it("a session with no proactive loop has proactive=undefined; a started loop reports a state string", async () => {
    const d = tmp(); const sock = join(d, "sock");
    const sup = new DaemonSupervisor({ query: fakeQuery }, { dir: join(d, "sessions") });
    const server = new DaemonServer(sup, sock);
    await server.listen();

    const a = (await daemonRequest(sock, { op: "spawn" }))[0].id;
    const b = (await daemonRequest(sock, { op: "spawn" }))[0].id;
    // start a proactive loop on `a` with a 1h interval so no tick fires during the test
    await daemonRequest(sock, { op: "start_proactive", id: a, config: { intervalMs: 3_600_000 } });

    const { sessions } = (await daemonRequest(sock, { op: "list" }))[0];
    const ea = sessions.find((s: any) => s.id === a);
    const eb = sessions.find((s: any) => s.id === b);
    expect(typeof ea.proactive?.state).toBe("string"); // loop present → a ProactiveStatus
    expect(eb.proactive).toBeUndefined();               // no loop → field absent

    await daemonRequest(sock, { op: "stop_proactive", id: a });
    await daemonRequest(sock, { op: "shutdown" });
    await server.closed;
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/daemon-list-proactive.test.ts`
Expected: FAIL — `ea.proactive` is `undefined` (the `list` handler does not yet attach proactive), so `typeof ea.proactive?.state` is `"undefined"`, not `"string"`.

- [ ] **Step 3: Add the `ListEntry` type**

In `src/daemon/types.ts`, add an import of `ProactiveStatus` at the top (next to the existing imports) and the exported type after the `SessionRecord` interface (after line 20):
```ts
import type { ProactiveStatus } from "../proactive/types.js";
```
```ts
/** A live-pool entry on the wire: a SessionRecord enriched with the session's proactive status (if any). */
export type ListEntry = SessionRecord & { proactive?: ProactiveStatus };
```

- [ ] **Step 4: Enrich the `list` handler**

In `src/daemon/server.ts`, replace the `case "list"` line (currently line 72):
```ts
        case "list": send({ ok: true, sessions: this.supervisor.list() }); sock.end(); break;
```
with:
```ts
        case "list": send({ ok: true, sessions: this.supervisor.list().map((r) => ({ ...r, proactive: this.supervisor.proactiveStatus(r.id) })) }); sock.end(); break;
```

- [ ] **Step 5: Run the test + typecheck + the daemon-server suite**

Run: `npx vitest run test/unit/daemon-list-proactive.test.ts`
Expected: PASS.
Run: `npx vitest run test/unit/daemon-server.test.ts`
Expected: PASS (existing list assertions use `.map(s => s.id)` or assert `[]`, so the added optional field does not break them).
Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/daemon/types.ts src/daemon/server.ts test/unit/daemon-list-proactive.test.ts
git commit -m "feat(daemon): enrich list response with per-session proactive status (ListEntry)"
```

---

### Task 2: `monitor/snapshot.ts` — the collector

**Files:**
- Create: `src/monitor/snapshot.ts`
- Test: `test/unit/monitor-collect.test.ts`

**Interfaces:**
- Consumes: `ListEntry` (`src/daemon/types.js`), `ProactiveState` (`src/proactive/types.js`).
- Produces:
  - `interface MonitorClient { list(): Promise<ListEntry[]>; contextUsage(id: string): Promise<unknown>; }`
  - `interface SessionRow { id: string; status: ListEntry["status"]; model?: string; ctxPercent?: number; tokens?: number; createdAt: number; proactive?: ProactiveState; }`
  - `interface DashboardSnapshot { daemonUp: boolean; sessions: SessionRow[]; proactive?: ProactiveState; at: number; socketPath?: string; }`
  - `interface CollectOpts { now: () => number; socketPath?: string; }`
  - `async function collect(client: MonitorClient, opts: CollectOpts): Promise<DashboardSnapshot>`

- [ ] **Step 1: Write the failing test**

Create `test/unit/monitor-collect.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { collect, type MonitorClient } from "../../src/monitor/snapshot.js";
import type { ListEntry } from "../../src/daemon/types.js";

function clientFrom(entries: ListEntry[], usage: Record<string, unknown | Error>): MonitorClient {
  return {
    list: async () => entries,
    contextUsage: async (id) => { const u = usage[id]; if (u instanceof Error) throw u; return u; },
  };
}
const rec = (over: Partial<ListEntry>): ListEntry =>
  ({ id: "s1", daemonPid: 1, status: "idle", createdAt: 0, lastActiveAt: 0, ...over });

describe("collect", () => {
  it("assembles rows, computes ctx% from totalTokens/maxTokens, aggregates proactive", async () => {
    const entries = [
      rec({ id: "a", status: "busy", model: "opus-4.8", proactive: { state: "running", tickCount: 1, idleCount: 0, errorCount: 0 } }),
      rec({ id: "b", status: "idle", model: "sonnet-4.6", proactive: { state: "paused", tickCount: 0, idleCount: 0, errorCount: 0 } }),
    ];
    const snap = await collect(clientFrom(entries, { a: { totalTokens: 1240, maxTokens: 2000 }, b: { totalTokens: 360, maxTokens: 2000 } }), { now: () => 1000, socketPath: "/s" });
    expect(snap.daemonUp).toBe(true);
    expect(snap.at).toBe(1000);
    expect(snap.sessions.map((r) => [r.id, r.ctxPercent, r.tokens])).toEqual([["a", 62, 1240], ["b", 18, 360]]);
    expect(snap.proactive).toBe("running"); // running outranks paused
  });

  it("skips context_usage for errored sessions and tolerates a usage failure (ctx stays undefined)", async () => {
    const entries = [rec({ id: "e", status: "errored" }), rec({ id: "f", status: "idle" })];
    const snap = await collect(clientFrom(entries, { f: new Error("not started") }), { now: () => 0 });
    expect(snap.sessions.find((r) => r.id === "e")!.ctxPercent).toBeUndefined();
    expect(snap.sessions.find((r) => r.id === "f")!.ctxPercent).toBeUndefined();
    expect(snap.proactive).toBeUndefined(); // no loops present
  });

  it("returns daemonUp=false when list() throws", async () => {
    const client: MonitorClient = { list: async () => { throw new Error("ECONNREFUSED"); }, contextUsage: async () => ({}) };
    const snap = await collect(client, { now: () => 5, socketPath: "/sock" });
    expect(snap).toEqual({ daemonUp: false, sessions: [], proactive: undefined, at: 5, socketPath: "/sock" });
  });

  it("renders ctx undefined when maxTokens is missing or zero", async () => {
    const snap = await collect(clientFrom([rec({ id: "z" })], { z: { totalTokens: 100 } }), { now: () => 0 });
    expect(snap.sessions[0].ctxPercent).toBeUndefined();
    expect(snap.sessions[0].tokens).toBe(100);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/monitor-collect.test.ts`
Expected: FAIL — `Cannot find module ".../src/monitor/snapshot.js"`.

- [ ] **Step 3: Implement `src/monitor/snapshot.ts`**

```ts
import type { ListEntry } from "../daemon/types.js";
import type { ProactiveState } from "../proactive/types.js";

/** The minimal daemon-read surface the dashboard needs (injected → unit-testable without a socket). */
export interface MonitorClient {
  list(): Promise<ListEntry[]>;
  contextUsage(id: string): Promise<unknown>;
}

export interface SessionRow {
  id: string;
  status: ListEntry["status"];
  model?: string;
  ctxPercent?: number;   // computed from totalTokens/maxTokens; undefined when not derivable
  tokens?: number;       // totalTokens from the context_usage payload
  createdAt: number;
  proactive?: ProactiveState;
}

export interface DashboardSnapshot {
  daemonUp: boolean;
  sessions: SessionRow[];
  proactive?: ProactiveState;  // highest-priority proactive state across sessions
  at: number;                  // collection timestamp (drives age rendering)
  socketPath?: string;
}

export interface CollectOpts { now: () => number; socketPath?: string; }

const PROACTIVE_PRIORITY: ProactiveState[] = ["running", "paused", "stopped", "idle"];
function aggregateProactive(states: (ProactiveState | undefined)[]): ProactiveState | undefined {
  const present = states.filter((s): s is ProactiveState => s !== undefined);
  if (!present.length) return undefined;
  return PROACTIVE_PRIORITY.find((p) => present.includes(p));
}

/** Poll the daemon once: list the pool, then fetch per-session context usage. Never throws — a dead daemon
 *  yields { daemonUp: false }; a per-session usage failure leaves that row's ctx undefined. */
export async function collect(client: MonitorClient, opts: CollectOpts): Promise<DashboardSnapshot> {
  let entries: ListEntry[];
  try { entries = await client.list(); }
  catch { return { daemonUp: false, sessions: [], proactive: undefined, at: opts.now(), socketPath: opts.socketPath }; }
  const sessions: SessionRow[] = [];
  for (const e of entries) {
    let ctxPercent: number | undefined, tokens: number | undefined;
    if (e.status !== "errored") {
      try {
        const u = (await client.contextUsage(e.id)) as { totalTokens?: number; maxTokens?: number } | undefined;
        tokens = typeof u?.totalTokens === "number" ? u.totalTokens : undefined;
        ctxPercent = u && typeof u.totalTokens === "number" && typeof u.maxTokens === "number" && u.maxTokens > 0
          ? Math.round((u.totalTokens / u.maxTokens) * 100) : undefined;
      } catch { /* per-session failure → leave ctx/tokens undefined */ }
    }
    sessions.push({ id: e.id, status: e.status, model: e.model, ctxPercent, tokens, createdAt: e.createdAt, proactive: e.proactive?.state });
  }
  return { daemonUp: true, sessions, proactive: aggregateProactive(sessions.map((r) => r.proactive)), at: opts.now(), socketPath: opts.socketPath };
}
```

- [ ] **Step 4: Run the test + typecheck**

Run: `npx vitest run test/unit/monitor-collect.test.ts`
Expected: PASS (all four cases).
Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/monitor/snapshot.ts test/unit/monitor-collect.test.ts
git commit -m "feat(monitor): snapshot collector (collect) over an injected MonitorClient"
```

---

### Task 3: `monitor/render.ts` — the pure renderer

**Files:**
- Create: `src/monitor/render.ts`
- Test: `test/unit/monitor-render.test.ts`

**Interfaces:**
- Consumes: `DashboardSnapshot`, `SessionRow` (`src/monitor/snapshot.js`).
- Produces:
  - `interface ViewState { intervalMs: number; paused: boolean; }`
  - `function render(snap: DashboardSnapshot, view: ViewState): string`

- [ ] **Step 1: Write the failing test**

Create `test/unit/monitor-render.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { render } from "../../src/monitor/render.js";
import type { DashboardSnapshot } from "../../src/monitor/snapshot.js";

const base = (over: Partial<DashboardSnapshot>): DashboardSnapshot =>
  ({ daemonUp: true, sessions: [], proactive: undefined, at: 600_000, socketPath: "/tmp/sock", ...over });
const view = { intervalMs: 1000, paused: false };

describe("render", () => {
  it("populated pool: header counts + a row with status/model/ctx%/tokens/age", () => {
    const snap = base({
      proactive: "running",
      sessions: [
        { id: "s-1a2b", status: "busy", model: "opus-4.8", ctxPercent: 62, tokens: 12400, createdAt: 360_000, proactive: "running" },
        { id: "s-5e6f", status: "errored", model: "haiku-4.5", ctxPercent: undefined, tokens: undefined, createdAt: 540_000, proactive: undefined },
      ],
    });
    const out = render(snap, view);
    expect(out).toContain("daemon: ● up");
    expect(out).toContain("sessions 2");
    expect(out).toContain("proactive ● running");
    expect(out).toMatch(/s-1a2b.*busy.*opus-4\.8.*62%.*12\.4k.*4m/s);
    expect(out).toMatch(/s-5e6f.*err.*—.*—/s);          // errored row shows em-dashes for ctx/usage
    expect(out).toContain("[p]ause");
    expect(out).toContain("[q]uit");
  });

  it("empty pool shows (no sessions)", () => {
    expect(render(base({ sessions: [] }), view)).toContain("(no sessions)");
  });

  it("daemon down shows a waiting line with the socket path", () => {
    const out = render(base({ daemonUp: false, socketPath: "/tmp/sock" }), view);
    expect(out).toContain("daemon: ○ down");
    expect(out).toContain("waiting for daemon at /tmp/sock");
  });

  it("paused footer shows PAUSED", () => {
    expect(render(base({}), { intervalMs: 1000, paused: true })).toContain("PAUSED");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/monitor-render.test.ts`
Expected: FAIL — `Cannot find module ".../src/monitor/render.js"`.

- [ ] **Step 3: Implement `src/monitor/render.ts`**

```ts
import type { DashboardSnapshot, SessionRow } from "./snapshot.js";
import type { ProactiveState } from "../proactive/types.js";

export interface ViewState { intervalMs: number; paused: boolean; }

const STATUS_GLYPH: Record<SessionRow["status"], string> = { busy: "●", idle: "○", errored: "⚠", restarting: "↻" };
const STATUS_WORD: Record<SessionRow["status"], string> = { busy: "busy", idle: "idle", errored: "err", restarting: "restarting" };
const PROACTIVE_GLYPH: Record<ProactiveState, string> = { running: "●", paused: "‖", stopped: "■", idle: "○" };

function humanTokens(n?: number): string { if (n === undefined) return "—"; return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n); }
function humanAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60); if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60); return `${h}h`;
}
function pct(p?: number): string { return p === undefined ? "—" : `${p}%`; }
function pad(s: string, w: number): string { return s.length >= w ? s : s + " ".repeat(w - s.length); }

/** Render the full-screen frame as a string. Pure — no I/O, no escape codes (the loop owns cursor/clear). */
export function render(snap: DashboardSnapshot, view: ViewState): string {
  const lines: string[] = [];
  lines.push(`cc-harness top — ${snap.socketPath ?? ""}`.trimEnd());
  lines.push("─".repeat(56));
  if (!snap.daemonUp) {
    lines.push(`daemon: ○ down — waiting for daemon at ${snap.socketPath ?? "?"}…`);
    lines.push("");
    lines.push(footer(view));
    return lines.join("\n");
  }
  const heartbeat = snap.proactive ? `proactive ${PROACTIVE_GLYPH[snap.proactive]} ${snap.proactive}` : "proactive — none";
  lines.push(`daemon: ● up   sessions ${snap.sessions.length}   ${heartbeat}`);
  lines.push("");
  if (!snap.sessions.length) {
    lines.push("(no sessions)");
  } else {
    lines.push(` ${pad("ID", 9)}${pad("STATUS", 9)}${pad("MODEL", 13)}${pad("CTX%", 7)}${pad("USAGE", 9)}AGE`);
    for (const r of snap.sessions) {
      const status = `${STATUS_GLYPH[r.status]} ${STATUS_WORD[r.status]}`;
      lines.push(` ${pad(r.id, 9)}${pad(status, 9)}${pad(r.model ?? "—", 13)}${pad(pct(r.ctxPercent), 7)}${pad(humanTokens(r.tokens), 9)}${humanAge(snap.at - r.createdAt)}`);
    }
  }
  lines.push("");
  lines.push(footer(view));
  return lines.join("\n");
}

function footer(view: ViewState): string {
  return `refresh ${Math.round(view.intervalMs / 1000)}s · [p]ause [q]uit${view.paused ? "  · PAUSED" : ""}`;
}
```

- [ ] **Step 4: Run the test + typecheck**

Run: `npx vitest run test/unit/monitor-render.test.ts`
Expected: PASS (all four cases). Note the row regexes use the `/s` dotAll flag because columns are space-padded on one line.
Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/monitor/render.ts test/unit/monitor-render.test.ts
git commit -m "feat(monitor): pure frame renderer (render) for the dashboard"
```

---

### Task 4: `monitor/client.ts` — real daemon adapter + keyless real-UDS integration

**Files:**
- Create: `src/monitor/client.ts`
- Test: `test/unit/monitor-client.test.ts`

**Interfaces:**
- Consumes: `MonitorClient`, `collect`, `DashboardSnapshot` (`src/monitor/snapshot.js`); `daemonRequest` (`src/daemon/client.js`); `DaemonSupervisor`/`DaemonServer` (for the integration test).
- Produces: `function daemonMonitorClient(socketPath: string): MonitorClient` — the real adapter that implements `list()` via the `list` op and `contextUsage(id)` via the `control`/`context_usage` frame.

- [ ] **Step 1: Write the failing test**

Create `test/unit/monitor-client.test.ts`. It stands up a real daemon over a real UDS socket with a DI-faked query whose live session exposes `getContextUsage`, then runs `collect` through the real adapter:
```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonSupervisor } from "../../src/daemon/supervisor.js";
import { DaemonServer } from "../../src/daemon/server.js";
import { daemonRequest } from "../../src/daemon/client.js";
import { daemonMonitorClient } from "../../src/monitor/client.js";
import { collect } from "../../src/monitor/snapshot.js";

const tmp = () => mkdtempSync(join(tmpdir(), "cc-daemon-"));
// a session whose live query exposes getContextUsage (so the context_usage control frame returns a payload)
function ctxQuery({ prompt }: any) {
  const gen: any = (async function* () {
    for await (const t of prompt) { yield { type: "system", subtype: "init", session_id: "sdk-1" }; yield { type: "result", result: "did:" + t.message.content }; }
  })();
  gen.getContextUsage = async () => ({ totalTokens: 1000, maxTokens: 5000 });
  return gen;
}

describe("daemonMonitorClient + collect over a real UDS", () => {
  it("round-trips list + context_usage into a snapshot", async () => {
    const d = tmp(); const sock = join(d, "sock");
    const sup = new DaemonSupervisor({ query: ctxQuery }, { dir: join(d, "sessions") });
    const server = new DaemonServer(sup, sock);
    await server.listen();

    const id = (await daemonRequest(sock, { op: "spawn", model: "opus-4.8" }))[0].id;
    await daemonRequest(sock, { op: "submit", id, prompt: "hi" }, () => {}); // open the transport so getContextUsage is live

    const snap = await collect(daemonMonitorClient(sock), { now: () => 0, socketPath: sock });
    expect(snap.daemonUp).toBe(true);
    const row = snap.sessions.find((r) => r.id === id)!;
    expect(row.model).toBe("opus-4.8");
    expect(row.tokens).toBe(1000);
    expect(row.ctxPercent).toBe(20); // 1000/5000

    await daemonRequest(sock, { op: "shutdown" });
    await server.closed;
  });

  it("list() rejects when no daemon is listening → collect reports daemonUp=false", async () => {
    const snap = await collect(daemonMonitorClient(join(tmp(), "absent")), { now: () => 0, socketPath: "absent" });
    expect(snap.daemonUp).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/monitor-client.test.ts`
Expected: FAIL — `Cannot find module ".../src/monitor/client.js"`.

- [ ] **Step 3: Implement `src/monitor/client.ts`**

```ts
import { daemonRequest } from "../daemon/client.js";
import type { MonitorClient } from "./snapshot.js";
import type { ListEntry } from "../daemon/types.js";

/** Real MonitorClient backed by the daemon UDS op protocol. Each method is one short-lived connection.
 *  list() surfaces transport errors (no daemon) by rejecting → collect() maps that to { daemonUp: false }. */
export function daemonMonitorClient(socketPath: string): MonitorClient {
  return {
    async list(): Promise<ListEntry[]> {
      const [res] = await daemonRequest(socketPath, { op: "list" });
      if (!res?.ok) throw new Error(res?.error ?? "list failed");
      return res.sessions as ListEntry[];
    },
    async contextUsage(id: string): Promise<unknown> {
      const [res] = await daemonRequest(socketPath, { op: "control", id, frame: { type: "context_usage" } });
      if (!res?.ok) throw new Error(res?.error ?? "context_usage failed"); // collect() catches → ctx stays undefined
      return res.usage;
    },
  };
}
```

- [ ] **Step 4: Run the test + typecheck**

Run: `npx vitest run test/unit/monitor-client.test.ts`
Expected: PASS (both cases).
Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/monitor/client.ts test/unit/monitor-client.test.ts
git commit -m "feat(monitor): real daemon UDS adapter (daemonMonitorClient) + real-UDS integration test"
```

---

### Task 5: `monitor/app.ts` — the lifecycle loop with idempotent teardown

**Files:**
- Create: `src/monitor/app.ts`
- Test: `test/unit/monitor-app.test.ts`

**Interfaces:**
- Consumes: `MonitorClient`, `collect` (`src/monitor/snapshot.js`); `render`, `ViewState` (`src/monitor/render.js`).
- Produces:
  - `interface MonitorOpts { client: MonitorClient; socketPath?: string; intervalMs?: number; once?: boolean; out?: { write(s: string): void; isTTY?: boolean }; input?: MonitorInput; now?: () => number; schedule?: (fn: () => void, ms: number) => () => void; onSignal?: (h: () => void) => () => void; }`
  - `interface MonitorInput { setRawMode?(b: boolean): void; resume(): void; pause(): void; on(ev: "data", h: (d: Buffer | string) => void): void; off(ev: "data", h: (d: Buffer | string) => void): void; }`
  - `async function runMonitor(opts: MonitorOpts): Promise<void>` — resolves when the user quits (q / Ctrl-C / signal) or, for `once`/non-TTY, after one frame.

Escape sequences (constants in the file): enter alt screen `[?1049h`, hide cursor `[?25l`; per-frame home+clear `[H[2J`; teardown show cursor `[?25h`, leave alt `[?1049l`.

- [ ] **Step 1: Write the failing test**

Create `test/unit/monitor-app.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { runMonitor, type MonitorOpts } from "../../src/monitor/app.js";
import type { MonitorClient } from "../../src/monitor/snapshot.js";

function fakeOut() { const chunks: string[] = []; return { chunks, write: (s: string) => { chunks.push(s); }, isTTY: true }; }
class FakeInput extends EventEmitter {
  raw?: boolean; resumed = false; paused = false;
  setRawMode(b: boolean) { this.raw = b; } resume() { this.resumed = true; } pause() { this.paused = true; }
  key(s: string) { this.emit("data", s); }
}
const okClient = (over: Partial<MonitorClient> = {}): MonitorClient =>
  ({ list: async () => [], contextUsage: async () => ({}), ...over });

// a manual scheduler: captures the tick fn so the test fires ticks deterministically
function manualSchedule() { const fns: Array<() => void> = []; const cancels: number[] = []; let n = 0;
  const schedule = (fn: () => void) => { fns.push(fn); const i = n++; return () => cancels.push(i); };
  return { schedule, fire: () => fns.forEach((f) => f()), cancels };
}

describe("runMonitor", () => {
  it("once / non-TTY: writes exactly one frame, no alt-screen, resolves", async () => {
    const out = fakeOut();
    await runMonitor({ client: okClient(), out, once: true, now: () => 0 });
    const all = out.chunks.join("");
    expect(all).toContain("daemon: ● up");
    expect(all).not.toContain("[?1049h"); // never entered alt screen
  });

  it("live: enters alt screen, renders, and 'q' tears down once (idempotent) and resolves", async () => {
    const out = fakeOut(); const input = new FakeInput(); const sched = manualSchedule();
    const run = runMonitor({ client: okClient(), out, input: input as any, now: () => 0, schedule: sched.schedule });
    // initial frame + alt-screen enter happened synchronously before the first await resolves; let microtasks flush:
    await Promise.resolve();
    input.key("q");
    await run; // resolves on quit
    const all = out.chunks.join("");
    expect(all).toContain("[?1049h");  // entered alt screen
    expect(all).toContain("[?25h");    // restored cursor on teardown
    expect(all).toContain("[?1049l");  // left alt screen on teardown
    expect(input.raw).toBe(false);           // raw mode restored
    expect(sched.cancels.length).toBe(1);    // timer cancelled exactly once
    input.key("q");                          // a second quit is a no-op (no throw, already torn down)
  });

  it("skips a tick while a prior collect is still in flight", async () => {
    let calls = 0; let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const client = okClient({ list: async () => { calls++; await gate; return []; } });
    const out = fakeOut(); const input = new FakeInput(); const sched = manualSchedule();
    const run = runMonitor({ client, out, input: input as any, now: () => 0, schedule: sched.schedule });
    await Promise.resolve();
    sched.fire(); sched.fire();   // two more ticks while the first collect is blocked
    expect(calls).toBe(1);        // in-flight guard: only the initial collect ran
    release();                    // unblock
    input.key("q");
    await run;
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/monitor-app.test.ts`
Expected: FAIL — `Cannot find module ".../src/monitor/app.js"`.

- [ ] **Step 3: Implement `src/monitor/app.ts`**

Derive the escape sequences from `String.fromCharCode(27)` so the source stays ASCII-safe (no invisible bytes); the tests assert on the bracket substrings (e.g. `"[?1049h"`), which `ESC + "[?1049h"` contains. Wire input **synchronously** inside the Promise executor (no `await` before `new Promise` on the live path) so a `q` arriving one microtask later is never missed, and run the immediate paint **and** the first `schedule()` synchronously so the in-flight guard is exercised when a scheduled tick overlaps a slow `collect`.

```ts
import { collect, type MonitorClient, type DashboardSnapshot } from "./snapshot.js";
import { render } from "./render.js";

const ESC = String.fromCharCode(27); // the ASCII escape byte; kept out of the source as a literal
const ALT_ENTER = ESC + "[?1049h", CURSOR_HIDE = ESC + "[?25l", HOME_CLEAR = ESC + "[H" + ESC + "[2J";
const CURSOR_SHOW = ESC + "[?25h", ALT_LEAVE = ESC + "[?1049l";
const CTRL_C = String.fromCharCode(3);

export interface MonitorInput {
  setRawMode?(b: boolean): void;
  resume(): void; pause(): void;
  on(ev: "data", h: (d: Buffer | string) => void): void;
  off(ev: "data", h: (d: Buffer | string) => void): void;
}
export interface MonitorOut { write(s: string): void; isTTY?: boolean; }

export interface MonitorOpts {
  client: MonitorClient;
  socketPath?: string;
  intervalMs?: number;
  once?: boolean;
  out?: MonitorOut;
  input?: MonitorInput;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => () => void;
  onSignal?: (handler: () => void) => () => void; // register a quit handler (e.g. SIGTERM); returns an unregister
}

/** Run the dashboard loop. Resolves when the user quits (q / Ctrl-C / signal), or after one frame for once/non-TTY. */
export async function runMonitor(opts: MonitorOpts): Promise<void> {
  const out = opts.out ?? process.stdout;
  const now = opts.now ?? Date.now;
  const intervalMs = opts.intervalMs ?? 1000;
  const view = { intervalMs, paused: false };

  // One-shot path: a single frame, no alt screen, no input wiring. !out.isTTY catches piped stdout (isTTY undefined).
  if (opts.once || !out.isTTY) {
    out.write(render(await collect(opts.client, { now, socketPath: opts.socketPath }), view) + "\n");
    return;
  }

  const input = opts.input ?? (process.stdin as unknown as MonitorInput);
  const schedule = opts.schedule ?? ((fn, ms) => { const t = setInterval(fn, ms); return () => clearInterval(t); });
  out.write(ALT_ENTER + CURSOR_HIDE);

  // No await before this Promise on the live path -> input is wired before runMonitor yields control.
  return new Promise<void>((resolve) => {
    let tornDown = false, inFlight = false;
    let lastSnap: DashboardSnapshot | undefined;
    let cancel: () => void = () => {};
    let unregisterSignal: (() => void) | undefined;
    const draw = (frame: string) => out.write(HOME_CLEAR + frame);
    const tick = async () => {
      if (inFlight) return;            // in-flight guard: never stack ticks over a slow collect
      inFlight = true;
      try { lastSnap = await collect(opts.client, { now, socketPath: opts.socketPath }); if (!tornDown) draw(render(lastSnap, view)); }
      finally { inFlight = false; }
    };
    const teardown = () => {
      if (tornDown) return;            // idempotent: q + signal + double-q all collapse to one teardown
      tornDown = true;
      cancel();
      input.off("data", onKey);
      input.setRawMode?.(false); input.pause();
      unregisterSignal?.();
      out.write(CURSOR_SHOW + ALT_LEAVE);
      resolve();
    };
    const onKey = (d: Buffer | string) => {
      const s = d.toString();
      if (s === "q" || s === CTRL_C) { teardown(); return; }   // q or Ctrl-C (raw mode delivers ETX as data)
      if (s === "p") {
        view.paused = !view.paused;
        if (view.paused) cancel(); else cancel = schedule(tick, intervalMs);
        if (lastSnap) draw(render(lastSnap, view));   // refresh the footer PAUSED marker without a new poll
      }
    };
    input.setRawMode?.(true); input.resume(); input.on("data", onKey);
    unregisterSignal = opts.onSignal?.(teardown);
    void tick();                              // immediate first paint (fire-and-forget; input already wired)
    cancel = schedule(tick, intervalMs);      // schedule synchronously so overlap exercises the in-flight guard
  });
}
```

- [ ] **Step 4: Run the tests + typecheck**

Run: `npx vitest run test/unit/monitor-app.test.ts`
Expected: PASS (once/non-TTY single frame; alt-screen enter + idempotent teardown on `q`; in-flight tick skip).
Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/monitor/app.ts test/unit/monitor-app.test.ts
git commit -m "feat(monitor): dashboard loop (runMonitor) with immediate paint, pause, idempotent teardown"
```

---

### Task 6: Wire the `cc-harness top` CLI subcommand + gated live e2e

**Files:**
- Modify: `src/cli.ts` (add a `top` branch + flag parsing)
- Test: `test/live/monitor.e2e.test.ts` (create; gated)

**Interfaces:**
- Consumes: `runMonitor` (`src/monitor/app.js`), `daemonMonitorClient` (`src/monitor/client.js`), `daemonSocketPath` (`src/daemon/paths.js`).
- Produces: the `cc-harness top [--socket P] [--interval MS] [--once]` command (returns true from the subcommand dispatcher when handled).

- [ ] **Step 1: Write the failing gated live e2e**

Create `test/live/monitor.e2e.test.ts`. It spins up a real daemon (real SDK session) in-process, runs one `collect`, and asserts the live session surfaces. Gated on `ANTHROPIC_API_KEY`:
```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import { DaemonSupervisor } from "../../src/daemon/supervisor.js";
import { DaemonServer } from "../../src/daemon/server.js";
import { daemonRequest } from "../../src/daemon/client.js";
import { daemonMonitorClient } from "../../src/monitor/client.js";
import { collect } from "../../src/monitor/snapshot.js";

const live = process.env.ANTHROPIC_API_KEY ? describe : describe.skip;
const tmp = () => mkdtempSync(join(tmpdir(), "cc-mon-"));

live("monitor e2e (live daemon)", () => {
  it("collect reflects a real spawned+submitted session with populated ctx", async () => {
    const d = tmp(); const sock = join(d, "sock");
    const sup = new DaemonSupervisor({ query: sdkQuery }, { dir: join(d, "sessions") });
    const server = new DaemonServer(sup, sock);
    await server.listen();
    try {
      const id = (await daemonRequest(sock, { op: "spawn", model: "claude-haiku-4-5-20251001" }))[0].id;
      await daemonRequest(sock, { op: "submit", id, prompt: "say hi in one word" }, () => {});
      const snap = await collect(daemonMonitorClient(sock), { now: () => Date.now(), socketPath: sock });
      const row = snap.sessions.find((r) => r.id === id)!;
      expect(row).toBeTruthy();
      expect(typeof row.tokens).toBe("number"); // real getContextUsage populated tokens after a turn
    } finally {
      await daemonRequest(sock, { op: "shutdown" }).catch(() => {});
      await server.closed;
    }
  });
});
```

- [ ] **Step 2: Run the e2e to verify it skips cleanly without a key**

Run: `npx vitest run test/live/monitor.e2e.test.ts`
Expected: the suite is **skipped** (0 failures) because `ANTHROPIC_API_KEY` is unset. This is the correct keyless result; the controller runs it keyed separately.

- [ ] **Step 3: Wire the `top` subcommand into the CLI**

In `src/cli.ts`, add imports near the existing daemon imports:
```ts
import { runMonitor } from "./monitor/app.js";
import { daemonMonitorClient } from "./monitor/client.js";
```
Then, inside `daemonCli(args)` (the subcommand dispatcher that already handles `daemon`/`ps`/`submit`), add a `top` branch before the final `return false;`:
```ts
  if (args[0] === "top") {
    let socket = daemonSocketPath(); let intervalMs = 1000; let once = false;
    for (let i = 1; i < args.length; i++) {
      const a = args[i];
      if (a === "--socket") socket = args[++i];
      else if (a === "--interval") intervalMs = Number(args[++i]) || intervalMs;
      else if (a === "--once") once = true;
    }
    await runMonitor({ client: daemonMonitorClient(socket), socketPath: socket, intervalMs, once });
    return true;
  }
```
(`daemonSocketPath` is already imported in `cli.ts`. `daemonCli` is `async` and already `await`s daemon ops, so `await runMonitor(...)` fits the existing shape.)

- [ ] **Step 4: Verify the CLI typechecks and `--once` runs against no daemon without hanging**

Run: `npm run typecheck`
Expected: clean.
Run: `npx tsx src/cli.ts top --once --socket /tmp/definitely-absent.sock`
Expected: prints a single "daemon: ○ down — waiting for daemon at /tmp/definitely-absent.sock…" frame and exits 0 (the `once` path renders one frame and returns; `daemonMonitorClient.list()` rejects → `collect` reports `daemonUp:false`). It must **not** hang.

- [ ] **Step 5: Run the full unit suite + typecheck (whole-feature green)**

Run: `npx vitest run test/unit`
Expected: PASS — all monitor tests plus the existing suite (including `test/unit/index.test.ts`, which must be unchanged: the public surface did not grow).
Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts test/live/monitor.e2e.test.ts
git commit -m "feat(cli): cc-harness top subcommand + gated live monitor e2e"
```

---

## Self-Review (controller, before dispatch)

**Spec coverage:**
- §1 goal (read-only auto-refresh pool view) → Tasks 2 (collect) + 3 (render) + 5 (loop) + 6 (CLI).
- §2 grounding (wire facts, ctx% computed not read, proactive gap, swarm out) → encoded in Global Constraints + Task 1 (proactive enrichment) + Task 2 (ctx% computed from totalTokens/maxTokens).
- §3 scope / §8 non-goals (read-only, no nav, no swarm, no Ink, no public export) → no control/nav code anywhere; `index.ts` untouched (Global Constraints + Task 6 Step 5 asserts `index.test.ts` green); no new deps.
- §4.A data flow (poll: 1×list + N×context_usage) → Task 2 `collect` + Task 4 adapter.
- §4.B components (snapshot/render/client/app) → Tasks 2/3/4/5, one file each.
- §4.C the one harness change (enrich list, no SessionRecord/op change) → Task 1.
- §4.D once/non-TTY → Task 5 once-path + Task 6 Step 4.
- §4 column set (id/status/model/ctx%/usage/age + header heartbeat, priority running>paused>stopped>idle) → Task 2 `aggregateProactive` + Task 3 render/glyphs.
- §5 error handling/teardown (daemon-down waiting, per-session `—`, idempotent teardown, in-flight guard, busy-safe ctx) → Task 2 (try/catch) + Task 3 (down/`—` frames) + Task 5 (teardown + in-flight guard).
- §6/§7 testing (render assertions, collect units, lifecycle/teardown, real-UDS integration, gated live) → Tasks 1–6 tests; layers 1–4 keyless (CI), layer 5 gated.

**Placeholder scan:** every step carries real code/commands. The one deliberate two-step (Task 5 Steps 3→4) is called out explicitly with the final pause implementation in Step 4 — the implementer writes the clean form, not the sketch. No TBD/TODO.

**Type consistency:** `MonitorClient`/`SessionRow`/`DashboardSnapshot`/`CollectOpts` (Task 2) are reused verbatim by Tasks 3/4/5; `ListEntry` (Task 1) is consumed by Task 2; `render(snap, view)` + `ViewState` (Task 3) consumed by Task 5; `daemonMonitorClient` (Task 4) + `runMonitor` (Task 5) consumed by Task 6. Field names (`ctxPercent`, `tokens`, `proactive`, `daemonUp`, `at`, `socketPath`) are identical across producer and consumers.
