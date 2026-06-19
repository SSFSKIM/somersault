# Chat Slash-Commands (Increment 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `cc-harness-chat` a real slash-command surface — `/model` `/compact` `/context` `/clear` `/help` `/resume` — intercepted locally and dispatched to engine ops already built and verified.

**Architecture:** A new pure `tui/src/commands.ts` (parse + table + result-line formatters) is the testable core; `useChat` catches slash commands in `submit` before any `session.submit` and orchestrates the async engine calls; a new `tui/src/SessionPicker.tsx` modal drives `/resume`. To swap the session on `/resume`, `useChat` becomes **factory-owned** (`makeSession(resume?)` instead of a pre-built session). Slash commands never reach the model.

**Tech Stack:** TypeScript, React 18, Ink 5, Vitest 2, ink-testing-library 4. Package `cc-harness-tui` (`CC-to-SDK/tui/`), engine `cc-harness` (`file:../harness`).

## Global Constraints

- **NO Prettier — dense hand-style:** compact, multi-statement lines; match surrounding code.
- **ESM `.js` import specifiers** in `tui/` (`from "./commands.js"`); bare `"cc-harness"` for engine imports.
- **ink `useInput` passive-effect timing discipline:** tests **`await` a render tick / `waitFor`** BEFORE writing keys (subscription is a passive effect). **Never** swap to raw `stdin.on`; **never** mutate shared components.
- **Keep modules small/focused:** `commands.ts` (pure) + `SessionPicker.tsx` (presentational) exist to keep `useChat`/`ChatApp` lean.
- **No new `cc-harness` public exports** (all work in `tui/`, consuming existing exports) → **no** API-STABILITY / index.test pin, **no harness rebuild** needed.
- **Live tests gate** on `ANTHROPIC_API_KEY` (`const live = process.env.ANTHROPIC_API_KEY ? describe : describe.skip`), read from `CC-to-SDK/.env` (gitignored — never commit/print it); keyless suites skip cleanly.
- Commands run **from `tui/`**: `npm run typecheck`, `npx vitest run test/<file>`, `npm run build`. Live: `set -a; . ../.env; set +a; npx vitest run test/live/<file>`.
- Commit messages: plain, no `Co-Authored-By` / attribution.

## Grounding (already done — not a task)

Probe `probes/probes/21-slash-command-routing.ts` (committed `4a7634f3c9`) established that the SDK's command router gates `/model`/`/help`/`/resume` as "not available in this environment" headless, so a deterministic surface must intercept locally. Confirmed `cc-harness` public exports the handlers use: `listSessions(opts?) => Promise<SDKSessionInfo[]>`; `resumeSession(id, config) => Session`; `Session.setModel(model?)`; `Session.compact() => CompactOutcome {ok,result?,error?,preTokens?,postTokens?}`; `summarizeUsage(raw) => {percentUsed,tokensUsed,maxTokens,tokensRemaining,status}`; type exports `CompactOutcome`, `ContextUsageSummary`, `RawContextUsage`.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `tui/src/commands.ts` (create) | pure: `parseCommand` + `COMMANDS` + result-line formatters | 1 |
| `tui/src/useChat.ts` (modify) | factory-owned session (T2); slash dispatch + picker state (T3); `/resume` swap (T5) | 2,3,5 |
| `tui/src/chat.tsx` (modify) | pass a `makeSession` factory | 2 |
| `tui/src/ChatApp.tsx` (modify) | `makeSession` prop (T2); render `<SessionPicker>` + gate input (T5) | 2,5 |
| `tui/src/SessionPicker.tsx` (create) | the `/resume` modal (selectable session list) | 4 |
| `tui/test/commands.test.ts` (create) | parser + formatter units | 1 |
| `tui/test/useChat.test.tsx` (modify) | factory fakes (T2); dispatch + picker-state (T3); swap (T5) | 2,3,5 |
| `tui/test/chat.test.tsx` (modify) | factory fakes (T2) | 2 |
| `tui/test/components.test.tsx` (modify) | `SessionPicker` component test | 4 |
| `tui/test/live/chat-context.e2e.test.ts` (create) | gated live `/context` path | 6 |
| `docs/parity/coverage.md` (modify) + memory | Domain 10 refresh | 7 |

---

### Task 1: `commands.ts` — pure parser + table + formatters

**Files:** Create `tui/src/commands.ts`, `tui/test/commands.test.ts`.

**Interfaces:**
- Consumes: `RenderLine` from `./render.js`; `CompactOutcome`, `ContextUsageSummary` (types) from `cc-harness`.
- Produces: `parseCommand(input): ParsedCommand | null`, `interface ParsedCommand { name: string; args: string }`, `COMMANDS: {name,summary}[]`, and `formatHelp()/formatModel(next?,current?)/formatCompact(o)/formatContext(s)/formatResumed(summary,id)/formatUnknown(name): RenderLine[]`. Used by `useChat` (Tasks 3,5).

- [ ] **Step 1: Write the failing test** — create `tui/test/commands.test.ts`:

```ts
// tui/test/commands.test.ts — pure parser + formatters.
import { describe, it, expect } from "vitest";
import { parseCommand, COMMANDS, formatHelp, formatModel, formatCompact, formatContext, formatResumed, formatUnknown } from "../src/commands.js";

describe("parseCommand", () => {
  it("splits a slash command into name + args", () => {
    expect(parseCommand("/model claude-opus-4-8")).toEqual({ name: "model", args: "claude-opus-4-8" });
    expect(parseCommand("/help")).toEqual({ name: "help", args: "" });
    expect(parseCommand("  /compact  ")).toEqual({ name: "compact", args: "" });
  });
  it("returns null for non-commands and a bare slash", () => {
    expect(parseCommand("hello")).toBeNull();
    expect(parseCommand("/")).toBeNull();
    expect(parseCommand("  ")).toBeNull();
  });
});

describe("formatters", () => {
  it("help lists every command", () => {
    const lines = formatHelp().map((l) => l.text).join("\n");
    for (const c of COMMANDS) expect(lines).toContain(`/${c.name}`);
  });
  it("model: set vs show-current", () => {
    expect(formatModel("opus")).toEqual([{ text: "model → opus" }]);
    expect(formatModel(undefined, "sonnet")).toEqual([{ text: "model: sonnet", dim: true }]);
  });
  it("compact: success shows before→after, failure is dim", () => {
    expect(formatCompact({ ok: true, preTokens: 31000, postTokens: 6000 })).toEqual([{ text: "✦ compacted 31k → 6k" }]);
    expect(formatCompact({ ok: false, error: "Not enough messages" })[0].dim).toBe(true);
  });
  it("context renders a one-line digest", () => {
    expect(formatContext({ percentUsed: 9, tokensUsed: 18500, maxTokens: 200000, tokensRemaining: 181500, status: "ok" }))
      .toEqual([{ text: "ctx 9% · 18.5k / 200k · ok", dim: true }]);
  });
  it("resumed + unknown", () => {
    expect(formatResumed("refactor auth", "a3f1b2c3d4")).toEqual([{ text: '↻ resumed "refactor auth" (a3f1b2c3)', dim: true }]);
    expect(formatUnknown("zzz")).toEqual([{ text: "Unknown command: /zzz · try /help", color: "red" }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tui && npx vitest run test/commands.test.ts`
Expected: FAIL — `Cannot find module "../src/commands.js"`.

- [ ] **Step 3: Implement** — create `tui/src/commands.ts`:

```ts
// tui/src/commands.ts — pure slash-command surface: parse + table + result-line formatters. No React/SDK side effects.
import type { CompactOutcome, ContextUsageSummary } from "cc-harness";
import type { RenderLine } from "./render.js";

export interface ParsedCommand { name: string; args: string }

/** Leading "/" → {name, args}; non-slash or bare "/" → null. */
export function parseCommand(input: string): ParsedCommand | null {
  const t = input.trim();
  if (!t.startsWith("/")) return null;
  const body = t.slice(1).trim();
  if (!body) return null;                                       // bare "/" is not a command
  const sp = body.indexOf(" ");
  return sp < 0 ? { name: body, args: "" } : { name: body.slice(0, sp), args: body.slice(sp + 1).trim() };
}

export const COMMANDS: { name: string; summary: string }[] = [
  { name: "model", summary: "<name> — switch model (no arg shows current)" },
  { name: "compact", summary: "compact the conversation context" },
  { name: "context", summary: "show context-window usage" },
  { name: "clear", summary: "clear the screen (session context kept)" },
  { name: "resume", summary: "resume a prior session" },
  { name: "help", summary: "list commands" },
];

const k = (n: number) => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : `${n}`);   // 31000→"31k", 18500→"18.5k"

export function formatHelp(): RenderLine[] {
  return [{ text: "commands:", dim: true }, ...COMMANDS.map((c) => ({ text: `  /${c.name}  ${c.summary}`, dim: true }))];
}
export function formatModel(next?: string, current?: string): RenderLine[] {
  return next ? [{ text: `model → ${next}` }] : [{ text: `model: ${current ?? "(default)"}`, dim: true }];
}
export function formatCompact(o: CompactOutcome): RenderLine[] {
  return o.ok ? [{ text: `✦ compacted ${k(o.preTokens ?? 0)} → ${k(o.postTokens ?? 0)}` }]
              : [{ text: `compact: ${o.error ?? "nothing to compact"}`, dim: true }];
}
export function formatContext(s: ContextUsageSummary): RenderLine[] {
  return [{ text: `ctx ${s.percentUsed}% · ${k(s.tokensUsed)} / ${k(s.maxTokens)} · ${s.status}`, dim: true }];
}
export function formatResumed(summary: string, id: string): RenderLine[] {
  return [{ text: `↻ resumed "${summary}" (${id.slice(0, 8)})`, dim: true }];
}
export function formatUnknown(name: string): RenderLine[] {
  return [{ text: `Unknown command: /${name} · try /help`, color: "red" }];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tui && npx vitest run test/commands.test.ts && npm run typecheck`
Expected: PASS (parser + formatter tests); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add tui/src/commands.ts tui/test/commands.test.ts
git commit -m "feat(tui): pure commands module — slash parser + table + formatters"
```

---

### Task 2: Factory-owned session (behavior-preserving refactor)

**Files:** Modify `tui/src/useChat.ts`, `tui/src/ChatApp.tsx`, `tui/src/chat.tsx`, `tui/test/useChat.test.tsx`, `tui/test/chat.test.tsx`.

**Interfaces:**
- Produces: `useChat(makeSession: (resume?: string) => ChatSession, ui, opts?)` — session now lives in `useState`. `ChatApp` prop `session` → `makeSession`. Used by Tasks 3,5.

This task changes **how the session is owned** (a pre-built `session` → a `makeSession` factory `useChat` calls once via a lazy `useState` initializer) with **no behavior change**. The existing session-keyed effect already disposes-on-unmount/adopts-on-change; making `session` state-owned is what lets `/resume` swap it later.

- [ ] **Step 1: Update tests to the factory shape (these are the failing tests)** — in `tui/test/useChat.test.tsx`, change the `Host` prop and every `fakeSession()` call site from `session` to a factory. Change `Host` to accept `makeSession` and pass it through:

```tsx
function Host({ makeSession, ui, prompt }: { makeSession: () => ChatSession; ui: ReturnType<typeof createUiBroker>; prompt?: string }) {
  const c = useChat(makeSession, ui);
  useEffect(() => { if (prompt) c.submit(prompt); /* fire once */ }, []); // eslint-disable-line
  return <Text>{c.state.pending ? `PENDING:${c.state.pending.req.toolName}` : c.state.busy ? "BUSY" : "IDLE"} m:{c.state.model ?? "-"} {c.state.lines.map((l) => l.text).join("|")}</Text>;
}
```

Update each render call: `<Host session={fakeSession()} .../>` → `<Host makeSession={() => fakeSession()} .../>`; and where a stable reference is inspected (`session.disposed`), keep the ref and wrap it: `const session = fakeSession(); ... <Host makeSession={() => session} .../>`.

In `tui/test/chat.test.tsx`, change every `<ChatApp session={...} .../>` to `<ChatApp makeSession={...} .../>` (wrap the fake: `session={fakeSession()}` → `makeSession={() => fakeSession()}`; `session={session}` → `makeSession={() => session}`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd tui && npx vitest run test/useChat.test.tsx test/chat.test.tsx`
Expected: FAIL — `useChat`/`ChatApp` still expect a `session`, so types/props mismatch (TS error or runtime failure).

- [ ] **Step 3: Implement** — `tui/src/useChat.ts`: change the signature and own the session in state. Replace the function signature line and add the session state; the effect deps already list `session`, so they now key on the state value:

```ts
export function useChat(makeSession: (resume?: string) => ChatSession, ui: UiBrokerHandle, opts: { initialMode?: string } = {}) {
  const [session, setSession] = useState<ChatSession>(() => makeSession());
  const [lines, setLines] = useState<RenderLine[]>([]);
```

(Delete the old `session: ChatSession` parameter; keep all other state lines. `setSession` is used by Task 5. Everything else — the effect `[session, ui]`, `refreshCtx`, `submit`, `cycleMode`, `interrupt` — is unchanged and now references the state `session`.)

`tui/src/ChatApp.tsx`: change the prop and the `useChat` call:

```tsx
export function ChatApp({ makeSession, broker, hookOpts }: { makeSession: (resume?: string) => ChatSession; broker: UiBrokerHandle; hookOpts?: { initialMode?: string } }) {
  const { state, submit, resolvePermission, cycleMode, interrupt } = useChat(makeSession, broker, hookOpts ?? {});
```

`tui/src/chat.tsx`: build a factory and pass it:

```tsx
const ui = createUiBroker();
const base = { model: flag("--model"), cwd: flag("--cwd") ?? process.cwd(), permissionMode: "default" as const, permissionBroker: ui.broker, contextTool: true, includePartialMessages: true };
const makeSession = (resume?: string) => openSession({ ...base, ...(resume ? { resume } : {}) });
render(<ChatApp makeSession={makeSession} broker={ui} />);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tui && npx vitest run test/useChat.test.tsx test/chat.test.tsx && npm run typecheck`
Expected: PASS — all existing useChat + chat tests green (behavior unchanged); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add tui/src/useChat.ts tui/src/ChatApp.tsx tui/src/chat.tsx tui/test/useChat.test.tsx tui/test/chat.test.tsx
git commit -m "refactor(tui): useChat owns the session via a makeSession factory"
```

---

### Task 3: Slash-command dispatch (non-resume) + picker state

**Files:** Modify `tui/src/useChat.ts`, `tui/test/useChat.test.tsx`.

**Interfaces:**
- Consumes: `parseCommand`, `formatHelp/Model/Compact/Context/Unknown` (Task 1); `summarizeUsage`, `RawContextUsage`, `CompactOutcome` from `cc-harness`; `SessionInfo` (defined here, reused by Task 4 — see note).
- Produces: `ChatSession` += `setModel(model?)`, `compact()`; `ChatState` += `picker: { open: boolean; sessions: SessionInfo[] }`; `useChat` returns add `closePicker`. `handleCommand` dispatches all six command names (`/resume` → `openPicker`). Used by Tasks 4,5.

> Note on `SessionInfo`: a minimal local type `{ sessionId: string; summary: string; firstPrompt?: string; lastModified: number }` (the real `SDKSessionInfo` from `listSessions` is structurally assignable). Define it in `commands.ts`? No — it's UI state; define it in `useChat.ts` and **re-export** it for `SessionPicker` (Task 4) to import: `export interface SessionInfo { ... }`.

- [ ] **Step 1: Write the failing test** — append to `tui/test/useChat.test.tsx` (extend `fakeSession` to record `setModel` + provide `compact`; add `listSessions` to the `Host` deps):

```tsx
  it("dispatches /model, /compact, /context, /clear, /help locally — never to the model", async () => {
    let submitted = 0, modelSet = "";
    const fake = fakeSession({
      async submit() { submitted++; return { result: "x" }; },
      async setModel(m?: string) { modelSet = m ?? ""; },
      async compact() { return { ok: true, preTokens: 9000, postTokens: 2000 }; },
      async getContextUsage() { return { totalTokens: 50, maxTokens: 200 }; },
    });
    const { lastFrame } = render(<Host makeSession={() => fake} ui={createUiBroker()} />);
    await waitFor(() => frame(lastFrame).includes("IDLE"));
    fake.run("/model opus");   await waitFor(() => frame(lastFrame).includes("model → opus"));
    fake.run("/compact");      await waitFor(() => frame(lastFrame).includes("✦ compacted 9k → 2k"));
    fake.run("/context");      await waitFor(() => frame(lastFrame).includes("ctx 25%"));
    fake.run("/help");         await waitFor(() => frame(lastFrame).includes("/model"));
    fake.run("/zzz");          await waitFor(() => frame(lastFrame).includes("Unknown command: /zzz"));
    fake.run("/clear");        await waitFor(() => !frame(lastFrame).includes("Unknown command"));
    expect(modelSet).toBe("opus");
    expect(submitted).toBe(0);     // no slash command ever reached session.submit
  });
```

This test calls `fake.run(text)` to drive `submit` — wire it through the existing `Host` by exposing the hook's `submit` via a ref. Replace `Host` with a version that stashes `submit` on the passed object: add `useEffect(() => { (api as any).run = c.submit; }, [c.submit]);` where `api` is a prop object. Concretely, change the new test's `Host` usage to capture submit:

```tsx
function CmdHost({ makeSession, api }: { makeSession: () => ChatSession; api: { run?: (s: string) => void } }) {
  const c = useChat(makeSession, createUiBroker());
  api.run = c.submit;
  return <Text>{c.state.busy ? "BUSY" : "IDLE"} {c.state.lines.map((l) => l.text).join("|")}</Text>;
}
```

and in the test build `const api: { run?: (s: string) => void } = {}; render(<CmdHost makeSession={() => fake} api={api} />); ... api.run!("/model opus");`. (Use `api.run!(...)` after `await waitFor(IDLE)` so the hook is mounted.) Also update `fakeSession` to accept the `overrides` object and merge it (the existing `fakeSession(overrides)` pattern already merges `...overrides`).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tui && npx vitest run test/useChat.test.tsx -t "dispatches"`
Expected: FAIL — `submit` still streams `/model …` as a turn (no command interception); `setModel`/`compact` not on `ChatSession`.

- [ ] **Step 3: Implement** — `tui/src/useChat.ts`:

(a) Extend the imports and `ChatSession`:

```ts
import { LiveTurn } from "./liveTurn.js";
import { parseCommand, formatHelp, formatModel, formatCompact, formatContext, formatUnknown, type ParsedCommand } from "./commands.js";
import { summarizeUsage } from "cc-harness";
import type { CompactOutcome, RawContextUsage } from "cc-harness";
```

```ts
export interface SessionInfo { sessionId: string; summary: string; firstPrompt?: string; lastModified: number }
export interface ChatSession {
  submit(prompt: string, onMessage: (m: unknown) => void): Promise<{ result: unknown }>;
  setPermissionMode(mode: string): Promise<void>;
  setModel(model?: string): Promise<void>;
  compact(): Promise<CompactOutcome>;
  interrupt(): Promise<void>;
  getContextUsage(): Promise<unknown>;
  dispose(): Promise<void>;
  readonly sessionId?: string;
}
```

(b) `ChatState` gains `picker`; add picker state + a `deps` param defaulting to the real `listSessions`:

```ts
export interface ChatState { lines: RenderLine[]; streaming: RenderLine[]; pending: Pending | null; mode: string; busy: boolean; ctxPct?: number; model?: string; picker: { open: boolean; sessions: SessionInfo[] }; }
```

```ts
import { listSessions as realListSessions } from "cc-harness";
// signature:
export function useChat(makeSession: (resume?: string) => ChatSession, ui: UiBrokerHandle, opts: { initialMode?: string } = {}, deps: { listSessions: () => Promise<SessionInfo[]> } = { listSessions: () => realListSessions({ limit: 30 }) }) {
  // ...existing state...
  const [picker, setPicker] = useState<{ open: boolean; sessions: SessionInfo[] }>({ open: false, sessions: [] });
```

(c) Add an `append` helper, the `submit` guard, `handleCommand`, and `openPicker`/`closePicker`:

```ts
  function append(ls: RenderLine[]) { if (!disposed.current && ls.length) setLines((l) => [...l, ...ls]); }

  async function handleCommand(cmd: ParsedCommand) {
    setLines((l) => [...l, { text: `› /${cmd.name}${cmd.args ? " " + cmd.args : ""}`, dim: true }]);
    try {
      switch (cmd.name) {
        case "model":
          if (cmd.args) { await session.setModel(cmd.args); if (!disposed.current) setModel(cmd.args); append(formatModel(cmd.args)); }
          else append(formatModel(undefined, model));
          break;
        case "compact": append(formatCompact(await session.compact())); break;
        case "context": append(formatContext(summarizeUsage((await session.getContextUsage()) as RawContextUsage))); break;
        case "clear": if (!disposed.current) setLines([]); break;
        case "help": append(formatHelp()); break;
        case "resume": void openPicker(); break;
        default: append(formatUnknown(cmd.name));
      }
    } catch (e) { append([{ text: `✗ ${(e as Error).message}`, color: "red" }]); }
  }

  async function openPicker() {
    try { const sessions = await deps.listSessions(); if (!disposed.current) setPicker({ open: true, sessions }); }
    catch (e) { append([{ text: `✗ ${(e as Error).message}`, color: "red" }]); }
  }
  function closePicker() { if (!disposed.current) setPicker({ open: false, sessions: [] }); }
```

(d) Guard `submit` at the top, and include `picker` + `closePicker` in the return:

```ts
  function submit(prompt: string) {
    if (disposed.current || busy || !prompt.trim()) return;
    const cmd = parseCommand(prompt);
    if (cmd) { void handleCommand(cmd); return; }
    setLines((l) => [...l, { text: `› ${prompt}`, dim: true }]);
    setStreaming([]); setBusy(true);
    const lt = new LiveTurn();
    session.submit(prompt, (m) => { if (disposed.current) return; lt.ingest(m); setStreaming(lt.snapshot()); })
      .then(() => {}, (e) => { lt.fail((e as Error).message); })
      .finally(() => { if (disposed.current) return; setLines((l) => [...l, ...lt.finalize()]); setStreaming([]); setBusy(false); if (lt.model) setModel(lt.model); void refreshCtx(); });
  }
```

```ts
  return { state: { lines, streaming, pending, mode, busy, ctxPct, model, picker } as ChatState, submit, resolvePermission, cycleMode, interrupt, closePicker };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tui && npx vitest run test/useChat.test.tsx && npm run typecheck`
Expected: PASS — dispatch test + all existing useChat tests; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add tui/src/useChat.ts tui/test/useChat.test.tsx
git commit -m "feat(tui): intercept slash commands in useChat — /model /compact /context /clear /help"
```

---

### Task 4: `SessionPicker.tsx` — the `/resume` modal

**Files:** Create `tui/src/SessionPicker.tsx`; modify `tui/test/components.test.tsx`.

**Interfaces:**
- Consumes: `SessionInfo` from `./useChat.js` (Task 3).
- Produces: `SessionPicker({ sessions, onPick, onCancel })`. Used by Task 5.

- [ ] **Step 1: Write the failing test** — append to `tui/test/components.test.tsx` (mirror the file's existing ink-testing-library + `waitFor` usage):

```tsx
import { SessionPicker } from "../src/SessionPicker.js";

describe("SessionPicker", () => {
  const sessions = [
    { sessionId: "aaaaaaaa1111", summary: "first session", lastModified: 1 },
    { sessionId: "bbbbbbbb2222", summary: "second session", lastModified: 2 },
  ];
  it("↓ then Enter picks the second session", async () => {
    let picked: any;
    const { stdin, lastFrame } = render(<SessionPicker sessions={sessions} onPick={(s) => { picked = s; }} onCancel={() => {}} />);
    await waitFor(() => (lastFrame() ?? "").includes("resume a session"));   // useInput subscribed
    stdin.write("[B");                                                 // down arrow
    await waitFor(() => (lastFrame() ?? "").includes("second session"));
    stdin.write("\r");                                                       // enter
    await waitFor(() => picked !== undefined);
    expect(picked.sessionId).toBe("bbbbbbbb2222");
  });
  it("Esc cancels", async () => {
    let cancelled = false;
    const { stdin, lastFrame } = render(<SessionPicker sessions={sessions} onPick={() => {}} onCancel={() => { cancelled = true; }} />);
    await waitFor(() => (lastFrame() ?? "").includes("resume a session"));
    stdin.write("");                                                   // escape
    await waitFor(() => cancelled);
    expect(cancelled).toBe(true);
  });
  it("shows 'no sessions' when empty", () => {
    const { lastFrame } = render(<SessionPicker sessions={[]} onPick={() => {}} onCancel={() => {}} />);
    expect(lastFrame() ?? "").toContain("no sessions");
  });
});
```

> The `components.test.tsx` file already imports `render` from `ink-testing-library` and defines a `waitFor` helper — reuse them; only add the `SessionPicker` import + this describe block.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tui && npx vitest run test/components.test.tsx -t "SessionPicker"`
Expected: FAIL — `Cannot find module "../src/SessionPicker.js"`.

- [ ] **Step 3: Implement** — create `tui/src/SessionPicker.tsx`:

```tsx
// tui/src/SessionPicker.tsx — the /resume modal: a selectable list of prior sessions (↑/↓ · Enter · Esc).
import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { SessionInfo } from "./useChat.js";

export function SessionPicker({ sessions, onPick, onCancel }: { sessions: SessionInfo[]; onPick: (s: SessionInfo) => void; onCancel: () => void }) {
  const [idx, setIdx] = useState(0);
  useInput((_input, key) => {
    if (key.escape) { onCancel(); return; }
    if (key.upArrow) setIdx((i) => Math.max(0, i - 1));
    else if (key.downArrow) setIdx((i) => Math.min(sessions.length - 1, i + 1));
    else if (key.return && sessions[idx]) onPick(sessions[idx]);
  });
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Text bold>resume a session  (↑/↓ · Enter · Esc)</Text>
      {sessions.length === 0
        ? <Text dimColor>no sessions</Text>
        : sessions.map((s, i) => <Text key={s.sessionId} inverse={i === idx}>{`${s.sessionId.slice(0, 8)}  ${s.summary || s.firstPrompt || "(untitled)"}`}</Text>)}
    </Box>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tui && npx vitest run test/components.test.tsx && npm run typecheck`
Expected: PASS — `SessionPicker` tests + existing component tests; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add tui/src/SessionPicker.tsx tui/test/components.test.tsx
git commit -m "feat(tui): SessionPicker modal for /resume"
```

---

### Task 5: Wire `/resume` — picker render + session swap

**Files:** Modify `tui/src/useChat.ts`, `tui/src/ChatApp.tsx`, `tui/test/useChat.test.tsx`.

**Interfaces:**
- Consumes: `SessionPicker` (Task 4); `makeSession` (Task 2); `formatResumed` (Task 1); picker state + `closePicker` (Task 3).
- Produces: `useChat` returns add `pickSession(info: SessionInfo)`. `ChatApp` renders `<SessionPicker>` when `picker.open` and gates the global `useInput`.

- [ ] **Step 1: Write the failing test** — append to `tui/test/useChat.test.tsx`:

```tsx
  it("/resume opens the picker and a pick swaps the session (old disposed, marker shown)", async () => {
    let disposed = 0;
    const oldSession = fakeSession({ async dispose() { disposed++; } });
    const newSession = fakeSession();
    let calls = 0;
    const makeSession = (resume?: string) => { calls++; return resume ? newSession : oldSession; };
    const deps = { listSessions: async () => [{ sessionId: "old1234567890", summary: "prior", lastModified: 1 }] };
    let pick: ((s: any) => void) | undefined, close: (() => void) | undefined;
    function ResumeHost() {
      const c = useChat(makeSession, createUiBroker(), {}, deps);
      pick = (c as any).pickSession; close = (c as any).closePicker;
      const api = (c as any);
      (ResumeHost as any).run = c.submit;
      return <Text>{c.state.picker.open ? `PICKER:${c.state.picker.sessions.length}` : "NOPICK"} {c.state.lines.map((l) => l.text).join("|")}</Text>;
    }
    const { lastFrame } = render(<ResumeHost />);
    await waitFor(() => frame(lastFrame).includes("NOPICK"));
    (ResumeHost as any).run("/resume");
    await waitFor(() => frame(lastFrame).includes("PICKER:1"));
    pick!({ sessionId: "old1234567890", summary: "prior", lastModified: 1 });
    await waitFor(() => frame(lastFrame).includes("↻ resumed"));
    await waitFor(() => disposed === 1);     // old session disposed by the effect on session change
    expect(disposed).toBe(1);
    expect(calls).toBe(2);                    // initial + resumed
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tui && npx vitest run test/useChat.test.tsx -t "swaps the session"`
Expected: FAIL — `pickSession` is undefined.

- [ ] **Step 3: Implement** — `tui/src/useChat.ts`: add `pickSession` (imports `formatResumed`) and return it:

```ts
import { parseCommand, formatHelp, formatModel, formatCompact, formatContext, formatUnknown, formatResumed, type ParsedCommand } from "./commands.js";
```

```ts
  function pickSession(info: SessionInfo) {
    if (disposed.current) return;
    setSession(makeSession(info.sessionId));                       // effect disposes the old, wires the new
    setStreaming([]);
    setLines(formatResumed(info.summary || info.firstPrompt || "session", info.sessionId));
    setPicker({ open: false, sessions: [] });
  }
```

```ts
  return { state: { lines, streaming, pending, mode, busy, ctxPct, model, picker } as ChatState, submit, resolvePermission, cycleMode, interrupt, closePicker, pickSession };
```

`tui/src/ChatApp.tsx`: render the picker (highest-priority modal), gate the global `useInput` while it's open, and pull `closePicker`/`pickSession` from the hook:

```tsx
import { SessionPicker } from "./SessionPicker.js";
// ...
  const { state, submit, resolvePermission, cycleMode, interrupt, closePicker, pickSession } = useChat(makeSession, broker, hookOpts ?? {});
  useInput((input, key) => {
    if (key.escape) { interrupt(); return; }
    if (key.tab) cycleMode();
  }, { isActive: !state.pending && !state.picker.open });
  return (
    <Box flexDirection="column">
      <Transcript lines={state.lines} streaming={state.streaming} />
      {state.picker.open
        ? <SessionPicker sessions={state.picker.sessions} onPick={pickSession} onCancel={closePicker} />
        : state.pending
          ? <PermissionDialog req={state.pending.req} onDecision={resolvePermission} />
          : <Composer onSubmit={submit} />}
      <ChatStatusBar model={state.model} mode={state.mode} busy={state.busy} ctxPct={state.ctxPct} hasPending={!!state.pending} />
    </Box>
  );
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tui && npx vitest run test/useChat.test.tsx test/chat.test.tsx test/components.test.tsx && npm run typecheck`
Expected: PASS — the swap test + all existing tests; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add tui/src/useChat.ts tui/src/ChatApp.tsx tui/test/useChat.test.tsx
git commit -m "feat(tui): /resume — render SessionPicker + swap the session"
```

---

### Task 6: Gated live test — `/context` path end to end

**Files:** Create `tui/test/live/chat-context.e2e.test.ts`.

- [ ] **Step 1: Write the test** — create `tui/test/live/chat-context.e2e.test.ts`:

```ts
// tui/test/live/chat-context.e2e.test.ts — gated: the /context command path against a real session.
import { describe, it, expect } from "vitest";
import { openSession, summarizeUsage } from "cc-harness";
import type { RawContextUsage } from "cc-harness";
import { formatContext } from "../../src/commands.js";

const live = process.env.ANTHROPIC_API_KEY ? describe : describe.skip;

live("chat /context (live)", () => {
  it("reports non-zero usage after a real turn", async () => {
    const session = openSession({ permissionMode: "bypassPermissions" });
    try {
      await session.submit("Say hello in one word.");
      const summary = summarizeUsage((await session.getContextUsage()) as RawContextUsage);
      const line = formatContext(summary).map((l) => l.text).join("");
      expect(summary.tokensUsed).toBeGreaterThan(0);
      expect(summary.maxTokens).toBeGreaterThan(0);
      expect(line).toMatch(/ctx \d+% ·/);
    } finally {
      await session.dispose();
    }
  }, 60_000);
});
```

- [ ] **Step 2: Run keyless to confirm clean skip**

Run: `cd tui && npx vitest run test/live/chat-context.e2e.test.ts`
Expected: **SKIPPED** (no key) — confirms it never blocks keyless CI. (Implementer stops here; the controller runs the keyed pass.)

- [ ] **Step 3: (controller) Run keyed**

Run: `cd tui && set -a; . ../.env; set +a; npx vitest run test/live/chat-context.e2e.test.ts`
Expected: PASS (~10–30 s) — `tokensUsed`/`maxTokens` > 0 and the digest matches `ctx N% ·`.

- [ ] **Step 4: Commit**

```bash
git add tui/test/live/chat-context.e2e.test.ts
git commit -m "test(tui): gated live e2e for the /context command path"
```

---

### Task 7: Refresh coverage scorecard + memory

**Files:** Modify `docs/parity/coverage.md`; memory (controller-handled).

- [ ] **Step 1: Full keyless gate**

Run: `cd tui && npm run typecheck && npx vitest run test`
Expected: typecheck clean; all keyless suites pass (live suite skips).

- [ ] **Step 2: Update `docs/parity/coverage.md`** — append to the Domain 10 row, after the increment-5 sentence:

```
**Phase-3 increment 6 SHIPPED — slash commands** (`cc-harness-chat`): `/model /compact /context /clear /help /resume` intercepted locally (probe 21: the SDK gates /model//help//resume "not available" headless) and dispatched to engine ops already built — `setModel`, `Session.compact`, `getContextUsage`/`summarizeUsage`, `listSessions`/`resumeSession`. A pure `commands.ts` (parser + table + formatters) + a `SessionPicker` modal; `useChat` is now factory-owned so `/resume` swaps the session (marker+continue). No new harness exports; spec/plan `2026-06-19-chat-slash-commands`.
```

Bump the Domain 10 "Realized" estimate from `~38%` to `~42%`.

- [ ] **Step 3: Commit**

```bash
git add docs/parity/coverage.md
git commit -m "docs(parity): record increment-6 chat slash commands (Domain 10)"
```

(Memory files live outside the repo — the controller writes them, not a git commit.)

---

## Self-Review

**1. Spec coverage** — every spec section maps to a task: `commands.ts` parser+table+formatters → T1; intercept-local dispatch (`/model /compact /context /clear /help` + unknown) → T3; `SessionPicker` → T4; `/resume` marker+continue swap + factory-owned session → T2 (factory) + T5 (swap); `/clear` display-only → T3 (`setLines([])`); `ChatSession` += `setModel`/`compact` → T3; error→red line + `!busy` gate → T3/`submit`; gated `/context` live test → T6; docs → T7.

**2. Placeholder scan** — no TBD/TODO; every code step shows complete code; every command has an expected result. The one prose-described test-harness tweak (capturing `c.submit` via a ref/`api` object in `CmdHost`/`ResumeHost`) shows the exact code.

**3. Type consistency** — `ParsedCommand {name,args}`, `SessionInfo {sessionId,summary,firstPrompt?,lastModified}`, the formatter signatures, `ChatSession` additions (`setModel`/`compact`), and `ChatState.picker {open,sessions}` are identical across T1/T3/T4/T5. `makeSession: (resume?: string) => ChatSession` matches T2↔T5. `pickSession`/`closePicker` match T5 impl↔ChatApp consumer.

**Out-of-scope held:** no SDK skill pass-through, no `getSessionMessages` replay, no context-resetting `/clear`, no `/mode` command — all per the spec.
