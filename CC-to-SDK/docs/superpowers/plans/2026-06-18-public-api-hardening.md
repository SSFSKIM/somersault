# Public-API Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the `cc-harness` public boundary before publish — a curated, validated, leak-free, frozen API.

**Architecture:** Four sequential parts on the existing surface: **A** prune implementation plumbing from the root export barrel; **B** add a zod front-door validator (`HarnessConfigError`); **C** sweep the public lifecycle surfaces for the parked-promise/leak/fake-settle/idempotency bug class; **D** freeze the final surface with a comprehensive snapshot + stability-tier doc. Sequenced A→B→C→D so pinning sees the final surface.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest, zod (`import { z } from "zod/v4"`), DI-by-deps fakes. **Keyless throughout — no live test** (no SDK runtime premise).

## Global Constraints

- **Spec:** `CC-to-SDK/docs/superpowers/specs/2026-06-18-public-api-hardening-design.md`.
- **Working dir:** `CC-to-SDK/harness/`. All commands run from there.
- **Dense hand-style, NO Prettier** — match surrounding compact code; never reformat unrelated lines.
- **ESM:** every import specifier ends in `.js`.
- **zod import:** `import { z } from "zod/v4";` (the repo's style — see `tasks/types.ts`, `swarm/types.ts`).
- **`src/index.ts` is THE public API barrel** (per `harness/CLAUDE.md`); curation prunes it. Internal code imports from module paths, NOT the package root — so pruning the barrel does not break internal imports.
- **Type-only vs value exports:** `QueryHolder`/`CompactHolder` are `export type` (erased at runtime — verified by `typecheck`/`build`); `SessionRegistry`/`MessageBus`/`parseCompactOutcome` are value exports (runtime-assertable). Tests that check `import * as api` can only assert *value* exports.
- **Validation guards, never transforms** — `resolveOptions` still builds the SDK `Options`; escape-hatch fields (`extraOptions`/`settings`/`managedSettings`/`customHeaders`) stay `.passthrough()` (unvalidated).
- **Commits:** to the current branch (`main`); **no `Co-Authored-By`** or any attribution.
- **Gates:** `npm run test:unit` (all green), `npm run typecheck`, and — for Parts A/D — `npm run build` (proves the curated `.d.ts` resolve). Keyless; no `ANTHROPIC_API_KEY` needed.
- After a subagent edit, phantom LSP diagnostics are stale — trust a clean `npm run typecheck` + green vitest.

---

### Task 1: Part A — Boundary curation (prune the root barrel)

Remove the five implementation-plumbing exports from `src/index.ts`. Internal code is unaffected (it imports from module paths). Add an interim assertion that the three *value* plumbing exports are gone; `build` proves the two type-only ones are gone.

**Files:**
- Modify: `src/index.ts` (remove 5 names across 5 export lines)
- Test: `test/unit/index.test.ts` (add one interim assertion)

**Interfaces:**
- Produces: a pruned public surface — `QueryHolder`, `CompactHolder`, `SessionRegistry`, `MessageBus`, `parseCompactOutcome` are no longer re-exported from the package root.

- [ ] **Step 1: Confirm nothing imports these from the package root**

Run: `grep -rnE "from \"\.\./\.\./src/index" test/ | grep -E "QueryHolder|CompactHolder|SessionRegistry|MessageBus|parseCompactOutcome"` and `grep -rnE "from \"\\./index" src/ | grep -E "QueryHolder|CompactHolder|SessionRegistry|MessageBus|parseCompactOutcome"`
Expected: no output (these are imported from module paths, not the root barrel). If anything appears, change that import to the module path before proceeding.

- [ ] **Step 2: Write the failing test**

In `test/unit/index.test.ts`, add this test inside `describe("public API", …)`:

```ts
  it("does NOT export internal plumbing from the package root (boundary curation)", () => {
    for (const name of ["SessionRegistry", "MessageBus", "parseCompactOutcome"]) // value exports (type-only QueryHolder/CompactHolder are erased)
      expect(api).not.toHaveProperty(name);
  });
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run test/unit/index.test.ts -t "internal plumbing"`
Expected: FAIL — `api` still has `SessionRegistry`/`MessageBus`/`parseCompactOutcome`.

- [ ] **Step 4: Prune `src/index.ts`**

Apply these five edits (remove only the named symbol from each line):

```ts
// line 10 — remove MessageBus
export { SwarmRuntime, createSwarmMcpServer, SwarmError } from "./swarm/index.js";
// line 12 — remove SessionRegistry
export { DaemonSupervisor, DaemonServer, daemonRequest, daemonSocketPath, DaemonError } from "./daemon/index.js";
// line 19 — remove QueryHolder (type-only)
export type { RawContextUsage, ContextUsageSummary } from "./context/index.js";
// line 20 — remove parseCompactOutcome
export { createCompactMcpServer, COMPACT_TOOL } from "./compaction/index.js";
// line 21 — remove CompactHolder (type-only)
export type { CompactOutcome } from "./compaction/index.js";
```

- [ ] **Step 5: Run the test + build to verify green**

Run: `npx vitest run test/unit/index.test.ts` (the value plumbing is gone) and `npm run build` (proves the pruned barrel's `.d.ts` resolve — the type-only removals can't dangle).
Expected: tests PASS; build emits `dist/` with no errors.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/index.ts test/unit/index.test.ts
git commit -m "refactor(harness): prune internal plumbing from the public barrel (api-hardening A)"
```

---

### Task 2: Part B1 — the config validator module

Create `src/config/validate.ts`: a zod schema over the *constrained* `HarnessConfig` fields, a `HarnessConfigError`, and `validateHarnessConfig`. Standalone (not yet wired into the front doors — that is Task 3).

**Files:**
- Create: `src/config/validate.ts`
- Test: `test/unit/config-validate.test.ts`

**Interfaces:**
- Produces: `class HarnessConfigError extends Error`; `const harnessConfigSchema`; `function validateHarnessConfig(config: unknown): void` (throws `HarnessConfigError` on bad input); `function validateDaemonOptions(opts: unknown): void`.

- [ ] **Step 1: Write the failing test**

Create `test/unit/config-validate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateHarnessConfig, validateDaemonOptions, HarnessConfigError } from "../../src/config/validate.js";

describe("validateHarnessConfig", () => {
  it("accepts a valid config and passes escape-hatch fields untouched", () => {
    expect(() => validateHarnessConfig({ model: "claude-haiku-4-5", maxTurns: 3, effort: "high",
      thinking: { type: "enabled", budgetTokens: 1024 }, permissionMode: "acceptEdits",
      extraOptions: { anything: 123 }, settings: { whatever: true } })).not.toThrow();
    expect(() => validateHarnessConfig({})).not.toThrow();
  });
  it("rejects bad enums / numerics / shapes with HarnessConfigError naming the path", () => {
    expect(() => validateHarnessConfig({ permissionMode: "bogus" })).toThrow(HarnessConfigError);
    expect(() => validateHarnessConfig({ maxTurns: 0 })).toThrow(/maxTurns/);
    expect(() => validateHarnessConfig({ maxBudgetUsd: -1 })).toThrow(/maxBudgetUsd/);
    expect(() => validateHarnessConfig({ effort: "ultra" })).toThrow(/effort/);
    expect(() => validateHarnessConfig({ thinking: { type: "enabled" } })).toThrow(/thinking/); // missing budgetTokens
    expect(() => validateHarnessConfig({ maxTurns: "five" as any })).toThrow(/maxTurns/);
  });
});
describe("validateDaemonOptions", () => {
  it("accepts valid daemon options and rejects a bad restart / negative bound", () => {
    expect(() => validateDaemonOptions({ model: "m", restart: "on-failure", maxSessions: 8 })).not.toThrow();
    expect(() => validateDaemonOptions({ restart: "sometimes" })).toThrow(HarnessConfigError);
    expect(() => validateDaemonOptions({ maxSessions: -1 })).toThrow(/maxSessions/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/config-validate.test.ts`
Expected: FAIL — module `../../src/config/validate.js` does not exist.

- [ ] **Step 3: Implement `src/config/validate.ts`**

```ts
import { z } from "zod/v4";

/** Thrown at the public front doors on a malformed config — mirrors DaemonError / SwarmError / TaskError. */
export class HarnessConfigError extends Error {}

// Validates ONLY the fields with invalidate-able constraints; .passthrough() leaves every other field
// (incl. escape hatches extraOptions/settings/managedSettings/customHeaders) untouched.
export const harnessConfigSchema = z.object({
  model: z.string().min(1).optional(),
  fallbackModel: z.string().min(1).optional(),
  maxTurns: z.number().int().positive().optional(),
  maxBudgetUsd: z.number().nonnegative().optional(),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
  permissionMode: z.enum(["default", "plan", "acceptEdits", "auto", "bypassPermissions", "dontAsk"]).optional(),
  provider: z.enum(["anthropic", "bedrock", "vertex", "foundry"]).optional(),
  toolPreset: z.enum(["claude_code", "none"]).optional(),
  thinking: z.union([
    z.object({ type: z.enum(["adaptive", "disabled"]) }),
    z.object({ type: z.literal("enabled"), budgetTokens: z.number().int().positive() }),
  ]).optional(),
  taskBudget: z.object({ total: z.number().int().positive() }).optional(),
  settingSources: z.array(z.enum(["user", "project", "local"])).optional(),
  autoCompactWindow: z.number().int().positive().optional(),
  sandbox: z.union([z.boolean(), z.record(z.string(), z.unknown())]).optional(),
}).passthrough();

export const daemonOptionsSchema = z.object({
  model: z.string().min(1).optional(),
  restart: z.enum(["no", "on-failure"]).optional(),
  maxSessions: z.number().int().positive().optional(),
  idleTimeoutMs: z.number().int().nonnegative().optional(),
  maxRestarts: z.number().int().nonnegative().optional(),
}).passthrough();

function check(schema: z.ZodType, value: unknown): void {
  const r = schema.safeParse(value);
  if (!r.success) { const i = r.error.issues[0]; throw new HarnessConfigError(`invalid config at ${i.path.join(".") || "(root)"}: ${i.message}`); }
}

export function validateHarnessConfig(config: unknown): void { check(harnessConfigSchema, config); }
export function validateDaemonOptions(opts: unknown): void { check(daemonOptionsSchema, opts); }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/config-validate.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/config/validate.ts test/unit/config-validate.test.ts
git commit -m "feat(harness): zod config validator + HarnessConfigError (api-hardening B1)"
```

---

### Task 3: Part B2 — wire validation into the front doors + re-export

Call `validateHarnessConfig` at `createHarness`/`openSession`, `validateDaemonOptions` at `DaemonSupervisor` construction, and re-export the validator + error from the public barrel.

**Files:**
- Modify: `src/harness.ts` (`createHarness`), `src/session/index.ts` (`openSession`), `src/daemon/supervisor.ts` (constructor), `src/index.ts` (re-export)
- Test: `test/unit/harness.test.ts`, `test/unit/session-factories.test.ts`, `test/unit/daemon-supervisor.test.ts` (add a guard test to each)

**Interfaces:**
- Consumes: `validateHarnessConfig`, `validateDaemonOptions`, `HarnessConfigError` from `./config/validate.js` (Task 2).
- Produces: `createHarness`/`openSession`/`new DaemonSupervisor` throw `HarnessConfigError` on bad config; `HarnessConfigError` + `validateHarnessConfig` are public exports. `resumeHarness`/`resumeSession` inherit validation (they delegate).

- [ ] **Step 1: Write the failing tests**

In `test/unit/harness.test.ts`, add:

```ts
  it("createHarness rejects a malformed config with HarnessConfigError", async () => {
    const { createHarness } = await import("../../src/harness.js");
    const { HarnessConfigError } = await import("../../src/config/validate.js");
    expect(() => createHarness({ permissionMode: "bogus" as any })).toThrow(HarnessConfigError);
  });
```

In `test/unit/session-factories.test.ts`, add:

```ts
  it("openSession rejects a malformed config with HarnessConfigError", async () => {
    const { openSession } = await import("../../src/session/index.js");
    const { HarnessConfigError } = await import("../../src/config/validate.js");
    expect(() => openSession({ maxTurns: 0 } as any)).toThrow(HarnessConfigError);
  });
```

In `test/unit/daemon-supervisor.test.ts`, add (inside the describe):

```ts
  it("rejects a malformed DaemonOptions at construction", async () => {
    const { HarnessConfigError } = await import("../../src/config/validate.js");
    expect(() => new DaemonSupervisor({ query: fakeQuery }, { dir: dir(), restart: "sometimes" as any })).toThrow(HarnessConfigError);
  });
```

In `test/unit/index.test.ts`, add:

```ts
  it("exports the config validator + error (api-hardening)", () => {
    expect(typeof api.validateHarnessConfig).toBe("function");
    expect(typeof api.HarnessConfigError).toBe("function");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/unit/harness.test.ts test/unit/session-factories.test.ts test/unit/daemon-supervisor.test.ts test/unit/index.test.ts -t "malformed|validator"`
Expected: FAIL — no validation wired, no re-export.

- [ ] **Step 3: Wire `createHarness`**

In `src/harness.ts`, add the import and the first line of `createHarness`:

```ts
import { validateHarnessConfig } from "./config/validate.js";
```
```ts
export function createHarness(config: HarnessConfig = {}, deps: HarnessDeps = {}): Harness {
  validateHarnessConfig(config);
  const query = deps.query ?? sdkQuery;
```

- [ ] **Step 4: Wire `openSession`**

In `src/session/index.ts`, add the import and the first line of `openSession`:

```ts
import { validateHarnessConfig } from "../config/validate.js";
```
```ts
export function openSession(config: OpenSessionConfig = {}, deps: SessionDepsInput = {}): Session {
  validateHarnessConfig(config);
  const query = deps.query ?? sdkQuery;
```

- [ ] **Step 5: Wire the daemon**

In `src/daemon/supervisor.ts`, add the import and validate as the first statement of the constructor (before `this.registry = …`):

```ts
import { validateDaemonOptions } from "../config/validate.js";
```
```ts
  constructor(private deps: DaemonDeps, opts: DaemonOptions = {}) {
    validateDaemonOptions(opts);
    this.registry = new SessionRegistry({ dir: opts.dir, isAlive: opts.isAlive });
```

- [ ] **Step 6: Re-export from the public barrel**

In `src/index.ts`, add:

```ts
export { validateHarnessConfig, HarnessConfigError } from "./config/validate.js";
```

- [ ] **Step 7: Run the tests to verify they pass + full suite (no regression)**

Run: `npx vitest run test/unit/harness.test.ts test/unit/session-factories.test.ts test/unit/daemon-supervisor.test.ts test/unit/index.test.ts` then `npm run test:unit`.
Expected: all PASS — and the existing harness/session/daemon tests still pass (their configs are all valid).

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/harness.ts src/session/index.ts src/daemon/supervisor.ts src/index.ts test/unit/
git commit -m "feat(harness): validate config at the front doors + re-export validator (api-hardening B2)"
```

---

### Task 4: Part C1 — teardown liveness for the library surfaces (Session + harness)

Lock the four liveness properties on `Session.dispose` and the one-shot `createHarness`. Write the assertions; **if any fails, fix the surface minimally and note it in the report**; most should pass and lock the invariant.

**Files:**
- Test: `test/unit/session-teardown.test.ts` (new), `test/unit/harness.test.ts` (add)
- Possibly modify: `src/session/session.ts` / `src/harness.ts` (only if a liveness test reveals a gap)

**Interfaces:**
- Consumes: `Session` (`submit`/`dispose`/`isEnded`), `createHarness` (`run`/`stream`/`call`-guarded methods). The fake-query patterns from `test/unit/session.test.ts`.

- [ ] **Step 1: Write the Session liveness tests**

Create `test/unit/session-teardown.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Session } from "../../src/session/session.js";

// a well-behaved fake query: one result per turn, ends when the input (prompt) closes
const healthy = ({ prompt }: any) => (async function* () { for await (const t of prompt) yield { type: "result", result: "did:" + t.message.content }; })();
// a fake that accepts a turn but never yields a result (turn stays in-flight) until input closes
const stalled = ({ prompt }: any) => (async function* () { for await (const _t of prompt) { /* never yields a result */ } })();

describe("Session teardown liveness", () => {
  it("no-hang: dispose() resolves even with a healthy query", async () => {
    const s = new Session({ query: healthy }, {});
    await s.submit("hi");
    await expect(s.dispose()).resolves.toBeUndefined();   // completes, no hang
    expect(s.isEnded()).toBe(true);
  });
  it("no-fake-settle: a turn pending at dispose REJECTS (not a bogus resolve)", async () => {
    const s = new Session({ query: stalled }, {});
    const pending = s.submit("hi");                        // never gets a result frame
    await s.dispose();                                      // closes input → readLoop ends → waiters reject
    await expect(pending).rejects.toThrow();               // rejected, not fake-resolved
  });
  it("idempotent: a second dispose() is a safe no-op", async () => {
    const s = new Session({ query: healthy }, {});
    await s.dispose();
    await expect(s.dispose()).resolves.toBeUndefined();    // double dispose must not throw
  });
  it("post-dispose submit rejects rather than hanging", async () => {
    const s = new Session({ query: healthy }, {});
    await s.dispose();
    await expect(s.submit("x")).rejects.toThrow(/not running/);
  });
});
```

- [ ] **Step 2: Run them; fix any gap**

Run: `npx vitest run test/unit/session-teardown.test.ts`
Expected: PASS. If the **idempotent** or **no-fake-settle** case fails, fix `src/session/session.ts` minimally (e.g. guard `dispose()` so a second call is a no-op; ensure `readLoop`'s `finally` rejects all waiters) and re-run. Record any fix in the report.

- [ ] **Step 3: Write the harness liveness tests**

In `test/unit/harness.test.ts`, add:

```ts
  it("teardown: a control method before any run() throws cleanly (no hang)", async () => {
    const { createHarness } = await import("../../src/harness.js");
    const h = createHarness({}, { query: (() => (async function* () {})()) as any });
    await expect(h.getContextUsage()).rejects.toThrow(/start a query first/);
  });
  it("teardown: a stream can be abandoned early without hanging", async () => {
    const { createHarness } = await import("../../src/harness.js");
    const q = ({ prompt }: any) => (async function* () { for await (const t of prompt) { yield { type: "chunk", n: 1 }; yield { type: "result", result: "ok" }; } })();
    const h = createHarness({}, { query: q as any });
    for await (const _m of h.stream("hi")) break;          // abandon after the first frame
    expect(true).toBe(true);                                // reached here ⇒ no hang
  });
```

- [ ] **Step 4: Run + typecheck**

Run: `npx vitest run test/unit/harness.test.ts test/unit/session-teardown.test.ts` then `npm run typecheck`.
Expected: PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add test/unit/session-teardown.test.ts test/unit/harness.test.ts src/session/session.ts src/harness.ts
git commit -m "test(harness): teardown-liveness sweep for Session + harness (api-hardening C1)"
```

---

### Task 5: Part C2 — teardown liveness for the daemon + swarm surfaces

Lock idempotency + no-leak on `DaemonServer.close`, `DaemonSupervisor.shutdown`, and `SwarmRuntime.disposeAll`. Write the assertions; fix any gap; most should pass.

**Files:**
- Test: `test/unit/daemon-supervisor.test.ts`, `test/unit/swarm-runtime.test.ts` (add); `test/unit/daemon-server.test.ts` (add)
- Possibly modify: `src/daemon/supervisor.ts` / `src/swarm/runtime.ts` (only if a liveness test reveals a gap)

**Interfaces:**
- Consumes: `DaemonSupervisor` (`shutdown`/`spawn`), `SwarmRuntime` (`disposeAll`), `DaemonServer` (`close`). The existing fakes in each test file (`fakeQuery`, `dir()`, the swarm runtime setup).

- [ ] **Step 1: Write the daemon idempotency tests**

In `test/unit/daemon-supervisor.test.ts`, add (inside the describe):

```ts
  it("teardown: a second shutdown() is a safe no-op (idempotent)", async () => {
    const sup = new DaemonSupervisor({ query: fakeQuery }, { dir: dir() });
    sup.spawn();
    await sup.shutdown();
    await expect(sup.shutdown()).resolves.toBeUndefined();   // double shutdown must not throw
    expect(sup.list()).toEqual([]);
  });
```

In `test/unit/daemon-server.test.ts`, add (the file already imports `DaemonSupervisor`/`DaemonServer`/`mkdtempSync`/`tmpdir`/`join` and defines the `tmp()` helper + `fakeQuery` — reuse them):

```ts
  it("teardown: a second close() is a safe no-op (idempotent)", async () => {
    const sup = new DaemonSupervisor({ query: fakeQuery }, { dir: tmp() });
    const sock = join(tmp(), "s");
    const server = new DaemonServer(sup, sock);
    await server.listen();
    await server.close();
    await expect(server.close()).resolves.toBeUndefined();   // the `closing` guard makes this a no-op
    await sup.shutdown();
  });
```

- [ ] **Step 2: Write the swarm idempotency test**

In `test/unit/swarm-runtime.test.ts`, add (the file defines the `newRuntime()` helper and constructs teams/teammates via `createTeam`/`spawnTeammate` — reuse them exactly):

```ts
  it("teardown: a second disposeAll() is a safe no-op (idempotent)", async () => {
    const rt = newRuntime();
    const team = rt.createTeam("alpha");
    rt.spawnTeammate({ teamId: team.id, name: "w1", prompt: "seed" });
    await rt.disposeAll();
    await expect(rt.disposeAll()).resolves.toBeUndefined();  // second teardown must not throw
  });
```

- [ ] **Step 3: Run them; fix any gap**

Run: `npx vitest run test/unit/daemon-supervisor.test.ts test/unit/daemon-server.test.ts test/unit/swarm-runtime.test.ts -t "idempotent|second"`
Expected: PASS. If a second-teardown case throws, fix the surface minimally (e.g. an early-return guard like `DaemonServer`'s `closing` flag) and re-run. Record any fix in the report.

- [ ] **Step 4: Full suite + typecheck**

Run: `npm run test:unit` then `npm run typecheck`.
Expected: all PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add test/unit/daemon-supervisor.test.ts test/unit/daemon-server.test.ts test/unit/swarm-runtime.test.ts src/daemon/supervisor.ts src/swarm/runtime.ts
git commit -m "test(harness): teardown-liveness sweep for daemon + swarm (api-hardening C2)"
```

---

### Task 6: Part D — freeze the surface + stability-tier doc

Replace the spot-check with a comprehensive frozen-surface assertion of the final curated value exports, and document a stability tier per export. Done LAST, after A (prune) + B (add validator) settle the surface.

**Files:**
- Modify: `test/unit/index.test.ts` (add the comprehensive freeze)
- Create: `harness/API-STABILITY.md`

**Interfaces:**
- Consumes: the final public surface (post-A, post-B).

- [ ] **Step 1: Write the freeze test (bootstrap the expected list)**

In `test/unit/index.test.ts`, add:

```ts
  it("freezes the full public value-export surface (deliberate-update gate)", () => {
    const EXPECTED: string[] = [ /* bootstrap: see Step 2 */ ];
    expect(Object.keys(api).sort()).toEqual(EXPECTED);
  });
```

- [ ] **Step 2: Bootstrap + VERIFY the expected list**

Run: `npx vitest run test/unit/index.test.ts -t "freezes the full public"` — it fails and prints the actual sorted array. Paste that array into `EXPECTED`, then **verify it against the curation intent** (this verification is the point — do not blind-paste):
- MUST NOT contain: `SessionRegistry`, `MessageBus`, `parseCompactOutcome` (pruned in Task 1), nor `QueryHolder`/`CompactHolder` (type-only, never runtime keys anyway).
- MUST contain: `validateHarnessConfig`, `HarnessConfigError` (added in Task 3), plus all the kept product entry points (`createHarness`, `resumeHarness`, `openSession`, `resumeSession`, `Session`, `listSessions`, `getSessionMessages`, `getSessionInfo`, `forkSession`, `renameSession`, `tagSession`, `deleteSession`, `DaemonSupervisor`, `DaemonServer`, `daemonRequest`, `daemonSocketPath`, `DaemonError`, `SwarmRuntime`, `createSwarmMcpServer`, `SwarmError`, `TaskStore`, `TaskError`, `createTaskMcpServer`, `KairosAssistant`, `createBriefMcpServer`, `stdoutBriefSink`, `applyAssistantPersona`, `resolveAssistantPosture`, `createContextMcpServer`, `summarizeUsage`, `CONTEXT_TOOL`, `createCompactMcpServer`, `COMPACT_TOOL`, `resolveOptions`, `DEFAULTS`, `BUILTIN_AGENTS`, `BUILTIN_OUTPUT_STYLES`, `injectContext`, `guardTool`, `blockTool`, `observe`, `mergeHooks`).

- [ ] **Step 3: Run the freeze test to verify it passes**

Run: `npx vitest run test/unit/index.test.ts`
Expected: PASS (the verified `EXPECTED` matches `Object.keys(api).sort()`).

- [ ] **Step 4: Write the stability-tier doc**

Create `harness/API-STABILITY.md` with a table assigning every public export a tier. Use these tiers and assignments:
- **stable** — the core entry points: `createHarness`/`resumeHarness`/`run`/`stream`, `openSession`/`resumeSession`/`Session`, the `sessions/*` read+mutate fns + `forkSession`, the hook builders, `resolveOptions`, `validateHarnessConfig`/`HarnessConfigError`, `TaskStore`, config types/`DEFAULTS`/`BUILTIN_*`.
- **experimental** — anything wrapping an unstable SDK surface or an alpha beta: `Harness.usage()` (wraps `usage_EXPERIMENTAL_…`), `taskBudget` (alpha beta), the `KairosAssistant` persona.
- **advanced-seam** — for embedders running their own daemon/swarm/tools: `DaemonSupervisor`/`DaemonServer`/`daemonRequest`/`daemonSocketPath`/`DaemonError`, `SwarmRuntime`/`createSwarmMcpServer`/`SwarmError`, `createContextMcpServer`/`createCompactMcpServer`/`CONTEXT_TOOL`/`COMPACT_TOOL`/`summarizeUsage`.

Open the file with a one-paragraph intro: tiers are documentation of intent (not enforced); `stable` follows semver once published, `experimental` may change, `advanced-seam` is for embedders and may shift with internals.

- [ ] **Step 5: Full suite + typecheck + build**

Run: `npm run test:unit`, `npm run typecheck`, `npm run build`.
Expected: all green; `dist/` emits cleanly.

- [ ] **Step 6: Commit**

```bash
git add test/unit/index.test.ts harness/API-STABILITY.md
git commit -m "test(harness): freeze the public surface + stability-tier doc (api-hardening D)"
```

---

## Post-implementation (controller)

After all six tasks pass review:
- Run the full unit suite: `npm run test:unit` (expect all green), `npm run typecheck`, `npm run build`.
- Refresh `docs/parity/coverage.md` and the `harden-and-ship-over-phase3` memory: sub-project 2 (public-API polish & boundary hardening) **DONE**; resume point becomes sub-project 3 (docs) / 4 (test & CI hardening).
