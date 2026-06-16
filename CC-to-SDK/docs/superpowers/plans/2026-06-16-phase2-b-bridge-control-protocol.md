# Phase 2 B — Bridge (Control-Request Protocol) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A transport-agnostic control-plane that translates inbound control frames (`initialize` / `set_model` / `set_permission_mode` / `set_thinking` / `interrupt`) into the SDK `Query`'s runtime control methods on a live streaming session, with a daemon binding so a driver can retune a running daemon session.

**Architecture:** A new `src/bridge/` core owns the control-frame protocol (a zod discriminated union) and `ControlBridge.apply(session, frame)`, which feature-detects and calls the matching method on a `ControllableSession` interface — pure translation, no transport, never throws. `DaemonSession` implements `ControllableSession` (guarded delegations to its `Query`). The daemon transport gains one `control` op that delegates to `supervisor.control` → `ControlBridge.apply`. The control op is one-op-per-connection like every daemon op, so `interrupt` on a second connection stops a `submit` streaming on the first.

**Tech Stack:** TypeScript ESM (`.js` import specifiers), `zod/v4`, `@anthropic-ai/claude-agent-sdk`, `vitest`. Builds on the D1–D3 daemon.

**Spec:** `docs/superpowers/specs/2026-06-16-phase2-b-bridge-control-protocol-design.md`

---

## File Structure

- **New** `src/bridge/types.ts` — `controlFrame` zod union, `ControllableSession` interface, `ControlResponse` type.
- **New** `src/bridge/control.ts` — `ControlBridge.apply` (pure translation, feature-detect, no throw).
- **New** `src/bridge/index.ts` — re-exports.
- **Modify** `src/daemon/session.ts` — `DaemonSession implements ControllableSession`.
- **Modify** `src/daemon/types.ts` — add `controlOp` to the `daemonOp` union.
- **Modify** `src/daemon/server.ts` — route the `control` op.
- **Modify** `src/daemon/supervisor.ts` — `async control(id, frame)`.
- **New** `test/unit/bridge.test.ts`, **New** `test/unit/daemon-session-control.test.ts`, **Modify** `test/unit/daemon-supervisor.test.ts`, **Modify** `test/live/daemon.test.ts`.

`src/daemon/` depends on `src/bridge/`; `src/bridge/` depends on neither daemon nor a transport (acyclic).

---

### Task 1: Bridge core (frame protocol + `ControlBridge`)

**Files:**
- Create: `src/bridge/types.ts`, `src/bridge/control.ts`, `src/bridge/index.ts`
- Test: `test/unit/bridge.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/unit/bridge.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ControlBridge } from "../../src/bridge/control.js";
import { controlFrame } from "../../src/bridge/types.js";
import type { ControllableSession } from "../../src/bridge/types.js";

function fakeSession(calls: any[], overrides: Partial<ControllableSession> = {}): ControllableSession {
  return {
    setModel: async (m) => { calls.push(["setModel", m]); },
    setPermissionMode: async (mode) => { calls.push(["setPermissionMode", mode]); },
    setMaxThinkingTokens: async (n) => { calls.push(["setMaxThinkingTokens", n]); },
    interrupt: async () => { calls.push(["interrupt"]); },
    capabilities: async () => ({ models: [{ value: "m1" }], commands: [{ name: "help" }], mcpServers: [] }),
    ...overrides,
  };
}

describe("ControlBridge", () => {
  it("routes each frame to the matching method with the right args", async () => {
    const calls: any[] = [];
    const s = fakeSession(calls);
    expect(await ControlBridge.apply(s, { type: "set_model", model: "x" })).toEqual({ ok: true });
    expect(await ControlBridge.apply(s, { type: "set_permission_mode", mode: "plan" })).toEqual({ ok: true });
    expect(await ControlBridge.apply(s, { type: "set_thinking", maxTokens: 0 })).toEqual({ ok: true });
    expect(await ControlBridge.apply(s, { type: "interrupt" })).toEqual({ ok: true });
    expect(calls).toEqual([["setModel", "x"], ["setPermissionMode", "plan"], ["setMaxThinkingTokens", 0], ["interrupt"]]);
  });
  it("initialize returns the capabilities payload", async () => {
    const r = await ControlBridge.apply(fakeSession([]), { type: "initialize" });
    expect(r).toMatchObject({ ok: true, models: [{ value: "m1" }], commands: [{ name: "help" }], mcpServers: [] });
  });
  it("reports unsupported for a missing method (never throws)", async () => {
    const s = fakeSession([], { setModel: undefined });
    expect(await ControlBridge.apply(s, { type: "set_model", model: "x" })).toEqual({ ok: false, error: "unsupported: setModel" });
  });
  it("converts a throwing method into a structured error", async () => {
    const s = fakeSession([], { setModel: async () => { throw new Error("bad model"); } });
    expect(await ControlBridge.apply(s, { type: "set_model", model: "x" })).toEqual({ ok: false, error: "bad model" });
  });
  it("initialize converts a throwing capabilities() into a structured error", async () => {
    const s = fakeSession([], { capabilities: async () => { throw new Error("cap boom"); } });
    expect(await ControlBridge.apply(s, { type: "initialize" })).toEqual({ ok: false, error: "cap boom" });
  });
  it("controlFrame rejects an unknown frame type and accepts valid ones", () => {
    expect(controlFrame.safeParse({ type: "nope" }).success).toBe(false);
    expect(controlFrame.safeParse({ type: "set_model", model: "x" }).success).toBe(true);
    expect(controlFrame.safeParse({ type: "set_permission_mode", mode: "bogus" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd CC-to-SDK/harness && node node_modules/.bin/vitest run test/unit/bridge.test.ts`
Expected: FAIL — cannot resolve `../../src/bridge/control.js` / `types.js` (modules not created yet).

- [ ] **Step 3: Create `src/bridge/types.ts`**

```ts
import { z } from "zod/v4";

/** A live session the bridge can control. The control methods are optional → the bridge feature-detects
 *  and reports `unsupported` for any the session does not provide (fake/partial sessions, SDK drift). */
export interface ControllableSession {
  setModel?(model?: string): Promise<void>;
  setPermissionMode?(mode: string): Promise<void>;
  setMaxThinkingTokens?(maxTokens: number | null): Promise<void>;
  interrupt?(): Promise<void>;
  capabilities(): Promise<{ models: unknown[]; commands: unknown[]; mcpServers: unknown[] }>;
}

// Full SDK PermissionMode (sdk.d.ts:2055); the bridge translates faithfully and does not restrict the set.
const permissionMode = z.enum(["default", "acceptEdits", "bypassPermissions", "plan", "dontAsk", "auto"]);

export const controlFrame = z.discriminatedUnion("type", [
  z.object({ type: z.literal("initialize") }),
  z.object({ type: z.literal("set_model"), model: z.string().optional() }),
  z.object({ type: z.literal("set_permission_mode"), mode: permissionMode }),
  z.object({ type: z.literal("set_thinking"), maxTokens: z.number().nullable() }),
  z.object({ type: z.literal("interrupt") }),
]);
export type ControlFrame = z.infer<typeof controlFrame>;

export type ControlResponse = ({ ok: true } & Record<string, unknown>) | { ok: false; error: string };
```

- [ ] **Step 4: Create `src/bridge/control.ts`**

```ts
import type { ControllableSession, ControlFrame, ControlResponse } from "./types.js";

/** Translate a control frame into a ControllableSession method call. Never throws — feature-detects the
 *  target method and converts both "missing method" and "method rejected" into a structured response. */
export class ControlBridge {
  static async apply(session: ControllableSession, frame: ControlFrame): Promise<ControlResponse> {
    switch (frame.type) {
      case "initialize":
        try { return { ok: true, ...(await session.capabilities()) }; }
        catch (e) { return { ok: false, error: (e as Error).message }; }
      case "set_model":
        return ControlBridge.call(session.setModel, "setModel", session, frame.model);
      case "set_permission_mode":
        return ControlBridge.call(session.setPermissionMode, "setPermissionMode", session, frame.mode);
      case "set_thinking":
        return ControlBridge.call(session.setMaxThinkingTokens, "setMaxThinkingTokens", session, frame.maxTokens);
      case "interrupt":
        return ControlBridge.call(session.interrupt, "interrupt", session);
    }
  }

  private static async call(
    method: ((...args: any[]) => Promise<void>) | undefined,
    name: string,
    self: ControllableSession,
    ...args: unknown[]
  ): Promise<ControlResponse> {
    if (typeof method !== "function") return { ok: false, error: `unsupported: ${name}` };
    try { await method.apply(self, args); return { ok: true }; }
    catch (e) { return { ok: false, error: (e as Error).message }; }
  }
}
```

- [ ] **Step 5: Create `src/bridge/index.ts`**

```ts
export { ControlBridge } from "./control.js";
export { controlFrame } from "./types.js";
export type { ControllableSession, ControlFrame, ControlResponse } from "./types.js";
```

- [ ] **Step 6: Run to verify it passes + typecheck**

Run: `cd CC-to-SDK/harness && node node_modules/.bin/vitest run test/unit/bridge.test.ts && npx tsc --noEmit`
Expected: PASS (6 tests) and tsc clean.

- [ ] **Step 7: Commit**

```bash
git add CC-to-SDK/harness/src/bridge CC-to-SDK/harness/test/unit/bridge.test.ts
git commit -m "feat(harness): bridge control-frame protocol + ControlBridge (Phase 2 B core)"
```

---

### Task 2: `DaemonSession implements ControllableSession`

**Files:**
- Modify: `src/daemon/session.ts`
- Test: `test/unit/daemon-session-control.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/unit/daemon-session-control.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { DaemonSession } from "../../src/daemon/session.js";

// A fake query() return that is BOTH an async generator AND carries the SDK control methods.
function controllableQuery(calls: any[]) {
  return ({ prompt }: any) => {
    const gen = (async function* () { for await (const _t of prompt) yield { type: "result", result: "ok" }; })();
    return Object.assign(gen, {
      setModel: async (m?: string) => { calls.push(["setModel", m]); },
      setPermissionMode: async (mode: string) => { calls.push(["setPermissionMode", mode]); },
      setMaxThinkingTokens: async (n: number | null) => { calls.push(["setMaxThinkingTokens", n]); },
      interrupt: async () => { calls.push(["interrupt"]); },
      supportedModels: async () => [{ value: "m1", displayName: "M1" }],
      supportedCommands: async () => [{ name: "help" }],
      mcpServerStatus: async () => [{ name: "cc-tasks" }],
    });
  };
}

describe("DaemonSession control surface", () => {
  it("delegates control methods to its Query and reports capabilities", async () => {
    const calls: any[] = [];
    const s = new DaemonSession("s1", { query: controllableQuery(calls) }, {});
    await s.setModel("x");
    await s.setPermissionMode("plan");
    await s.setMaxThinkingTokens(0);
    await s.interrupt();
    expect(calls).toEqual([["setModel", "x"], ["setPermissionMode", "plan"], ["setMaxThinkingTokens", 0], ["interrupt"]]);
    expect(await s.capabilities()).toEqual({
      models: [{ value: "m1", displayName: "M1" }], commands: [{ name: "help" }], mcpServers: [{ name: "cc-tasks" }],
    });
    await s.dispose();
  });
  it("setters reject once ended; interrupt stays a safe no-op", async () => {
    const calls: any[] = [];
    const s = new DaemonSession("s2", { query: controllableQuery(calls) }, {});
    await s.dispose();                                       // input.close() → readLoop ends → ended
    await expect(s.setModel("x")).rejects.toThrow(/not running/);
    await expect(s.interrupt()).resolves.toBeUndefined();   // no assert-running → no throw
    expect(calls.filter((c) => c[0] === "setModel")).toEqual([]); // setter never delegated
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd CC-to-SDK/harness && node node_modules/.bin/vitest run test/unit/daemon-session-control.test.ts`
Expected: FAIL — `s.setModel`/`s.capabilities` are not functions (DaemonSession has no control surface yet).

- [ ] **Step 3: Implement the control surface in `DaemonSession`**

In `src/daemon/session.ts`, add the import near the top (after the existing imports):

```ts
import type { ControllableSession } from "../bridge/types.js";
```

Change the class declaration `export class DaemonSession {` to:

```ts
export class DaemonSession implements ControllableSession {
```

Add these methods inside the class, immediately after the `dispose()` method:

```ts
  // ---- control surface (Phase 2 B): guarded delegations to the underlying Query ----
  private assertRunning(): void { if (this.ended) throw new Error(`session ${this.id} is not running`); }

  async setModel(model?: string): Promise<void> { this.assertRunning(); await (this.q as any).setModel?.(model); }
  async setPermissionMode(mode: string): Promise<void> { this.assertRunning(); await (this.q as any).setPermissionMode?.(mode); }
  async setMaxThinkingTokens(maxTokens: number | null): Promise<void> { this.assertRunning(); await (this.q as any).setMaxThinkingTokens?.(maxTokens); }
  async interrupt(): Promise<void> { await (this.q as any).interrupt?.(); } // benign no-op even if ended

  async capabilities(): Promise<{ models: unknown[]; commands: unknown[]; mcpServers: unknown[] }> {
    const q = this.q as any;
    const [models, commands, mcpServers] = await Promise.all([
      q.supportedModels?.() ?? [], q.supportedCommands?.() ?? [], q.mcpServerStatus?.() ?? [],
    ]);
    return { models, commands, mcpServers };
  }
```

- [ ] **Step 4: Run to verify it passes + typecheck**

Run: `cd CC-to-SDK/harness && node node_modules/.bin/vitest run test/unit/daemon-session-control.test.ts && npx tsc --noEmit`
Expected: PASS (2 tests) and tsc clean.

- [ ] **Step 5: Commit**

```bash
git add CC-to-SDK/harness/src/daemon/session.ts CC-to-SDK/harness/test/unit/daemon-session-control.test.ts
git commit -m "feat(harness): DaemonSession implements ControllableSession (Phase 2 B)"
```

---

### Task 3: Daemon binding (`control` op + server route + `supervisor.control`)

**Files:**
- Modify: `src/daemon/types.ts`, `src/daemon/server.ts`, `src/daemon/supervisor.ts`
- Test: `test/unit/daemon-supervisor.test.ts`

- [ ] **Step 1: Write the failing tests**

In `test/unit/daemon-supervisor.test.ts`, add the import beside the existing imports:

```ts
import { daemonOp } from "../../src/daemon/types.js";
```

Add this `controllableQuery` helper next to the existing top-of-file `fakeQuery`/`captureQuery` helpers:

```ts
function controllableQuery(calls: any[]) {
  return ({ prompt }: any) => {
    const gen = (async function* () { for await (const _t of prompt) yield { type: "result", result: "ok" }; })();
    return Object.assign(gen, {
      setModel: async (m?: string) => { calls.push(["setModel", m]); },
      interrupt: async () => { calls.push(["interrupt"]); },
      supportedModels: async () => [{ value: "m1" }],
      supportedCommands: async () => [{ name: "help" }],
      mcpServerStatus: async () => [],
    });
  };
}
```

Append this test at the END of the `describe("DaemonSupervisor", ...)` block:

```ts
  // ---- Phase 2 B: control op ----
  it("control routes a frame to the pooled session via ControlBridge; unknown id throws", async () => {
    const calls: any[] = [];
    const sup = new DaemonSupervisor({ query: controllableQuery(calls) }, { dir: dir() });
    const id = sup.spawn();
    expect(await sup.control(id, { type: "set_model", model: "x" })).toEqual({ ok: true });
    expect(calls).toContainEqual(["setModel", "x"]);
    expect((await sup.control(id, { type: "initialize" })).ok).toBe(true);
    await expect(sup.control("ghost", { type: "interrupt" })).rejects.toThrow(/unknown session/);
    await sup.shutdown();
  });
  it("daemonOp accepts a control op", () => {
    expect(daemonOp.safeParse({ op: "control", id: "s1", frame: { type: "interrupt" } }).success).toBe(true);
    expect(daemonOp.safeParse({ op: "control", id: "s1", frame: { type: "bogus" } }).success).toBe(false);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd CC-to-SDK/harness && node node_modules/.bin/vitest run test/unit/daemon-supervisor.test.ts`
Expected: FAIL — `sup.control` is not a function, and `daemonOp` rejects the control op (not in the union yet).

- [ ] **Step 3: Add `controlOp` to the `daemonOp` union**

In `src/daemon/types.ts`, add the import at the top (after the `zod/v4` import):

```ts
import { controlFrame } from "../bridge/types.js";
```

Add the op definition next to the other `*Op` definitions (after `shutdownOp`):

```ts
const controlOp = z.object({ op: z.literal("control"), id: z.string(), frame: controlFrame });
```

Add `controlOp` to the union:

```ts
export const daemonOp = z.discriminatedUnion("op", [spawnOp, submitOp, listOp, stopOp, shutdownOp, controlOp]);
```

- [ ] **Step 4: Add `control` to the supervisor**

In `src/daemon/supervisor.ts`, add the imports (after the existing `../swarm/coordinator.js` import):

```ts
import { ControlBridge } from "../bridge/control.js";
import type { ControlFrame, ControlResponse } from "../bridge/types.js";
```

Add this method to `DaemonSupervisor`, immediately after the `list()` method:

```ts
  async control(id: string, frame: ControlFrame): Promise<ControlResponse> {
    const session = this.pool.get(id);
    if (!session) {
      const rec = this.registry.get(id);
      throw new DaemonError(rec ? `session ${id} is ${rec.status}` : `unknown session ${id}`);
    }
    return ControlBridge.apply(session, frame);
  }
```

- [ ] **Step 5: Route the `control` op in the server**

In `src/daemon/server.ts`, add this case inside the `switch (op.op)` block (e.g. after the `list` case):

```ts
        case "control": send(await this.supervisor.control(op.id, op.frame)); sock.end(); break;
```

- [ ] **Step 6: Run to verify it passes + typecheck**

Run: `cd CC-to-SDK/harness && node node_modules/.bin/vitest run test/unit/daemon-supervisor.test.ts && npx tsc --noEmit`
Expected: PASS (all prior + the 2 new tests) and tsc clean.

- [ ] **Step 7: Commit**

```bash
git add CC-to-SDK/harness/src/daemon/types.ts CC-to-SDK/harness/src/daemon/supervisor.ts CC-to-SDK/harness/src/daemon/server.ts CC-to-SDK/harness/test/unit/daemon-supervisor.test.ts
git commit -m "feat(harness): daemon control op routes to ControlBridge (Phase 2 B binding)"
```

---

### Task 4: Live control-plane test

**Files:**
- Modify: `test/live/daemon.test.ts`

- [ ] **Step 1: Add the live test**

In `test/live/daemon.test.ts`, inside the `live("live daemon (real SDK)", ...)` block, after the existing tests (before the block's closing `});`), add:

```ts
  it("control-plane drives a live session: initialize, set_model, set_thinking, interrupt", async () => {
    const d = mkdtempSync(join(tmpdir(), "cc-daemon-ctl-"));
    const sock = join(d, "sock");
    const sup = new DaemonSupervisor({ query }, { dir: join(d, "sessions") });
    const server = new DaemonServer(sup, sock);
    await server.listen();
    const id = (await daemonRequest(sock, { op: "spawn" }))[0].id;

    // initialize → real capability menus
    const init = (await daemonRequest(sock, { op: "control", id, frame: { type: "initialize" } }))[0];
    expect(init.ok).toBe(true);
    expect(Array.isArray(init.models) && init.models.length > 0).toBe(true);
    expect(Array.isArray(init.commands)).toBe(true);

    // set_model (to a model the SDK itself reports) + set_thinking → { ok: true }
    const model = init.models[0].value as string;
    expect((await daemonRequest(sock, { op: "control", id, frame: { type: "set_model", model } }))[0].ok).toBe(true);
    expect((await daemonRequest(sock, { op: "control", id, frame: { type: "set_thinking", maxTokens: null } }))[0].ok).toBe(true);

    // interrupt a long turn started on a SEPARATE connection → submit must settle (no hang)
    const submitP = daemonRequest(sock, { op: "submit", id, prompt: "Slowly count from 1 to 300, one number per line." }, () => {});
    await new Promise((r) => setTimeout(r, 1500));
    expect((await daemonRequest(sock, { op: "control", id, frame: { type: "interrupt" } }))[0].ok).toBe(true);
    await submitP.catch(() => {}); // resolves or rejects, but must not hang

    await daemonRequest(sock, { op: "shutdown" });
    await server.closed;
  }, 120_000);
```

- [ ] **Step 2: Run the live test**

Run: `cd CC-to-SDK/harness && node --env-file=../.env node_modules/.bin/vitest run test/live/daemon.test.ts`
Expected: PASS — `initialize` returns a non-empty `models` array; `set_model`/`set_thinking`/`interrupt` each return `{ ok: true }`; the interrupted `submit` settles within the timeout (proving the control-plane is concurrent with the data-plane). Skips automatically if `ANTHROPIC_API_KEY` is unset. A single retry on a transient streaming hiccup is fine; report if it persists.

- [ ] **Step 3: Commit**

```bash
git add CC-to-SDK/harness/test/live/daemon.test.ts
git commit -m "test(harness): live control-plane (initialize/set_model/set_thinking/interrupt) (Phase 2 B)"
```

---

### Task 5: Full suite green

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit suite**

Run: `cd CC-to-SDK/harness && node node_modules/.bin/vitest run test/unit`
Expected: PASS — all unit files green (prior 179 + Task 1's 6 + Task 2's 2 + Task 3's 2 = 189 tests).

- [ ] **Step 2: Final typecheck**

Run: `cd CC-to-SDK/harness && npx tsc --noEmit`
Expected: PASS.

> Note: this repo has **no prettier config/script** — do NOT run `prettier`; match the surrounding compact hand-style by hand.

---

## Self-Review

**Spec coverage:**
- §3/§4 `src/bridge/types.ts` (frame union + `ControllableSession` + `ControlResponse`) → Task 1 Step 3.
- §3/§4/§5 `ControlBridge.apply` (feature-detect, never throws, initialize→capabilities) → Task 1 Step 4 + tests.
- §4 `DaemonSession implements ControllableSession` (guarded delegations; `interrupt` no assert-running; setters reject when `ended`) → Task 2.
- §4 `controlOp` in `daemonOp` → Task 3 Step 3; server route → Step 5; `supervisor.control` (DaemonError on missing/dead) → Step 4.
- §3 interrupt-on-second-connection concurrency + §7 live (initialize/set_model/set_thinking/interrupt) → Task 4.
- §6 error handling: unknown frame rejected at zod boundary (Task 3 `daemonOp` parse test + Task 1 `controlFrame` test); unsupported method / throwing method → structured error (Task 1 tests); missing/dead session → `DaemonError` (Task 3 test) / setter rejects when ended (Task 2 test).
- §8 tsc clean + vitest green → Tasks' typecheck steps + Task 5.

**Placeholder scan:** none — every code/test step has complete content.

**Type consistency:** `controlFrame`/`ControlFrame`/`ControlResponse`/`ControllableSession` names are identical across `bridge/types.ts`, `bridge/control.ts`, `daemon/types.ts` (imports `controlFrame`), `daemon/session.ts` (implements `ControllableSession`), and `daemon/supervisor.ts` (imports `ControlBridge`, `ControlFrame`, `ControlResponse`). `capabilities()` returns `{ models, commands, mcpServers }` in the interface (Task 1), the `DaemonSession` impl (Task 2), and the live assertions (Task 4). The `set_permission_mode` enum literals match the SDK `PermissionMode` (`sdk.d.ts:2055`). `daemonOp` gains exactly one member (`controlOp`); the server `switch` gains exactly one `case "control"`.
```