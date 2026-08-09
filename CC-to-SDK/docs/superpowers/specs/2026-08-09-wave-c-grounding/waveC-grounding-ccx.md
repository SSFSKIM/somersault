# Wave C grounding — what ccx does TODAY

Read-only survey of `CC-to-SDK/harness/` pinning current behavior + code locations for every Wave C
finding. All paths relative to `/Users/new/Developer/GitHub/codex_somersault/CC-to-SDK/harness/`.
Line numbers are as of this session (branch `main`, working tree at commit `ac82e8a769`).

**Two triage citations have drifted and are corrected below:**
- The triage says the bare unknown-flag throw is `args.ts:133`. It is now **`args.ts:145`** (`:133` is
  inside the `--listen` IPv6 comment).
- `qa3-02` (banner/footer mode disagreement) **has already been fixed** by Wave T EP-T1 — see EP-C8.

---

## EP-C1 — Footer architecture

### Where the footer actually lives: TWO components, never one row

There is no single "footer". ccx paints a **stack of independent full-width rows**, all left-aligned,
all `paddingX={1}`, split across two owners:

**Owner A — `ChatComposer.tsx:936–973`** (the hint stack, rendered inside the composer's own column,
below `ComposerFrame`'s bottom rule). In render order:

| line | row | gate |
|---|---|---|
| `ChatComposer.tsx:953` | `! bash mode — runs locally in cwd (Enter to run)` | `mode === "bash"` |
| `ChatComposer.tsx:954` | `# memory — appends a note to CLAUDE.md (Enter to save)` | `mode === "memory"` |
| `ChatComposer.tsx:955` | pasting notice | `pasting` |
| `ChatComposer.tsx:958` | paste-expand hint | `pasteHint && !searching` |
| `ChatComposer.tsx:960` | `search prompts: <q>` (`InlineSearchRow`) | `search.searching` |
| `ChatComposer.tsx:965` | `(ctrl+r to search history)` | `searchHint` (5 s) |
| `ChatComposer.tsx:966` | `Ctrl+Y to paste deleted text` | `yankHint` (5 s) |
| `ChatComposer.tsx:967` | `esc again to clear` | `clearVisible` (800 ms arm) |
| `ChatComposer.tsx:968` | `Press ctrl+d again to exit` | `dArmed && isEmptyNow` (800 ms) |
| `ChatComposer.tsx:969` | **hint row 1** — `⏎ send · <newlineRung> · @ files · / commands · ! bash · <cycleKey> mode[ · ? help]` | `showFooter` |
| `ChatComposer.tsx:970` | **hint row 2** — `keyboardHint` | `showFooter` |

`showFooter` = `owns && mode === "normal" && !popupDrawn(suggest)` — `ChatComposer.tsx:908`.
`keyboardHint` — `ChatComposer.tsx:923`: `busy ? "<esc> interrupt" : isEmptyNow ? "<esc> rewind · ? help"
: "<esc> clear"`. Every chord string is derived from the live keymap
(`ChatComposer.tsx:914–919`, `formatBindings(bindings("chat:cycleMode"))` etc.), never a literal.

**Owner B — `ChatApp.tsx:758–764`** (below the composer, siblings of it in the app column):

- `ChatApp.tsx:758` — `Press Ctrl-C again to exit` (`exitArmed && !paneOwned`)
- `ChatApp.tsx:759` — `Press Esc again to rewind` (`escArmed && !paneOwned`)
- `ChatApp.tsx:764` — `<ChatStatusBar …/>`, **unconditional**, always the last row of the tree.

**`ChatStatusBar.tsx:19–46`** is a single flat `<Box>` (row direction) with fixed field order:
`model <value>` · `mode <value>` · optional `(<key> to cycle)` · `think <value>` · `ctx N%` ·
`⚠ auto-compact soon` · `usageWarn` · `⟳ streaming` · `⚙ N bg`. It takes eight props
(`model, mode, busy, ctxPct, thinkLevel, bgCount, usageWarn, composerOwnsKeys`) and renders no
user-extensible content.

### Right-aligned region

None anywhere in the composer/status chrome. The only `justifyContent` uses in `src/tui/` are
`composerFrame.tsx:133` (`flex-start`), `composerFrame.tsx:146` (`center`),
`suggestPopup.tsx:331,345` (`flex-end` on a column, i.e. vertical), and `dialogs/DialogFrame.tsx:98`
(`space-between` — the one existing two-region primitive in the codebase, inside a dialog).

### What happens while the user types

`isEmptyNow` is the only draft-sensitivity: hint row 1 drops its trailing `· ? help`
(`ChatComposer.tsx:969`) and hint row 2 flips from `esc rewind · ? help` to `esc clear`
(`ChatComposer.tsx:923`). The status bar row (`ChatApp.tsx:764`) is completely unaffected — the
mode chip never collapses.

### Transient hints get their own line

Yes — each of the nine transient rows above is its own `<Box paddingX={1}>`, so the composer block
grows and shrinks by whole rows as you edit. This is **explicitly recorded as a divergence in the
code** at `ChatComposer.tsx:961–964`: upstream pushes these through a notification queue
(`addNotification`, bundle L489537) into one slot; ccx has no notification queue, and the comment
names **F7 as the owner of the fix**. Each hint owns its own `useState` + `setTimeout`
(`ChatComposer.tsx:319–337`, timers at `:633`, `:652`; constants `PASTE_HINT_MS = 8000` at `:42`,
`HISTORY_HINT_MS = 5000` at `:49`, `yankHintMs = 5000` default at `:219`).

**Verdict (footer architecture): DIVERGENT.** The rows exist and are honest, keymap-derived, and
ownership-gated — but the shape is a variable-height left-aligned stack across two components,
against upstream's fixed one row + one right region. There is no right-aligned primitive and no
shared hint slot to collapse into. This is a re-architecture, not a fill-in.

**Verdict (qa1-13, transient hints on their own line): ABSENT** (no notification queue / single
slot) — already flagged in-code as F7's job.

**Verdict (qa6-10, typing collapse): PARTIAL.** Delta: ccx trims two hint suffixes but never
collapses the mode chip or drops the shortcuts/agents segments, because the mode chip lives in a
different component (`ChatStatusBar`) that receives no draft signal at all.

### qa6-13 — the ccx-extra context-% chip

Rendered at **`ChatStatusBar.tsx:41`**; the colour thresholds are **`ChatStatusBar.tsx:17`**
(`ctxColor`: unstyled < 50 %, `warning` ≥ 50, `error` ≥ 80) and the `⚠ auto-compact soon` tail is
appended in the same expression at ≥ 80.

Fed by `state.ctxPct` ← **`useChat.ts:282`** (state), written only by **`useChat.ts:811–816`**
(`refreshCtx`, `session.getContextUsage()` → `round(totalTokens / maxTokens * 100)`), called at
turn end (`useChat.ts:753`) and after a successful `/compact` (`useChat.ts:943`). Reset to
`undefined` on conversation replacement (`useChat.ts:537`) — that is why it is absent on a fresh
session and appears only after the first turn.

Two neighbours with no upstream footer counterpart share the bar: `usageWarn`
(`ChatStatusBar.tsx:42`, fed by `useChat.ts:819–822` → `usageFormat.ts` `usageWarning`) and
`⚙ N bg` (`ChatStatusBar.tsx:44`, fed by `state.bgTasks.length`).

**Verdict: BUILT (ccx-extra).** It is a deliberate ccx surface with no upstream equivalent; the
Wave C decision is keep / move-behind-statusLine / drop, not "implement".

---

## EP-C2 — statusLine hook

**`grep -rn "statusLine" harness/src harness/test` returns zero hits.** There is no statusLine
setting, no command runner, no stdin-payload builder, no render slot, and no user-extensible chrome
of any kind. `ChatStatusBar.tsx` is a closed, hard-coded field list.

The settings-loading path that would have to carry it:

- **`src/config/types.ts:25`** — `settingSources?: SettingSource[]` (`"user" | "project" | "local"`),
  default all three at **`src/config/types.ts:153`**.
- **`src/config/settings.ts:20–26`** — resolves `settingSources` (empty when `disableProjectContext`).
- **`src/config/validate.ts:22`** — the zod enum.
- **`src/config/resolveOptions.ts:27`** — hands `settingSources` to the SDK `Options`.
- **`src/config/types.ts`** `settings?: Record<string, unknown>` is the inline-settings escape hatch
  (`--settings <json-or-file>`, parsed at `src/cli/args.ts:66–75`, `:126`).

Important consequence: ccx's settings are passed **into the SDK**, which reads `~/.claude/settings.json`
itself; ccx never parses that file for its own UI. There is no place today where ccx reads a settings
key and renders it. `src/tui/settingsFile.ts` (`mergeSettingsFile`) writes `permissions`/`outputStyle`
into project/local settings but has no reader for display.

**Verdict: ABSENT** — completely. Every piece (settings read, script spawn, stdin JSON payload
builder, render slot, invalidation cadence, footer-segment suppression) is new construction. This is
the largest single item in the wave, as the triage says.

---

## EP-C3 — CLI surface

**`src/cli/args.ts:145`** (triage said `:133` — drifted):

```ts
default:
  if (t.startsWith("-")) throw new Error(`unknown flag ${t}`);
```

That throw is caught at **`src/cli/main.ts:109`** → `fail(msg(e), 2)` → `console.error("ccx: unknown
flag --version")`, exit 2 (`src/cli/main.ts:99` is `fail`; `src/cli/bin.ts:18–21` is the top-level
catch, also `ccx: <msg>`).

- **`ccx --version`** → `ccx: unknown flag --version`, exit 2. There is **no version string anywhere
  in the CLI**. `package.json:3` says `"version": "0.1.0"`, and nothing imports it — the welcome
  banner carries no version either (see EP-C8).
- **`ccx --help`** → same path, exit 2. No usage text, no options listing, no subcommand listing.
- **`ccx help`** → `help` is not a recognised subcommand (`args.ts:81–83` recognises only
  `agents`/`attach`/`stop`/`rm`/`serve`/`fleet gc`), so it becomes the positional `prompt` for a
  `run`, which then hits the TTY gate at **`src/cli/main.ts:247`**:
  `fail("foreground ccx needs a terminal (use -p or --bg for scripts)", 2)`.
- **doctor** — no equivalent. The only `doctor` string in `src/` is `commands.ts:258` (a comment
  saying `/doctor` is deliberately forwarded to the model as a prompt) and `commandComplete.ts:63`
  (the SDK catalog's own `info` list). No health report, no install/version/auto-update introspection.

Related grammar facts worth having: `KNOWN_UNSUPPORTED` at **`args.ts:41`** is the existing pattern
for naming a flag we reject deliberately (`--remote-control`, `--chrome`, `--ide`, `--tmux`,
`--bare`, `--gateway`), and `--effort` already parses at **`args.ts:116`** with the domain at
**`args.ts:46`**.

**Verdict: ABSENT** for `--version`, `--help` and doctor. The grammar has a clean insertion point
(a valueless arm in the `switch` at `args.ts:97`, or a pre-parse intercept in `main()` beside the
`--__host` check at `main.ts:107`), and `fail()`/`exitAfterFlush` already give the right stdout/exit
discipline.

---

## EP-C4 — Chrome truth batch

### (a) Terminal title — qa6-04

`grep` for OSC 0/2 across `src/`: the only OSC emitters are **OSC 8 hyperlinks**
(`toolRenderer.tsx:96`, `markdownInline.ts:66`); `keys/parse.ts:53,158` only *consumes* OSC replies.
Nothing writes `\x1b]0;` / `\x1b]2;`. ccx never touches the pane title.

A session name does exist and would be the natural feed: `process.env.CLAUDE_CODE_SESSION_NAME` is
set at **`src/cli/main.ts:322`** (to `--name` or the short id — never a model-generated summary), and
`/rename` writes a session title via `useChat.ts:1053` / `renameSessionFn` (`useChat.ts:398`). There
is no auto-summary rename.

**Verdict: ABSENT.** Also note ccx has no model-generated turn summary to *put* in a title — that is
a second missing piece, not just a missing escape sequence.

### (b) Spinner — qa6-06

- Component: **`src/tui/TurnSpinner.tsx:10–26`**, mounted at **`ChatApp.tsx:577`** inside a
  three-way slot (`RetryRow` > `CompactionRow` > `TurnSpinner`, `ChatApp.tsx:574–578`).
- Glyph cycle: `spinner.ts:7–14` (`· ✢ ✳ ✶ ✻ ✽` out-and-back, 120 ms tick at `TurnSpinner.tsx:13`).
- Gerund: `spinner.ts:53–56` `pickVerb()` from the (then) 187-verb list at `spinner.ts:17–50` — 186 upstream plus the invented `Evaporating`, deleted in the Task 6 review round. Picked
  **once on mount** (`TurnSpinner.tsx:12`, `useRef(verb ?? pickVerb())`) — hence fixed for the whole
  turn. Upstream rotates mid-turn.
- Parenthetical: **`spinner.ts:80–83`** `spinnerStatus(elapsedMs, tokens)` →
  `"(" + [elapsed, tokens>0 ? "N tokens" : —, "esc to interrupt"].join(" · ") + ")"`.
  **The token counter IS built** — fed by `state.turnTokens` (`useChat.ts:347`), written from
  `LiveTurn.outputTokens` on every `stream_event` (`useChat.ts:642`) and on message frames
  (`useChat.ts:728`), reset to 0 at turn start (`useChat.ts:609`). QA-6 saw no tokens because its
  measurement turn was the network-failure turn (zero tokens). Delta vs upstream is the **format**
  (`142 tokens` vs `↓ 84 tokens`) and the **missing phase word**.
- Elapsed formatter: `spinner.ts:73–77` with a **documented known defect** in its own header
  (`spinner.ts:58–72`): separator `1m 05s` vs upstream `1m05s`, and no hour/day rollover. Whoever
  touches the tail is told to port upstream `$st` whole.

  > **CORRECTION (2026-08-10, Task 6 review).** The `1m05s` half of this row is WRONG, and this
  > grounding note is where the error propagated from: it repeated the claim in ccx's own stale
  > pre-Wave-C `spinner.ts` header instead of reading the bundle. The spinner's clock is
  > `he = ra(R)` (`C0p`, L407947), and `ra` is the export map's `formatDuration` (L107029 →
  > L107033) — **spaced and unpadded**, `1m 5s` for 65 s, `1h 2m 3s` for 3723 s. `$st`
  > (`formatBarElapsed`, L107079) is the `1m05s` spelling and is real, but its call sites are the
  > agent progress row (L430339), the workflow stats line (L430517) and the teammate/model rows
  > (L480289) — not the spinner, and not EP-C4's duration row, which is `ra` too. What survives
  > from this row: the **rollover** gap was genuine (ccx stopped at minutes; `ra` keeps going), and
  > the separator delta is the reverse of what is written above (ccx already had the space right).
- Phase word (`thinking`): **absent** — nothing in `spinner.ts` or `TurnSpinner.tsx` has a phase
  concept.

**Verdict: PARTIAL.** Deltas: (1) no phase word, (2) gerund does not rotate within a turn, (3) token
count lacks the `↓ ` prefix, (4) elapsed formatter diverges on separator and rolls over nowhere
above minutes.

### (c) Mode chip — qa6-09

- Render: **`ChatStatusBar.tsx:38–39`** — literally `mode ` + the **raw enum value** through
  `modeColor` (`ChatStatusBar.tsx:15`: `bypassPermissions`→error, `auto`→permission,
  `acceptEdits`→warning, else success). No glyph, no `on` suffix.
- Parenthetical: **`ChatStatusBar.tsx:33–34`** — `showCycle = composerOwnsKeys === true && mode !==
  "default" && cycleKey !== UNBOUND`, with the key string from the live table
  (`formatBindings(useBindingLookup()("chat:cycleMode"))`). The **suppress-on-home-state rule
  already matches upstream**, and the ownership gate (hide under dialogs) is a ccx correctness
  feature upstream does not have.
- Cycle: **`useChat.ts:1803`** `cycleMode()` → `ladderNext` (`useChat.ts:110`) over
  `LADDER = PERMISSION_MODE_OPTIONS` (`useChat.ts:108`), defined once at
  **`src/tui/settingsRows.ts:27`**: `["default", "acceptEdits", "plan", "auto"]`. Shared with the
  `/config` Default-permission-mode row (`settingsRows.ts:37`) so the two cannot drift.
  **The cycle ORDER already matches upstream** (manual→accept edits→plan→auto→manual ≡
  default→acceptEdits→plan→auto→default). qa6-09's "different cycle order" was an artifact of ccx
  launching in `auto`; **the home state is now `default`** (see EP-C8), so the ladder starts in the
  same place upstream's does.
- Home state: `default`, set at **`src/cli/main.ts:347`** (`permissionMode: inv.config.permissionMode
  ?? "default"`), Wave T EP-T1.
- Binding: `"shift+tab": "chat:cycleMode"` in the Chat context, **`keys/bindings.ts:44`**. The
  displayed spelling `⇧Tab` comes from `keys/hints.ts` `formatBindings`, not from a literal.

**Verdict: PARTIAL.** Deltas: (1) prints the camelCase enum (`acceptEdits`) instead of prose
(`accept edits`), (2) home state named `default` not `manual`, (3) no `⏸`/`⏵⏵` glyph, (4) no trailing
`on`, (5) chord rendered `⇧Tab` not `shift+tab`. Order and suppression rule are already right.

### (d) End-of-turn duration row — qa2-13

`grep -rn "Worked for\|Cooked for\|past-tense"` across `src/` → **zero hits**. There is no
past-tense verb vocabulary and no completion row. `ChatApp.tsx:574` unmounts the whole indicator
slot the instant `state.busy` goes false (`useChat.ts:753`), leaving nothing behind. The gerund list
(`spinner.ts:17–50`) is present and would be the sibling of the past-tense list the triage cites at
bundle L428307.

**Verdict: ABSENT.**

---

## EP-C5 — Ghost text follow-up

### What ghost text exists today

Exactly one kind, and it is **not** a follow-up suggestion: it is the **inline slash-command
completion**.

- `ghostText(state)` — **`src/tui/completions.ts:258`** (interface at `:257`, `acceptGhost` at
  `:278`); design notes at `completions.ts:231–256` transcribing upstream's `inlineGhostText`
  (bundle L490556). It takes a mid-text `/mod` and returns the suffix `e` so `/mode` is drawn dim
  after the caret.
- Read in the composer at **`ChatComposer.tsx:897`**, drawn by `renderBuffer`
  (**`ChatComposer.tsx:71–86`**, cursor-on-first-ghost-char rule at `:83–86`), rendered at
  **`ChatComposer.tsx:951`** and only when `ghost.visible`.
- Accepted by **Tab only** (`editor.ts:421–426`); Return deliberately falls through (`editor.ts:410–412`).

### The other "ghost" the QA saw is the placeholder, and it is a different mechanism

`PlaceholderCursor` at **`ChatComposer.tsx:949–950`** paints `placeholder` with its first char
inverted when the buffer is empty. `placeholder` comes from **`pickPlaceholder`
(`src/tui/placeholder.ts:145–157`)**, called at **`ChatComposer.tsx:864`**. The ladder:

```
!inputEmpty                                    → undefined
queueHasEditable && upHintSessions < 3         → "Press up to edit queued messages"
submitCount < 1 && !hasMessages && suggestionEnabled → `Try "<template>"`
otherwise                                      → undefined
```

That third rung is why qa1-06 is right that the placeholder **shows before the first turn and never
returns**: `submitCount` (`ChatApp.tsx:744` ← `useChat` state) is ≥ 1 forever after. The eight
templates + git-harvested `${file}` pool live in `placeholder.ts` (header at `:1–42` documents four
recorded divergences from upstream `MVf`/`NVf`).

### Model-generated follow-up suggestion

**None.** There is no per-turn suggestion generator, no state field to hold one, no wire channel to
carry one. The only trace of the concept is the SDK option:
**`src/config/types.ts:145`** — `promptSuggestions?: boolean; // 🚫 DEAD headless (probes 53/53b: no
prompt_suggestion frame after result)` — forwarded at **`src/config/resolveOptions.ts:106`**. The
live-probe verdict is already recorded: the SDK emits no `prompt_suggestion` frame headlessly, so
this cannot be sourced from the engine as-is and Wave C must decide between an explicit generation
call and dropping the item.

### Where a `Prompt suggestions` settings row would live

**`src/tui/settingsRows.ts:32–40`** `buildRows(ctx)` — the five-row Config list (Theme, Model,
Output style, Default permission mode, Thinking mode). A boolean row is already modelled
(`{ id: "thinking", type: "boolean" }`, `settingsRows.ts:38`). The plumbing that would carry it:
`ChatComposer`'s `suggestionEnabled` prop (**`ChatComposer.tsx:219`**, default `true`, documented at
`:268` as "upstream's `promptSuggestionEnabled` setting, which this port has no UI for") — and note
**`ChatApp.tsx:737–744` never passes it**, so it is unconditionally `true` today. Persistence would
go in `CcxPrefs` (**`src/tui/prefs.ts:31`**), which currently has no such field.

**Verdict (ghost-text follow-up): ABSENT.** Composer ghost-text machinery (dim inline suffix,
cursor-on-ghost rule, Tab accept) is BUILT and reusable as the *renderer*; the *content* — a
model-generated per-turn suggestion — does not exist and has a probe-verified dead SDK channel.

**Verdict (settings row): ABSENT** — but the row model, the boolean row type, the composer prop and
the prefs file all exist; it is a wiring job of four touch points.

---

## EP-C6 — Effort surfaces

### What ccx does with effort today: launch-time only

- **`src/cli/args.ts:116`** — `--effort` parses, domain `low|medium|high|xhigh|max`
  (`args.ts:46`, checked with `satisfies` against `HarnessConfig["effort"]`).
- **`src/config/types.ts:17`** — the config field; **`src/config/types.ts:162`** —
  `effort: "xhigh"` is the harness-wide DEFAULT.
- **`src/config/resolveOptions.ts:52–53`** — `options.effort = config.effort ?? DEFAULTS.effort`,
  handed to the SDK once at session construction.
- **`src/cli/spawn.ts:20`** — forwarded to detached children.

That is the whole surface. **`grep -rn "setEffort\|reasoningEffort" src` → zero hits.** No runtime
setter is ever called; effort cannot change after launch.

### `/effort` command

Deliberately refused: **`src/tui/commands.ts:264`** —
`effort: "effort maps to the thinking budget here — use /think <off|low|medium|high|xhigh|max|N>"`,
inside `CLIENT_SIDE_NOTES` (`commands.ts:261–268`), printed by `formatClientSide`
(`commands.ts:270–272`). So typing `/effort` today prints a dim redirect to `/think`.

Note the conflation this creates: ccx surfaces **`think <level>`** in the status bar
(`ChatStatusBar.tsx:40`, fed by `state.thinkLevel`), which is `session.setMaxThinkingTokens` — a
different SDK knob from `options.effort`. Wave C will have to decide whether `/effort` becomes real
(and therefore whether the SDK exposes a runtime effort setter at all — **this needs a live probe**)
or whether the status chip is renamed.

### `/model` picker effort row — qa4-01

**Absent.** `ModelPicker.tsx:123–150` renders exactly: `DialogFrame` (title + subtitle +
optional session-only line), the `Select` list, the overflow counter (`:146`), and the footer
(`:148`). Between the list and the footer there is nothing. Literals live in
`modelPickerModel.ts` — footer at **`modelPickerModel.ts:44`**
(`"enter to set as default · s to use this session only · esc to cancel"`, lowercase — that is also
qa1-14). No effort state, no `←/→` handler, no per-model effort-support predicate.

There is also **no effort chip** in the composer chrome (`ChatStatusBar.tsx` has no such field).

### Ephemeral-hint system that could host a 10 s decaying hint — qa6-02

There is no general mechanism, but there are **four hand-rolled instances of the exact pattern**, all
in `ChatComposer`: `yankHint` (`:319`, 5000 ms, timer at `:633`), `pasteHint` (`:322`, 8000 ms,
timer at `:652`), `searchHint` (`:333`, 5000 ms, fire-once ref at `:335`), plus the two armed
double-press hints (`clearVisible` `:930` / 800 ms, `dArmed` `:968` / 800 ms). Each is
`useState` + `useRef<Timeout>` + a cleanup in the unmount effect (`:337`).
**`ChatComposer.tsx:961–964`** explicitly records that upstream's equivalent is a *notification
queue* and that ccx does not have one, naming F7 as owner. That comment is the single best anchor
for Wave C: building the queue once fixes qa1-13, hosts qa6-02, and gives qa6-07 a slot.

**Verdict (effort): PARTIAL — launch-only.** `--effort` and the SDK option are BUILT; the runtime
setter, the `/effort` command, the picker row, the chip and the decaying hint are all ABSENT, and
`/effort` is currently *actively redirected away* by a hard-coded note that Wave C must delete.

**Verdict (ephemeral-hint host): ABSENT** as a system, PRESENT four times as a copy-pasted pattern.

---

## EP-C7 — Composer keys

### Ctrl+C — qa1-04 / qa6-08

Bound `"ctrl+c": "app:interrupt"` in **Global** (`keys/bindings.ts:36`). Handler is
**`ChatApp.tsx:404–408`**:

```ts
"app:interrupt": () => {
  if (rootStateRef.current.busy) { interruptRef.current(); disarm(); return; }
  if (exitArmedRef.current) { exitRef.current(); return; }
  setExitArmed(true); … setTimeout(() => setExitArmed(false), 2000);
}
```

It **never touches the draft** — the editor buffer lives in `ChatComposer`'s own state and this
handler is in `ChatApp`, which has no write channel to it (only `prefill`, one-way). So on a
non-empty composer the first Ctrl-C arms exit and keeps the text; a second within 2 s exits and the
draft is lost. The hint renders as a **fourth stacked row** at `ChatApp.tsx:758` and lives the full
2000 ms (upstream flashes ~250–500 ms).

Separately, `ChatComposer` binds its own `app:exit` for **Ctrl-D** (`keys/bindings.ts:50`,
`exitArm()` at `ChatComposer.tsx:514–521`, 800 ms via `exitArmMs`, gated on an empty buffer at
`ChatComposer.tsx:968`). Two different arms with two different windows and two different rows.

**Verdict: DIVERGENT.** Upstream's first Ctrl-C on a non-empty draft *clears* it and arms nothing;
ccx arms exit and preserves. Fixing it means giving `app:interrupt` a clear-the-composer channel
(the composer's `clearInput` reducer exists — `editor.ts:392` `case "l"` — but is only reachable
from inside the composer).

### Esc — qa1-05 (`Esc clear` is advertised but a single Esc does nothing)

Bound `"escape": "chat:cancel"` in **Chat** (`keys/bindings.ts:43`), handler
`ChatComposer.tsx:693` → `cancel()` at **`ChatComposer.tsx:533–567`**. The idle-with-text branch is
`:548–564`: it is a **deliberate 800 ms double-press** (`escClearMs`, `ChatComposer.tsx:219`
default 800) — first Esc arms and shows `esc again to clear` (`:967`), second Esc within the window
clears and persists the draft to history (`:549–558`). The code cites upstream CM15 as its source.

So qa1-05's ccx observation is accurate and the *footer text is the lie*: `keyboardHint`
(`ChatComposer.tsx:923`) says `esc clear` unconditionally on a non-empty draft, describing a
one-press action that is really two. Note also the QA repro "one Escape leaves it unchanged even
after 3 s" is consistent with the arm expiring at 800 ms.

**Verdict: DIVERGENT (honesty bug).** The behavior is an intentional transcription; the hint copy
contradicts it. Upstream's answer (qa1-04) is that Esc never clears at all and no such hint exists —
so the fix is a copy/behavior decision, not a keymap fix.

### Home / End — qa1-01

The **parser handles them correctly**: `keys/parse.ts:42` (`TILDE`: `1`/`7`→home, `4`/`8`→end),
`:46` (`CSI_LETTER`: `H`→home, `F`→end), `:47` (`SS3` same). The loss is one layer down at
**`keys/editorAdapter.ts:17–22`** — `NAMED` deliberately omits home/end — and
**`keys/editorAdapter.ts:44`**: `return { input: "", key }` with the comment
*"home/end/pageup/insert/f1–f12: a no-op edit"*. The editor reducer receives an empty input with no
flag and returns unchanged.

The target operations already exist: `lineStart`/`lineEnd` are bound to ctrl+a / ctrl+e at
**`editor.ts:379–380`**. Other contexts already bind home/end (`bindings.ts:80` Transcript →
`scroll:top`/`scroll:bottom`; `:170`, `:196` Select → `select:first`/`select:last`) — **Chat is the
one context that does not**.

**Verdict: ABSENT (one-line-ish).** Add `home`/`end` to `NAMED` (or bind them in the Chat context to
new `editor:lineStart`/`editor:lineEnd` actions). The reducer ops are already there.

### ctrl+← / ctrl+→ — qa1-02

Parser produces `{name:"left", ctrl:true}` correctly (`parse.ts:21–25` `decodeMods`, `:46`).
`editorAdapter.ts:34–39` maps that to `{ input: "", key: { ctrl: true, leftArrow: true } }`. In
`editor.ts` the meta branch (`:358–364`) doesn't match (no `key.meta`), so it falls into the
**ctrl switch at `:374`**, which switches on `input` — which is `""` — and lands in
**`default: return { state: s }`** (`editor.ts:394`). Silent no-op.

Alt+← / alt+→ / alt+b / alt+f **do** work (`editor.ts:359–360`).

**Verdict: ABSENT (one-line-ish).** Add a ctrl+arrow arm above the ctrl switch, delegating to the
existing `wordLeft`/`wordRight`.

### Word-forward semantics — qa1-03

**`editor.ts:240–246`** `wordRight`: skip whitespace, then skip non-whitespace — i.e. it lands at the
**end of the current word** (emacs `forward-word`). Upstream lands at the **start of the next word**.
`wordLeft` is at `:233–239`. Both snap out of paste chips in the direction of travel
(`:229–232`, transcribing upstream `snapOutOfPlaceholder`). `deleteWordAfter` (`:250–253`) is built
on `wordRight`, so changing the boundary changes alt+d too — worth naming in the spec.

**Verdict: DIVERGENT.** One boundary rule in one function; the blast radius is `wordRight`,
`deleteWordAfter`, and any test that pins alt+f/alt+right positions.

### Exit-arm affordance summary

Two independent arms, both rendering `Press <key> again to exit`:
`ChatApp.tsx:758` (Ctrl-C, 2000 ms, `!paneOwned`-gated) and `ChatComposer.tsx:968` (Ctrl-D, 800 ms,
empty-buffer-gated). Plus `ChatApp.tsx:759` `Press Esc again to rewind` (1500 ms,
`ChatApp.tsx:300–307`) and `ChatComposer.tsx:967` `esc again to clear` (800 ms). **Four arm hints,
four different windows, four different owners** — a coherence problem the spec should name even
though no single finding covers it.

---

## EP-C8 — Live banner & picker state

### What the banner prints, and where its data comes from

**`src/tui/banner.ts:18–37`** `welcomeBanner({ cwd, model, mode })` returns a `RenderLine[]`:

```
╭───…───╮
│ ✻ Welcome to Claude Code │        ← banner.ts:19, NO version anywhere
╰───…───╯
(blank)
  cwd    <shortCwd>                 ← banner.ts:27
  model  <model ?? "(default)">   ·   mode  <mode ?? "default">   ← banner.ts:28
(blank)
  Tips for getting started          ← banner.ts:30–33, three bullets
```

**It is a SNAPSHOT, structurally.** `banner.ts:1–5` says so: the lines are "seeded ONCE as the first
lines of the Static scrollback". The call site is **`src/cli/main.ts:372`**, which wraps it as an
`initialEntries` local notice. Once in Ink's `<Static>` it can never re-render — so it cannot track
a `/model` or Shift-Tab change even in principle. Upstream's welcome box live-updates.

### The banner-vs-footer disagreement, cause named — qa4-02 / qa6-14 / qa3-02

The two consumers in `main.ts` read **the same object but two different fields, one raw and one
resolved**:

| surface | expression | value with no `--model` / no prefs |
|---|---|---|
| banner model | `welcomeBanner({ …, model, … })` → `info.model ?? "(default)"` (`banner.ts:28`) | **`(default)`** |
| footer model | `hookOpts.initialModel = resolveModelAlias(model) ?? DEFAULTS.model` (`main.ts:377`) | **`claude-opus-5`** (`config/types.ts:161`) |

`model` itself is `inv.config.model ?? deps.loadPrefs().model` (**`main.ts:338`**) — `undefined`
on a fresh isolated HOME. So the banner prints the *unresolved* value and the footer prints the
*resolved* one. **That is the whole cause of qa4-02's and qa6-14's model disagreement**, and the fix
is one expression: hand the banner `resolveModelAlias(model) ?? DEFAULTS.model` (ideally the display
name, which requires the catalog and therefore an engine round-trip the banner does not have today).

**qa3-02's MODE disagreement is already fixed.** `main.ts:346–347` builds one `foregroundConfig`
with `permissionMode: inv.config.permissionMode ?? "default"`, and **both** the banner
(`main.ts:372`, `resolvedPermissionMode(foregroundConfig)`) and `hookOpts.initialMode`
(`main.ts:377`) read it through the same `resolvedPermissionMode`
(`config/resolveOptions.ts:113–115`). The comment at `main.ts:344–345` explicitly says this is to
prevent "qa3-02 inverted". Wave T EP-T1 shipped it. **The banner and footer now both say `default`.**

### `/model` picker's `Default (recommended)` row — qa4-02

**ccx does not author that row.** `openModelPicker` (**`useChat.ts:1227–1251`**) calls
`session.capabilities()` (**`src/session/session.ts:247–253`**) which is a straight pass-through of
the SDK's `query.supportedModels()`. The rows — including `Default (recommended) ✔ Sonnet 5 ·
Efficient for routine tasks` — are the **SDK's own catalog strings**, rendered verbatim by
`ModelPicker.tsx:135` via `modelLabel` (`modelPickerModel.ts:48`).

So the picker is telling the truth about *the SDK's* default while ccx overrides it with
`DEFAULTS.model = "claude-opus-5"` (`config/types.ts:161`) at `resolveOptions.ts:48`. The tick mark
does land correctly — `current` is matched through `resolveModelAlias` (`useChat.ts:1243`) — but the
row's *description text* still describes Sonnet.

(A different `Default (recommended)` string, `settingsRows.ts:28` `MODEL_UNSET`, is the `/config`
Model row's placeholder; unrelated but easy to confuse when grepping.)

**Verdict (banner): PARTIAL / DIVERGENT.**
- Version in header: **ABSENT** (`package.json:3` is `0.1.0` and unread by any code).
- Auth-provider label: **ABSENT**.
- Model as display name: **DIVERGENT** — prints `(default)` where the engine runs `claude-opus-5`;
  cause pinned to `main.ts:338/372` vs `main.ts:377`.
- Live binding: **ABSENT by construction** — the banner is Static scrollback (`banner.ts:1–5`), so
  making it live is a re-architecture (move it out of `<Static>`), not a data fix.
- Mode row: **already consistent** (qa3-02 fixed, Wave T EP-T1).
- `What's new` / release-notes block: **ABSENT** — no changelog data source exists anywhere in
  `src/` (grep for `release-notes` hits only the SDK catalog string at `commandComplete.ts:63`).

**Verdict (`Default (recommended)` row): DIVERGENT, and the divergence is upstream-of-ccx** — the
text is the SDK's, the default is ccx's. Fixing it means either re-labelling the row locally or
aligning `DEFAULTS.model` with the SDK's default. This is a product decision, not a rendering bug.

---

## qa1-10 — the `#` memory mode (ccx-extra; absent from 2.1.220 AND 2.1.222)

The triage adjudicates this as **POST-220 (inverse)**: upstream's composer resolver returns only
`"prompt"` or `"bash"` (bundle L374525–374537), so `#` has no upstream counterpart at the pinned
version. It is a keep-or-drop product decision.

**Everything removing it would touch — seven files:**

| file:line | what |
|---|---|
| `src/tui/promptMode.ts:24` | `export type InputMode = "bash" \| "memory" \| "normal"` — the third member |
| `src/tui/promptMode.ts:33–37` | `composerMode(display)`: the `startsWith("#")` arm |
| `src/tui/promptMode.ts:42–45` | `modeOfDisplay` projects memory→prompt (would become trivial) |
| `src/tui/memory.ts` (whole file, 17 lines) | `appendMemory(note, cwd)` — appends `- <note>` under `## Memories` in `<cwd>/CLAUDE.md` |
| `src/tui/useChat.ts:49` | `import { appendMemory as realAppendMemory }` |
| `src/tui/useChat.ts:119` | the `appendMemory?` slot in the `deps` object type |
| `src/tui/useChat.ts:385` | `const appendMemory = deps.appendMemory ?? realAppendMemory` |
| `src/tui/useChat.ts:1607–1612` | `memoryMode(note)` — appends `✓ noted in <path>` |
| `src/tui/useChat.ts:1617` | the dispatch arm `if (prompt.startsWith("#")) …` |
| `src/tui/ChatComposer.tsx:954` | the `# memory — appends a note to CLAUDE.md (Enter to save)` hint row |
| `src/tui/composerFrame.tsx:48` | the `remember`-token border colour for memory mode |
| `src/tui/keys/hints.ts:208` | the `? `-overlay grid cell `# for memory` |
| `src/tui/editor.ts:124` | a comment referencing the memory/normal split |

Plus tests: `memory` appears 38 times across `test/`, notably `test/tui/chat.test.tsx`,
`test/tui/editor.test.ts`, `test/tui/components.test.tsx`, `test/tui/shortcuts-grid.test.tsx`,
`test/tui/f5-acceptance.test.tsx`, `test/tui/useChat.test.tsx`, `test/tui/honesty.test.tsx`.
Note the `## Memories`-in-CLAUDE.md behavior is *also* a user-facing data contract — removing it
orphans any CLAUDE.md section a user already accumulated.

**Verdict: BUILT (ccx-extra, no upstream counterpart).** Removal is a 7-file + ~7-test-file change
with a small user-data consequence.

---

## Summary table

| Epic / id | Verdict |
|---|---|
| C1 footer shape (qa6-01) | DIVERGENT — variable-height left stack across 2 components; no right region |
| C1 transient own-line (qa1-13) | ABSENT — no notification queue; already flagged F7 in-code |
| C1 typing collapse (qa6-10) | PARTIAL — two suffixes trim; mode chip never collapses (wrong component) |
| C1 ctx% chip (qa6-13) | BUILT (ccx-extra) — keep/move/drop decision |
| C2 statusLine (qa6-03) | ABSENT — zero hits; every piece is new construction |
| C3 --version/--help/doctor (qa6-12) | ABSENT — bare throw at `args.ts:145` (not `:133`), exit 2 |
| C4 terminal title (qa6-04) | ABSENT — no OSC 0/2, and no turn summary to put in one |
| C4 spinner (qa6-06) | PARTIAL — tokens BUILT; no phase word, no rotation, elapsed format diverges |
| C4 mode chip (qa6-09) | PARTIAL — order + suppression already right; naming/glyph/`on`/chord wrong |
| C4 duration row (qa2-13) | ABSENT |
| C5 ghost follow-up (qa6-07, qa1-06) | ABSENT content, BUILT renderer; SDK channel probe-dead |
| C5 `Prompt suggestions` row | ABSENT — 4 wiring points, all of which exist |
| C6 effort (qa4-01, qa6-02) | PARTIAL — launch-only; no setter, no `/effort` (actively redirected), no row, no chip |
| C6 ephemeral-hint host | ABSENT as a system; 4 hand-rolled instances |
| C7 Ctrl+C (qa1-04, qa6-08) | DIVERGENT — arms exit, keeps draft; 2000 ms row vs upstream ~300 ms flash |
| C7 Esc clear (qa1-05) | DIVERGENT — real behavior is an intentional 800 ms double-press; hint copy lies |
| C7 Home/End (qa1-01) | ABSENT — parser correct, `editorAdapter.ts:44` drops them; ops exist |
| C7 ctrl+arrows (qa1-02) | ABSENT — falls into `editor.ts:394` default; ops exist |
| C7 word-forward (qa1-03) | DIVERGENT — one boundary rule in `wordRight`; also moves alt+d |
| C8 banner version / What's-new / auth | ABSENT |
| C8 banner model (qa4-02, qa6-14) | DIVERGENT — raw vs resolved, cause pinned |
| C8 banner liveness | ABSENT by construction — it is Static scrollback |
| C8 banner mode (qa3-02) | **ALREADY FIXED** (Wave T EP-T1) |
| C8 `Default (recommended)` row | DIVERGENT — SDK-authored text vs ccx-authored default |
| qa1-10 `#` memory | BUILT (ccx-extra); removal touches 7 src files + ~7 test files + user CLAUDE.md data |
