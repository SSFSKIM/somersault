# Chat Rich Tool Rendering (Increment 7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `cc-harness-chat` show its work like real Claude Code — nested subagent transcripts (collapse-on-done), a pinned task checklist, inline file diffs, and status affordances — all from frames the SDK already emits.

**Architecture:** Two pure reducers (extend `liveTurn.ts` for subagent nesting/collapse/clock + inline diffs; new `taskList.ts` reducing native `TaskCreate`/`TaskUpdate` ops) + a new presentational `TaskPanel.tsx` pinned above the composer; `useChat` holds a session-persistent task list and a `subagentActive` flag; `chat.tsx` sets `forwardSubagentText:true`. All in `tui/` — no harness change.

**Tech Stack:** TypeScript, React 18, Ink 5, Vitest 2, ink-testing-library 4. Package `cc-harness-tui` (`CC-to-SDK/tui/`), engine `cc-harness` (`file:../harness`).

## Global Constraints

- **NO Prettier — dense hand-style:** compact, multi-statement lines; match surrounding code.
- **ESM `.js` import specifiers** in `tui/` (`from "./taskList.js"`); bare `"cc-harness"` for engine imports.
- **ink `useInput` passive-effect timing discipline:** component/app tests **`await` a render tick / `waitFor`** BEFORE writing keys. **Never** raw `stdin.on`; **never** mutate shared components. Real escape sequences only: `\x1b[B`/`\x1b[A`/`\x1b`/`\r` (bare `[B` is a literal string, not an arrow — proven in incr 6).
- **Test files run SEQUENTIALLY** — `tui/vitest.config.ts` has `fileParallelism:false` (incr-6 flaky-fix); leave it.
- **Keep modules small/focused:** pure reducers (`liveTurn`, `taskList`) + presentational `TaskPanel` keep `useChat`/`ChatApp` lean; `liveTurn` stays a pure, clock-injected reducer (no React/Ink/SDK).
- **No new `cc-harness` public exports** (all work in `tui/`; `forwardSubagentText` already exposed) → no API-STABILITY / index.test pin, **no harness rebuild**.
- **Live tests gate** on `ANTHROPIC_API_KEY` (`const live = process.env.ANTHROPIC_API_KEY ? describe : describe.skip`), read from `CC-to-SDK/.env` (gitignored — never commit/print it); keyless suites skip cleanly.
- Commands run **from `tui/`**: `npm run typecheck`, `npx vitest run test/<file>`, `npm run build`. Live: `set -a; . ../.env; set +a; npx vitest run test/live/<file>`.
- Commit messages: plain, no `Co-Authored-By` / attribution.

## Grounding (already done — not a task)

Probes `probes/probes/22-subagent-nesting-todowrite.ts` + `22b-native-task-tools-shape.ts` (committed `a632bff21d`) established: the native subagent tool is **`Agent`**; its inner turns surface as **full `assistant`/`user` messages with `parent_tool_use_id` = the Agent tool_use id**; **all partial `stream_event` frames are top-level** (nested content is whole-messages, never token deltas); `forwardSubagentText:true` adds subagent text/thinking. The SDK has **no `TodoWrite`** — it uses native `TaskCreate {subject,description}` (id from the **result** `"Task #N created successfully: <subject>"`), `TaskUpdate {taskId,status}`, `TaskList {}`. `forwardSubagentText` is already plumbed (`harness/src/config/types.ts:18` → `resolveOptions.ts:44`).

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `tui/src/taskList.ts` (create) | pure reducer: native task ops → `TaskItem[]` | 1 |
| `tui/test/taskList.test.ts` (create) | reducer units | 1 |
| `tui/src/TaskPanel.tsx` (create) | pinned checklist component | 2 |
| `tui/test/components.test.tsx` (modify) | `TaskPanel` component test | 2 |
| `tui/src/liveTurn.ts` (modify) | clock+elapsed (T3); subagent nesting+collapse+`subagentActive` (T4); inline Edit/Write diffs (T5) | 3,4,5 |
| `tui/test/liveTurn.test.ts` (modify) | clock/elapsed (T3); nesting/collapse (T4); diff (T5) | 3,4,5 |
| `tui/src/render.ts` (modify) | export truncation-aware `toolDiffLines` | 5 |
| `tui/test/render.test.ts` (modify) | `toolDiffLines` truncation unit | 5 |
| `tui/src/useChat.ts` (modify) | persistent `TaskList`; `tasks`+`subagentActive` state; reset on `/resume` | 6 |
| `tui/src/ChatApp.tsx` (modify) | render `<TaskPanel>` pinned | 6 |
| `tui/src/chat.tsx` (modify) | `forwardSubagentText:true` | 6 |
| `tui/test/useChat.test.tsx` (modify) | task-feed + subagentActive | 6 |
| `tui/src/ChatStatusBar.tsx` (modify) | `⚙ subagent running` segment | 7 |
| `tui/test/components.test.tsx` (modify) | status-bar subagent segment | 7 |
| `tui/test/live/chat-rich.e2e.test.ts` (create) | gated live: Agent nest + task | 8 |
| `docs/parity/coverage.md` (modify) + memory | Domain 10 refresh | 9 |

---

### Task 1: `taskList.ts` — native task-op reducer

**Files:** Create `tui/src/taskList.ts`, `tui/test/taskList.test.ts`.

**Interfaces:**
- Produces: `type TaskStatus = "pending"|"in_progress"|"completed"`; `interface TaskItem { id: string; subject: string; status: TaskStatus }`; `class TaskList { ingest(m: unknown): void; snapshot(): TaskItem[]; reset(): void }`. Used by Tasks 2,6.

- [ ] **Step 1: Write the failing test** — create `tui/test/taskList.test.ts`:

```ts
// tui/test/taskList.test.ts — reduce native TaskCreate/TaskUpdate ops (probe-22b shapes) into a checklist.
import { describe, it, expect } from "vitest";
import { TaskList } from "../src/taskList.js";

const create = (id: string, subject: string) => [
  { type: "assistant", message: { content: [{ type: "tool_use", id: `tc${id}`, name: "TaskCreate", input: { subject, description: "d" } }] } },
  { type: "user", message: { content: [{ type: "tool_result", tool_use_id: `tc${id}`, content: `Task #${id} created successfully: ${subject}` }] } },
];
const update = (taskId: string, status: string) => ({ type: "assistant", message: { content: [{ type: "tool_use", id: `tu${taskId}${status}`, name: "TaskUpdate", input: { taskId, status } }] } });

describe("TaskList", () => {
  it("reduces create+result into items, applies update by id, sorts numerically", () => {
    const tl = new TaskList();
    for (const m of create("1", "build the parser")) tl.ingest(m);
    for (const m of create("2", "write tests")) tl.ingest(m);
    tl.ingest(update("1", "in_progress"));
    expect(tl.snapshot()).toEqual([
      { id: "1", subject: "build the parser", status: "in_progress" },
      { id: "2", subject: "write tests", status: "pending" },
    ]);
  });
  it("ignores an update for an unknown id and resets", () => {
    const tl = new TaskList();
    tl.ingest(update("9", "completed"));         // no such task → no-op
    expect(tl.snapshot()).toEqual([]);
    for (const m of create("1", "x")) tl.ingest(m);
    expect(tl.snapshot()).toHaveLength(1);
    tl.reset();
    expect(tl.snapshot()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tui && npx vitest run test/taskList.test.ts`
Expected: FAIL — `Cannot find module "../src/taskList.js"`.

- [ ] **Step 3: Implement** — create `tui/src/taskList.ts`:

```ts
// tui/src/taskList.ts — pure reducer: the SDK's native task ops (TaskCreate/TaskUpdate/TaskList) → a checklist.
// Probe 22b: TaskCreate input {subject}; the id arrives in the RESULT "Task #N created successfully: <subject>";
// TaskUpdate input {taskId,status} applies by id. No React/SDK. Unknown/partial frames ignored.
export type TaskStatus = "pending" | "in_progress" | "completed";
export interface TaskItem { id: string; subject: string; status: TaskStatus }

const resultText = (content: unknown): string =>
  typeof content === "string" ? content
  : Array.isArray(content) ? content.map((b: any) => (typeof b?.text === "string" ? b.text : "")).join("") : "";

export class TaskList {
  private tasks = new Map<string, TaskItem>();      // id → item
  private pending = new Map<string, string>();      // TaskCreate tool_use_id → subject (awaiting result id)

  ingest(m: unknown): void {
    const mm = m as any;
    if (mm?.type === "assistant") for (const b of mm.message?.content ?? []) {
      if (b?.type !== "tool_use") continue;
      if (b.name === "TaskCreate") this.pending.set(String(b.id ?? ""), String(b.input?.subject ?? ""));
      else if (b.name === "TaskUpdate") {
        const id = String(b.input?.taskId ?? ""), t = this.tasks.get(id);
        if (t && b.input?.status) t.status = b.input.status as TaskStatus;
      }
    } else if (mm?.type === "user") for (const b of mm.message?.content ?? []) {
      if (b?.type !== "tool_result") continue;
      const subject = this.pending.get(String(b.tool_use_id ?? ""));
      if (subject === undefined) continue;
      const id = resultText(b.content).match(/Task #(\d+) created/)?.[1];
      if (id) this.tasks.set(id, { id, subject, status: "pending" });
      this.pending.delete(String(b.tool_use_id ?? ""));
    }
  }

  snapshot(): TaskItem[] { return [...this.tasks.values()].sort((a, b) => Number(a.id) - Number(b.id)); }
  reset(): void { this.tasks.clear(); this.pending.clear(); }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tui && npx vitest run test/taskList.test.ts && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add tui/src/taskList.ts tui/test/taskList.test.ts
git commit -m "feat(tui): taskList reducer — native TaskCreate/TaskUpdate ops into a checklist"
```

---

### Task 2: `TaskPanel.tsx` — pinned checklist component

**Files:** Create `tui/src/TaskPanel.tsx`; modify `tui/test/components.test.tsx`.

**Interfaces:**
- Consumes: `TaskItem` from `./taskList.js` (Task 1).
- Produces: `TaskPanel({ tasks: TaskItem[] })`. Used by Task 6.

- [ ] **Step 1: Write the failing test** — append to `tui/test/components.test.tsx`:

```tsx
import { TaskPanel } from "../src/TaskPanel.js";

describe("TaskPanel", () => {
  it("renders a glyph per status and the subject", () => {
    const { lastFrame } = render(<TaskPanel tasks={[
      { id: "1", subject: "build the parser", status: "in_progress" },
      { id: "2", subject: "write tests", status: "pending" },
      { id: "3", subject: "ship it", status: "completed" },
    ]} />);
    const f = lastFrame() ?? "";
    expect(f).toContain("▶ build the parser");
    expect(f).toContain("☐ write tests");
    expect(f).toContain("☑ ship it");
    expect(f).toContain("Tasks");
  });
  it("renders nothing when empty", () => {
    const { lastFrame } = render(<TaskPanel tasks={[]} />);
    expect((lastFrame() ?? "").trim()).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tui && npx vitest run test/components.test.tsx -t "TaskPanel"`
Expected: FAIL — `Cannot find module "../src/TaskPanel.js"`.

- [ ] **Step 3: Implement** — create `tui/src/TaskPanel.tsx`:

```tsx
// tui/src/TaskPanel.tsx — the pinned task checklist (☐ pending / ▶ in_progress / ☑ completed). Hidden when empty.
import React from "react";
import { Box, Text } from "ink";
import type { TaskItem, TaskStatus } from "./taskList.js";

const GLYPH: Record<TaskStatus, string> = { pending: "☐", in_progress: "▶", completed: "☑" };

export function TaskPanel({ tasks }: { tasks: TaskItem[] }) {
  if (!tasks.length) return null;
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Text bold>Tasks</Text>
      {tasks.map((t) => <Text key={t.id}>{GLYPH[t.status]} {t.subject}</Text>)}
    </Box>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tui && npx vitest run test/components.test.tsx && npm run typecheck`
Expected: PASS — TaskPanel + existing component tests; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add tui/src/TaskPanel.tsx tui/test/components.test.tsx
git commit -m "feat(tui): TaskPanel — pinned task checklist component"
```

---

### Task 3: `liveTurn` — inject a clock + show running-tool elapsed

**Files:** Modify `tui/src/liveTurn.ts`, `tui/test/liveTurn.test.ts`.

**Interfaces:**
- Produces: `new LiveTurn(now?: () => number)` (defaults to `Date.now`); the running-tool marker gains an elapsed suffix `Ns` once a tool has run **≥1s**. Used by Task 4 (collapse summary reuses the clock).

This is foundational for Task 4's `(N tools · Ts)` collapse summary. It must be **behavior-preserving for the existing 8 tests** (they use `new LiveTurn()` with the default clock and assert instant markers like `⟳ Read` with no suffix — so elapsed must render only at ≥1s).

- [ ] **Step 1: Write the failing test** — append to `tui/test/liveTurn.test.ts`:

```ts
  it("shows elapsed on a still-running tool only after ≥1s, via an injected clock", () => {
    let t = 1000; const lt = new LiveTurn(() => t);
    lt.ingest(se({ type: "message_start" }));
    lt.ingest(se({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tk", name: "Bash", input: {} } }));
    expect(texts(lt).find((x) => x.startsWith("⟳ Bash"))).toBe("⟳ Bash");   // 0s → no suffix
    t = 4000;                                                                 // 3s later
    expect(texts(lt).find((x) => x.startsWith("⟳ Bash"))).toBe("⟳ Bash 3s"); // elapsed shown
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tui && npx vitest run test/liveTurn.test.ts -t "elapsed"`
Expected: FAIL — `LiveTurn` takes no constructor arg / no elapsed suffix.

- [ ] **Step 3: Implement** — `tui/src/liveTurn.ts`:

(a) Add a `startedAt` to the tool Block type and a constructor clock. Change the `ToolBlock`/`Block` tool variant to include `startedAt: number`:

```ts
  | { kind: "tool"; index: number; id: string; name: string; target: string; status: "running" | "done" | "error"; preview?: string; startedAt: number };
```

(b) Add the constructor (LiveTurn currently has none — add as the first member):

```ts
  constructor(private now: () => number = () => Date.now()) {}
```

(c) Set `startedAt: this.now()` at both tool-block creation sites — in `onStreamEvent` (`content_block_start` tool_use) and in `onAssistant` (the no-partial fallback). Each `{ kind: "tool", ... status: "running" }` literal gains `startedAt: this.now()`.

(d) In `renderBlock`, the running branch shows elapsed ≥1s:

```ts
    if (b.status === "error") return [{ text: `✗ ${label}`, color: "red" }];
    if (b.status === "done") return [{ text: `✓ ${label}${b.preview ? "  │ " + b.preview : ""}` }];
    if (this.ended) return [{ text: `· ${label}`, dim: true }];               // settled after finalize
    const s = Math.floor((this.now() - b.startedAt) / 1000);
    return [{ text: `⟳ ${label}${s >= 1 ? ` ${s}s` : ""}` }];                 // running, elapsed ≥1s
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tui && npx vitest run test/liveTurn.test.ts && npm run typecheck`
Expected: PASS — the new elapsed test + all 8 existing tests (default clock → instant → no suffix); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add tui/src/liveTurn.ts tui/test/liveTurn.test.ts
git commit -m "feat(tui): liveTurn injected clock + running-tool elapsed (≥1s)"
```

---

### Task 4: `liveTurn` — subagent nesting + collapse-on-done + `subagentActive`

**Files:** Modify `tui/src/liveTurn.ts`, `tui/test/liveTurn.test.ts`.

**Interfaces:**
- Consumes: the injected clock (Task 3).
- Produces: full `assistant`/`user` messages with `parent_tool_use_id` nest under their `Agent` tool block; on the top-level `tool_result` for the Agent id the block **collapses** to `⚙ Agent <target> ✓ (N tools · Ts)`; new getter `subagentActive: boolean`. Used by Task 6 (`subagentActive` → status bar).

Grounding (probe 22): sequence is `assistant tool_use:Agent#X` (top), then `user ptid=X`, `assistant ptid=X tool_use:Bash`, `user ptid=X tool_result`, `assistant ptid=X text`, then `user ptid=— tool_result→X` (closes the nest). `byTool.get(X)` returns the Agent block whether it's in `current` or `committed` (it holds object refs), so nested children attach by id regardless of flush.

- [ ] **Step 1: Write the failing test** — append to `tui/test/liveTurn.test.ts`:

```ts
  it("nests subagent (Agent) turns under the parent and collapses on the top-level result", () => {
    let t = 0; const lt = new LiveTurn(() => t);
    // top-level Agent tool_use (full message — no partials for the agent's own content)
    lt.ingest({ type: "assistant", message: { content: [{ type: "tool_use", id: "ag1", name: "Agent", input: { description: "research" } }] } });
    expect(lt.subagentActive).toBe(true);
    expect(texts(lt).some((x) => x.startsWith("⚙ Agent"))).toBe(true);
    // nested subagent turns (parent_tool_use_id = ag1)
    lt.ingest({ type: "user", parent_tool_use_id: "ag1", message: { content: [{ type: "text", text: "do the thing" }] } });
    lt.ingest({ type: "assistant", parent_tool_use_id: "ag1", message: { content: [{ type: "tool_use", id: "b1", name: "Bash", input: { command: "echo hi" } }] } });
    lt.ingest({ type: "user", parent_tool_use_id: "ag1", message: { content: [{ type: "tool_result", tool_use_id: "b1", content: "hi" }] } });
    lt.ingest({ type: "assistant", parent_tool_use_id: "ag1", message: { content: [{ type: "text", text: "the output is hi" }] } });
    const expanded = texts(lt);
    expect(expanded.some((x) => x.includes("Bash"))).toBe(true);             // nested tool shown while running
    expect(expanded.some((x) => x.includes("the output is hi"))).toBe(true);// nested text shown
    // top-level Agent result closes + collapses
    t = 12000;
    lt.ingest({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "ag1", content: "done" }] } });
    expect(lt.subagentActive).toBe(false);
    const collapsed = texts(lt);
    expect(collapsed.some((x) => /⚙ Agent .*✓ \(1 tools? · 12s\)/.test(x))).toBe(true);
    expect(collapsed.some((x) => x.includes("the output is hi"))).toBe(false); // nested hidden after collapse
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tui && npx vitest run test/liveTurn.test.ts -t "nests subagent"`
Expected: FAIL — `subagentActive` undefined; nested messages render as top-level, no collapse.

- [ ] **Step 3: Implement** — `tui/src/liveTurn.ts`:

(a) Extend the tool Block with nesting fields (Agent uses them; other tools leave them empty):

```ts
  | { kind: "tool"; index: number; id: string; name: string; target: string; status: "running" | "done" | "error"; preview?: string; startedAt: number; nested?: RenderLine[]; toolCount?: number; doneAt?: number };
```

(b) Route messages with `parent_tool_use_id` to a nesting handler. In `ingest`, before the assistant/user dispatch:

```ts
  ingest(m: unknown): void {
    const e = ev(m);
    if (e) { this.sawPartials = true; this.onStreamEvent(e); return; }
    const mm = m as any;
    const ptid = mm?.parent_tool_use_id;
    if (ptid) { this.onNested(String(ptid), mm); return; }     // subagent inner turn (whole message; never partial)
    if (mm?.type === "assistant") this.onAssistant(mm);
    else if (mm?.type === "user") this.onUser(mm);
  }
```

(c) Add `onNested` — append rendered child lines to the parent Agent block (found via `byTool`):

```ts
  private onNested(ptid: string, mm: any): void {
    const agent = this.byTool.get(ptid);
    if (!agent || agent.kind !== "tool") return;               // unknown parent → ignore
    if (!agent.nested) { agent.nested = []; agent.toolCount = 0; }
    for (const b of mm.message?.content ?? []) {
      if (b?.type === "text" && b.text) for (const l of String(b.text).split("\n")) agent.nested.push({ text: `  │ ${l}`, dim: true });
      else if (b?.type === "tool_use") { agent.toolCount = (agent.toolCount ?? 0) + 1; agent.nested.push({ text: `  ⚙ ${b.name}${b.input ? " " + toolTarget(String(b.name), b.input) : ""}`, dim: true }); }
      else if (b?.type === "tool_result") { const p = trunc(firstResultLine(b.content)); if (p) agent.nested.push({ text: `  ⎿ ${p}`, dim: true }); }
    }
  }
```

(d) In `onUser`, when a top-level `tool_result` closes an Agent block, collapse it (set `doneAt`). The existing loop already flips status to `done`; add the Agent collapse:

```ts
  private onUser(mm: any): void {
    for (const b of mm.message?.content ?? []) {
      if (b?.type !== "tool_result") continue;
      const tb = this.byTool.get(String(b.tool_use_id ?? ""));
      if (!tb) continue;
      tb.status = b.is_error ? "error" : "done";
      if (!b.is_error) { const p = trunc(firstResultLine(b.content)); if (p) tb.preview = p; }
      if (tb.name === "Agent") tb.doneAt = this.now();          // collapse Agent on its top-level result
    }
  }
```

(e) `renderBlock` — special-case the Agent tool block (expanded while running, collapsed when done):

```ts
  private renderBlock(b: Block): RenderLine[] {
    if (b.kind === "text") return b.text ? b.text.split("\n").map((t) => ({ text: t })) : [];
    if (b.kind === "thinking")
      return b.collapsed ? [{ text: "✦ Thinking", dim: true }]
        : (b.text ? b.text.split("\n").map((t) => ({ text: t, dim: true })) : []);
    const label = b.target ? `${b.name} ${b.target}` : b.name;
    if (b.name === "Agent") {
      if (b.doneAt != null) { const s = Math.floor((b.doneAt - b.startedAt) / 1000); return [{ text: `⚙ ${label} ✓ (${b.toolCount ?? 0} tools · ${s}s)` }]; }
      return [{ text: `⚙ ${label}` }, ...(b.nested ?? [])];      // expanded while running
    }
    if (b.status === "error") return [{ text: `✗ ${label}`, color: "red" }];
    if (b.status === "done") return [{ text: `✓ ${label}${b.preview ? "  │ " + b.preview : ""}` }];
    if (this.ended) return [{ text: `· ${label}`, dim: true }];
    const s = Math.floor((this.now() - b.startedAt) / 1000);
    return [{ text: `⟳ ${label}${s >= 1 ? ` ${s}s` : ""}` }];
  }
```

(f) Add the `subagentActive` getter (any Agent block running, i.e. created but not yet collapsed):

```ts
  get subagentActive(): boolean { return [...this.byTool.values()].some((b) => b.name === "Agent" && b.doneAt == null); }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tui && npx vitest run test/liveTurn.test.ts && npm run typecheck`
Expected: PASS — nesting/collapse test + all prior tests; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add tui/src/liveTurn.ts tui/test/liveTurn.test.ts
git commit -m "feat(tui): liveTurn subagent nesting + collapse-on-done + subagentActive"
```

---

### Task 5: Inline Edit/Write diffs — `render.ts` `toolDiffLines` + `liveTurn`

**Files:** Modify `tui/src/render.ts`, `tui/test/render.test.ts`, `tui/src/liveTurn.ts`, `tui/test/liveTurn.test.ts`.

**Interfaces:**
- Produces: `export function toolDiffLines(name: string, input: Record<string, unknown>, cap?: number): RenderLine[]` in `render.ts` (header + capped `+`/`-` lines + dim `… N more lines`). `liveTurn` Edit/Write tool blocks render that diff inline (retain `input`).

- [ ] **Step 1: Write the failing tests** — append to `tui/test/render.test.ts`:

```ts
import { toolDiffLines } from "../src/render.js";
describe("toolDiffLines", () => {
  it("renders Edit + / - lines with a header", () => {
    expect(toolDiffLines("Edit", { file_path: "f.ts", old_string: "a", new_string: "b" })).toEqual([
      { text: "⚙ Edit f.ts" }, { text: "  - a", color: "red" }, { text: "  + b", color: "green" },
    ]);
  });
  it("caps long diffs and notes the remainder", () => {
    const new_string = Array.from({ length: 40 }, (_, i) => `line${i}`).join("\n");
    const out = toolDiffLines("Write", { file_path: "big.ts", content: new_string }, 24);
    expect(out[0]).toEqual({ text: "⚙ Write big.ts" });
    expect(out.filter((l) => l.text.startsWith("  +")).length).toBe(24);
    expect(out.at(-1)).toEqual({ text: "  … 16 more lines", dim: true });
  });
});
```

And append to `tui/test/liveTurn.test.ts`:

```ts
  it("renders an inline diff for an Edit tool (not just a one-line marker)", () => {
    const lt = new LiveTurn();
    lt.ingest(se({ type: "message_start" }));
    lt.ingest(se({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "e1", name: "Edit", input: {} } }));
    lt.ingest({ type: "assistant", message: { content: [{ type: "tool_use", id: "e1", name: "Edit", input: { file_path: "f.ts", old_string: "x", new_string: "y" } }] } });
    const out = texts(lt);
    expect(out).toContain("  - x");
    expect(out).toContain("  + y");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd tui && npx vitest run test/render.test.ts test/liveTurn.test.ts -t "diff|inline diff"`
Expected: FAIL — `toolDiffLines` not exported; liveTurn shows only `⟳ Edit f.ts`.

- [ ] **Step 3: Implement** —

`tui/src/render.ts`: add the exported, truncation-aware formatter (reuse the `path` helper already in the file):

```ts
/** Truncation-aware Edit/Write diff: header + capped +/- lines + a "… N more lines" note. Reused by liveTurn. */
export function toolDiffLines(name: string, input: Record<string, unknown>, cap = 24): RenderLine[] {
  const head: RenderLine = { text: `⚙ ${name} ${String(input.file_path ?? input.path ?? "")}` };
  const body: RenderLine[] = [];
  if (typeof input.old_string === "string") for (const l of input.old_string.split("\n")) body.push({ text: `  - ${l}`, color: "red" });
  const added = typeof input.new_string === "string" ? input.new_string : typeof input.content === "string" ? input.content : "";
  if (added) for (const l of added.split("\n")) body.push({ text: `  + ${l}`, color: "green" });
  if (body.length <= cap) return [head, ...body];
  return [head, ...body.slice(0, cap), { text: `  … ${body.length - cap} more lines`, dim: true }];
}
```

`tui/src/liveTurn.ts`: retain `input` on Edit/Write tool blocks and render the diff. Extend the tool Block with `input?: Record<string, unknown>`:

```ts
  | { kind: "tool"; index: number; id: string; name: string; target: string; status: "running" | "done" | "error"; preview?: string; startedAt: number; nested?: RenderLine[]; toolCount?: number; doneAt?: number; input?: Record<string, unknown> };
```

In `onAssistant`, when a tool_use's full input arrives, capture it for Edit/Write (alongside the existing `target` assignment). In the `else if (b?.type === "tool_use")` branch, after setting `ex.target`/creating `tb`:

```ts
      } else if (b?.type === "tool_use") {
        const id = String(b.id ?? ""); const ex = id ? this.byTool.get(id) : undefined;
        if (ex) { ex.name = String(b.name ?? ex.name); ex.target = toolTarget(ex.name, b.input ?? {}); if (ex.name === "Edit" || ex.name === "Write") ex.input = b.input ?? {}; }
        else {
          const nm = String(b.name ?? "");
          const tb: ToolBlock = { kind: "tool", index: i, id, name: nm, target: toolTarget(nm, b.input ?? {}), status: "running", startedAt: this.now(), input: (nm === "Edit" || nm === "Write") ? (b.input ?? {}) : undefined };
          this.current.push(tb); if (id) this.byTool.set(id, tb);
        }
      }
```

Import `toolDiffLines` and use it in `renderBlock` for Edit/Write tool blocks that have input (placed after the Agent branch, before the generic tool branches):

```ts
import { trunc, toolTarget, toolDiffLines } from "./render.js";
```
```ts
    if ((b.name === "Edit" || b.name === "Write") && b.input) {
      const head = b.status === "done" ? `✓ ${label}` : b.status === "error" ? `✗ ${label}` : this.ended ? `· ${label}` : `⟳ ${label}`;
      return [{ text: head, ...(b.status === "error" ? { color: "red" } : {}) }, ...toolDiffLines(b.name, b.input).slice(1)];   // diff body under the status header
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tui && npx vitest run test/render.test.ts test/liveTurn.test.ts && npm run typecheck`
Expected: PASS — diff units + inline-diff + all prior; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add tui/src/render.ts tui/test/render.test.ts tui/src/liveTurn.ts tui/test/liveTurn.test.ts
git commit -m "feat(tui): inline Edit/Write diffs — render.ts toolDiffLines reused by liveTurn"
```

---

### Task 6: Wire the task panel + subagentActive into `useChat`/`ChatApp`/`chat.tsx`

**Files:** Modify `tui/src/useChat.ts`, `tui/src/ChatApp.tsx`, `tui/src/chat.tsx`, `tui/test/useChat.test.tsx`.

**Interfaces:**
- Consumes: `TaskList` (T1), `TaskItem` (T1), `TaskPanel` (T2), `subagentActive` (T4).
- Produces: `ChatState` += `tasks: TaskItem[]`, `subagentActive: boolean`. `ChatApp` renders `<TaskPanel>` pinned. `chat.tsx` sets `forwardSubagentText:true`.

- [ ] **Step 1: Write the failing test** — append to `tui/test/useChat.test.tsx` (the file's `Host` prints state; add a task-driving turn). Add a `CmdHost`-style host capturing state, or extend an existing one — use a fresh host that submits a turn whose `onMessage` emits task ops:

```tsx
  it("accumulates tasks from a turn's frames and exposes them in state", async () => {
    const fake = fakeSession({ async submit(_p: string, onMessage: (m: unknown) => void) {
      onMessage({ type: "assistant", message: { content: [{ type: "tool_use", id: "tc1", name: "TaskCreate", input: { subject: "build it" } }] } });
      onMessage({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tc1", content: "Task #1 created successfully: build it" }] } });
      return { result: "done" };
    } });
    let tasks: any[] = [];
    function TaskHost() {
      const c = useChat(() => fake, createUiBroker());
      tasks = (c.state as any).tasks;
      (TaskHost as any).run = c.submit;
      return <Text>{tasks.map((t) => t.subject).join("|")}</Text>;
    }
    const { lastFrame } = render(<TaskHost />);
    await new Promise((r) => setTimeout(r, 20));
    (TaskHost as any).run("go");
    await waitFor(() => frame(lastFrame).includes("build it"));
    expect(tasks).toEqual([{ id: "1", subject: "build it", status: "pending" }]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tui && npx vitest run test/useChat.test.tsx -t "accumulates tasks"`
Expected: FAIL — `state.tasks` undefined.

- [ ] **Step 3: Implement** — `tui/src/useChat.ts`:

(a) Imports + state:

```ts
import { TaskList, type TaskItem } from "./taskList.js";
```
```ts
  const taskListRef = useRef(new TaskList());
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [subagentActive, setSubagentActive] = useState(false);
```

(b) `ChatState` gains the two fields:

```ts
export interface ChatState { lines: RenderLine[]; streaming: RenderLine[]; pending: Pending | null; mode: string; busy: boolean; ctxPct?: number; model?: string; picker: { open: boolean; sessions: SessionInfo[] }; tasks: TaskItem[]; subagentActive: boolean; }
```

(c) Feed every frame to the persistent `TaskList` and surface `subagentActive` inside `submit`'s `onMessage` (extend the existing handler):

```ts
    session.submit(prompt, (m) => { if (disposed.current) return; lt.ingest(m); taskListRef.current.ingest(m); setStreaming(lt.snapshot()); setTasks(taskListRef.current.snapshot()); setSubagentActive(lt.subagentActive); })
      .then(() => {}, (e) => { lt.fail((e as Error).message); })
      .finally(() => { if (disposed.current) return; setLines((l) => [...l, ...lt.finalize()]); setStreaming([]); setBusy(false); setSubagentActive(false); if (lt.model) setModel(lt.model); void refreshCtx(); });
```

(d) Reset tasks on the `/resume` swap — in `pickSession`, after `setSession(...)`:

```ts
    taskListRef.current.reset(); setTasks([]);
```

(e) Add `tasks` + `subagentActive` to the returned state object:

```ts
  return { state: { lines, streaming, pending, mode, busy, ctxPct, model, picker, tasks, subagentActive } as ChatState, submit, resolvePermission, cycleMode, interrupt, closePicker, pickSession };
```

`tui/src/ChatApp.tsx`: import + render `<TaskPanel>` pinned between the Transcript and the composer/dialog region:

```tsx
import { TaskPanel } from "./TaskPanel.js";
```
```tsx
      <Transcript lines={state.lines} streaming={state.streaming} />
      <TaskPanel tasks={state.tasks} />
      {state.picker.open
        ? <SessionPicker sessions={state.picker.sessions} onPick={pickSession} onCancel={closePicker} />
        : state.pending
          ? <PermissionDialog req={state.pending.req} onDecision={resolvePermission} />
          : <Composer onSubmit={submit} />}
```

`tui/src/chat.tsx`: add the flag to the `base` config:

```tsx
const base = { model: flag("--model"), cwd: flag("--cwd") ?? process.cwd(), permissionMode: "default" as const, permissionBroker: ui.broker, contextTool: true, includePartialMessages: true, forwardSubagentText: true };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tui && npx vitest run test/useChat.test.tsx test/chat.test.tsx && npm run typecheck`
Expected: PASS — the task-accumulation test + all existing useChat/chat tests; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add tui/src/useChat.ts tui/src/ChatApp.tsx tui/src/chat.tsx tui/test/useChat.test.tsx
git commit -m "feat(tui): wire TaskPanel + subagentActive + forwardSubagentText into the chat REPL"
```

---

### Task 7: `ChatStatusBar` — display-G subagent indicator

**Files:** Modify `tui/src/ChatStatusBar.tsx`, `tui/src/ChatApp.tsx`, `tui/test/components.test.tsx`.

**Interfaces:**
- Consumes: `subagentActive` (Task 6).
- Produces: `ChatStatusBar` prop `subagentActive?: boolean` → renders `⚙ subagent running`.

- [ ] **Step 1: Write the failing test** — append to `tui/test/components.test.tsx`'s `<ChatStatusBar>` describe:

```tsx
  it("shows a subagent-running indicator", () => {
    const { lastFrame } = render(<ChatStatusBar mode="default" busy={true} ctxPct={10} hasPending={false} subagentActive={true} />);
    expect(lastFrame() ?? "").toContain("⚙ subagent running");
  });
  it("hides the subagent indicator when inactive", () => {
    const { lastFrame } = render(<ChatStatusBar mode="default" busy={true} ctxPct={10} hasPending={false} subagentActive={false} />);
    expect(lastFrame() ?? "").not.toContain("subagent running");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tui && npx vitest run test/components.test.tsx -t "subagent"`
Expected: FAIL — no `subagentActive` prop / no indicator.

- [ ] **Step 3: Implement** — `tui/src/ChatStatusBar.tsx`:

```tsx
export function ChatStatusBar({ model, mode, busy, ctxPct, hasPending, subagentActive }: { model?: string; mode: string; busy: boolean; ctxPct?: number; hasPending: boolean; subagentActive?: boolean }) {
  return (
    <Box>
      {model ? <Text>model <Text color="cyan">{model}</Text>{"  "}</Text> : null}
      <Text>mode </Text><Text color={mode === "bypassPermissions" ? "red" : "green"}>{mode}</Text>
      <Text>{ctxPct != null ? `  ctx ${ctxPct}%` : ""}</Text>
      <Text>{busy ? "  ⟳ streaming" : ""}</Text>
      <Text>{subagentActive ? "  ⚙ subagent running" : ""}</Text>
      <Text dimColor>{hasPending ? "   [a/A/d]" : "   Tab mode · Esc interrupt"}</Text>
    </Box>
  );
}
```

`tui/src/ChatApp.tsx`: pass the prop:

```tsx
      <ChatStatusBar model={state.model} mode={state.mode} busy={state.busy} ctxPct={state.ctxPct} hasPending={!!state.pending} subagentActive={state.subagentActive} />
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tui && npx vitest run test/components.test.tsx test/chat.test.tsx && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add tui/src/ChatStatusBar.tsx tui/src/ChatApp.tsx tui/test/components.test.tsx
git commit -m "feat(tui): status bar subagent-running indicator (display-G)"
```

---

### Task 8: Gated live e2e — Agent nesting + task

**Files:** Create `tui/test/live/chat-rich.e2e.test.ts`.

- [ ] **Step 1: Write the test** — create `tui/test/live/chat-rich.e2e.test.ts`:

```ts
// tui/test/live/chat-rich.e2e.test.ts — gated: a real Agent subagent nests+collapses; a task lands in the reducer.
import { describe, it, expect } from "vitest";
import { openSession } from "cc-harness";
import { LiveTurn } from "../../src/liveTurn.js";
import { TaskList } from "../../src/taskList.js";

const live = process.env.ANTHROPIC_API_KEY ? describe : describe.skip;

live("chat rich rendering (live)", () => {
  it("nests a subagent and reduces a task", async () => {
    const session = openSession({ permissionMode: "bypassPermissions", includePartialMessages: true, forwardSubagentText: true });
    const lt = new LiveTurn(); const tl = new TaskList();
    try {
      await session.submit(
        "Do two things: (1) TaskCreate a task 'demo task'. (2) Use the Task tool to launch a general-purpose subagent that runs the bash command `echo nested-ok` and reports it. Then say done.",
        (m) => { lt.ingest(m); tl.ingest(m); },
      );
      const lines = lt.finalize().map((l) => l.text).join("\n");
      expect(lines).toMatch(/⚙ Agent/);                       // a subagent block rendered
      expect(tl.snapshot().length).toBeGreaterThanOrEqual(1); // a task was reduced
    } finally {
      await session.dispose();
    }
  }, 90_000);
});
```

- [ ] **Step 2: Run keyless to confirm clean skip**

Run: `cd tui && npx vitest run test/live/chat-rich.e2e.test.ts`
Expected: **SKIPPED** (no key). (Implementer stops here; the controller runs the keyed pass.)

- [ ] **Step 3: (controller) Run keyed**

Run: `cd tui && set -a; . ../.env; set +a; npx vitest run test/live/chat-rich.e2e.test.ts`
Expected: PASS (~20–60 s) — an `⚙ Agent` block rendered and ≥1 task reduced.

- [ ] **Step 4: Commit**

```bash
git add tui/test/live/chat-rich.e2e.test.ts
git commit -m "test(tui): gated live e2e — subagent nesting + task reduction"
```

---

### Task 9: Refresh coverage scorecard + memory

**Files:** Modify `docs/parity/coverage.md`; memory (controller-handled).

- [ ] **Step 1: Full keyless gate**

Run: `cd tui && npm run typecheck && npx vitest run`
Expected: typecheck clean; all keyless suites pass (live suites skip).

- [ ] **Step 2: Update `docs/parity/coverage.md`** — in the Domain 10 row (line ~142), change the Realized cell `~42%¹` → `~46%¹` (preserve the `¹` footnote), and insert this sentence verbatim **immediately before** the closing `Remote/voice remain 🚫/non-goal **by design**` clause (after the increment-6 sentence ending `2026-06-19-chat-slash-commands`):

```
**Phase-3 increment 7 SHIPPED — rich tool rendering + display-G** (`cc-harness-chat`): subagent (`Agent`) turns nest under their parent via `parent_tool_use_id` and collapse-on-done (`⚙ Agent … ✓ (N tools · Ts)`); a pinned `TaskPanel` live-reduces native `TaskCreate`/`TaskUpdate` ops (probe 22b: the SDK has no `TodoWrite`); inline Edit/Write diffs; a status-bar subagent indicator. Two pure reducers (`liveTurn` extended, new `taskList`) + a clock injection; one flag (`forwardSubagentText`, already plumbed) — no harness change. Probes 22/22b verified nesting reachable headless; spec/plan `2026-06-19-chat-rich-tool-rendering`.
```

Keep the row a single line (no line break inside the table cell).

- [ ] **Step 3: Commit**

```bash
git add docs/parity/coverage.md
git commit -m "docs(parity): record increment-7 rich tool rendering (Domain 10)"
```

(Memory files live outside the repo — the controller writes them, not a git commit.)

---

## Self-Review

**1. Spec coverage** — every spec section maps to a task: `taskList` reducer → T1; `TaskPanel` → T2; clock+elapsed → T3; subagent nesting + collapse + `subagentActive` → T4; inline Edit/Write diffs (`toolDiffLines` reused) → T5; `useChat`/`ChatApp`/`chat.tsx` wiring + `forwardSubagentText` + `/resume` reset → T6; status-bar display-G → T7; gated live e2e → T8; docs → T9.

**2. Placeholder scan** — no TBD/TODO; every code step shows complete code; every command has an expected result.

**3. Type consistency** — `TaskItem {id,subject,status}` and `TaskStatus` identical across T1/T2/T6; `new LiveTurn(now?)` matches T3↔T4↔T5↔T8; the tool `Block` variant accretes fields across T3 (`startedAt`), T4 (`nested/toolCount/doneAt`), T5 (`input`) — each task's literal includes the prior fields; `subagentActive` getter (T4) ↔ state field (T6) ↔ status-bar prop (T7); `toolDiffLines(name,input,cap?)` (T5) reused by liveTurn (T5) and tested (T5). `ChatState` additions (`tasks`, `subagentActive`) are consumed by `ChatApp` (T6) + status bar (T7).

**Out-of-scope held:** input ergonomics (E → incr 8), multi-level subagent trees, bespoke rendering of every native tool, TaskList-result-driven resync, nested partial streaming, task interaction — all per the spec.
