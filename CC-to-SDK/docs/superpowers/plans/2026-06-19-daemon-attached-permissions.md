# Daemon-Attached Interactive Permissions (increment 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give daemon-owned sessions a least-human-gated autonomy loop (`auto` on a forced supported model, classifier as the sole gate) plus a thin poll-based escape-hatch wire that lets an attached console answer the rare `canUseTool` prompt — closing the current daemon auto-deny gap.

**Architecture:** Layer A is config: a daemon session in `auto` forces a supported model (`claude-sonnet-4-6`) so the classifier is reachable. Layer B (Approach B, poll-based) adds a supervisor-owned `PendingPermissions` registry; every daemon session's `canUseTool` parks there; two new one-shot ops (`pending_permissions`, `permission_response`) let the console's existing 1 s poll surface and answer a parked request, reusing the increment-3 `PermissionDialog`.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), `cc-harness` npm package, Claude Agent SDK 0.3.178, zod/v4 wire schemas, Node UDS/NDJSON, Vitest (DI unit + gated live), Ink + ink-testing-library (tui).

## Global Constraints

- **Approach B (poll-based)** — no persistent bidirectional channel; one-op-per-connection stays; a server-side `PendingPermissions` registry + two one-shot ops surfaced via the existing poll.
- **Force a supported model when `auto`** — unsupported/absent → `DEFAULT_AUTO_MODEL = "claude-sonnet-4-6"`. Supported set: `claude-sonnet-4-6`, `claude-opus-4-6`, `claude-opus-4-7`, `claude-opus-4-8`.
- **No `ask` rules in the product; no custom deny floor** — rely on `auto`'s built-in deny gate. The wire fires for `default`-mode daemon sessions (the broker-gap fix) and is a latent safety valve.
- **Timeout-deny default 30 000 ms** for a parked request with no answer (configurable via `DaemonOptions.permissionTimeoutMs`).
- **Every daemon session gets the broker:** `options.canUseTool = createPermissionGate(pending.brokerFor(id))` injected in `supervisor.makeSession` (the daemon does **not** use `resolveOptions`).
- **`PendingEntry` is the serializable wire view** of a `PermissionRequest` — it MUST NOT carry the `AbortSignal`.
- **Conventions:** NO Prettier (dense hand-style, match surrounding lines); ESM import specifiers end in `.js`; in `tui/` import core via bare `"cc-harness"`; keep modules small.
- **Public surface:** new public **type** export `PendingEntry` + two `DaemonClient` methods (`pendingPermissions`, `respondPermission`). Pin in `harness/test/unit/index.test.ts` (type-level; the value-export `EXPECTED` array is unchanged). Record in `harness/API-STABILITY.md`.
- **Commands (from `harness/`):** `npm run typecheck`; `npm run test:unit`; `npx vitest run test/unit/<file>`; live keyed: `set -a; . ../.env; set +a; npx vitest run test/live/<file>`. **From `tui/`:** build `../harness` first (`cd ../harness && npm run build`), then `npm run typecheck` / `npx vitest run`.
- **No `Co-Authored-By` in commits.** Commit each task on completion.

---

### Task 1: open-Q-b validation probe (run FIRST)

A characterization probe, not TDD. Determines whether a long-lived `auto` session aborts under repeated permission blocks (the documented `-p` 3-consecutive / 20-total fallback). **Reaction is already covered:** a daemon session that ends is handled by the supervisor's existing `handleSessionEnd` (restart `on-failure`, else `errored`), so no product code hinges on the outcome — this task only records the behavior so the final review knows it.

**Files:**
- Create: `probes/probes/19-auto-repeated-block-abort.ts`

- [ ] **Step 1: Write the probe**

```ts
// probes/probes/19-auto-repeated-block-abort.ts
// open-Q-b: does an `auto` session degrade/abort under repeated permission BLOCKS (the documented -p
// 3-consecutive / 20-total fallback)? The CLASSIFIER won't block explicit commands (probe 18h), so we use the
// closest controllable proxy: a deny RULE the agent keeps hitting across sequential auto turns, recording each
// turn's result subtype. A shift to an error/abort subtype on later attempts = degradation under repeated blocks.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MODEL = "claude-sonnet-4-6";
const dir = mkdtempSync(join(tmpdir(), "probe19-"));
writeFileSync(join(dir, "note.txt"), "ORIGINAL\n");

async function attempt(n: number) {
  let result: any, err: string | undefined;
  try {
    for await (const m of query({ prompt: `Attempt #${n}: run exactly this bash command and nothing else: curl -fsS http://127.0.0.1:9/x`, options: {
      model: MODEL, cwd: dir, maxTurns: 4, permissionMode: "auto" as any, settingSources: [] as any,
      settings: { permissions: { deny: ["Bash(curl:*)"] } } as any,
    } })) { if ("result" in m) result = m; }
  } catch (e: any) { err = e.message; }
  return { subtype: result?.subtype, err };
}

console.log("=== PROBE 19 — auto repeated-block abort characterization ===  model:", MODEL);
for (let i = 1; i <= 6; i++) {
  const r = await attempt(i);
  console.log(`attempt ${i}: subtype=${r.subtype}${r.err ? "  ERR=" + r.err : ""}`);
}
console.log("\nRecord whether later attempts shift subtype vs the first. Reaction: a daemon session that ends");
console.log("is already handled by supervisor.handleSessionEnd (restart on-failure / errored) — no new code.");
```

- [ ] **Step 2: Run it (controller, keyed)**

Run: `cd probes && set -a; . ../.env; set +a; node_modules/.bin/tsx probes/19-auto-repeated-block-abort.ts`
Expected: prints 6 attempt lines with result subtypes. Record the finding (does the subtype shift on later attempts?). Skips meaningfully only with a key; without `ANTHROPIC_API_KEY` it errors at auth — that is fine, the controller runs it keyed.

- [ ] **Step 3: Commit**

```bash
git add probes/probes/19-auto-repeated-block-abort.ts
git commit -m "probe(daemon-perms): open-Q-b auto repeated-block characterization (19)"
```

---

### Task 2: supported-model gating helper

**Files:**
- Create: `harness/src/config/autoModel.ts`
- Test: `harness/test/unit/auto-model.test.ts`

**Interfaces:**
- Produces: `DEFAULT_AUTO_MODEL: string` (`"claude-sonnet-4-6"`); `isAutoSupportedModel(model: string | undefined): boolean`; `resolveAutoModel(model?: string): string`.

- [ ] **Step 1: Write the failing test**

```ts
// harness/test/unit/auto-model.test.ts
import { describe, it, expect } from "vitest";
import { DEFAULT_AUTO_MODEL, isAutoSupportedModel, resolveAutoModel } from "../../src/config/autoModel.js";

describe("auto-mode model gating", () => {
  it("recognizes supported models (Opus 4.6+/Sonnet 4.6), rejects others", () => {
    expect(isAutoSupportedModel("claude-sonnet-4-6")).toBe(true);
    expect(isAutoSupportedModel("claude-opus-4-8")).toBe(true);
    expect(isAutoSupportedModel("claude-haiku-4-5-20251001")).toBe(false);
    expect(isAutoSupportedModel("claude-sonnet-4-5")).toBe(false);
    expect(isAutoSupportedModel(undefined)).toBe(false);
  });
  it("resolveAutoModel forces DEFAULT for unsupported/absent, preserves supported", () => {
    expect(DEFAULT_AUTO_MODEL).toBe("claude-sonnet-4-6");
    expect(resolveAutoModel("claude-haiku-4-5-20251001")).toBe("claude-sonnet-4-6");
    expect(resolveAutoModel(undefined)).toBe("claude-sonnet-4-6");
    expect(resolveAutoModel("claude-opus-4-6")).toBe("claude-opus-4-6");
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** — `cd harness && npx vitest run test/unit/auto-model.test.ts` → FAIL ("Cannot find module .../autoModel.js").

- [ ] **Step 3: Implement**

```ts
// harness/src/config/autoModel.ts
/** Models that support `auto` permission mode on the Anthropic API (Opus 4.6+ or Sonnet 4.6). On an
 *  unsupported model `auto` silently falls back to `default` (probe 18d), so the daemon forces a supported
 *  model when autonomy is requested. */
export const DEFAULT_AUTO_MODEL = "claude-sonnet-4-6";

const SUPPORTED = new Set(["claude-sonnet-4-6", "claude-opus-4-6", "claude-opus-4-7", "claude-opus-4-8"]);

export function isAutoSupportedModel(model: string | undefined): boolean {
  return model !== undefined && SUPPORTED.has(model);
}

/** The model an autonomous session actually runs on: the requested one if it supports `auto`, else DEFAULT. */
export function resolveAutoModel(model?: string): string {
  return isAutoSupportedModel(model) ? model! : DEFAULT_AUTO_MODEL;
}
```

- [ ] **Step 4: Run it — expect PASS** — `cd harness && npx vitest run test/unit/auto-model.test.ts` → PASS. Then `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add harness/src/config/autoModel.ts harness/test/unit/auto-model.test.ts
git commit -m "feat(daemon-perms): supported-model gating helper (autoModel)"
```

---

### Task 3: PendingPermissions registry + DaemonPermissionBroker + PendingEntry

**Files:**
- Create: `harness/src/daemon/permissions.ts`
- Modify: `harness/src/index.ts:37` (add the `PendingEntry` type export after the permission-seam export)
- Test: `harness/test/unit/daemon-permissions.test.ts`
- Test: `harness/test/unit/index.test.ts` (add a type-pin `it`)

**Interfaces:**
- Consumes: `createPermissionGate` is NOT used here (the supervisor wires it); `PermissionBroker`, `PermissionDecision`, `PermissionRequest` from `../permissions/types.js`.
- Produces: `interface PendingEntry { sessionId; toolUseID; toolName; input; title?; displayName?; description?; createdAt: number }`; `class PendingPermissions` with `brokerFor(sessionId: string): PermissionBroker`, `respond(toolUseID: string, decision: PermissionDecision): boolean`, `list(): PendingEntry[]`, `denyAllForSession(sessionId: string): void`, `denyAll(): void`; ctor opts `{ timeoutMs?: number; now?: () => number; schedule?: (fn, ms) => () => void }`.

- [ ] **Step 1: Write the failing test**

```ts
// harness/test/unit/daemon-permissions.test.ts
import { describe, it, expect } from "vitest";
import { PendingPermissions } from "../../src/daemon/permissions.js";
import type { PermissionRequest } from "../../src/permissions/types.js";

const req = (toolUseID: string, over: Partial<PermissionRequest> = {}): PermissionRequest =>
  ({ toolName: "Edit", input: { file_path: "f.ts" }, toolUseID, signal: new AbortController().signal, ...over });

describe("PendingPermissions", () => {
  it("park → respond resolves the awaited promise with the decision", async () => {
    const reg = new PendingPermissions({ now: () => 7 });
    const p = reg.brokerFor("sess-1").request(req("t1"));
    expect(reg.list()).toEqual([{ sessionId: "sess-1", toolUseID: "t1", toolName: "Edit", input: { file_path: "f.ts" }, createdAt: 7 }]);
    expect(reg.respond("t1", { kind: "allow_once" })).toBe(true);
    await expect(p).resolves.toEqual({ kind: "allow_once" });
    expect(reg.list()).toEqual([]);
  });

  it("park → timeout settles deny (no client / no answer)", async () => {
    let fire: () => void = () => {};
    const reg = new PendingPermissions({ schedule: (fn) => { fire = fn; return () => {}; } });
    const p = reg.brokerFor("s").request(req("t2"));
    fire();                                   // simulate the 30 s timeout elapsing
    await expect(p).resolves.toEqual({ kind: "deny" });
    expect(reg.list()).toEqual([]);
  });

  it("park → session teardown denies all of that session's pending; denyAll denies the rest", async () => {
    const reg = new PendingPermissions();
    const a = reg.brokerFor("s1").request(req("t3"));
    const b = reg.brokerFor("s2").request(req("t4"));
    reg.denyAllForSession("s1");
    await expect(a).resolves.toEqual({ kind: "deny" });
    expect(reg.list().map((e) => e.toolUseID)).toEqual(["t4"]); // s2 untouched
    reg.denyAll();
    await expect(b).resolves.toEqual({ kind: "deny" });
    expect(reg.list()).toEqual([]);
  });

  it("multi-answer is idempotent — the second respond is a no-op", async () => {
    const reg = new PendingPermissions();
    const p = reg.brokerFor("s").request(req("t5"));
    expect(reg.respond("t5", { kind: "allow_once" })).toBe(true);
    expect(reg.respond("t5", { kind: "deny" })).toBe(false);   // already settled
    await expect(p).resolves.toEqual({ kind: "allow_once" });
  });

  it("aborting the request signal settles deny and drops the entry (turn interrupted)", async () => {
    const reg = new PendingPermissions();
    const ac = new AbortController();
    const p = reg.brokerFor("s").request(req("t6", { signal: ac.signal }));
    ac.abort();
    await expect(p).resolves.toEqual({ kind: "deny" });
    expect(reg.list()).toEqual([]);
  });

  it("PendingEntry is serializable — no AbortSignal, round-trips through JSON", () => {
    const reg = new PendingPermissions({ now: () => 0 });
    reg.brokerFor("s").request(req("t7"));
    const entry = reg.list()[0];
    expect("signal" in entry).toBe(false);
    expect(JSON.parse(JSON.stringify(entry)).toolUseID).toBe("t7");
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** — `cd harness && npx vitest run test/unit/daemon-permissions.test.ts` → FAIL ("Cannot find module .../daemon/permissions.js").

- [ ] **Step 3: Implement the registry**

```ts
// harness/src/daemon/permissions.ts
import type { PermissionBroker, PermissionDecision, PermissionRequest } from "../permissions/types.js";

/** A parked permission request on the wire — the serializable view of a PermissionRequest (no AbortSignal). */
export interface PendingEntry {
  sessionId: string;
  toolUseID: string;
  toolName: string;
  input: Record<string, unknown>;
  title?: string;
  displayName?: string;
  description?: string;
  createdAt: number;
}

export interface PendingPermissionsOpts {
  timeoutMs?: number;                                    // park lifetime before auto-deny (default 30_000)
  now?: () => number;                                    // injectable clock (createdAt + tests)
  schedule?: (fn: () => void, ms: number) => () => void; // timeout scheduler → canceller (testing seam)
}

/** Supervisor-owned registry of parked daemon permission requests. A daemon session's canUseTool parks here
 *  (brokerFor(id).request) until a client answers (respond), the park times out, the request's signal aborts,
 *  or the session/daemon tears down (denyAllForSession / denyAll) — every path settles the awaited promise. */
export class PendingPermissions {
  private pending = new Map<string, { entry: PendingEntry; resolve: (d: PermissionDecision) => void; cancel: () => void }>();
  private timeoutMs: number;
  private now: () => number;
  private schedule: (fn: () => void, ms: number) => () => void;

  constructor(opts: PendingPermissionsOpts = {}) {
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.now = opts.now ?? Date.now;
    this.schedule = opts.schedule ?? ((fn, ms) => { const t = setTimeout(fn, ms); (t as any).unref?.(); return () => clearTimeout(t); });
  }

  /** A session-bound broker; its request() parks until settled. */
  brokerFor(sessionId: string): PermissionBroker {
    return { request: (req) => this.park(sessionId, req) };
  }

  private park(sessionId: string, req: PermissionRequest): Promise<PermissionDecision> {
    return new Promise((resolve) => {
      const entry: PendingEntry = {
        sessionId, toolUseID: req.toolUseID, toolName: req.toolName, input: req.input,
        title: req.title, displayName: req.displayName, description: req.description, createdAt: this.now(),
      };
      const cancelTimer = this.schedule(() => this.settle(req.toolUseID, { kind: "deny" }), this.timeoutMs);
      const onAbort = () => this.settle(req.toolUseID, { kind: "deny" });
      req.signal?.addEventListener("abort", onAbort, { once: true });
      const cancel = () => { cancelTimer(); req.signal?.removeEventListener("abort", onAbort); };
      this.pending.set(req.toolUseID, { entry, resolve, cancel });
    });
  }

  private settle(toolUseID: string, decision: PermissionDecision): boolean {
    const p = this.pending.get(toolUseID);
    if (!p) return false;
    p.cancel();
    this.pending.delete(toolUseID);
    p.resolve(decision);
    return true;
  }

  /** Answer a parked request. Returns false if none matches (already answered/timed out → idempotent). */
  respond(toolUseID: string, decision: PermissionDecision): boolean { return this.settle(toolUseID, decision); }

  /** The serializable list of currently-parked requests (for the poll). */
  list(): PendingEntry[] { return [...this.pending.values()].map((p) => p.entry); }

  /** Deny + settle every parked request for one session (session stop/teardown). */
  denyAllForSession(sessionId: string): void {
    for (const [id, p] of [...this.pending]) if (p.entry.sessionId === sessionId) this.settle(id, { kind: "deny" });
  }

  /** Deny + settle every parked request (daemon shutdown). */
  denyAll(): void { for (const id of [...this.pending.keys()]) this.settle(id, { kind: "deny" }); }
}
```

Note: `list()` builds entries with `title/displayName/description` possibly `undefined`; vitest `toEqual` ignores `undefined` properties, so the test expectations (which omit them) pass.

- [ ] **Step 4: Run it — expect PASS** — `cd harness && npx vitest run test/unit/daemon-permissions.test.ts` → 6 passing.

- [ ] **Step 5: Export the `PendingEntry` type + pin it**

In `harness/src/index.ts`, after line 37 (`export type { PermissionBroker, PermissionDecision, PermissionRequest } from "./permissions/types.js";`) add:

```ts
export type { PendingEntry } from "./daemon/permissions.js";
```

In `harness/test/unit/index.test.ts`, add a new `it` after the increment-3 permission-seam block (after line 40):

```ts
  it("exports the PendingEntry wire type (advanced-seam, increment 4)", () => {
    const _pe: api.PendingEntry = { sessionId: "s", toolUseID: "t", toolName: "Edit", input: {}, createdAt: 0 };
    expect(_pe.toolUseID).toBe("t");
  });
```

(The value-export `EXPECTED` array is unchanged — `PendingEntry` is type-only and erases at runtime.)

- [ ] **Step 6: Run it — expect PASS** — `cd harness && npx vitest run test/unit/index.test.ts test/unit/daemon-permissions.test.ts` → all pass. Then `npm run typecheck`.

- [ ] **Step 7: Commit**

```bash
git add harness/src/daemon/permissions.ts harness/src/index.ts harness/test/unit/daemon-permissions.test.ts harness/test/unit/index.test.ts
git commit -m "feat(daemon-perms): PendingPermissions registry + broker + PendingEntry wire type"
```

---

### Task 4: Supervisor wiring (broker injection + model forcing + teardown)

**Files:**
- Modify: `harness/src/daemon/types.ts:26-43` (add `permissionTimeoutMs?` to `DaemonOptions`)
- Modify: `harness/src/daemon/supervisor.ts` (imports; `SpawnConfig`; field + ctor; `spawn`; `makeSession`; `fork`; `stop`; `shutdown`; accessors)
- Test: `harness/test/unit/daemon-supervisor-permissions.test.ts`

**Interfaces:**
- Consumes: `PendingPermissions`, `PendingEntry` from `./permissions.js`; `createPermissionGate` from `../permissions/gate.js`; `resolveAutoModel` from `../config/autoModel.js`; `PermissionDecision` from `../permissions/types.js`.
- Produces: `DaemonSupervisor.spawn(opts: { model?; restart?; resume?; permissionMode?: string })`; `DaemonSupervisor.pendingPermissions(): PendingEntry[]`; `DaemonSupervisor.respondPermission(toolUseID: string, decision: PermissionDecision): boolean`. Every session built with `options.canUseTool` set.

- [ ] **Step 1: Write the failing test**

```ts
// harness/test/unit/daemon-supervisor-permissions.test.ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonSupervisor } from "../../src/daemon/supervisor.js";
import type { QueryFn } from "../../src/swarm/types.js";

const tmp = () => mkdtempSync(join(tmpdir(), "sup-perms-"));

// Fake query: capture each session's options; yield an init frame then hang so the session stays live.
function captureQuery(captured: any[]): QueryFn {
  return (({ options }: any) => { captured.push(options); return (async function* () {
    yield { type: "system", subtype: "init", session_id: "sdk-x" };
    await new Promise(() => {});
  })(); }) as unknown as QueryFn;
}
// Fake query that drives canUseTool once (fire-and-forget) so a request parks in the registry.
function gatingQuery(hold: { call?: Promise<any> }): QueryFn {
  return (({ options }: any) => (async function* () {
    yield { type: "system", subtype: "init", session_id: "sdk-x" };
    hold.call = options.canUseTool?.("Bash", { command: "x" }, { toolUseID: "tu", signal: new AbortController().signal });
    await new Promise(() => {});
  })()) as unknown as QueryFn;
}

describe("supervisor permission wiring", () => {
  it("auto + unsupported model forces sonnet-4-6 and sets permissionMode; broker wired", async () => {
    const cap: any[] = [];
    const sup = new DaemonSupervisor({ query: captureQuery(cap) }, { dir: tmp(), now: () => 0, idleTimeoutMs: 0 });
    const id = sup.spawn({ model: "claude-haiku-4-5-20251001", permissionMode: "auto" });
    expect(cap[0].model).toBe("claude-sonnet-4-6");
    expect(cap[0].permissionMode).toBe("auto");
    expect(typeof cap[0].canUseTool).toBe("function");
    expect(sup.list().find((r) => r.id === id)!.model).toBe("claude-sonnet-4-6");
    await sup.shutdown();
  });

  it("auto + no model → sonnet-4-6; auto + supported preserved; non-auto leaves model + still wires broker", async () => {
    const cap: any[] = [];
    const sup = new DaemonSupervisor({ query: captureQuery(cap) }, { dir: tmp(), now: () => 0, idleTimeoutMs: 0 });
    sup.spawn({ permissionMode: "auto" });
    sup.spawn({ model: "claude-opus-4-6", permissionMode: "auto" });
    sup.spawn({ model: "claude-haiku-4-5-20251001" });           // non-auto
    expect(cap[0].model).toBe("claude-sonnet-4-6");
    expect(cap[1].model).toBe("claude-opus-4-6");
    expect(cap[2].model).toBe("claude-haiku-4-5-20251001");
    expect(cap[2].permissionMode).toBeUndefined();
    expect(typeof cap[2].canUseTool).toBe("function");           // broker wired even in default mode (gap fix)
    await sup.shutdown();
  });

  it("a parked request surfaces in pendingPermissions(); respondPermission resolves it", async () => {
    const hold: { call?: Promise<any> } = {};
    const sup = new DaemonSupervisor({ query: gatingQuery(hold) }, { dir: tmp(), now: () => 0, idleTimeoutMs: 0 });
    sup.spawn({ model: "claude-sonnet-4-6" });
    await new Promise((r) => setTimeout(r, 10));                 // let the gating query call canUseTool
    const pending = sup.pendingPermissions();
    expect(pending.map((e) => e.toolUseID)).toEqual(["tu"]);
    expect(sup.respondPermission("tu", { kind: "allow_once" })).toBe(true);
    await expect(hold.call).resolves.toEqual({ behavior: "allow", updatedInput: { command: "x" } });
    expect(sup.pendingPermissions()).toEqual([]);
    await sup.shutdown();
  });

  it("stop() denies a parked request for that session", async () => {
    const hold: { call?: Promise<any> } = {};
    const sup = new DaemonSupervisor({ query: gatingQuery(hold) }, { dir: tmp(), now: () => 0, idleTimeoutMs: 0 });
    const id = sup.spawn({ model: "claude-sonnet-4-6" });
    await new Promise((r) => setTimeout(r, 10));
    expect(sup.pendingPermissions().length).toBe(1);
    await sup.stop(id);
    await expect(hold.call).resolves.toEqual({ behavior: "deny", message: "User denied Bash", interrupt: undefined });
    expect(sup.pendingPermissions()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** — `cd harness && npx vitest run test/unit/daemon-supervisor-permissions.test.ts` → FAIL (`spawn` rejects `permissionMode`; `pendingPermissions`/`respondPermission` not functions).

- [ ] **Step 3: Implement — `DaemonOptions`**

In `harness/src/daemon/types.ts`, inside `DaemonOptions` (after the `compactTool?` line, ~line 40) add:

```ts
  permissionTimeoutMs?: number; // parked permission-request lifetime before auto-deny (default 30_000)
```

- [ ] **Step 4: Implement — supervisor**

In `harness/src/daemon/supervisor.ts`:

(a) Add imports near the top (after the existing `./types.js` import):

```ts
import { PendingPermissions } from "./permissions.js";
import type { PendingEntry } from "./permissions.js";
import { createPermissionGate } from "../permissions/gate.js";
import type { PermissionDecision } from "../permissions/types.js";
import { resolveAutoModel } from "../config/autoModel.js";
```

(b) Extend `SpawnConfig` (line 31):

```ts
interface SpawnConfig { model?: string; restart: RestartPolicy; permissionMode?: string; }
```

(c) Add a field (with the other private fields, ~line 57):

```ts
  private pending: PendingPermissions;
```

(d) In the constructor, after `this.compactTool = opts.compactTool ?? false;` (line 71):

```ts
    this.pending = new PendingPermissions({ timeoutMs: opts.permissionTimeoutMs, now: this.now });
```

(e) Replace `spawn` (lines 100-109) with:

```ts
  spawn(opts: { model?: string; restart?: RestartPolicy; resume?: string; permissionMode?: string } = {}): string {
    if (this.pool.size >= this.maxSessions) throw new DaemonError(`max sessions (${this.maxSessions}) reached`);
    const id = `sess-${++this.seq}`;
    const model = opts.permissionMode === "auto" ? resolveAutoModel(opts.model) : opts.model; // force a supported model for auto
    const cfg: SpawnConfig = { model, restart: opts.restart ?? this.restartPolicy, permissionMode: opts.permissionMode };
    this.configs.set(id, cfg);
    this.pool.set(id, this.makeSession(id, cfg, opts.resume));
    const t = this.now();
    this.registry.register({ id, daemonPid: process.pid, status: "idle", model, restart: cfg.restart, createdAt: t, lastActiveAt: t });
    return id;
  }
```

(f) In `fork` (line 194), pass the source session's `permissionMode` through so a fork keeps its posture:

```ts
    const handle = this.spawn({ model: this.configs.get(id)?.model, resume: sessionId, permissionMode: this.configs.get(id)?.permissionMode }); // new daemon session on the branch
```

(g) Replace `makeSession` (lines 293-301) with (adds `permissionMode` to options + injects the broker gate):

```ts
  private makeSession(id: string, cfg: SpawnConfig, resume?: string): DaemonSession {
    const base: Record<string, unknown> = cfg.model ? { model: cfg.model } : {};
    if (resume) base.resume = resume;                        // spawn hint or captured sdk session id
    if (cfg.permissionMode) base.permissionMode = cfg.permissionMode;
    const extra = this.sessionOptions?.(id);                 // fresh servers + tool posture for THIS session
    const options = extra ? { ...base, ...extra } : base;    // factory keys win; never sets model
    options.canUseTool = createPermissionGate(this.pending.brokerFor(id)); // daemon-attached permission broker
    const session = new DaemonSession(id, { query: this.deps.query }, options, this.now, { contextTool: this.contextTool, compactTool: this.compactTool });
    session.done.then(() => this.handleSessionEnd(id)).catch(() => {}); // end hook
    return session;
  }
```

(h) In `stop` (line 235), add a deny-resolve just before `if (session) await session.dispose();` (after `this.cancelRestart(id);`, line 242):

```ts
    this.pending.denyAllForSession(id);                      // settle any parked permission so dispose() can drain
```

(i) In `shutdown` (line 250), add a deny-all just before the pool-dispose `Promise.all` (after the proactive clears, ~line 256):

```ts
    this.pending.denyAll();                                  // settle every parked permission across all sessions
```

(j) Add the two accessors (e.g. right after `proactiveStatus`, ~line 224):

```ts
  /** Currently-parked permission requests across all sessions (for the poll). */
  pendingPermissions(): PendingEntry[] { return this.pending.list(); }
  /** Answer a parked permission request; false if none matches (already answered/timed out). */
  respondPermission(toolUseID: string, decision: PermissionDecision): boolean { return this.pending.respond(toolUseID, decision); }
```

- [ ] **Step 5: Run it — expect PASS** — `cd harness && npx vitest run test/unit/daemon-supervisor-permissions.test.ts` → 4 passing. Then `npm run typecheck` and `npm run test:unit` (no regressions).

- [ ] **Step 6: Commit**

```bash
git add harness/src/daemon/types.ts harness/src/daemon/supervisor.ts harness/test/unit/daemon-supervisor-permissions.test.ts
git commit -m "feat(daemon-perms): supervisor wires broker into every session + forces supported model for auto"
```

---

### Task 5: Wire ops (`pending_permissions`, `permission_response`, `spawn.permissionMode`)

**Files:**
- Modify: `harness/src/daemon/types.ts:46,65` (`spawnOp` gains `permissionMode`; add `permissionDecision` schema + two new ops; extend the union)
- Modify: `harness/src/daemon/server.ts:71,70-97` (pass `permissionMode` to spawn; dispatch the two new ops)
- Test: `harness/test/unit/daemon-wire-permissions.test.ts`

**Interfaces:**
- Consumes: `DaemonSupervisor.pendingPermissions/respondPermission` (Task 4).
- Produces wire ops: `{ op: "pending_permissions" }` → `{ ok: true, pending: PendingEntry[] }`; `{ op: "permission_response", toolUseID: string, decision: PermissionDecision }` → `{ ok: true } | { ok: false, error: "no pending request" }`; `spawn` accepts `permissionMode?: string`.

- [ ] **Step 1: Write the failing test**

```ts
// harness/test/unit/daemon-wire-permissions.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { daemonOp } from "../../src/daemon/types.js";
import { DaemonSupervisor } from "../../src/daemon/supervisor.js";
import { DaemonServer } from "../../src/daemon/server.js";
import { daemonRequest } from "../../src/daemon/client.js";
import type { QueryFn } from "../../src/swarm/types.js";

const captureQuery: QueryFn = (({ options }: any) => { void options; return (async function* () {
  yield { type: "system", subtype: "init", session_id: "sdk-x" }; await new Promise(() => {});
})(); }) as unknown as QueryFn;

describe("permission wire ops", () => {
  it("the schema validates the new ops + spawn.permissionMode and rejects a bad decision", () => {
    expect(daemonOp.parse({ op: "pending_permissions" }).op).toBe("pending_permissions");
    expect(daemonOp.parse({ op: "permission_response", toolUseID: "t", decision: { kind: "deny" } }).op).toBe("permission_response");
    expect(daemonOp.parse({ op: "spawn", permissionMode: "auto" }).op).toBe("spawn");
    expect(() => daemonOp.parse({ op: "permission_response", toolUseID: "t", decision: { kind: "nope" } })).toThrow();
  });

  let server: DaemonServer | undefined;
  afterEach(async () => { await server?.close(); server = undefined; });

  it("dispatches pending_permissions (empty) and permission_response (no match → ok:false)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wire-perms-"));
    const sock = join(dir, "d.sock");
    const sup = new DaemonSupervisor({ query: captureQuery }, { dir: join(dir, "reg"), idleTimeoutMs: 0 });
    server = new DaemonServer(sup, sock);
    await server.listen();
    const [pend] = await daemonRequest(sock, { op: "pending_permissions" });
    expect(pend).toEqual({ ok: true, pending: [] });
    const [resp] = await daemonRequest(sock, { op: "permission_response", toolUseID: "ghost", decision: { kind: "deny" } });
    expect(resp).toEqual({ ok: false, error: "no pending request" });
    const [spawned] = await daemonRequest(sock, { op: "spawn", model: "claude-haiku-4-5-20251001", permissionMode: "auto" });
    expect(spawned.ok).toBe(true);
    expect(sup.list()[0].model).toBe("claude-sonnet-4-6");     // forced supported model, end-to-end over the wire
    await sup.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** — `cd harness && npx vitest run test/unit/daemon-wire-permissions.test.ts` → FAIL (unknown ops; `pending` undefined).

- [ ] **Step 3: Implement — `types.ts`**

In `harness/src/daemon/types.ts`, replace `spawnOp` (line 46):

```ts
const spawnOp = z.object({ op: z.literal("spawn"), model: z.string().optional(), restart: z.enum(["no", "on-failure"]).optional(), resume: z.string().optional(), permissionMode: z.string().optional() });
```

Add before the `daemonOp` union (after line 63):

```ts
const permissionDecision = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("allow_once") }),
  z.object({ kind: z.literal("allow_always") }),
  z.object({ kind: z.literal("deny") }),
]);
const pendingPermissionsOp = z.object({ op: z.literal("pending_permissions") });
const permissionResponseOp = z.object({ op: z.literal("permission_response"), toolUseID: z.string(), decision: permissionDecision });
```

Extend the union (line 65) by appending the two ops:

```ts
export const daemonOp = z.discriminatedUnion("op", [spawnOp, submitOp, listOp, stopOp, shutdownOp, controlOp, startProactiveOp, stopProactiveOp, sessionsOp, messagesOp, compactOp, forkOp, usageOp, initOp, applyFlagSettingsOp, renameSessionOp, tagSessionOp, deleteSessionOp, pendingPermissionsOp, permissionResponseOp]);
```

- [ ] **Step 4: Implement — `server.ts` dispatch**

In `harness/src/daemon/server.ts`, replace the `spawn` case (line 71):

```ts
        case "spawn": send({ ok: true, id: this.supervisor.spawn({ model: op.model, restart: op.restart, resume: op.resume, permissionMode: op.permissionMode }) }); sock.end(); break;
```

Add two cases inside the `switch` (e.g. after the `stop` case, line 86):

```ts
        case "pending_permissions": send({ ok: true, pending: this.supervisor.pendingPermissions() }); sock.end(); break;
        case "permission_response": { const ok = this.supervisor.respondPermission(op.toolUseID, op.decision); send(ok ? { ok: true } : { ok: false, error: "no pending request" }); sock.end(); break; }
```

- [ ] **Step 5: Run it — expect PASS** — `cd harness && npx vitest run test/unit/daemon-wire-permissions.test.ts` → passing. Then `npm run typecheck`.

- [ ] **Step 6: Commit**

```bash
git add harness/src/daemon/types.ts harness/src/daemon/server.ts harness/test/unit/daemon-wire-permissions.test.ts
git commit -m "feat(daemon-perms): pending_permissions + permission_response wire ops; spawn.permissionMode"
```

---

### Task 6: DaemonClient methods (`pendingPermissions`, `respondPermission`)

**Files:**
- Modify: `harness/src/daemon/connect.ts` (imports; `MonitorClient` optional method; `DaemonClient` methods; implementations)
- Test: `harness/test/unit/daemon-client-permissions.test.ts`
- Test: `harness/test/unit/index.test.ts` (extend the increment-4 pin with the two methods)

**Interfaces:**
- Consumes: wire ops (Task 5); `PendingEntry` (Task 3); `PermissionDecision`.
- Produces: `MonitorClient.pendingPermissions?(): Promise<PendingEntry[]>` (optional); `DaemonClient.pendingPermissions(): Promise<PendingEntry[]>` + `DaemonClient.respondPermission(toolUseID: string, decision: PermissionDecision): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```ts
// harness/test/unit/daemon-client-permissions.test.ts
import { describe, it, expect } from "vitest";
import { connectDaemon } from "../../src/daemon/connect.js";

describe("connectDaemon permission methods", () => {
  it("pendingPermissions sends the op and returns the pending array", async () => {
    const sent: any[] = [];
    const fake = async (_s: string, op: any) => { sent.push(op); return [{ ok: true, pending: [{ sessionId: "s", toolUseID: "t", toolName: "Edit", input: {}, createdAt: 0 }] }]; };
    const c = connectDaemon("/x", fake);
    expect(await c.pendingPermissions()).toEqual([{ sessionId: "s", toolUseID: "t", toolName: "Edit", input: {}, createdAt: 0 }]);
    expect(sent[0]).toEqual({ op: "pending_permissions" });
  });
  it("respondPermission sends toolUseID + decision and resolves on ok", async () => {
    const sent: any[] = [];
    const fake = async (_s: string, op: any) => { sent.push(op); return [{ ok: true }]; };
    await connectDaemon("/x", fake).respondPermission("tu", { kind: "allow_once" });
    expect(sent[0]).toEqual({ op: "permission_response", toolUseID: "tu", decision: { kind: "allow_once" } });
  });
  it("respondPermission throws when the daemon reports no pending request", async () => {
    const fake = async () => [{ ok: false, error: "no pending request" }];
    await expect(connectDaemon("/x", fake).respondPermission("gone", { kind: "deny" })).rejects.toThrow("no pending request");
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** — `cd harness && npx vitest run test/unit/daemon-client-permissions.test.ts` → FAIL (`pendingPermissions`/`respondPermission` not functions).

- [ ] **Step 3: Implement — `connect.ts`**

Add imports (after line 5):

```ts
import type { PendingEntry } from "./permissions.js";
import type { PermissionDecision } from "../permissions/types.js";
```

In `MonitorClient` (after `contextUsage`, line 10) add the OPTIONAL method (so the read-only `top` client + test fakes aren't broken):

```ts
  pendingPermissions?(): Promise<PendingEntry[]>;
```

In `DaemonClient` (after `stopProactive`, line 24) add:

```ts
  pendingPermissions(): Promise<PendingEntry[]>;
  respondPermission(toolUseID: string, decision: PermissionDecision): Promise<void>;
```

In the returned object (after `stopProactive`, line 52) add:

```ts
    async pendingPermissions() { return (await one({ op: "pending_permissions" })).pending as PendingEntry[]; },
    async respondPermission(toolUseID, decision) { await one({ op: "permission_response", toolUseID, decision }); },
```

- [ ] **Step 4: Extend the public-surface pin**

In `harness/test/unit/index.test.ts`, add to the increment-4 `it` (or a new `it` after it):

```ts
  it("exports the daemon permission client methods on connectDaemon's return (advanced-seam, increment 4)", () => {
    const c = api.connectDaemon("/x", (async () => []) as any);
    expect(typeof c.pendingPermissions).toBe("function");
    expect(typeof c.respondPermission).toBe("function");
  });
```

- [ ] **Step 5: Run it — expect PASS** — `cd harness && npx vitest run test/unit/daemon-client-permissions.test.ts test/unit/index.test.ts` → all pass. Then `npm run typecheck`.

- [ ] **Step 6: Commit**

```bash
git add harness/src/daemon/connect.ts harness/test/unit/daemon-client-permissions.test.ts harness/test/unit/index.test.ts
git commit -m "feat(daemon-perms): DaemonClient pendingPermissions + respondPermission"
```

---

### Task 7: Snapshot integration (`DashboardSnapshot.pending` + `collect`)

**Files:**
- Modify: `harness/src/monitor/snapshot.ts` (import + re-export `PendingEntry`; `DashboardSnapshot.pending`; `collect` pulls pending; both returns)
- Modify: `harness/test/unit/monitor-collect.test.ts:38` (strict-equality gains `pending: []`)
- Modify: `harness/test/unit/monitor-render.test.ts:6` (`base()` default gains `pending: []`)
- Test: extend `harness/test/unit/monitor-collect.test.ts` with a pending-surfacing case

**Interfaces:**
- Consumes: `MonitorClient.pendingPermissions?` (Task 6); `PendingEntry` (Task 3).
- Produces: `DashboardSnapshot.pending: PendingEntry[]`; `collect` populates it (guarded — `[]` when the client lacks the method or it throws, or the daemon is down).

- [ ] **Step 1: Write the failing test** — append to `harness/test/unit/monitor-collect.test.ts`:

```ts
  it("surfaces parked permissions in snapshot.pending; empty when the client lacks the method", async () => {
    const withPending: MonitorClient = {
      list: async () => [rec({ id: "a", status: "idle" })], contextUsage: async () => ({}),
      pendingPermissions: async () => [{ sessionId: "a", toolUseID: "t", toolName: "Edit", input: {}, createdAt: 0 }],
    };
    expect((await collect(withPending, { now: () => 0 })).pending).toEqual([{ sessionId: "a", toolUseID: "t", toolName: "Edit", input: {}, createdAt: 0 }]);
    const noPending: MonitorClient = { list: async () => [rec({ id: "a", status: "idle" })], contextUsage: async () => ({}) };
    expect((await collect(noPending, { now: () => 0 })).pending).toEqual([]);
  });
```

Also update the existing strict-equality at line 38 to include `pending: []`:

```ts
    expect(snap).toEqual({ daemonUp: false, sessions: [], proactive: undefined, at: 5, socketPath: "/sock", pending: [] });
```

- [ ] **Step 2: Run it — expect FAIL** — `cd harness && npx vitest run test/unit/monitor-collect.test.ts` → FAIL (`pending` undefined; strict-equality mismatch).

- [ ] **Step 3: Implement — `snapshot.ts`**

Add an import (after line 3) and a re-export (after line 6):

```ts
import type { PendingEntry } from "../daemon/permissions.js";
```
```ts
export type { PendingEntry } from "../daemon/permissions.js";
```

In `DashboardSnapshot` (after `socketPath?: string;`, line 23) add:

```ts
  pending: PendingEntry[];     // parked permission requests awaiting a human decision (increment 4)
```

In `collect`, the dead-daemon return (line 40) gains `pending: []`:

```ts
  catch { return { daemonUp: false, sessions: [], proactive: undefined, at: opts.now(), socketPath: opts.socketPath, pending: [] }; }
```

Before the success return (after the `for` loop, line 53) add:

```ts
  let pending: PendingEntry[] = [];
  try { pending = client.pendingPermissions ? await client.pendingPermissions() : []; }
  catch { /* a pending-fetch failure must not break the snapshot */ }
```

And the success return (line 54) gains `pending`:

```ts
  return { daemonUp: true, sessions, proactive: aggregateProactive(sessions.map((r) => r.proactive)), at: opts.now(), socketPath: opts.socketPath, pending };
```

- [ ] **Step 4: Fix the render-test helper** — in `harness/test/unit/monitor-render.test.ts`, line 6, add `pending: []` to `base()`'s defaults:

```ts
  ({ daemonUp: true, sessions: [], proactive: undefined, at: 600_000, socketPath: "/tmp/sock", pending: [], ...over });
```

- [ ] **Step 5: Run it — expect PASS** — `cd harness && npx vitest run test/unit/monitor-collect.test.ts test/unit/monitor-render.test.ts test/unit/monitor-app.test.ts` → all pass. Then `npm run typecheck` and `npm run test:unit` (full keyless suite green).

- [ ] **Step 6: Build the package (so `tui/` can consume it next)** — `cd harness && npm run build`. Expected: clean build, `dist/index.d.ts` updated.

- [ ] **Step 7: Commit**

```bash
git add harness/src/monitor/snapshot.ts harness/test/unit/monitor-collect.test.ts harness/test/unit/monitor-render.test.ts
git commit -m "feat(daemon-perms): surface parked permissions in DashboardSnapshot.pending"
```

---

### Task 8: Console integration (`PermissionDialog` over the daemon poll)

**Files:**
- Modify: `tui/src/PermissionDialog.tsx:5,13` (widen the prop type so `PendingEntry` satisfies it)
- Modify: `tui/src/useDaemon.ts` (imports; `EMPTY`; `DaemonView` gains `pending` + `respond`; the `respond` action; return)
- Modify: `tui/src/App.tsx` (import + render `PermissionDialog` when pending; gate the two `useInput` blocks while a dialog is up)
- Test: `tui/test/console-permission.test.tsx`

**Interfaces:**
- Consumes: `DashboardSnapshot.pending` (Task 7); `DaemonClient.respondPermission` (Task 6); `PendingEntry`, `PermissionDecision` from `cc-harness`.
- Produces: `DaemonView.pending: PendingEntry[]`; `DaemonView.respond(toolUseID: string, decision: PermissionDecision): void`.

- [ ] **Step 1: Build the harness first** — `cd ../harness && npm run build` (the build-first rule; `tui/` resolves `cc-harness` types from `harness/dist`).

- [ ] **Step 2: Write the failing test**

```tsx
// tui/test/console-permission.test.tsx
import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { App } from "../src/App.js";

const frame = (f: () => string | undefined) => f() ?? "";
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await new Promise((r) => setTimeout(r, 0)); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}

function fakeClient(responded: Array<[string, unknown]>): any {
  return {
    list: async () => [{ id: "sess-1", daemonPid: 1, status: "idle", model: "claude-sonnet-4-6", createdAt: 0, lastActiveAt: 0 }],
    contextUsage: async () => ({ totalTokens: 5, maxTokens: 100 }),
    pendingPermissions: async () => [{ sessionId: "sess-1", toolUseID: "tu1", toolName: "Edit", input: { file_path: "f.ts" }, createdAt: 0 }],
    respondPermission: async (id: string, dec: unknown) => { responded.push([id, dec]); },
  };
}

describe("<App> daemon permission dialog", () => {
  it("surfaces a parked permission as a dialog and 'a' answers allow_once", async () => {
    const responded: Array<[string, unknown]> = [];
    const { stdin, lastFrame } = render(<App client={fakeClient(responded)} hookOpts={{ schedule: () => () => {} }} />);
    await waitFor(() => frame(lastFrame).includes("Permission needed")); // poll surfaced the parked request
    expect(lastFrame()).toContain("Edit");
    stdin.write("a");
    await waitFor(() => responded.length > 0);
    expect(responded[0]).toEqual(["tu1", { kind: "allow_once" }]);
  });
});
```

- [ ] **Step 3: Run it — expect FAIL** — `cd tui && npx vitest run test/console-permission.test.tsx` → FAIL (no "Permission needed" — App does not render the dialog yet).

- [ ] **Step 4: Implement — `PermissionDialog.tsx`** (widen the prop so a `PendingEntry` satisfies it)

Replace line 5:

```ts
import type { PermissionDecision } from "cc-harness";
```

Replace the component signature (line 13) — accept the minimal structural view both `PermissionRequest` (chat REPL) and `PendingEntry` (console) satisfy:

```ts
export function PermissionDialog({ req, onDecision }: { req: { toolName: string; input: Record<string, unknown>; title?: string }; onDecision: (d: PermissionDecision) => void }) {
```

- [ ] **Step 5: Implement — `useDaemon.ts`**

Extend the import (line 3):

```ts
import type { DaemonClient, DashboardSnapshot, SessionRow, PendingEntry, PermissionDecision } from "cc-harness";
```

`EMPTY` (line 6) gains `pending`:

```ts
const EMPTY: DashboardSnapshot = { daemonUp: false, sessions: [], at: 0, pending: [] };
```

`DaemonView` (after `teardown(): void;`, line 35) gains:

```ts
  pending: PendingEntry[];
  respond(toolUseID: string, decision: PermissionDecision): void;
```

Add the `respond` action (after `stop`, ~line 148):

```ts
  const respond = useCallback((toolUseID: string, decision: PermissionDecision) => {
    client.respondPermission(toolUseID, decision)
      .then(() => { if (!disposed.current) void tick(); })       // refresh the poll so the dialog clears
      .catch((e) => { if (!disposed.current) setStatus(`respond: ${msg(e)}`); });
  }, [client, tick]);
```

Extend the return (line 150-151) with `pending` + `respond`:

```ts
  return { snapshot, selectedIndex: idx, selected, focus, stream, status, pending: snapshot.pending,
    select, focusInput, focusList, submit, interrupt, cycleModel, cyclePermissionMode, compact, fork, toggleProactive, spawn, stop, respond, teardown };
```

- [ ] **Step 6: Implement — `App.tsx`**

Add the import (after line 9):

```ts
import { PermissionDialog } from "./PermissionDialog.js";
```

Inside `App`, after `const d = useDaemon(...)` (line 12) derive the first parked request:

```ts
  const pending = d.pending[0];
```

Gate BOTH `useInput` blocks while a dialog is up — change the two `isActive` guards (lines 35 and 38):

```ts
  }, { isActive: d.focus === "list" && !confirm && !pending });
```
```ts
  useInput((_input, key) => { if (key.escape) d.focusList(); }, { isActive: d.focus === "input" && !confirm && !pending });
```

Render the dialog (add to the returned tree, before the `<StatusBar .../>`, line 48):

```tsx
      {pending ? <PermissionDialog req={pending} onDecision={(dec) => d.respond(pending.toolUseID, dec)} /> : null}
```

- [ ] **Step 7: Run it — expect PASS** — `cd tui && npx vitest run test/console-permission.test.tsx` → PASS. Then `npm run typecheck` and `npx vitest run` (full keyless tui suite green — confirms the chat REPL's `PermissionDialog` use still type-checks against the widened prop).

- [ ] **Step 8: Commit**

```bash
git add tui/src/PermissionDialog.tsx tui/src/useDaemon.ts tui/src/App.tsx tui/test/console-permission.test.tsx
git commit -m "feat(daemon-perms): console renders PermissionDialog from the daemon poll"
```

---

### Task 9: Gated live e2e + docs refresh

**Files:**
- Test: `harness/test/live/daemon-permissions.e2e.test.ts`
- Modify: `docs/parity/coverage.md` (Domain 10 row + %)
- Modify: `harness/API-STABILITY.md` (advanced-seam rows)
- Modify: `tui/CLAUDE.md` (note the console permission dialog)

**Interfaces:**
- Consumes: the whole stack (Tasks 2-8) + the real SDK `query`.

- [ ] **Step 1: Write the gated live test**

```ts
// harness/test/live/daemon-permissions.e2e.test.ts
import { describe, it, expect } from "vitest";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonSupervisor } from "../../src/daemon/supervisor.js";
import type { PendingEntry } from "../../src/daemon/permissions.js";

const live = process.env.ANTHROPIC_API_KEY ? describe : describe.skip;

function workdir(): string {
  const dir = mkdtempSync(join(tmpdir(), "daemon-perms-live-"));
  writeFileSync(join(dir, "note.txt"), "ORIGINAL\n");
  return dir;
}
async function waitForPending(sup: DaemonSupervisor, timeoutMs: number): Promise<PendingEntry> {
  const start = Date.now();
  for (;;) {
    const p = sup.pendingPermissions();
    if (p.length) return p[0];
    if (Date.now() - start > timeoutMs) throw new Error("no pending permission appeared");
    await new Promise((r) => setTimeout(r, 250));
  }
}

live("daemon-attached interactive permissions (live)", () => {
  it("default-mode session: an edit parks → respond allow → applies", async () => {
    const cwd = workdir();
    const sup = new DaemonSupervisor({ query }, { dir: join(cwd, "reg"), idleTimeoutMs: 0, sessionOptions: () => ({ cwd, settingSources: [] }) });
    const id = sup.spawn({ model: "claude-sonnet-4-6" });          // default mode → Edit routes to the broker
    const submitP = sup.submit(id, "Edit note.txt, replacing ORIGINAL with CHANGED. Do nothing else.", () => {});
    const entry = await waitForPending(sup, 60_000);
    expect(entry.sessionId).toBe(id);
    expect(sup.respondPermission(entry.toolUseID, { kind: "allow_once" })).toBe(true);
    await submitP;
    expect(readFileSync(join(cwd, "note.txt"), "utf8")).toContain("CHANGED");
    await sup.shutdown();
  }, 90_000);

  it("auto session on sonnet-4-6: an edit auto-approves with no pending", async () => {
    const cwd = workdir();
    const sup = new DaemonSupervisor({ query }, { dir: join(cwd, "reg"), idleTimeoutMs: 0, sessionOptions: () => ({ cwd, settingSources: [] }) });
    const id = sup.spawn({ model: "claude-sonnet-4-6", permissionMode: "auto" }); // classifier owns the trusted surface
    await sup.submit(id, "Edit note.txt, replacing ORIGINAL with CHANGED. Do nothing else.", () => {});
    expect(sup.pendingPermissions()).toEqual([]);                  // never parked — no human in the loop
    expect(readFileSync(join(cwd, "note.txt"), "utf8")).toContain("CHANGED");
    await sup.shutdown();
  }, 90_000);
});
```

- [ ] **Step 2: Verify it skips keyless** — `cd harness && npx vitest run test/live/daemon-permissions.e2e.test.ts` → both tests SKIPPED (no key). The controller runs it keyed: `cd harness && set -a; . ../.env; set +a; npx vitest run test/live/daemon-permissions.e2e.test.ts` → both PASS (default parks→applies; auto applies with no pending).

- [ ] **Step 3: Refresh `docs/parity/coverage.md`** — in the Domain 10 (interactive/permissions/UI) section, mark **daemon-attached interactive permissions** shipped (auto-autonomy + poll-based escape-hatch wire), and bump the domain percentage one notch (e.g. `~30%` → `~34%`). Match the existing row/notation style.

- [ ] **Step 4: Refresh `harness/API-STABILITY.md`** — under the advanced-seam section, add two rows mirroring the increment-3 `createPermissionGate` row: `PendingEntry` (the serializable parked-permission wire type) and `DaemonClient.pendingPermissions()` / `DaemonClient.respondPermission()` (the daemon poll/answer permission methods, increment 4).

- [ ] **Step 5: Refresh `tui/CLAUDE.md`** — in the "Daemon console" module map, note that `App.tsx` now renders the shared `PermissionDialog` when `snapshot.pending` is non-empty, answering via `respondPermission` (increment 4).

- [ ] **Step 6: Commit**

```bash
git add harness/test/live/daemon-permissions.e2e.test.ts docs/parity/coverage.md harness/API-STABILITY.md tui/CLAUDE.md
git commit -m "test(daemon-perms): gated live e2e + docs refresh (increment 4 shipped)"
```

---

## Self-Review

**Spec coverage:** Layer A force-model (Task 2 + 4) ✓; Layer B registry/broker (Task 3) ✓; supervisor injection + teardown (Task 4) ✓; wire ops (Task 5) ✓; DaemonClient methods (Task 6) ✓; snapshot.pending (Task 7) ✓; console dialog (Task 8) ✓; 4 teardown-liveness + serialization unit tests (Task 3) ✓; supported-model enforcement (Task 2 + 4) ✓; wire round-trip via fake request fn (Task 6) ✓; keyless console test with ink timing discipline (Task 8) ✓; gated live default-parks + auto-no-pending (Task 9) ✓; open-Q-b probe FIRST (Task 1) ✓; public-surface pin + API-STABILITY + coverage refresh (Tasks 3/6/9) ✓. No-ask-rules / no-deny-floor honored (nothing adds either). 30 s timeout-deny (Task 3 default) ✓.

**Type consistency:** `PendingEntry` shape identical across permissions.ts (def), connect.ts, snapshot.ts, server response, and tests. `PermissionDecision` is the existing `{kind: "allow_once"|"allow_always"|"deny"}` reused everywhere (gate.ts, zod schema in types.ts, client, dialog). `spawn({…, permissionMode})` signature matches across supervisor, server dispatch, and types `spawnOp`. `pendingPermissions()`/`respondPermission()` names identical in supervisor, server, connect, useDaemon, tests. `brokerFor`/`respond`/`list`/`denyAllForSession`/`denyAll` consistent between permissions.ts and supervisor calls.

**Placeholder scan:** none — every code/test step carries complete code; the only doc-prose steps (Task 9 §3-5) name the exact file, section, and content to add.
