# Increment 7 — Rich tool rendering + display-G (`cc-harness-chat`)

**Status:** approved design (brainstorm complete) · 2026-06-19
**Topic:** make the chat REPL *show its work* like real Claude Code — nested subagent transcripts, a pinned
task checklist, polished file diffs, and status affordances — all driven off frames the SDK already emits.

## Product framing

`cc-harness` (the lib) is the **backend engine**; the program's north star is **interactive Claude Code
reproduction** (an interactive agent + daemon, not a headless service). This is **increment 7** of the
Phase-3 interactive track (after: 1 `top` · 2 console · 3 chat REPL · 4 daemon permissions · 5 live
streaming · 6 slash commands). It delivers runway item **D (rich tool rendering)** with **display-side G
(status affordances)** folded in. Runway item **E (input ergonomics)** is the next increment (8).

The dividend of the engine-first architecture holds again: every datum here is **already in the message
stream** — subagent turns (`parent_tool_use_id`), native task ops (`TaskCreate`/`TaskUpdate`), tool inputs.
This increment is a *rendering* layer over them, not new engine capability.

## Goal

When the agent spawns a subagent, edits a file, or tracks a task list, the REPL renders it the way real CC
does: the subagent's tools + reasoning nested under an `Agent` header (collapsing to a one-line summary when
it finishes), file diffs with sane truncation, and a **pinned task panel** above the composer that
live-updates as tasks are created and checked off — plus a status bar that shows when a subagent is running
and how to interrupt.

## Probe-verified premises (A1 live-probe-first — the grounding that set the design)

**Probe 22** (`probes/probes/22-subagent-nesting-todowrite.ts`, model `claude-sonnet-4-6`, real `Agent`
subagent + `includePartialMessages`) established the subagent-nesting wire reality:

- **The native subagent tool is `Agent`** (not `Task`). Its inner turns surface as **full `assistant`/`user`
  messages tagged `parent_tool_use_id` = the `Agent` tool_use id**. The sequence: `assistant tool_use:Agent#X`
  (top-level) → `user ptid=X text(<subagent prompt>)` → `assistant ptid=X tool_use:Bash` → `user ptid=X
  tool_result` → `assistant ptid=X text(<subagent answer>)` → `user ptid=— tool_result→X` (the top-level
  `Agent` result that closes the nest).
- **`forwardSubagentText:true` forwards the subagent's text/thinking** (Pass A: 4 nested messages including
  text); **default (false) forwards tool-only** (Pass B: 3 nested, the subagent's final text is omitted). The
  SDK doc is accurate: default is a heartbeat, `true` is a renderable nested transcript. **It works headless.**
- **DECISIVE for the live layer: every partial `stream_event` frame is top-level** (`{"top":110}`, zero
  nested). Nested subagent content arrives **only as whole messages** with `parent_tool_use_id` — never as
  token deltas. So the nested region renders as *committed indented blocks*, with **no live-token edge cases**.

**Probe 22b** (`probes/probes/22b-native-task-tools-shape.ts`) flipped the "TodoWrite" premise:

- **There is no `TodoWrite`** (the model said verbatim "TodoWrite isn't in my available tools"). The SDK tracks
  tasks via **incremental native ops**: `TaskCreate {subject, description}` → result `"Task #N created
  successfully: <subject>"`; `TaskUpdate {taskId, status}` → `"Updated task #N status"`; `TaskList {}` →
  `"#1 [in_progress] build the parser\n#2 [pending] write tests"`.
- **The task id comes from the `TaskCreate` *result*, not its input** → a checklist must pair each
  `TaskCreate` tool_use with its tool_result to learn the id, then apply `TaskUpdate {taskId, status}` by id.
  A checklist is therefore a **reducer over the op stream**, not a single-array render.

## Locked decisions

- **Subagent nesting = full + collapse-on-done.** `forwardSubagentText:true`. While an `Agent` runs, show its
  tools + reasoning indented under an `⚙ Agent <target>` header; when its top-level `tool_result` arrives,
  **collapse to one line**: `⚙ Agent <target> ✓ (N tools · Ts)`.
- **Task checklist = pinned panel.** A persistent bordered box **above the composer** (`☐` pending / `▶`
  in_progress / `☑` completed), live-reduced from `TaskCreate`/`TaskUpdate`. Hidden when no tasks exist.
- **Edit/Write diffs = render inline (net-new in the live region).** Today `liveTurn` shows only a one-line
  marker (`✓ Edit <path> │ preview`); the `+`/`-` diff formatter (`render.ts` `toolUseLines`/`renderMessage`)
  is **legacy/test-only — NOT in the REPL path** (confirmed: only `render.test.ts` + an old incr-3 e2e call
  it). Incr 7 makes `liveTurn` render the **truncated diff inline** for `Edit`/`Write` (first ~24 changed
  lines, then a dim `… N more lines`), reusing a truncation-aware formatter exported from `render.ts`. Every
  other tool keeps the compact one-line marker.
- **display-G affordances:** status bar shows `⚙ subagent running` while an `Agent` is active and an `esc to
  interrupt` hint while busy; the live running-tool marker shows elapsed (`⟳ Bash … 3s`).
- **`forwardSubagentText:true` set in `chat.tsx`** (already plumbed: `config/types.ts:18` →
  `resolveOptions.ts:44`). **No harness source change, no rebuild** — all work in `tui/`.
- **Clock is injected** into the pure reducer (`now: () => number`, real in prod / fake in tests) so elapsed
  time and the collapse summary stay testable. `liveTurn` stays a pure reducer.
- **Task panel lifetime:** session-persistent (tasks span turns). **Persists across `/clear`** (display-only),
  **resets on `/resume`** session swap.

## Architecture

Two pure reducers (one extended, one new) + one new pinned component, over the existing incr-5 render seam.
Slash/permission/streaming behavior is unchanged.

```
session.onMessage(frame)
   ├─ LiveTurn.ingest(frame)              (per-turn; existing — now nesting-aware; clock injected at construction)
   │     • top-level (ptid=null) → stream as today
   │     • nested (ptid=Agent id) → attach as committed indented block under that Agent
   │     • Agent tool_result → collapse Agent block to "⚙ Agent <t> ✓ (N tools · Ts)"
   │     • exposes subagentActive (an Agent block is running)
   └─ TaskList.ingest(frame)              (session-persistent; NEW)
         • TaskCreate tool_use → pending{tool_use_id, subject};  result "Task #N" → {id:N, subject, pending}
         • TaskUpdate tool_use {taskId,status} → apply by id
         → snapshot(): {id, subject, status}[]  → <TaskPanel> (pinned above composer)
```

## Components

### `tui/src/taskList.ts` (create — pure, no React/SDK side effects)
```ts
export type TaskStatus = "pending" | "in_progress" | "completed";
export interface TaskItem { id: string; subject: string; status: TaskStatus }
export class TaskList {
  ingest(m: unknown): void;        // TaskCreate/TaskUpdate/TaskList tool_use + tool_result
  snapshot(): TaskItem[];          // sorted by numeric id
  reset(): void;
}
```
Reduces native task ops. `TaskCreate` tool_use is held as pending keyed by its `tool_use_id`; the matching
`tool_result` ("Task #N created successfully: <subject>") resolves the id. `TaskUpdate {taskId, status}`
applies on the tool_use (input already carries id + status). `TaskList` results may resync but are not
required. Unknown/partial frames are ignored.

### `tui/src/TaskPanel.tsx` (create — presentational)
Props `{ tasks: TaskItem[] }`. A bordered `Tasks` box; one line per task `<glyph> <subject>` with
`☐`/`▶`/`☑` by status; renders **nothing** when `tasks` is empty.

### `tui/src/liveTurn.ts` (modify — nesting + collapse + clock)
- Constructor gains an optional injected clock: `new LiveTurn(now: () => number = Date.now)`.
- `ingest(m)` now routes a full `assistant`/`user` message with `parent_tool_use_id` to the matching
  **Agent block** (keyed by the `Agent` tool_use id) as committed indented lines; the top-level
  `tool_result` for that id **closes + collapses** the block to `⚙ Agent <target> ✓ (N tools · Ts)` (elapsed
  from the clock between the `Agent` tool_use and its result). While open, the block renders its header +
  indented nested lines.
- New getter `subagentActive: boolean` (any Agent block open).
- The live running-tool marker shows elapsed (`⟳ <tool> <target> Ns`).
- **`Edit`/`Write` tool blocks retain their `input`** (captured in `onAssistant`, where `target` is already
  derived); `renderBlock` emits the **inline truncated diff** (via `render.ts`'s exported `toolDiffLines`)
  for those two tools, and the existing compact one-line marker for every other tool.
- Existing top-level streaming, thinking-collapse, tool ⟳→✓/✗, dedup, `finalize()`/`fail()`/`model` unchanged.

### `tui/src/render.ts` (modify — export a truncation-aware diff formatter)
Extract the `Edit`/`Write` `+`/`-` formatting into an **exported, truncation-aware** helper
`toolDiffLines(name, input, cap = 24): RenderLine[]` — header + capped `+`/`-` lines + a dim `  … N more
lines` when truncated — so **`liveTurn` reuses it** for the live region (DRY; the diff logic lives in one
place). The legacy `renderMessage`/`toolUseLines` remain for `render.test.ts` but are **not** the REPL's
render path.

### `tui/src/useChat.ts` (modify)
- Hold a **session-persistent** `TaskList` (a ref) + `tasks: TaskItem[]` state; feed **every** `onMessage`
  to it during a turn and `setTasks(taskList.snapshot())` (disposed-guarded).
- Build each turn's `LiveTurn` with the real clock; surface `subagentActive` (from the live turn) into state.
- `ChatState` gains `tasks: TaskItem[]` and `subagentActive: boolean`.
- `pickSession` (the `/resume` swap) also calls `taskList.reset()` + `setTasks([])`. `/clear` does **not**
  touch tasks.

### `tui/src/ChatApp.tsx` (modify)
Render `<TaskPanel tasks={state.tasks} />` **pinned between the Transcript and the composer/dialog region**
(it is not part of scrollback). No input-gating change.

### `tui/src/ChatStatusBar.tsx` (modify)
Add `⚙ subagent running` when `state.subagentActive`, and an `esc to interrupt` hint while `busy`. Existing
model · mode · ctx% · `⟳ streaming` segments unchanged.

### `tui/src/chat.tsx` (modify)
Add `forwardSubagentText: true` to the `openSession` base config (one field).

## Error handling
- Nested content is whole-messages (probe-proven) → committed indented blocks, **no live-token edge cases**.
- A `TaskCreate` whose result hasn't arrived renders its subject with a provisional id; the id resolves when
  the result lands. A `TaskUpdate` for an unknown id is ignored (no crash).
- **Multi-level** subagent trees (an Agent spawning an Agent — rare) degrade to *flat-under-nearest-parent*
  rather than erroring; deep recursion is out of scope.
- All new `setState` is disposed-guarded (the teardown discipline from incr 6 stands).

## Testing
- **`taskList.test.ts` (keyless):** drive the reducer with probe-22b-shaped frames — two `TaskCreate`
  tool_use + their `"Task #N created"` results + a `TaskUpdate` → assert snapshot `[{1,"build the parser",
  in_progress},{2,"write tests",pending}]`; unknown-id update is a no-op; `reset()` empties.
- **`liveTurn` nesting tests (keyless):** feed probe-22-shaped frames (Agent tool_use → nested ptid messages →
  Agent tool_result) with a **fake clock** → assert the block renders expanded-while-running (indented nested
  lines) then collapses to `⚙ Agent … ✓ (N tools · Ts)`; `subagentActive` flips true→false.
- **diff-rendering tests (keyless):** `render.ts`'s `toolDiffLines` truncates a >24-line Edit (cap + `… N
  more lines`); a `liveTurn` test feeds an `Edit` tool_use and asserts the **inline diff** appears in the
  snapshot (not merely a one-line marker).
- **`TaskPanel` + `ChatStatusBar` component tests (keyless):** TaskPanel renders glyphs per status and nothing
  when empty; status bar shows `subagent running` + `esc to interrupt` under the right state. (ink `useInput`
  passive-effect timing discipline applies to any keyed component test.)
- **One gated live e2e** (`tui/test/live/`, `ANTHROPIC_API_KEY`): a real `openSession` with
  `forwardSubagentText:true`; submit a prompt that spawns an `Agent` subagent **and** creates a task; assert
  the transcript shows a nested-then-collapsed `Agent` block and the task reducer reflects ≥1 task. `try/
  finally` teardown. `describe.skip` without a key.

## Out of scope (explicit)
- **Input ergonomics (E)** — multiline, history, `@`-mentions → increment 8.
- **Multi-level subagent trees** beyond graceful flat-degradation.
- **Bespoke rendering of every native tool** — only `Agent`, `Edit`, `Write` (and the existing `Bash`/`Read`)
  get special treatment; the rest keep the generic `⚙ name(arg)` marker.
- **TaskList-result-driven resync** as the primary source — the reducer is op-driven; `TaskList` results are
  at most a confirmation, not required.
- Rendering subagent partial **token streaming** (the SDK doesn't forward nested partials — proven by probe 22).
- A `/tasks` command or task interaction (the panel is read-only display).

## Global constraints (verbatim)
- **NO Prettier — dense hand-style;** match surrounding compact lines.
- **ESM `.js` import specifiers** in `tui/` (`from "./taskList.js"`); bare `"cc-harness"` for engine imports.
- **ink `useInput` passive-effect timing discipline** in component/app tests; **never** raw `stdin.on`;
  **never** mutate shared components. **Run test files sequentially** (the incr-6 `vitest.config.ts`
  `fileParallelism:false` stands).
- **Keep modules small/focused:** the two pure reducers (`liveTurn`, `taskList`) + presentational
  `TaskPanel` exist precisely to keep `useChat`/`ChatApp` lean; `liveTurn` stays clock-injected and pure.
- **No new `cc-harness` public exports** (all work in `tui/`, `forwardSubagentText` already exposed) → no
  API-STABILITY / index.test pin, **no harness rebuild**.
- **Live tests gate** on `ANTHROPIC_API_KEY` from `CC-to-SDK/.env` (never committed/printed); keyless suites
  skip cleanly.
