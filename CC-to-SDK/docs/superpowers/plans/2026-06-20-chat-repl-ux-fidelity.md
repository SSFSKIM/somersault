# Chat REPL UX Fidelity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close three chat-REPL UX gaps vs real Claude Code — markdown rendering, an immediate "thinking…" indicator, and a `/model` picker — entirely in `tui/`.

**Architecture:** A new pure `markdown.ts` (string → `RenderLine[]`) wired into the two text-render paths; a small `<ThinkingIndicator>` mounted only during the pre-first-frame gap; a `<ModelPicker>` modal (mirroring `SessionPicker`) fed by the live `session.capabilities().models`. The only shared change is two additive `RenderLine` fields (`bold?`/`italic?`). No harness change.

**Tech Stack:** TypeScript (ESM, `.js` specifiers), React + Ink, Vitest + `ink-testing-library`.

## Global Constraints

- Entirely under `tui/src/` + `tui/test/`. **No harness change.** Build `harness/` before `tui/` typecheck (`cd ../harness && npm run build`).
- **ESM** import specifiers end in `.js`; **dense no-Prettier** hand-style — match surrounding code, do not reformat untouched lines. Bare `"cc-harness"` for core imports.
- Components tested **keyless** via `ink-testing-library`. **`useInput` timing discipline:** `await` a tick / `waitFor` BEFORE writing keys so the subscription is live; use **real escape sequences** (``, `\r`, `[A`/`[B` for arrows).
- Test files run **sequentially** (`vitest.config.ts` `fileParallelism:false`). **Never mutate `Composer.tsx`** (the console's composer; not used by the chat REPL).
- **Markdown is NOT applied to thinking blocks, user-echo lines, or tool/diff lines** — only to assistant/live *text* blocks.
- Live tests gate on `ANTHROPIC_API_KEY` from `CC-to-SDK/.env` (never commit/print it); skip cleanly without a key. The controller runs the keyed pass; implementers stop at the clean keyless skip.
- All commands run from `CC-to-SDK/tui/`. After each task: `npm run typecheck` (exit 0) + `npx vitest run` (green).
- Trust a clean `typecheck` + green vitest over phantom stale-cache LSP diagnostics.
- Git: commit completed work to `main`; **NO `Co-Authored-By`** / no attribution lines; no push.

---

### Task 1: `markdown.ts` pure parser + `RenderLine` fields

**Files:**
- Modify: `tui/src/render.ts` (the `RenderLine` interface, line 2)
- Create: `tui/src/markdown.ts`
- Test: `tui/test/markdown.test.ts` (create)

**Interfaces:**
- Consumes: `RenderLine` from `./render.js`.
- Produces: `renderMarkdown(text: string): RenderLine[]` (exported from `./markdown.js`) and the extended `RenderLine` with optional `bold?: boolean; italic?: boolean`. Task 2 wires `renderMarkdown` into the render paths and makes `Transcript` honor the new fields.

**Context:** `RenderLine` is `{ text: string; color?: string; dim?: boolean }` (`render.ts:2`). The parser is line-oriented: whole-line inline spans get a style; mixed-style lines have their markers stripped with no per-span color (the accepted limitation from the spec). Node 22 (regex with non-greedy groups is fine; no lookbehind needed).

- [ ] **Step 1: Extend `RenderLine`**

In `tui/src/render.ts`, change line 2:
```ts
export interface RenderLine { text: string; color?: string; dim?: boolean; bold?: boolean; italic?: boolean; }
```

- [ ] **Step 2: Write the failing test**

Create `tui/test/markdown.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../src/markdown.js";

describe("renderMarkdown", () => {
  it("plain text passes through unchanged, one line each", () => {
    expect(renderMarkdown("hello\nworld")).toEqual([{ text: "hello" }, { text: "world" }]);
  });
  it("whole-line bold / italic / inline-code take that style", () => {
    expect(renderMarkdown("**bold**")).toEqual([{ text: "bold", bold: true }]);
    expect(renderMarkdown("__bold__")).toEqual([{ text: "bold", bold: true }]);
    expect(renderMarkdown("*it*")).toEqual([{ text: "it", italic: true }]);
    expect(renderMarkdown("`code`")).toEqual([{ text: "code", color: "cyan" }]);
  });
  it("headers become bold with the # stripped", () => {
    expect(renderMarkdown("# Title")).toEqual([{ text: "Title", bold: true }]);
    expect(renderMarkdown("### Sub")).toEqual([{ text: "Sub", bold: true }]);
  });
  it("bullet and numbered lists get a • / keep the number; inline markers stripped", () => {
    expect(renderMarkdown("- item")).toEqual([{ text: "• item" }]);
    expect(renderMarkdown("* item")).toEqual([{ text: "• item" }]);
    expect(renderMarkdown("1. first")).toEqual([{ text: "1. first" }]);
    expect(renderMarkdown("- use `foo`")).toEqual([{ text: "• use foo" }]);
  });
  it("blockquote → dim with a │ prefix", () => {
    expect(renderMarkdown("> quoted")).toEqual([{ text: "│ quoted", dim: true }]);
  });
  it("fenced code → fences dropped, body dim + indented", () => {
    expect(renderMarkdown("```\nconst x = 1;\n```")).toEqual([{ text: "  const x = 1;", dim: true }]);
  });
  it("a mixed-style line strips markers and applies NO per-span color (the accepted limitation)", () => {
    expect(renderMarkdown("**bold** and normal")).toEqual([{ text: "bold and normal" }]);
    expect(renderMarkdown("see `x` here")).toEqual([{ text: "see x here" }]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run test/markdown.test.ts`
Expected: FAIL — `renderMarkdown` is not defined (module missing).

- [ ] **Step 4: Write `markdown.ts`**

Create `tui/src/markdown.ts`:
```ts
// tui/src/markdown.ts — pure markdown → RenderLine[]. Lightweight: the cases assistant replies actually use.
// Whole-line inline styles only (bold/italic/inline-code); a line that MIXES styles has its markers stripped
// and renders as clean text with no per-span color (each RenderLine carries one style set — the accepted limit).
import type { RenderLine } from "./render.js";

const HEADER = /^#{1,6}\s+(.*)$/;          // # .. ###### header → bold, # stripped
const BULLET = /^[-*+]\s+(.*)$/;           // - * + bullet → "• "
const NUMBERED = /^(\d+)\.\s+(.*)$/;       // "1. " numbered → keep number
const QUOTE = /^>\s?(.*)$/;                // > blockquote → dim, "│ "
const BOLD = /^(?:\*\*(.+)\*\*|__(.+)__)$/; // entire line bold
const ITALIC = /^(?:\*(.+)\*|_(.+)_)$/;     // entire line italic
const CODE = /^`(.+)`$/;                    // entire line inline code

// Strip inline markers from a mixed-style line (no per-span color is possible in one RenderLine).
function stripInline(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1")
          .replace(/\*(.+?)\*/g, "$1").replace(/`(.+?)`/g, "$1");
}

export function renderMarkdown(text: string): RenderLine[] {
  const out: RenderLine[] = [];
  let inFence = false;
  for (const raw of text.split("\n")) {
    if (/^```/.test(raw)) { inFence = !inFence; continue; }            // drop fence lines, toggle state
    if (inFence) { out.push({ text: "  " + raw, dim: true }); continue; } // code body: dim + indented
    let m: RegExpMatchArray | null;
    if ((m = raw.match(HEADER))) { out.push({ text: m[1], bold: true }); continue; }
    if ((m = raw.match(QUOTE))) { out.push({ text: "│ " + stripInline(m[1]), dim: true }); continue; }
    if ((m = raw.match(BULLET))) { out.push({ text: "• " + stripInline(m[1]) }); continue; }
    if ((m = raw.match(NUMBERED))) { out.push({ text: `${m[1]}. ${stripInline(m[2])}` }); continue; }
    if ((m = raw.match(BOLD))) { out.push({ text: m[1] ?? m[2], bold: true }); continue; }
    if ((m = raw.match(ITALIC))) { out.push({ text: m[1] ?? m[2], italic: true }); continue; }
    if ((m = raw.match(CODE))) { out.push({ text: m[1], color: "cyan" }); continue; }
    out.push({ text: stripInline(raw) });                              // plain / mixed-inline: markers stripped
  }
  return out;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/markdown.test.ts`
Expected: PASS — all cases green. (Note: `BOLD` is checked before `ITALIC`, so `**bold**` matches bold, not italic.)

- [ ] **Step 6: Typecheck + commit**

Run: `npm run typecheck`
Expected: exit 0.
```bash
git add tui/src/render.ts tui/src/markdown.ts tui/test/markdown.test.ts
git commit -m "feat(tui): markdown.ts pure renderMarkdown + RenderLine bold/italic fields"
```

---

### Task 2: Wire markdown into the render paths

**Files:**
- Modify: `tui/src/render.ts:48` (assistant text branch)
- Modify: `tui/src/liveTurn.ts:126` (the `text` branch of `renderBlock`)
- Modify: `tui/src/Transcript.tsx:6` (`<Line>` honors `bold`/`italic`)
- Test: `tui/test/render.test.ts`, `tui/test/liveTurn.test.ts`, `tui/test/components.test.tsx` (add cases)

**Interfaces:**
- Consumes: `renderMarkdown` from `./markdown.js` (Task 1).
- Produces: assistant + live *text* blocks rendered as markdown; thinking/user/tool lines unchanged; `Transcript` renders `bold`/`italic`.

**Context:** `render.ts:48` currently `if (b?.type === "text" && b.text) for (const l of String(b.text).split("\n")) out.push({ text: l });`. `liveTurn.ts:126` currently `if (b.kind === "text") return b.text ? b.text.split("\n").map((t) => ({ text: t })) : [];`. Thinking branches (`render.ts:49`, `liveTurn.ts:127-129`) must stay as dim plain lines. `Transcript.tsx:6` is `const Line = ({ l }) => <Text color={l.color} dimColor={l.dim}>{l.text || " "}</Text>;`.

- [ ] **Step 1: Write the failing tests**

Add to `tui/test/render.test.ts` (inside the existing `describe`):
```ts
  it("renders assistant text as markdown (whole-line bold) and leaves thinking plain", () => {
    const lines = renderMessage({ type: "assistant", message: { content: [
      { type: "text", text: "**hi**" },
      { type: "thinking", thinking: "**not parsed**" },
    ] } });
    expect(lines).toContainEqual({ text: "hi", bold: true });           // text → markdown
    expect(lines).toContainEqual({ text: "**not parsed**", dim: true }); // thinking → raw dim (NOT parsed)
  });
```
Add to `tui/test/liveTurn.test.ts` (inside the existing `describe`):
```ts
  it("renders live assistant text as markdown", () => {
    const lt = new LiveTurn(() => 0);
    lt.ingest({ type: "assistant", message: { content: [{ type: "text", text: "# Heading" }] } });
    expect(lt.snapshot()).toContainEqual({ text: "Heading", bold: true });
  });
```
Add to `tui/test/components.test.tsx` (a Transcript bold/italic render check — mirror the existing Transcript tests):
```ts
  it("Transcript renders bold and italic RenderLine fields", () => {
    const { lastFrame } = render(<Transcript lines={[{ text: "B", bold: true }, { text: "I", italic: true }]} streaming={[]} />);
    expect(lastFrame()).toContain("B");
    expect(lastFrame()).toContain("I");
  });
```
(If `Transcript` is not already imported in `components.test.tsx`, add `import { Transcript } from "../src/Transcript.js";`.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/render.test.ts test/liveTurn.test.ts`
Expected: FAIL — assistant text is still `{ text: "**hi**" }` / `{ text: "# Heading" }`, not the markdown forms.

- [ ] **Step 3: Wire `render.ts`**

In `tui/src/render.ts`, add the import at the top (after line 1's comment, before `RenderLine`):
```ts
import { renderMarkdown } from "./markdown.js";
```
Replace line 48 (the assistant `text` branch) with:
```ts
      if (b?.type === "text" && b.text) out.push(...renderMarkdown(String(b.text)));
```
Leave line 49 (thinking) and line 57 (user echo) **unchanged**.

- [ ] **Step 4: Wire `liveTurn.ts`**

In `tui/src/liveTurn.ts`, extend the import on line 4:
```ts
import { trunc, toolTarget, toolDiffLines } from "./render.js";
import { renderMarkdown } from "./markdown.js";
```
Replace the `text` branch in `renderBlock` (line 126):
```ts
    if (b.kind === "text") return b.text ? renderMarkdown(b.text) : [];
```
Leave the thinking branch (lines 127-129) **unchanged**.

- [ ] **Step 5: Honor `bold`/`italic` in `Transcript`**

In `tui/src/Transcript.tsx`, change line 6:
```ts
const Line = ({ l }: { l: RenderLine }) => <Text color={l.color} dimColor={l.dim} bold={l.bold} italic={l.italic}>{l.text || " "}</Text>;
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run test/render.test.ts test/liveTurn.test.ts test/components.test.tsx`
Expected: PASS.

- [ ] **Step 7: Full gate + commit**

Run: `npm run typecheck && npx vitest run`
Expected: exit 0 + green (the whole tui suite; the markdown wiring must not break existing render/liveTurn snapshots — if a pre-existing test asserted raw `{text:"**x**"}` for assistant text, update it to the markdown form, which is the new correct behavior).
```bash
git add tui/src/render.ts tui/src/liveTurn.ts tui/src/Transcript.tsx tui/test/render.test.ts tui/test/liveTurn.test.ts tui/test/components.test.tsx
git commit -m "feat(tui): render assistant + live text as markdown (thinking/user/tool lines unchanged)"
```

---

### Task 3: `<ThinkingIndicator>` + the pre-first-frame gap

**Files:**
- Create: `tui/src/ThinkingIndicator.tsx`
- Modify: `tui/src/useChat.ts` (add `turnStartedAt` to `ChatState`; set it in `submit`)
- Modify: `tui/src/ChatApp.tsx` (mount the indicator during the gap)
- Test: `tui/test/components.test.tsx` (ThinkingIndicator), `tui/test/useChat.test.tsx` (turnStartedAt)

**Interfaces:**
- Consumes: nothing new.
- Produces: `ThinkingIndicator({ startedAt, now? })`; `ChatState.turnStartedAt: number`. Task 4 also edits `useChat`/`ChatApp` — it runs after this task (sequential).

**Context:** `ChatState` is declared at `useChat.ts:29`. `submit` (`useChat.ts:~149`) sets `setStreaming([]); setBusy(true);` before `session.submit`. The `useChat` return's `state` object (`useChat.ts:~184`) lists the fields. `ChatApp.tsx` renders `<Transcript …/>` then a picker/dialog/composer ternary then `<ChatStatusBar …/>`.

- [ ] **Step 1: Write the failing test**

Add to `tui/test/components.test.tsx`:
```ts
  it("ThinkingIndicator shows a spinner frame and elapsed seconds", () => {
    const { lastFrame } = render(<ThinkingIndicator startedAt={0} now={() => 3000} />);
    expect(lastFrame()).toContain("Thinking…");
    expect(lastFrame()).toContain("3s");
  });
```
(Add `import { ThinkingIndicator } from "../src/ThinkingIndicator.js";` at the top.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/components.test.tsx`
Expected: FAIL — module `../src/ThinkingIndicator.js` not found.

- [ ] **Step 3: Create `ThinkingIndicator.tsx`**

Create `tui/src/ThinkingIndicator.tsx`:
```tsx
// tui/src/ThinkingIndicator.tsx — the pre-first-frame "thinking…" placeholder: a spinner + elapsed seconds.
// One interval, created on mount and cleared on unmount; ChatApp mounts this ONLY during the gap (busy &&
// no streamed content yet), so the timer exists only while waiting. `now` is injectable for deterministic tests.
import React, { useEffect, useState } from "react";
import { Text } from "ink";

const FRAMES = ["✨", "✦", "✧", "✦"];

export function ThinkingIndicator({ startedAt, now = Date.now }: { startedAt: number; now?: () => number }) {
  const [tick, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 120); return () => clearInterval(t); }, []);
  const frame = FRAMES[tick % FRAMES.length];
  const secs = Math.max(0, Math.floor((now() - startedAt) / 1000));
  return <Text dimColor>{`${frame} Thinking… ${secs}s`}</Text>;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run test/components.test.tsx`
Expected: PASS.

- [ ] **Step 5: Add `turnStartedAt` to `useChat`**

In `tui/src/useChat.ts`:
- Extend the `ChatState` interface (line 29) — append `turnStartedAt: number;` to the field list.
- Add state near the other `useState` calls (e.g. after `const [busy, setBusy] = useState(false);`):
```ts
  const [turnStartedAt, setTurnStartedAt] = useState(0);
```
- In `submit`, set it where the non-command turn begins — change the block that currently reads `setStreaming([]); setBusy(true);` to:
```ts
    setStreaming([]); setBusy(true); setTurnStartedAt(Date.now());
```
- Add `turnStartedAt` to the returned `state` object (the `return { state: { …, thinkLevel } as ChatState, … }` line) — insert `turnStartedAt` among the fields:
```ts
  return { state: { lines, streaming, pending, mode, busy, ctxPct, model, picker, tasks, subagentActive, thinkLevel, turnStartedAt } as ChatState, submit, resolvePermission, cycleMode, interrupt, closePicker, pickSession };
```

- [ ] **Step 6: Mount the indicator in `ChatApp`**

In `tui/src/ChatApp.tsx`:
- Add the import: `import { ThinkingIndicator } from "./ThinkingIndicator.js";`
- Right AFTER `<Transcript lines={state.lines} streaming={state.streaming} />`, add:
```tsx
      {state.busy && state.streaming.length === 0 ? <ThinkingIndicator startedAt={state.turnStartedAt} /> : null}
```

- [ ] **Step 7: Write the `useChat` turnStartedAt test**

Add to `tui/test/useChat.test.tsx` (a focused check that a turn sets `turnStartedAt` and clears `busy` on completion — mirror the existing submit tests' `Host`/`api.run` pattern):
```ts
  it("submit sets turnStartedAt and busy during the turn", async () => {
    let hung: (() => void) | null = null;
    const fake = fakeSession({ async submit(_p, onMessage) { await new Promise<void>((r) => { hung = r; }); return { result: "x" }; } });
    const api: { run?: (p: string) => void; state?: any } = {};
    function H() { const c = useChat(() => fake, createUiBroker()); api.run = c.submit; api.state = c.state; return <Text>{String(c.state.busy)}</Text>; }
    render(<H />);
    await new Promise((r) => setTimeout(r, 0));
    api.run!("hello");
    await new Promise((r) => setTimeout(r, 0));
    expect(api.state.busy).toBe(true);
    expect(api.state.turnStartedAt).toBeGreaterThan(0);
    hung?.();
  });
```
(Use the file's existing imports for `useChat`, `fakeSession`, `createUiBroker`, `render`, `Text`. If a `Host` helper already exists that exposes `state`, reuse it instead of `H`.)

- [ ] **Step 8: Run the tests + full gate + commit**

Run: `npx vitest run test/components.test.tsx test/useChat.test.tsx`
Expected: PASS.
Run: `npm run typecheck && npx vitest run`
Expected: exit 0 + green.
```bash
git add tui/src/ThinkingIndicator.tsx tui/src/useChat.ts tui/src/ChatApp.tsx tui/test/components.test.tsx tui/test/useChat.test.tsx
git commit -m "feat(tui): ThinkingIndicator — spinner+elapsed during the pre-first-frame gap"
```

---

### Task 4: `<ModelPicker>` + the `/model` picker

**Files:**
- Create: `tui/src/ModelPicker.tsx`
- Modify: `tui/src/useChat.ts` (`ChatSession` interface += `capabilities()`; `ModelInfo` import; `modelPicker` state; `/model` no-arg opens the picker; `openModelPicker`/`pickModel`/`closeModelPicker`; return additions; `ChatState` += `modelPicker`)
- Modify: `tui/src/ChatApp.tsx` (render `<ModelPicker>`; global-key gate; destructure new handlers)
- Modify: `tui/test/useChat.test.tsx` and `tui/test/chat.test.tsx` (both `fakeSession`s get a `capabilities()` stub)
- Test: `tui/test/components.test.tsx` (ModelPicker), `tui/test/useChat.test.tsx` (`/model` behavior)

**Interfaces:**
- Consumes: `ChatSession` (extended here), the existing `picker` state pattern.
- Produces: `ModelInfo { value: string; displayName?: string; description?: string }` and `ModelPicker({ models, onPick, onCancel })` from `./ModelPicker.js`; `ChatState.modelPicker: { open: boolean; models: ModelInfo[] }`; `useChat` returns `pickModel(m: ModelInfo)` and `closeModelPicker()`.

**Context:** `ChatSession` interface is at `useChat.ts:~16-26`. The existing session `picker` state (`{ open: boolean; sessions: SessionInfo[] }`, `useChat.ts:50`) + its `closePicker`/`pickSession` + `SessionPicker.tsx` are the exact template. `case "model":` is at `useChat.ts:93-95`. `ChatApp.tsx`'s render ternary is `state.picker.open ? <SessionPicker/> : state.pending ? <PermissionDialog/> : <ChatComposer/>`, and its global `useInput` is gated `isActive: !state.pending && !state.picker.open`. The real `openSession` object implements `capabilities()` (`harness/src/session/session.ts:127`); only the TS interface + the test fakes need it added.

- [ ] **Step 1: Create `ModelPicker.tsx`**

Create `tui/src/ModelPicker.tsx`:
```tsx
// tui/src/ModelPicker.tsx — the /model modal: a selectable list of available models (↑/↓ · Enter · Esc).
// Mirrors SessionPicker.tsx. Fed by the live session.capabilities().models.
import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

export interface ModelInfo { value: string; displayName?: string; description?: string }

export function ModelPicker({ models, onPick, onCancel }: { models: ModelInfo[]; onPick: (m: ModelInfo) => void; onCancel: () => void }) {
  const [idx, setIdx] = useState(0);
  useInput((_input, key) => {
    if (key.escape) { onCancel(); return; }
    if (key.upArrow) setIdx((i) => Math.max(0, i - 1));
    else if (key.downArrow) setIdx((i) => Math.min(models.length - 1, i + 1));
    else if (key.return && models[idx]) onPick(models[idx]);
  });
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Text bold>switch model  (↑/↓ · Enter · Esc)</Text>
      {models.length === 0
        ? <Text dimColor>no models</Text>
        : models.map((m, i) => <Text key={m.value} inverse={i === idx}>{`${m.displayName ?? m.value}${m.description ? "  — " + m.description : ""}`}</Text>)}
    </Box>
  );
}
```

- [ ] **Step 2: Write the failing tests**

Add to `tui/test/components.test.tsx`:
```ts
  it("ModelPicker renders models and selects on Enter", async () => {
    const picked: string[] = [];
    const models = [{ value: "claude-opus-4-8", displayName: "Opus 4.8", description: "best" }, { value: "sonnet", displayName: "Sonnet" }];
    const { lastFrame, stdin } = render(<ModelPicker models={models} onPick={(m) => picked.push(m.value)} onCancel={() => {}} />);
    expect(lastFrame()).toContain("Opus 4.8");
    expect(lastFrame()).toContain("Sonnet");
    await new Promise((r) => setTimeout(r, 0));   // let useInput subscribe before keys
    stdin.write("[B");                        // ↓ to the 2nd model
    stdin.write("\r");                              // Enter
    expect(picked).toEqual(["sonnet"]);
  });
```
(Add `import { ModelPicker } from "../src/ModelPicker.js";`.)

Add to `tui/test/useChat.test.tsx`:
```ts
  it("/model with no arg opens the model picker from capabilities()", async () => {
    const fake = fakeSession({ async capabilities() { return { models: [{ value: "claude-opus-4-8", displayName: "Opus 4.8" }], commands: [], mcpServers: [] }; } });
    const api: { run?: (p: string) => void; state?: any } = {};
    function H() { const c = useChat(() => fake, createUiBroker()); api.run = c.submit; api.state = c.state; return <Text>{String(c.state.modelPicker.open)}</Text>; }
    render(<H />);
    await new Promise((r) => setTimeout(r, 0));
    api.run!("/model");
    await new Promise((r) => setTimeout(r, 0));
    expect(api.state.modelPicker.open).toBe(true);
    expect(api.state.modelPicker.models[0].value).toBe("claude-opus-4-8");
  });
  it("/model <name> keeps the free-text fast-path (no picker, setModel called)", async () => {
    let set = "";
    const fake = fakeSession({ async setModel(m?: string) { set = m ?? ""; } });
    const api: { run?: (p: string) => void; state?: any } = {};
    function H() { const c = useChat(() => fake, createUiBroker()); api.run = c.submit; api.state = c.state; return <Text>x</Text>; }
    render(<H />);
    await new Promise((r) => setTimeout(r, 0));
    api.run!("/model sonnet");
    await new Promise((r) => setTimeout(r, 0));
    expect(set).toBe("sonnet");
    expect(api.state.modelPicker.open).toBe(false);
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run test/components.test.tsx test/useChat.test.tsx`
Expected: FAIL — `ModelPicker` missing / `state.modelPicker` undefined / `capabilities` not on `ChatSession`.

- [ ] **Step 4: Extend `ChatSession` + `ChatState` + add `modelPicker` state**

In `tui/src/useChat.ts`:
- Add to the `ChatSession` interface (after `setMaxThinkingTokens(...)`):
```ts
  capabilities(): Promise<{ models: unknown[]; commands: unknown[]; mcpServers: unknown[] }>;
```
- Add a **type-only** import near the top imports (useChat renders no component, only needs the type):
```ts
import type { ModelInfo } from "./ModelPicker.js";
```
- Extend `ChatState` (line 29) — append `modelPicker: { open: boolean; models: ModelInfo[] };`.
- Add state (after the `picker` useState, line 50):
```ts
  const [modelPicker, setModelPicker] = useState<{ open: boolean; models: ModelInfo[] }>({ open: false, models: [] });
```

- [ ] **Step 5: Open the picker on `/model` no-arg; add handlers**

In `tui/src/useChat.ts`:
- Change the `case "model":` block (lines 93-95) to:
```ts
        case "model":
          if (cmd.args) { await session.setModel(cmd.args); if (!disposed.current) setModel(cmd.args); append(formatModel(cmd.args)); }
          else { await openModelPicker(); }
          break;
```
- Add these functions near `openPicker`/`closePicker` (the session-picker helpers):
```ts
  async function openModelPicker() {
    try {
      const caps = await session.capabilities();
      if (disposed.current) return;
      const models: ModelInfo[] = (caps.models as any[]).map((m) => ({ value: String(m?.value ?? m), displayName: m?.displayName, description: m?.description }));
      if (!models.length) { append([{ text: "no models available", dim: true }]); return; }
      setModelPicker({ open: true, models });
    } catch (e) { append([{ text: `✗ ${(e as Error).message}`, color: "red" }]); }
  }
  function closeModelPicker() { if (!disposed.current) setModelPicker({ open: false, models: [] }); }
  function pickModel(m: ModelInfo) {
    if (disposed.current) return;
    setModelPicker({ open: false, models: [] });
    void (async () => { await session.setModel(m.value).catch(() => {}); if (!disposed.current) { setModel(m.value); append(formatModel(m.value)); } })();
  }
```
- Add `modelPicker` to the returned `state` and `closeModelPicker`/`pickModel` to the return:
```ts
  return { state: { lines, streaming, pending, mode, busy, ctxPct, model, picker, tasks, subagentActive, thinkLevel, turnStartedAt, modelPicker } as ChatState, submit, resolvePermission, cycleMode, interrupt, closePicker, pickSession, closeModelPicker, pickModel };
```
(`turnStartedAt` is present from Task 3.)

- [ ] **Step 6: Render `<ModelPicker>` in `ChatApp` + gate global keys**

In `tui/src/ChatApp.tsx`:
- Add the import: `import { ModelPicker } from "./ModelPicker.js";`
- Destructure the new handlers from `useChat`: add `closeModelPicker, pickModel` to the destructuring on the `useChat(...)` line.
- Change the global-key `useInput` gate to also exclude the model picker:
```ts
  }, { isActive: !state.pending && !state.picker.open && !state.modelPicker.open });
```
- Change the render ternary so the model picker takes precedence (it is a modal like the session picker):
```tsx
      {state.modelPicker.open
        ? <ModelPicker models={state.modelPicker.models} onPick={pickModel} onCancel={closeModelPicker} />
        : state.picker.open
          ? <SessionPicker sessions={state.picker.sessions} onPick={pickSession} onCancel={closePicker} />
          : state.pending
            ? <PermissionDialog req={state.pending.req} onDecision={resolvePermission} />
            : <ChatComposer onSubmit={submit} cwd={cwd} />}
```

- [ ] **Step 7: Add `capabilities()` to BOTH test fakes (paired breaking change)**

The `ChatSession` interface now requires `capabilities()`, so both fakes must implement it or their files fail to typecheck.
- In `tui/test/useChat.test.tsx`, the `fakeSession` base object (around line 17-19) — add:
```ts
    async capabilities() { return { models: [{ value: "claude-opus-4-8", displayName: "Opus 4.8" }, { value: "sonnet", displayName: "Sonnet" }], commands: [], mcpServers: [] }; },
```
- In `tui/test/chat.test.tsx`, the `fakeSession` (around line 21-22) — add the same `async capabilities() { return { models: [{ value: "claude-opus-4-8" }], commands: [], mcpServers: [] }; },`.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run test/components.test.tsx test/useChat.test.tsx test/chat.test.tsx`
Expected: PASS.

- [ ] **Step 9: Full gate + commit**

Run: `npm run typecheck && npx vitest run`
Expected: exit 0 + green.
```bash
git add tui/src/ModelPicker.tsx tui/src/useChat.ts tui/src/ChatApp.tsx tui/test/components.test.tsx tui/test/useChat.test.tsx tui/test/chat.test.tsx
git commit -m "feat(tui): /model picker — live model list via capabilities(); free-text /model <name> preserved"
```

---

### Task 5: Gated live e2e

**Files:**
- Create: `tui/test/live/model-capabilities.e2e.test.ts`

**Interfaces:**
- Consumes: `openSession` from `cc-harness` (the real `Session` with `capabilities()`/`setModel`).
- Produces: a gated test proving the live model list is reachable and `setModel` to a picked value takes effect.

**Context:** Live tests gate with `const live = process.env.ANTHROPIC_API_KEY ? describe : describe.skip;` and skip cleanly without a key. `capabilities()` is most reliable after the session has run at least one turn (probe 27 pumped a turn first), so the test submits a turn before calling it.

- [ ] **Step 1: Write the gated live test**

Create `tui/test/live/model-capabilities.e2e.test.ts`:
```ts
// tui/test/live/model-capabilities.e2e.test.ts — gated: the /model picker's data source works end-to-end.
// capabilities() returns a non-empty model list (incl. claude-opus-4-8), and setModel to a picked value takes
// effect (a subsequent turn completes). Skips keyless. Run keyed:
//   set -a; . ../.env; set +a; npx vitest run test/live/model-capabilities.e2e.test.ts
import { describe, it, expect } from "vitest";
import { openSession } from "cc-harness";

const live = process.env.ANTHROPIC_API_KEY ? describe : describe.skip;

live("model capabilities (live)", () => {
  it("capabilities() lists models incl. opus-4-8; setModel to a picked value takes effect", async () => {
    const session = openSession({ model: "claude-opus-4-8", permissionMode: "bypassPermissions" } as any);
    try {
      await session.submit("Reply with exactly the single word READY.", () => {});   // initialize the control handle
      const caps = await session.capabilities();
      const values = (caps.models as any[]).map((m) => String(m.value));
      expect(values.length).toBeGreaterThan(0);
      expect(values).toContain("claude-opus-4-8");
      await session.setModel("sonnet");
      const res = await session.submit("Reply with exactly the single word AGAIN.", () => {});
      expect(String((res as { result: unknown }).result)).toMatch(/AGAIN/i);
    } finally {
      await session.dispose();
    }
  }, 120_000);
});
```

- [ ] **Step 2: Verify it skips cleanly without a key**

Run: `npx vitest run test/live/model-capabilities.e2e.test.ts`
Expected: the suite is SKIPPED (no `ANTHROPIC_API_KEY`), exit 0. Do NOT run it keyed — the controller runs the keyed pass.

- [ ] **Step 3: Final full gate + commit**

Run: `npm run typecheck && npx vitest run`
Expected: exit 0 + green across the whole tui suite (the live test skips).
```bash
git add tui/test/live/model-capabilities.e2e.test.ts
git commit -m "test(tui): gated live e2e — capabilities() model list + setModel takes effect"
```

---

## Notes for the executor

- **Task order is dependency-correct:** Task 2 needs Task 1's `renderMarkdown`; Tasks 3 and 4 both edit `useChat.ts` + `ChatApp.tsx`, so they run sequentially (3 then 4) and Task 4's BASE includes Task 3's edits.
- **The two paired breaking changes:** Task 4 adds `capabilities()` to the `ChatSession` interface — both `useChat.test.tsx` and `chat.test.tsx` fakes must gain the stub in the SAME task or their files won't typecheck (Step 7).
- **Markdown must never touch thinking blocks** (`render.ts:49`, `liveTurn.ts:127-129`), user echoes (`render.ts:57`), or tool/diff lines — Task 2 changes only the `text` branches. A pre-existing snapshot that asserted raw markdown for assistant *text* should be updated to the parsed form (the new correct behavior); a thinking/tool assertion that changes is a bug.
- **`useInput` timing:** every component test that sends keys must `await` a tick first (Step pattern shown) so the subscription is live; use real escape sequences (`[B`, `\r`, ``).
- **Coverage/memory:** not part of these tasks — the controller refreshes `docs/parity/coverage.md` + memory after the final whole-branch review.
