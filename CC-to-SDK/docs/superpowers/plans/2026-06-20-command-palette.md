# Command Palette Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the live command catalog (skills + plugin + user commands) as an inline `/`-autocomplete in the chat REPL, and dispatch it — local commands drive the engine, catalog commands submit-as-prompt.

**Architecture:** Mirror the existing `@`-mention completion. A new pure `commandComplete.ts` (catalog types + merge + fuzzy rank), a `command` completion state in `editor.ts` parallel to `mention`, a `CommandPopup` in `ChatComposer`, and dispatch routing in `useChat`. No harness change — `Session.capabilities()` already exists.

**Tech Stack:** TypeScript; Ink chat REPL; the pure `editor.ts` reducer + `fileComplete.ts` fuzzy scorer; vitest (keyless unit + OAuth-gated live).

## Global Constraints

- **Chat REPL only; NO harness change** — everything is under `tui/src/`.
- **Mirror the `@`-mention completion** (`editor.ts` `MentionState` + `ChatComposer`'s `MentionPopup` + `fileComplete.ts`'s ranker). `command` and `mention` are **mutually exclusive**; the reducer checks `command` before `mention`/history in shared branches.
- **`/` opens a command ONLY at buffer start** (the buffer was empty before the `/`); a `/` mid-text never opens a command. Mention (`@`) behavior is unchanged.
- **Key bindings:** Enter on an open command popup **completes-and-submits** `"/name"` (runs it); Tab completes the name with a trailing space (keep typing args); Esc dismisses the popup keeping the text; ↑/↓ move the highlight; a space ends the command-name token and closes the popup.
- **Catalog:** fetched live via `session.capabilities().commands`, normalized, `mergeCommands(local, catalog)` (local wins on a name collision); on fetch failure the palette falls back to the 9 local commands.
- **Dispatch routing** (in `useChat`): a LOCAL command name → the existing engine switch; a CATALOG name → `submit("/name …")` as a turn; an unknown name → `formatUnknown`.
- **NO Prettier** (dense hand-style); **ESM `.js` import specifiers**; bare `"cc-harness"` for core imports.
- **Do NOT modify `Composer.tsx`** (the shared console input) or any non-listed file.
- **Components tested keyless** via `ink-testing-library`; **ink `useInput` timing discipline** — `await` a tick (`setTimeout 10`) before writing keys via `stdin.write`; use **real escape sequences**.
- **Build `cc-harness` before any tui typecheck/test:** `cd ../harness && npm run build && cd ../tui`.
- **Live tests gate on `ANTHROPIC_API_KEY || CLAUDE_CODE_OAUTH_TOKEN`**; the controller runs the keyed pass under OAuth; implementers stop at the clean keyless skip.
- **NO `Co-Authored-By`** in commit messages. Commands run from `tui/`.

---

### Task 1: `commandComplete.ts` — pure catalog types, merge, fuzzy rank

**Files:**
- Create: `tui/src/commandComplete.ts`
- Modify: `tui/src/commands.ts` (add `LOCAL_COMMAND_ENTRIES` + `LOCAL_NAMES`)
- Test: `tui/test/commandComplete.test.ts`

**Interfaces:**
- Consumes: `rankCandidates` from `./fileComplete.js`; `COMMANDS` from `./commands.js`.
- Produces: `interface CommandEntry { name: string; description: string; argumentHint?: string; source: "local" | "catalog" }`; `toCatalogEntry(raw: unknown): CommandEntry | null`; `mergeCommands(local: CommandEntry[], catalog: CommandEntry[]): CommandEntry[]`; `rankCommands(entries: CommandEntry[], query: string, cap?: number): CommandEntry[]`; `LOCAL_COMMAND_ENTRIES: CommandEntry[]`; `LOCAL_NAMES: Set<string>`.

- [ ] **Step 1: Write the failing test**

Create `tui/test/commandComplete.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { toCatalogEntry, mergeCommands, rankCommands, type CommandEntry } from "../src/commandComplete.js";

const cat = (name: string, description = ""): CommandEntry => ({ name, description, source: "catalog" });
const loc = (name: string): CommandEntry => ({ name, description: name, source: "local" });

describe("commandComplete", () => {
  it("toCatalogEntry normalizes object + string shapes; null on bad input", () => {
    expect(toCatalogEntry({ name: "review", description: "do a review", argumentHint: "<pr>" })).toEqual({ name: "review", description: "do a review", argumentHint: "<pr>", source: "catalog" });
    expect(toCatalogEntry("brainstorming")).toEqual({ name: "brainstorming", description: "", argumentHint: undefined, source: "catalog" });
    expect(toCatalogEntry({ description: "no name" })).toBeNull();
    expect(toCatalogEntry(null)).toBeNull();
  });
  it("mergeCommands keeps local first and local wins on a name collision", () => {
    const merged = mergeCommands([loc("model"), loc("help")], [cat("review"), cat("help")]);
    expect(merged.map((c) => c.name)).toEqual(["model", "help", "review"]);   // catalog "help" dropped (local wins)
    expect(merged.find((c) => c.name === "help")!.source).toBe("local");
  });
  it("rankCommands returns the first N for an empty query and fuzzy-filters otherwise", () => {
    const entries = [cat("brainstorming"), cat("writing-plans"), cat("review"), cat("ship")];
    expect(rankCommands(entries, "", 2).map((c) => c.name)).toEqual(["brainstorming", "writing-plans"]);
    expect(rankCommands(entries, "rev")[0].name).toBe("review");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd harness && npm run build && cd ../tui && npx vitest run test/commandComplete.test.ts`
Expected: FAIL — `Cannot find module '../src/commandComplete.js'`.

- [ ] **Step 3: Create `commandComplete.ts`**

```ts
// tui/src/commandComplete.ts — pure slash-command catalog completion: entry type, normalize, merge, fuzzy rank.
// Mirrors fileComplete.ts (the @-mention ranker) so editor.ts can drive a / command popup the same way.
import { rankCandidates } from "./fileComplete.js";

export interface CommandEntry { name: string; description: string; argumentHint?: string; source: "local" | "catalog" }

/** Normalize a raw capabilities().commands entry (object or bare string) to a CommandEntry; null on bad shape. */
export function toCatalogEntry(raw: unknown): CommandEntry | null {
  const r = raw as any;
  const name = typeof r === "string" ? r : r?.name;
  if (!name || typeof name !== "string") return null;
  return { name, description: typeof r?.description === "string" ? r.description : "", argumentHint: r?.argumentHint || undefined, source: "catalog" };
}

/** Merge local commands with the live catalog; local wins on a name collision; local-first order then catalog. */
export function mergeCommands(local: CommandEntry[], catalog: CommandEntry[]): CommandEntry[] {
  const seen = new Set(local.map((c) => c.name));
  return [...local, ...catalog.filter((c) => !seen.has(c.name))];
}

/** Fuzzy-rank entries by query on the name; empty query → catalog order capped; reuses fileComplete's scorer. */
export function rankCommands(entries: CommandEntry[], query: string, cap = 8): CommandEntry[] {
  if (!query) return entries.slice(0, cap);
  const byName = new Map(entries.map((e) => [e.name, e]));
  return rankCandidates(entries.map((e) => e.name), query, cap).map((c) => byName.get(c.path)).filter((e): e is CommandEntry => !!e);
}
```

- [ ] **Step 4: Add the local-command projections to `commands.ts`**

At the top of `tui/src/commands.ts`, add the import (with the other imports):

```ts
import type { CommandEntry } from "./commandComplete.js";
```

After the `COMMANDS` array (`commands.ts:28`), add:

```ts
/** The 9 local engine-driving commands as CommandEntry[] (the palette merges these with the live catalog). */
export const LOCAL_COMMAND_ENTRIES: CommandEntry[] = COMMANDS.map((c) => ({ name: c.name, description: c.summary, source: "local" }));
/** Local command names — dispatch routes these to the engine switch (never submit-as-prompt). */
export const LOCAL_NAMES = new Set(COMMANDS.map((c) => c.name));
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd tui && npx vitest run test/commandComplete.test.ts`
Expected: PASS (3 cases). Then `npm run typecheck`.

- [ ] **Step 6: Commit**

```bash
git add tui/src/commandComplete.ts tui/src/commands.ts tui/test/commandComplete.test.ts
git commit -m "feat(chat): commandComplete.ts — catalog entry type, merge (local wins), fuzzy rank"
```

---

### Task 2: `editor.ts` — a `command` completion state parallel to `mention`

**Files:**
- Modify: `tui/src/editor.ts`
- Test: `tui/test/editor.test.ts`

**Interfaces:**
- Consumes: `CommandEntry`, `rankCommands` from `./commandComplete.js`.
- Produces: `interface CommandState { query: string; items: CommandEntry[]; catalog: CommandEntry[]; index: number }`; `EditorState` gains `command: CommandState | null`; `setCommandCatalog(s: EditorState, catalog: CommandEntry[]): EditorState`. Behavior: `/` at buffer start opens a command; Tab → `completeCommandName`; Enter → `submitCommand` (`submit: "/name"`); space/Esc/cursor-leave close it; ↑/↓ move the highlight.

- [ ] **Step 1: Write the failing tests**

Add to `tui/test/editor.test.ts` — extend the import on line 4 and append a new `describe`:

```ts
import { applyKey, initialEditorState, setMentionFiles, setCommandCatalog, stripPasteMarkers, type EditorState, type KeyFlags } from "../src/editor.js";
import type { CommandEntry } from "../src/commandComplete.js";
```

```ts
describe("editor / command palette", () => {
  const CAT: CommandEntry[] = [
    { name: "brainstorming", description: "plan a feature", source: "catalog" },
    { name: "review", description: "review code", source: "catalog" },
    { name: "model", description: "switch model", source: "local" },
  ];
  const open = () => setCommandCatalog(type(initialEditorState(), "/"), CAT);
  it("opens a command popup on a buffer-leading '/' and lists the catalog", () => {
    const s = open();
    expect(s.command).not.toBeNull();
    expect(s.command!.items.length).toBe(3);
  });
  it("does NOT open a command when '/' is not at buffer start", () => {
    let s = type(initialEditorState(), "a"); s = type(s, "/");
    expect(s.command).toBeNull();
  });
  it("filters the catalog as the query is typed", () => {
    let s = open(); s = type(s, "rev");
    expect(s.command!.query).toBe("rev");
    expect(s.command!.items[0].name).toBe("review");
  });
  it("Tab completes the highlighted command name and closes the popup", () => {
    let s = open(); s = type(s, "br");
    s = press(s, { tab: true });
    expect(s.command).toBeNull();
    expect(text(s)).toBe("/brainstorming ");
  });
  it("Enter on an open command submits '/name' (runs it)", () => {
    let s = open(); s = type(s, "br");
    const r = applyKey(s, "", { return: true });
    expect(r.submit).toBe("/brainstorming");
    expect(r.state.command).toBeNull();
  });
  it("a space ends the command name and closes the popup (now typing args)", () => {
    let s = open(); s = type(s, "review"); s = type(s, " ");
    expect(s.command).toBeNull();
    expect(text(s)).toBe("/review ");
  });
  it("Esc closes the command popup but keeps the typed text", () => {
    let s = open(); s = type(s, "re"); s = press(s, { escape: true });
    expect(s.command).toBeNull();
    expect(text(s)).toBe("/re");
  });
  it("Up/Down move the command highlight", () => {
    let s = open(); s = press(s, { downArrow: true });
    expect(s.command!.index).toBe(1);
  });
  it("the @-mention path still works (regression)", () => {
    let s = type(initialEditorState(), "@"); s = setMentionFiles(s, ["a.ts", "b.ts"]);
    expect(s.mention!.items.length).toBe(2);
    expect(s.command).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd harness && npm run build && cd ../tui && npx vitest run test/editor.test.ts`
Expected: FAIL — `setCommandCatalog` is not exported / `EditorState.command` does not exist.

- [ ] **Step 3: Add the command state + reducer to `editor.ts`**

Extend the imports at the top of `tui/src/editor.ts`:

```ts
import { rankCandidates } from "./fileComplete.js";
import { rankCommands, type CommandEntry } from "./commandComplete.js";
```

Add the `CommandState` type and extend `EditorState` (replace the `EditorState` interface):

```ts
export interface CommandState { query: string; items: CommandEntry[]; catalog: CommandEntry[]; index: number }
export interface EditorState {
  lines: string[]; cursor: Cursor; history: string[]; histIndex: number | null; stash: string | null; mention: MentionState | null; command: CommandState | null;
}
```

In `initialEditorState`, add `command: null` to the returned object:

```ts
export function initialEditorState(history: string[] = []): EditorState {
  return { lines: [""], cursor: { row: 0, col: 0 }, history: [...history], histIndex: null, stash: null, mention: null, command: null };
}
```

Add these functions (place them right after `setMentionFiles`, before `onUp`):

```ts
function openCommand(s: EditorState): EditorState {
  return { ...s, command: { query: "", items: [], catalog: [], index: 0 } };       // anchor is implicit: the '/' at row 0 col 0
}
function refreshCommand(s: EditorState): EditorState {
  const c = s.command; if (!c) return s; const { row, col } = s.cursor;
  if (row !== 0 || col <= 0 || s.lines[0][0] !== "/") return { ...s, command: null };  // cursor left the leading-slash token
  const query = s.lines[0].slice(1, col);
  if (/\s/.test(query)) return { ...s, command: null };                                // a space ends the command name
  return { ...s, command: { ...c, query, items: rankCommands(c.catalog, query), index: 0 } };
}
export function setCommandCatalog(s: EditorState, catalog: CommandEntry[]): EditorState {
  if (!s.command) return s;
  return { ...s, command: { ...s.command, catalog, items: rankCommands(catalog, s.command.query), index: 0 } };
}
function moveCommand(s: EditorState, delta: number): EditorState {
  const c = s.command!; if (c.items.length === 0) return s;
  return { ...s, command: { ...c, index: Math.max(0, Math.min(c.items.length - 1, c.index + delta)) } };
}
function completeCommandName(s: EditorState): EditorState {
  const c = s.command; if (!c || c.items.length === 0) return { ...s, command: null };
  const name = c.items[Math.min(c.index, c.items.length - 1)].name;
  const repl = "/" + name + " ";
  const lines = [...s.lines]; lines[0] = repl + s.lines[0].slice(s.cursor.col);
  return { ...s, lines, cursor: { row: 0, col: repl.length }, command: null };
}
function submitCommand(s: EditorState): EditorResult {
  const c = s.command!;
  const name = c.items.length ? c.items[Math.min(c.index, c.items.length - 1)].name : s.lines[0].slice(1);
  const t = "/" + name;
  const history = s.history.length && s.history[s.history.length - 1] === t ? s.history : [...s.history, t];
  return { state: initialEditorState(history), submit: t };
}
const syncCompletions = (s: EditorState): EditorState => (s.command ? refreshCommand(s) : (s.mention ? refreshMention(s) : s));
```

Replace `afterInsert` (it must check command first, then the buffer-leading `/`, then mention):

```ts
function afterInsert(next: EditorState, prev: EditorState, t: string): EditorState {
  if (prev.command) return refreshCommand(next);                                            // command open → refresh (no mention)
  if (t === "/" && prev.lines.length === 1 && prev.lines[0] === "") return openCommand(next); // buffer-leading '/'
  if (t === "@" && atWordBoundary(next)) return openMention(next);
  return prev.mention ? refreshMention(next) : next;
}
```

Replace `onUp`/`onDown` so command navigation wins:

```ts
function onUp(s: EditorState): EditorState { if (s.command) return moveCommand(s, -1); if (s.mention) return moveMention(s, -1); if (s.cursor.row === 0) return historyPrev(s); return moveCursorVert(s, -1); }
function onDown(s: EditorState): EditorState { if (s.command) return moveCommand(s, 1); if (s.mention) return moveMention(s, 1); if (s.cursor.row === s.lines.length - 1) return historyNext(s); return moveCursorVert(s, 1); }
```

Replace `applyKey` (command checks ahead of mention/submit; `syncCompletions` replaces `syncMention`):

```ts
export function applyKey(s: EditorState, input: string, key: KeyFlags): EditorResult {
  if (key.return) {
    if (s.lines[s.cursor.row].endsWith("\\")) return { state: continueLine(s) };
    if (s.command) return submitCommand(s);
    if (s.mention) return { state: acceptMention(s) };
    return submitTurn(s);
  }
  if (key.tab) { if (s.command) return { state: completeCommandName(s) }; return { state: s.mention ? acceptMention(s) : s }; }
  if (key.escape) { if (s.command) return { state: { ...s, command: null } }; return { state: s.mention ? { ...s, mention: null } : s }; }
  if (key.backspace || key.delete) return { state: syncCompletions(deleteLeft(s)) };
  if (key.leftArrow) return { state: syncCompletions(moveLeft(s)) };
  if (key.rightArrow) return { state: syncCompletions(moveRight(s)) };
  if (key.upArrow) return { state: onUp(s) };
  if (key.downArrow) return { state: onDown(s) };
  if (input) { const t = stripPasteMarkers(input); if (!t) return { state: s }; return { state: afterInsert(insertText(s, t), s, t) }; }
  return { state: s };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd tui && npx vitest run test/editor.test.ts`
Expected: PASS (the 9 new command cases + all pre-existing core/history/mention cases — the mention regression case confirms `@` is untouched). Then `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add tui/src/editor.ts tui/test/editor.test.ts
git commit -m "feat(chat): editor command-completion state (/ palette) parallel to @-mention"
```

---

### Task 3: `ChatComposer.tsx` — `CommandPopup` + catalog injection

**Files:**
- Modify: `tui/src/ChatComposer.tsx`
- Test: `tui/test/components.test.tsx`

**Interfaces:**
- Consumes: `setCommandCatalog` from `./editor.js`; `CommandEntry` from `./commandComplete.js`; `state.command` (Task 2).
- Produces: `ChatComposer` gains a required prop `commandCatalog: CommandEntry[]`; renders a `CommandPopup` when `state.command` is set; injects the catalog the first time a command opens.

- [ ] **Step 1: Write the failing test**

Add to `tui/test/components.test.tsx` (import `ChatComposer` at the top alongside the other component imports — `import { ChatComposer } from "../src/ChatComposer.js";`):

```ts
  it("ChatComposer shows the command palette on '/' and filters as you type", async () => {
    const CAT = [{ name: "brainstorming", description: "plan", source: "catalog" }, { name: "review", description: "review code", source: "catalog" }] as any;
    const { stdin, lastFrame } = render(<ChatComposer onSubmit={() => {}} cwd="/tmp" commandCatalog={CAT} />);
    await new Promise((r) => setTimeout(r, 10));        // let useInput subscribe (passive effect)
    stdin.write("/");
    await new Promise((r) => setTimeout(r, 10));        // open + catalog-injection effect
    expect(lastFrame()).toContain("/brainstorming");
    expect(lastFrame()).toContain("/review");
    stdin.write("rev");
    await new Promise((r) => setTimeout(r, 10));
    expect(lastFrame()).toContain("/review");
    expect(lastFrame()).not.toContain("/brainstorming");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd harness && npm run build && cd ../tui && npx vitest run test/components.test.tsx`
Expected: FAIL — `ChatComposer` has no `commandCatalog` prop and renders no command popup.

- [ ] **Step 3: Add the `CommandPopup` + catalog injection to `ChatComposer.tsx`**

Extend the imports:

```ts
import { applyKey, initialEditorState, setMentionFiles, setCommandCatalog, type EditorState } from "./editor.js";
import { collectFiles, type DirEnt } from "./fileComplete.js";
import type { CommandEntry } from "./commandComplete.js";
```

Add a `CommandPopup` (place after `MentionPopup`). Use the Box-row pattern (NOT nested `<Text inverse>`-in-`<Text>`, per the existing layout note) so the name highlights without bleeding:

```ts
function CommandPopup({ state }: { state: EditorState }) {
  const c = state.command!;
  if (c.items.length === 0) return <Box paddingX={1}><Text dimColor>/{c.query} — no matches</Text></Box>;
  const start = Math.max(0, Math.min(c.index - 3, Math.max(0, c.items.length - 8)));
  const visible = c.items.slice(start, start + 8);
  return (
    <Box flexDirection="column" paddingX={1}>
      {visible.map((e, i) => (
        <Box key={e.name} flexDirection="row">
          <Text inverse={start + i === c.index}>/{e.name}</Text>
          {e.description ? <Text dimColor>{"  " + e.description.split("\n")[0].slice(0, 48)}</Text> : null}
        </Box>
      ))}
    </Box>
  );
}
```

Change the `ChatComposer` signature to accept `commandCatalog`, add the injection effect, and render the popup. Replace the function:

```ts
export function ChatComposer({ onSubmit, cwd, commandCatalog }: { onSubmit: (text: string) => void; cwd: string; commandCatalog: CommandEntry[] }) {
  const [state, setState] = useState<EditorState>(() => initialEditorState());
  const stateRef = useRef(state);
  stateRef.current = state;
  const disposed = useRef(false);
  useEffect(() => () => { disposed.current = true; }, []);

  useInput((input, key) => { const r = applyKey(stateRef.current, input, key); if (r.submit != null) onSubmit(r.submit); setState(r.state); });

  const needWalk = state.mention != null && state.mention.files.length === 0;
  useEffect(() => {
    if (!needWalk) return;
    const files = collectFiles(cwd, realReaddir);
    if (!disposed.current) setState((s) => setMentionFiles(s, files));
  }, [needWalk, cwd]);

  // First time a command popup opens with an empty catalog, feed in the live catalog (mirrors the mention walk).
  const needCatalog = state.command != null && state.command.catalog.length === 0 && commandCatalog.length > 0;
  useEffect(() => {
    if (!needCatalog) return;
    if (!disposed.current) setState((s) => setCommandCatalog(s, commandCatalog));
  }, [needCatalog, commandCatalog]);

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" paddingX={1}><Text>{"› "}</Text><Box flexDirection="column">{renderBuffer(state)}</Box></Box>
      {state.mention ? <MentionPopup state={state} /> : null}
      {state.command ? <CommandPopup state={state} /> : null}
    </Box>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd tui && npx vitest run test/components.test.tsx`
Expected: PASS (the new ChatComposer case + all pre-existing component cases). Then `npm run typecheck` — this will surface that `ChatApp.tsx` now needs to pass `commandCatalog` (fixed in Task 4); for THIS task, typecheck of the test + component compiles because the test supplies the prop. If `npm run typecheck` flags `ChatApp.tsx` missing the prop, that is expected and Task 4 resolves it — note it in your report and proceed (do not edit ChatApp here).

- [ ] **Step 5: Commit**

```bash
git add tui/src/ChatComposer.tsx tui/test/components.test.tsx
git commit -m "feat(chat): CommandPopup in ChatComposer + live-catalog injection"
```

---

### Task 4: `useChat.ts` + `ChatApp.tsx` — fetch the catalog, route dispatch, thread the prop

**Files:**
- Modify: `tui/src/useChat.ts`
- Modify: `tui/src/ChatApp.tsx`
- Test: `tui/test/useChat.test.tsx`

**Interfaces:**
- Consumes: `LOCAL_COMMAND_ENTRIES`, `LOCAL_NAMES` from `./commands.js`; `mergeCommands`, `toCatalogEntry`, `CommandEntry` from `./commandComplete.js`; `ChatComposer`'s `commandCatalog` prop (Task 3).
- Produces: `ChatState` gains `commandCatalog: CommandEntry[]`; `submit` routes a catalog command to a turn; the catalog is fetched from `session.capabilities().commands` on session init.

- [ ] **Step 1: Write the failing test**

Add to `tui/test/useChat.test.tsx`, inside `describe("useChat", …)`:

```ts
  it("a catalog command (not local) is submitted as a turn, not treated as unknown", async () => {
    const submitted: string[] = [];
    const fake = fakeSession({
      async capabilities() { return { models: [], commands: [{ name: "review", description: "review code" }], mcpServers: [] }; },
      async submit(p: string, onMessage: (m: unknown) => void) { submitted.push(p); onMessage({ type: "assistant", message: { content: [{ type: "text", text: "ok" }] } }); return { result: "ok" }; },
    });
    const api: { run?: (s: string) => void } = {};
    function H() { const c = useChat(() => fake, createUiBroker()); api.run = c.submit; return <Text>{(c.state as any).commandCatalog.map((e: any) => e.name).join(",")}</Text>; }
    const { lastFrame } = render(<H />);
    await waitFor(() => frame(lastFrame).includes("review"));     // wait for the init catalog fetch
    api.run!("/review");
    await waitFor(() => submitted.includes("/review"));
    expect(submitted).toContain("/review");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd harness && npm run build && cd ../tui && npx vitest run test/useChat.test.tsx`
Expected: FAIL — `state.commandCatalog` is undefined and `/review` routes to `formatUnknown` (never submitted).

- [ ] **Step 3: Wire the catalog fetch, routing, and `runTurn` in `useChat.ts`**

Extend the `commands.js` import (line 9) and add the `commandComplete.js` import:

```ts
import { parseCommand, formatHelp, formatModel, formatThink, formatCompact, formatContext, formatUnknown, pickMostRecent, LOCAL_COMMAND_ENTRIES, LOCAL_NAMES, type ParsedCommand, type InitialResume } from "./commands.js";
import { mergeCommands, toCatalogEntry, type CommandEntry } from "./commandComplete.js";
```

Add `commandCatalog` to `ChatState` (extend the interface on line 31):

```ts
export interface ChatState { lines: RenderLine[]; streaming: RenderLine[]; pending: Pending | null; mode: string; busy: boolean; ctxPct?: number; model?: string; picker: { open: boolean; sessions: SessionInfo[] }; tasks: TaskItem[]; subagentActive: boolean; thinkLevel: string; turnStartedAt: number; modelPicker: { open: boolean; models: ModelInfo[] }; commandCatalog: CommandEntry[]; }
```

Add the catalog state + names ref (near the other `useState`s, e.g. after the `modelPicker` state on line 54):

```ts
  const [commandCatalog, setCommandCatalog] = useState<CommandEntry[]>(LOCAL_COMMAND_ENTRIES);   // local-only until the live fetch resolves
  const catalogNames = useRef<Set<string>>(new Set());                                            // catalog (non-local) names → routed to submit-as-prompt
```

Add the init fetch effect (after the existing `useEffect`s, e.g. after the launch-resume effect on line 82):

```ts
  // Fetch the live command catalog once per session (capabilities() works pre-turn — probe 29). On a /resume
  // swap the session changes → re-fetch. A failure/empty leaves the local-only palette (still fully usable).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const caps = await session.capabilities();
        if (cancelled || disposed.current) return;
        const catalog = (caps.commands as unknown[]).map(toCatalogEntry).filter((e): e is CommandEntry => !!e);
        catalogNames.current = new Set(catalog.map((c) => c.name));
        setCommandCatalog(mergeCommands(LOCAL_COMMAND_ENTRIES, catalog));
      } catch { /* keep the local-only catalog */ }
    })();
    return () => { cancelled = true; };
  }, [session]);
```

Extract the turn body into `runTurn` and route `submit` (replace the existing `submit` function on lines 169-179):

```ts
  function runTurn(prompt: string) {
    setLines((l) => [...l, { text: `› ${prompt}`, dim: true }]);
    setStreaming([]); setBusy(true); setTurnStartedAt(Date.now());
    const lt = new LiveTurn();
    session.submit(prompt, (m) => { if (disposed.current) return; lt.ingest(m); taskListRef.current.ingest(m); setStreaming(lt.snapshot()); setTasks(taskListRef.current.snapshot()); setSubagentActive(lt.subagentActive); })
      .then(() => {}, (e) => { lt.fail((e as Error).message); })
      .finally(() => { if (disposed.current) return; setLines((l) => [...l, ...lt.finalize()]); setStreaming([]); setBusy(false); setSubagentActive(false); if (lt.model) setModel(lt.model); void refreshCtx(); });
  }
  function submit(prompt: string) {
    if (disposed.current || busy || !prompt.trim()) return;
    const cmd = parseCommand(prompt);
    if (cmd) {
      if (LOCAL_NAMES.has(cmd.name)) { void handleCommand(cmd); return; }      // local → engine switch
      if (catalogNames.current.has(cmd.name)) { runTurn(prompt); return; }     // catalog → run "/name …" as a turn (probe 31)
      void handleCommand(cmd); return;                                          // unknown → formatUnknown (switch default)
    }
    runTurn(prompt);
  }
```

Add `commandCatalog` to the returned `state` object (extend the `return` on line 204):

```ts
  return { state: { lines, streaming, pending, mode, busy, ctxPct, model, picker, tasks, subagentActive, thinkLevel, turnStartedAt, modelPicker, commandCatalog } as ChatState, submit, resolvePermission, cycleMode, interrupt, closePicker, pickSession, closeModelPicker, pickModel };
```

- [ ] **Step 4: Thread the prop in `ChatApp.tsx`**

In `tui/src/ChatApp.tsx`, pass the catalog to the composer (the `<ChatComposer>` on line 35):

```ts
            : <ChatComposer onSubmit={submit} cwd={cwd} commandCatalog={state.commandCatalog} />}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd tui && npx vitest run test/useChat.test.tsx`
Expected: PASS — the new catalog-dispatch case AND the pre-existing "dispatches /model … /zzz → Unknown" case (its fakeSession returns `commands: []`, so the catalog is local-only, `/zzz` stays unknown, and `submitted` stays 0). Then `npm run typecheck` (now clean — `ChatApp` supplies the prop).

- [ ] **Step 6: Commit**

```bash
git add tui/src/useChat.ts tui/src/ChatApp.tsx tui/test/useChat.test.tsx
git commit -m "feat(chat): fetch live command catalog + route catalog commands to submit-as-prompt"
```

---

### Task 5: OAuth-gated live e2e — the catalog is non-empty headless

**Files:**
- Create: `tui/test/live/command-catalog.e2e.test.ts`

**Interfaces:**
- Consumes: `openSession` from `cc-harness`; `Session.capabilities()`.
- Produces: end-to-end proof that `capabilities().commands` returns a non-empty list of named commands headless.

- [ ] **Step 1: Write the gated live test**

Create `tui/test/live/command-catalog.e2e.test.ts` (modeled on `test/live/model-capabilities.e2e.test.ts`):

```ts
// tui/test/live/command-catalog.e2e.test.ts — gated: the live SDK exposes a non-empty slash-command catalog
// headless (probe 30 = 105 entries; the palette is fed from this). Cheap — does NOT run a skill command (those
// are long agentic turns; a non-goal). Run keyed (OAuth bills subscription):
//   set -a; . ../.env; set +a; unset ANTHROPIC_API_KEY; npx vitest run test/live/command-catalog.e2e.test.ts
import { describe, it, expect } from "vitest";
import { openSession } from "cc-harness";

const live = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) ? describe : describe.skip;

live("command catalog (live)", () => {
  it("capabilities().commands returns a non-empty catalog of named commands", async () => {
    const s = openSession({ model: "claude-opus-4-8", permissionMode: "bypassPermissions" } as any);
    try {
      await s.submit("Reply with exactly the single word OK.", () => {});   // prime the control channel
      const caps = await s.capabilities();
      const cmds = caps.commands as Array<{ name?: string }>;
      expect(Array.isArray(cmds)).toBe(true);
      expect(cmds.length).toBeGreaterThan(0);
      expect(typeof cmds[0]?.name).toBe("string");
    } finally {
      await s.dispose();
    }
  }, 120_000);
});
```

- [ ] **Step 2: Verify it skips cleanly without a key**

Run: `cd tui && npx vitest run test/live/command-catalog.e2e.test.ts`
Expected: the suite SKIPS (no key/token in the implementer's shell) — `0 passed`, no failure. **Implementers stop here** (the controller runs the keyed pass under OAuth).

- [ ] **Step 3: Commit**

```bash
git add tui/test/live/command-catalog.e2e.test.ts
git commit -m "test(chat): gated live e2e — capabilities().commands non-empty headless"
```

---

## Self-Review

**1. Spec coverage:**
- D1 (commandComplete: CommandEntry/toCatalogEntry/mergeCommands/rankCommands) → Task 1. ✔
- D2 (editor command state, open/refresh/inject/move/complete/submit, Enter-submits divergence) → Task 2. ✔
- D3 (CommandPopup + catalog prop + injection) → Task 3. ✔
- D4 (useChat catalog fetch + dispatch routing + state) → Task 4. ✔
- D5 (ChatApp thread the prop) → Task 4 Step 4. ✔
- Live e2e (catalog non-empty, cheap) → Task 5. ✔
- Non-goals (no disk install, no console palette, built-ins stay local, no long-skill test, no arg-completion) → none introduced. ✔

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code; every test step shows assertions. ✔

**3. Type consistency:** `CommandEntry` (defined Task 1) used identically in editor (Task 2), ChatComposer (Task 3), useChat (Task 4). `setCommandCatalog` is the editor injector (Task 2/3); the useChat state setter is also named `setCommandCatalog` but lives in `useChat.ts` which does NOT import the editor injector — no collision (noted in Task 4). `LOCAL_NAMES`/`LOCAL_COMMAND_ENTRIES` (Task 1) consumed in Task 4. `rankCommands` signature `(entries, query, cap?)` consistent. Routing precedence (local → catalog → unknown) matches the spec. ✔

## Execution
REQUIRED SUB-SKILL: superpowers:subagent-driven-development — fresh implementer per task, task review (spec + quality) after each, broad whole-branch review at the end, then the controller runs the keyed live pass under OAuth.
