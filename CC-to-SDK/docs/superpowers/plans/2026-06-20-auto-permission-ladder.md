# Mature `auto` + Graceful Permission Ladder (Increment 10) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the mature `auto` permission mode (the headless LLM classifier) to the interactive surfaces and centralize its model-gate — a `default → acceptEdits → auto` ladder in `cc-harness-chat` (bypass gated), every lib/`createHarness` caller born auto-safe, and the console repairing the model when a session is switched to `auto` at runtime.

**Architecture:** `resolveOptions` forces `resolveAutoModel(config.model)` when `permissionMode:"auto"` (so the lib path inherits the daemon's safety); the chat REPL's `useChat` replaces its `default↔bypass` binary with a ladder whose `auto` rung self-heals the model live via `setModel`+`setPermissionMode` (both verified to take effect at runtime by probe 24); `resolveAutoModel`/`isAutoSupportedModel` become public so the REPL and console share one source of truth; the console's `cyclePermissionMode` issues a `setModel` repair op when it lands on `auto`.

**Tech Stack:** TypeScript, React 18, Ink 5, Vitest 2, ink-testing-library 4. Package `cc-harness` (`harness/`) + `cc-harness-tui` (`tui/`, depends on `cc-harness` via `file:../harness`).

## Global Constraints

- **NO Prettier — dense hand-style:** compact, multi-statement lines; match surrounding code.
- **ESM `.js` import specifiers** (`from "./autoModel.js"`, `from "./commands.js"`); bare `"cc-harness"` for engine imports in `tui/`.
- **Ladder = `["default","acceptEdits","auto"]`**; `bypassPermissions` is OFF the Tab cycle (reachable only via `/yolo` + `--permission-mode`). Any off-ladder mode → re-enter at `"default"`.
- **`auto` is model-gated** (Opus 4.6+/Sonnet 4.6); on an unsupported model it silently degrades to `default` (probe 24-P2a). The model-swap on entering `auto` uses **swap + notice, NO restore on exit** (the swapped model persists).
- **Notice copy (verbatim):** known model → `↻ auto — switched model to <target> (<model> doesn't support auto)`; unknown model → `↻ auto — using <target> (auto needs Opus 4.6+/Sonnet 4.6)`.
- **`DEFAULT_AUTO_MODEL` is `claude-sonnet-4-6`; supported set = `{claude-sonnet-4-6, claude-opus-4-6, claude-opus-4-7, claude-opus-4-8}`** (from `harness/src/config/autoModel.ts`; do not redefine — import it).
- **Public-API addition:** `resolveAutoModel` + `isAutoSupportedModel` become **advanced-seam** exports → update `index.ts` + `index.test.ts` pin + `API-STABILITY.md` in the same task. **Rebuild `harness/` (`cd ../harness && npm run build`) before any `tui/` typecheck** — `tui/` imports the new exports.
- **Never mutate** the shared console `App.tsx` / `Composer.tsx`.
- **All new `setState` inside `disposed.current` guards;** `applyMode` re-checks `disposed` after each `await`.
- `ink useInput` timing discipline: in component/hook tests, `await` a render tick / `waitFor` BEFORE driving the next dependent action (re-read the host's reassigned `api.cyc`/`api.run` each time); real escape sequences only. **Test files run SEQUENTIALLY** (`tui/vitest.config.ts` `fileParallelism:false`).
- **Live tests gate** on `ANTHROPIC_API_KEY` (`const live = process.env.ANTHROPIC_API_KEY ? describe : describe.skip`), read from `CC-to-SDK/.env` (gitignored — never commit/print); keyless suites skip cleanly.
- Commands run **from `harness/`** (`npm run typecheck`, `npm run test:unit`, `npm run build`) or **`tui/`** (`npm run typecheck`, `npx vitest run test/<file>`). Live from `tui/`: `set -a; . ../.env; set +a; npx vitest run test/live/<file>`.
- Commit messages: plain, no `Co-Authored-By` / attribution.

## Grounding (already done — not a task)

Probe `probes/probes/24-auto-mode-lib-seam-runtime.ts` (committed) verified live: **P1** `auto`+`claude-sonnet-4-6` → 0 `canUseTool` calls + edit applied (classifier bypasses the broker); **P2a** `auto`+`claude-haiku-4-5` → `canUseTool` consulted (degraded to `default`); **P2b** runtime `setPermissionMode("auto")` takes effect; **P2c** runtime `setModel(supported)`+`setPermissionMode("auto")` repairs an unsupported session live; **P3** `acceptEdits` auto-accepts Edit AND Write, gates non-edit tools (Read seen in `canUseTool`). Spec: `docs/superpowers/specs/2026-06-20-auto-permission-ladder-design.md`.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `harness/src/config/resolveOptions.ts` (modify) | force `resolveAutoModel(config.model)` when `permissionMode:"auto"` | 1 |
| `harness/src/index.ts` + `test/unit/index.test.ts` + `API-STABILITY.md` (modify) | export `resolveAutoModel`/`isAutoSupportedModel` (advanced-seam) + pin | 1 |
| `tui/src/useChat.ts` + `tui/src/commands.ts` (modify) | ladder `cycleMode`/`applyMode` (auto model-repair) + `/yolo` | 2 |
| `tui/src/ChatStatusBar.tsx` (modify) | `modeColor(mode)` + colored mode | 3 |
| `tui/src/commands.ts` + `tui/src/chat.tsx` (modify) | `parseLaunchMode` + `--permission-mode` flag + thread `initialMode` | 4 |
| `tui/src/useDaemon.ts` (modify) | `cyclePermissionMode→auto` issues `setModel` repair op first | 5 |
| `tui/test/live/auto-mode.e2e.test.ts` (create) | gated: `auto` applies a safe write with NO broker request | 6 |
| `docs/parity/coverage.md` (modify) + memory | Domain 10 refresh | 7 |

---

### Task 1: `resolveOptions` auto model-gate + export the helpers

**Files:**
- Modify: `harness/src/config/resolveOptions.ts`, `harness/test/unit/resolveOptions.test.ts`
- Modify: `harness/src/index.ts`, `harness/test/unit/index.test.ts`, `harness/API-STABILITY.md`

**Interfaces:**
- Consumes: existing `resolveAutoModel(model?: string): string` from `./config/autoModel.js` (already tested in `auto-model.test.ts`; do NOT redefine).
- Produces: `resolveOptions` forces a supported model under `auto`; `resolveAutoModel`/`isAutoSupportedModel` exported from `cc-harness`. Used by Tasks 2 & 5 (chat/console import `resolveAutoModel` from `cc-harness`).

- [ ] **Step 1: Write the failing tests** — append inside the existing `describe("resolveOptions", …)` in `harness/test/unit/resolveOptions.test.ts`:

```ts
  it("forces a supported model when permissionMode is auto (model-gated)", () => {
    expect((resolveOptions({ permissionMode: "auto", model: "claude-haiku-4-5" }) as any).model).toBe("claude-sonnet-4-6");
    expect((resolveOptions({ permissionMode: "auto", model: "claude-opus-4-8" }) as any).model).toBe("claude-opus-4-8");
    expect((resolveOptions({ permissionMode: "auto" }) as any).model).toBe("claude-sonnet-4-6");
  });
  it("does not touch the model for non-auto modes", () => {
    expect((resolveOptions({ permissionMode: "default", model: "claude-haiku-4-5" }) as any).model).toBe("claude-haiku-4-5");
  });
```

And add the two new export names to the `EXPECTED` array in `harness/test/unit/index.test.ts` (keep it sorted): insert `"isAutoSupportedModel",` immediately after `"injectContext",` and `"resolveAutoModel",` immediately after `"resolveAssistantPosture",`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd harness && npm run test:unit -- resolveOptions index`
Expected: FAIL — `resolveOptions` auto cases get `claude-haiku-4-5`/`undefined` (no forcing yet); the `index` freeze test fails because `Object.keys(api)` lacks the two names.

- [ ] **Step 3: Implement** —

(a) In `harness/src/config/resolveOptions.ts`, add the import at the top (after line 7's `resolveAgents` import is fine):

```ts
import { resolveAutoModel } from "./autoModel.js";
```

(b) In `resolveOptions`, immediately after the `if (config.permissionMode) options.permissionMode = config.permissionMode;` line (`:45`), insert:

```ts
  // `auto` is MODEL-GATED (Opus 4.6+/Sonnet 4.6); on an unsupported model it silently degrades to `default`
  // (probe 24-P2a). Centralize the gate here — like bypassPermissions below — so every lib/createHarness caller
  // is born auto-safe: force a supported model (a supported explicit one is preserved; undefined → DEFAULT).
  if (config.permissionMode === "auto") options.model = resolveAutoModel(config.model);
```

(c) In `harness/src/index.ts`, add after the `export { DEFAULTS } from "./config/types.js";` line (`:5`):

```ts
export { resolveAutoModel, isAutoSupportedModel } from "./config/autoModel.js";
```

(d) In `harness/API-STABILITY.md`, add two rows to the table (after the `resolveOptions` row):

```
| resolveAutoModel | advanced-seam |
| isAutoSupportedModel | advanced-seam |
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd harness && npm run test:unit -- resolveOptions index auto-model && npm run typecheck`
Expected: PASS — the auto-force cases + the surface freeze; existing `auto-model.test.ts` stays green; typecheck clean.

- [ ] **Step 5: Build harness (so the tui tasks can import the new exports)**

Run: `cd harness && npm run build`
Expected: builds `dist/` cleanly (proves the new public `.d.ts` resolves).

- [ ] **Step 6: Commit**

```bash
git add harness/src/config/resolveOptions.ts harness/test/unit/resolveOptions.test.ts harness/src/index.ts harness/test/unit/index.test.ts harness/API-STABILITY.md
git commit -m "feat(harness): centralize auto model-gate in resolveOptions + export resolveAutoModel/isAutoSupportedModel (advanced-seam)"
```

---

### Task 2: chat REPL permission ladder + `/yolo` (keystone)

**Files:**
- Modify: `tui/src/useChat.ts`, `tui/src/commands.ts`, `tui/test/useChat.test.tsx`, `tui/test/commands.test.ts`, `tui/test/chat.test.tsx`

**Interfaces:**
- Consumes: `resolveAutoModel` from `cc-harness` (Task 1); existing `useChat` internals (`model`/`setModel` state, `session`, `mode`/`setMode`, `append`, `disposed`, `handleCommand`).
- Produces: `cycleMode()` advances the `default→acceptEdits→auto` ladder; `applyMode(next)` does the auto model-repair; `/yolo` → `bypassPermissions`. `COMMANDS` gains a `yolo` row.

**⚠️ Breaking-change note (must handle in this task):** `tui/test/chat.test.tsx` has an existing test `"Tab toggles the permission mode default ↔ bypassPermissions"` (lines 56-62) that `pressUntil`s Tab expecting `bypassPermissions` — the ladder makes Tab cycle `default→acceptEdits→auto`, so it must be rewritten. Also that file's `fakeSession` (lines 19-24) has **no `setModel`** method; reaching `auto` calls `session.setModel`, so a `setModel` no-op must be added or `applyMode` throws. Both are part of Step 1/Step 3 below.

- [ ] **Step 1: Rebuild harness, then write the failing tests**

Run first: `cd ../harness && npm run build` (so `cc-harness` exposes `resolveAutoModel`).

Append to `tui/test/commands.test.ts` (inside the existing top-level `describe`, or a new `it`):

```ts
  it("/yolo is in the command table", () => {
    expect(COMMANDS.some((c) => c.name === "yolo")).toBe(true);
  });
```

Append to `tui/test/useChat.test.tsx` a new describe block (the helpers `fakeSession`, `createUiBroker`, `frame`, `waitFor`, `render`, `Text`, `useChat`, `ChatSession` are already imported at the top of the file):

```ts
describe("permission ladder", () => {
  function LadderHost({ makeSession, api }: { makeSession: () => ChatSession; api: { cyc?: () => void; run?: (s: string) => void } }) {
    const c = useChat(makeSession, createUiBroker());
    api.cyc = c.cycleMode; api.run = c.submit;
    return <Text>mode:{c.state.mode} model:{c.state.model ?? "-"} {c.state.lines.map((l) => l.text).join("|")}</Text>;
  }
  it("Tab cycles default → acceptEdits → auto → default (bypass off-cycle)", async () => {
    const setModeCalls: string[] = [];
    const session = fakeSession({ async setPermissionMode(m: string) { setModeCalls.push(m); } });
    const api: { cyc?: () => void } = {};
    const { lastFrame } = render(<LadderHost makeSession={() => session} api={api} />);
    await waitFor(() => frame(lastFrame).includes("mode:default"));
    api.cyc!(); await waitFor(() => frame(lastFrame).includes("mode:acceptEdits"));
    api.cyc!(); await waitFor(() => frame(lastFrame).includes("mode:auto"));
    api.cyc!(); await waitFor(() => frame(lastFrame).includes("mode:default"));
    expect(setModeCalls).toEqual(["acceptEdits", "auto", "default"]);
  });
  it("entering auto on an unsupported model swaps to a supported one with a notice", async () => {
    const setModelCalls: (string | undefined)[] = [];
    const session = fakeSession({ async setModel(m?: string) { setModelCalls.push(m); } });
    const api: { cyc?: () => void; run?: (s: string) => void } = {};
    const { lastFrame } = render(<LadderHost makeSession={() => session} api={api} />);
    await waitFor(() => frame(lastFrame).includes("mode:default"));
    api.run!("/model claude-haiku-4-5");
    await waitFor(() => frame(lastFrame).includes("model:claude-haiku-4-5"));
    api.cyc!(); await waitFor(() => frame(lastFrame).includes("mode:acceptEdits"));
    api.cyc!(); await waitFor(() => frame(lastFrame).includes("mode:auto"));
    expect(setModelCalls).toContain("claude-sonnet-4-6");
    expect(frame(lastFrame)).toContain("switched model to claude-sonnet-4-6");
  });
  it("entering auto on a supported model does not swap the model", async () => {
    const setModelCalls: (string | undefined)[] = [];
    const session = fakeSession({ async setModel(m?: string) { setModelCalls.push(m); } });
    const api: { cyc?: () => void; run?: (s: string) => void } = {};
    const { lastFrame } = render(<LadderHost makeSession={() => session} api={api} />);
    await waitFor(() => frame(lastFrame).includes("mode:default"));
    api.run!("/model claude-opus-4-8");
    await waitFor(() => frame(lastFrame).includes("model:claude-opus-4-8"));
    api.cyc!(); await waitFor(() => frame(lastFrame).includes("mode:acceptEdits"));
    api.cyc!(); await waitFor(() => frame(lastFrame).includes("mode:auto"));
    expect(setModelCalls).toEqual(["claude-opus-4-8"]);
    expect(frame(lastFrame)).not.toContain("switched model");
  });
  it("/yolo enables bypassPermissions; Tab from bypass returns to default", async () => {
    const setModeCalls: string[] = [];
    const session = fakeSession({ async setPermissionMode(m: string) { setModeCalls.push(m); } });
    const api: { cyc?: () => void; run?: (s: string) => void } = {};
    const { lastFrame } = render(<LadderHost makeSession={() => session} api={api} />);
    await waitFor(() => frame(lastFrame).includes("mode:default"));
    api.run!("/yolo");
    await waitFor(() => frame(lastFrame).includes("mode:bypassPermissions"));
    api.cyc!(); await waitFor(() => frame(lastFrame).includes("mode:default"));
    expect(setModeCalls).toEqual(["bypassPermissions", "default"]);
  });
  it("cycleMode after unmount is a no-op (early disposed guard)", async () => {
    const setModeCalls: string[] = [];
    const session = fakeSession({ async setPermissionMode(m: string) { setModeCalls.push(m); } });
    const api: { cyc?: () => void } = {};
    const { lastFrame, unmount } = render(<LadderHost makeSession={() => session} api={api} />);
    await waitFor(() => frame(lastFrame).includes("mode:default"));
    const cyc = api.cyc!;
    unmount();
    cyc();
    await new Promise((r) => setTimeout(r, 20));
    expect(setModeCalls).toEqual([]);
  });
});
```

Also update `tui/test/chat.test.tsx` for the new Tab behavior:

(i) Give its `fakeSession` a `setModel` no-op — in the fake object (lines 22-23), add `async setModel() {},` alongside `setPermissionMode` (reaching `auto` calls `session.setModel`):

```ts
    async setPermissionMode(m: string) { s.modes.push(m); }, async setModel() {}, async interrupt() {}, async getContextUsage() { return { totalTokens: 5, maxTokens: 100 }; },
```

(ii) Replace the whole `it("Tab toggles the permission mode default ↔ bypassPermissions", …)` test (lines 56-62) with the ladder version:

```ts
  it("Tab cycles the permission ladder default → acceptEdits → auto", async () => {
    const session = fakeSession();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => session} broker={createUiBroker()} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("mode"));
    await pressUntil(stdin, "\t", () => session.modes.includes("auto"));   // Tab cycles default→acceptEdits→auto
    expect(session.modes[0]).toBe("acceptEdits");
    expect(session.modes).toContain("auto");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd tui && npx vitest run test/commands.test.ts test/useChat.test.tsx test/chat.test.tsx -t "ladder|yolo|command table|Tab cycles"`
Expected: FAIL — no `yolo` row; `cycleMode` still does the `default↔bypass` binary (never reaches `acceptEdits`/`auto`); the rewritten chat Tab test never sees `auto`; `applyMode`/notice/`/yolo` don't exist.

- [ ] **Step 3: Implement** — in `tui/src/useChat.ts`:

(a) Add `resolveAutoModel` to the `cc-harness` import (line 11):

```ts
import { summarizeUsage, listSessions as realListSessions, getSessionMessages as realGetSessionMessages, resolveAutoModel } from "cc-harness";
```

(b) Replace the `OTHER_POLE` line (`:29`) with the ladder:

```ts
const LADDER = ["default", "acceptEdits", "auto"] as const;   // Tab cycles these; bypassPermissions is off-cycle (/yolo)
/** Next mode on the Tab ladder; any off-ladder mode (bypassPermissions/plan/…) re-enters at "default". */
function ladderNext(mode: string): string { const i = (LADDER as readonly string[]).indexOf(mode); return i >= 0 ? LADDER[(i + 1) % LADDER.length] : "default"; }
```

(c) Add the `/yolo` case to `handleCommand`'s switch, right after `case "continue": void doContinue(); break;` (`:97`):

```ts
        case "yolo": void applyMode("bypassPermissions"); break;
```

(d) Replace the `cycleMode` line (`:146`) with `applyMode` + `cycleMode`:

```ts
  // Apply a permission mode. `auto` is model-gated (probe 24): if the live model can't run auto, swap to a
  // supported one FIRST (verified to take effect at runtime) with a notice, then set the mode. Disposed-guarded
  // across each await so a late settle never touches state after unmount.
  async function applyMode(next: string) {
    if (disposed.current) return;
    if (next === "auto") {
      const target = resolveAutoModel(model);
      if (model !== target) {
        await session.setModel(target).catch(() => {});
        if (disposed.current) return;
        setModel(target);
        append([{ text: model ? `↻ auto — switched model to ${target} (${model} doesn't support auto)` : `↻ auto — using ${target} (auto needs Opus 4.6+/Sonnet 4.6)`, dim: true }]);
      }
    }
    await session.setPermissionMode(next).catch(() => {});
    if (!disposed.current) setMode(next);
  }
  function cycleMode() { void applyMode(ladderNext(mode)); }
```

In `tui/src/commands.ts`, add the `yolo` row to `COMMANDS` after the `continue` row (`:23`):

```ts
  { name: "yolo", summary: "enable bypassPermissions (ungated tool access)" },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tui && npx vitest run test/commands.test.ts test/useChat.test.tsx test/chat.test.tsx && npm run typecheck`
Expected: PASS — the ladder, auto-swap (real `resolveAutoModel`), no-swap, `/yolo`, teardown tests + the rewritten chat Tab test + all prior useChat/commands/chat tests; typecheck clean (the new `cc-harness` import resolves against the rebuilt `dist`).

- [ ] **Step 5: Commit**

```bash
git add tui/src/useChat.ts tui/src/commands.ts tui/test/useChat.test.tsx tui/test/commands.test.ts tui/test/chat.test.tsx
git commit -m "feat(tui): chat permission ladder default→acceptEdits→auto + /yolo; auto self-heals the model live"
```

---

### Task 3: status bar mode colors

**Files:**
- Modify: `tui/src/ChatStatusBar.tsx`, `tui/test/components.test.tsx`

**Interfaces:**
- Produces: `modeColor(mode: string): string` (`"green"|"yellow"|"cyan"|"red"`), used by `ChatStatusBar`.

- [ ] **Step 1: Write the failing test** — append to `tui/test/components.test.tsx`:

```ts
import { modeColor } from "../src/ChatStatusBar.js";

describe("modeColor", () => {
  it("maps each permission mode to a color", () => {
    expect(modeColor("default")).toBe("green");
    expect(modeColor("acceptEdits")).toBe("yellow");
    expect(modeColor("auto")).toBe("cyan");
    expect(modeColor("bypassPermissions")).toBe("red");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tui && npx vitest run test/components.test.tsx -t "modeColor"`
Expected: FAIL — `modeColor` is not exported.

- [ ] **Step 3: Implement** — in `tui/src/ChatStatusBar.tsx`, add the helper above the component and use it in the mode `<Text>`:

```ts
/** Permission-mode → color: default safe (green), acceptEdits (yellow), auto classifier (cyan), bypass (red). */
export function modeColor(mode: string): string { return mode === "bypassPermissions" ? "red" : mode === "auto" ? "cyan" : mode === "acceptEdits" ? "yellow" : "green"; }
```

Replace the mode `<Text>` (line 9 `<Text color={mode === "bypassPermissions" ? "red" : "green"}>{mode}</Text>`) with:

```ts
      <Text>mode </Text><Text color={modeColor(mode)}>{mode}</Text>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tui && npx vitest run test/components.test.tsx && npm run typecheck`
Expected: PASS — `modeColor` cases + all existing component tests (the status bar still renders the mode text); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add tui/src/ChatStatusBar.tsx tui/test/components.test.tsx
git commit -m "feat(tui): color-code permission mode in the chat status bar (default/acceptEdits/auto/bypass)"
```

---

### Task 4: `--permission-mode` launch flag + threading

**Files:**
- Modify: `tui/src/commands.ts`, `tui/src/chat.tsx`, `tui/test/commands.test.ts`

**Interfaces:**
- Consumes: `useChat` `opts.initialMode` (already supported); `ChatApp` `hookOpts` (already threaded into `useChat`).
- Produces: `PERMISSION_MODES: string[]`, `parseLaunchMode(args: string[]): string` (a valid mode or `"default"`). `chat.tsx` sets the session's `permissionMode` and the REPL's `initialMode` from the flag.

- [ ] **Step 1: Write the failing test** — append to `tui/test/commands.test.ts`:

```ts
import { parseLaunchMode } from "../src/commands.js";

describe("parseLaunchMode", () => {
  it("reads a valid --permission-mode, else default", () => {
    expect(parseLaunchMode(["--permission-mode", "auto"])).toBe("auto");
    expect(parseLaunchMode(["--permission-mode", "acceptEdits"])).toBe("acceptEdits");
    expect(parseLaunchMode(["--permission-mode", "bogus"])).toBe("default");
    expect(parseLaunchMode(["--model", "x"])).toBe("default");
  });
});
```

(The `chat.tsx` bin itself runs `render(...)` at import — it has side effects and isn't unit-tested directly; `parseLaunchMode` is the pure unit under test, and the `hookOpts.initialMode` → status-bar threading is already exercised by `ChatApp`'s existing render path + verified by `npm run typecheck` and Task 6's live launch in `auto`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tui && npx vitest run test/commands.test.ts -t "parseLaunchMode"`
Expected: FAIL — `parseLaunchMode` is not exported from `commands.ts`.

- [ ] **Step 3: Implement** —

(a) In `tui/src/commands.ts`, add after `parseResumeIntent` (end of file):

```ts
export const PERMISSION_MODES = ["default", "acceptEdits", "auto", "bypassPermissions", "plan", "dontAsk"] as const;
export type LaunchMode = typeof PERMISSION_MODES[number];

/** `--permission-mode <m>` → a valid SDK permission mode, or "default" if absent/unknown. */
export function parseLaunchMode(args: string[]): LaunchMode {
  const i = args.indexOf("--permission-mode");
  const m = i >= 0 ? args[i + 1] : undefined;
  return m && (PERMISSION_MODES as readonly string[]).includes(m) ? (m as LaunchMode) : "default";
}
```

(`as const` + the `LaunchMode` union return type is load-bearing: `chat.tsx` assigns `permissionMode: launchMode` to `OpenSessionConfig.permissionMode`, which is the `PermissionMode` union — a `string` return would fail typecheck. `LaunchMode`'s literals are structurally assignable to `PermissionMode`.)

(b) In `tui/src/chat.tsx`, update the import and wiring:

```ts
import { parseResumeIntent, parseLaunchMode } from "./commands.js";
```

Replace the `base` + `render` lines (`:14-17`) with:

```ts
const launchMode = parseLaunchMode(args);
const rawMode = flag("--permission-mode");
if (rawMode && rawMode !== launchMode) process.stderr.write(`cc-harness-chat: unknown --permission-mode "${rawMode}", using default\n`);
const base = { model: flag("--model"), cwd: flag("--cwd") ?? process.cwd(), permissionMode: launchMode, permissionBroker: ui.broker, contextTool: true, includePartialMessages: true, forwardSubagentText: true };
const initialResume = parseResumeIntent(args);
const makeSession = (resume?: string) => openSession({ ...base, ...(resume ? { resume } : {}) });
render(<ChatApp makeSession={makeSession} broker={ui} cwd={base.cwd} initialResume={initialResume} hookOpts={{ initialMode: launchMode }} />);
```

(Note: launch-time `auto` forces a supported model automatically via Task 1's centralized `resolveOptions` gate — `openSession` → `resolveOptions`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tui && npx vitest run test/commands.test.ts test/chat.test.tsx && npm run typecheck`
Expected: PASS — `parseLaunchMode` cases + all existing command/chat tests (the chat suite stays green — `chat.tsx` is not imported by it); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add tui/src/commands.ts tui/src/chat.tsx tui/test/commands.test.ts
git commit -m "feat(tui): --permission-mode launch flag (parseLaunchMode) threaded into session + initialMode"
```

---

### Task 5: console runtime auto-repair

**Files:**
- Modify: `tui/src/useDaemon.ts`, `tui/test/useDaemon.test.tsx`

**Interfaces:**
- Consumes: `resolveAutoModel` from `cc-harness` (Task 1); existing `run`/`ctl`/`selected`/`modelId`.
- Produces: `cyclePermissionMode` issues a `set_model` control op (to a supported model) before `set_permission_mode` when the next mode is `auto`.

- [ ] **Step 1: Write the failing test** — append to `tui/test/useDaemon.test.tsx`'s `describe("useDaemon", …)` block. The file already provides the module-level `view: DaemonView` (set by `Probe`), `fakeClient()` (whose `list()` returns a session with `model: "m"`, and whose `calls.control` captures `[id, frame]`), `manualSchedule()`, and `flush()`:

```ts
  it("cyclePermissionMode → auto forces a supported model first (set_model before set_permission_mode)", async () => {
    const c = fakeClient();
    render(<Probe client={c} opts={{ schedule: manualSchedule().schedule, now: () => 0 }} />);
    await flush();
    for (let i = 0; i < 5; i++) { view.cyclePermissionMode(); await flush(); }   // default→acceptEdits→bypass→plan→dontAsk→auto
    const frames = c.calls.control.map((x: any) => x[1]);
    expect(frames).toContainEqual({ type: "set_model", model: "claude-sonnet-4-6" });   // "m" is unsupported → forced to sonnet
    expect(c.calls.control.at(-1)).toEqual(["sess-1", { type: "set_permission_mode", mode: "auto" }]);
    const modelIdx = frames.findIndex((f: any) => f.type === "set_model" && f.model === "claude-sonnet-4-6");
    const autoIdx = frames.findIndex((f: any) => f.type === "set_permission_mode" && f.mode === "auto");
    expect(modelIdx).toBeGreaterThanOrEqual(0);
    expect(modelIdx).toBeLessThan(autoIdx);                          // repair op precedes the mode op
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tui && npx vitest run test/useDaemon.test.tsx -t "forces a supported model"`
Expected: FAIL — reaching `auto` currently emits only `set_permission_mode`, no `set_model`.

- [ ] **Step 3: Implement** — in `tui/src/useDaemon.ts`:

(a) Add `resolveAutoModel` to the `cc-harness` import (line 2):

```ts
import { collect, resolveAutoModel } from "cc-harness";
```

(b) Replace `cyclePermissionMode` (`:112-116`) with:

```ts
  const cyclePermissionMode = useCallback(() => {
    pmIndex.current = (pmIndex.current + 1) % PERMISSION_MODES.length;
    const mode = PERMISSION_MODES[pmIndex.current];
    if (mode === "auto") {                                  // auto is model-gated (probe 24) — force a supported model first
      const cur = modelId(selected?.model);
      const target = resolveAutoModel(cur);
      if (target !== cur) run(`model=${target}`, ctl(`model=${target}`, { type: "set_model", model: target }));
    }
    run(`mode=${mode}`, ctl(`mode=${mode}`, { type: "set_permission_mode", mode }));
  }, [run, selected?.model]);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tui && npx vitest run test/useDaemon.test.tsx && npm run typecheck`
Expected: PASS — the new auto-repair test + all existing daemon tests (the other cycle modes emit no `set_model`); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add tui/src/useDaemon.ts tui/test/useDaemon.test.tsx
git commit -m "feat(tui): console cyclePermissionMode→auto forces a supported model first (runtime auto-repair)"
```

---

### Task 6: gated live e2e — `auto` applies a safe write with no broker request

**Files:**
- Create: `tui/test/live/auto-mode.e2e.test.ts`

- [ ] **Step 1: Write the test** — create `tui/test/live/auto-mode.e2e.test.ts`:

```ts
// tui/test/live/auto-mode.e2e.test.ts — gated: a session opened in `auto` on an UNSUPPORTED model (haiku) has
// its model force-upgraded by resolveOptions (Task 1), so the classifier is effective end-to-end: a safe
// working-dir write applies and the permission broker is NEVER consulted (probe 24-P1 + Part-1 gate). Skips keyless.
import { describe, it, expect } from "vitest";
import { openSession } from "cc-harness";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const live = process.env.ANTHROPIC_API_KEY ? describe : describe.skip;

live("auto mode (live)", () => {
  it("auto applies a safe write without consulting the broker (model force-upgraded)", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "auto-e2e-"));
    const requests: string[] = [];
    const broker = { async request(r: any) { requests.push(r.toolName); return { kind: "allow" as const }; } };
    const session = openSession({ permissionMode: "auto", model: "claude-haiku-4-5", cwd, permissionBroker: broker } as any);
    try {
      await session.submit("Use the Write tool to create a file named marker.txt containing exactly the word DONE. Then reply OK.", () => {});
      expect(existsSync(join(cwd, "marker.txt"))).toBe(true);    // auto allowed the safe write
      expect(requests).toEqual([]);                              // broker NEVER consulted — classifier handled it
    } finally {
      await session.dispose();
    }
  }, 60_000);
});
```

- [ ] **Step 2: Run keyless to confirm a clean skip**

Run: `cd tui && npx vitest run test/live/auto-mode.e2e.test.ts`
Expected: **SKIPPED** (no key). (Implementer stops here; the controller runs the keyed pass.)

- [ ] **Step 3: (controller) Run keyed**

Run: `cd tui && set -a; . ../.env; set +a; npx vitest run test/live/auto-mode.e2e.test.ts`
Expected: PASS (~5–20 s) — `marker.txt` written, `requests` empty (proves the Part-1 gate makes `auto` effective on an unsupported launch model + the classifier bypasses the broker).

- [ ] **Step 4: Commit**

```bash
git add tui/test/live/auto-mode.e2e.test.ts
git commit -m "test(tui): gated live e2e — auto on an unsupported model is force-upgraded and bypasses the broker"
```

---

### Task 7: refresh coverage scorecard + memory

**Files:**
- Modify: `docs/parity/coverage.md`; memory (controller-handled)

- [ ] **Step 1: Full keyless gates**

Run: `cd harness && npm run test:unit && npm run typecheck`
Then: `cd ../tui && npm run typecheck && npx vitest run`
Expected: harness unit green + typecheck clean; tui typecheck clean + all keyless suites pass (live suites skip).

- [ ] **Step 2: Update `docs/parity/coverage.md`** — in the Domain 10 row, change the Realized cell `~54%¹` → `~57%¹` (preserve the `¹` footnote), and insert this sentence verbatim **immediately before** the closing `Remote/voice remain 🚫/non-goal **by design**` clause (after the increment-9 sentence ending `2026-06-20-session-resume-continue`):

```
**Phase-3 increment 10 SHIPPED — mature `auto` + graceful permission ladder** (`cc-harness-chat`): `Tab` now cycles `default → acceptEdits → auto` (bypass gated behind `/yolo` + `--permission-mode`); the `auto` rung self-heals the model live (`setModel` to a supported model + a notice) since `auto` is the model-gated headless classifier (probe 24: it bypasses the broker entirely — no inline dialog for safe ops, and actively blocks dangerous ones). The `auto` model-gate is now centralized in `resolveOptions` (every lib/`createHarness` caller is born auto-safe, not just the daemon), `resolveAutoModel`/`isAutoSupportedModel` are exported (advanced-seam), and the console's `cyclePermissionMode→auto` issues a `setModel` repair op. Probe 24 verified the lib-seam auto behavior + runtime enable/repair; spec/plan `2026-06-20-auto-permission-ladder`.
```

Keep the row a single line (no line break inside the table cell).

- [ ] **Step 3: Commit**

```bash
git add docs/parity/coverage.md
git commit -m "docs(parity): record increment-10 mature auto + permission ladder (Domain 10)"
```

(Memory files live outside the repo — the controller writes them, not a git commit.)

---

## Self-Review

**1. Spec coverage** — every spec §3 scope item maps to a task: Part 1 (centralize gate) → T1; Part 2 ladder (`cycleMode`/`applyMode`/auto-repair/`/yolo`) → T2, status colors → T3, `--permission-mode` flag + threading → T4; Part 3 (export helpers + pin + API-STABILITY) → T1; Part 4 (console auto-repair) → T5; §7 grounding/tests → unit tests in T1–T5 + gated live e2e → T6; docs → T7. The "swap + notice, no restore" decision → T2's `applyMode` (no restore path). The notice copy (§ Global Constraints) → T2 verbatim.

**2. Placeholder scan** — every code step shows complete code with exact values against the *actual* test harnesses (verified by reading `useChat.test.tsx`/`chat.test.tsx`/`useDaemon.test.tsx`): T2 uses the real `fakeSession(overrides)`/`frame`/`waitFor`; T5 uses the real module-level `view`/`fakeClient`/`manualSchedule`/`flush`/`Probe`. No placeholder helper names remain. **Breaking-change handled:** the placeholder scan surfaced that T2's ladder breaks `chat.test.tsx`'s existing `"Tab toggles … bypassPermissions"` test and that its `fakeSession` lacks `setModel` (reaching `auto` calls it) — both are now explicit Step-1/Step-3 edits in T2, and T2's Step-4 runs `chat.test.tsx`. T4's earlier GREEN-from-start wiring snippet was dropped (the bin's threading is typecheck- + live-covered; `parseLaunchMode` is the RED→GREEN unit).

**3. Type consistency** — `resolveAutoModel(model?: string): string` is used identically in T1 (`resolveOptions`), T2 (`useChat`), T5 (`useDaemon`). `modeColor(mode: string): string` (T3) returns the four color strings the status bar uses. `parseLaunchMode(args: string[]): string` / `PERMISSION_MODES` (T4) match their `commands.ts` definitions and `chat.tsx` use. `LADDER`/`ladderNext`/`applyMode` are internal to `useChat`. The `set_model`/`set_permission_mode` control frames (T5) match the shapes already in `useDaemon.ts` (`cycleModel`/`cyclePermissionMode`). Notice copy is identical between the Global Constraints block and T2's code.

**Deferred / out-of-scope held** (spec §3 Out): model restore on leaving `auto`; per-tool always-allow beyond `createPermissionGate`; daemon spawn-path changes (already correct); `plan`/`dontAsk` affordances beyond the ladder.
