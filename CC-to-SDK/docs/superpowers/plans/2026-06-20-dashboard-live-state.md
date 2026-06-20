# Dashboard Live State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `cc-harness-console` daemon dashboard mirror live per-session state — fix model cycling and surface live model, permission mode, context/token usage, age, and proactive state.

**Architecture:** Close the control→display loop. The daemon becomes the source of truth for live model + permission mode (write-back in `supervisor.control()` on success, carried through `list() → collect() → SessionRow`), and the tui fixes the `modelId` mapping and renders the `SessionRow` fields the panes currently drop. Spec: `docs/superpowers/specs/2026-06-20-dashboard-live-state-design.md`.

**Tech Stack:** TypeScript; `cc-harness` daemon (`SessionRegistry` persists records as per-session JSON); `cc-harness-tui` Ink console; vitest (keyless unit + OAuth-gated live).

## Global Constraints

- **NO `Co-Authored-By`** / attribution in commit messages.
- **NO Prettier** — dense hand-style; match the surrounding code (compact, multi-statement lines).
- **tui imports use ESM `.js` specifiers** (`from "./Detail.js"`); core imports are bare `"cc-harness"`.
- **Build `cc-harness` before any tui typecheck/test:** `cd ../harness && npm run build` (tui resolves `cc-harness` types from `harness/dist`). Rebuild after every harness task.
- **Components tested keyless** via `ink-testing-library` (`render` + `lastFrame()`); these are pure render assertions — no key input.
- **Test files run sequentially** (`vitest.config.ts` `fileParallelism:false`); don't rely on cross-file isolation.
- **Write-back fires ONLY on `res.ok`** — a rejected control op must not mutate the record.
- **`modelId` must map `.value` first** — the SDK model objects key on `.value` (`default`/`sonnet`/`sonnet[1m]`/`opus`/`haiku`/`claude-opus-4-8`), `.id` is `undefined`.
- **Live tests gate on `ANTHROPIC_API_KEY || CLAUDE_CODE_OAUTH_TOKEN`** and skip cleanly without either. The controller runs the keyed pass under OAuth; implementers stop at the clean keyless skip.
- Harness commands run from `harness/`; tui commands from `tui/`.

---

### Task 1: Daemon write-back — live model + permission mode become source of truth

**Files:**
- Modify: `harness/src/daemon/types.ts` (`SessionRecord` interface, ~`:11-21`)
- Modify: `harness/src/daemon/supervisor.ts` (`control()` ~`:162-169`; `spawn()` `register()` call `:118`)
- Test: `harness/test/unit/daemon-supervisor.test.ts` (extend the `controllableQuery` helper `:22-33`; add a `describe`-level block of cases)

**Interfaces:**
- Consumes: `ControlFrame` (`bridge/types.ts`): `{type:"set_model", model?:string}`, `{type:"set_permission_mode", mode:string}`; `ControlResponse` (`{ok:true,…}` | `{ok:false,error}`); `registry.update(id, patch: Partial<SessionRecord>)` (already persists).
- Produces: `SessionRecord.permissionMode?: string`; after a successful `set_model`/`set_permission_mode` control op, `supervisor.list()` reflects the new `model`/`permissionMode`; a freshly spawned session's record carries its `permissionMode` immediately.

- [ ] **Step 1: Write the failing tests**

In `harness/test/unit/daemon-supervisor.test.ts`, first extend the existing `controllableQuery` helper (currently at `:22-33`) so it also exposes `setPermissionMode` (additive — existing callers unaffected):

```ts
function controllableQuery(calls: any[]) {
  return ({ prompt }: any) => {
    const gen = (async function* () { for await (const _t of prompt) yield { type: "result", result: "ok" }; })();
    return Object.assign(gen, {
      setModel: async (m?: string) => { calls.push(["setModel", m]); },
      setPermissionMode: async (m: string) => { calls.push(["setPermissionMode", m]); },
      interrupt: async () => { calls.push(["interrupt"]); },
      supportedModels: async () => [{ value: "m1" }],
      supportedCommands: async () => [{ name: "help" }],
      mcpServerStatus: async () => [],
    });
  };
}
```

Then add this block of cases inside the top-level `describe("DaemonSupervisor", …)` (after the existing "Phase 2 B: control op" tests near `:285`):

```ts
  // ---- Increment C: live-state write-back ----
  it("set_model write-back: a successful control op updates the registry model", async () => {
    const sup = new DaemonSupervisor({ query: controllableQuery([]) }, { dir: dir() });
    const id = sup.spawn({ model: "m1" });
    expect(sup.list()[0].model).toBe("m1");
    expect(await sup.control(id, { type: "set_model", model: "haiku" })).toEqual({ ok: true });
    expect(sup.list()[0].model).toBe("haiku");                 // live model reflected
    await sup.shutdown();
  });
  it("set_permission_mode write-back: a successful control op updates the registry permissionMode", async () => {
    const sup = new DaemonSupervisor({ query: controllableQuery([]) }, { dir: dir() });
    const id = sup.spawn({ model: "m1" });
    expect(await sup.control(id, { type: "set_permission_mode", mode: "acceptEdits" })).toEqual({ ok: true });
    expect(sup.list()[0].permissionMode).toBe("acceptEdits");
    await sup.shutdown();
  });
  it("a REJECTED control op leaves the record unchanged (write-back gated on res.ok)", async () => {
    const rejecting = ({ prompt }: any) => {
      const gen = (async function* () { for await (const _t of prompt) yield { type: "result", result: "ok" }; })();
      return Object.assign(gen, { setModel: async () => { throw new Error("nope"); }, capabilities: undefined });
    };
    const sup = new DaemonSupervisor({ query: rejecting }, { dir: dir() });
    const id = sup.spawn({ model: "m1" });
    const res = await sup.control(id, { type: "set_model", model: "haiku" });
    expect(res.ok).toBe(false);
    expect(sup.list()[0].model).toBe("m1");                    // unchanged on failure
    await sup.shutdown();
  });
  it("spawn seeds permissionMode onto the record immediately (before any cycle)", async () => {
    const sup = new DaemonSupervisor({ query: controllableQuery([]) }, { dir: dir() });
    const id = sup.spawn({ model: "m1", permissionMode: "plan" });
    expect(sup.list().find((r) => r.id === id)?.permissionMode).toBe("plan");
    await sup.shutdown();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd harness && npx vitest run test/unit/daemon-supervisor.test.ts`
Expected: the 4 new cases FAIL — `model`/`permissionMode` not updated (write-back absent) and `permissionMode` not on the record (spawn doesn't seed it). The pre-existing cases still pass.

- [ ] **Step 3: Add `permissionMode` to `SessionRecord`**

In `harness/src/daemon/types.ts`, add the optional field to the `SessionRecord` interface (place it right after `model?`):

```ts
export interface SessionRecord {
  id: string;
  daemonPid: number;
  status: SessionStatus;
  model?: string;
  permissionMode?: string;        // live permission mode (Increment C); written back on set_permission_mode
  restart?: RestartPolicy;
  sessionId?: string;
  createdAt: number;
  lastActiveAt: number;
  restarts?: number;
}
```

- [ ] **Step 4: Seed `permissionMode` at spawn + write back in `control()`**

In `harness/src/daemon/supervisor.ts`, update the `register()` call inside `spawn()` (`:118`) to carry the mode:

```ts
    this.registry.register({ id, daemonPid: process.pid, status: "idle", model, permissionMode: cfg.permissionMode, restart: cfg.restart, createdAt: t, lastActiveAt: t });
```

Then replace the body of `control()` (`:162-169`) so it writes the live value back on success:

```ts
  async control(id: string, frame: ControlFrame): Promise<ControlResponse> {
    const session = this.ensureLive(id);
    if (!session || session.isEnded()) {
      const rec = this.registry.get(id);
      throw new DaemonError(rec ? `session ${id} is ${rec.status}` : `unknown session ${id}`);
    }
    const res = await ControlBridge.apply(session, frame);
    if (res.ok) {
      if (frame.type === "set_model" && frame.model !== undefined) {
        this.registry.update(id, { model: frame.model });
        const cfg = this.configs.get(id); if (cfg) cfg.model = frame.model;
      } else if (frame.type === "set_permission_mode") {
        this.registry.update(id, { permissionMode: frame.mode });
        const cfg = this.configs.get(id); if (cfg) cfg.permissionMode = frame.mode;
      }
    }
    return res;
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd harness && npx vitest run test/unit/daemon-supervisor.test.ts`
Expected: PASS (all cases, new + pre-existing). Then `npm run typecheck` → no errors.

- [ ] **Step 6: Commit**

```bash
git add harness/src/daemon/types.ts harness/src/daemon/supervisor.ts harness/test/unit/daemon-supervisor.test.ts
git commit -m "feat(daemon): write live model/permissionMode back to the registry on control ops"
```

---

### Task 2: Surface `permissionMode` on the `SessionRow` via `collect()`

**Files:**
- Modify: `harness/src/monitor/snapshot.ts` (`SessionRow` interface `:10-18`; `collect()` push `:55`)
- Test: `harness/test/unit/monitor-collect.test.ts`

**Interfaces:**
- Consumes: `ListEntry` (now carries `permissionMode?` via `SessionRecord` from Task 1).
- Produces: `SessionRow.permissionMode?: string` — populated by `collect()` from `entry.permissionMode`. Task 4 (Detail) reads it.

- [ ] **Step 1: Write the failing test**

In `harness/test/unit/monitor-collect.test.ts`, add a case inside `describe("collect", …)`:

```ts
  it("carries permissionMode from the ListEntry onto the SessionRow", async () => {
    const snap = await collect(clientFrom([rec({ id: "p", permissionMode: "acceptEdits" })], { p: { totalTokens: 1, maxTokens: 100 } }), { now: () => 0 });
    expect(snap.sessions[0].permissionMode).toBe("acceptEdits");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd harness && npx vitest run test/unit/monitor-collect.test.ts`
Expected: FAIL — `snap.sessions[0].permissionMode` is `undefined` (not yet on the row), and `rec({permissionMode})` would only typecheck once `ListEntry` carries it (it does, from Task 1).

- [ ] **Step 3: Add `permissionMode` to `SessionRow` + the `collect()` push**

In `harness/src/monitor/snapshot.ts`, add the field to the interface (`:10-18`):

```ts
export interface SessionRow {
  id: string;
  status: ListEntry["status"];
  model?: string;
  permissionMode?: string;   // live permission mode (Increment C)
  ctxPercent?: number;
  tokens?: number;
  createdAt: number;
  proactive?: ProactiveState;
}
```

And include it in the `sessions.push(…)` (`:55`):

```ts
    sessions.push({ id: e.id, status: e.status, model: e.model, permissionMode: e.permissionMode, ctxPercent, tokens, createdAt: e.createdAt, proactive: e.proactive?.state });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd harness && npx vitest run test/unit/monitor-collect.test.ts`
Expected: PASS. Then `npm run typecheck` → no errors, and `npm run build` (so the tui tasks resolve the new type).

- [ ] **Step 5: Commit**

```bash
git add harness/src/monitor/snapshot.ts harness/test/unit/monitor-collect.test.ts
git commit -m "feat(monitor): carry live permissionMode onto the SessionRow in collect()"
```

---

### Task 3: Fix `modelId` to map `.value` (the #6 core fix)

**Files:**
- Modify: `tui/src/useDaemon.ts` (`modelId` `:9`)
- Test: `tui/test/useDaemon.test.tsx`

**Interfaces:**
- Consumes: the model list from `control{initialize}` → `capabilities().models`, whose entries are objects keyed on `.value`.
- Produces: `cycleModel()` issues `set_model` with the model's `.value`, never `"[object Object]"`.

- [ ] **Step 1: Write the failing test**

In `tui/test/useDaemon.test.tsx`, add a case inside `describe("useDaemon", …)`. It overrides `control` so `initialize` returns **object** models (the real SDK shape), unlike the default fake's string models:

```ts
  it("cycleModel maps the SDK model objects by .value (never [object Object])", async () => {
    const calls: any = { control: [] };
    const c = fakeClient({
      async control(id, frame) {
        calls.control.push([id, frame]);
        if ((frame as any).type === "initialize") return { ok: true, models: [{ value: "opus" }, { value: "haiku" }] } as any;
        return { ok: true } as any;
      },
    });
    render(<Probe client={c} opts={{ schedule: manualSchedule().schedule, now: () => 0 }} />);
    await flush();
    view.cycleModel(); await flush();
    expect(calls.control.at(-1)).toEqual(["sess-1", { type: "set_model", model: "opus" }]);
    view.cycleModel(); await flush();
    expect(calls.control.at(-1)).toEqual(["sess-1", { type: "set_model", model: "haiku" }]);
    const sent = calls.control.filter((x: any) => x[1].type === "set_model").map((x: any) => x[1].model);
    expect(sent).not.toContain("[object Object]");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd harness && npm run build && cd ../tui && npx vitest run test/useDaemon.test.tsx`
Expected: FAIL — `set_model` is sent with `model: "[object Object]"` because `modelId` reads `.id ?? .model` and the objects have neither.

- [ ] **Step 3: Add `.value` to `modelId`**

In `tui/src/useDaemon.ts`, change `modelId` (`:9`):

```ts
const modelId = (m: unknown) => (typeof m === "string" ? m : ((m as any)?.value ?? (m as any)?.id ?? (m as any)?.model ?? String(m)));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd tui && npx vitest run test/useDaemon.test.tsx`
Expected: PASS (the new case + the pre-existing string-model cases, which still work via the `typeof === "string"` branch). Then `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add tui/src/useDaemon.ts tui/test/useDaemon.test.tsx
git commit -m "fix(console): cycleModel maps SDK model objects by .value (was sending [object Object])"
```

---

### Task 4: Enrich the Detail pane with live session state

**Files:**
- Modify: `tui/src/Detail.tsx`
- Test: `tui/test/components.test.tsx`

**Interfaces:**
- Consumes: `SessionRow` (now with `permissionMode?` from Task 2) — `permissionMode`, `ctxPercent`, `tokens`, `createdAt`, `proactive`.
- Produces: `Detail({ row, stream, now? })` — `now` is an optional injected clock (defaults `Date.now`) so the age line is deterministic in tests; `App.tsx` is unchanged (the default applies).

- [ ] **Step 1: Write the failing tests**

In `tui/test/components.test.tsx`, add (import `Detail` at the top alongside the other component imports — `import { Detail } from "../src/Detail.js";`):

```ts
  it("Detail renders the live-state line (mode · ctx · tokens · age · proactive)", () => {
    const row = { id: "sess-1", status: "idle", model: "opus", permissionMode: "acceptEdits", ctxPercent: 42, tokens: 1234, createdAt: 0, proactive: "running" } as any;
    const { lastFrame } = render(<Detail row={row} stream={[]} now={() => 65000} />);
    const f = lastFrame() ?? "";
    expect(f).toContain("acceptEdits");
    expect(f).toContain("42%");
    expect(f).toContain("1234 tok");
    expect(f).toContain("1m");          // 65000ms → 65s → "1m"
    expect(f).toContain("running");
  });
  it("Detail falls back gracefully for a sparse row", () => {
    const row = { id: "s", status: "idle", createdAt: 0 } as any;
    const { lastFrame } = render(<Detail row={row} stream={[]} now={() => 0} />);
    const f = lastFrame() ?? "";
    expect(f).toContain("mode default");
    expect(f).toContain("ctx -");
    expect(f).toContain("idle");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd harness && npm run build && cd ../tui && npx vitest run test/components.test.tsx`
Expected: FAIL — `Detail` accepts no `now` prop and renders no mode/ctx/tokens/age line.

- [ ] **Step 3: Implement the enriched Detail**

Replace the contents of `tui/src/Detail.tsx`:

```tsx
import React from "react";
import { Box, Text } from "ink";
import type { SessionRow } from "cc-harness";
import { streamLines } from "./format.js";

function agehms(createdAt: number, now: number): string {
  const s = Math.max(0, Math.floor((now - createdAt) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60); if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60); return `${h}h${m % 60}m`;
}

export function Detail({ row, stream, now = Date.now }: { row?: SessionRow; stream: unknown[]; now?: () => number }) {
  const lines = streamLines(stream);
  return (
    <Box flexDirection="column" flexGrow={1} borderStyle="round" paddingX={1}>
      {row ? <Text bold>{row.id} · {row.status} · {row.model ?? "-"}</Text> : <Text dimColor>no session selected</Text>}
      {row ? <Text dimColor>mode {row.permissionMode ?? "default"} · ctx {row.ctxPercent != null ? `${row.ctxPercent}%` : "-"} · {row.tokens != null ? `${row.tokens} tok` : "- tok"} · age {agehms(row.createdAt, now())} · {row.proactive ?? "idle"}</Text> : null}
      {lines.length === 0
        ? <Text dimColor>(no output yet)</Text>
        : lines.slice(-200).map((l, i) => <Text key={i}>{l}</Text>)}
    </Box>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd tui && npx vitest run test/components.test.tsx`
Expected: PASS. Then `npm run typecheck` (App.tsx unchanged — `now` defaults).

- [ ] **Step 5: Commit**

```bash
git add tui/src/Detail.tsx tui/test/components.test.tsx
git commit -m "feat(console): Detail shows live mode/ctx/tokens/age/proactive line"
```

---

### Task 5: Proactive glyph in the Pool list

**Files:**
- Modify: `tui/src/Pool.tsx`
- Test: `tui/test/components.test.tsx`

**Interfaces:**
- Consumes: `SessionRow.proactive` (`"idle"|"running"|"paused"|"stopped"|undefined`).
- Produces: each Pool row appends a trailing proactive glyph (`▶` running, `⏸` paused); idle/stopped/undefined append nothing.

- [ ] **Step 1: Write the failing tests**

In `tui/test/components.test.tsx`, add (import `Pool` — `import { Pool } from "../src/Pool.js";`). The test rows use `status:"idle"` so the proactive `▶` can't be confused with the busy-status `▶`:

```ts
  it("Pool appends a proactive glyph for a running session", () => {
    const rows = [{ id: "sess-run", status: "idle", model: "opus", ctxPercent: 5, proactive: "running" }] as any;
    const { lastFrame } = render(<Pool rows={rows} selectedIndex={0} />);
    expect(lastFrame()).toContain("▶");        // status is idle (·) → the ▶ is the proactive marker
  });
  it("Pool shows no proactive glyph for an idle (non-proactive) session", () => {
    const rows = [{ id: "sess-idle", status: "idle", model: "opus", ctxPercent: 5 }] as any;
    const { lastFrame } = render(<Pool rows={rows} selectedIndex={0} />);
    expect(lastFrame()).not.toContain("▶");
    expect(lastFrame()).not.toContain("⏸");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd tui && npx vitest run test/components.test.tsx`
Expected: the first new case FAILS (no `▶` rendered for a running session); the second passes vacuously.

- [ ] **Step 3: Add the proactive glyph**

In `tui/src/Pool.tsx`, add a glyph map and append it to each row:

```tsx
import React from "react";
import { Box, Text } from "ink";
import type { SessionRow } from "cc-harness";

const GLYPH: Record<string, string> = { idle: "·", busy: "▶", errored: "✗", restarting: "↻" };
const PROACTIVE_GLYPH: Record<string, string> = { running: "▶", paused: "⏸" };

export function Pool({ rows, selectedIndex }: { rows: SessionRow[]; selectedIndex: number }) {
  return (
    <Box flexDirection="column" width={38} borderStyle="round" paddingX={1}>
      <Text bold>Sessions ({rows.length})</Text>
      {rows.length === 0
        ? <Text dimColor>no live sessions</Text>
        : rows.map((r, i) => (
          <Text key={r.id} inverse={i === selectedIndex}>
            {(GLYPH[r.status] ?? "?")} {r.id.slice(0, 10)} {r.model ?? "-"} {r.ctxPercent != null ? `${r.ctxPercent}%` : "--"}{r.proactive && PROACTIVE_GLYPH[r.proactive] ? ` ${PROACTIVE_GLYPH[r.proactive]}` : ""}
          </Text>
        ))}
    </Box>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd tui && npx vitest run test/components.test.tsx`
Expected: PASS. Then `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add tui/src/Pool.tsx tui/test/components.test.tsx
git commit -m "feat(console): Pool appends a proactive glyph (▶ running, ⏸ paused)"
```

---

### Task 6: OAuth-gated live e2e — cycle model reflects in `list()`

**Files:**
- Create: `harness/test/live/daemon-model-cycle.e2e.test.ts`

**Interfaces:**
- Consumes: `DaemonSupervisor` with the real SDK `query`; `control{set_model}`; `list()`.
- Produces: end-to-end proof that a successful live `set_model` writes the new model back into `list()`.

- [ ] **Step 1: Write the gated live test**

Create `harness/test/live/daemon-model-cycle.e2e.test.ts` (modeled on `daemon-defaults.e2e.test.ts`):

```ts
// harness/test/live/daemon-model-cycle.e2e.test.ts — gated: a live set_model control op writes the new
// model back into the registry (the dashboard m-cycle fix, end-to-end). Run keyed (OAuth bills subscription):
//   set -a; . ../.env; set +a; unset ANTHROPIC_API_KEY; npx vitest run test/live/daemon-model-cycle.e2e.test.ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import { DaemonSupervisor } from "../../src/daemon/supervisor.js";

const live = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) ? describe : describe.skip;

live("daemon model cycle (live)", () => {
  it("a successful set_model control op reflects the new model in list()", async () => {
    const sup = new DaemonSupervisor({ query: sdkQuery }, { dir: mkdtempSync(join(tmpdir(), "cc-daemon-cycle-")) });
    try {
      const id = sup.spawn({ model: "claude-opus-4-8" });
      expect(sup.list().find((r) => r.id === id)?.model).toBe("claude-opus-4-8");
      const res = await sup.control(id, { type: "set_model", model: "haiku" });
      expect(res.ok).toBe(true);
      expect(sup.list().find((r) => r.id === id)?.model).toBe("haiku");   // live model written back
    } finally {
      await sup.shutdown();
    }
  }, 120_000);
});
```

- [ ] **Step 2: Verify it skips cleanly without a key**

Run: `cd harness && npx vitest run test/live/daemon-model-cycle.e2e.test.ts`
Expected: the suite SKIPS (no key/token in the implementer's shell) — `0 passed`, the describe reported skipped. **Implementers stop here** (the controller runs the keyed pass under OAuth).

- [ ] **Step 3: Commit**

```bash
git add harness/test/live/daemon-model-cycle.e2e.test.ts
git commit -m "test(daemon): gated live e2e — set_model reflects the new model in list()"
```

---

## Self-Review

**1. Spec coverage:**
- #6 (m-cycle) → Task 3 (`.value` mapping) + Task 1 (model write-back makes it visible) + Task 6 (live proof). ✔
- #2 (permissionMode) → Task 1 (write-back + spawn seed) + Task 2 (SessionRow) + Task 4 (Detail renders `mode`). ✔
- #4 (Detail enrichment) → Task 4 (mode/ctx/tokens/age/proactive). ✔
- #5 (proactive) → Task 5 (Pool glyph) + Task 4 (state word in Detail). ✔
- Daemon source-of-truth (chosen) → Task 1. Basic proactive (chosen) → Tasks 4/5, no new daemon API. ✔
- Non-goals (rich proactive stats, cwd/cost, cycle-start, shared modelId helper) → none introduced. ✔

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code; every test step shows the assertions. ✔

**3. Type consistency:** `permissionMode?: string` is identical across `SessionRecord` (Task 1), `SessionRow` (Task 2), and is read in Detail (Task 4). `modelId` signature unchanged (Task 3). `Detail` gains an optional `now?: () => number` (Task 4) — `App.tsx` unaffected. `frame.model` guarded `!== undefined` per the `z.string().optional()` shape. Write-back uses `registry.update` (exists) + `configs.get` (exists). ✔

## Execution
REQUIRED SUB-SKILL: superpowers:subagent-driven-development — fresh implementer per task, task review (spec + quality) after each, broad whole-branch review at the end, then the controller runs the keyed live pass under OAuth.
