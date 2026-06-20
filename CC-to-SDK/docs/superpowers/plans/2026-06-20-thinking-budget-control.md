# Interactive Thinking-Budget Control (Increment 11) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `cc-harness-chat` interactive control over the model's extended-thinking budget — a `/think <level>` command, a `--think <level>` launch flag, and a status indicator — plus a daemon-console thinking-cycle, by wiring the already-built, probe-verified `setMaxThinkingTokens` runtime lever.

**Architecture:** Entirely in `tui/`. The lib already exposes every lever — `Session.setMaxThinkingTokens(number|null)`, the `set_thinking` `ControlFrame` (`{type:"set_thinking", maxTokens}`, daemon-supported + bridge-applied), and the `thinking` config knob (`HarnessConfig.thinking: ThinkingConfig`). A new pure `tui/src/thinkLevels.ts` is the single source of truth for the level↔budget vocabulary, shared by the chat REPL (`useChat`/`commands`/`chat.tsx`/`ChatStatusBar`) and the console (`useDaemon`/`App`). NO harness change, NO new public export, NO API-STABILITY/index pin, NO harness rebuild.

**Tech Stack:** TypeScript, React 18, Ink 5, Vitest 2, ink-testing-library 4. Package `cc-harness-tui` (`tui/`, depends on `cc-harness` via `file:../harness`).

## Global Constraints

- **Vocabulary = the SDK `effort` enum names** (`low/medium/high/xhigh/max`) **+ `off`**; **mechanism = the thinking token budget** (the only runtime lever — there is no runtime `setEffort`). ONE source of truth in `thinkLevels.ts` — no second copy of the level set or budgets anywhere.
- **Budgets:** `off=0 · low=4000 · medium=10000 · high=16000 · xhigh=24000 · max=32000`.
- `off` (runtime) → `setMaxThinkingTokens(0)` (probe 25-verified to disable). `--think off` (launch) → `thinking: { type: "disabled" }` (`ThinkingConfig` supports it — `config/types.ts:14`).
- **NO harness change / no new public export / no API-STABILITY/index pin / no harness rebuild.** The lib levers already exist.
- **NO Prettier — dense hand-style;** match surrounding code, do not reformat untouched lines. **ESM `.js` import specifiers**; bare `"cc-harness"` for engine imports.
- All new `setState` inside `disposed.current` guards; the `/think` handler re-checks `disposed` after its `await`.
- `ink useInput` timing discipline in tests (`await`/`waitFor` before dependent actions; real escape sequences; **test files run sequentially** — `tui/vitest.config.ts` `fileParallelism:false`).
- **Adding `setMaxThinkingTokens` to the `ChatSession` interface (T2) breaks BOTH fakeSessions** — `useChat.test.tsx` AND `chat.test.tsx` each need an `async setMaxThinkingTokens() {}` default or they no longer satisfy `ChatSession` (same paired-change shape as increment 10's `setModel`). Handled in T2.
- Shared `Composer.tsx` untouched; the console `App.tsx` change is limited to ONE keybind.
- **Live tests gate** on `ANTHROPIC_API_KEY` (`const live = process.env.ANTHROPIC_API_KEY ? describe : describe.skip`), read from `CC-to-SDK/.env` (never commit/print); keyless suites skip cleanly.
- Commands run from **`tui/`** (`npm run typecheck`, `npx vitest run test/<file>`). Commit messages plain, NO `Co-Authored-By` / attribution.

## Grounding (already done — not a task)

Probe `probes/probes/25-thinking-runtime-lever.ts` (committed `fe10176552`) verified live on the streaming-input (chat) Session path: **P2** `setMaxThinkingTokens(n)` takes effect mid-session; **P3/P5** `setMaxThinkingTokens(0)` disables thinking; **P1** thinking is ON by default. Console `set_thinking` reachability confirmed from `bridge/types.ts:22` (`ControlFrame` includes `set_thinking`), `bridge/control.ts:18-19` (bridge → `setMaxThinkingTokens`), and `useDaemon.ts` (the `ctl`/`run` control-frame pattern). Spec: `docs/superpowers/specs/2026-06-20-thinking-budget-control-design.md`.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `tui/src/thinkLevels.ts` (create) + `tui/test/thinkLevels.test.ts` (create) | level↔budget vocabulary (single source of truth) | 1 |
| `tui/src/useChat.ts` + `tui/src/commands.ts` (modify) + `useChat.test.tsx` + `chat.test.tsx` + `commands.test.ts` | `/think` command + `formatThink` + `ChatSession.setMaxThinkingTokens` + `thinkLevel` state | 2 |
| `tui/src/commands.ts` + `tui/src/chat.tsx` + `tui/src/ChatApp.tsx` (modify) + `commands.test.ts` | `--think` flag (`parseLaunchThink`) + threading | 3 |
| `tui/src/ChatStatusBar.tsx` + `tui/src/ChatApp.tsx` (modify) + `components.test.tsx` | `think:<level>` status indicator | 4 |
| `tui/src/useDaemon.ts` + `tui/src/App.tsx` (modify) + `useDaemon.test.tsx` | console `cycleThinking` (`set_thinking`) | 5 |
| `tui/test/live/thinking-budget.e2e.test.ts` (create) | gated live e2e | 6 |
| `docs/parity/coverage.md` (modify) + memory | Domain 10 refresh | 7 |

---

### Task 1: `thinkLevels.ts` — the level↔budget vocabulary

**Files:**
- Create: `tui/src/thinkLevels.ts`, `tui/test/thinkLevels.test.ts`

**Interfaces:**
- Produces: `THINK_LEVELS` (readonly tuple), `thinkBudget(level): number`, `thinkLabel(budget): string`, `parseThinkArg(arg): { level: string; budget: number } | null`. Consumed by Tasks 2 (chat `/think`), 3 (`--think` flag), 5 (console cycle).

- [ ] **Step 1: Write the failing test** — create `tui/test/thinkLevels.test.ts`:

```ts
// tui/test/thinkLevels.test.ts — pure level↔budget vocabulary.
import { describe, it, expect } from "vitest";
import { THINK_LEVELS, thinkBudget, thinkLabel, parseThinkArg } from "../src/thinkLevels.js";

describe("thinkLevels", () => {
  it("THINK_LEVELS is the effort-enum vocabulary plus off", () => {
    expect(THINK_LEVELS).toEqual(["off", "low", "medium", "high", "xhigh", "max"]);
  });
  it("thinkBudget maps each level to its token budget", () => {
    expect(thinkBudget("off")).toBe(0);
    expect(thinkBudget("low")).toBe(4000);
    expect(thinkBudget("high")).toBe(16000);
    expect(thinkBudget("max")).toBe(32000);
    expect(thinkBudget("nonsense")).toBe(0);
  });
  it("thinkLabel reverses an exact budget to its name, else Nk", () => {
    expect(thinkLabel(0)).toBe("off");
    expect(thinkLabel(16000)).toBe("high");
    expect(thinkLabel(15000)).toBe("15k");
  });
  it("parseThinkArg accepts a level name or a raw integer, else null", () => {
    expect(parseThinkArg("high")).toEqual({ level: "high", budget: 16000 });
    expect(parseThinkArg("off")).toEqual({ level: "off", budget: 0 });
    expect(parseThinkArg("16000")).toEqual({ level: "high", budget: 16000 });
    expect(parseThinkArg("15000")).toEqual({ level: "15k", budget: 15000 });
    expect(parseThinkArg("bogus")).toBeNull();
    expect(parseThinkArg("-5")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tui && npx vitest run test/thinkLevels.test.ts`
Expected: FAIL — `Cannot find module ../src/thinkLevels.js` (not created yet).

- [ ] **Step 3: Implement** — create `tui/src/thinkLevels.ts`:

```ts
// tui/src/thinkLevels.ts — the single source of truth for the /think level↔budget vocabulary. The level
// NAMES borrow the SDK effort enum (low/medium/high/xhigh/max) + an `off` rung; the MECHANISM is the thinking
// token budget (the only runtime lever — Session.setMaxThinkingTokens / the set_thinking control frame).
export const THINK_LEVELS = ["off", "low", "medium", "high", "xhigh", "max"] as const;
const BUDGETS: Record<string, number> = { off: 0, low: 4000, medium: 10000, high: 16000, xhigh: 24000, max: 32000 };

/** Level name → thinking token budget (unknown → 0). */
export function thinkBudget(level: string): number { return BUDGETS[level] ?? 0; }

/** Reverse: an exact budget → its level name, else "<N/1000>k" (e.g. 15000 → "15k"). */
export function thinkLabel(budget: number): string {
  const hit = THINK_LEVELS.find((l) => BUDGETS[l] === budget);
  return hit ?? `${Math.round(budget / 100) / 10}k`;
}

/** A level NAME or a raw non-negative integer → {level, budget}; invalid → null. */
export function parseThinkArg(arg: string): { level: string; budget: number } | null {
  const a = arg.trim();
  if ((THINK_LEVELS as readonly string[]).includes(a)) return { level: a, budget: BUDGETS[a] };
  if (/^\d+$/.test(a)) { const budget = parseInt(a, 10); return { level: thinkLabel(budget), budget }; }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tui && npx vitest run test/thinkLevels.test.ts && npm run typecheck`
Expected: PASS — all four cases; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add tui/src/thinkLevels.ts tui/test/thinkLevels.test.ts
git commit -m "feat(tui): thinkLevels vocabulary — effort-enum names → thinking token budgets (single source of truth)"
```

---

### Task 2: chat `/think` command (keystone)

**Files:**
- Modify: `tui/src/useChat.ts`, `tui/src/commands.ts`, `tui/test/useChat.test.tsx`, `tui/test/chat.test.tsx`, `tui/test/commands.test.ts`

**Interfaces:**
- Consumes: `parseThinkArg` from `./thinkLevels.js` (Task 1); existing `useChat` internals (`handleCommand`, `append`, `disposed`, `ChatState`, the `commands.ts` formatters).
- Produces: a `/think` command that calls `session.setMaxThinkingTokens(budget)` and tracks `thinkLevel`; `ChatSession.setMaxThinkingTokens`; `ChatState.thinkLevel`; `useChat` `opts.initialThink`; `formatThink` + a `think` `COMMANDS` row.

**⚠️ Breaking-change note (handle in this task):** adding `setMaxThinkingTokens` to the `ChatSession` interface means BOTH `fakeSession` definitions stop satisfying `ChatSession` until each gets an `async setMaxThinkingTokens() {}` default — `useChat.test.tsx:18` (alongside `setModel`) AND `chat.test.tsx`'s `fakeSession` (alongside its `setModel`). Both are Step-1/Step-3 edits below.

- [ ] **Step 1: Write the failing tests**

(a) `tui/test/commands.test.ts` — add `formatThink` to the import (line 3) and append to `describe("formatters", …)`:

```ts
  it("think: set vs show-current", () => {
    expect(formatThink("high")).toEqual([{ text: "thinking → high" }]);
    expect(formatThink(undefined, "default")).toEqual([{ text: "thinking: default", dim: true }]);
  });
```

And append a table check to `describe("resume helpers", …)` (or any top-level describe):

```ts
  it("/think is in the command table", () => {
    expect(COMMANDS.some((c) => c.name === "think")).toBe(true);
  });
```

(b) `tui/test/useChat.test.tsx` — add `async setMaxThinkingTokens() {}` to the `fakeSession` defaults (line 18, alongside `async setModel() {}`):

```ts
    async setPermissionMode() {}, async setModel() {}, async setMaxThinkingTokens() {}, async compact() { return { ok: true, preTokens: 0, postTokens: 0 }; },
```

Then append a new describe block (helpers `fakeSession`, `createUiBroker`, `frame`, `waitFor`, `render`, `Text`, `useChat`, `ChatSession` are already imported at the top of the file):

```ts
describe("thinking control", () => {
  function ThinkHost({ makeSession, api }: { makeSession: () => ChatSession; api: { run?: (s: string) => void } }) {
    const c = useChat(makeSession, createUiBroker());
    api.run = c.submit;
    return <Text>think:{c.state.thinkLevel} {c.state.lines.map((l) => l.text).join("|")}</Text>;
  }
  it("/think <level> sets the thinking budget and updates the indicator", async () => {
    const budgets: (number | null)[] = [];
    const session = fakeSession({ async setMaxThinkingTokens(n: number | null) { budgets.push(n); } });
    const api: { run?: (s: string) => void } = {};
    const { lastFrame } = render(<ThinkHost makeSession={() => session} api={api} />);
    await waitFor(() => frame(lastFrame).includes("think:default"));
    api.run!("/think high"); await waitFor(() => frame(lastFrame).includes("think:high"));
    expect(budgets).toEqual([16000]);
    expect(frame(lastFrame)).toContain("thinking → high");
  });
  it("/think off disables thinking via setMaxThinkingTokens(0)", async () => {
    const budgets: (number | null)[] = [];
    const session = fakeSession({ async setMaxThinkingTokens(n: number | null) { budgets.push(n); } });
    const api: { run?: (s: string) => void } = {};
    const { lastFrame } = render(<ThinkHost makeSession={() => session} api={api} />);
    await waitFor(() => frame(lastFrame).includes("think:default"));
    api.run!("/think off"); await waitFor(() => frame(lastFrame).includes("think:off"));
    expect(budgets).toEqual([0]);
  });
  it("/think with no arg shows the current level; /think bogus errors", async () => {
    const session = fakeSession();
    const api: { run?: (s: string) => void } = {};
    const { lastFrame } = render(<ThinkHost makeSession={() => session} api={api} />);
    await waitFor(() => frame(lastFrame).includes("think:default"));
    api.run!("/think"); await waitFor(() => frame(lastFrame).includes("thinking: default"));
    api.run!("/think bogus"); await waitFor(() => frame(lastFrame).includes("unknown level"));
  });
});
```

(c) `tui/test/chat.test.tsx` — add `async setMaxThinkingTokens() {}` to its `fakeSession` (alongside that file's `async setModel() {}`), so it still satisfies `ChatSession`:

```ts
    async setPermissionMode(m: string) { s.modes.push(m); }, async setModel() {}, async setMaxThinkingTokens() {}, async interrupt() {}, async getContextUsage() { return { totalTokens: 5, maxTokens: 100 }; },
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd tui && npx vitest run test/commands.test.ts test/useChat.test.tsx test/chat.test.tsx -t "think"`
Expected: FAIL — `formatThink` not exported; no `think` row; `c.state.thinkLevel` is undefined; `session.setMaxThinkingTokens` not in the interface (typecheck) until Step 3.

- [ ] **Step 3: Implement**

(a) In `tui/src/commands.ts`, add the `think` row to `COMMANDS` after the `yolo` row (`:24`):

```ts
  { name: "think", summary: "<off|low|medium|high|xhigh|max|N> — set thinking budget (no arg shows current)" },
```

And add `formatThink` after `formatModel` (`:35`):

```ts
export function formatThink(next?: string, current?: string): RenderLine[] {
  return next ? [{ text: `thinking → ${next}` }] : [{ text: `thinking: ${current ?? "default"}`, dim: true }];
}
```

(b) In `tui/src/useChat.ts`:

Add `formatThink` to the `commands.js` import (`:9`) and a new `thinkLevels.js` import after it (`:10` area):

```ts
import { parseCommand, formatHelp, formatModel, formatThink, formatCompact, formatContext, formatUnknown, pickMostRecent, type ParsedCommand, type InitialResume } from "./commands.js";
import { parseThinkArg } from "./thinkLevels.js";
```

Add `setMaxThinkingTokens` to the `ChatSession` interface after `setModel` (`:18`):

```ts
  setMaxThinkingTokens(maxTokens: number | null): Promise<void>;
```

Add `thinkLevel` to `ChatState` (`:27`, append before the closing `}`):

```ts
export interface ChatState { lines: RenderLine[]; streaming: RenderLine[]; pending: Pending | null; mode: string; busy: boolean; ctxPct?: number; model?: string; picker: { open: boolean; sessions: SessionInfo[] }; tasks: TaskItem[]; subagentActive: boolean; thinkLevel: string; }
```

Add `initialThink` to the `opts` type (`:36`):

```ts
  opts: { initialMode?: string; cwd?: string; initialResume?: InitialResume; initialThink?: string } = {},
```

Add the `thinkLevel` state after the `model` state (`:46`):

```ts
  const [thinkLevel, setThinkLevel] = useState(opts.initialThink ?? "default");
```

Add a `case "think":` to `handleCommand`'s switch after `case "yolo":` (`:100`):

```ts
        case "think":
          if (cmd.args) {
            const parsed = parseThinkArg(cmd.args);
            if (!parsed) { append([{ text: `thinking: unknown level "${cmd.args}" · try off/low/medium/high/xhigh/max or a number`, color: "red" }]); break; }
            await session.setMaxThinkingTokens(parsed.budget);
            if (!disposed.current) setThinkLevel(parsed.level);
            append(formatThink(parsed.level));
          } else append(formatThink(undefined, thinkLevel));
          break;
```

Add `thinkLevel` to the returned state object (`:172`):

```ts
  return { state: { lines, streaming, pending, mode, busy, ctxPct, model, picker, tasks, subagentActive, thinkLevel } as ChatState, submit, resolvePermission, cycleMode, interrupt, closePicker, pickSession };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tui && npx vitest run test/commands.test.ts test/useChat.test.tsx test/chat.test.tsx && npm run typecheck`
Expected: PASS — `/think` set/off/no-arg/bogus + the `formatThink`/table tests + all prior useChat/commands/chat tests (both fakeSessions satisfy `ChatSession` again); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add tui/src/useChat.ts tui/src/commands.ts tui/test/useChat.test.tsx tui/test/chat.test.tsx tui/test/commands.test.ts
git commit -m "feat(tui): chat /think command — runtime thinking-budget control via setMaxThinkingTokens (off..max)"
```

---

### Task 3: `--think` launch flag + threading

**Files:**
- Modify: `tui/src/commands.ts`, `tui/src/chat.tsx`, `tui/src/ChatApp.tsx`, `tui/test/commands.test.ts`

**Interfaces:**
- Consumes: `THINK_LEVELS` + `thinkBudget` from `./thinkLevels.js` (Task 1); `useChat` `opts.initialThink` (Task 2); `ChatApp` `hookOpts` (already threaded into `useChat`).
- Produces: `parseLaunchThink(args): string | undefined` (a valid level name, else undefined). `chat.tsx` opens the session with `thinking` config + threads `initialThink` for the indicator.

- [ ] **Step 1: Write the failing test** — in `tui/test/commands.test.ts`, add `parseLaunchThink` to the import (line 3) and append:

```ts
describe("parseLaunchThink", () => {
  it("reads a valid --think level, else undefined", () => {
    expect(parseLaunchThink(["--think", "high"])).toBe("high");
    expect(parseLaunchThink(["--think", "off"])).toBe("off");
    expect(parseLaunchThink(["--think", "bogus"])).toBeUndefined();
    expect(parseLaunchThink(["--model", "x"])).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tui && npx vitest run test/commands.test.ts -t "parseLaunchThink"`
Expected: FAIL — `parseLaunchThink` is not exported.

- [ ] **Step 3: Implement**

(a) In `tui/src/commands.ts`, add the `thinkLevels.js` import near the top (after line 3's `RenderLine` import):

```ts
import { THINK_LEVELS } from "./thinkLevels.js";
```

And add `parseLaunchThink` after `parseLaunchMode` (end of file):

```ts
/** `--think <level>` → a valid level name (off|low|medium|high|xhigh|max), or undefined if absent/unknown. */
export function parseLaunchThink(args: string[]): string | undefined {
  const i = args.indexOf("--think");
  const v = i >= 0 ? args[i + 1] : undefined;
  return v && (THINK_LEVELS as readonly string[]).includes(v) ? v : undefined;
}
```

(b) In `tui/src/chat.tsx`, update the imports (`:8`) and wiring:

```ts
import { parseResumeIntent, parseLaunchMode, parseLaunchThink } from "./commands.js";
import { thinkBudget } from "./thinkLevels.js";
```

Insert after the `rawMode` stderr line (`:16`) and update `base` + the `render` call:

```ts
const launchThink = parseLaunchThink(args);
const thinking = launchThink === "off" ? { type: "disabled" as const }
               : launchThink ? { type: "enabled" as const, budgetTokens: thinkBudget(launchThink) }
               : undefined;
const base = { model: flag("--model"), cwd: flag("--cwd") ?? process.cwd(), permissionMode: launchMode, ...(thinking ? { thinking } : {}), permissionBroker: ui.broker, contextTool: true, includePartialMessages: true, forwardSubagentText: true };
const initialResume = parseResumeIntent(args);
const makeSession = (resume?: string) => openSession({ ...base, ...(resume ? { resume } : {}) });
render(<ChatApp makeSession={makeSession} broker={ui} cwd={base.cwd} initialResume={initialResume} hookOpts={{ initialMode: launchMode, initialThink: launchThink ?? "default" }} />);
```

(c) In `tui/src/ChatApp.tsx`, widen the `hookOpts` type (`:16`) so `initialThink` threads through to `useChat`:

```ts
export function ChatApp({ makeSession, broker, hookOpts, cwd, initialResume }: { makeSession: (resume?: string) => ChatSession; broker: UiBrokerHandle; hookOpts?: { initialMode?: string; initialThink?: string }; cwd: string; initialResume?: InitialResume }) {
```

(The `useChat(makeSession, broker, { ...(hookOpts ?? {}), cwd, initialResume })` call at `:17` already spreads `hookOpts`, so `initialThink` reaches `useChat`'s `opts` — typed in Task 2.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tui && npx vitest run test/commands.test.ts test/chat.test.tsx && npm run typecheck`
Expected: PASS — `parseLaunchThink` cases + all command/chat tests; typecheck clean (`thinking: {type:"disabled"} | {type:"enabled",budgetTokens}` is assignable to `OpenSessionConfig.thinking`, and `initialThink` to `useChat` opts).

- [ ] **Step 5: Commit**

```bash
git add tui/src/commands.ts tui/src/chat.tsx tui/src/ChatApp.tsx tui/test/commands.test.ts
git commit -m "feat(tui): --think launch flag (parseLaunchThink) — open at a baseline thinking budget + thread initialThink"
```

---

### Task 4: `think:<level>` status indicator

**Files:**
- Modify: `tui/src/ChatStatusBar.tsx`, `tui/src/ChatApp.tsx`, `tui/test/components.test.tsx`

**Interfaces:**
- Consumes: `ChatState.thinkLevel` (Task 2).
- Produces: `ChatStatusBar` renders a `think:<level>` span when `thinkLevel` is set.

- [ ] **Step 1: Write the failing test** — append to `tui/test/components.test.tsx` inside `describe("<ChatStatusBar>", …)` (the `ChatStatusBar` import already exists at `:10`):

```ts
  it("shows the thinking level", () => {
    const { lastFrame } = render(<ChatStatusBar mode="default" busy={false} hasPending={false} thinkLevel="high" />);
    expect(lastFrame()).toContain("think");
    expect(lastFrame()).toContain("high");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tui && npx vitest run test/components.test.tsx -t "thinking level"`
Expected: FAIL — `thinkLevel` is not a `ChatStatusBar` prop (typecheck) and no `think` span renders.

- [ ] **Step 3: Implement** — in `tui/src/ChatStatusBar.tsx`, add `thinkLevel?: string` to the props type and a span after the mode span (`:12`):

```ts
export function ChatStatusBar({ model, mode, busy, ctxPct, hasPending, subagentActive, thinkLevel }: { model?: string; mode: string; busy: boolean; ctxPct?: number; hasPending: boolean; subagentActive?: boolean; thinkLevel?: string }) {
```

Insert the think span immediately after the mode `<Text>` line (`:12`), before the ctx `<Text>`:

```ts
      {thinkLevel ? <Text>{"  "}think <Text color="magenta">{thinkLevel}</Text></Text> : null}
```

In `tui/src/ChatApp.tsx`, pass `thinkLevel` to the status bar (`:31`):

```ts
      <ChatStatusBar model={state.model} mode={state.mode} busy={state.busy} ctxPct={state.ctxPct} hasPending={!!state.pending} subagentActive={state.subagentActive} thinkLevel={state.thinkLevel} />
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tui && npx vitest run test/components.test.tsx test/chat.test.tsx && npm run typecheck`
Expected: PASS — the think-span test + all existing component/chat tests (the status bar still renders mode/ctx%); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add tui/src/ChatStatusBar.tsx tui/src/ChatApp.tsx tui/test/components.test.tsx
git commit -m "feat(tui): show think:<level> in the chat status bar"
```

---

### Task 5: console `cycleThinking`

**Files:**
- Modify: `tui/src/useDaemon.ts`, `tui/src/App.tsx`, `tui/test/useDaemon.test.tsx`

**Interfaces:**
- Consumes: `THINK_LEVELS` + `thinkBudget` from `./thinkLevels.js` (Task 1); existing `run`/`ctl`/`useCallback`/`useRef` and the `pmIndex` pattern.
- Produces: `cycleThinking()` issues a `set_thinking` control op (cycling `off→low→…→max→off`) to the selected session. Added to the `DaemonView` return.

- [ ] **Step 1: Write the failing test** — append to `tui/test/useDaemon.test.tsx`'s `describe("useDaemon", …)`:

```ts
  it("cycleThinking cycles the thinking budget via set_thinking control frames", async () => {
    const c = fakeClient();
    render(<Probe client={c} opts={{ schedule: manualSchedule().schedule, now: () => 0 }} />);
    await flush();
    view.cycleThinking(); await flush();
    expect(c.calls.control.at(-1)).toEqual(["sess-1", { type: "set_thinking", maxTokens: 4000 }]);    // off→low
    view.cycleThinking(); await flush();
    expect(c.calls.control.at(-1)).toEqual(["sess-1", { type: "set_thinking", maxTokens: 10000 }]);   // low→medium
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tui && npx vitest run test/useDaemon.test.tsx -t "cycleThinking"`
Expected: FAIL — `view.cycleThinking` is not a function (not yet on the view).

- [ ] **Step 3: Implement** — in `tui/src/useDaemon.ts`:

(a) Add the `thinkLevels.js` import after the `cc-harness` imports (`:2-3` area):

```ts
import { THINK_LEVELS, thinkBudget } from "./thinkLevels.js";
```

(b) Add a `thinkIndex` ref immediately after `pmIndex` (`:54`):

```ts
  const thinkIndex = useRef(0);
```

(c) Add `cycleThinking` immediately after `cycleModel` (`:136`):

```ts
  const cycleThinking = useCallback(() => {
    thinkIndex.current = (thinkIndex.current + 1) % THINK_LEVELS.length;
    const level = THINK_LEVELS[thinkIndex.current];
    run(`thinking=${level}`, ctl(`thinking=${level}`, { type: "set_thinking", maxTokens: thinkBudget(level) }));
  }, [run]);
```

(d) Add `cycleThinking` to the returned object (`:163-164`, alongside `cyclePermissionMode`):

```ts
  return { snapshot, selectedIndex: idx, selected, focus, stream, status, pending: snapshot.pending,
    select, focusInput, focusList, submit, interrupt, cycleModel, cyclePermissionMode, cycleThinking, compact, fork, toggleProactive, spawn, stop, respond, teardown };
```

(e) Add `cycleThinking: () => void;` to the `DaemonView` interface (the type returned by `useDaemon`, declared above `useDaemon` near `cyclePermissionMode: () => void;`).

In `tui/src/App.tsx`, bind a `t` key to `cycleThinking` in the list-mode `useInput`, after the `p` line (`:28`):

```ts
    else if (input === "t") d.cycleThinking();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tui && npx vitest run test/useDaemon.test.tsx && npm run typecheck`
Expected: PASS — the `cycleThinking` test (off→low→medium budgets) + all existing daemon tests; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add tui/src/useDaemon.ts tui/src/App.tsx tui/test/useDaemon.test.tsx
git commit -m "feat(tui): console cycleThinking — set_thinking control op (t key) cycles the thinking budget"
```

---

### Task 6: gated live e2e — the thinking lever drives real thinking

**Files:**
- Create: `tui/test/live/thinking-budget.e2e.test.ts`

- [ ] **Step 1: Write the test** — create `tui/test/live/thinking-budget.e2e.test.ts`:

```ts
// tui/test/live/thinking-budget.e2e.test.ts — gated: proves the lever /think drives end-to-end on the lib
// Session path. setMaxThinkingTokens(0) → a reasoning turn emits NO thinking blocks; a high budget → thinking
// returns (mirrors probe 25's detection). Skips keyless.
import { describe, it, expect } from "vitest";
import { openSession } from "cc-harness";

const live = process.env.ANTHROPIC_API_KEY ? describe : describe.skip;
const reason = "Reason step by step, then answer: if a train travels 60 km in 45 minutes, what is its speed in km/h? Show your reasoning.";
function countThinking(msgs: any[]): number {
  let n = 0;
  for (const m of msgs) if (m?.type === "assistant") for (const b of m.message?.content ?? []) if (b?.type === "thinking") n++;
  return n;
}

live("thinking budget control (live)", () => {
  it("setMaxThinkingTokens(0) disables thinking; a high budget enables it", async () => {
    const session = openSession({ model: "claude-sonnet-4-6", permissionMode: "bypassPermissions", cwd: process.cwd() } as any);
    try {
      const off: any[] = [];
      await session.setMaxThinkingTokens(0);
      await session.submit(reason, (m: unknown) => off.push(m));
      expect(countThinking(off)).toBe(0);                  // off → no thinking blocks

      const on: any[] = [];
      await session.setMaxThinkingTokens(16000);
      await session.submit(reason, (m: unknown) => on.push(m));
      expect(countThinking(on)).toBeGreaterThan(0);        // high → thinking returns
    } finally {
      await session.dispose();
    }
  }, 120_000);
});
```

- [ ] **Step 2: Run keyless to confirm a clean skip**

Run: `cd tui && npx vitest run test/live/thinking-budget.e2e.test.ts`
Expected: **SKIPPED** (no key). (Implementer stops here; the controller runs the keyed pass.)

- [ ] **Step 3: (controller) Run keyed**

Run: `cd tui && set -a; . ../.env; set +a; npx vitest run test/live/thinking-budget.e2e.test.ts`
Expected: PASS (~20–60 s) — `off` turn has 0 thinking blocks, the high-budget turn has ≥1 (the lever `/think` drives works end-to-end on the real Session).

- [ ] **Step 4: Commit**

```bash
git add tui/test/live/thinking-budget.e2e.test.ts
git commit -m "test(tui): gated live e2e — setMaxThinkingTokens(0) disables thinking, a high budget re-enables it"
```

---

### Task 7: refresh coverage scorecard + memory

**Files:**
- Modify: `docs/parity/coverage.md`; memory (controller-handled)

- [ ] **Step 1: Full keyless gates**

Run: `cd tui && npm run typecheck && npx vitest run`
Expected: tui typecheck clean + all keyless suites pass (live suites skip).

- [ ] **Step 2: Update `docs/parity/coverage.md`** — in the Domain 10 row, change the Realized cell `~57%¹` → `~60%¹` (preserve the `¹` footnote), and insert this sentence verbatim **immediately before** the closing `Remote/voice remain 🚫/non-goal **by design**` clause (after the increment-10 sentence ending `2026-06-20-auto-permission-ladder`):

```
**Phase-3 increment 11 SHIPPED — interactive thinking-budget control** (`cc-harness-chat` + console): a `/think <off|low|medium|high|xhigh|max|N>` command sets the extended-thinking budget at runtime via the already-built `Session.setMaxThinkingTokens` lever (probe 25: it takes effect mid-session and `0` disables thinking, which is ON by default), a `--think <level>` launch flag opens at a baseline budget (`thinking` config), the status bar shows `think:<level>`, and the daemon console gains a `cycleThinking` (`t` key) issuing the existing `set_thinking` control frame. The level vocabulary borrows the SDK effort enum; the mechanism is the thinking token budget. A pure `thinkLevels.ts` is the single source of truth — NO harness change (every lever was already built). Spec/plan `2026-06-20-thinking-budget-control`.
```

Keep the row a single line (no line break inside the table cell).

- [ ] **Step 3: Commit**

```bash
git add docs/parity/coverage.md
git commit -m "docs(parity): record increment-11 interactive thinking-budget control (Domain 10)"
```

(Memory files live outside the repo — the controller writes them, not a git commit.)

---

## Self-Review

**1. Spec coverage** — every spec scope item maps to a task: §1 vocabulary (`thinkLevels.ts`) → T1; §2 chat `/think` command → T2, `--think` flag + threading → T3, status indicator → T4; §3 console parity (`cycleThinking` + `set_thinking` + `t` key) → T5; §6 tests → unit in T1–T5 + gated live e2e → T6; docs → T7. The "mechanism = thinking budget, vocabulary = effort enum" decision is in `thinkLevels.ts` (T1) and used identically by chat (T2/T3) and console (T5). The `off → setMaxThinkingTokens(0)` / `--think off → {type:"disabled"}` split is in T2/T3.

**2. Placeholder scan** — every code step shows complete code against the *actual* files (verified by reading them this session): T2 uses the real `fakeSession(overrides)`/`frame`/`waitFor` and the real `handleCommand` switch/`ChatState`/`opts`; T3 the real `chat.tsx` `base`/`render` block and `ChatApp` `hookOpts`; T5 the real `useDaemon` `pmIndex`/`run`/`ctl`/return and `App.tsx` `useInput`. The one non-literal step — T5(e) "add `cycleThinking: () => void;` to the `DaemonView` interface" — names the exact field, type, and neighbor (`cyclePermissionMode`); the interface is a few lines above `useDaemon` in the same file.

**3. Type consistency** — `thinkBudget(level: string): number`, `thinkLabel(budget: number): string`, `parseThinkArg(arg: string): {level,budget}|null` (T1) are used identically in T2 (`useChat`), T3 (`chat.tsx` via `thinkBudget`), T5 (`useDaemon`). `setMaxThinkingTokens(maxTokens: number|null)` matches the real `Session` method and the `ChatSession` addition. `formatThink(next?, current?)` mirrors `formatModel`. `ChatState.thinkLevel: string` is produced by T2 and consumed by T4's status prop. The `set_thinking` control frame `{type:"set_thinking", maxTokens}` (T5) matches `ControlFrame` (`bridge/types.ts:22`). `--think off → {type:"disabled"}` / non-off → `{type:"enabled", budgetTokens}` matches `ThinkingConfig` (`config/types.ts:14`).

**Breaking-change handled** — the `ChatSession.setMaxThinkingTokens` addition (T2) breaks both `fakeSession` definitions (`useChat.test.tsx` + `chat.test.tsx`); both get the no-op default in T2 Step 1/3, and T2 Step 4 runs both suites.

**Deferred / out-of-scope held** — `/cost` (separate audit finding); the `effort` config knob (orthogonal passthrough); a runtime `setEffort` (no SDK lever); per-model thinking-capability gating (the `/think` call is try/caught — a rejecting model surfaces `✗ <message>`).
