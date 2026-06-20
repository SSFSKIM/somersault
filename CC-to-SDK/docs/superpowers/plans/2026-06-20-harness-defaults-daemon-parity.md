# Harness Defaults & Daemon Config Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the harness Claude-Code-faithful defaults (Opus 4.8 · xhigh · auto) and stop the daemon path from being bare, both via the existing `resolveOptions` policy seam.

**Architecture:** Add `model`/`permissionMode`/`effort` to `DEFAULTS` and apply them in `resolveOptions` (the one place that already centralizes the auto- and bypass-gates), with the subtlety that the auto model-gate fires only on *explicit* `auto` — never on default-`auto` — so an explicit non-auto-capable model (e.g. haiku) is never silently overridden. Then route the daemon's `makeSession` through `resolveOptions` and align `spawn()`'s registry model resolution with it, so daemon and lib produce identical options.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest (DI-by-deps unit tests, no network), Claude Agent SDK `@anthropic-ai/claude-agent-sdk`.

## Global Constraints

- Dense **no-Prettier** hand-style — match surrounding code; do not reformat.
- **ESM**: every import specifier ends in `.js` (e.g. `from "./types.js"`).
- Default values, verbatim: `model: "claude-opus-4-8"`, `permissionMode: "auto"`, `effort: "xhigh"`.
- The auto model-gate keys on `config.permissionMode === "auto"` (explicit), **NOT** the resolved mode.
- Unit tests are **DI-by-deps** (inject a fake `query`); no API key. Live tests gate on `ANTHROPIC_API_KEY` read from `CC-to-SDK/.env` and skip cleanly without it.
- All commands run from `CC-to-SDK/harness/`. After each task: `npm run typecheck` (exit 0) + `npm run test:unit` (green).
- Trust a clean `typecheck` + green vitest over phantom stale-cache LSP diagnostics.
- Git: commit completed work to `main`; **NO `Co-Authored-By`** / no attribution lines; no push.
- 1M context is **out of scope** (probe 26: opus-4-8 is already 1M; the beta header is a no-op).

---

### Task 1: Harness-wide defaults in `resolveOptions`

**Files:**
- Modify: `harness/src/config/types.ts` (the `DEFAULTS` object, ~line 76)
- Modify: `harness/src/config/resolveOptions.ts:37-54` (model/effort/permissionMode block)
- Test: `harness/test/unit/resolveOptions.test.ts`

**Interfaces:**
- Consumes: `DEFAULTS` from `./types.js`; `resolveAutoModel` from `./autoModel.js` (already imported in `resolveOptions.ts`).
- Produces: `resolveOptions({})` now returns `{ ...preset/settings..., model: "claude-opus-4-8", permissionMode: "auto", effort: "xhigh" }`. The auto model-gate runs only on explicit `auto`. The daemon (Task 2) and the lib both rely on this behavior.

**Context:** `DEFAULTS` (`types.ts:76`) currently has `settingSources`, `includeBuiltinAgents`, `enableFileCheckpointing`, `toolPreset`, `provider`. `EffortLevel` and `PermissionMode` are already imported at `types.ts:1`. `resolveOptions` already sets `options.model`/`permissionMode`/`effort` only when the caller provides them, and already centralizes the auto-gate (`resolveOptions.ts:50`) and bypass-gate (`:53`).

- [ ] **Step 1: Write the failing tests**

In `harness/test/unit/resolveOptions.test.ts`, **add** these two tests inside the `describe("resolveOptions", …)` block (after the existing `it("produces CC-faithful defaults", …)`):

```ts
  it("applies harness-wide defaults (opus-4-8 / auto / xhigh) when omitted", () => {
    const o: any = resolveOptions({});
    expect(o.model).toBe("claude-opus-4-8");
    expect(o.permissionMode).toBe("auto");
    expect(o.effort).toBe("xhigh");
  });
  it("default-auto does NOT override an explicit model (only explicit auto gates)", () => {
    const o: any = resolveOptions({ model: "claude-haiku-4-5" });
    expect(o.model).toBe("claude-haiku-4-5");   // explicit model preserved; auto is only the default → no gate
    expect(o.permissionMode).toBe("auto");      // mode still defaults to auto
  });
```

And **update** two existing assertions:
- In `it("threads the turn-control fields through, omits them when absent", …)`, the `bare` absent-list (currently line ~91) must drop `"effort"` (it is now defaulted):
```ts
    for (const k of ["thinking", "maxBudgetUsd", "taskBudget", "includePartialMessages", "forwardSubagentText"])
      expect(bare).not.toHaveProperty(k);
```
- In `it("forces a supported model when permissionMode is auto (model-gated)", …)`, the no-model auto case (currently line ~100) now resolves to the opus default:
```ts
    expect((resolveOptions({ permissionMode: "auto" }) as any).model).toBe("claude-opus-4-8");
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:unit -- resolveOptions`
Expected: FAIL — the two new tests fail (`o.model` is `undefined`, not `"claude-opus-4-8"`), and the two updated assertions fail against the current (no-default) code.

- [ ] **Step 3: Add the defaults to `DEFAULTS`**

In `harness/src/config/types.ts`, extend the `DEFAULTS` object (keep the existing keys, append these three):

```ts
export const DEFAULTS = {
  settingSources: ["user", "project", "local"] as SettingSource[],
  includeBuiltinAgents: true,
  enableFileCheckpointing: true,
  toolPreset: "claude_code" as const,
  provider: "anthropic" as const,
  model: "claude-opus-4-8",                 // harness-wide default model (opus-4-8 is already 1M — probe 26)
  permissionMode: "auto" as PermissionMode, // SDK-native auto classifier
  effort: "xhigh" as EffortLevel,           // default reasoning effort
};
```

- [ ] **Step 4: Apply the defaults in `resolveOptions`**

In `harness/src/config/resolveOptions.ts`, replace the current block (lines 37–53, from `if (config.model)` through the bypass-gate `if`) with:

```ts
  const model = config.model ?? DEFAULTS.model;
  options.model = model;
  if (config.fallbackModel) options.fallbackModel = config.fallbackModel;
  if (config.maxTurns !== undefined) options.maxTurns = config.maxTurns;
  const effort = config.effort ?? DEFAULTS.effort;
  if (effort) options.effort = effort;
  if (config.thinking) options.thinking = config.thinking;
  if (config.maxBudgetUsd !== undefined) options.maxBudgetUsd = config.maxBudgetUsd;
  if (config.taskBudget) options.taskBudget = config.taskBudget;
  if (config.includePartialMessages) options.includePartialMessages = config.includePartialMessages;
  if (config.forwardSubagentText) options.forwardSubagentText = config.forwardSubagentText;
  const mode = config.permissionMode ?? DEFAULTS.permissionMode;
  if (mode) options.permissionMode = mode;
  // `auto` is MODEL-GATED (Opus 4.6+/Sonnet 4.6). Force a supported model ONLY when the caller EXPLICITLY
  // chose auto — do NOT run the gate when auto is merely the default, or an explicit non-auto-capable model
  // (e.g. haiku) would be silently overridden to sonnet. The opus-4-8 default is itself auto-capable.
  if (config.permissionMode === "auto") options.model = resolveAutoModel(model);
  // SDK contract: bypassPermissions REQUIRES allowDangerouslySkipPermissions. Centralized here.
  if (mode === "bypassPermissions") options.allowDangerouslySkipPermissions = true;
```

Leave line 54 (`if (config.permissionBroker) options.canUseTool = …`) and everything after it unchanged.

- [ ] **Step 5: Run the resolveOptions tests to verify they pass**

Run: `npm run test:unit -- resolveOptions`
Expected: PASS — all `resolveOptions` tests green, including the two new ones and the two updated assertions. (Sanity: `{permissionMode:"auto", model:"claude-haiku-4-5"}` still → `sonnet-4-6`; `{permissionMode:"default", model:"claude-haiku-4-5"}` still → `haiku`.)

- [ ] **Step 6: Run the full unit suite + typecheck; fix lib-side ripples**

Run: `npm run typecheck && npm run test:unit`
Expected: exit 0 + green. The daemon suite is unaffected (the daemon does not call `resolveOptions` yet — that is Task 2). If `session-factories.test.ts`, `index.test.ts`, or `readme.test.ts` fail because a session/openSession now carries `model`/`permissionMode`/`effort` defaults, update those assertions to match (these are correct behavior changes, not regressions). If they pass untouched, do nothing.

- [ ] **Step 7: Commit**

```bash
git add harness/src/config/types.ts harness/src/config/resolveOptions.ts harness/test/unit/resolveOptions.test.ts
git commit -m "feat(harness): harness-wide defaults (opus-4-8/auto/xhigh) in resolveOptions; explicit-auto-only model-gate"
```

---

### Task 2: Daemon routes through `resolveOptions` (config parity)

**Files:**
- Modify: `harness/src/daemon/supervisor.ts` — imports, `spawn()` (line ~110), `makeSession()` (lines ~308-318)
- Test: `harness/test/unit/daemon-supervisor-permissions.test.ts` (update 2 assertions + add a parity test)

**Interfaces:**
- Consumes: `resolveOptions` from `../config/resolveOptions.js`; `DEFAULTS` from `../config/types.js`; `resolveAutoModel` (already imported); `PermissionMode` type from `@anthropic-ai/claude-agent-sdk`.
- Produces: daemon-spawned sessions whose SDK options are `resolveOptions`-built (CC `systemPrompt` preset + `settingSources` + tools preset + the model/mode/effort defaults), with the daemon broker `canUseTool` set **after** the per-session `sessionOptions` factory overlay so it always wins.

**Context:** The current `spawn()` (`supervisor.ts:110`) computes `const model = opts.permissionMode === "auto" ? resolveAutoModel(opts.model) : opts.model;` and stores it in `cfg` + the registry record. `makeSession` (`:308-318`) hand-builds a bare `{model?, resume?, permissionMode?}` object, merges the `sessionOptions` factory output (factory keys win), and sets `options.canUseTool = createPermissionGate(this.pending.brokerFor(id))` last. `SpawnConfig` is `{ model?: string; restart: RestartPolicy; permissionMode?: string }` (`:36`). The fake-query DI helper `captureQuery(captured)` (already in the test file) pushes each session's `options` into an array **at spawn time** (the query starts eagerly — existing tests assert `cap[0]` right after `spawn()` with no `submit`). `resolveTools` adds no default `allowedTools`/`disallowedTools` for bare config (verified), so the factory-overlay assertions in `daemon-supervisor.test.ts` stay green.

**Why `spawn()` changes too (refines the spec's daemon section):** `spawn()` resolves the model for the registry record; `makeSession`→`resolveOptions` resolves it for the SDK options. To keep them identical (true parity) — and to stop the registry recording `undefined` while the session runs opus-4-8 — `spawn()` must apply the same opus-4-8 default. Its existing explicit-`auto`-only gate is preserved (matching `resolveOptions`).

- [ ] **Step 1: Write the failing tests**

In `harness/test/unit/daemon-supervisor-permissions.test.ts`:

(a) **Update** the second test (`it("auto + no model → sonnet-4-6; …")`): rename it and change the two assertions that move:
```ts
  it("auto + no model → opus-4-8 (default); auto + supported preserved; non-auto leaves model + defaults mode to auto", async () => {
    const cap: any[] = [];
    const sup = new DaemonSupervisor({ query: captureQuery(cap) }, { dir: tmp(), now: () => 0, idleTimeoutMs: 0 });
    sup.spawn({ permissionMode: "auto" });
    sup.spawn({ model: "claude-opus-4-6", permissionMode: "auto" });
    sup.spawn({ model: "claude-haiku-4-5-20251001" });           // non-auto (explicit model)
    expect(cap[0].model).toBe("claude-opus-4-8");                 // auto + no model → opus default (was sonnet)
    expect(cap[1].model).toBe("claude-opus-4-6");
    expect(cap[2].model).toBe("claude-haiku-4-5-20251001");       // explicit model preserved
    expect(cap[2].permissionMode).toBe("auto");                   // non-auto spawn now defaults to auto
    expect(typeof cap[2].canUseTool).toBe("function");            // daemon broker still wired
    await sup.shutdown();
  });
```

(b) **Add** a parity test (right after the test above):
```ts
  it("routes spawned sessions through resolveOptions — CC preset + settingSources + defaults", async () => {
    const cap: any[] = [];
    const sup = new DaemonSupervisor({ query: captureQuery(cap) }, { dir: tmp(), now: () => 0, idleTimeoutMs: 0 });
    sup.spawn({});                                                // no model, no mode → harness defaults
    expect(cap[0].systemPrompt).toEqual({ type: "preset", preset: "claude_code" });
    expect(cap[0].settingSources).toEqual(["user", "project", "local"]);
    expect(cap[0].tools).toEqual({ type: "preset", preset: "claude_code" });
    expect(cap[0].model).toBe("claude-opus-4-8");
    expect(cap[0].permissionMode).toBe("auto");
    expect(typeof cap[0].canUseTool).toBe("function");           // daemon broker survives the factory overlay
    await sup.shutdown();
  });
```

(Leave the first test, `it("auto + unsupported model forces sonnet-4-6 …")`, unchanged — `{model:"claude-haiku-4-5-20251001", permissionMode:"auto"}` still forces `sonnet-4-6`.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:unit -- daemon-supervisor-permissions`
Expected: FAIL — the updated test fails (`cap[0].model` is `sonnet-4-6` / `cap[2].permissionMode` is `undefined` under current code) and the new parity test fails (`cap[0].systemPrompt`/`settingSources` are `undefined` — the daemon is still bare).

- [ ] **Step 3: Update the imports**

In `harness/src/daemon/supervisor.ts`, ensure these imports exist (add the missing ones near the other `../config/*` imports):
```ts
import { resolveOptions } from "../config/resolveOptions.js";
import { DEFAULTS } from "../config/types.js";
```
(`resolveAutoModel` and `createPermissionGate` are already imported.)

- [ ] **Step 4: Apply the opus default in `spawn()`**

In `harness/src/daemon/supervisor.ts`, replace the model line in `spawn()` (currently line ~110):
```ts
    const model = opts.permissionMode === "auto" ? resolveAutoModel(opts.model ?? DEFAULTS.model) : (opts.model ?? DEFAULTS.model); // explicit-auto gate; opus-4-8 default keeps the registry consistent with resolveOptions
```

- [ ] **Step 5: Route `makeSession` through `resolveOptions`**

In `harness/src/daemon/supervisor.ts`, replace the body of `makeSession` (the `base`/`extra`/`options` construction, lines ~308-313) with:
```ts
  private makeSession(id: string, cfg: SpawnConfig, resume?: string): DaemonSession {
    const base = resolveOptions({
      model: cfg.model,                                      // already opus-4-8-defaulted by spawn(); resolveOptions is idempotent
      permissionMode: cfg.permissionMode as PermissionMode | undefined,
      ...(resume ? { resume } : {}),
    });   // no cwd: the daemon runs from the project dir, so settingSources resolves against process.cwd()
    const extra = this.sessionOptions?.(id);                 // fresh servers + tool posture for THIS session
    const options = extra ? { ...base, ...extra } : base;    // factory keys win (unchanged contract)
    options.canUseTool = createPermissionGate(this.pending.brokerFor(id)); // daemon broker wins — set LAST
    const session = new DaemonSession(id, { query: this.deps.query }, options, this.now, { contextTool: this.contextTool, compactTool: this.compactTool });
    session.done.then(() => this.handleSessionEnd(id)).catch(() => {}); // end hook
    return session;
  }
```
Add the `PermissionMode` type to the existing `@anthropic-ai/claude-agent-sdk` import in this file if it is not already imported (it is used only for the cast above).

- [ ] **Step 6: Run the daemon-permissions tests to verify they pass**

Run: `npm run test:unit -- daemon-supervisor-permissions`
Expected: PASS — the updated test, the new parity test, and the unchanged first test are all green.

- [ ] **Step 7: Run the full unit suite + typecheck; fix daemon ripples**

Run: `npm run typecheck && npm run test:unit`
Expected: exit 0 + green. Anticipated: `daemon-supervisor.test.ts` factory-overlay tests stay green (factory keys win; `resolveTools` adds no default `allowedTools`). If a daemon test that spawns **bare** (no model) now sees `cap[…].model === "claude-opus-4-8"` where it previously expected `undefined`, that is correct — update the assertion. Fix any such ripple; do not weaken a test to hide a real change.

- [ ] **Step 8: Commit**

```bash
git add harness/src/daemon/supervisor.ts harness/test/unit/daemon-supervisor-permissions.test.ts
git commit -m "feat(daemon): route makeSession through resolveOptions (CC preset + settingSources + defaults); align spawn() registry model"
```

---

### Task 3: Gated live e2e + docs refresh

**Files:**
- Create: `harness/test/live/daemon-defaults.e2e.test.ts`
- Modify: `docs/parity/coverage.md`
- Modify: the phase3 memory + `MEMORY.md` index (see Step 5)

**Interfaces:**
- Consumes: `DaemonSupervisor` from `../../src/daemon/supervisor.js`; the real `query` from `@anthropic-ai/claude-agent-sdk`.
- Produces: a gated live test proving the new defaults + CC preset are accepted by the real API on a bare daemon spawn, and that the registry records `claude-opus-4-8`.

**Context:** Live tests gate with `const live = process.env.ANTHROPIC_API_KEY ? describe : describe.skip;` and skip cleanly without a key. `sup.spawn({})` with no config now yields an opus-4-8 + auto + xhigh + claude_code-preset session; `sup.submit(id, prompt, onMessage)` runs one turn and returns `{ result }`; `sup.list()` returns registry records with `.model`. A prompt with no tool use does not trip the `auto` classifier, so no broker handler is needed.

- [ ] **Step 1: Write the gated live test**

Create `harness/test/live/daemon-defaults.e2e.test.ts`:
```ts
// harness/test/live/daemon-defaults.e2e.test.ts — gated: a BARE daemon spawn (no model/mode) runs on the
// new harness defaults (opus-4-8 + auto + xhigh + claude_code preset) against the real API, and the
// registry records opus-4-8. Proves the daemon-parity options are live-accepted (no 400). Run keyed:
//   set -a; . ../.env; set +a; npx vitest run test/live/daemon-defaults.e2e.test.ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import { DaemonSupervisor } from "../../src/daemon/supervisor.js";

const live = process.env.ANTHROPIC_API_KEY ? describe : describe.skip;

live("daemon defaults (live)", () => {
  it("a bare spawn runs on opus-4-8 with the CC preset and completes a turn", async () => {
    const sup = new DaemonSupervisor({ query: sdkQuery }, { dir: mkdtempSync(join(tmpdir(), "cc-daemon-live-")) });
    try {
      const id = sup.spawn({});                                  // no model, no mode → harness defaults
      const { result } = await sup.submit(id, "Reply with exactly the single word READY.", () => {});
      expect(String(result)).toMatch(/READY/i);
      expect(sup.list().find((r) => r.id === id)?.model).toBe("claude-opus-4-8");
    } finally {
      await sup.shutdown();
    }
  }, 120_000);
});
```

- [ ] **Step 2: Verify it skips cleanly without a key**

Run: `npm run test:unit -- daemon-defaults` (or `npx vitest run test/live/daemon-defaults.e2e.test.ts` without a key)
Expected: the suite is SKIPPED (no `ANTHROPIC_API_KEY`), exit 0. Do not run it keyed — the controller runs the keyed live pass.

- [ ] **Step 3: Final full gate**

Run: `npm run typecheck && npm run test:unit`
Expected: exit 0 + green across the whole unit suite (the live test skips).

- [ ] **Step 4: Update the coverage scorecard**

In `docs/parity/coverage.md`, add one line noting Increment A: the harness now defaults to Opus 4.8 · xhigh · auto, and daemon-spawned sessions route through `resolveOptions` (CC system-prompt preset + project `settingSources` + tools preset) — closing the bare-daemon gap. Keep it to a single sentence in the relevant domain row/section; do not restructure the file.

- [ ] **Step 5: Refresh memory**

Update `/Users/new/.claude/projects/-Users-new-Documents-GitHub-codex-somersault/memory/phase3-observability-dashboard-shipped.md` (or add a short sibling memory) recording: Increment A shipped — harness-wide defaults (opus-4-8/xhigh/auto) centralized in `resolveOptions`; daemon `makeSession` now routes through `resolveOptions` (+ `spawn()` opus default for registry parity); the explicit-auto-only model-gate subtlety; 1M dropped (probe 26: opus-4-8 already 1M). Add/refresh the one-line pointer in `MEMORY.md`.

- [ ] **Step 6: Commit**

```bash
git add harness/test/live/daemon-defaults.e2e.test.ts docs/parity/coverage.md
git commit -m "test(daemon): gated live e2e for harness defaults + daemon parity; refresh coverage"
```
(The memory files live outside the repo and are not committed.)

---

## Notes for the executor

- **Blast radius is bounded and pre-identified:** `resolveOptions.test.ts` (2 updated assertions + 2 new tests, Task 1) and `daemon-supervisor-permissions.test.ts` (1 updated test + 1 new test, Task 2). The "run the full unit suite and fix ripples" steps are the net for anything else (most likely `session-factories`/`index`/`readme` for the lib, bare-spawn model assertions for the daemon). A test changing because behavior *correctly* changed must be **updated to assert the new truth**, never weakened to pass.
- **The one-shot CLI** (`cli.ts`) explicitly sets `permissionMode: "bypassPermissions"`, which overrides the auto default — it is unaffected by Task 1 (it now also runs opus-4-8 + xhigh, which is intended).
- **Do not** re-introduce the 1M `[1m]`/`context-1m` mechanism — probe 26 proved it is a no-op for opus-4-8.
