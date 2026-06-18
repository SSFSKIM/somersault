# Interactive Daemon Console (`cc-harness-console`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the daemon interactive — a terminal console (`cc-harness-console`) that navigates the live session pool, injects prompts (streaming the turn back), and drives control ops — built on a new public `DaemonClient` in the core and an Ink UI in a new `cc-harness-tui` package.

**Architecture:** Two layers. (1) The lean `cc-harness` core gains a typed, Ink-free `DaemonClient` (`connectDaemon`) — a thin wrapper over the already-public `daemonRequest` wire — plus the promoted `collect`/snapshot types, deliberately added to the frozen public surface. (2) A new sibling package `CC-to-SDK/tui/` (`cc-harness-tui`, react + ink) consumes that public API: a `useDaemon` hook owns poll + selection + the active submit stream, and `<Pool>`/`<Detail>`/`<Composer>`/`<StatusBar>`/`<ConfirmDialog>` render a master-detail, modal-focus UI. The lightweight `cc-harness top` (increment 1) is untouched and coexists.

**Tech Stack:** TypeScript (NodeNext ESM), Node `>=18`. Core: zod, `@anthropic-ai/claude-agent-sdk`, vitest. TUI: react 18, ink 5, ink-text-input, ink-testing-library, vitest, tsx.

**Spec:** `CC-to-SDK/docs/superpowers/specs/2026-06-18-interactive-daemon-console-design.md`

## Global Constraints

- **Dense hand-style, NO Prettier.** Match surrounding code (compact, multi-statement lines where the file already does so). Do not reformat existing code.
- **ESM:** import specifiers **end in `.js`** (`from "./types.js"`, `from "./App.js"`) even though sources are `.ts`/`.tsx`. Imports from the `cc-harness` package use the bare specifier `"cc-harness"`.
- **DI-by-deps:** inject functions (transport, scheduler, clock) via default-param/opts so unit tests run without a socket or a TTY. Mirror the existing `deps = { ... }` / `schedule` patterns (`daemon/supervisor.ts`, `monitor/app.ts`).
- **TDD:** failing test → red → minimal impl → green → `typecheck`. Every new export/behavior gets a test. Commit per task.
- **Keep modules small** (<500 LoC; prefer a new module over growing a hot file).
- **`control(id, frame)` RETURNS the raw `ControlResponse`** (`{ok:true,...} | {ok:false,error}`) and does NOT throw on `{ok:false}` — the UI inspects `.ok` and surfaces the error. **Every other `DaemonClient` method THROWS** on `{ok:false}` (callers `try/catch`). `contextUsage` is the one convenience that throws (so `collect` can catch per-session failures, unchanged).
- **The raw `context_usage` payload is `{ totalTokens?, maxTokens? }` — there is NO `percentUsed`.** ctx% is computed inside `collect` (already done in increment 1); never assume a percent field on the wire.
- **The daemon wire is one-request-per-connection (no push)** → the console **polls** `collect` on an interval; there is no server-initiated update.
- **Idempotent teardown** (the recurring teardown-liveness bug class): the poll interval is cancelled exactly once, in-flight async results are dropped after teardown (guarded by a `disposed` flag), and a second teardown is a no-op — with a test that gives this teeth (`cancels.length === 1`).
- **Public-surface discipline:** `cc-harness`'s public API is pinned by `test/unit/index.test.ts`. Only Task 2 adds exports; it updates the pin + `API-STABILITY.md` in the same commit. New exports are tier **advanced-seam**.
- **TUI ↔ core coupling:** `cc-harness-tui` depends on `cc-harness` via `file:../harness`. **`cc-harness` must be built (`cd ../harness && npm run build`) before running TUI `typecheck` or any TUI test** (tsc needs `dist/index.d.ts`; the `useDaemon` hook imports the real `collect` *value*). Rebuild after Tasks 1–2.
- **Git:** commit completed work to the current branch (incl. `main`) without asking; **no `Co-Authored-By`** / attribution lines; **never push / open PRs** without an explicit request.

---

## File Structure

**Layer 1 — core (`CC-to-SDK/harness/`):**
- Create `src/daemon/connect.ts` — `MonitorClient` + `DaemonClient` interfaces and `connectDaemon(socketPath, request?)`. The single home of the daemon client interfaces.
- Modify `src/monitor/snapshot.ts` — drop the local `MonitorClient` definition; import + re-export it from `../daemon/connect.js`. `collect` unchanged.
- Modify `src/monitor/client.ts` — `daemonMonitorClient` delegates to `connectDaemon` (DRY; no duplicated wire logic).
- Modify `src/index.ts` — export `connectDaemon`, `collect`, and the relevant types.
- Modify `test/unit/index.test.ts` — extend the pin (EXPECTED array + an assertion).
- Modify `API-STABILITY.md` — add `connectDaemon`, `collect` rows (advanced-seam).
- Create `test/unit/daemon-client.test.ts` — DI unit + real-UDS integration.

**Layer 2 — new package (`CC-to-SDK/tui/`):**
- Create `package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`.
- Create `src/useDaemon.ts` — the state container hook.
- Create `src/format.ts` — pure `streamLines` operator-grade formatter.
- Create `src/Pool.tsx`, `src/Detail.tsx`, `src/Composer.tsx`, `src/StatusBar.tsx`, `src/ConfirmDialog.tsx`.
- Create `src/App.tsx` — composition + key routing.
- Create `src/cli.tsx` — `cc-harness-console` bin entry.
- Create `test/smoke.test.tsx`, `test/useDaemon.test.tsx`, `test/format.test.ts`, `test/components.test.tsx`, `test/app.test.tsx`, `test/live/console.e2e.test.ts`.

**Docs:** Modify `CC-to-SDK/docs/parity/coverage.md` (Domain 10 row).

---

## Task 1: Core — `connectDaemon` + `DaemonClient`

**Files:**
- Create: `CC-to-SDK/harness/src/daemon/connect.ts`
- Modify: `CC-to-SDK/harness/src/monitor/snapshot.ts:1-8` (replace local `MonitorClient` with a re-export)
- Modify: `CC-to-SDK/harness/src/monitor/client.ts` (delegate to `connectDaemon`)
- Test: `CC-to-SDK/harness/test/unit/daemon-client.test.ts`

**Interfaces:**
- Consumes: `daemonRequest(socketPath, op, onLine?): Promise<any[]>` (`src/daemon/client.js`); `ListEntry`, `RestartPolicy` (`src/daemon/types.js`); `ControlFrame`, `ControlResponse` (`src/bridge/types.js`); `CompactOutcome` (`src/compaction/index.js`); `ProactiveStatus`, `ProactiveConfigInput` (`src/proactive/types.js`).
- Produces:
  - `interface MonitorClient { list(): Promise<ListEntry[]>; contextUsage(id: string): Promise<unknown>; }`
  - `interface DaemonClient extends MonitorClient { submit(id, prompt, onChunk: (m: unknown) => void): Promise<{ result: unknown }>; control(id, frame: ControlFrame): Promise<ControlResponse>; compact(id): Promise<CompactOutcome>; spawn(opts?: { model?: string; restart?: RestartPolicy; resume?: string }): Promise<string>; stop(id): Promise<void>; fork(id): Promise<{ id: string; sessionId?: string }>; startProactive(id, config?: ProactiveConfigInput): Promise<ProactiveStatus>; stopProactive(id): Promise<void>; }`
  - `function connectDaemon(socketPath: string, request?: RequestFn): DaemonClient`

- [ ] **Step 1: Write the failing DI unit test**

Create `CC-to-SDK/harness/test/unit/daemon-client.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { connectDaemon } from "../../src/daemon/connect.js";

type Handler = (op: any, onLine?: (o: any) => void) => any[];
function fakeRequest(handlers: Record<string, Handler>) {
  const calls: any[] = [];
  const fn = async (_sock: string, op: any, onLine?: (o: any) => void) => {
    calls.push(op);
    const h = handlers[op.op];
    return h ? h(op, onLine) : [{ ok: false, error: `no handler for ${op.op}` }];
  };
  return Object.assign(fn, { calls });
}

describe("connectDaemon (DI transport)", () => {
  it("list() sends {op:list} and returns the sessions array", async () => {
    const req = fakeRequest({ list: () => [{ ok: true, sessions: [{ id: "a" }] }] });
    const c = connectDaemon("sock", req);
    expect(await c.list()).toEqual([{ id: "a" }]);
    expect(req.calls[0]).toEqual({ op: "list" });
  });

  it("submit() forwards chunk messages to onChunk and resolves with the done result", async () => {
    const req = fakeRequest({
      submit: (_op, onLine) => {
        const lines = [{ type: "chunk", message: { n: 1 } }, { type: "chunk", message: { n: 2 } }, { type: "done", result: "R" }];
        for (const l of lines) onLine?.(l);
        return lines;
      },
    });
    const c = connectDaemon("sock", req);
    const seen: unknown[] = [];
    const r = await c.submit("id1", "hi", (m) => seen.push(m));
    expect(seen).toEqual([{ n: 1 }, { n: 2 }]);
    expect(r.result).toBe("R");
    expect(req.calls[0]).toEqual({ op: "submit", id: "id1", prompt: "hi" });
  });

  it("control() returns the raw ControlResponse (does NOT throw on ok:false)", async () => {
    const req = fakeRequest({ control: () => [{ ok: false, error: "boom" }] });
    const c = connectDaemon("sock", req);
    expect(await c.control("id1", { type: "interrupt" })).toEqual({ ok: false, error: "boom" });
  });

  it("contextUsage() unwraps usage and throws on ok:false", async () => {
    const ok = connectDaemon("sock", fakeRequest({ control: () => [{ ok: true, usage: { totalTokens: 5 } }] }));
    expect(await ok.contextUsage("id1")).toEqual({ totalTokens: 5 });
    const bad = connectDaemon("sock", fakeRequest({ control: () => [{ ok: false, error: "no usage" }] }));
    await expect(bad.contextUsage("id1")).rejects.toThrow("no usage");
  });

  it("spawn/compact/fork/stop/startProactive/stopProactive map ops and throw on ok:false", async () => {
    const c = connectDaemon("sock", fakeRequest({
      spawn: (op) => [{ ok: true, id: `s-${op.model ?? "d"}` }],
      compact: () => [{ ok: true, outcome: { compacted: true } }],
      fork: () => [{ ok: true, id: "fk", sessionId: "sid" }],
      stop: () => [{ ok: true }],
      start_proactive: () => [{ ok: true, status: { state: "running", tickCount: 0, idleCount: 0, errorCount: 0 } }],
      stop_proactive: () => [{ ok: true }],
    }));
    expect(await c.spawn({ model: "opus" })).toBe("s-opus");
    expect(await c.compact("id1")).toEqual({ compacted: true });
    expect(await c.fork("id1")).toEqual({ id: "fk", sessionId: "sid" });
    await expect(c.stop("id1")).resolves.toBeUndefined();
    expect((await c.startProactive("id1")).state).toBe("running");
    await expect(c.stopProactive("id1")).resolves.toBeUndefined();
    const fail = connectDaemon("sock", fakeRequest({ spawn: () => [{ ok: false, error: "nope" }] }));
    await expect(fail.spawn()).rejects.toThrow("nope");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd CC-to-SDK/harness && npx vitest run test/unit/daemon-client.test.ts`
Expected: FAIL — `Cannot find module '../../src/daemon/connect.js'`.

- [ ] **Step 3: Implement `connectDaemon`**

Create `CC-to-SDK/harness/src/daemon/connect.ts`:

```ts
import { daemonRequest } from "./client.js";
import type { ListEntry, RestartPolicy } from "./types.js";
import type { ControlFrame, ControlResponse } from "../bridge/types.js";
import type { CompactOutcome } from "../compaction/index.js";
import type { ProactiveStatus, ProactiveConfigInput } from "../proactive/types.js";

/** The minimal daemon-read surface collect() needs (injected → unit-testable without a socket). */
export interface MonitorClient {
  list(): Promise<ListEntry[]>;
  contextUsage(id: string): Promise<unknown>;
}

/** The full operator client: the read subset + the drive ops. Each method wraps daemonRequest with the
 *  matching op and throws on { ok:false } — EXCEPT control(), which returns the raw ControlResponse so the
 *  UI can surface { ok:false, error } itself. */
export interface DaemonClient extends MonitorClient {
  submit(id: string, prompt: string, onChunk: (m: unknown) => void): Promise<{ result: unknown }>;
  control(id: string, frame: ControlFrame): Promise<ControlResponse>;
  compact(id: string): Promise<CompactOutcome>;
  spawn(opts?: { model?: string; restart?: RestartPolicy; resume?: string }): Promise<string>;
  stop(id: string): Promise<void>;
  fork(id: string): Promise<{ id: string; sessionId?: string }>;
  startProactive(id: string, config?: ProactiveConfigInput): Promise<ProactiveStatus>;
  stopProactive(id: string): Promise<void>;
}

export type RequestFn = (socketPath: string, op: unknown, onLine?: (o: unknown) => void) => Promise<any[]>;

/** Typed client over the daemon UDS op protocol — a thin wrapper over the already-public daemonRequest
 *  (no protocol duplication). The transport is injectable for unit tests; defaults to the real socket. */
export function connectDaemon(socketPath: string, request: RequestFn = daemonRequest): DaemonClient {
  const one = async (op: unknown): Promise<any> => {
    const [res] = await request(socketPath, op);
    if (!res?.ok) throw new Error(res?.error ?? "daemon op failed");
    return res;
  };
  return {
    async list() { return (await one({ op: "list" })).sessions as ListEntry[]; },
    async contextUsage(id) { return (await one({ op: "control", id, frame: { type: "context_usage" } })).usage; },
    async control(id, frame) { const [res] = await request(socketPath, { op: "control", id, frame }); return res as ControlResponse; },
    async submit(id, prompt, onChunk) {
      const lines = await request(socketPath, { op: "submit", id, prompt }, (o: any) => { if (o?.type === "chunk") onChunk(o.message); });
      const done = lines.find((l: any) => l?.type === "done");
      if (!done) { const err = lines.find((l: any) => l && l.ok === false); throw new Error(err?.error ?? "submit produced no result"); }
      return { result: done.result };
    },
    async compact(id) { return (await one({ op: "compact", id })).outcome as CompactOutcome; },
    async spawn(opts) { return (await one({ op: "spawn", ...(opts ?? {}) })).id as string; },
    async stop(id) { await one({ op: "stop", id }); },
    async fork(id) { const r = await one({ op: "fork", id }); return { id: r.id, sessionId: r.sessionId }; },
    async startProactive(id, config) { return (await one({ op: "start_proactive", id, ...(config ? { config } : {}) })).status as ProactiveStatus; },
    async stopProactive(id) { await one({ op: "stop_proactive", id }); },
  };
}
```

- [ ] **Step 4: Re-point `snapshot.ts` and `client.ts` (DRY — single source for the interfaces)**

In `CC-to-SDK/harness/src/monitor/snapshot.ts`, replace lines 1–8 (the imports + the local `MonitorClient` block):

```ts
import type { ListEntry } from "../daemon/types.js";
import type { ProactiveState } from "../proactive/types.js";
import type { MonitorClient } from "../daemon/connect.js";

/** Re-exported so existing importers (app.ts, client.ts, tests) keep their `./snapshot.js` import. */
export type { MonitorClient } from "../daemon/connect.js";
```

(Leave `SessionRow`, `DashboardSnapshot`, `CollectOpts`, `collect`, and the rest of the file unchanged — `collect` still takes `MonitorClient`.)

Replace the whole body of `CC-to-SDK/harness/src/monitor/client.ts`:

```ts
import { connectDaemon } from "../daemon/connect.js";
import type { MonitorClient } from "./snapshot.js";

/** The read subset of the daemon client, for the read-only `cc-harness top` dashboard. DaemonClient
 *  extends MonitorClient, so connectDaemon's return is a valid MonitorClient. */
export function daemonMonitorClient(socketPath: string): MonitorClient {
  return connectDaemon(socketPath);
}
```

- [ ] **Step 5: Run the DI unit test + typecheck**

Run: `cd CC-to-SDK/harness && npx vitest run test/unit/daemon-client.test.ts && npm run typecheck`
Expected: daemon-client tests PASS; typecheck clean (no error in snapshot/client/monitor consumers).

- [ ] **Step 6: Add the real-UDS integration test**

Append to `CC-to-SDK/harness/test/unit/daemon-client.test.ts`:

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonSupervisor } from "../../src/daemon/supervisor.js";
import { DaemonServer } from "../../src/daemon/server.js";
import { daemonRequest } from "../../src/daemon/client.js";

const tmp = () => mkdtempSync(join(tmpdir(), "cc-daemon-"));
// a fake SDK query exposing setModel + getContextUsage so control round-trips return { ok:true } / a payload
function ctlQuery({ prompt }: any) {
  const gen: any = (async function* () {
    for await (const t of prompt) {
      yield { type: "system", subtype: "init", session_id: "sdk-1" };
      yield { type: "assistant", message: { content: [{ type: "text", text: "ack" }] } };
      yield { type: "result", result: "did:" + t.message.content };
    }
  })();
  gen.setModel = async () => {};
  gen.getContextUsage = async () => ({ totalTokens: 1000, maxTokens: 5000 });
  return gen;
}

describe("connectDaemon over a real UDS", () => {
  it("round-trips spawn → submit (streamed) → control(set_model) → contextUsage", async () => {
    const d = tmp(); const sock = join(d, "sock");
    const sup = new DaemonSupervisor({ query: ctlQuery }, { dir: join(d, "sessions") });
    const server = new DaemonServer(sup, sock);
    await server.listen();
    const { connectDaemon } = await import("../../src/daemon/connect.js");
    const c = connectDaemon(sock);

    const id = await c.spawn({ model: "opus-4.8" });
    const chunks: unknown[] = [];
    const r = await c.submit(id, "hi", (m) => chunks.push(m));
    expect(r.result).toBe("did:hi");
    expect(chunks.length).toBeGreaterThan(0);

    const res = await c.control(id, { type: "set_model", model: "x" });
    expect(res.ok).toBe(true);
    expect(await c.contextUsage(id)).toEqual({ totalTokens: 1000, maxTokens: 5000 });

    await daemonRequest(sock, { op: "shutdown" });
    await server.closed;
  });
});
```

- [ ] **Step 7: Run the full file + typecheck**

Run: `cd CC-to-SDK/harness && npx vitest run test/unit/daemon-client.test.ts && npm run typecheck`
Expected: all daemon-client tests PASS; typecheck clean.

- [ ] **Step 8: Verify the monitor suite still passes (re-point didn't regress)**

Run: `cd CC-to-SDK/harness && npx vitest run test/unit/monitor-client.test.ts test/unit/monitor-collect.test.ts test/unit/monitor-app.test.ts test/unit/monitor-render.test.ts`
Expected: PASS (the `MonitorClient` re-export + `daemonMonitorClient` delegation are behavior-preserving).

- [ ] **Step 9: Commit**

```bash
cd CC-to-SDK/harness
git add src/daemon/connect.ts src/monitor/snapshot.ts src/monitor/client.ts test/unit/daemon-client.test.ts
git commit -m "feat(daemon): connectDaemon + typed DaemonClient over the UDS wire (incr 2)"
```

---

## Task 2: Core — public-API expansion (`connectDaemon`, `collect`)

**Files:**
- Modify: `CC-to-SDK/harness/src/index.ts:12-13` (add exports)
- Modify: `CC-to-SDK/harness/test/unit/index.test.ts` (extend the pin)
- Modify: `CC-to-SDK/harness/API-STABILITY.md` (add rows)

**Interfaces:**
- Consumes: `connectDaemon`, `DaemonClient`, `MonitorClient` (`src/daemon/connect.js`); `collect`, `DashboardSnapshot`, `SessionRow`, `CollectOpts` (`src/monitor/snapshot.js`); `ListEntry` (`src/daemon/types.js`); `ControlFrame`, `ControlResponse` (`src/bridge/types.js`).
- Produces: the public exports `connectDaemon` (value), `collect` (value), and types `DaemonClient`, `MonitorClient`, `DashboardSnapshot`, `SessionRow`, `CollectOpts`, `ListEntry`, `ControlFrame`, `ControlResponse`.

- [ ] **Step 1: Write the failing pin test**

In `CC-to-SDK/harness/test/unit/index.test.ts`, add this `it` block after the hook-builders block (line 33):

```ts
  it("exports the daemon client + dashboard snapshot (advanced-seam, increment 2)", () => {
    expect(typeof api.connectDaemon).toBe("function");
    expect(typeof api.collect).toBe("function");
  });
```

Then add `"collect"` and `"connectDaemon"` to the `EXPECTED` string array (keep it sorted — `"collect"` goes after `"createTaskMcpServer"`... no: alphabetical places `"collect"` before `"createBriefMcpServer"`; insert `"collect"` between `"COMPACT_TOOL"`/`"CONTEXT_TOOL"`/`"DEFAULTS"` ordering and the `c…` lowercase entries. The array is sorted by JS default string sort where uppercase precedes lowercase, so place `"collect"` and `"connectDaemon"` right before `"createBriefMcpServer"`):

```ts
      "COMPACT_TOOL",
      "CONTEXT_TOOL",
      "DEFAULTS",
      "DaemonError",
      "DaemonServer",
      "DaemonSupervisor",
      "HarnessConfigError",
      "KairosAssistant",
      "Session",
      "SwarmError",
      "SwarmRuntime",
      "TaskError",
      "TaskStore",
      "applyAssistantPersona",
      "blockTool",
      "collect",
      "connectDaemon",
      "createBriefMcpServer",
```

(The `Object.keys(api).sort()` assertion sorts with the same comparator, so order only needs to be internally consistent with `Array.prototype.sort()`; the implementer should run the test to confirm exact placement and adjust if vitest reports a mismatch.)

- [ ] **Step 2: Run it to verify it fails**

Run: `cd CC-to-SDK/harness && npx vitest run test/unit/index.test.ts`
Expected: FAIL — `api.connectDaemon` is undefined / EXPECTED array mismatch.

- [ ] **Step 3: Add the exports**

In `CC-to-SDK/harness/src/index.ts`, after line 13 (the daemon type exports), add:

```ts
export { connectDaemon } from "./daemon/connect.js";
export type { DaemonClient, MonitorClient } from "./daemon/connect.js";
export type { ListEntry } from "./daemon/types.js";
export type { ControlFrame, ControlResponse } from "./bridge/types.js";
export { collect } from "./monitor/snapshot.js";
export type { DashboardSnapshot, SessionRow, CollectOpts } from "./monitor/snapshot.js";
```

- [ ] **Step 4: Run the pin test + typecheck + build**

Run: `cd CC-to-SDK/harness && npx vitest run test/unit/index.test.ts && npm run typecheck && npm run build`
Expected: PASS; typecheck clean; build emits `dist/` (proves the public `.d.ts` resolve — required for the TUI package).

- [ ] **Step 5: Update `API-STABILITY.md`**

In `CC-to-SDK/harness/API-STABILITY.md`, add two rows to the table (after the `summarizeUsage` row at line 50):

```markdown
| `connectDaemon` | advanced-seam |
| `collect` | advanced-seam |
```

- [ ] **Step 6: Commit**

```bash
cd CC-to-SDK/harness
git add src/index.ts test/unit/index.test.ts API-STABILITY.md
git commit -m "feat(api): export connectDaemon + collect (advanced-seam, incr 2)"
```

---

## Task 3: TUI — package scaffold + toolchain smoke test

**Files:**
- Create: `CC-to-SDK/tui/package.json`
- Create: `CC-to-SDK/tui/tsconfig.json`
- Create: `CC-to-SDK/tui/tsconfig.build.json`
- Create: `CC-to-SDK/tui/vitest.config.ts`
- Create: `CC-to-SDK/tui/.gitignore`
- Test: `CC-to-SDK/tui/test/smoke.test.tsx`

**Interfaces:**
- Produces: a buildable `cc-harness-tui` package where `npm run typecheck` and `npx vitest run` pass, with ink + react + ink-testing-library + jsx wired. Scripts: `build`, `typecheck`, `test:unit`, `test:live`, `cli`. Bin: `cc-harness-console` → `./dist/cli.js`.

- [ ] **Step 1: Write the failing smoke test**

Create `CC-to-SDK/tui/test/smoke.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import React from "react";
import { Text } from "ink";
import { render } from "ink-testing-library";

describe("tui toolchain", () => {
  it("renders an ink component to a frame string", () => {
    const { lastFrame } = render(<Text>hello-tui</Text>);
    expect(lastFrame()).toContain("hello-tui");
  });
});
```

- [ ] **Step 2: Create the package manifest**

Create `CC-to-SDK/tui/package.json`:

```json
{
  "name": "cc-harness-tui",
  "version": "0.1.0",
  "description": "Interactive terminal console for the cc-harness daemon — navigate the live session pool, inject prompts, drive control ops. Built on Ink over the cc-harness public DaemonClient.",
  "private": true,
  "type": "module",
  "engines": { "node": ">=18" },
  "bin": { "cc-harness-console": "./dist/cli.js" },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "clean": "rm -rf dist",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:unit": "vitest run test",
    "test:live": "vitest run test/live",
    "cli": "tsx src/cli.tsx"
  },
  "dependencies": {
    "cc-harness": "file:../harness",
    "ink": "^5.0.1",
    "ink-text-input": "^6.0.0",
    "react": "^18.3.1"
  },
  "devDependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.3.178",
    "@types/node": "^22.0.0",
    "@types/react": "^18.3.0",
    "ink-testing-library": "^4.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 3: Create the TS + vitest config**

Create `CC-to-SDK/tui/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "jsx": "react-jsx",
    "strict": true,
    "noImplicitAny": false,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

Create `CC-to-SDK/tui/tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "declaration": true,
    "allowImportingTsExtensions": false,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "exclude": ["test", "node_modules", "dist"]
}
```

Create `CC-to-SDK/tui/vitest.config.ts` (esbuild needs the automatic JSX runtime so test files don't import React explicitly — and so ink's JSX compiles):

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
  test: { environment: "node", include: ["test/**/*.test.ts", "test/**/*.test.tsx"] },
});
```

Create `CC-to-SDK/tui/.gitignore`:

```
node_modules
dist
```

- [ ] **Step 4: Install + build the core dependency, then run the smoke test**

Run:
```bash
cd CC-to-SDK/harness && npm run build
cd ../tui && npm install
npx vitest run test/smoke.test.tsx
npm run typecheck
```
Expected: smoke test PASS (`lastFrame()` contains `hello-tui`); typecheck clean. (`cc-harness` resolves via the `file:../harness` symlink to the freshly-built `dist/`.)

- [ ] **Step 5: Commit**

```bash
cd CC-to-SDK/tui
git add package.json package-lock.json tsconfig.json tsconfig.build.json vitest.config.ts .gitignore test/smoke.test.tsx
git commit -m "chore(tui): scaffold cc-harness-tui package (ink + react + vitest)"
```

(If `npm install` did not create `package-lock.json` in this dir, omit it from `git add`.)

---

## Task 4: TUI — `useDaemon` state-container hook

**Files:**
- Create: `CC-to-SDK/tui/src/useDaemon.ts`
- Test: `CC-to-SDK/tui/test/useDaemon.test.tsx`

**Prereq:** `cc-harness` built (Task 2 / `cd ../harness && npm run build`).

**Interfaces:**
- Consumes: `collect`, `DaemonClient`, `DashboardSnapshot`, `SessionRow` from `"cc-harness"`.
- Produces:
  - `interface UseDaemonOpts { intervalMs?: number; schedule?: (fn: () => void, ms: number) => () => void; now?: () => number; }`
  - `interface DaemonView { snapshot: DashboardSnapshot; selectedIndex: number; selected?: SessionRow; focus: "list" | "input"; stream: unknown[]; status: string; select(delta: number): void; focusInput(): void; focusList(): void; submit(prompt: string): void; interrupt(): void; cycleModel(): void; cyclePermissionMode(): void; compact(): void; fork(): void; toggleProactive(): void; spawn(): void; stop(): void; teardown(): void; }`
  - `function useDaemon(client: DaemonClient, opts?: UseDaemonOpts): DaemonView`

- [ ] **Step 1: Write the failing hook tests**

Create `CC-to-SDK/tui/test/useDaemon.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import React from "react";
import { Text } from "ink";
import { render } from "ink-testing-library";
import { useDaemon, type DaemonView, type UseDaemonOpts } from "../src/useDaemon.js";
import type { DaemonClient, ListEntry } from "cc-harness";

const flush = () => new Promise((r) => setTimeout(r, 5));

// a manual scheduler: capture the tick fn, count cancels (idempotent-teardown teeth)
function manualSchedule() {
  let fn: (() => void) | null = null;
  const cancels: number[] = [];
  const schedule = (f: () => void) => { fn = f; return () => { cancels.push(1); }; };
  return { schedule, tick: () => fn?.(), cancels };
}

function fakeClient(over: Partial<DaemonClient> = {}): DaemonClient & { calls: any } {
  const calls: any = { submit: [], control: [], stop: [], spawn: 0 };
  const base: DaemonClient = {
    async list() { return [{ id: "sess-1", daemonPid: 1, status: "idle", model: "m", createdAt: 0, lastActiveAt: 0 } as ListEntry]; },
    async contextUsage() { return { totalTokens: 20, maxTokens: 100 }; },
    async submit(id, prompt, onChunk) { calls.submit.push([id, prompt]); onChunk({ type: "assistant", message: { content: [{ type: "text", text: "yo" }] } }); return { result: "ok" }; },
    async control(id, frame) { calls.control.push([id, frame]); return { ok: true, models: ["a", "b"] }; },
    async compact() { return { compacted: true } as any; },
    async spawn() { calls.spawn++; return "new-id"; },
    async stop(id) { calls.stop.push(id); },
    async fork() { return { id: "fk", sessionId: "sid" }; },
    async startProactive() { return { state: "running", tickCount: 0, idleCount: 0, errorCount: 0 }; },
    async stopProactive() {},
  };
  return Object.assign({ ...base, ...over }, { calls });
}

let view: DaemonView;
function Probe({ client, opts }: { client: DaemonClient; opts: UseDaemonOpts }) {
  view = useDaemon(client, opts);
  return <Text>{view.snapshot.sessions.length}|{view.focus}|{view.status}|{view.stream.length}</Text>;
}

describe("useDaemon", () => {
  it("polls collect() on mount and exposes the session pool", async () => {
    const sched = manualSchedule();
    const { lastFrame } = render(<Probe client={fakeClient()} opts={{ schedule: sched.schedule, now: () => 0 }} />);
    await flush();
    expect(lastFrame()).toContain("1|list");
    expect(view.selected?.id).toBe("sess-1");
    expect(view.selected?.ctxPercent).toBe(20);
  });

  it("submit() accumulates streamed chunks", async () => {
    const c = fakeClient();
    render(<Probe client={c} opts={{ schedule: manualSchedule().schedule, now: () => 0 }} />);
    await flush();
    view.submit("hello");
    await flush();
    expect(c.calls.submit).toEqual([["sess-1", "hello"]]);
    expect(view.stream.length).toBe(1);
  });

  it("control ops route to the selected session and surface status", async () => {
    const c = fakeClient();
    render(<Probe client={c} opts={{ schedule: manualSchedule().schedule, now: () => 0 }} />);
    await flush();
    view.interrupt(); await flush();
    expect(c.calls.control.at(-1)).toEqual(["sess-1", { type: "interrupt" }]);
    view.cyclePermissionMode(); await flush();
    expect(c.calls.control.at(-1)).toEqual(["sess-1", { type: "set_permission_mode", mode: "acceptEdits" }]);
  });

  it("cycleModel() fetches the model list once then advances set_model", async () => {
    const c = fakeClient();
    render(<Probe client={c} opts={{ schedule: manualSchedule().schedule, now: () => 0 }} />);
    await flush();
    view.cycleModel(); await flush();
    expect(c.calls.control).toContainEqual(["sess-1", { type: "initialize" }]);
    expect(c.calls.control.at(-1)).toEqual(["sess-1", { type: "set_model", model: "a" }]);
    view.cycleModel(); await flush();
    expect(c.calls.control.at(-1)).toEqual(["sess-1", { type: "set_model", model: "b" }]);
  });

  it("teardown() cancels the poll exactly once (idempotent)", async () => {
    const sched = manualSchedule();
    render(<Probe client={fakeClient()} opts={{ schedule: sched.schedule, now: () => 0 }} />);
    await flush();
    view.teardown();
    view.teardown();
    expect(sched.cancels.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd CC-to-SDK/tui && npx vitest run test/useDaemon.test.tsx`
Expected: FAIL — `Cannot find module '../src/useDaemon.js'`.

- [ ] **Step 3: Implement the hook**

Create `CC-to-SDK/tui/src/useDaemon.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { collect } from "cc-harness";
import type { DaemonClient, DashboardSnapshot, SessionRow } from "cc-harness";

const PERMISSION_MODES = ["default", "acceptEdits", "bypassPermissions", "plan", "dontAsk", "auto"] as const;
const EMPTY: DashboardSnapshot = { daemonUp: false, sessions: [], at: 0 };
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const modelId = (m: unknown) => (typeof m === "string" ? m : ((m as any)?.id ?? (m as any)?.model ?? String(m)));

export interface UseDaemonOpts {
  intervalMs?: number;
  schedule?: (fn: () => void, ms: number) => () => void;
  now?: () => number;
}

export interface DaemonView {
  snapshot: DashboardSnapshot;
  selectedIndex: number;
  selected?: SessionRow;
  focus: "list" | "input";
  stream: unknown[];
  status: string;
  select(delta: number): void;
  focusInput(): void;
  focusList(): void;
  submit(prompt: string): void;
  interrupt(): void;
  cycleModel(): void;
  cyclePermissionMode(): void;
  compact(): void;
  fork(): void;
  toggleProactive(): void;
  spawn(): void;
  stop(): void;
  teardown(): void;
}

export function useDaemon(client: DaemonClient, opts: UseDaemonOpts = {}): DaemonView {
  const intervalMs = opts.intervalMs ?? 1000;
  const now = opts.now ?? Date.now;
  const schedule = opts.schedule ?? ((fn, ms) => { const t = setInterval(fn, ms); return () => clearInterval(t); });

  const [snapshot, setSnapshot] = useState<DashboardSnapshot>(EMPTY);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [focus, setFocus] = useState<"list" | "input">("list");
  const [stream, setStream] = useState<unknown[]>([]);
  const [status, setStatus] = useState("");

  const disposed = useRef(false);
  const inFlight = useRef(false);
  const cancelRef = useRef<() => void>(() => {});
  const pmIndex = useRef(0);
  const models = useRef<{ list: string[]; idx: number } | undefined>(undefined);

  const rows = snapshot.sessions;
  const idx = rows.length ? Math.min(selectedIndex, rows.length - 1) : 0;
  const selected = rows[idx];

  const tick = useCallback(async () => {
    if (inFlight.current || disposed.current) return;
    inFlight.current = true;
    try { const s = await collect(client, { now }); if (!disposed.current) setSnapshot(s); }
    finally { inFlight.current = false; }
  }, [client, now]);

  const teardown = useCallback(() => {
    if (disposed.current) return;     // idempotent: explicit quit + unmount collapse to one teardown
    disposed.current = true;
    cancelRef.current();
  }, []);

  useEffect(() => {
    void tick();                                          // immediate first paint
    cancelRef.current = schedule(() => void tick(), intervalMs);
    return () => { teardown(); };                         // unmount → teardown (cancel poll once)
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // run an op against the selected session; settle status (string on success, error text on failure); drop after teardown
  const run = useCallback((label: string, fn: (id: string) => Promise<string>) => {
    const id = selected?.id;
    if (!id) { setStatus("no session selected"); return; }
    fn(id).then((s) => { if (!disposed.current) setStatus(s); })
          .catch((e) => { if (!disposed.current) setStatus(`${label}: ${msg(e)}`); });
  }, [selected?.id]);

  const ctl = (label: string, frame: any) => (id: string) =>
    client.control(id, frame).then((r) => (r.ok ? label : `error: ${(r as any).error ?? "failed"}`));

  const select = useCallback((delta: number) => {
    setSelectedIndex((i) => { const n = rows.length; if (!n) return 0; return (((i + delta) % n) + n) % n; });
    models.current = undefined;                           // reset the model-cycle cache on selection change
  }, [rows.length]);

  const focusInput = useCallback(() => setFocus("input"), []);
  const focusList = useCallback(() => setFocus("list"), []);

  const submit = useCallback((prompt: string) => {
    const id = selected?.id; if (!id || !prompt.trim()) return;
    setStream([]); setStatus("submitting…");
    client.submit(id, prompt, (m) => { if (!disposed.current) setStream((s) => [...s, m]); })
      .then(() => { if (!disposed.current) setStatus("done"); })
      .catch((e) => { if (!disposed.current) setStatus(`submit: ${msg(e)}`); });
  }, [selected?.id, client]);

  const interrupt = useCallback(() => run("interrupted", ctl("interrupted", { type: "interrupt" })), [run]);
  const compact = useCallback(() => run("compact", (id) => client.compact(id).then(() => "compacted")), [run, client]);
  const fork = useCallback(() => run("fork", (id) => client.fork(id).then((f) => `forked → ${f.id}`)), [run, client]);

  const cyclePermissionMode = useCallback(() => {
    pmIndex.current = (pmIndex.current + 1) % PERMISSION_MODES.length;
    const mode = PERMISSION_MODES[pmIndex.current];
    run(`mode=${mode}`, ctl(`mode=${mode}`, { type: "set_permission_mode", mode }));
  }, [run]);

  const cycleModel = useCallback(() => {
    const id = selected?.id; if (!id) { setStatus("no session selected"); return; }
    const advance = (list: string[]) => {
      if (!list.length) { setStatus("no models"); return; }
      const next = models.current ? (models.current.idx + 1) % list.length : 0;
      models.current = { list, idx: next };
      run(`model=${list[next]}`, ctl(`model=${list[next]}`, { type: "set_model", model: list[next] }));
    };
    if (models.current) { advance(models.current.list); return; }
    client.control(id, { type: "initialize" }).then((res) => {
      if (disposed.current) return;
      advance((res.ok ? ((res as any).models ?? []) : []).map(modelId));
    }).catch((e) => { if (!disposed.current) setStatus(`initialize: ${msg(e)}`); });
  }, [selected?.id, client, run]);

  const toggleProactive = useCallback(() => {
    const active = selected?.proactive === "running" || selected?.proactive === "paused";
    run("proactive", (id) => active
      ? client.stopProactive(id).then(() => "proactive stopped")
      : client.startProactive(id).then((st) => `proactive ${st.state}`));
  }, [run, client, selected?.proactive]);

  const spawn = useCallback(() => {
    client.spawn().then((id) => { if (!disposed.current) { setStatus(`spawned ${id}`); void tick(); } })
      .catch((e) => { if (!disposed.current) setStatus(`spawn: ${msg(e)}`); });
  }, [client, tick]);

  const stop = useCallback(() => run("stopped", (id) => client.stop(id).then(() => { void tick(); return "stopped"; })), [run, client, tick]);

  return { snapshot, selectedIndex: idx, selected, focus, stream, status,
    select, focusInput, focusList, submit, interrupt, cycleModel, cyclePermissionMode, compact, fork, toggleProactive, spawn, stop, teardown };
}
```

- [ ] **Step 4: Run the hook tests + typecheck**

Run: `cd CC-to-SDK/tui && npx vitest run test/useDaemon.test.tsx && npm run typecheck`
Expected: all 5 tests PASS; typecheck clean. (If React logs an `act(...)` warning, it is benign — the assertions are what gate the task.)

- [ ] **Step 5: Commit**

```bash
cd CC-to-SDK/tui
git add src/useDaemon.ts test/useDaemon.test.tsx
git commit -m "feat(tui): useDaemon hook — poll + selection + submit-stream + control ops + idempotent teardown"
```

---

## Task 5: TUI — `format.ts` (operator-grade stream formatter) + `<Detail>`

**Files:**
- Create: `CC-to-SDK/tui/src/format.ts`
- Create: `CC-to-SDK/tui/src/Detail.tsx`
- Test: `CC-to-SDK/tui/test/format.test.ts`
- Test: `CC-to-SDK/tui/test/components.test.tsx` (Detail section — created here, extended in Tasks 6–7)

**Prereq:** `cc-harness` built.

**Interfaces:**
- Consumes: `SessionRow` (type) from `"cc-harness"`.
- Produces:
  - `function streamLine(message: unknown): string[]` and `function streamLines(messages: unknown[]): string[]` (in `format.ts`).
  - `function Detail(props: { row?: SessionRow; stream: unknown[] }): JSX.Element` (in `Detail.tsx`).

- [ ] **Step 1: Write the failing formatter test**

Create `CC-to-SDK/tui/test/format.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { streamLine, streamLines } from "../src/format.js";

describe("streamLine (operator-grade)", () => {
  it("extracts assistant text blocks", () => {
    expect(streamLine({ type: "assistant", message: { content: [{ type: "text", text: "hello" }] } })).toEqual(["hello"]);
  });
  it("renders tool_use blocks as ⚙ Name(arg) markers, truncating long args", () => {
    const long = "x".repeat(100);
    const [line] = streamLine({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: long } }] } });
    expect(line.startsWith("⚙ Bash(")).toBe(true);
    expect(line.length).toBeLessThan(70);
  });
  it("ignores result/system messages (no diffs/results in operator mode)", () => {
    expect(streamLine({ type: "result", result: "done" })).toEqual([]);
    expect(streamLine({ type: "system", subtype: "init" })).toEqual([]);
  });
  it("streamLines flattens a message sequence in order", () => {
    const msgs = [
      { type: "assistant", message: { content: [{ type: "text", text: "a" }, { type: "tool_use", name: "Read", input: { file: "x" } }] } },
      { type: "assistant", message: { content: [{ type: "text", text: "b" }] } },
    ];
    expect(streamLines(msgs)).toEqual(["a", `⚙ Read({"file":"x"})`, "b"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd CC-to-SDK/tui && npx vitest run test/format.test.ts`
Expected: FAIL — `Cannot find module '../src/format.js'`.

- [ ] **Step 3: Implement `format.ts`**

Create `CC-to-SDK/tui/src/format.ts`:

```ts
const TOOL_ARG_MAX = 48;

function summarizeInput(input: unknown): string {
  if (input == null) return "";
  const s = typeof input === "string" ? input : JSON.stringify(input);
  return s.length > TOOL_ARG_MAX ? s.slice(0, TOOL_ARG_MAX - 1) + "…" : s;
}

/** Operator-grade: assistant text verbatim; tool_use → `⚙ Name(arg)` markers. No diffs, no tool results. */
export function streamLine(message: unknown): string[] {
  const m = message as any;
  const out: string[] = [];
  if (m?.type === "assistant") {
    for (const b of m.message?.content ?? []) {
      if (b?.type === "text" && b.text) out.push(b.text);
      else if (b?.type === "tool_use") out.push(`⚙ ${b.name}(${summarizeInput(b.input)})`);
    }
  }
  return out;
}

export function streamLines(messages: unknown[]): string[] {
  return messages.flatMap(streamLine);
}
```

- [ ] **Step 4: Run the formatter test**

Run: `cd CC-to-SDK/tui && npx vitest run test/format.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing Detail test**

Create `CC-to-SDK/tui/test/components.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { Detail } from "../src/Detail.js";
import type { SessionRow } from "cc-harness";

const row: SessionRow = { id: "sess-abc", status: "idle", model: "opus", createdAt: 0 };

describe("<Detail>", () => {
  it("shows the selected session header + a placeholder when no stream", () => {
    const { lastFrame } = render(<Detail row={row} stream={[]} />);
    expect(lastFrame()).toContain("sess-abc");
    expect(lastFrame()).toContain("no output yet");
  });
  it("renders accumulated stream lines (text + tool markers)", () => {
    const stream = [{ type: "assistant", message: { content: [{ type: "text", text: "answer" }, { type: "tool_use", name: "Grep", input: { q: "x" } }] } }];
    const { lastFrame } = render(<Detail row={row} stream={stream} />);
    expect(lastFrame()).toContain("answer");
    expect(lastFrame()).toContain("⚙ Grep(");
  });
  it("shows 'no session selected' when row is undefined", () => {
    const { lastFrame } = render(<Detail stream={[]} />);
    expect(lastFrame()).toContain("no session selected");
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `cd CC-to-SDK/tui && npx vitest run test/components.test.tsx`
Expected: FAIL — `Cannot find module '../src/Detail.js'`.

- [ ] **Step 7: Implement `<Detail>`**

Create `CC-to-SDK/tui/src/Detail.tsx`:

```tsx
import React from "react";
import { Box, Text } from "ink";
import type { SessionRow } from "cc-harness";
import { streamLines } from "./format.js";

export function Detail({ row, stream }: { row?: SessionRow; stream: unknown[] }) {
  const lines = streamLines(stream);
  return (
    <Box flexDirection="column" flexGrow={1} borderStyle="round" paddingX={1}>
      {row ? <Text bold>{row.id} · {row.status} · {row.model ?? "-"}</Text> : <Text dimColor>no session selected</Text>}
      {lines.length === 0
        ? <Text dimColor>(no output yet)</Text>
        : lines.slice(-200).map((l, i) => <Text key={i}>{l}</Text>)}
    </Box>
  );
}
```

- [ ] **Step 8: Run both tests + typecheck**

Run: `cd CC-to-SDK/tui && npx vitest run test/format.test.ts test/components.test.tsx && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 9: Commit**

```bash
cd CC-to-SDK/tui
git add src/format.ts src/Detail.tsx test/format.test.ts test/components.test.tsx
git commit -m "feat(tui): operator-grade stream formatter + <Detail> pane"
```

---

## Task 6: TUI — `<Pool>` + `<StatusBar>`

**Files:**
- Create: `CC-to-SDK/tui/src/Pool.tsx`
- Create: `CC-to-SDK/tui/src/StatusBar.tsx`
- Modify: `CC-to-SDK/tui/test/components.test.tsx` (add Pool + StatusBar describes)

**Prereq:** `cc-harness` built.

**Interfaces:**
- Consumes: `SessionRow` (type) from `"cc-harness"`.
- Produces:
  - `function Pool(props: { rows: SessionRow[]; selectedIndex: number }): JSX.Element`
  - `function StatusBar(props: { daemonUp: boolean; focus: "list" | "input"; status?: string }): JSX.Element`

- [ ] **Step 1: Write the failing tests**

Append to `CC-to-SDK/tui/test/components.test.tsx`:

```tsx
import { Pool } from "../src/Pool.js";
import { StatusBar } from "../src/StatusBar.js";

describe("<Pool>", () => {
  const rows: SessionRow[] = [
    { id: "sess-aaaaaaaa", status: "idle", model: "opus", ctxPercent: 12, createdAt: 0 },
    { id: "sess-bbbbbbbb", status: "busy", model: "sonnet", createdAt: 0 },
  ];
  it("lists sessions with id, model and ctx%", () => {
    const { lastFrame } = render(<Pool rows={rows} selectedIndex={0} />);
    expect(lastFrame()).toContain("sess-aaa");
    expect(lastFrame()).toContain("opus");
    expect(lastFrame()).toContain("12%");
    expect(lastFrame()).toContain("Sessions (2)");
  });
  it("shows a placeholder when the pool is empty", () => {
    const { lastFrame } = render(<Pool rows={[]} selectedIndex={0} />);
    expect(lastFrame()).toContain("no live sessions");
  });
});

describe("<StatusBar>", () => {
  it("reflects daemon-up and list-mode key hints", () => {
    const { lastFrame } = render(<StatusBar daemonUp={true} focus="list" status="ready" />);
    expect(lastFrame()).toContain("daemon up");
    expect(lastFrame()).toContain("ready");
    expect(lastFrame()).toContain("q quit");
  });
  it("reflects daemon-down and input-mode hints", () => {
    const { lastFrame } = render(<StatusBar daemonUp={false} focus="input" />);
    expect(lastFrame()).toContain("daemon down");
    expect(lastFrame()).toContain("esc cancel");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd CC-to-SDK/tui && npx vitest run test/components.test.tsx`
Expected: FAIL — `Cannot find module '../src/Pool.js'`.

- [ ] **Step 3: Implement `<Pool>`**

Create `CC-to-SDK/tui/src/Pool.tsx`:

```tsx
import React from "react";
import { Box, Text } from "ink";
import type { SessionRow } from "cc-harness";

const GLYPH: Record<string, string> = { idle: "·", busy: "▶", errored: "✗", restarting: "↻" };

export function Pool({ rows, selectedIndex }: { rows: SessionRow[]; selectedIndex: number }) {
  return (
    <Box flexDirection="column" width={38} borderStyle="round" paddingX={1}>
      <Text bold>Sessions ({rows.length})</Text>
      {rows.length === 0
        ? <Text dimColor>no live sessions</Text>
        : rows.map((r, i) => (
          <Text key={r.id} inverse={i === selectedIndex}>
            {(GLYPH[r.status] ?? "?")} {r.id.slice(0, 10)} {r.model ?? "-"} {r.ctxPercent != null ? `${r.ctxPercent}%` : "--"}
          </Text>
        ))}
    </Box>
  );
}
```

- [ ] **Step 4: Implement `<StatusBar>`**

Create `CC-to-SDK/tui/src/StatusBar.tsx`:

```tsx
import React from "react";
import { Box, Text } from "ink";

const LIST_KEYS = "j/k move · enter prompt · i intr · m model · p mode · / compact · f fork · P proactive · x stop · n new · q quit";
const INPUT_KEYS = "type prompt · enter send · esc cancel";

export function StatusBar({ daemonUp, focus, status }: { daemonUp: boolean; focus: "list" | "input"; status?: string }) {
  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1}>
      <Box>
        <Text color={daemonUp ? "green" : "red"}>● daemon {daemonUp ? "up" : "down"}</Text>
        {status ? <Text>{"  "}{status}</Text> : null}
      </Box>
      <Text dimColor>{focus === "input" ? INPUT_KEYS : LIST_KEYS}</Text>
    </Box>
  );
}
```

- [ ] **Step 5: Run the component tests + typecheck**

Run: `cd CC-to-SDK/tui && npx vitest run test/components.test.tsx && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
cd CC-to-SDK/tui
git add src/Pool.tsx src/StatusBar.tsx test/components.test.tsx
git commit -m "feat(tui): <Pool> session list + <StatusBar> with context-sensitive key hints"
```

---

## Task 7: TUI — `<Composer>` + `<ConfirmDialog>`

**Files:**
- Create: `CC-to-SDK/tui/src/Composer.tsx`
- Create: `CC-to-SDK/tui/src/ConfirmDialog.tsx`
- Modify: `CC-to-SDK/tui/test/components.test.tsx` (add Composer + ConfirmDialog describes)

**Prereq:** `cc-harness` built.

**Interfaces:**
- Produces:
  - `function Composer(props: { onSubmit: (text: string) => void }): JSX.Element` — an `ink-text-input` line; calls `onSubmit(value)` on Enter and clears.
  - `function ConfirmDialog(props: { message: string; onConfirm: () => void; onCancel: () => void }): JSX.Element` — y → onConfirm; n / Esc → onCancel.

- [ ] **Step 1: Write the failing tests**

Append to `CC-to-SDK/tui/test/components.test.tsx`:

```tsx
import { Composer } from "../src/Composer.js";
import { ConfirmDialog } from "../src/ConfirmDialog.js";

const tickInput = () => new Promise((r) => setTimeout(r, 10));

describe("<Composer>", () => {
  it("submits typed text on Enter and clears", async () => {
    const got: string[] = [];
    const { stdin, lastFrame } = render(<Composer onSubmit={(t) => got.push(t)} />);
    stdin.write("hi there");
    await tickInput();
    expect(lastFrame()).toContain("hi there");
    stdin.write("\r"); // Enter
    await tickInput();
    expect(got).toEqual(["hi there"]);
  });
});

describe("<ConfirmDialog>", () => {
  it("calls onConfirm on 'y'", async () => {
    let confirmed = false, cancelled = false;
    const { stdin, lastFrame } = render(<ConfirmDialog message="Stop session X?" onConfirm={() => (confirmed = true)} onCancel={() => (cancelled = true)} />);
    expect(lastFrame()).toContain("Stop session X?");
    expect(lastFrame()).toContain("(y/n)");
    stdin.write("y");
    await tickInput();
    expect(confirmed).toBe(true);
    expect(cancelled).toBe(false);
  });
  it("calls onCancel on 'n'", async () => {
    let cancelled = false;
    const { stdin } = render(<ConfirmDialog message="m" onConfirm={() => {}} onCancel={() => (cancelled = true)} />);
    stdin.write("n");
    await tickInput();
    expect(cancelled).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd CC-to-SDK/tui && npx vitest run test/components.test.tsx`
Expected: FAIL — `Cannot find module '../src/Composer.js'`.

- [ ] **Step 3: Implement `<Composer>`**

Create `CC-to-SDK/tui/src/Composer.tsx`:

```tsx
import React, { useState } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";

export function Composer({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <Box borderStyle="round" paddingX={1}>
      <Text>{"› "}</Text>
      <TextInput value={value} onChange={setValue} onSubmit={(v) => { onSubmit(v); setValue(""); }} />
    </Box>
  );
}
```

- [ ] **Step 4: Implement `<ConfirmDialog>`**

Create `CC-to-SDK/tui/src/ConfirmDialog.tsx`:

```tsx
import React from "react";
import { Box, Text, useInput } from "ink";

export function ConfirmDialog({ message, onConfirm, onCancel }: { message: string; onConfirm: () => void; onCancel: () => void }) {
  useInput((input, key) => {
    if (input === "y" || input === "Y") onConfirm();
    else if (input === "n" || input === "N" || key.escape) onCancel();
  });
  return (
    <Box borderStyle="double" paddingX={1}>
      <Text color="yellow">{message} (y/n)</Text>
    </Box>
  );
}
```

- [ ] **Step 5: Run the component tests + typecheck**

Run: `cd CC-to-SDK/tui && npx vitest run test/components.test.tsx && npm run typecheck`
Expected: PASS (Detail/Pool/StatusBar/Composer/ConfirmDialog all green); typecheck clean.

- [ ] **Step 6: Commit**

```bash
cd CC-to-SDK/tui
git add src/Composer.tsx src/ConfirmDialog.tsx test/components.test.tsx
git commit -m "feat(tui): <Composer> prompt input + <ConfirmDialog> destructive-op gate"
```

---

## Task 8: TUI — `<App>` composition + key routing + `cli.tsx` bin

**Files:**
- Create: `CC-to-SDK/tui/src/App.tsx`
- Create: `CC-to-SDK/tui/src/cli.tsx`
- Test: `CC-to-SDK/tui/test/app.test.tsx`

**Prereq:** `cc-harness` built.

**Interfaces:**
- Consumes: `useDaemon`, `UseDaemonOpts` (`./useDaemon.js`); `Pool`/`Detail`/`Composer`/`StatusBar`/`ConfirmDialog`; `DaemonClient` (type), `connectDaemon`, `daemonSocketPath` from `"cc-harness"`; `useApp`, `useInput` from `ink`.
- Produces: `function App(props: { client: DaemonClient; socketPath?: string; hookOpts?: UseDaemonOpts }): JSX.Element`; the `cc-harness-console` bin.

- [ ] **Step 1: Write the failing App test**

Create `CC-to-SDK/tui/test/app.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { App } from "../src/App.js";
import type { DaemonClient, ListEntry } from "cc-harness";

const flush = () => new Promise((r) => setTimeout(r, 10));
const noopSchedule = () => () => {};

function fakeClient() {
  const calls: any = { stop: [], spawn: 0, submit: [], control: [] };
  const c: DaemonClient = {
    async list() { return [{ id: "sess-xyz", daemonPid: 1, status: "idle", model: "m", createdAt: 0, lastActiveAt: 0 } as ListEntry]; },
    async contextUsage() { return { totalTokens: 10, maxTokens: 100 }; },
    async submit(id, p, onChunk) { calls.submit.push([id, p]); onChunk({ type: "assistant", message: { content: [{ type: "text", text: "hi" }] } }); return { result: "ok" }; },
    async control(id, f) { calls.control.push([id, f]); return { ok: true, models: ["a"] }; },
    async compact() { return {} as any; },
    async spawn() { calls.spawn++; return "id2"; },
    async stop(id) { calls.stop.push(id); },
    async fork() { return { id: "fk" }; },
    async startProactive() { return { state: "running", tickCount: 0, idleCount: 0, errorCount: 0 }; },
    async stopProactive() {},
  };
  return Object.assign(c, { calls });
}

describe("<App>", () => {
  it("renders the pool after the first poll", async () => {
    const { lastFrame } = render(<App client={fakeClient()} hookOpts={{ schedule: noopSchedule, now: () => 0 }} />);
    await flush();
    expect(lastFrame()).toContain("sess-xyz");
    expect(lastFrame()).toContain("daemon up");
  });

  it("Enter opens the composer; Esc returns to the list", async () => {
    const { stdin, lastFrame } = render(<App client={fakeClient()} hookOpts={{ schedule: noopSchedule, now: () => 0 }} />);
    await flush();
    stdin.write("\r");          // Enter → input focus
    await flush();
    expect(lastFrame()).toContain("›");        // composer prompt visible
    stdin.write("\u001B");      // Esc → list focus
    await flush();
    expect(lastFrame()).not.toContain("›");
  });

  it("'x' opens the confirm dialog and 'y' calls stop()", async () => {
    const c = fakeClient();
    const { stdin, lastFrame } = render(<App client={c} hookOpts={{ schedule: noopSchedule, now: () => 0 }} />);
    await flush();
    stdin.write("x");
    await flush();
    expect(lastFrame()).toContain("Stop session sess-xyz?");
    stdin.write("y");
    await flush();
    expect(c.calls.stop).toEqual(["sess-xyz"]);
  });

  it("'n' spawns a new session", async () => {
    const c = fakeClient();
    const { stdin } = render(<App client={c} hookOpts={{ schedule: noopSchedule, now: () => 0 }} />);
    await flush();
    stdin.write("n");
    await flush();
    expect(c.calls.spawn).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd CC-to-SDK/tui && npx vitest run test/app.test.tsx`
Expected: FAIL — `Cannot find module '../src/App.js'`.

- [ ] **Step 3: Implement `<App>`**

Create `CC-to-SDK/tui/src/App.tsx`:

```tsx
import React, { useState } from "react";
import { Box, useApp, useInput } from "ink";
import type { DaemonClient } from "cc-harness";
import { useDaemon, type UseDaemonOpts } from "./useDaemon.js";
import { Pool } from "./Pool.js";
import { Detail } from "./Detail.js";
import { Composer } from "./Composer.js";
import { StatusBar } from "./StatusBar.js";
import { ConfirmDialog } from "./ConfirmDialog.js";

export function App({ client, hookOpts }: { client: DaemonClient; socketPath?: string; hookOpts?: UseDaemonOpts }) {
  const d = useDaemon(client, hookOpts);
  const { exit } = useApp();
  const [confirm, setConfirm] = useState<{ message: string; action: () => void } | null>(null);

  const quit = () => { d.teardown(); exit(); };

  // list-mode keys: navigation + selection-scoped ops + pool-level spawn; inactive while typing or confirming
  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c")) { quit(); return; }
    if (input === "j" || key.downArrow) d.select(1);
    else if (input === "k" || key.upArrow) d.select(-1);
    else if (key.return) d.focusInput();
    else if (input === "i") d.interrupt();
    else if (input === "m") d.cycleModel();
    else if (input === "p") d.cyclePermissionMode();
    else if (input === "/") d.compact();
    else if (input === "f") d.fork();
    else if (input === "P") d.toggleProactive();
    else if (input === "n") d.spawn();
    else if (input === "x" && d.selected) {
      const id = d.selected.id;
      setConfirm({ message: `Stop session ${id}?`, action: d.stop });
    }
  }, { isActive: d.focus === "list" && !confirm });

  // input-mode: Esc returns to the list (typing + Enter are handled by Composer's TextInput)
  useInput((_input, key) => { if (key.escape) d.focusList(); }, { isActive: d.focus === "input" && !confirm });

  return (
    <Box flexDirection="column">
      <Box>
        <Pool rows={d.snapshot.sessions} selectedIndex={d.selectedIndex} />
        <Detail row={d.selected} stream={d.stream} />
      </Box>
      {d.focus === "input" ? <Composer onSubmit={(t) => { d.submit(t); d.focusList(); }} /> : null}
      {confirm ? <ConfirmDialog message={confirm.message} onConfirm={() => { confirm.action(); setConfirm(null); }} onCancel={() => setConfirm(null)} /> : null}
      <StatusBar daemonUp={d.snapshot.daemonUp} focus={d.focus} status={d.status} />
    </Box>
  );
}
```

- [ ] **Step 4: Run the App test + typecheck**

Run: `cd CC-to-SDK/tui && npx vitest run test/app.test.tsx && npm run typecheck`
Expected: all 4 App tests PASS; typecheck clean.

- [ ] **Step 5: Implement the `cli.tsx` bin**

Create `CC-to-SDK/tui/src/cli.tsx`:

```tsx
#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { connectDaemon, daemonSocketPath } from "cc-harness";
import { App } from "./App.js";

const args = process.argv.slice(2);
let socket = daemonSocketPath();
for (let i = 0; i < args.length; i++) if (args[i] === "--socket") socket = args[++i];

const { waitUntilExit } = render(<App client={connectDaemon(socket)} socketPath={socket} />);
waitUntilExit().then(() => process.exit(0));
```

- [ ] **Step 6: Build the package (proves the bin + components emit cleanly)**

Run: `cd CC-to-SDK/tui && npm run build`
Expected: emits `dist/cli.js` + component `.js`/`.d.ts` with no errors.

- [ ] **Step 7: Commit**

```bash
cd CC-to-SDK/tui
git add src/App.tsx src/cli.tsx test/app.test.tsx
git commit -m "feat(tui): <App> master-detail composition + key routing + cc-harness-console bin"
```

---

## Task 9: TUI — gated live e2e + coverage refresh

**Files:**
- Create: `CC-to-SDK/tui/test/live/console.e2e.test.ts`
- Modify: `CC-to-SDK/docs/parity/coverage.md` (Domain 10 row, line 142)

**Prereq:** `cc-harness` built. The live test is **gated on `ANTHROPIC_API_KEY`** and skips cleanly without it.

**Interfaces:**
- Consumes: `connectDaemon`, `DaemonSupervisor`, `DaemonServer` from `"cc-harness"`; `query` from `@anthropic-ai/claude-agent-sdk` (devDep).

- [ ] **Step 1: Write the gated live e2e**

Create `CC-to-SDK/tui/test/live/console.e2e.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { DaemonSupervisor, DaemonServer, connectDaemon } from "cc-harness";

// gates exactly like the harness live suites: no key → skip cleanly
const live = process.env.ANTHROPIC_API_KEY ? describe : describe.skip;

live("console ↔ real daemon (connectDaemon e2e)", () => {
  it("spawns, submits, streams assistant text, then stops", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-console-e2e-"));
    const sock = join(dir, "sock");
    const sup = new DaemonSupervisor({ query }, { dir: join(dir, "sessions") });
    const server = new DaemonServer(sup, sock);
    await server.listen();
    try {
      const c = connectDaemon(sock);
      const id = await c.spawn({ model: "claude-haiku-4-5-20251001" });
      let text = "";
      await c.submit(id, "Reply with exactly the word: pong", (m: any) => {
        if (m?.type === "assistant") for (const b of m.message?.content ?? []) if (b.type === "text") text += b.text;
      });
      expect(text.toLowerCase()).toContain("pong");
      await c.stop(id);
    } finally {
      const { daemonRequest } = await import("cc-harness");
      await daemonRequest(sock, { op: "shutdown" }).catch(() => {});
      await server.closed;
    }
  }, 90_000);
});
```

(Note: `daemonRequest` is re-imported from `cc-harness` in `finally` — it is part of the public surface. If the implementer prefers, add it to the top-level import instead.)

- [ ] **Step 2: Verify it skips cleanly without a key**

Run: `cd CC-to-SDK/tui && npx vitest run test/live/console.e2e.test.ts`
Expected: 1 skipped, 0 failed (no `ANTHROPIC_API_KEY` in the implementer's env → `describe.skip`).

- [ ] **Step 3: Update the coverage scorecard**

In `CC-to-SDK/docs/parity/coverage.md`, edit the Domain 10 row (line 142). Replace the existing increment-1 sentence segment so it reflects increment 2 shipping. Change the row's status note from:

> Interactive control TUI (incr 2) + chat REPL (incr 3) deferred

to:

> **Phase-3 increment 2 SHIPPED — `cc-harness-console`, an interactive Ink daemon console** (new `cc-harness-tui` package over the core's new public `connectDaemon`/`DaemonClient`: master-detail pool/detail, inject prompts via streaming `submit`, drive control ops — interrupt/setModel/setPermissionMode/compact/fork/proactive — with confirm-gated `stop`; spec/plan `2026-06-18-interactive-daemon-console`). Chat REPL (incr 3) deferred

Adjust the row's percentage estimate from `~18%` to `~24%` (the interactive console closes a meaningful slice of the reachable UI sub-surface). Keep the `¹` footnote semantics intact.

- [ ] **Step 4: Run the full TUI unit suite + core suite (regression gate)**

Run:
```bash
cd CC-to-SDK/harness && npm run build && npx vitest run test/unit
cd ../tui && npx vitest run test
```
Expected: harness unit suite green (incl. `daemon-client`, `index`, monitor suites); TUI unit suite green (smoke, useDaemon, format, components, app); live e2e skipped.

- [ ] **Step 5: Commit**

```bash
cd CC-to-SDK
git add tui/test/live/console.e2e.test.ts docs/parity/coverage.md
git commit -m "test(tui): gated live console e2e + refresh parity coverage (incr 2 shipped)"
```

---

## Self-Review

**1. Spec coverage** (against `2026-06-18-interactive-daemon-console-design.md`):
- §3 In (1) public `DaemonClient` + `connectDaemon` → Task 1; promoted `collect`/types → Task 2. ✅
- §3 In (2) new `cc-harness-tui` package, Ink master-detail console, bin `cc-harness-console` → Tasks 3–8. ✅
- §3 In (3) tests at both layers + one gated live e2e → DI+real-UDS (Task 1), pin (Task 2), component/hook/app via ink-testing-library (Tasks 4–8), live e2e (Task 9). ✅
- §4.A packages (core gains DaemonClient, NO ink; new tui package) → Tasks 1–3. ✅
- §4.B exact `DaemonClient`/`MonitorClient`/`connectDaemon` shapes + index export + pin + advanced-seam tier → Tasks 1–2 (signatures match verbatim). ✅
- §4.C `useDaemon` (poll, selection, active submit stream, focus mode) + `<Pool>/<Detail>/<Composer>/<StatusBar>/<ConfirmDialog>` + the exact key map (j/k, Enter, Esc, q/Ctrl-C; i/m/p///f/P/x selection-scoped; n pool-level) → Tasks 4–8. ✅
- §4.D benign ops fire immediately + surface in status; destructive `stop` routed through ConfirmDialog; `{ok:false}` shown not crashed → Task 4 (status/run), Task 8 (confirm-gate). ✅
- §4.E daemon-down waiting state (collect daemonUp:false), submit-error inline, idempotent teardown (cancel poll once, drop after dispose) → Task 4 (teardown test gives `cancels.length===1` teeth). ✅
- §5 verification layers (core DI+UDS, pin, ink keyless, gated live) → Tasks 1,2,4–9. ✅
- §6 testing summary (daemon-client.test, updated index pin, tui per-component, console.e2e) → matched. ✅
- §7 non-goals (no rich tool-result rendering, no permission dialogs, no pickers/slash-commands, no replacing `cc-harness top`, no store mutation in UI) → the plan builds none of these; `cc-harness top` untouched (monitor/app.ts unchanged); Detail is text + `⚙` markers only. ✅

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code; every command has an expected result. ✅

**3. Type consistency:** `DaemonClient`/`MonitorClient`/`connectDaemon` signatures in Task 1 match the Task 4 hook consumption and the Task 2 exports. `DaemonView` fields produced in Task 4 match every consumer in Task 8 (`d.snapshot`, `d.selected`, `d.selectedIndex`, `d.focus`, `d.stream`, `d.status`, and all action methods). `streamLines` (Task 5) consumed by `<Detail>` (Task 5) and exercised in Task 4's fake stream shape. `SessionRow` (re-exported by Task 2) consumed by `<Pool>`/`<Detail>`. `control` returns raw `ControlResponse` (not throwing) — consistently relied on by `ctl()` in the hook and the `contextUsage`-throws carve-out. ✅

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-18-interactive-daemon-console.md`. Execute via **superpowers:subagent-driven-development** (fresh implementer per task, codex→Claude task review after each, Opus final whole-branch review — per project convention). Tasks 1–2 are core (Sonnet); Tasks 3–9 are the TUI package (Sonnet implementers; the hook in Task 4 and the App wiring in Task 8 are the highest-judgment tasks).
