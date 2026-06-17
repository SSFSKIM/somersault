# Session Persistence Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `sessionId` a durable, resumable handle across the harness by passing the SDK's `resume`/`persistSession`/`sessionStore` options through `HarnessConfig`, plus a `resumeHarness()` helper, `--resume`/`--no-persist` CLI flags, and a daemon `spawn({resume})` op.

**Architecture:** Thin passthrough — the SDK already persists transcripts to `~/.claude/projects` by default and `resume` works (verified live). This adds capability and ergonomics, not a storage engine: three new config fields flow into `resolveOptions`, a one-line helper, a CLI parse branch, and a daemon spawn-op field. No harness-owned store.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), Vitest, Zod v4 (`zod/v4`), `@anthropic-ai/claude-agent-sdk` 0.3.178.

**Spec:** `docs/superpowers/specs/2026-06-17-session-persistence-spine-design.md`

## Global Constraints

- **Thin passthrough only** — no harness-owned storage backend; the default stays the SDK-native disk store. `sessionStore` is a BYO seam (pure passthrough).
- **`persistSession` is emitted only when defined** (`!== undefined`), so an explicit `false` reaches the SDK while the absent default preserves the SDK's `true`. Never add a `DEFAULTS` entry for it.
- **`resumeHarness` is stateless** — a resumed handle applies its `resume` id to every `run()`; the documented idiomatic unit is one continuation run per handle. No hidden session state.
- **Daemon auto-restart is UNTOUCHED** — `resume` applies only to the initial `spawn`; a resumed session that crashes restarts *fresh* (the D2 restart path must not carry `resume`).
- **`cli.ts` is not modified** — flags flow `parseArgs` → `config` → `createHarness` automatically.
- **No Prettier.** Match the surrounding compact hand-style (single-line guards, inline `if`).
- **Commit to `main`. Never push. No `Co-Authored-By` lines or attribution.**
- Working dir: `CC-to-SDK/harness/`. Tests: `npx vitest run <path>` (one file), `npm run test:unit`, `npm run test:live`, `npm run typecheck`.

---

### Task 1: Config passthrough (`resume` / `persistSession` / `sessionStore`)

**Files:**
- Modify: `src/config/types.ts` (import + `HarnessConfig` fields)
- Modify: `src/config/resolveOptions.ts` (3 passthrough lines)
- Test: `test/unit/resolveOptions.test.ts`

**Interfaces:**
- Consumes: nothing (foundation task).
- Produces: `HarnessConfig.resume?: string`, `HarnessConfig.persistSession?: boolean`, `HarnessConfig.sessionStore?: SessionStore`. `resolveOptions(config)` emits `options.resume` / `options.persistSession` / `options.sessionStore` accordingly. Tasks 2–5 rely on these field names.

- [ ] **Step 1: Write the failing tests** — append to `test/unit/resolveOptions.test.ts`, inside the `describe("resolveOptions", …)` block (before its closing `});`):

```ts
  it("threads resume and sessionStore when set, omits them otherwise", () => {
    const store = { append: async () => {}, load: async () => null } as any;
    const o: any = resolveOptions({ resume: "sess-abc", sessionStore: store });
    expect(o.resume).toBe("sess-abc");
    expect(o.sessionStore).toBe(store);
    const bare: any = resolveOptions({});
    expect(bare).not.toHaveProperty("resume");
    expect(bare).not.toHaveProperty("sessionStore");
  });
  it("emits persistSession for true and false, omits when undefined", () => {
    expect((resolveOptions({ persistSession: false }) as any).persistSession).toBe(false);
    expect((resolveOptions({ persistSession: true }) as any).persistSession).toBe(true);
    expect(resolveOptions({})).not.toHaveProperty("persistSession");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/unit/resolveOptions.test.ts`
Expected: FAIL — `resume`/`sessionStore` undefined on the result (fields not yet threaded).

- [ ] **Step 3: Add the config fields** — in `src/config/types.ts`, extend the SDK import (line 1) to include `SessionStore`:

```ts
import type { AgentDefinition, McpServerConfig, PermissionMode, SdkPluginConfig, SessionStore } from "@anthropic-ai/claude-agent-sdk";
```

Then add this group to `HarnessConfig`, immediately after the `enableFileCheckpointing?: boolean;` line (currently line 37):

```ts
  // session persistence — the SDK persists transcripts to ~/.claude/projects by default
  resume?: string;                         // SDK session_id to reload prior context
  persistSession?: boolean;                // default SDK-true; false = ephemeral (no disk persistence)
  sessionStore?: SessionStore;             // BYO transcript-mirror backend (advanced; pure passthrough)
```

- [ ] **Step 4: Add the passthrough lines** — in `src/config/resolveOptions.ts`, immediately after the `if (config.cwd) options.cwd = config.cwd;` line (just before the `return`):

```ts
  if (config.resume) options.resume = config.resume;
  if (config.persistSession !== undefined) options.persistSession = config.persistSession;
  if (config.sessionStore) options.sessionStore = config.sessionStore;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/unit/resolveOptions.test.ts`
Expected: PASS (all cases, including the pre-existing ones).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add CC-to-SDK/harness/src/config/types.ts CC-to-SDK/harness/src/config/resolveOptions.ts CC-to-SDK/harness/test/unit/resolveOptions.test.ts
git commit -m "feat(harness): thread resume/persistSession/sessionStore into Options"
```

---

### Task 2: `resumeHarness()` helper + public export

**Files:**
- Modify: `src/harness.ts` (add `resumeHarness`)
- Modify: `src/index.ts` (export it)
- Test: `test/unit/harness.test.ts`, `test/unit/index.test.ts`

**Interfaces:**
- Consumes: `HarnessConfig.resume` (Task 1); existing `createHarness(config, deps)`, `Harness`, `HarnessDeps` from `src/harness.ts`.
- Produces: `resumeHarness(sessionId: string, config?: HarnessConfig, deps?: HarnessDeps): Harness` — equals `createHarness({ ...config, resume: sessionId }, deps)`. Task 5 (live) uses it.

- [ ] **Step 1: Write the failing tests** — in `test/unit/harness.test.ts`, change the import (line 2) to:

```ts
import { createHarness, resumeHarness } from "../../src/harness.js";
```

Then append inside the `describe("createHarness", …)` block (before its closing `});`):

```ts
  it("resumeHarness sets options.resume to the given session id", () => {
    const h = resumeHarness("sess-xyz", {}, { query: fakeQuery });
    expect((h.options as any).resume).toBe("sess-xyz");
  });
  it("createHarness without resume leaves options.resume unset", () => {
    const h = createHarness({}, { query: fakeQuery });
    expect((h.options as any).resume).toBeUndefined();
  });
```

Also append to `test/unit/index.test.ts`, inside its `it("exports …")` block (before the block's closing `});`):

```ts
    expect(typeof api.resumeHarness).toBe("function");
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/unit/harness.test.ts test/unit/index.test.ts`
Expected: FAIL — `resumeHarness` is not exported / not a function.

- [ ] **Step 3: Implement `resumeHarness`** — in `src/harness.ts`, append at the end of the file (after `createHarness`'s closing brace):

```ts
/** Resume a prior session by id: a thin wrapper over createHarness with `resume` set.
 *  Stateless — the returned handle applies `sessionId` to EVERY run() it makes, so the idiomatic
 *  use is ONE continuation run per handle; thread the returned run().sessionId forward for the next
 *  turn (for linear multi-turn, prefer the daemon's long-lived session). */
export function resumeHarness(sessionId: string, config: HarnessConfig = {}, deps?: HarnessDeps): Harness {
  return createHarness({ ...config, resume: sessionId }, deps);
}
```

- [ ] **Step 4: Export it** — in `src/index.ts`, change the first export line from:

```ts
export { createHarness } from "./harness.js";
```

to:

```ts
export { createHarness, resumeHarness } from "./harness.js";
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/unit/harness.test.ts test/unit/index.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add CC-to-SDK/harness/src/harness.ts CC-to-SDK/harness/src/index.ts CC-to-SDK/harness/test/unit/harness.test.ts CC-to-SDK/harness/test/unit/index.test.ts
git commit -m "feat(harness): resumeHarness(id) helper + public export"
```

---

### Task 3: CLI flags `--resume` / `--no-persist`

**Files:**
- Modify: `src/cliArgs.ts` (two parse branches)
- Test: `test/unit/cliArgs.test.ts`

**Interfaces:**
- Consumes: `HarnessConfig.resume` / `HarnessConfig.persistSession` (Task 1).
- Produces: `parseArgs(["--resume", id])` → `config.resume = id`; `parseArgs(["--no-persist"])` → `config.persistSession = false`. `cli.ts` is NOT modified (flags flow through `parseArgs` → `config` → `createHarness`).

- [ ] **Step 1: Write the failing test** — append to `test/unit/cliArgs.test.ts`, inside the `describe("cli args", …)` block (before its closing `});`):

```ts
  it("parses --resume and --no-persist", () => {
    const a = parseArgs(["continue the task", "--resume", "sess-123", "--no-persist"]);
    expect(a.prompt).toBe("continue the task");
    expect(a.config.resume).toBe("sess-123");
    expect(a.config.persistSession).toBe(false);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/cliArgs.test.ts`
Expected: FAIL — `config.resume` / `config.persistSession` undefined.

- [ ] **Step 3: Add the parse branches** — in `src/cliArgs.ts`, inside the `for` loop, add two branches immediately after the `--cwd` branch (currently line 14):

```ts
    else if (a === "--resume") config.resume = argv[++i];
    else if (a === "--no-persist") config.persistSession = false;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/cliArgs.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add CC-to-SDK/harness/src/cliArgs.ts CC-to-SDK/harness/test/unit/cliArgs.test.ts
git commit -m "feat(harness): --resume / --no-persist CLI flags"
```

---

### Task 4: Daemon `spawn({ resume })` (auto-restart stays fresh)

**Files:**
- Modify: `src/daemon/types.ts` (`spawnOp` gains `resume`)
- Modify: `src/daemon/supervisor.ts` (`spawn` + `makeSession`)
- Modify: `src/daemon/server.ts` (spawn dispatch passes `op.resume`)
- Test: `test/unit/daemon-types.test.ts`, `test/unit/daemon-supervisor.test.ts`

**Interfaces:**
- Consumes: existing `DaemonSupervisor.spawn(opts)`, `makeSession(id, cfg)`, `SpawnConfig`, the `captureQuery(sink)` test helper (already in `daemon-supervisor.test.ts`).
- Produces: `spawnOp` accepts `resume?: string`; `supervisor.spawn({ resume })` threads `resume` into the *initial* session's options only. `restart()` (auto-restart) calls `makeSession` without `resume`, so restarts are fresh.

- [ ] **Step 1: Write the failing op-schema test** — `test/unit/daemon-types.test.ts` already imports `daemonOp` (line 2). Append this test inside the `describe("daemon protocol", …)` block (before its closing `});`):

```ts
  it("spawn op accepts an optional resume session id", () => {
    const ok = daemonOp.parse({ op: "spawn", resume: "sess-9" });
    if (ok.op === "spawn") expect(ok.resume).toBe("sess-9");
    expect(daemonOp.parse({ op: "spawn" }).op).toBe("spawn"); // resume optional
  });
```

- [ ] **Step 2: Write the failing supervisor tests** — append to `test/unit/daemon-supervisor.test.ts`, inside the `describe("DaemonSupervisor", …)` block (before its closing `});`):

```ts
  it("spawn({resume}) threads resume into the new session's options", async () => {
    const sink: any[] = [];
    const sup = new DaemonSupervisor({ query: captureQuery(sink) }, { dir: dir() });
    sup.spawn({ resume: "sess-prior" });
    expect(sink[0].resume).toBe("sess-prior");
    await sup.shutdown();
  });
  it("auto-restart re-creates the session WITHOUT resume (stays fresh)", async () => {
    const sink: any[] = [];
    const dying = ({ options }: any) => { sink.push(options); return (async function* () {})(); };
    const sup = new DaemonSupervisor({ query: dying }, {
      dir: dir(), restart: "on-failure", maxRestarts: 1,
      scheduleRestart: (fn) => { fn(); return () => {}; },
    });
    sup.spawn({ resume: "sess-prior", restart: "on-failure" });
    await new Promise((r) => setTimeout(r, 20)); // let the death→restart cascade drain
    expect(sink[0].resume).toBe("sess-prior");                        // initial spawn carried resume
    expect(sink.length).toBeGreaterThanOrEqual(2);                   // it restarted at least once
    expect(sink.slice(1).every((o) => o.resume === undefined)).toBe(true); // restarts are fresh
    await sup.shutdown();
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run test/unit/daemon-types.test.ts test/unit/daemon-supervisor.test.ts`
Expected: FAIL — `spawn` ignores `resume`; `sink[0].resume` is undefined.

- [ ] **Step 4: Extend the spawn op** — in `src/daemon/types.ts`, replace the `spawnOp` line (currently line 36):

```ts
const spawnOp = z.object({ op: z.literal("spawn"), model: z.string().optional(), restart: z.enum(["no", "on-failure"]).optional(), resume: z.string().optional() });
```

- [ ] **Step 5: Thread resume through the supervisor** — in `src/daemon/supervisor.ts`:

(a) Change the `spawn` signature and the `makeSession` call (currently lines 72 and 77). Replace the signature line:

```ts
  spawn(opts: { model?: string; restart?: RestartPolicy; resume?: string } = {}): string {
```

and replace `this.pool.set(id, this.makeSession(id, cfg));` with:

```ts
    this.pool.set(id, this.makeSession(id, cfg, opts.resume));
```

(b) Replace the `makeSession` method (currently lines 191–198) with a version that takes an optional `resume` applied to the initial creation only:

```ts
  private makeSession(id: string, cfg: SpawnConfig, resume?: string): DaemonSession {
    const base: Record<string, unknown> = cfg.model ? { model: cfg.model } : {};
    if (resume) base.resume = resume;                        // initial spawn only; restart() omits it (stays fresh)
    const extra = this.sessionOptions?.(id);                 // fresh servers + tool posture for THIS session
    const options = extra ? { ...base, ...extra } : base;    // factory keys win; never sets model
    const session = new DaemonSession(id, { query: this.deps.query }, options, this.now);
    session.done.then(() => this.handleSessionEnd(id)).catch(() => {}); // end hook
    return session;
  }
```

(The `restart()` method at line 220 already calls `this.makeSession(id, this.configs.get(id)!)` with no third argument, so restarts get no `resume` — fresh, per the spec.)

- [ ] **Step 6: Pass resume in the server dispatch** — in `src/daemon/server.ts`, replace the `case "spawn":` line (currently line 71):

```ts
        case "spawn": send({ ok: true, id: this.supervisor.spawn({ model: op.model, restart: op.restart, resume: op.resume }) }); sock.end(); break;
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run test/unit/daemon-types.test.ts test/unit/daemon-supervisor.test.ts`
Expected: PASS.

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add CC-to-SDK/harness/src/daemon/types.ts CC-to-SDK/harness/src/daemon/supervisor.ts CC-to-SDK/harness/src/daemon/server.ts CC-to-SDK/harness/test/unit/daemon-types.test.ts CC-to-SDK/harness/test/unit/daemon-supervisor.test.ts
git commit -m "feat(harness): daemon spawn({resume}) — initial-spawn only, restarts stay fresh"
```

---

### Task 5: Live persist→resume round-trip

**Files:**
- Create: `test/live/persistence.test.ts`

**Interfaces:**
- Consumes: `createHarness` and `resumeHarness` (Task 2); the `RunResult.sessionId` field already returned by `run()`.
- Produces: nothing (verification only).

- [ ] **Step 1: Write the live test** — create `test/live/persistence.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHarness, resumeHarness } from "../../src/index.js";

const live = process.env.ANTHROPIC_API_KEY ? describe : describe.skip;
const MODEL = "claude-haiku-4-5-20251001";

live("live session persistence (real SDK)", () => {
  it("resumeHarness reloads prior context across separate runs", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "cc-persist-live-"));
    const h = createHarness({ model: MODEL, permissionMode: "auto", cwd });
    const r1 = await h.run("Remember this codeword: BANANA42. Reply OK and nothing else.");
    expect(r1.sessionId).toBeTruthy();

    const h2 = resumeHarness(r1.sessionId!, { model: MODEL, permissionMode: "auto", cwd });
    const r2 = await h2.run("What was the codeword? Reply with just the word.");
    expect(String(r2.result)).toMatch(/BANANA42/);
  }, 60_000);
});
```

- [ ] **Step 2: Run the live test (requires `ANTHROPIC_API_KEY`)**

Run: `npx vitest run test/live/persistence.test.ts`
Expected: PASS when `ANTHROPIC_API_KEY` is set (the resumed run recalls `BANANA42`); SKIPPED otherwise. The key is at `CC-to-SDK/.env` — load it into the shell before running (e.g. `export $(grep -v '^#' ../.env | xargs)`), and never print or commit it.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add CC-to-SDK/harness/test/live/persistence.test.ts
git commit -m "test(harness): live persist→resume round-trip"
```

---

## Final verification (after all tasks)

- [ ] `npm run test:unit` — full unit suite green (existing + new).
- [ ] `npm run typecheck` — clean.
- [ ] `npm run build` — clean (the package still compiles with the new public export).
- [ ] `npx vitest run test/live/persistence.test.ts` — green with `ANTHROPIC_API_KEY` set.
