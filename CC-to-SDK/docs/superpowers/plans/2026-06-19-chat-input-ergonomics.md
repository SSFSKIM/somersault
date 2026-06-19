# Chat Input Ergonomics (Increment 8) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `cc-harness-chat`'s single-line input with a real editor — multiline editing (`\`-continuation + paste), in-memory prompt history, and `@`-mention fuzzy file completion — so the chat REPL's input feels like real Claude Code.

**Architecture:** A pure, synchronous editor reducer (`editor.ts`: `EditorState` + `applyKey`) holds the entire editing model with no React/Ink/fs; a pure ranker (`fileComplete.ts`) takes an injected `readdir` so the recursive walk is testable without disk; a thin presentational `ChatComposer.tsx` routes Ink `useInput` keys into the reducer, renders the buffer with an inverse-char cursor + the `@`-popup, and owns the one side effect (the walk). The shared console `<Composer>` is never touched.

**Tech Stack:** TypeScript, React 18, Ink 5, Vitest 2, ink-testing-library 4. Package `cc-harness-tui` (`CC-to-SDK/tui/`), engine `cc-harness` (`file:../harness`).

## Global Constraints

- **NO Prettier — dense hand-style:** compact, multi-statement lines; match surrounding code.
- **ESM `.js` import specifiers** in `tui/` (`from "./editor.js"`); bare `"cc-harness"` for engine imports.
- **`editor.ts` and `fileComplete.ts` stay PURE** — no React/Ink/fs imports; the only impurity (the FS walk) is injected (`readdir`) and owned by the component. `editor.ts` may import the pure `rankCandidates` from `fileComplete.ts`; `fileComplete.ts` may `import type` `Candidate` from `editor.ts` (type-only, no runtime cycle).
- **Never mutate the shared `Composer.tsx`** (used by the console `App.tsx`) — build the new `ChatComposer.tsx` instead.
- **ink `useInput` passive-effect timing discipline:** component tests **`await` a render tick / `waitFor`** BEFORE writing keys. **Never** raw `stdin.on`; **never** mutate shared components. Real escape sequences only (`\x1b[B`/`\x1b[A`/`\x1b`/`\r`; bare `[B` is a literal string, NOT an arrow).
- **Test files run SEQUENTIALLY** — `tui/vitest.config.ts` has `fileParallelism:false` (leave it).
- **No new `cc-harness` public exports** (all work in `tui/`) → no API-STABILITY / index.test pin, **no harness rebuild**.
- **Live tests gate** on `ANTHROPIC_API_KEY` (`const live = process.env.ANTHROPIC_API_KEY ? describe : describe.skip`), read from `CC-to-SDK/.env` (gitignored — never commit/print it); keyless suites skip cleanly.
- Commands run **from `tui/`**: `npm run typecheck`, `npx vitest run test/<file>`, `npm run build`. Live: `set -a; . ../.env; set +a; npx vitest run test/live/<file>`.
- Commit messages: plain, no `Co-Authored-By` / attribution.

## Grounding (already done — not a task)

Probe `tui/probes/ink-paste-key-delivery.tsx` (committed `17d7116b0e`) established, via `ink-testing-library`: **a multi-char/multi-line write arrives as ONE `useInput` call** (`input` = the whole string, embedded `\n`/`\r` intact, `key.return` NOT set) → **paste = insert-and-split**, no per-char accretion; **submit = a lone `key.return`** (`input="\r"`; a lone `\n` does not set it); **`\`-continuation = two separate interactive events** (`\` then Enter), so on Enter we check "does the current line end with `\`?"; **Ink does NOT strip bracketed-paste markers** → strip `\x1b[200~`/`\x1b[201~` defensively. `probes/` is outside the tsconfig scope (`include: ["src","test"]`), so it doesn't affect typecheck.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `tui/src/editor.ts` (create) | pure editor reducer: types, `initialEditorState`, core editing (T1); history recall (T2); `@`-mention routing (T4) | 1,2,4 |
| `tui/test/editor.test.ts` (create) | reducer units (core T1; history T2; mention T4) | 1,2,4 |
| `tui/src/fileComplete.ts` (create) | pure `collectFiles(cwd, readdir)` walk + `rankCandidates(files, query, cap)` fuzzy ranker | 3 |
| `tui/test/fileComplete.test.ts` (create) | walk (fake fs, ignores, cap) + ranking units | 3 |
| `tui/src/ChatComposer.tsx` (create) | presentational: `useInput`→reducer, buffer+cursor+`@`-popup render, owns the walk effect | 5 |
| `tui/test/components.test.tsx` (modify) | `ChatComposer` component test (fixture cwd) | 5 |
| `tui/src/ChatApp.tsx` (modify) | accept `cwd` prop; swap `<Composer>`→`<ChatComposer>` | 6 |
| `tui/src/chat.tsx` (modify) | thread `cwd={base.cwd}` into `<ChatApp>` | 6 |
| `tui/test/chat.test.tsx` (modify) | adjust/confirm chat tests still green with the new composer | 6 |
| `tui/test/live/chat-input.e2e.test.ts` (create) | gated live: multiline prompt completes a turn | 7 |
| `docs/parity/coverage.md` (modify) + memory | Domain 10 refresh | 8 |

---

### Task 1: `editor.ts` — core editing model (types + cursor + insert + backspace + submit + `\`-continuation)

**Files:** Create `tui/src/editor.ts`, `tui/test/editor.test.ts`.

**Interfaces:**
- Produces: `interface Cursor { row: number; col: number }`; `interface Candidate { path: string; score: number }`; `interface MentionState { anchor: Cursor; query: string; files: string[]; items: Candidate[]; index: number }`; `interface EditorState { lines: string[]; cursor: Cursor; history: string[]; histIndex: number | null; stash: string | null; mention: MentionState | null }`; `interface EditorResult { state: EditorState; submit?: string }`; `interface KeyFlags { return?; backspace?; delete?; leftArrow?; rightArrow?; upArrow?; downArrow?; escape?; tab?: boolean }`; `initialEditorState(history?: string[]): EditorState`; `applyKey(state, input: string, key: KeyFlags): EditorResult`; `stripPasteMarkers(s: string): string`. Used by Tasks 2,3,4,5. The full `EditorState` shape (incl. `history`/`mention`) is defined now (per spec §4.1) to avoid cross-task type churn; history routing lands in T2, mention routing in T4.

- [ ] **Step 1: Write the failing test** — create `tui/test/editor.test.ts`:

```ts
// tui/test/editor.test.ts — pure editor-reducer units. Probe 17d7116: a paste arrives as one `input` with
// embedded \n; submit = a lone key.return; `\`+Enter = continuation.
import { describe, it, expect } from "vitest";
import { applyKey, initialEditorState, stripPasteMarkers, type EditorState, type KeyFlags } from "../src/editor.js";

const type = (s: EditorState, text: string): EditorState => applyKey(s, text, {}).state;
const press = (s: EditorState, key: KeyFlags): EditorState => applyKey(s, "", key).state;
const text = (s: EditorState): string => s.lines.join("\n");

describe("editor core", () => {
  it("inserts characters and tracks the cursor", () => {
    let s = initialEditorState();
    s = type(s, "h"); s = type(s, "i");
    expect(text(s)).toBe("hi");
    expect(s.cursor).toEqual({ row: 0, col: 2 });
  });
  it("inserts a multi-line paste as one input, splitting on \\n", () => {
    let s = initialEditorState();
    s = type(s, "a\nb\nc");                       // probe: a paste is a single input call
    expect(s.lines).toEqual(["a", "b", "c"]);
    expect(s.cursor).toEqual({ row: 2, col: 1 });
  });
  it("strips bracketed-paste markers before inserting", () => {
    expect(stripPasteMarkers("\x1b[200~hi\x1b[201~")).toBe("hi");
    expect(stripPasteMarkers("[200~hi[201~")).toBe("hi");          // ESC-stripped leak (probe case D)
    let s = type(initialEditorState(), "\x1b[200~x\x1b[201~");
    expect(text(s)).toBe("x");
  });
  it("backspace deletes left and joins lines at column 0", () => {
    let s = type(initialEditorState(), "ab");
    s = press(s, { backspace: true });
    expect(text(s)).toBe("a");
    s = initialEditorState(); s = type(s, "a\nb");                  // cursor at {1,1}
    s = press(s, { leftArrow: true });                             // cursor {1,0}
    s = press(s, { backspace: true });                             // join: "ab"
    expect(s.lines).toEqual(["ab"]);
    expect(s.cursor).toEqual({ row: 0, col: 1 });
  });
  it("Enter submits the joined buffer and resets, recording history", () => {
    let s = type(initialEditorState(), "hello");
    const r = applyKey(s, "", { return: true });
    expect(r.submit).toBe("hello");
    expect(r.state.lines).toEqual([""]);                            // reset
    expect(r.state.history).toEqual(["hello"]);                     // recorded
  });
  it("ignores a whitespace-only submit", () => {
    const r = applyKey(type(initialEditorState(), "   "), "", { return: true });
    expect(r.submit).toBeUndefined();
  });
  it("`\\`+Enter inserts a newline (continuation) instead of submitting", () => {
    let s = type(initialEditorState(), "foo\\");                    // line ends with a backslash
    const r = applyKey(s, "", { return: true });
    expect(r.submit).toBeUndefined();
    expect(r.state.lines).toEqual(["foo", ""]);
    expect(r.state.cursor).toEqual({ row: 1, col: 0 });
  });
  it("Left/Right move the cursor, wrapping across lines", () => {
    let s = type(initialEditorState(), "a\nb");                     // cursor {1,1}
    s = press(s, { leftArrow: true });                             // {1,0}
    s = press(s, { leftArrow: true });                             // wrap to {0,1}
    expect(s.cursor).toEqual({ row: 0, col: 1 });
    s = press(s, { rightArrow: true });                            // {1,0}
    expect(s.cursor).toEqual({ row: 1, col: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tui && npx vitest run test/editor.test.ts`
Expected: FAIL — `Cannot find module "../src/editor.js"`.

- [ ] **Step 3: Implement** — create `tui/src/editor.ts`:

```ts
// tui/src/editor.ts — pure multiline-editor reducer for the chat composer. No React/Ink/fs; the @-mention FS
// walk is injected by the component. Probe 17d7116: a multi-line write is ONE useInput call (input = whole
// string, embedded \n/\r, no key.return) → paste = insert-and-split; submit = a lone key.return; `\`+Enter =
// continuation. rankCandidates (pure) is added in the mention pass.
export interface Cursor { row: number; col: number }
export interface Candidate { path: string; score: number }
export interface MentionState { anchor: Cursor; query: string; files: string[]; items: Candidate[]; index: number }
export interface EditorState {
  lines: string[]; cursor: Cursor; history: string[]; histIndex: number | null; stash: string | null; mention: MentionState | null;
}
export interface EditorResult { state: EditorState; submit?: string }
/** Minimal structural subset of ink's Key the reducer reads (so editor.ts needs no ink import). */
export interface KeyFlags {
  return?: boolean; backspace?: boolean; delete?: boolean;
  leftArrow?: boolean; rightArrow?: boolean; upArrow?: boolean; downArrow?: boolean; escape?: boolean; tab?: boolean;
}

export function initialEditorState(history: string[] = []): EditorState {
  return { lines: [""], cursor: { row: 0, col: 0 }, history: [...history], histIndex: null, stash: null, mention: null };
}

const PASTE_MARKERS = /\x1b?\[20[01]~/g;                    // \x1b[200~ / \x1b[201~ and ESC-stripped [200~/[201~
export function stripPasteMarkers(s: string): string { return s.replace(PASTE_MARKERS, ""); }
const splitLines = (t: string): string[] => t.split(/\r\n|\r|\n/);
const bufferText = (s: EditorState): string => s.lines.join("\n");
const isBlank = (s: EditorState): boolean => bufferText(s).trim().length === 0;

function insertText(s: EditorState, t: string): EditorState {
  const lines = [...s.lines]; const { row, col } = s.cursor; const cur = lines[row];
  const before = cur.slice(0, col), after = cur.slice(col); const parts = splitLines(t);
  if (parts.length === 1) { lines[row] = before + parts[0] + after; return { ...s, lines, cursor: { row, col: col + parts[0].length } }; }
  const mid = parts.slice(1, -1); const last = parts[parts.length - 1];
  lines.splice(row, 1, before + parts[0], ...mid, last + after);
  return { ...s, lines, cursor: { row: row + parts.length - 1, col: last.length } };
}
function deleteLeft(s: EditorState): EditorState {
  const lines = [...s.lines]; const { row, col } = s.cursor;
  if (col > 0) { lines[row] = lines[row].slice(0, col - 1) + lines[row].slice(col); return { ...s, lines, cursor: { row, col: col - 1 } }; }
  if (row > 0) { const prev = lines[row - 1].length; lines[row - 1] = lines[row - 1] + lines[row]; lines.splice(row, 1); return { ...s, lines, cursor: { row: row - 1, col: prev } }; }
  return s;
}
function moveLeft(s: EditorState): EditorState {
  const { row, col } = s.cursor;
  if (col > 0) return { ...s, cursor: { row, col: col - 1 } };
  if (row > 0) return { ...s, cursor: { row: row - 1, col: s.lines[row - 1].length } };
  return s;
}
function moveRight(s: EditorState): EditorState {
  const { row, col } = s.cursor;
  if (col < s.lines[row].length) return { ...s, cursor: { row, col: col + 1 } };
  if (row < s.lines.length - 1) return { ...s, cursor: { row: row + 1, col: 0 } };
  return s;
}
function moveCursorVert(s: EditorState, delta: number): EditorState {
  const row = s.cursor.row + delta;
  if (row < 0 || row >= s.lines.length) return s;
  return { ...s, cursor: { row, col: Math.min(s.cursor.col, s.lines[row].length) } };
}
function continueLine(s: EditorState): EditorState {
  const lines = [...s.lines]; const row = s.cursor.row;
  lines[row] = lines[row].replace(/\\$/, "");              // drop the trailing backslash
  lines.splice(row + 1, 0, "");                            // insert a new empty line after it
  return { ...s, lines, cursor: { row: row + 1, col: 0 } };
}
function submitTurn(s: EditorState): EditorResult {
  if (isBlank(s)) return { state: s };
  const t = bufferText(s);
  const history = s.history.length && s.history[s.history.length - 1] === t ? s.history : [...s.history, t];   // dedup consecutive
  return { state: initialEditorState(history), submit: t };
}

// onUp/onDown: cursor movement at the buffer edges (history recall is added in the history pass).
function onUp(s: EditorState): EditorState { return s.cursor.row === 0 ? s : moveCursorVert(s, -1); }
function onDown(s: EditorState): EditorState { return s.cursor.row === s.lines.length - 1 ? s : moveCursorVert(s, 1); }

export function applyKey(s: EditorState, input: string, key: KeyFlags): EditorResult {
  if (key.return) { if (s.lines[s.cursor.row].endsWith("\\")) return { state: continueLine(s) }; return submitTurn(s); }
  if (key.backspace || key.delete) return { state: deleteLeft(s) };
  if (key.leftArrow) return { state: moveLeft(s) };
  if (key.rightArrow) return { state: moveRight(s) };
  if (key.upArrow) return { state: onUp(s) };
  if (key.downArrow) return { state: onDown(s) };
  if (input) { const t = stripPasteMarkers(input); return t ? { state: insertText(s, t) } : { state: s }; }
  return { state: s };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tui && npx vitest run test/editor.test.ts && npm run typecheck`
Expected: PASS (8 tests); typecheck clean. (`Candidate`/`MentionState` are defined but unused until T4 — intentional.)

- [ ] **Step 5: Commit**

```bash
git add tui/src/editor.ts tui/test/editor.test.ts
git commit -m "feat(tui): editor reducer — core multiline editing (cursor/insert/paste/backspace/submit/continuation)"
```

---

### Task 2: `editor.ts` — in-memory prompt history (Up/Down recall + stash/restore)

**Files:** Modify `tui/src/editor.ts`, `tui/test/editor.test.ts`.

**Interfaces:**
- Consumes: `EditorState`, `applyKey` (T1).
- Produces: Up on the first line / Down on the last line now recall history (with a stashed live draft restored on Down past the newest). No signature change. Used by Task 5 indirectly.

- [ ] **Step 1: Write the failing test** — append to `tui/test/editor.test.ts` (inside the file, a new `describe`):

```ts
describe("editor history", () => {
  const withHistory = (h: string[]) => initialEditorState(h);
  it("Up on the first line recalls the previous prompt; Down returns toward the draft", () => {
    let s = withHistory(["first", "second"]);
    s = type(s, "draft");                                          // a live draft
    s = press(s, { upArrow: true });                              // newest
    expect(text(s)).toBe("second");
    s = press(s, { upArrow: true });                              // older
    expect(text(s)).toBe("first");
    s = press(s, { upArrow: true });                              // clamp at oldest
    expect(text(s)).toBe("first");
    s = press(s, { downArrow: true });                            // newer
    expect(text(s)).toBe("second");
    s = press(s, { downArrow: true });                            // past newest → restore draft
    expect(text(s)).toBe("draft");
  });
  it("does not recall history when the cursor is on an interior line (moves the cursor instead)", () => {
    let s = type(initialEditorState(), "a\nb\nc");                 // 3 lines, cursor {2,1}
    s = press(s, { upArrow: true });                              // interior move, not history
    expect(s.cursor.row).toBe(1);
    expect(text(s)).toBe("a\nb\nc");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tui && npx vitest run test/editor.test.ts -t "history"`
Expected: FAIL — Up on the first line is a no-op (returns same buffer), so `text(s)` is still `"draft"`.

- [ ] **Step 3: Implement** — in `tui/src/editor.ts`, add the history helpers and update `onUp`/`onDown`.

Add these helpers (above `applyKey`, after `submitTurn`):

```ts
function setBuffer(s: EditorState, t: string): EditorState {
  const lines = splitLines(t); const r = lines.length - 1;
  return { ...s, lines, cursor: { row: r, col: lines[r].length } };
}
function historyPrev(s: EditorState): EditorState {
  if (s.history.length === 0) return s;
  if (s.histIndex === null) { const idx = s.history.length - 1; return setBuffer({ ...s, stash: bufferText(s), histIndex: idx }, s.history[idx]); }
  const idx = Math.max(0, s.histIndex - 1); return setBuffer({ ...s, histIndex: idx }, s.history[idx]);
}
function historyNext(s: EditorState): EditorState {
  if (s.histIndex === null) return s;
  const idx = s.histIndex + 1;
  if (idx >= s.history.length) return setBuffer({ ...s, histIndex: null, stash: null }, s.stash ?? "");
  return setBuffer({ ...s, histIndex: idx }, s.history[idx]);
}
```

Replace the `onUp`/`onDown` definitions with the history-aware versions:

```ts
function onUp(s: EditorState): EditorState { if (s.cursor.row === 0) return historyPrev(s); return moveCursorVert(s, -1); }
function onDown(s: EditorState): EditorState { if (s.cursor.row === s.lines.length - 1) return historyNext(s); return moveCursorVert(s, 1); }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tui && npx vitest run test/editor.test.ts && npm run typecheck`
Expected: PASS — history tests + all T1 core tests; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add tui/src/editor.ts tui/test/editor.test.ts
git commit -m "feat(tui): editor history — Up/Down recall with draft stash/restore"
```

---

### Task 3: `fileComplete.ts` — recursive walk (injected readdir, basic ignores, cap) + fuzzy ranker

**Files:** Create `tui/src/fileComplete.ts`, `tui/test/fileComplete.test.ts`.

**Interfaces:**
- Consumes: `import type { Candidate }` from `./editor.js` (T1).
- Produces: `interface DirEnt { name: string; isDir: boolean }`; `type ReaddirFn = (dir: string) => DirEnt[]`; `interface WalkOpts { cap?: number }`; `collectFiles(cwd: string, readdir: ReaddirFn, opts?: WalkOpts): string[]`; `rankCandidates(files: string[], query: string, cap?: number): Candidate[]`. Used by Tasks 4 (`rankCandidates`) and 5 (`collectFiles`, `DirEnt`).

- [ ] **Step 1: Write the failing test** — create `tui/test/fileComplete.test.ts`:

```ts
// tui/test/fileComplete.test.ts — pure @-completion: recursive walk (fake fs) + fuzzy ranking.
import { describe, it, expect } from "vitest";
import { collectFiles, rankCandidates, type DirEnt } from "../src/fileComplete.js";

// A fake fs: a map of dir-path → entries. The walk joins with "/" starting from the cwd root "".
const tree: Record<string, DirEnt[]> = {
  "": [{ name: "src", isDir: true }, { name: "node_modules", isDir: true }, { name: ".git", isDir: true }, { name: "README.md", isDir: false }],
  "src": [{ name: "app.ts", isDir: false }, { name: "util", isDir: true }, { name: ".hidden", isDir: false }],
  "src/util": [{ name: "fs.ts", isDir: false }],
  "node_modules": [{ name: "pkg.js", isDir: false }],
};
const readdir = (dir: string): DirEnt[] => tree[dir] ?? [];

describe("collectFiles", () => {
  it("walks recursively, skipping node_modules/.git/dotfiles, returning relative POSIX paths", () => {
    const files = collectFiles("", readdir);
    expect(files.sort()).toEqual(["README.md", "src/app.ts", "src/util/fs.ts"]);   // no node_modules, no .git, no .hidden
  });
  it("honors the cap", () => {
    expect(collectFiles("", readdir, { cap: 2 }).length).toBe(2);
  });
});
describe("rankCandidates", () => {
  it("returns subsequence matches ranked, segment/prefix bonuses first", () => {
    const items = rankCandidates(["src/app.ts", "src/util/fs.ts", "README.md"], "app");
    expect(items[0].path).toBe("src/app.ts");
    expect(items.find((c) => c.path === "README.md")).toBeUndefined();   // "app" is not a subsequence of README.md
  });
  it("empty query returns the first cap files in order", () => {
    expect(rankCandidates(["a", "b", "c"], "", 2).map((c) => c.path)).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tui && npx vitest run test/fileComplete.test.ts`
Expected: FAIL — `Cannot find module "../src/fileComplete.js"`.

- [ ] **Step 3: Implement** — create `tui/src/fileComplete.ts`:

```ts
// tui/src/fileComplete.ts — pure @-mention file completion: recursive walk (basic ignores, capped) + fuzzy
// ranker. The walk takes an injected readdir so it's testable with a fake tree (no disk). Paths are
// repo-relative POSIX. Used by editor.ts (rankCandidates) and ChatComposer.tsx (collectFiles).
import type { Candidate } from "./editor.js";

export interface DirEnt { name: string; isDir: boolean }
export type ReaddirFn = (dir: string) => DirEnt[];
export interface WalkOpts { cap?: number }

const IGNORE = new Set(["node_modules", ".git"]);
const skipDir = (name: string) => IGNORE.has(name) || name.startsWith(".");
const join = (a: string, b: string) => (a ? a + "/" + b : b);

export function collectFiles(cwd: string, readdir: ReaddirFn, opts: WalkOpts = {}): string[] {
  const cap = opts.cap ?? 1000; const out: string[] = [];
  const walk = (dir: string, rel: string): void => {            // dir = real path fed to readdir; rel = path emitted
    if (out.length >= cap) return;
    let ents: DirEnt[]; try { ents = readdir(dir); } catch { return; }
    for (const e of ents) {
      if (out.length >= cap) return;
      const childRel = rel ? rel + "/" + e.name : e.name;
      if (e.isDir) { if (!skipDir(e.name)) walk(join(dir, e.name), childRel); }
      else if (!e.name.startsWith(".")) out.push(childRel);     // repo-relative POSIX path
    }
  };
  walk(cwd, "");                                                // emitted paths are relative to cwd
  return out;
}

function fuzzyScore(textLc: string, q: string): number {
  let ti = 0, score = 0, streak = 0;
  for (let qi = 0; qi < q.length; qi++) {
    let found = -1; for (let i = ti; i < textLc.length; i++) { if (textLc[i] === q[qi]) { found = i; break; } }
    if (found === -1) return -1;
    streak = found === ti ? streak + 1 : 0;
    let s = 1 + streak;
    if (found === 0) s += 5; else if (textLc[found - 1] === "/") s += 3;
    score += s; ti = found + 1;
  }
  return score;
}

export function rankCandidates(files: string[], query: string, cap = 50): Candidate[] {
  if (!query) return files.slice(0, cap).map((path) => ({ path, score: 0 }));
  const q = query.toLowerCase(); const scored: Candidate[] = [];
  for (const path of files) { const score = fuzzyScore(path.toLowerCase(), q); if (score >= 0) scored.push({ path, score }); }
  scored.sort((a, b) => b.score - a.score || a.path.length - b.path.length || (a.path < b.path ? -1 : 1));
  return scored.slice(0, cap);
}
```

> Note on paths: the walk tracks two values — `dir` (the real path passed to `readdir`, seeded from `cwd`) and `rel` (the path emitted, seeded `""`). So output is always **relative to `cwd`** (`"src/app.ts"`), whether `cwd` is `""` (the test) or an absolute dir (the component) — the inserted `@` token stays clean (`@src/app.ts`). The fake-fs test keys its tree by the same relative dir names the walk reads (`""`, `"src"`, `"src/util"`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tui && npx vitest run test/fileComplete.test.ts && npm run typecheck`
Expected: PASS (4 tests); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add tui/src/fileComplete.ts tui/test/fileComplete.test.ts
git commit -m "feat(tui): fileComplete — injected-readdir recursive walk + fuzzy ranker for @-mention"
```

---

### Task 4: `editor.ts` — `@`-mention routing (open/filter/accept/close + setMentionFiles)

**Files:** Modify `tui/src/editor.ts`, `tui/test/editor.test.ts`.

**Interfaces:**
- Consumes: `rankCandidates` from `./fileComplete.js` (T3); `EditorState`/`MentionState`/`Candidate`/`applyKey` (T1).
- Produces: typing `@` at a word boundary opens a mention; subsequent typing filters; `setMentionFiles(state, files): EditorState` feeds the walk results in; Up/Down move the popup highlight; Enter/Tab accept the highlighted candidate (insert `@<path> `); Esc / backspace-past-anchor / a whitespace in the query / cursor leaving the token close it. Used by Task 5.

- [ ] **Step 1: Write the failing test** — append to `tui/test/editor.test.ts`:

```ts
import { setMentionFiles } from "../src/editor.js";

describe("editor @-mention", () => {
  const open = () => {                                             // open a mention with two candidate files
    let s = type(initialEditorState(), "@");
    s = setMentionFiles(s, ["src/app.ts", "src/util/fs.ts"]);
    return s;
  };
  it("opens a mention on '@' at a word boundary and lists files", () => {
    const s = open();
    expect(s.mention).not.toBeNull();
    expect(s.mention!.items.length).toBe(2);
  });
  it("does NOT open a mention when '@' follows a non-space character", () => {
    let s = type(initialEditorState(), "a");
    s = type(s, "@");
    expect(s.mention).toBeNull();
  });
  it("filters the candidate list as the query is typed", () => {
    let s = open();
    s = type(s, "fs");                                             // query "fs"
    expect(s.mention!.query).toBe("fs");
    expect(s.mention!.items[0].path).toBe("src/util/fs.ts");
  });
  it("Up/Down move the highlight; Enter accepts the highlighted path and closes", () => {
    let s = open();
    s = press(s, { downArrow: true });                            // highlight index 1
    expect(s.mention!.index).toBe(1);
    const r = applyKey(s, "", { return: true });                 // accept (not submit)
    expect(r.submit).toBeUndefined();
    expect(r.state.mention).toBeNull();
    expect(text(r.state)).toBe("@src/util/fs.ts ");               // inserted token + trailing space
  });
  it("Esc closes the mention but keeps the typed text", () => {
    let s = open(); s = type(s, "ap");
    s = press(s, { escape: true });
    expect(s.mention).toBeNull();
    expect(text(s)).toBe("@ap");
  });
  it("backspacing past the '@' anchor closes the mention", () => {
    let s = open();                                               // buffer "@", cursor after @
    s = press(s, { backspace: true });                           // deletes the '@'
    expect(s.mention).toBeNull();
    expect(text(s)).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tui && npx vitest run test/editor.test.ts -t "mention"`
Expected: FAIL — `setMentionFiles` not exported; `@` does not open a mention.

- [ ] **Step 3: Implement** — in `tui/src/editor.ts`:

(a) Add the import at the top (below the header comment):

```ts
import { rankCandidates } from "./fileComplete.js";
```

(b) Add the mention helpers (above `applyKey`):

```ts
function atWordBoundary(s: EditorState): boolean {
  const { row, col } = s.cursor; const at = col - 1;            // the just-inserted '@' is at col-1
  if (at <= 0) return true;
  return /\s/.test(s.lines[row][at - 1] ?? "");
}
function openMention(s: EditorState): EditorState {
  return { ...s, mention: { anchor: { row: s.cursor.row, col: s.cursor.col - 1 }, query: "", files: [], items: [], index: 0 } };
}
function refreshMention(s: EditorState): EditorState {
  const m = s.mention; if (!m) return s; const { row, col } = s.cursor;
  if (row !== m.anchor.row || col <= m.anchor.col) return { ...s, mention: null };   // cursor left the token
  const query = s.lines[row].slice(m.anchor.col + 1, col);
  if (/\s/.test(query)) return { ...s, mention: null };          // a space ends the mention
  return { ...s, mention: { ...m, query, items: rankCandidates(m.files, query), index: 0 } };
}
const syncMention = (s: EditorState): EditorState => (s.mention ? refreshMention(s) : s);
function afterInsert(next: EditorState, prev: EditorState, t: string): EditorState {
  if (t === "@" && atWordBoundary(next)) return openMention(next);
  return prev.mention ? refreshMention(next) : next;
}
function moveMention(s: EditorState, delta: number): EditorState {
  const m = s.mention!; if (m.items.length === 0) return s;
  return { ...s, mention: { ...m, index: Math.max(0, Math.min(m.items.length - 1, m.index + delta)) } };
}
function acceptMention(s: EditorState): EditorState {
  const m = s.mention; if (!m || m.items.length === 0) return { ...s, mention: null };
  const chosen = m.items[Math.min(m.index, m.items.length - 1)]; const row = m.anchor.row; const line = s.lines[row];
  const replacement = "@" + chosen.path + " ";                  // insert "@path " (trailing space for ergonomics)
  const lines = [...s.lines]; lines[row] = line.slice(0, m.anchor.col) + replacement + line.slice(s.cursor.col);
  return { ...s, lines, cursor: { row, col: m.anchor.col + replacement.length }, mention: null };
}
export function setMentionFiles(s: EditorState, files: string[]): EditorState {
  if (!s.mention) return s;
  return { ...s, mention: { ...s.mention, files, items: rankCandidates(files, s.mention.query), index: 0 } };
}
```

(c) Update `onUp`/`onDown` to route to the popup when a mention is open (add the first line of each):

```ts
function onUp(s: EditorState): EditorState { if (s.mention) return moveMention(s, -1); if (s.cursor.row === 0) return historyPrev(s); return moveCursorVert(s, -1); }
function onDown(s: EditorState): EditorState { if (s.mention) return moveMention(s, 1); if (s.cursor.row === s.lines.length - 1) return historyNext(s); return moveCursorVert(s, 1); }
```

(d) Replace `applyKey` with the full version (adds Tab, Esc, mention-accept on Enter, mention sync on edits/moves, and the `afterInsert` insert path):

```ts
export function applyKey(s: EditorState, input: string, key: KeyFlags): EditorResult {
  if (key.return) {
    if (s.lines[s.cursor.row].endsWith("\\")) return { state: continueLine(s) };
    if (s.mention) return { state: acceptMention(s) };
    return submitTurn(s);
  }
  if (key.tab) return { state: s.mention ? acceptMention(s) : s };
  if (key.escape) return { state: s.mention ? { ...s, mention: null } : s };
  if (key.backspace || key.delete) return { state: syncMention(deleteLeft(s)) };
  if (key.leftArrow) return { state: syncMention(moveLeft(s)) };
  if (key.rightArrow) return { state: syncMention(moveRight(s)) };
  if (key.upArrow) return { state: onUp(s) };
  if (key.downArrow) return { state: onDown(s) };
  if (input) { const t = stripPasteMarkers(input); if (!t) return { state: s }; return { state: afterInsert(insertText(s, t), s, t) }; }
  return { state: s };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tui && npx vitest run test/editor.test.ts && npm run typecheck`
Expected: PASS — mention tests + all T1/T2 tests; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add tui/src/editor.ts tui/test/editor.test.ts
git commit -m "feat(tui): editor @-mention — open/filter/accept/close + setMentionFiles"
```

---

### Task 5: `ChatComposer.tsx` — the presentational multiline input (buffer + cursor + popup + walk)

**Files:** Create `tui/src/ChatComposer.tsx`; modify `tui/test/components.test.tsx`.

**Interfaces:**
- Consumes: `applyKey`/`initialEditorState`/`setMentionFiles`/`EditorState` (T1,T4); `collectFiles`/`DirEnt` (T3).
- Produces: `ChatComposer({ onSubmit: (text: string) => void; cwd: string })`. Used by Task 6.

- [ ] **Step 1: Write the failing test** — append to `tui/test/components.test.tsx` (it already imports `render`, `React`, `describe`/`it`/`expect`, `waitFor`):

```tsx
import { ChatComposer } from "../src/ChatComposer.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("ChatComposer", () => {
  it("submits on Enter and inserts a newline on \\+Enter", async () => {
    const got: string[] = [];
    const { stdin, lastFrame } = render(<ChatComposer onSubmit={(t) => got.push(t)} cwd={tmpdir()} />);
    await new Promise((r) => setTimeout(r, 20));                  // let useInput subscribe before keys
    stdin.write("a"); stdin.write("\\"); stdin.write("\r");      // "a\" then Enter → continuation
    await waitFor(() => (lastFrame() ?? "").includes("a"));
    stdin.write("b"); stdin.write("\r");                         // submit "a\nb"
    await waitFor(() => got.length === 1);
    expect(got[0]).toBe("a\nb");
  });
  it("opens the @-popup listing files from the fixture cwd", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-comp-"));
    writeFileSync(join(dir, "alpha.ts"), "x");
    const { stdin, lastFrame } = render(<ChatComposer onSubmit={() => {}} cwd={dir} />);
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("@");
    await waitFor(() => (lastFrame() ?? "").includes("alpha.ts"));
    expect(lastFrame() ?? "").toContain("alpha.ts");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tui && npx vitest run test/components.test.tsx -t "ChatComposer"`
Expected: FAIL — `Cannot find module "../src/ChatComposer.js"`.

- [ ] **Step 3: Implement** — create `tui/src/ChatComposer.tsx`:

```tsx
// tui/src/ChatComposer.tsx — the chat REPL's multiline input: a thin Ink view over the pure editor reducer.
// Owns the one side effect (the @-mention filesystem walk). The shared console <Composer> is left untouched.
import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { readdirSync } from "node:fs";
import { applyKey, initialEditorState, setMentionFiles, type EditorState } from "./editor.js";
import { collectFiles, type DirEnt } from "./fileComplete.js";

const realReaddir = (dir: string): DirEnt[] => {
  try { return readdirSync(dir, { withFileTypes: true }).map((d) => ({ name: d.name, isDir: d.isDirectory() })); }
  catch { return []; }
};

function renderBuffer(state: EditorState): React.ReactNode {
  const { lines, cursor } = state;
  return lines.map((line, r) => {
    if (r !== cursor.row) return <Text key={r}>{line.length ? line : " "}</Text>;
    const before = line.slice(0, cursor.col), at = line[cursor.col] ?? " ", after = line.slice(cursor.col + 1);
    return <Text key={r}>{before}<Text inverse>{at}</Text>{after}</Text>;
  });
}

function MentionPopup({ state }: { state: EditorState }) {
  const m = state.mention!;
  if (m.items.length === 0) return <Box paddingX={1}><Text dimColor>@{m.query} — no matches</Text></Box>;
  const start = Math.max(0, Math.min(m.index - 3, Math.max(0, m.items.length - 8)));
  const visible = m.items.slice(start, start + 8);
  return (
    <Box flexDirection="column" paddingX={1}>
      {visible.map((c, i) => <Text key={c.path} inverse={start + i === m.index}>{c.path}</Text>)}
    </Box>
  );
}

export function ChatComposer({ onSubmit, cwd }: { onSubmit: (text: string) => void; cwd: string }) {
  const [state, setState] = useState<EditorState>(() => initialEditorState());
  const disposed = useRef(false);
  useEffect(() => () => { disposed.current = true; }, []);

  useInput((input, key) => { const r = applyKey(state, input, key); if (r.submit != null) onSubmit(r.submit); setState(r.state); });

  // A just-opened mention has empty files → walk cwd once and feed the results in.
  const needWalk = state.mention != null && state.mention.files.length === 0;
  useEffect(() => {
    if (!needWalk) return;
    const files = collectFiles(cwd, realReaddir);
    if (!disposed.current) setState((s) => setMentionFiles(s, files));
  }, [needWalk, cwd]);

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" paddingX={1}><Text>{"› "}</Text><Box flexDirection="column">{renderBuffer(state)}</Box></Box>
      {state.mention ? <MentionPopup state={state} /> : null}
    </Box>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tui && npx vitest run test/components.test.tsx && npm run typecheck`
Expected: PASS — `ChatComposer` tests + all existing component tests; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add tui/src/ChatComposer.tsx tui/test/components.test.tsx
git commit -m "feat(tui): ChatComposer — multiline input view (cursor + @-popup + walk)"
```

---

### Task 6: Wire `ChatComposer` into `ChatApp`/`chat.tsx` (thread `cwd`)

**Files:** Modify `tui/src/ChatApp.tsx`, `tui/src/chat.tsx`, `tui/test/chat.test.tsx`.

**Interfaces:**
- Consumes: `ChatComposer` (T5).
- Produces: `ChatApp` gains a `cwd: string` prop and renders `<ChatComposer onSubmit={submit} cwd={cwd} />` in place of `<Composer>`. `chat.tsx` passes `cwd={base.cwd}`.

This is a wiring task: `ChatApp` gains a required `cwd` prop, so its three existing test renders must pass it, and the existing behavioral tests (type a prompt → submit → stream; gated dialog; Tab cycles mode) must stay green with the new `ChatComposer` mounted in place of `<Composer>`. The "failing first" is the typecheck error from the new prop.

- [ ] **Step 1: Add `cwd` to the existing test renders** — in `tui/test/chat.test.tsx`, add `cwd={process.cwd()}` to all three `<ChatApp …>` renders (currently lines 29, 44, 58):

```tsx
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeSession()} broker={createUiBroker()} cwd={process.cwd()} />);
```
```tsx
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => session} broker={ui} cwd={process.cwd()} />);
```
```tsx
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => session} broker={createUiBroker()} cwd={process.cwd()} />);
```

(The three renders differ only in their `makeSession`/`broker` args — add `cwd={process.cwd()}` to each. The existing tests type `"hi"`/`"edit it"` then `"\r"`: with `ChatComposer` those submit the same way — Enter submits when the line has no trailing `\` — so the assertions on `"›"`, `"ok"`, the permission dialog, and Tab-cycles-mode all still hold.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tui && npx vitest run test/chat.test.tsx`
Expected: FAIL — TypeScript error: `Property 'cwd' does not exist on type … ChatApp props` (the prop isn't accepted until Step 3 lands).

- [ ] **Step 3: Implement** —

`tui/src/ChatApp.tsx`: change the import and the props + the rendered composer.

Replace the `Composer` import line:
```tsx
import { ChatComposer } from "./ChatComposer.js";
```
(Delete `import { Composer } from "./Composer.js";` — it is no longer used by `ChatApp`. `Composer.tsx` itself stays for the console.)

Change the component signature to accept `cwd`:
```tsx
export function ChatApp({ makeSession, broker, hookOpts, cwd }: { makeSession: (resume?: string) => ChatSession; broker: UiBrokerHandle; hookOpts?: { initialMode?: string }; cwd: string }) {
```

Swap the composer in the render (the `: <Composer onSubmit={submit} />` branch):
```tsx
          : <ChatComposer onSubmit={submit} cwd={cwd} />}
```

`tui/src/chat.tsx`: pass `cwd` to `<ChatApp>`:
```tsx
render(<ChatApp makeSession={makeSession} broker={ui} cwd={base.cwd} />);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tui && npx vitest run test/chat.test.tsx test/components.test.tsx && npm run typecheck`
Expected: PASS — the new prompt assertion + all existing chat/component tests; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add tui/src/ChatApp.tsx tui/src/chat.tsx tui/test/chat.test.tsx
git commit -m "feat(tui): wire ChatComposer into the chat REPL (thread cwd)"
```

---

### Task 7: Gated live e2e — a multiline prompt completes a turn

**Files:** Create `tui/test/live/chat-input.e2e.test.ts`.

- [ ] **Step 1: Write the test** — create `tui/test/live/chat-input.e2e.test.ts`:

```ts
// tui/test/live/chat-input.e2e.test.ts — gated: a multi-line prompt string flows through Session.submit intact
// and the turn completes. Thin by design (no new SDK surface) — guards the one integration claim.
import { describe, it, expect } from "vitest";
import { openSession } from "cc-harness";

const live = process.env.ANTHROPIC_API_KEY ? describe : describe.skip;

live("chat input ergonomics (live)", () => {
  it("submits a two-line prompt and completes a turn", async () => {
    const session = openSession({ permissionMode: "bypassPermissions" });
    try {
      const res = await session.submit("Reply with exactly the single word READY.\nOutput nothing else.", () => {});
      expect(String((res as { result: unknown }).result)).toMatch(/READY/i);
    } finally {
      await session.dispose();
    }
  }, 60_000);
});
```

- [ ] **Step 2: Run keyless to confirm clean skip**

Run: `cd tui && npx vitest run test/live/chat-input.e2e.test.ts`
Expected: **SKIPPED** (no key). (Implementer stops here; the controller runs the keyed pass.)

- [ ] **Step 3: (controller) Run keyed**

Run: `cd tui && set -a; . ../.env; set +a; npx vitest run test/live/chat-input.e2e.test.ts`
Expected: PASS (~5–20 s) — the turn completes and the result contains `READY`.

- [ ] **Step 4: Commit**

```bash
git add tui/test/live/chat-input.e2e.test.ts
git commit -m "test(tui): gated live e2e — multiline prompt completes a turn"
```

---

### Task 8: Refresh coverage scorecard + memory

**Files:** Modify `docs/parity/coverage.md`; memory (controller-handled).

- [ ] **Step 1: Full keyless gate**

Run: `cd tui && npm run typecheck && npx vitest run`
Expected: typecheck clean; all keyless suites pass (live suites skip).

- [ ] **Step 2: Update `docs/parity/coverage.md`** — in the Domain 10 row, change the Realized cell `~46%¹` → `~50%¹` (preserve the `¹` footnote), and insert this sentence verbatim **immediately before** the closing `Remote/voice remain 🚫/non-goal **by design**` clause (after the increment-7 sentence ending `2026-06-19-chat-rich-tool-rendering`):

```
**Phase-3 increment 8 SHIPPED — input ergonomics** (`cc-harness-chat`): a new multiline editor replaces the single-line input — `\`-continuation + multi-line paste (probe `ink-paste-key-delivery`: a paste is one `useInput` call), in-memory prompt history (Up/Down recall with draft stash/restore), and `@`-mention fuzzy file completion (recursive walk with basic ignores, path-token insert). A pure `editor.ts` reducer + a pure `fileComplete.ts` ranker (injected `readdir`) + a thin `ChatComposer.tsx`; the shared console `<Composer>` is untouched. No harness change; spec/plan `2026-06-19-chat-input-ergonomics`.
```

Keep the row a single line (no line break inside the table cell).

- [ ] **Step 3: Commit**

```bash
git add docs/parity/coverage.md
git commit -m "docs(parity): record increment-8 input ergonomics (Domain 10)"
```

(Memory files live outside the repo — the controller writes them, not a git commit.)

---

## Self-Review

**1. Spec coverage** — every spec section maps to a task: multiline editing (paste/`\`-continuation/cursor/backspace) → T1; in-memory history + stash/restore → T2; `fileComplete` walk+rank → T3; `@`-mention open/filter/accept/close + `setMentionFiles` → T4; `ChatComposer` view (buffer/cursor/popup + walk effect, self-contained Esc) → T5; `ChatApp`/`chat.tsx` wiring + `cwd` threading → T6; gated live multiline e2e → T7; docs → T8. Defensive bracketed-paste stripping (spec §2) → T1 `stripPasteMarkers`. Fixture-cwd component test (spec §8) → T5.

**2. Placeholder scan** — no TBD/TODO; every code step shows complete code; every command has an expected result. T6 is concrete (the three `chat.test.tsx` `<ChatApp>` renders each get `cwd={process.cwd()}`; the existing `fakeSession`/`createUiBroker` helpers are confirmed present in that file). `collectFiles` emits repo-relative paths (real dir vs. emitted rel tracked separately) so the inserted `@` token is clean for both the `cwd=""` test and an absolute component `cwd`.

**3. Type consistency** — `EditorState`/`Cursor`/`MentionState`/`Candidate`/`KeyFlags`/`EditorResult` are defined once in T1 and reused verbatim in T2/T4/T5; `applyKey(state, input, key)` signature is identical across T1→T2→T4; `initialEditorState(history?)`, `setMentionFiles(state, files)`, `collectFiles(cwd, readdir, opts?)`, `rankCandidates(files, query, cap?)`, `DirEnt`, `ReaddirFn` match between definition (T1/T3) and use (T3/T4/T5). `Candidate` lives in `editor.ts` and is `import type`-d by `fileComplete.ts` (type-only, no runtime cycle); `editor.ts` value-imports `rankCandidates` from `fileComplete.ts` (added in T4, after T3 creates it). `ChatComposer({ onSubmit, cwd })` (T5) matches the `<ChatComposer onSubmit cwd>` call (T6); `ChatApp` `cwd` prop (T6) matches `chat.tsx`'s `cwd={base.cwd}` (T6).

**Out-of-scope held:** on-disk history, `@`-content injection, full `.gitignore`, slash completion, syntax highlighting, soft-wrap, horizontal scroll, undo/redo — all per spec §10.
