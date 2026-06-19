# Session Resume / Continue (Increment 9 · runway F) — Design

**Status:** approved-in-principle (brainstorm answers locked); pending spec review → plan.
**Feature:** make `cc-harness-chat` resume a prior session *and show the conversation you're rejoining* — launch-time `--resume <id>` / `--continue`, a `/continue` slash command, and full-fidelity transcript replay — so resume feels like real Claude Code instead of swapping context into a blank screen.

## 1. Why / the gap

Increment 6 shipped `/resume`: a `SessionPicker` modal lists sessions and `useChat` swaps the live session to the picked id (factory-owned `makeSession(resume)` → `setSession`, the `[session]` effect disposes the old). The SDK context **is** resumed — but the UI shows only a one-line `formatResumed(...)` header; **the prior messages are never rendered**, so you resume into a blank screen. There is also no launch-time resume (the bin always starts fresh) and no one-keystroke "continue most-recent".

Increment 9 closes that gap on three converging entry points, reusing the existing renderer.

## 2. Scope (locked via brainstorm)

**In:**
- **Transcript replay on resume** — render the prior conversation via `getSessionMessages`, full-fidelity, reusing `render.ts`.
- **Launch flags** — `--resume <id>` and `--continue` (alias `-c`, most-recent).
- **`/continue`** slash command — resume the most-recent session, no picker.

**Out (deferred / non-goal):**
- Richer `SessionPicker` rows (timestamp / first-prompt preview / ctx%) — the bare-ID picker from incr-6 stays.
- Session search, rename/tag/delete UI, a custom on-disk session store, a `/more` reveal of elided history.

## 3. A1 grounding (probe 23 — `probes/probes/23-resume-transcript-shape.ts`, committed `1fd41dd0`)

Run live (keyed). All three load-bearing premises are GREEN:

1. **`getSessionMessages(id,{dir}) → SessionMessage[]` is the LIVE message shape** — each element is `{ type:"user"|"assistant", uuid, session_id, message:{ role, content:[blocks] }, parent_tool_use_id, timestamp }`, including `tool_use` (assistant) and `tool_result` (a `type:"user"` message) round-trips and `parent_tool_use_id` (subagent nesting preserved). This is exactly what `render.ts` already consumes → **`renderMessage` can render the persisted transcript directly**; full-fidelity replay is feasible and DRY. (Redacted `thinking` blocks arrive with empty `thinking:""` + a signature → render as nothing.)
2. **`listSessions({dir,limit}) → SDKSessionInfo[]`** carries `{ sessionId, summary, firstPrompt, lastModified, createdAt, fileSize, customTitle, gitBranch, cwd, tag }`. "Most-recent" = **`max(lastModified)`** — we sort ourselves rather than trust SDK ordering.
3. **Resume keeps the same `session_id`** (the resumed query's init reports the original id) → a stable id to `getSessionMessages` against, and recall works.

The SDK persists transcripts to `~/.claude/projects` scoped by `dir`(=`cwd`), so resume already survives process restarts; **no storage to build**.

## 4. Architecture & module boundaries

One cohesive flow — *swap to a resumed session, then render its history* — every entry point converging on a single `resumeInto(id)`. Each unit has one job and a clean interface:

| Unit | Kind | Responsibility / interface |
|---|---|---|
| `tui/src/render.ts` `renderMessage` | **modify** | Promote the legacy/test-only `renderMessage(m): RenderLine[]` to the production replay renderer for the persisted shape: text → lines; assistant `tool_use` → a `⚙ <toolTarget>` marker + (for Edit/Write) inline diff **via the shared `toolDiffLines`** (resolving the incr-7 carried `diffBody` dup); **`tool_result` messages are SKIPPED entirely** (the `⚙` marker already conveys the action — matches live, which never dumps result bodies); `thinking` empty → skipped; a message whose `parent_tool_use_id` is set renders with a **simple one-level dim indent** (a nested subagent line — NOT the live `⚙ Agent … ✓ (N tools)` collapse, which is live-only machinery). No behavior change to live rendering (live uses `liveTurn`; `renderMessage` was unused in prod). |
| `tui/src/replay.ts` | **new, PURE** | `replayLines(messages: SessionMessage[], opts?: { cap?: number; id?: string }): RenderLine[]` — a header divider `─── resumed: <first-prompt-trunc> · N turns · <hh:mm> ───`, then `renderMessage` per kept message, a `… K earlier messages elided` marker when truncated, and a closing `─── resumed here · live ───` divider. **Cap = last `cap` (default 200) messages.** **Everything in the header is derived from the messages themselves** — label = first `type:"user"` message's text (truncated); time = the last message's `timestamp` formatted `hh:mm`; turns = count of `type:"user"` non-`tool_result` messages — so the function stays pure with NO injected clock and NO extra fetch (timestamps live in the data). `opts.id` is an optional short-id shown when no user-text label exists. No React/Ink/SDK imports. |
| `tui/src/commands.ts` | **modify** | Add `/continue` to the `COMMANDS` table (+ `/continue` parse) and a pure `pickMostRecent(sessions: SessionInfo[]): string \| undefined` = the `sessionId` of `max(lastModified)`. |
| `tui/src/useChat.ts` | **modify** | Inject `getSessionMessages` into `deps` (defaults to the real `cc-harness` reader, scoped by `cwd`). A single internal `resumeInto(id: string)`: fetch `getSessionMessages(id,{cwd})` **first** — empty/throws → a `⚠ couldn't resume …` notice and **no swap**; else `setSession(makeSession(id))` (existing `[session]` effect disposes the old) and `setLines(replayLines(msgs,{id}))`. Wire `/resume` (picker → `resumeInto`), `/continue` (`pickMostRecent(await listSessions({cwd}))` → `resumeInto`, or a `No sessions to continue` notice), and an `initialResume` intent resolved in a mount effect. Thread `cwd` (already on `ChatApp` since incr-8). |
| `tui/src/chat.tsx` | **modify** | Parse `--resume <id>` and `--continue`/`-c` into an `initialResume` intent (`{ kind:"id", id } \| { kind:"continue" } \| undefined`) passed via `ChatApp`. Bin stays synchronous; the async most-recent resolution happens in `useChat`'s mount effect. |
| `tui/src/ChatApp.tsx` | **modify** | Thread the `initialResume` prop through to `useChat`. |

## 5. Data flow — three paths, one `resumeInto`

- **Launch** `--resume <id>` → intent `{kind:"id",id}`; **`--continue`/`-c`** → `{kind:"continue"}`. `useChat` mount effect: `continue` → `pickMostRecent(await listSessions({cwd}))` (none → notice); `id` → directly; then `resumeInto`.
- **Mid-session** `/resume` (incr-6 picker, unchanged) → on pick, `resumeInto(info.sessionId)`; new **`/continue`** → resolve most-recent → `resumeInto`.
- **`resumeInto(id)`** (the one chokepoint): `getSessionMessages(id,{cwd})` → non-empty: swap session + `setLines(replayLines(...))`; empty/throws: notice, stay put. Live turns then append below the `resumed here · live` divider via the existing `liveTurn.finalize()` path (unchanged).

All `setLines`/`setSession` calls stay inside the existing `disposed`-guard discipline; the `[session]`-keyed disposal effect (incr-6) already disposes the previous session on swap — `resumeInto` does not touch teardown.

## 6. Error handling & guards

- **Bad `--resume` id / wrong-cwd / deleted session** → `getSessionMessages` returns `[]` (or throws, caught) → `⚠ couldn't resume <id> — starting fresh` notice, no swap (never drop into a broken resumed session).
- **`/continue` / `--continue` with no sessions in cwd** → `No sessions to continue here` notice, stay on the current/fresh session.
- **Huge history** → replay caps at the last 200 messages with a `… K earlier messages elided` marker.

## 7. Testing

- **`replay.test.ts`** (pure, fixtures from probe-23 captured shapes): header divider with the derived label (first prompt, truncated) + `hh:mm` from the last message timestamp + turn count; user prompt line; assistant text; `⚙` tool marker; inline Edit diff (via `toolDiffLines`); `tool_result` message skipped; nested-by-`parent_tool_use_id` dim indent; empty-thinking skipped; cap + elision marker; closing live divider.
- **`render.test.ts`** (extend): `renderMessage` on the persisted shape renders text/tool/diff and delegates diffs to `toolDiffLines` (consistency, dup resolved).
- **`useChat` test** (fake `getSessionMessages` + `listSessions`): each path (`initialResume` id, `/continue`, `/resume` pick) seeds the transcript with replay lines; empty fetch → notice + no swap; `/continue` no-sessions → notice.
- **`commands.test`**: `/continue` parses; `pickMostRecent` returns the `max(lastModified)` id.
- **`chat` flag parsing**: `--resume <id>` / `--continue` / `-c` → the correct `initialResume` intent.
- **Gated live e2e** (`ANTHROPIC_API_KEY`): create a real session (openSession → submit → dispose), then real `getSessionMessages` + `replayLines` → assert the prior prompt text appears in the rendered lines (proves the real persisted-shape → replay pipeline end-to-end). Skips cleanly keyless.

## 8. Global constraints

- Pure units (`replay.ts`, `pickMostRecent`) take no React/Ink/SDK deps; the SDK reads are injected into `useChat.deps`.
- NO Prettier (dense hand-style); ESM `.js` import specifiers; bare `"cc-harness"` for engine imports.
- Never mutate the shared console `Composer.tsx`/`App.tsx`. No new `cc-harness` public exports (`getSessionMessages`/`listSessions` are already exported) → no API-STABILITY/index pin, no harness rebuild.
- `ink useInput` timing discipline (await a render tick before keys; real escape sequences; never raw `stdin.on`; latest-ref where a handler reads state). Test files run sequentially (`vitest fileParallelism:false`).
- Live tests gate on `ANTHROPIC_API_KEY` from `CC-to-SDK/.env` (gitignored — never commit/print); keyless suites skip cleanly.
- Commit messages plain — no `Co-Authored-By` / attribution.
