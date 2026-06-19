# Session Resume / Continue (Increment 9) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `cc-harness-chat` resume a prior session *and render the conversation you're rejoining* — full-fidelity transcript replay, launch `--resume <id>`/`--continue` flags, and a `/continue` command — instead of swapping context into a blank screen.

**Architecture:** A pure `replay.ts` turns a resumed session's persisted messages into transcript lines by reusing `render.ts`'s `renderMessage` (promoted to also render user prompts and to delegate Edit/Write diffs to the shared `toolDiffLines`). All entry points — launch flags, `/continue`, and the incr-6 `/resume` picker — converge on one `resumeInto(id)` in `useChat` that fetches `getSessionMessages` first (empty → notice, no swap), else swaps the session and seeds the transcript with the replay.

**Tech Stack:** TypeScript, React 18, Ink 5, Vitest 2, ink-testing-library 4. Package `cc-harness-tui` (`CC-to-SDK/tui/`), engine `cc-harness` (`file:../harness`).

## Global Constraints

- **NO Prettier — dense hand-style:** compact, multi-statement lines; match surrounding code.
- **ESM `.js` import specifiers** in `tui/` (`from "./replay.js"`); bare `"cc-harness"` for engine imports.
- **`replay.ts` stays PURE** — no React/Ink/SDK imports; it consumes the messages array passed in. `renderMessage`/`toolDiffLines`/`trunc` are pure reuse from `render.ts`.
- **Never mutate the shared `Composer.tsx`/console `App.tsx`.** No new `cc-harness` public exports (`getSessionMessages`/`listSessions` are already exported) → **no API-STABILITY/index pin, no harness rebuild.**
- **ink `useInput` timing discipline:** component tests `await` a render tick / `waitFor` BEFORE writing keys; real escape sequences only; never raw `stdin.on`. **Test files run SEQUENTIALLY** (`tui/vitest.config.ts` `fileParallelism:false`).
- **Live tests gate** on `ANTHROPIC_API_KEY` (`const live = process.env.ANTHROPIC_API_KEY ? describe : describe.skip`), read from `CC-to-SDK/.env` (gitignored — never commit/print); keyless suites skip cleanly.
- Commands run **from `tui/`**: `npm run typecheck`, `npx vitest run test/<file>`. Live: `set -a; . ../.env; set +a; npx vitest run test/live/<file>`.
- Commit messages: plain, no `Co-Authored-By` / attribution.

## Grounding (already done — not a task)

Probe `probes/probes/23-resume-transcript-shape.ts` (committed `1fd41dd0`) verified live: (1) `getSessionMessages(id,{dir}) → SessionMessage[]` is the **live message shape** — `{type:"user"|"assistant", message:{role,content:[blocks]}, parent_tool_use_id, timestamp}` incl. `tool_use`/`tool_result` round-trips → `render.ts` can consume it directly; (2) `listSessions` carries `lastModified` (most-recent = `max(lastModified)`); (3) resume keeps the same `session_id`. Spec: `docs/superpowers/specs/2026-06-20-session-resume-continue-design.md`.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `tui/src/render.ts` (modify) | `renderMessage` renders user-text prompts (`› …`) and delegates Edit/Write diffs to `toolDiffLines` (resolves the incr-7 dup); `toolUseLines` slimmed to Bash/Read/generic | 1 |
| `tui/src/replay.ts` (create) | pure `replayLines(messages, opts)` — skip tool_result, cap, nest-indent, dividers, derived header | 2 |
| `tui/src/commands.ts` (modify) | add `/continue` to `COMMANDS`; add pure `pickMostRecent`, `parseResumeIntent`, `InitialResume` type | 3 |
| `tui/src/useChat.ts` (modify) | `getSessionMessages` dep + `cwd`/`initialResume` opts; one `resumeInto(id)`; `/continue`; mount-resume; route `/resume` pick through `resumeInto` | 4 |
| `tui/src/chat.tsx` + `tui/src/ChatApp.tsx` (modify) | parse flags → `initialResume`; thread `cwd`+`initialResume` into `useChat` | 5 |
| `tui/test/live/resume-replay.e2e.test.ts` (create) | gated: real session → real `getSessionMessages` → `replayLines` contains the prompt | 6 |
| `docs/parity/coverage.md` (modify) + memory | Domain 10 refresh | 7 |

---

### Task 1: `render.ts` — `renderMessage` renders prompts + delegates diffs to `toolDiffLines`

**Files:** Modify `tui/src/render.ts`, `tui/test/render.test.ts`.

**Interfaces:**
- Consumes: existing `toolDiffLines(name,input,cap?)`, `trunc`, `RenderLine`.
- Produces: `renderMessage(m)` now also renders a `type:"user"` **text** block as `{ text: "› <line>", dim: true }`, and renders an assistant `tool_use` for `Edit`/`Write` via `toolDiffLines` (truncation-aware). `toolUseLines` keeps only Bash/Read/generic. Used by Task 2.

- [ ] **Step 1: Write the failing test** — append to `tui/test/render.test.ts` (inside the existing `describe("renderMessage", …)` is fine, or a new block; it already imports `renderMessage`):

```ts
describe("renderMessage (replay additions)", () => {
  it("renders a user-text prompt as a dim '› ' line", () => {
    const m = { type: "user", message: { role: "user", content: [{ type: "text", text: "fix the parser" }] } };
    expect(renderMessage(m)).toEqual([{ text: "› fix the parser", dim: true }]);
  });
  it("renders a multi-line Write via toolDiffLines (capped at 24)", () => {
    const content = Array.from({ length: 30 }, (_, i) => `L${i}`).join("\n");
    const out = renderMessage({ type: "assistant", message: { content: [{ type: "tool_use", name: "Write", input: { file_path: "b.ts", content } }] } });
    expect(out[0]).toEqual({ text: "⚙ Write b.ts" });
    expect(out.at(-1)).toEqual({ text: "  … 6 more lines", dim: true });   // 30 added − cap 24 = 6
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tui && npx vitest run test/render.test.ts -t "replay additions"`
Expected: FAIL — the user-text prompt currently renders `[]` (the user branch only handles `tool_result`); the Write currently renders uncapped via `toolUseLines`.

- [ ] **Step 3: Implement** — in `tui/src/render.ts`:

(a) Slim `toolUseLines` to remove its now-dead Edit/Write branches (renderMessage will route those to `toolDiffLines`):

```ts
function toolUseLines(name: string, input: Record<string, unknown>): RenderLine[] {
  if (name === "Bash") return [{ text: `⚙ Bash ${trunc(String(input.command ?? ""), 80)}` }];
  if (name === "Read") return [{ text: `⚙ Read ${path(input)}` }];
  return [{ text: `⚙ ${name}(${firstArg(input)})` }];
}
```

(b) In `renderMessage`, route Edit/Write tool_use to `toolDiffLines` (replace the existing `else if (b?.type === "tool_use") …` line in the assistant branch):

```ts
      else if (b?.type === "tool_use") out.push(...(b.name === "Edit" || b.name === "Write" ? toolDiffLines(b.name, b.input ?? {}) : toolUseLines(b.name, b.input ?? {})));
```

(c) In `renderMessage`, make the `m.type === "user"` branch also render text prompts (replace the whole user branch):

```ts
  if (m.type === "user") {
    const out: RenderLine[] = [];
    for (const b of m.message?.content ?? []) {
      if (b?.type === "text" && b.text) for (const l of String(b.text).split("\n")) out.push({ text: `› ${l}`, dim: true });
      else if (b?.type === "tool_result") out.push(...resultLines(b.content));
    }
    return out;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tui && npx vitest run test/render.test.ts && npm run typecheck`
Expected: PASS — new tests + all existing render tests (the small-Edit "colored diff" test stays green: `toolDiffLines` on a 1-line diff returns `[{⚙ Edit f.ts},{- a},{+ b}]`, satisfying `out[0]` + the `toContainEqual` checks). Typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add tui/src/render.ts tui/test/render.test.ts
git commit -m "feat(tui): renderMessage renders prompts + delegates Edit/Write diffs to toolDiffLines (resolve dup)"
```

---

### Task 2: `replay.ts` — pure persisted-messages → transcript lines

**Files:** Create `tui/src/replay.ts`, `tui/test/replay.test.ts`.

**Interfaces:**
- Consumes: `renderMessage`, `trunc`, `RenderLine` (Task 1).
- Produces: `replayLines(messages: any[], opts?: { cap?: number; id?: string }): RenderLine[]`. Used by Task 4 (`useChat`) and Task 6 (live e2e).

- [ ] **Step 1: Write the failing test** — create `tui/test/replay.test.ts`:

```ts
// tui/test/replay.test.ts — pure replay-rendering units. Fixtures mirror probe-23's persisted message shape.
import { describe, it, expect } from "vitest";
import { replayLines } from "../src/replay.js";

const TS = "2026-06-19T15:58:00.000Z";
const userText = (text: string, timestamp = "2026-06-19T15:56:00.000Z") => ({ type: "user", message: { role: "user", content: [{ type: "text", text }] }, timestamp });
const asstText = (text: string, timestamp = TS) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] }, timestamp });
const asstTool = (name: string, input: any, timestamp = TS) => ({ type: "assistant", message: { content: [{ type: "tool_use", name, input }] }, timestamp });
const toolResult = (text: string, timestamp = TS) => ({ type: "user", message: { content: [{ type: "tool_result", content: text }] }, timestamp });

describe("replayLines", () => {
  it("frames the replay with a derived header (label · turns · hh:mm) and a live divider", () => {
    const out = replayLines([userText("fix the parser"), asstText("done")]);
    expect(out[0]).toEqual({ text: "─── resumed: fix the parser · 1 turn · 15:58 ───", dim: true });
    expect(out.at(-1)).toEqual({ text: "─── resumed here · live ───", dim: true });
  });
  it("renders prompts and assistant text/tools, skipping tool_result bodies", () => {
    const out = replayLines([userText("add a flag"), asstTool("Read", { file_path: "cli.ts" }), toolResult("FILE BODY HERE"), asstText("added")]);
    const texts = out.map((l) => l.text);
    expect(texts).toContain("› add a flag");
    expect(texts).toContain("⚙ Read cli.ts");
    expect(texts).toContain("added");
    expect(texts.some((t) => t.includes("FILE BODY HERE"))).toBe(false);   // tool_result body skipped
  });
  it("indents nested (subagent) messages by parent_tool_use_id", () => {
    const nested = { ...asstText("inner work"), parent_tool_use_id: "tu_1" };
    const out = replayLines([userText("go"), nested]);
    expect(out).toContainEqual({ text: "  inner work", dim: true });
  });
  it("caps to the last N messages with an elision marker", () => {
    const msgs = Array.from({ length: 250 }, (_, i) => asstText(`m${i}`, "2026-06-19T16:00:00.000Z"));
    const out = replayLines(msgs, { cap: 200 });
    expect(out[1]).toEqual({ text: "… 50 earlier messages elided", dim: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tui && npx vitest run test/replay.test.ts`
Expected: FAIL — `Cannot find module "../src/replay.js"`.

- [ ] **Step 3: Implement** — create `tui/src/replay.ts`:

```ts
// tui/src/replay.ts — pure: a resumed session's persisted messages → transcript lines (full-fidelity, reusing
// render.ts). Skips tool_result bodies (the ⚙ marker conveys the action, matching live, which never dumps result
// bodies); caps to the last N messages with an elision marker; indents nested (subagent) messages; frames the
// block with resumed/live dividers. Header label/time/turns are DERIVED from the messages (no clock, no fetch).
import { renderMessage, trunc, type RenderLine } from "./render.js";

const isToolResult = (m: any): boolean =>
  m?.type === "user" && Array.isArray(m.message?.content) && m.message.content.length > 0 && m.message.content.every((b: any) => b?.type === "tool_result");
function firstUserText(messages: any[]): string {
  for (const m of messages) {
    if (m?.type === "user" && Array.isArray(m.message?.content)) {
      const t = m.message.content.find((b: any) => b?.type === "text");
      if (t?.text) return String(t.text);
    }
  }
  return "";
}
const hhmm = (ts: unknown): string => (typeof ts === "string" && ts.length >= 16 && ts[10] === "T" ? ts.slice(11, 16) : "");
const divider = (label: string): RenderLine => ({ text: `─── ${label} ───`, dim: true });

export function replayLines(messages: any[], opts: { cap?: number; id?: string } = {}): RenderLine[] {
  const cap = opts.cap ?? 200;
  const shown = messages.filter((m) => !isToolResult(m));                 // drop tool_result bodies
  const elided = Math.max(0, shown.length - cap);
  const kept = elided > 0 ? shown.slice(shown.length - cap) : shown;
  const turns = shown.filter((m) => m?.type === "user").length;
  const label = trunc(firstUserText(messages) || (opts.id ? opts.id.slice(0, 8) : "session"), 40);
  const time = hhmm(messages.at(-1)?.timestamp);
  const head = `resumed: ${label} · ${turns} turn${turns === 1 ? "" : "s"}${time ? " · " + time : ""}`;
  const out: RenderLine[] = [divider(head)];
  if (elided > 0) out.push({ text: `… ${elided} earlier message${elided === 1 ? "" : "s"} elided`, dim: true });
  for (const m of kept) {
    const lines = renderMessage(m);
    if (m?.parent_tool_use_id) for (const l of lines) out.push({ ...l, text: "  " + l.text, dim: true });   // nested indent
    else out.push(...lines);
  }
  out.push(divider("resumed here · live"));
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tui && npx vitest run test/replay.test.ts && npm run typecheck`
Expected: PASS (4 tests); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add tui/src/replay.ts tui/test/replay.test.ts
git commit -m "feat(tui): replay.ts — pure persisted-transcript → lines (reuse render.ts, skip tool_result, cap, dividers)"
```

---

### Task 3: `commands.ts` — `/continue` + `pickMostRecent` + `parseResumeIntent`

**Files:** Modify `tui/src/commands.ts`, `tui/test/commands.test.ts`.

**Interfaces:**
- Produces: `type InitialResume = { kind: "id"; id: string } | { kind: "continue" }`; `pickMostRecent(sessions: { sessionId: string; lastModified: number }[]): string | undefined`; `parseResumeIntent(args: string[]): InitialResume | undefined`; `/continue` row in `COMMANDS`. Used by Tasks 4 (`pickMostRecent`, `InitialResume`) and 5 (`parseResumeIntent`, `InitialResume`).

- [ ] **Step 1: Write the failing test** — append to `tui/test/commands.test.ts`:

```ts
import { pickMostRecent, parseResumeIntent } from "../src/commands.js";

describe("resume helpers", () => {
  it("/continue is in the command table", () => {
    expect(COMMANDS.some((c) => c.name === "continue")).toBe(true);
  });
  it("pickMostRecent returns the max-lastModified session id", () => {
    expect(pickMostRecent([{ sessionId: "a", lastModified: 5 }, { sessionId: "b", lastModified: 9 }, { sessionId: "c", lastModified: 2 }])).toBe("b");
    expect(pickMostRecent([])).toBeUndefined();
  });
  it("parseResumeIntent reads --resume <id>, --continue, -c", () => {
    expect(parseResumeIntent(["--resume", "sess-1"])).toEqual({ kind: "id", id: "sess-1" });
    expect(parseResumeIntent(["--continue"])).toEqual({ kind: "continue" });
    expect(parseResumeIntent(["-c"])).toEqual({ kind: "continue" });
    expect(parseResumeIntent(["--model", "x"])).toBeUndefined();
  });
});
```

(The file already imports `COMMANDS`; if not, add `COMMANDS` to the existing `from "../src/commands.js"` import.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tui && npx vitest run test/commands.test.ts -t "resume helpers"`
Expected: FAIL — `pickMostRecent`/`parseResumeIntent` not exported; no `continue` row.

- [ ] **Step 3: Implement** — in `tui/src/commands.ts`:

(a) Add the `/continue` row to `COMMANDS` (after the `resume` row):

```ts
  { name: "continue", summary: "resume the most-recent session" },
```

(b) Add at the end of the file:

```ts
export type InitialResume = { kind: "id"; id: string } | { kind: "continue" };

/** The session id with the greatest lastModified, or undefined for an empty list. */
export function pickMostRecent(sessions: { sessionId: string; lastModified: number }[]): string | undefined {
  let best: { sessionId: string; lastModified: number } | undefined;
  for (const s of sessions) if (!best || s.lastModified > best.lastModified) best = s;
  return best?.sessionId;
}

/** CLI args → an initial-resume intent: `--resume <id>` / `--continue` / `-c`. */
export function parseResumeIntent(args: string[]): InitialResume | undefined {
  const ri = args.indexOf("--resume");
  if (ri >= 0 && args[ri + 1]) return { kind: "id", id: args[ri + 1] };
  if (args.includes("--continue") || args.includes("-c")) return { kind: "continue" };
  return undefined;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tui && npx vitest run test/commands.test.ts && npm run typecheck`
Expected: PASS — new + all existing command tests; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add tui/src/commands.ts tui/test/commands.test.ts
git commit -m "feat(tui): commands — /continue, pickMostRecent, parseResumeIntent (+InitialResume)"
```

---

### Task 4: `useChat.ts` — `resumeInto` + `/continue` + mount-resume + `getSessionMessages` dep

**Files:** Modify `tui/src/useChat.ts`, `tui/test/useChat.test.tsx`.

**Interfaces:**
- Consumes: `replayLines` (Task 2); `pickMostRecent`, `InitialResume` (Task 3); `getSessionMessages` from `cc-harness`.
- Produces: `useChat` gains `opts.cwd?` + `opts.initialResume?: InitialResume`; `deps` gains optional `getSessionMessages`; `/resume` pick and the new `/continue` and launch-resume all route through one `resumeInto(id)` that fetches first (empty/throws → notice, no swap) then swaps + replays. Used by Task 5.

This task replaces the incr-6 `formatResumed` marker with the full replay. (`formatResumed` becomes unused — left in `commands.ts` for the final-review cleanup wave, NOT removed here.)

- [ ] **Step 1: Update + add tests** — in `tui/test/useChat.test.tsx`:

(a) Replace the existing `it("/resume opens the picker and a pick swaps the session (old disposed, marker shown)", …)` test with the version below. The change vs. the current test: `deps` now also supplies a fake `getSessionMessages`, and the post-pick assertion is the **replay** (`"› prior prompt"` + `"resumed here · live"`) instead of the old `↻ resumed` marker. The `ResumeHost` exposing `pickSession`/`submit`, the `frame(lastFrame)` helper, and `fakeSession`/`createUiBroker` already exist in the file:

```ts
  it("/resume → pick fetches the transcript and replays it (old session disposed)", async () => {
    let disposed = 0; let calls = 0;
    const oldSession = fakeSession({ async dispose() { disposed++; } });
    const newSession = fakeSession();
    const makeSession = (resume?: string) => { calls++; return resume ? newSession : oldSession; };
    const msgs = [{ type: "user", message: { content: [{ type: "text", text: "prior prompt" }] }, timestamp: "2026-06-19T15:56:00.000Z" }];
    const deps = { listSessions: async () => [{ sessionId: "old1234567890", summary: "prior", lastModified: 1 }], getSessionMessages: async () => msgs };
    let pick: ((s: any) => void) | undefined;
    function ResumeHost() {
      const c = useChat(makeSession, createUiBroker(), {}, deps);
      pick = (c as any).pickSession;
      (ResumeHost as any).run = c.submit;
      return <Text>{c.state.picker.open ? `PICKER:${c.state.picker.sessions.length}` : "NOPICK"} {c.state.lines.map((l) => l.text).join("|")}</Text>;
    }
    const { lastFrame } = render(<ResumeHost />);
    await waitFor(() => frame(lastFrame).includes("NOPICK"));
    (ResumeHost as any).run("/resume");
    await waitFor(() => frame(lastFrame).includes("PICKER:1"));
    pick!({ sessionId: "old1234567890", summary: "prior", lastModified: 1 });
    await waitFor(() => frame(lastFrame).includes("› prior prompt"));
    await waitFor(() => frame(lastFrame).includes("resumed here · live"));
    await waitFor(() => disposed === 1);
    expect(disposed).toBe(1);
    expect(calls).toBe(2);                    // initial makeSession() + resumeInto's makeSession(id)
  });
```

(b) Add three new tests for the new paths:

```ts
  it("initialResume {kind:'id'} replays the session on mount", async () => {
    const msgs = [{ type: "user", message: { content: [{ type: "text", text: "launch prompt" }] }, timestamp: "2026-06-19T15:56:00.000Z" }];
    const deps = { listSessions: async () => [], getSessionMessages: async () => msgs };
    function H() { const c = useChat((r?: string) => fakeSession(), createUiBroker(), { initialResume: { kind: "id", id: "abc12345" } }, deps); return <Text>{c.state.lines.map((l) => l.text).join("|")}</Text>; }
    const { lastFrame } = render(<H />);
    await waitFor(() => (lastFrame() ?? "").includes("launch prompt"));
    expect(lastFrame() ?? "").toContain("resumed here · live");
  });
  it("/continue resumes the most-recent session", async () => {
    const msgs = [{ type: "user", message: { content: [{ type: "text", text: "recent work" }] }, timestamp: "2026-06-19T15:56:00.000Z" }];
    const deps = { listSessions: async () => [{ sessionId: "s-old", summary: "", lastModified: 1 }, { sessionId: "s-new", summary: "", lastModified: 9 }], getSessionMessages: async (id: string) => (id === "s-new" ? msgs : []) };
    let api: { run?: (s: string) => void } = {};
    function H() { const c = useChat((r?: string) => fakeSession(), createUiBroker(), {}, deps); api.run = c.submit; return <Text>{c.state.lines.map((l) => l.text).join("|")}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    api.run!("/continue");
    await waitFor(() => (lastFrame() ?? "").includes("recent work"));
  });
  it("/continue with no sessions shows a notice", async () => {
    const deps = { listSessions: async () => [], getSessionMessages: async () => [] };
    let api: { run?: (s: string) => void } = {};
    function H() { const c = useChat((r?: string) => fakeSession(), createUiBroker(), {}, deps); api.run = c.submit; return <Text>{c.state.lines.map((l) => l.text).join("|")}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    api.run!("/continue");
    await waitFor(() => (lastFrame() ?? "").includes("No sessions to continue"));
  });
```

(The file already imports `Text` from `ink`, `render`/`waitFor`, `useChat`, `fakeSession`, `createUiBroker`. If `Text` is not imported, add `import { Text } from "ink";`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd tui && npx vitest run test/useChat.test.tsx`
Expected: FAIL — `opts.initialResume`/`/continue` not handled; the replay never appears; `deps.getSessionMessages` not consumed.

- [ ] **Step 3: Implement** — in `tui/src/useChat.ts`:

(a) Update imports — add `replayLines`, `pickMostRecent`/`InitialResume`, `getSessionMessages`; drop `formatResumed`:

```ts
import { parseCommand, formatHelp, formatModel, formatCompact, formatContext, formatUnknown, pickMostRecent, type ParsedCommand, type InitialResume } from "./commands.js";
import { replayLines } from "./replay.js";
import { summarizeUsage, listSessions as realListSessions, getSessionMessages as realGetSessionMessages } from "cc-harness";
```

(b) Widen the signature — `opts` gains `cwd`/`initialResume`, `deps` fields become optional, and resolve them with cwd-scoped defaults at the top of the body:

```ts
export function useChat(
  makeSession: (resume?: string) => ChatSession,
  ui: UiBrokerHandle,
  opts: { initialMode?: string; cwd?: string; initialResume?: InitialResume } = {},
  deps: { listSessions?: () => Promise<SessionInfo[]>; getSessionMessages?: (id: string) => Promise<any[]> } = {},
) {
```

Just after the existing `useState`/`useRef` declarations (before `useEffect`s), add:

```ts
  const listSessions = deps.listSessions ?? (() => realListSessions({ cwd: opts.cwd, limit: 30 }) as Promise<SessionInfo[]>);
  const getSessionMessages = deps.getSessionMessages ?? ((id: string) => realGetSessionMessages(id, { cwd: opts.cwd }) as Promise<any[]>);
  const ranInitial = useRef(false);
```

(c) Replace `openPicker`'s `deps.listSessions()` call with the resolved `listSessions()`:

```ts
  async function openPicker() {
    try { const sessions = await listSessions(); if (!disposed.current) setPicker({ open: true, sessions }); }
    catch (e) { append([{ text: `✗ ${(e as Error).message}`, color: "red" }]); }
  }
```

(d) Add the resume chokepoint + continue (place after `openPicker`/`closePicker`, before `pickSession`):

```ts
  // Fetch the persisted transcript FIRST; only swap + replay if it has history (never drop into a broken resume).
  async function resumeInto(id: string) {
    if (disposed.current) return;
    let msgs: any[] = [];
    try { msgs = await getSessionMessages(id); } catch { msgs = []; }
    if (disposed.current) return;
    if (!msgs.length) { append([{ text: `⚠ couldn't resume ${id.slice(0, 8)} — no history found`, dim: true }]); return; }
    setSession(makeSession(id));                                   // [session] effect disposes the old
    setStreaming([]);
    setLines(replayLines(msgs, { id }));
    taskListRef.current.reset(); setTasks([]);
  }
  async function doContinue() {
    try {
      const sessions = await listSessions();
      const id = pickMostRecent(sessions);
      if (!id) { append([{ text: "No sessions to continue here", dim: true }]); return; }
      await resumeInto(id);
    } catch (e) { append([{ text: `✗ ${(e as Error).message}`, color: "red" }]); }
  }
```

(e) Replace `pickSession` to route through `resumeInto` (drop the `formatResumed`/`setSession` lines):

```ts
  function pickSession(info: SessionInfo) {
    if (disposed.current) return;
    setPicker({ open: false, sessions: [] });
    void resumeInto(info.sessionId);
  }
```

(f) Add the `/continue` case in `handleCommand`'s switch (after the `resume` case):

```ts
        case "continue": void doContinue(); break;
```

(g) Add the mount-resume effect (place with the other `useEffect`s, e.g. after the `[ui]` handler effect):

```ts
  // Launch-time resume: run once on mount if an initialResume intent was passed.
  useEffect(() => {
    if (ranInitial.current || !opts.initialResume) return; ranInitial.current = true;
    if (opts.initialResume.kind === "id") void resumeInto(opts.initialResume.id);
    else void doContinue();
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tui && npx vitest run test/useChat.test.tsx && npm run typecheck`
Expected: PASS — the updated `/resume` test + the three new tests + all prior useChat tests; typecheck clean. (`formatResumed` is now unused in `useChat`; it remains exported from `commands.ts` — left for the final-review cleanup.)

- [ ] **Step 5: Commit**

```bash
git add tui/src/useChat.ts tui/test/useChat.test.tsx
git commit -m "feat(tui): useChat resumeInto — replay transcript on /resume·/continue·launch (getSessionMessages dep)"
```

---

### Task 5: Wire flags + threading (`chat.tsx`, `ChatApp.tsx`)

**Files:** Modify `tui/src/chat.tsx`, `tui/src/ChatApp.tsx`.

**Interfaces:**
- Consumes: `parseResumeIntent`/`InitialResume` (Task 3); `useChat` `opts.cwd`/`opts.initialResume` (Task 4).
- Produces: `ChatApp` gains an optional `initialResume?: InitialResume` prop and passes `cwd`+`initialResume` into `useChat`; `chat.tsx` parses argv into the intent.

This is a wiring task; "failing first" is the typecheck error from the new prop / opts.

- [ ] **Step 1: Implement** —

`tui/src/chat.tsx`: parse the intent and thread it. Replace the import + the final `render(...)`:

```ts
import { ChatApp } from "./ChatApp.js";
import { parseResumeIntent } from "./commands.js";
```
```ts
const initialResume = parseResumeIntent(args);
const makeSession = (resume?: string) => openSession({ ...base, ...(resume ? { resume } : {}) });
render(<ChatApp makeSession={makeSession} broker={ui} cwd={base.cwd} initialResume={initialResume} />);
```

`tui/src/ChatApp.tsx`: accept + thread the prop. Replace the import line for `useChat` types and the signature + the `useChat` call:

```ts
import { useChat, type ChatSession } from "./useChat.js";
import type { InitialResume } from "./commands.js";
```
```ts
export function ChatApp({ makeSession, broker, hookOpts, cwd, initialResume }: { makeSession: (resume?: string) => ChatSession; broker: UiBrokerHandle; hookOpts?: { initialMode?: string }; cwd: string; initialResume?: InitialResume }) {
  const { state, submit, resolvePermission, cycleMode, interrupt, closePicker, pickSession } = useChat(makeSession, broker, { ...(hookOpts ?? {}), cwd, initialResume });
```

- [ ] **Step 2: Run tests to verify the wiring compiles + existing tests stay green**

Run: `cd tui && npx vitest run test/chat.test.tsx test/components.test.tsx && npm run typecheck`
Expected: PASS — the existing chat/component tests are unaffected (`initialResume` is optional; the three incr-8 `<ChatApp … cwd={…} />` renders need no change). Typecheck clean (the new optional prop + opts are accepted).

- [ ] **Step 3: Commit**

```bash
git add tui/src/chat.tsx tui/src/ChatApp.tsx
git commit -m "feat(tui): wire --resume/--continue → initialResume; thread cwd+intent into useChat"
```

---

### Task 6: Gated live e2e — real transcript replays its prompt

**Files:** Create `tui/test/live/resume-replay.e2e.test.ts`.

- [ ] **Step 1: Write the test** — create `tui/test/live/resume-replay.e2e.test.ts`:

```ts
// tui/test/live/resume-replay.e2e.test.ts — gated: a real session's persisted transcript, read back via the
// real getSessionMessages and rendered by replayLines, contains the original prompt. Proves the real
// persisted-shape → replay pipeline end-to-end (no UI). Skips cleanly keyless.
import { describe, it, expect } from "vitest";
import { openSession, getSessionMessages } from "cc-harness";
import { replayLines } from "../../src/replay.js";

const live = process.env.ANTHROPIC_API_KEY ? describe : describe.skip;

live("resume replay (live)", () => {
  it("replays a real session's prior prompt from getSessionMessages", async () => {
    const cwd = process.cwd();
    const session = openSession({ permissionMode: "bypassPermissions", cwd });
    const marker = "PUMPKIN-spire";
    try {
      await session.submit(`Reply with exactly the word ${marker} and nothing else.`, () => {});
      const id = session.sessionId;
      expect(id).toBeTruthy();
      const msgs = await getSessionMessages(id as string, { cwd } as any);
      const text = replayLines(msgs, { id }).map((l) => l.text).join("\n");
      expect(text).toContain(marker);                    // the prior prompt is in the replay
      expect(text).toContain("resumed here · live");     // framed
    } finally {
      await session.dispose();
    }
  }, 60_000);
});
```

- [ ] **Step 2: Run keyless to confirm clean skip**

Run: `cd tui && npx vitest run test/live/resume-replay.e2e.test.ts`
Expected: **SKIPPED** (no key). (Implementer stops here; the controller runs the keyed pass.)

- [ ] **Step 3: (controller) Run keyed**

Run: `cd tui && set -a; . ../.env; set +a; npx vitest run test/live/resume-replay.e2e.test.ts`
Expected: PASS (~5–20 s) — the persisted transcript replays the marker prompt.

- [ ] **Step 4: Commit**

```bash
git add tui/test/live/resume-replay.e2e.test.ts
git commit -m "test(tui): gated live e2e — real session transcript replays its prompt"
```

---

### Task 7: Refresh coverage scorecard + memory

**Files:** Modify `docs/parity/coverage.md`; memory (controller-handled).

- [ ] **Step 1: Full keyless gate**

Run: `cd tui && npm run typecheck && npx vitest run`
Expected: typecheck clean; all keyless suites pass (live suites skip).

- [ ] **Step 2: Update `docs/parity/coverage.md`** — in the Domain 10 row, change the Realized cell `~50%¹` → `~54%¹` (preserve the `¹` footnote), and insert this sentence verbatim **immediately before** the closing `Remote/voice remain 🚫/non-goal **by design**` clause (after the increment-8 sentence ending `2026-06-19-chat-input-ergonomics`):

```
**Phase-3 increment 9 SHIPPED — session resume/continue** (`cc-harness-chat`): resume now *renders the conversation you're rejoining* — launch `--resume <id>` / `--continue` (most-recent), a `/continue` command, and the incr-6 `/resume` picker all converge on one `resumeInto` that fetches `getSessionMessages` first (empty → notice, no swap) then replays the transcript full-fidelity. A pure `replay.ts` reuses `render.ts` (`renderMessage` promoted to render prompts + delegate Edit/Write diffs to the shared `toolDiffLines`), skips tool_result bodies, caps the last ~200 messages, and frames the block with resumed/live dividers. Probe 23 verified the persisted message shape = the live shape; no harness change; spec/plan `2026-06-20-session-resume-continue`.
```

Keep the row a single line (no line break inside the table cell).

- [ ] **Step 3: Commit**

```bash
git add docs/parity/coverage.md
git commit -m "docs(parity): record increment-9 session resume/continue (Domain 10)"
```

(Memory files live outside the repo — the controller writes them, not a git commit.)

---

## Self-Review

**1. Spec coverage** — every spec section maps to a task: transcript replay (full-fidelity, reuse `render.ts`) → T1 (`renderMessage` prompts + `toolDiffLines`) + T2 (`replay.ts`); skip tool_result / cap / nest-indent / derived header → T2; `--resume`/`--continue` flags → T3 (`parseResumeIntent`) + T5 (wiring); `/continue` + most-recent → T3 (`pickMostRecent`) + T4 (`doContinue`); the one `resumeInto` chokepoint with fetch-first-no-swap + the three converging paths → T4; error notices (bad id, no sessions) → T4; gated live pipeline → T6; docs → T7. The incr-7 `diffBody` dup resolution (spec §4) → T1.

**2. Placeholder scan** — no TBD/TODO; every code step shows complete code; every command has an expected result. T4's `/resume` test note tells the implementer to preserve the existing host's pick mechanism and states the exact new assertions (replay lines `"› prior prompt"` + `"resumed here · live"`, `disposed === 1`) rather than guessing the host's internals — the only place the current test's mechanism (not visible in the plan) governs.

**3. Type consistency** — `RenderLine` (from `render.ts`) is the line type everywhere; `replayLines(messages: any[], opts?: { cap?; id? })` matches its T4/T6 call sites; `InitialResume` is defined once in T3 and consumed identically in T4 (`opts.initialResume`) and T5 (`ChatApp` prop); `pickMostRecent(sessions)` / `parseResumeIntent(args)` signatures match T3 definitions and T4/T5 uses; `getSessionMessages(id)` dep shape matches the cwd-scoped real default and the fakes in T4; `resumeInto`/`doContinue` are internal to `useChat`. Messages are typed `any[]` end-to-end (the persisted JSON shape, consistent with `renderMessage(m: any)` and the live `onMessage(m: unknown)`).

**Deferred (carried to final-review cleanup):** `formatResumed` in `commands.ts` becomes unused after T4 (replaced by `replay.ts`'s header) — left exported (with its existing test) for the final whole-branch cleanup wave, not removed mid-plan.

**Out-of-scope held** (spec §2): richer `SessionPicker` rows (timestamp/preview), session search, rename/tag/delete UI, custom store, `/more` reveal.
