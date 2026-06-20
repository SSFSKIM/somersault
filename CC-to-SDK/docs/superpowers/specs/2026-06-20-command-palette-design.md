# Increment D — Command Palette (design)

**Status:** approved (2026-06-20) · **Surface:** `cc-harness-chat` (chat REPL) only · **No harness change**
**Audit finding closed:** #13 (skills / plugins / slash commands "all need installing")

## Goal

Surface the full **live** command catalog — skills, plugin commands, and user commands already loaded into the
session — as an inline `/`-autocomplete in the chat REPL, and dispatch it: our local control commands keep
driving the engine; catalog commands run by submit-as-prompt.

## Background — the A1 triple-flip (why this is "surface," not "install")

The audit framed #13 as "skills, plugins, other slash commands all need installing." Three live probes
corrected that:

- **Probe 30** (`probes/probes/30-commands-skills-surface.ts`): `session.capabilities().commands` returns
  **105 entries** headless, each `{name, description, argumentHint, aliases}` — and the names ARE the user's
  installed ecosystem (skills `brainstorming`/`writing-plans`/`subagent-driven-development`…, plugin commands
  `code-review:code-review`/`codex:rescue`/`commit-commands:commit`…, user commands `browse`/`qa`/`ship`…).
  They're already **loaded**: the SDK spawns the `claude` CLI, which inherits `~/.claude` via
  `settingSources:"all"` (the harness default).
- **Probe 31** (`probes/probes/31-slash-command-invocation.ts`): submitting a slash command as a prompt —
  **built-ins gate** (`/help` → "isn't available in this environment"), but **skills and plugin/user
  commands EXECUTE** (`/brainstorming`, `/review` each expanded and ran a real agentic turn — they timed out
  at 25 s still running, i.e. they run as normal long turns).
- So the catalog is already **installed AND invocable**. The gap is purely **surfacing**: the chat REPL
  fetches `capabilities().commands` for the model picker and **discards** the `.commands` field
  (`useChat.ts` reads only `.models`), shipping 9 hardcoded local commands with no discovery UI.

This increment surfaces the catalog and routes dispatch. Built-ins stay handled by our local commands (we
reimplemented them precisely because the SDK gates them). Installing *new* plugins/skills from disk is a
non-goal (they're inherited).

## Architecture

Mirror the existing `@`-mention completion (`editor.ts` `MentionState` + `ChatComposer`'s `MentionPopup` +
`fileComplete.ts`'s fuzzy ranker). Add a **`command` completion state** parallel to `mention`, fed by a
**merged catalog** (our 9 local commands + the live `capabilities().commands`), rendered by a
`CommandPopup`. Dispatch routes in `useChat.handleCommand`. **No harness change** — `Session.capabilities()`
already exists and `useChat` already calls it.

One deliberate divergence from the mention pattern: a `/command` is the *entire* message, so **Enter on an
open command popup completes the highlighted command AND submits it** (runs it), whereas Enter on a mention
only inserts the file reference into the ongoing message. Tab completes the name without submitting (so you
can type args).

**Tech stack:** TypeScript; Ink chat REPL; the pure `editor.ts` reducer + `fileComplete.ts` ranker; vitest
(keyless unit + OAuth-gated live).

## Components & changes (all in `tui/src/`)

### D1. `commands.ts` — catalog types + merge + ranker

Add:

```ts
export interface CommandEntry { name: string; description: string; argumentHint?: string; source: "local" | "catalog" }

/** Local commands (the 9 engine-driving built-ins we reimplemented) as CommandEntry[]. */
export const LOCAL_COMMAND_ENTRIES: CommandEntry[] =
  COMMANDS.map((c) => ({ name: c.name, description: c.summary, source: "local" }));

/** Merge local + live catalog; local wins on a name collision; preserves local-first order then catalog. */
export function mergeCommands(local: CommandEntry[], catalog: CommandEntry[]): CommandEntry[] {
  const seen = new Set(local.map((c) => c.name));
  return [...local, ...catalog.filter((c) => !seen.has(c.name))];
}

/** Normalize a raw capabilities().commands entry to a CommandEntry (defensive about shape). */
export function toCatalogEntry(raw: unknown): CommandEntry | null {
  const r = raw as any; const name = typeof r === "string" ? r : r?.name;
  if (!name || typeof name !== "string") return null;
  return { name, description: (r?.description ?? "") as string, argumentHint: r?.argumentHint || undefined, source: "catalog" };
}
```

Reuse `fileComplete.ts`'s fuzzy scorer for command names via a thin `rankCommands`:

```ts
import { rankCandidates } from "./fileComplete.js";
/** Fuzzy-rank command entries by query (on the name); empty query → catalog order, capped. */
export function rankCommands(entries: CommandEntry[], query: string, cap = 8): CommandEntry[] {
  if (!query) return entries.slice(0, cap);
  const byName = new Map(entries.map((e) => [e.name, e]));
  return rankCandidates(entries.map((e) => e.name), query, cap).map((c) => byName.get(c.path)!).filter(Boolean);
}
```

(`rankCandidates` ranks string paths; we rank names and map back. The 105+9 list is small, so the cap-8
popup window matches `MentionPopup`'s 8-row window.)

### D2. `editor.ts` — a `command` completion state parallel to `mention`

Add `CommandState` + thread it through the reducer, mirroring `MentionState` but with the divergences below.
`command` and `mention` are **mutually exclusive** (a command only opens on a buffer-leading `/`; the reducer
checks `command` before `mention` in shared branches; opening one never opens the other).

```ts
export interface CommandState { query: string; items: CommandEntry[]; catalog: CommandEntry[]; index: number }
// EditorState gains:  command: CommandState | null;   (initialEditorState sets it null)
```

- **Open:** in `afterInsert`, `t === "/"` AND the buffer was empty before the insert (`prev.lines.length === 1
  && prev.lines[0] === ""`) → `openCommand(next)` (anchor is implicitly buffer-start; the `/` is at row 0 col 0).
  A `/` typed mid-text does NOT open a command.
- **Refresh:** query = `lines[0].slice(1, col)`; null the command if the cursor leaves row 0, `col <= 0`, or a
  space is typed (a space ends the command-name token → popup closes, you're now typing args). Recompute
  `items = rankCommands(catalog, query)`, `index = 0`.
- **Inject:** `export function setCommandCatalog(s, catalog): EditorState` — sets `command.catalog` + recomputes
  `items` (mirrors `setMentionFiles`); the component injects it once on open.
- **Navigate:** ↑/↓ move `index` within `items` (when command open, ↑/↓ do NOT touch history/cursor).
- **Tab:** complete the highlighted name — replace `/query` with `/<name> ` (trailing space), clear `command`
  (now type args).
- **Enter:** if command open with a highlighted item → **submit** `"/" + items[index].name` (run it), reset
  state. If `items` is empty → submit the raw buffer as typed. (Divergence from `acceptMention`.)
- **Esc:** clear `command` (keep the typed text).

`applyKey` branch order gains command checks ahead of the mention/history ones:
`return` → command-open ? submit-command : (continuation / mention-accept / submitTurn);
`tab` → command-open ? completeCommandName : (mention-accept / no-op);
`escape` → command-open ? clear-command : (mention-clear / no-op);
arrows/backspace → `syncCommand` (mirror of `syncMention`) so editing refreshes the query.

### D3. `ChatComposer.tsx` — `CommandPopup` + catalog injection

Add a `CommandPopup` (mirrors `MentionPopup`): when `state.command` is set, render up to 8 rows of
`/name` + dim ` description` (truncate description to one line; show `argumentHint` if present); inverse-
highlight `index`; "no matches" when empty. Accept a new prop `commandCatalog: CommandEntry[]`; an effect
(mirroring the mention fs-walk) injects it via `setCommandCatalog` the first time a command opens with an
empty catalog. Render `{state.command ? <CommandPopup …/> : null}` alongside the existing mention popup.

### D4. `useChat.ts` — fetch the catalog, provide it, route dispatch

- **Fetch once:** add `commandCatalog: CommandEntry[]` to `ChatState` (default `[]`). On session init (an
  effect, or folded into the existing capabilities path), call `session.capabilities()`, map `.commands`
  through `toCatalogEntry` (filter nulls), `mergeCommands(LOCAL_COMMAND_ENTRIES, catalog)`, and store. Disposed-
  guarded; a throw/empty leaves the local-only list (palette still works for local commands).
- **Provide:** expose `commandCatalog` so `ChatApp` passes it to `ChatComposer`.
- **Route** in `handleCommand(cmd)`: if `cmd.name` matches a LOCAL command → the existing `switch` (engine ops,
  unchanged). Else if `cmd.name` is in the catalog (a non-local name) → `submit("/" + cmd.name + (cmd.args ? " "
  + cmd.args : ""))` as a normal turn (it streams like any turn — a skill/plugin command runs its body). Else →
  `formatUnknown`. (The existing `switch default` becomes "catalog-or-unknown".)

### D5. `ChatApp.tsx` — thread the catalog prop

Pass `state.commandCatalog` from `useChat` into `<ChatComposer commandCatalog={…} … />`. No other change.

## Data flow

```
type "/"        → editor.openCommand → command.query=""        → effect injects catalog → CommandPopup (all)
type "/br"      → refreshCommand → rankCommands → items=[brainstorming,…]    → popup filters
↑/↓             → command.index moves
Tab             → buffer "/brainstorming ", command cleared    → type args
Enter (popup)   → submit "/brainstorming"
  → useChat.handleCommand: not local → in catalog → session.submit("/brainstorming") → streams the skill turn
Enter on "/model sonnet" (space closed popup) → submit → local → existing setModel switch
```

## Error handling & edge cases

- **Catalog fetch fails / empty:** palette falls back to the 9 local commands (`mergeCommands` with `[]`); no
  crash. Disposed-guarded so a late resolve after unmount is dropped.
- **`/` mid-text:** never opens a command (open-guard requires a pre-empty buffer). Mention (`@`) is unaffected.
- **Name collision:** local wins (`mergeCommands` dedups catalog against local). The 105 are skills/plugins/user
  commands and are disjoint from our 9 built-ins (verified in probe 30), so collisions are not expected.
- **Catalog command that gates** (shouldn't happen — built-ins aren't in `capabilities().commands`): if one
  did, submit-as-prompt would surface the SDK's "not available" text as the turn result — visible, not a crash.
- **Long-running catalog command** (`/brainstorming` runs a full workflow): fine in the REPL — it streams like
  any turn; the user drives it. Not exercised in tests (a non-goal).

## Testing strategy

**Keyless unit (run from `tui/`; build harness first):**
- `commands.test.ts`: `mergeCommands` (local-first, local wins on collision, catalog union); `toCatalogEntry`
  (string and object shapes, null on bad input); `rankCommands` (empty query → first N; fuzzy filter+order).
- `editor.test.ts`: `/` at buffer start opens command (real `"/"` insert); typing filters via injected catalog;
  Tab → `"/<name> "` + popup closed; Enter (popup open) → `submit === "/<name>"`; space closes popup; Esc keeps
  text + closes popup; `/` mid-text does NOT open; a mention (`@`) path still works unchanged (regression).
- `components.test.tsx`: `CommandPopup` renders `/name` + description for an open command state; "no matches"
  when items empty.
- `useChat.test.tsx`: `handleCommand` routes a LOCAL name to its engine op (fake session method called); a
  CATALOG name to `session.submit("/name …")` (fake submit called with the slash string); an unknown name to
  `formatUnknown`. Catalog fetch maps `capabilities().commands` → entries (fake `capabilities`).

**OAuth-gated live e2e (`test/live/`, gates on `ANTHROPIC_API_KEY || CLAUDE_CODE_OAUTH_TOKEN`):**
- `command-catalog.e2e.test.ts`: `session.capabilities().commands` returns a **non-empty** list whose entries
  carry a string `name` (the real headless catalog). Cheap — does NOT run a skill command (a non-goal: those
  are long agentic turns).

## Non-goals (YAGNI)

- Installing / discovering plugins or skills from disk or a marketplace (already inherited via `settingSources`).
- A command palette in the daemon console (chat REPL only, per the approved scope).
- Making the gated built-ins executable via the SDK (they stay local engine commands).
- Executing long catalog commands inside tests.
- Argument-aware completion (completing a command's *arguments*) — only the command name autocompletes.

## Probes / evidence

- `probes/probes/30-commands-skills-surface.ts` — 105 entries, shape `{name, description, argumentHint, aliases}`,
  names = skills + plugin + user commands.
- `probes/probes/31-slash-command-invocation.ts` — built-ins GATE; skills/plugin/user commands EXECUTE as
  prompts (run real turns).
