# W4 — Master inventory: cloning Claude Code 2.1.220's terminal UI

Consolidation of six domain research reports (`01-live-turn` · `02-transcript` · `03-composer` ·
`04-chrome` · `05-dialogs` · `06-keys-themes`) into one decision-ready plan.
Reference: `~/claude-code-bundle/2.1.220/cli.pretty.js`. Ours: `CC-to-SDK/harness/src/tui/`.

**Raw rows across the six reports: 334. After deduplication: 271 entries.**
(Report 03's own summary line says 62 rows; its table actually has 78 — arithmetic slip, recounted here.
Raw = 30 + 48 + 78 + 43 + 76 + 59. Deduplicated = §A 9 · §B 22 · §C 39 · §D 58 · §E 39 · §F 69 · §G 23 · §H 12.)

---

## Executive summary

Six reports diffed real Claude Code against `ccx`. Merged and deduplicated, there are **271 distinct
gaps**. The headline is not the count — it is that our own parity scorecard scores ✅ on ~20 rows
that measurably diverge, so we have been steering by a broken map.

**Three things are urgent because they cost users work or lie to them.** Escape destroys queued
message text where upstream hands it back to the composer. Esc-Esc with text in the composer opens
the destructive rewind picker where upstream clears the input (and saves it to history). Our
`Ctrl-_` undo is dead code that inserts a raw control character into the buffer — and our own help
overlay advertises it. Two more: `Ctrl-D` ends the session on one press where upstream needs two,
and the help overlay closes on any key *while that key also fires the global chord behind it*.

**Six things are structural** — each one makes several later items cheap, and skipping them means
building the same thing twice. The biggest: our live-turn and replay paths render the same tool call
two different ways, which is why the six reports disagreed about our own behaviour. Unifying them
gates all collapsing work. The others are a verbose/collapsed mode (upstream's `(ctrl+o to expand)`
is a real renderer flip, not a label), a widened theme token set (we have 3 tokens against upstream's
72, with ~15 colours hardcoded across five files), a declarative keybinding table with an ordered
context stack (which makes our double-fire bugs structurally impossible), one shared `Select`/`Tabs`
primitive, and a notification queue.

**One premise is settled and reshapes a third of the work.** Probe 77 proved the SDK's tool wire is
flat text — no `structuredPatch`, no counts. Upstream's typed result rows must be *derived*
client-side; all are derivable except absolute diff line numbers, which need us to read the file
ourselves (legitimate — we share the cwd). The same probe found this SDK's tool vocabulary differs
from upstream's, so per-tool phrasing cannot be transcribed one-for-one.

**We also ship more than upstream in ~14 places** — six in the status bar alone. On a cloning brief
that is a defect too, though four of them are worth keeping and saying so.

Proposed: **8 waves**, 3–5 days each. Start with the harm list, then the renderer unification, and
run the `canUseTool` field-dump probe immediately — the largest single cluster (69 dialog entries) is
unschedulable without it.

---

## Reading this document

- **Class**: `missing` (nothing there) · `partial` (there, incomplete) · `divergent` (there,
  different) · `over` (we ship what upstream does not) · `n/a` (unreachable or deliberately out).
- **Effort**, normalised across the six reports' differing scales: **S** ≤ half a day · **M** 1–2
  days · **L** 3+ days.
- **Tier**: 0 harm · 1 structural · 2 high-fidelity-per-effort · 3 substantial-but-worth-it ·
  4 large/low-return · 5 do-not-clone.
- **Src**: contributing report and its row id. Two ids means the reports overlapped; a note follows
  where they disagreed.

---

# 1. Priority tiers, argued

## Tier 0 — loses data or actively misleads (8 entries)

The argument for putting these first is not fidelity, it is that every one of them is currently
costing a user something real, and every one is S-effort. There is no version of this plan where
these wait behind a rendering wave.

Three destroy typed text: `CM49` (Escape clears the queue outright — upstream pops it back into the
composer), `CM16` (Esc-Esc opens rewind instead of clearing, so a muscle-memory buffer-clear opens a
time-travel dialog), and `CM10`/`CM11` (kill without yank — `ctrl+u`/`ctrl+k`/`ctrl+w` discard
permanently; upstream keeps a ring and even hints `Ctrl+Y to paste deleted text`).

Three advertise something false: `KB4` (`ctrl+_` undo is unreachable, inserts `\x1f`, and
`ShortcutsOverlay.tsx:18` promises it), `KB6` (help overlay closes on any key and the key
double-fires — `ctrl+o` closes help *and* opens the pager), and `KB3` (`ctrl+d` exits on one press).

One is a surprise with a defensible cause: `KB5` (`ctrl+z` detaches where the shell should suspend;
upstream flags `ctrl+z` reserved and leaves it free).

## Tier 1 — structural (9 entries, §A)

The test for this tier is: *does skipping it mean building the same thing twice?*

`ST1` (unified tool renderer) is the clearest case — the reports themselves disagreed about our
behaviour because report 01 read `liveTurn.ts` and report 02 read `render.ts`, and the two emit
different text for the same call. Collapsing, typed result rows, and expand-affordances all have to
be written once per renderer until this lands.

`ST2` (verbose/collapsed mode) is the same shape: upstream's `(ctrl+o to expand)` is not a label, it
is a flag that flips `Ima` from summary to per-row, makes `p2`/`UP` skip truncation, and makes the
hint itself render `null`. Every "3 lines then more" affordance, the collapsed groups, expanded
thinking, and expanded diffs are one mechanism. Our scorecard rates this LOW; it is the opposite.

`ST4` (theme tokens) gates five theme rows and unblocks ~40 renderer entries that currently hardcode
`"red"`/`"cyan"`/`"green"` in five files where `setTheme()` cannot see them.

`ST5`+`ST6` (keybinding table + precedence resolver) turn the Tier-0 double-fire class from "fix each
site" into "structurally impossible", and gate every hint string being generated from the live
binding rather than hardcoded.

`ST3` (derived result summaries), `ST7` (one Select/Tabs), `ST8` (notification queue), `ST9` (gutter
+ overflow primitives) each cheapen 8–20 downstream entries.

## Tier 2 — high fidelity per unit of effort (≈70 entries)

Mostly one-line or one-function changes that a Claude Code user notices immediately: glyphs, exact
literals, colours, marker characters, small key binds. Collected as a quick-win list in §11.

## Tier 3 — substantial but clearly worth it (≈95 entries)

Paste chips, persisted history, the permission-dialog family, markdown depth, diff fidelity, the
footer rebuild, spinner behaviour, terminal integration.

## Tier 4 — large, or low return for the size (≈50 entries)

Vim mode, custom/plugin themes, DiffDialog, full highlight.js grammar, mouse support, screen-reader
mode, the statusLine extension point, the tip catalog's scheduler.

## Tier 5 — do not clone (≈38 entries)

Argued individually in §10. Short version: some of upstream's behaviour exists only because it *is*
the CLI (statusLine as an instrumentation escape hatch, rule engines we own directly), some is
vestigial (the diff sidebar's actions have no registered handler anywhere in the bundle), some is
remote-service-coupled, and in a few places we made a deliberate improvement worth defending.

---

# 2. §A — Structural (9)

| ID | Upstream | Ours | Class | Effort | Tier | Src |
|---|---|---|---|---|---|---|
| ST1 | One renderer produces a tool row wherever it appears | `liveTurn.ts:renderBlock` and `render.ts:renderMessage` emit **different text for the same tool call** — live shows `Name target` (no parens, no bold), replay shows `● Name(target)` | divergent | M | **1** | 01#30 |
| ST2 | `(ctrl+o to expand)` flips `verbose` for every renderer: per-row instead of summary, no truncation, hint renders `null` | `ctrl+o` opens a scrollback pager; no collapsed/verbose distinction exists | divergent | M | **1** | 01#3, 02(Bg), 06 K30 |
| ST3 | Result rows read a structured `toolUseResult` | Wire is flat text (probe 77) — every summary must be derived client-side; absolute diff line numbers need reading the file | missing | M | **1** | 01#1/#23, 02#28/#29/#32, probe 77 |
| ST4 | 72 semantic tokens read by name; 956 prop usages | `ThemeTokens` = 3 (`accent`, `diffAdd`, `diffRemove`); ~15 painted colours hardcoded in 5 files, invisible to `setTheme()` | partial (~4%) | L | **1** | 06 T1/T10/T11/T12 |
| ST5 | Declarative table `jar`: 19 contexts × 180 bindings, one source of truth; every hint string generated from the live binding | 17 ad-hoc `useInput` callbacks; hardcoded chord strings throughout | missing | L | **1** | 06 K1/K5/K6/K7/K8, 03 X1 |
| ST6 | Ordered-context resolver over a focus scope chain, first match wins, `Global` last; `swallowAll` + `preemptiveScopes` above it | Nested-ternary unmounting + 6 hand-checked flags; 7 surfaces ungated → real double-fires | missing | L | **1** | 06 K2/K3 §1.8 |
| ST7 | One `Select` (absolute indexes, `↑`/`↓` gutter overflow, `inlineDescriptions`, `type:"input"` rows, height-clamped paging) + one `Tabs`, used by 9 surfaces | Every dialog hand-rolls its list and key handling | missing | M | **1** | 05 S1/S2/S3, 03 A2–A6, 06 K28 |
| ST8 | Notification queue: 4 priorities, `fold`/`invalidates`/`pinned`, 8 s default, preemption+requeue | `notice()` appends a transcript line | missing | M | **1** | 04 C5, 05 N11 |
| ST9 | `Cr` gutter (5 cols, emitted once, content in a flex column, nested degrades) + `bM` (`… +N {unit}` + optional expand hint) | `"  ⎿ "` (4 cols) prefixed to **every** line; three ad-hoc "more" strings | divergent | S | **1** | 01#5/#25, 02#47 |

**Disagreement note (ST9).** 01 frames the gutter defect as "appears once vs every line"; 02 frames
it as "5 columns vs 4". Both are true and neither is complete — one defect, two partial views.

**Disagreement note (ST1).** 01#4 says our live turn shows only the first result line (48 chars);
02#48 says our result path caps at 12 lines × 100 chars. Neither is wrong: they read different
files. This *is* the evidence for ST1.

---

# 3. §B — Live turn and tool rendering (22)

| ID | Upstream | Ours | Class | Effort | Tier | Src |
|---|---|---|---|---|---|---|
| LT1 | Per-tool typed result rows: `Read 340 lines` · `Found 3 files` · `Added 2 lines, removed 3 lines` · `Wrote 42 lines` · `Received 42.1 kB (200 OK)` · `Did 3 searches in 4s` | `trunc(firstResultLine(content))`, 48 chars, after `│` | missing | L | 3 | 01#1 |
| LT2 | Collapsed read/search/list groups with the 20-clause grammar, first clause capitalised, `", "` joins, bold counts, latch-to-max, finished group entirely dim | One line per tool, forever | missing | L | 3 | 01#2/#20 |
| LT3 | ≥2 same-name tool_use blocks in one API message collapse (`Running 3 agents…` / `3 agents finished`) | none | missing | M | 3 | 01#17 |
| LT4 | Live hint line `⎿ {path \| "pattern" \| $ cmd}`, 700 ms throttle, thinking summary wins for 3 s | none | missing | M | 3 | 01#21 |
| LT5 | Group elapsed ` · 12s` once the oldest unresolved tool passes 2000 ms; **no per-row elapsed** | Per-row elapsed from 1 s | divergent | S | 2 | 01#19 |
| LT6 | First 3 wrapped lines at width `cols−10`, then `… +N lines (ctrl+o to expand)`; one-hidden-line special case; no truncation in the text path | 12 lines × 100 chars, no more-marker; live shows one line | divergent | S | 2 | 01#4, 02#48 |
| LT7 | `⏺` (U+23FA) on macOS, `●` (U+25CF) elsewhere | `●` hardcoded | divergent | S | 2 | 01#9, 02#1 |
| LT8 | Running = the same bullet, dim, blinking at 600 ms; done = bullet in `success`; error = bullet in `error`; no `✗` anywhere | `⟳` static + elapsed; `✓`/`✗ …red` | divergent | S | 2 | 01#6/#7 |
| LT9 | Queued tool = static dim bullet, no animation; body reads dim `Waiting for permission…` | Row shows nothing; permission UI is a separate dialog | partial | S | 2 | 01#18, 03 V9 |
| LT10 | `⏺ **Name**(arg)` — bold name, `wrap:"truncate-end"`, parens added by the **row** not the tool | Live: `Name target`. Replay: `● Name(target)`. Neither bolds | partial | S | 2 | 01#8 |
| LT11 | `wd(path)` — cwd-relative, else `~`-prefixed — rendered as an OSC-8 `file://` hyperlink | Raw `file_path` verbatim, no link | partial | S | 2 | 01#11 |
| LT12 | Bash arg: 2 lines / 160 chars + `…`; a `sed -i` command renders as the **file path** | 80-char truncate, no line clamp, no sed case | partial | S | 2 | 01#10 |
| LT13 | `TodoWrite` renders **nothing** (`userFacingName()===""` → whole row null); `ToolSearch` is absorbed silently and contributes no clause | `● TodoWrite([...])` with a JSON-stringified arg | divergent | S | 2 | 01#12, 02#38, probe 77 |
| LT14 | `⎿ Interrupted · What should Claude do instead?` · `⎿ Tool use rejected` · `Denied by auto mode classifier` | No interrupted/rejected literal anywhere | missing | S | 2 | 01#13, 02#6 |
| LT15 | Generic error normalisation: `Tool execution failed` · strip `<error>`/sandbox tags · `Invalid tool parameters` · `Error: ` prefixing; then a 10-line clip | Raw text red with `✗` on line 1 | partial | S | 2 | 01#22 |
| LT16 | Agent progress: last 3 inner rows + `… +N tool uses (ctrl+o to expand)`; short-terminal fallback `In progress… · N tool uses`; `Initializing…` first | All nested rows, unbounded | partial | M | 3 | 01#15, 05 N5 |
| LT17 | `Done (7 tool uses · 24.1k tokens · 1m 12s)` as a bulleted assistant line | `● Agent <target> ✓ (N tools · Ss)` — no token count | partial | S | 3 | 01#16, 05 N5 |
| LT18 | Write preview = first 10 syntax-highlighted lines + `… +N lines` | Every line as `+ line`, cap 24, `… N more lines` | partial | S | 2 | 01#24 |
| LT19 | Bash live progress: last 5 lines in a `height:5` clipped box, `+N lines`, `({elapsed} · timeout t)` | Only `⟳ Bash <cmd> 3s` | missing | M | 4 | 01#14 |
| LT20 | Dim `(ctrl+b to run in background)` at `paddingLeft:5` under a running foreground Bash; tmux variant `ctrl+b ctrl+b (twice)` | `/bg` + Ctrl-B exist, no inline row hint | partial | S | 2 | 01#29, 05 N6 |
| LT21 | `⎿ Ran N PreToolUse hooks (120ms)` + per-command rows in verbose | none | missing | S | 4 | 01#26 |
| LT22 | `⎿ Allowed by auto mode classifier` / `Denied by auto mode classifier … see <link>` | none | missing | S | 4 | 01#28 |

**Probe-77 reshaping, applies across §B.** Upstream's per-tool clause table is keyed on
`Read`/`Grep`/`Glob`/`LS`/`TodoWrite`. In *this* SDK the model reaches for **Bash to grep and glob**,
there is **no `LS`**, and todos are `TaskCreate`/`TaskUpdate` **behind `ToolSearch`**. So:

- LT1's Grep/Glob renderers would fire on nothing — the classification must run on **Bash command
  text** (upstream already has this path: `Kr_` classifies word-0 against search/read/list sets).
- LT13's fix is not "hide TodoWrite" but "decide what `TaskCreate`/`TaskUpdate`/`ToolSearch` rows
  do". Upstream's `ToolSearch` rule (absorbed silently, no clause) transfers directly and is the
  right answer for our deferred-tool lookups.
- LT2's clause set should be built from an observed tool census, not transcribed.

---

# 4. §C — Static transcript (39)

### Message identity

| ID | Upstream | Ours | Class | Effort | Tier | Src |
|---|---|---|---|---|---|---|
| TR1 | Assistant bullet colour is the plain `text` token, **not an accent** | `ACCENT = "#d97757"` | divergent | S | 2 | 02#2 |
| TR2 | User echo: `❯ ` in `subtle` on a `userMessageBackground` band running to `width−1` | `› text` dim, no band | divergent | M | 3 | 02#3 |
| TR3 | Prompts > 10 000 chars fold to head(2500) / titled `(N lines hidden)` rule / tail(2500) | No truncation | missing | S | 2 | 02#4 |
| TR4 | Queued messages: same block, indented 2 cols, `subtle` in brief mode | Not rendered distinctly | missing | S | 3 | 02#5 |

**Correction to 02's probe list:** 02 flagged TR4 as needing a probe ("does the SDK surface a queued
state?"). It does not need one — our queue is entirely client-side in `useChat.ts`. Dropped from the
probe list.

### Markdown

| ID | Upstream | Ours | Class | Effort | Tier | Src |
|---|---|---|---|---|---|---|
| TR5 | `marked` token switch, full node set, LRU-cached lexer, 500-char fast path | Line-oriented regex, single-level inline (`[^*]+`), cannot nest | divergent | L | 3 | 02#7/#18 |
| TR6 | h1 → bold+italic+underline; h≥2 → bold; **two** newlines after | All bold, no trailing blank | partial | S | 2 | 02#8 |
| TR7 | Unordered marker is a literal `-` | `• ` | divergent | S | 2 | 02#9 |
| TR8 | Nested items indent `2×depth`; ordered numbering `1.` / `a.` / `i.` by depth, honours `start` | No nesting; arabic only; indented items fall through as prose | missing | M | 3 | 02#10 |
| TR9 | Task lists render literal `[x] ` / `[ ] ` | Not handled | missing | S | 2 | 02#11 |
| TR10 | Blockquote: `quote` border = dim `▎` rail + 1 space padding, content **italic** | `│ ` prefix, dim, not italic | divergent | S | 2 | 02#12 |
| TR11 | `hr` → the literal string `---` | Falls through as prose | partial | S | 2 | 02#13 |
| TR12 | Links: OSC-8 wrapping blue/blueBright text; `text (url)` fallback; `file:` normalised; `mailto:` collapsed; `⧉` affordance | Emitted verbatim | missing | M | 3 | 02#14 |
| TR13 | Images: `alt (href "title")`, or the bare href | Not handled | missing | S | 2 | 02#15 |
| TR14 | `del` → strikethrough on capable terminals, `~~x~~` otherwise | Not handled | missing | S | 2 | 02#16 |
| TR15 | Inline code coloured `permission` (`rgb(87,105,247)`) | `cyan` | divergent | S | 2 | 02#17 |
| TR16 | Tables: `┌┬┐/├┼┤/└┴┘` box, centred header, per-column alignment, three-way width fitting, rule between **every** pair of data rows, 200-row cap + `… N more rows not shown`, vertical record fallback | Padded text, `│` separators, one `─` under the header | partial | L | 3 | 02#19 |
| TR17 | Top-level blocks separated by `gap: 1` | No block separation | missing | S | 2 | 02#20 |
| TR18 | Streaming re-prepends an open fence to the tail so partial code still highlights | No fence awareness | missing | M | 3 | 02#21 |
| TR19 | Code blocks: no border, **no indent**, no line numbers, no length cap | 2-space indent on every line | divergent | S | 2 | 02#22 |
| TR20 | Language label shown **only when the language is unrecognised**, dim, above the block | Never shown — and unknown-language blocks are dimmed. Our polarity is the **opposite** of upstream's | divergent | S | 2 | 02#23/#24 |
| TR21 | Fence lang regex `[\w.+#-]+` with a leading-prefix fallback; tilde fences handled | `` /^```(\w+)?/ `` only — rejects `c++`, `objective-c`, `ts title=x` | partial | S | 2 | 02#25 |
| TR22 | highlight.js full grammar set, 30-scope chalk map (keyword→blue, number→green, string→red, comment→green) | 4 token classes over 10 aliases; keyword→cyan, number→yellow, string→green | partial | L | 4 | 02#26 |

### Diffs

| ID | Upstream | Ours | Class | Effort | Tier | Src |
|---|---|---|---|---|---|---|
| TR23 | Header `Added **3** lines, removed **1** line`; positional capitalisation (`Removed` standalone); `>1` pluralisation | `Name path` with a `● ` gutter, no counts | missing | S | 2 | 01, 02#27 |
| TR24 | Hunks interspersed with a dim `...`; **no `@@` headers anywhere** | Single hunk | partial | M | 3 | 02#28, 05 D4 |
| TR25 | Absolute file line numbers seeded from `structuredPatch[].oldStart`, with remove-run rewind so paired blocks share numbers | 1-based within the snippet (disclosed at `tui-ux.md:264`) | divergent | M | 3 | 02#29, probe 77 |
| TR26 | Add/remove are **full-width background bands** (`diffAdded`/`diffRemoved`), right-padded to the box edge; context lines get no background and `dimColor` | Foreground colour only | divergent | S | 2 | 02#30 |
| TR27 | Word-level intra-line diff (`diffAddedWord`/`diffRemovedWord`), bailing to whole-line banding above 40 % change or when dimmed | Absent | missing | M | 3 | 02#31 |
| TR28 | Lines wrap at `width − gutter − 3`; continuation lines get a blank number gutter and repeat the band | No width budget | missing | M | 3 | 02#32 |
| TR29 | **No** line-count truncation; only collapse + `(ctrl+o to expand)` and the `previewHint` substitution | Hard `cap = 24` + `… N more lines` | divergent | S | 2 | 02#33, 05 D4 |

**Probe-77 consequence for TR25.** `structuredPatch` is not on the wire. Absolute numbers are
reachable only by reading the file ourselves — legitimate, since our REPL is a local client sharing
the cwd, but it is a design decision (a disk read per Edit render) that should be made explicitly
rather than assumed. TR23's counts *are* derivable from `old_string`/`new_string`.

### Thinking

| ID | Upstream | Ours | Class | Effort | Tier | Src |
|---|---|---|---|---|---|---|
| TR30 | Thinking content renders **nothing** unless transcript mode or `--verbose` | Always shown | divergent | S | 2 | 02#34 |
| TR31 | Streaming placeholder `✻ Thinking…` dim + italic (`✻` = U+273B); same for `redacted_thinking` | `✦ Thinking` (U+2726 — a glyph upstream never uses for thinking) | divergent | S | 2 | 02#35 |
| TR32 | Expanded: `∴` gutter in a `minWidth:2` box, dim italic, content **through the markdown renderer** | Raw dim lines, no gutter, no markdown | partial | S | 2 | 02#36 |
| TR33 | `Thinking for X` / `Thought for X` — a **duration**, live-ticking, floored at 1000 ms, as clause 1 of the group summary | Absent | missing | M | 3 | 02#37, 01 clause 1 |

### Everything else in the transcript

| ID | Upstream | Ours | Class | Effort | Tier | Src |
|---|---|---|---|---|---|---|
| TR34 | Image attachments → `[Image #3]`, OSC-8-linked to the stored file, dim description; MCP image results → `[Image]` | Not handled | missing | M | 4 | 02#39 |
| TR35 | Ten sentinel-tagged user texts route to dedicated renderers (`<bash-stdout>`, `<command-message>`, `<user-memory-input>`, `<task-notification>`, `<mcp-resource-update>` → `↻ server: target · reason`, …); `<local-command-caveat>` returns **null** | All user text → `› …`; only replay classifies three kinds | partial | M | 3 | 02#40 |
| TR36 | `⏺ **Compact summary** (ctrl+o to expand)`, or `⏺ **Summarized conversation**` + `⎿ Summarized N messages up to this point` + `Context: "…"` | `─── context compacted ───` | divergent | S | 2 | 02#41 |
| TR37 | ~12 `system` subtypes with distinct glyph/colour/wording; generic form `⏺ <content>` wrapped at `cols−10`, **plain text not markdown**; `thinking` and `model_refusal_no_fallback` render `null` | Most unhandled; `render.ts:111` returns `[]` for non-assistant/user | partial | M | 3 | 02#42 |
| TR38 | Assistant-text error sentinels each get bespoke copy inside `⎿`: context limit, credit balance, `API_TIMEOUT_MS`, high demand, `API Error: Request was aborted.` → the Interrupted line | None | missing | M | 3 | 02#43 |
| TR39 | Teammate attribution: `@ <name>❯` in the agent's assigned colour (8 `*_FOR_SUBAGENTS_ONLY` tokens), collapsed `› N messages from @<name> (ctrl+o to expand)`, lifecycle `⏺ Teammate @<name> finished/failed/was interrupted` | Indent + dim only, keyed on `parent_tool_use_id` | partial | M | 3 | 02#44, 05 P21, 06 T8 |

**Not determined, carried forward as-is (TR-none).** 02 searched six ways for a session-resume
divider and found no renderer. Our `replay.ts` emits `─── resumed: <label> · N turns · HH:MM ───`.
Either upstream has none (we over-ship) or 02 missed it. Listed in §9 as *unverified*, not as a gap.

**n/a rows folded out of §C:** timestamps (brief-layout only upstream, 02#46), TodoWrite transcript
rendering (→ LT13), tool-result truncation (→ LT6).

---

# 5. §D — Composer (58)

### Visual form

| ID | Upstream | Ours | Class | Effort | Tier | Src |
|---|---|---|---|---|---|---|
| CM1 | `borderStyle:"round"` with **left/right off, bottom on** — two horizontal rules; `promptBorder`, `bashBorder` in `!` mode; no border at all under a screen reader | Full rounded box, all four sides | divergent | S | 2 | 03 V1 |
| CM2 | `❯` + NBSP, **dimmed while a turn runs**; `!` + NBSP in bash mode; `$` + NBSP for screen readers | `"› "`, never dimmed, no variants | divergent | S | 2 | 03 V2 |
| CM3 | Placeholder is a random `Try "<example>"` seeded from git-modified files (refreshed weekly), behind a 4-rule precedence chain that includes `Press up to edit queued messages` | Fixed `"Ask Claude anything…"` | divergent | M | 3 | 03 V3 |
| CM4 | `borderText` history label `── History 3/57 ──` on the top rule, hidden once the recalled entry is edited | none | missing | S | 2 | 03 V4/H5 |
| CM5 | The placeholder's **first character is drawn inverted** — that is the cursor | Separate `<Text inverse>{" "}</Text>` then dim text | partial | S | 2 | 03 V5 |
| CM6 | Cursor stops being drawn inverted when the terminal loses focus | Always drawn | missing | S | 4 | 03 V6 |
| CM7 | Fullscreen: `maxVisibleLines = max(3, rows/2 − 5)` with cursor-centred viewport scroll | Renders every line, unbounded | missing | M | 4 | 03 V7 |
| CM8 | External editor in flight replaces the bordered row with italic `Save and close editor to continue...` | `spawnSync` blocks Ink; nothing drawn | missing | S | 2 | 03 V8 |
| CM9 | Composer stays mounted with a dim `Waiting for permission…` above it | Composer is **unmounted** while `state.pending` | divergent | M | 3 | 03 V9, 05 P28 |

**Disagreement resolved (CM9).** 03 marked its conclusion an inference from the composer's own
`"Waiting for permission…"` string. 05 independently settled it from the layout registry: only
ExitPlanMode is `layout:"modal"`; every other permission dialog is `"inline"`. 05's evidence is
stronger and they agree.

### Editing model

| ID | Upstream | Ours | Class | Effort | Tier | Src |
|---|---|---|---|---|---|---|
| CM10 | Real kill ring: append/prepend direction, `ctrl+y` yank, `alt+y` yank-pop, run interrupted by any non-kill keystroke | `killToEnd`/`killToStart`/`killWordBack` **discard** the text | missing | M | **0** | 03 E1, 06 K9 |
| CM11 | `ctrl+u` killing ≥3 chars notifies `Ctrl+Y to paste deleted text` (5 s) | none | missing | S | **0** | 03 E2 |
| CM12 | Readline set: `ctrl+b` left · `ctrl+f` right · `ctrl+h` delete-token-or-backspace · `ctrl+n`/`ctrl+p` history next/prev · `alt+d` delete-word-after | None bound in the composer | missing | S | 2 | 03 E3/E4/E5, 06 K10/K11/K12 |
| CM13 | `home`/`end`/`pageup`/`pagedown` → line start/end; `super+←/→` line start/end; `super+backspace` kill-to-start; `meta/super+delete` kill-to-end | Not bound | missing | S | 4 | 03 E6/E7 |
| CM14 | `ctrl+a`/`ctrl+e` operate on the **logical** line | Operate on the visual/array line — identical today, diverges once wrapping lands | divergent | S | 3 | 03 E8 |
| CM15 | Esc double-press: 1st notifies `Esc again to clear` (1000 ms), 2nd **pushes the text to prompt history** then clears; suppressed entirely while a suggestion popup is open | Esc with no popup arms rewind; **no clear-input at all**; notice reads `Press Esc again to rewind` | divergent | M | **0** | 03 E9/E10, 06 K13 |
| CM16 | *(merged into CM15)* | | | | | |
| CM17 | Undo ring stores `{text, cursorOffset, pastedContents}`, cap 50, 1000 ms debounce, immediate in vim non-INSERT | Stores `{lines, cursor}`, cap 100, no debounce | partial | S | 3 | 03 E11 |
| CM18 | `\`-continuation eats the backslash **and** sets `hasUsedBackslashReturn` so the hint stops showing | Eats the backslash, no flag | partial | S | 2 | 03 E12 |
| CM19 | Shift+Enter / Alt+Enter insert a newline; `shift+enter` proper is installed into the **host terminal's** keymap by `/terminal-setup` | Only `ctrl+j` and `\`+Enter | missing | S | 4 | 03 E13, 06 K40 |
| CM20 | Terminal-specific newline hints: `shift + ⏎ for newline` / `\⏎ for newline` / `backslash (\) + return (⏎) for newline` | Fixed `\⏎ newline` | divergent | S | 2 | 03 E14 |

*(CM16 folded into CM15 during merge; numbering preserved so cross-references from the tier lists
resolve — CM15 and CM16 are the same entry.)*

### Paste

| ID | Upstream | Ours | Class | Effort | Tier | Src |
|---|---|---|---|---|---|---|
| CM21 | Paste > 800 chars **or** > 2 newlines → `[Pasted text #N +M lines]` chip, content stored out of band, substituted back at submit | Inserted verbatim and split into lines | missing | M | 3 | 03 P1 |
| CM22 | Chip is atomic: `deleteTokenBefore` regex removes the whole chip on one backspace; the cursor cannot rest inside one (snap-out on word motions + a `useEffect`); smart spacing after a chip unless the next char is `.,?!:;)]` | n/a | missing | S | 3 | 03 P2/P3/T6 |
| CM24 | Paste the same text again within 8 s (≤100 k chars) → the chip expands to real text inline; hint `paste again to expand` | n/a | missing | M | 4 | 03 P4 |
| CM25 | `Pasting…` shown while a paste assembles | none | missing | S | 2 | 03 P5 |
| CM26 | Paste cache persisted under `paste-cache/` keyed by content hash, survives sessions, resolves on history recall | n/a | missing | M | 4 | 03 P6 |
| CM27 | ANSI stripped, CRLF normalised, tabs → 4 spaces | Only bracketed-paste markers stripped | partial | S | 2 | 03 P7 |

### Autocomplete

| ID | Upstream | Ours | Class | Effort | Tier | Src |
|---|---|---|---|---|---|---|
| CM28 | **`Tab` accepts without executing; `Enter` accepts *and* executes** | `Tab` completes the name; `Enter` submits `/name` for commands but only accepts for mentions | divergent | S | 2 | 03 A1 |
| CM29 | Selection **wraps** at both ends | Clamped | divergent | S | 2 | 03 A3 |
| CM30 | Popup height `clamp(max(6, rows/2), 1, rows−3)`, blank-padded to fixed height, bottom-aligned; two-line rows when the description does not fit; name column capped at 40 % of width; selected row `color:"suggestion"`, others `dimColor` | Fixed 8 rows, no padding, one line, description sliced at 48 chars, selected row `inverse` | divergent | S | 2 | 03 A4/A5/A6 |
| CM33 | Rows respond to mouse hover and click; hovered id overrides keyboard selection | none | missing | M | 4 | 03 A7/X3, 06 K22 |
| CM34 | Slash trigger requires **preceding whitespace or CJK punctuation** and the cursor at token end; separate head case for a leading `/`; a denylist of names that never suggest | Only fires when `/` is the very first char of an empty buffer | partial | S | 2 | 03 A8 |
| CM35 | `@` accepts `. / \ ( ) [ ] ~ :` and **quoted paths** `@"my file.ts"` | Closes on any whitespace, no quoting | partial | S | 2 | 03 A9 |
| CM36 | Inline dim **ghost text** for a partial command; `Tab` accepts it even with no list | none | missing | M | 3 | 03 A10 |
| CM37 | `argumentHint` rendered inline after a completed `/command `, `wrap:"truncate-end"` | Popup column only | partial | S | 2 | 03 A11 |
| CM38 | Empty state `No commands match "<input>"` | `/{query} — no matches` | divergent | S | 2 | 03 A12 |
| CM39 | Debounced async completions (file 50 ms, Slack/MCP 150 ms) with stale-response guards | Synchronous full-tree walk at popup open, cap 1000 files | divergent | M | 3 | 03 A13 |
| CM40 | Directory completion is **iterative** — accepting a dir re-opens the popup one level deeper | Accepts the whole relative path and closes | missing | M | 3 | 03 A14 |
| CM41 | Also live: emoji `:smile:`, Slack `#channel`, `@teammate`, MCP resources/templates, bash path completion, `/resume <title>`, per-command `getArgumentCompletions` | none | missing | L | 4 | 03 A15 |

### Attachments

| ID | Upstream | Ours | Class | Effort | Tier | Src |
|---|---|---|---|---|---|---|
| CM42 | `[Image #N]` chip in the buffer; whole chip renders **inverse** when the cursor is at its start and the normal cursor is suppressed; GC'd from `pastedContents` when deleted | none | missing | M | 4 | 03 T1 |
| CM43 | `ctrl+v` (`alt+v` on Windows/WSL) reads the **system clipboard** as an image, falls back to clipboard text, with an SSH-aware failure notice | none | missing | M | 4 | 03 T2, 06 K35 |
| CM44 | Drag-and-drop: split on space-before-absolute-path and newlines; image tokens become chips with `sourcePath`; non-image tokens re-join as text; macOS screenshot temp paths detected | none | missing | M | 4 | 03 T3 |
| CM45 | Chip is an OSC-8 hyperlink to the stored image file | none | missing | S | 4 | 03 T5 |

**Scorecard consequence.** `tui-ux.md:249` marks image paste `🚫 non-terminal / out of scope`. That
rationale is wrong — reading the system clipboard is terminal-native. Whether *we* can build it is an
SDK question (P87), not an out-of-scope call. See §12.

### Queue

| ID | Upstream | Ours | Class | Effort | Tier | Src |
|---|---|---|---|---|---|---|
| CM47 | Placeholder `Press up to edit queued messages`, shown for the first 3 sessions | Dim `⋯ queued: <text>` rows above the composer | divergent | S | 2 | 03 Q1 |
| CM48 | `Up` on an empty composer with a non-empty queue **drains every editable entry back into the buffer**, `\n`-joined, images restored, cursor after the recalled text | `Up` goes to prompt history; no queue interaction | missing | M | 3 | 03 Q2 |
| CM49 | `Escape` **pops the queue back into the composer** before it interrupts | `Escape` clears the queue outright and interrupts — **the text is destroyed** | divergent | S | **0** | 03 Q3 |
| CM50 | Per-item queue-edit cursor (`queueEditIndex`, `popEditableAt(i)`) behind `CLAUDE_CODE_KB_COHESION_FIXES` | none | missing | M | 4 | 03 Q4 |
| CM51 | Entries carry `{value, mode, priority: now\|next\|later, pastedContents, origin}` with an editable/human-origin predicate | Plain `string[]` | partial | M | 3 | 03 Q5 |

### History

| ID | Upstream | Ours | Class | Effort | Tier | Src |
|---|---|---|---|---|---|---|
| CM52 | Persisted `~/.claude/history.jsonl`, append-only with a file lock, `{display, timestamp, sessionId, project, pastedContents}`, `CLAUDE_CODE_SKIP_PROMPT_HISTORY` opt-out, incremental paging | In-memory, per composer mount; the Ctrl-R overlay reads persisted transcripts instead | divergent | M | 3 | 03 H1 |
| CM53 | Dedup is exact-text, **newest wins, across the whole scan**, per scope | Up/Down dedups only *consecutive* duplicates | partial | S | 2 | 03 H2 |
| CM54 | Per-index edit cache: edits to a recalled prompt survive further arrowing | Edits lost on the next Up/Down | missing | S | 2 | 03 H3 |
| CM55 | History filtered by input mode — entering from bash mode shows bash entries only | Not filtered | missing | S | 2 | 03 H4 |
| CM56 | One-time contextual `ctrl+r` hint after the 2nd Up | none | missing | S | 2 | 03 H6 |
| CM57 | Recalled prompts restore their `pastedContents`, rewriting unresolvable ones to `[Pasted text #N — content no longer available]` | n/a | missing | M | 3 | 03 H7 |
| CM58 | Inline reverse-i-search: prompt `search prompts:` / `no matching prompt:`, single-line input, **rewrites the composer buffer in place** to each match | Full-screen-style bordered overlay only | divergent | M | 3 | 03 H8 |
| CM59 | Picker adds a preview pane (`round`, `borderDimColor`, 6 lines + `+N more`) and a side-by-side layout at ≥100 columns | Ranking, scope cycling and the age column are present; no preview, no responsive layout | partial | M | 3 | 03 H9 |

**Clean match, recorded (03 H10):** all six `HistorySearch` bindings match upstream exactly, including
the surprising `Esc` = accept.

### Vim and cross-cutting

| ID | Upstream | Ours | Class | Effort | Tier | Src |
|---|---|---|---|---|---|---|
| CM60 | Four modes, full motion/operator/text-object/register/dot-repeat surface (~700 beautified lines), `-- INSERT --` dim indicator, `vimInsertModeRemaps`, an `editorMode` settings row | none — deliberate deferral | missing | L | 4 | 03 M1–M4 |
| CM61 | Live highlight spans in the buffer with a priority system: ultrathink/ultraplan/workflow keyword shimmer, file mentions in `suggestion`, MCP resources, `@teammate` in the agent's colour, image chips inverse, history-search match dim | Plain text | missing | M | 4 | 03 X2 |
| CM65 | Upstream's `mP()` recognises **only `!`** — there is no `#` memory mode in the composer | `#` = memory mode, blue border | **over** | — | 5 | 03 X7 |

**Folded out of §D:** X4 mode-indicator strings → CH1 · X5 hint row → CH2 · X6 screen-reader variant
→ CH38 · X1 live-binding hint strings → ST5 · X8 push-to-talk → n/a.

---

# 6. §E — Chrome (39)

### Footer

| ID | Upstream | Ours | Class | Effort | Tier | Src |
|---|---|---|---|---|---|---|
| CH1 | Mode chip `⏸ manual mode on` / `⏵⏵ accept edits on (shift+tab to cycle)`, from a 6-entry table with symbol + indicator + theme colour; rendered in **every** mode including default; SR announcement `[<indicator> on]` | `mode <rawSdkModeString>` in a 4-way colour map | divergent | S | 2 | 04 C1, 03 X4 |
| CH2 | Hint ladder: 11 rungs, **one winner**; `? for shortcuts` only when everything else is empty *and* the mode chip is default; bash mode short-circuits to `! for shell mode` | Two fixed strings | partial | M | 3 | 04 C4, 03 X5 |
| CH3 | Footer carries **no model name** (model lives in the startup header, `/status`, statusLine) | `model <name>` always | **over** | S | 5 | 04 C2 |
| CH4 | Context indicator is a **transient notification** under key `token-warning`, hidden entirely while `level === "ok"`; `23% until auto-compact` / `Context low (17% remaining) · Run /compact to compact & continue` | Permanent `ctx 42%` + `⚠ auto-compact soon` at ≥80 % | divergent | M | 3 | 04 C3 |
| CH5 | Footer chips: `› stashed`, `◎ /goal active (2m 3s)`, tasks, `N memories recalled`, `N feedback drafts`, `⧉ 12 lines selected`, sandbox-blocked, `Debug`, `hipaa`, PR badge, mode labels | `⟳ streaming` and `⚙ N bg` only — **two chips upstream does not have** | divergent + **over** | M | 3 | 04 C37 |
| CH6 | No plan-usage chip exists | `⚠ 5h 92%` at ≥80 % | **over** | S | 5 | 04 C40 |
| CH7 | `think` level is a Config row and a spinner `effortSuffix`, never a footer chip | `think <level>` chip | **over** | S | 5 | 04 C41 |
| CH8 | `{tokens} tokens` appears in the footer **only** under `verbose` | none | missing | S | 2 | 04 C39 |
| CH9 | Width-aware truncation at three independent points + `wrap:"truncate"` everywhere | None — the bar can overflow narrow terminals | missing | M | 3 | 04 C43 |
| CH10 | Real OSC 8 hyperlinks throughout the chrome (PR badges, cloud sessions, issue numbers) | none | missing | M | 4 | 04 C42 |
| CH11 | `statusLine` extension point: config shape, 300 ms-debounced re-run on 9 signals, `refreshInterval` polling, AbortController, workspace-trust gate, multi-line dim truncate output, silent-on-failure; a 20-field stdin JSON with 5 undocumented extras (`cost`, `exceeds_200k_tokens`, `fast_mode`, `remote`, `pr.kind`); plus a `statusline-setup` built-in agent | none | missing | M | 5 | 04 C6/C7/C8 |

### Spinner

| ID | Upstream | Ours | Class | Effort | Tier | Src |
|---|---|---|---|---|---|---|
| CH12 | Frame index is a **2000 ms triangle wave over 6 base glyphs**, not a tick counter; animation clock 100 ms, **50 ms while `requesting`** | 120 ms tick over the 12-frame array | divergent | S | 2 | 04 C9 |
| CH13 | `xterm-ghostty` gets `["·","✢","✳","✶","✻","✻"]` (last glyph differs) | none | missing | S | 2 | 04 C10 |
| CH14 | 186 verbs | 187 — `spinner.ts:26` has `"Evaporating"`, absent upstream | **over** | S | 2 | 04 C11 |
| CH15 | Message is `overrideMessage ?? activeTodo.activeForm ?? activeTodo.subject ?? verb` — the random verb is the **last** resort | Always a random verb | missing | S | 2 | 04 C12 |
| CH16 | `spinnerVerbs {mode: append\|replace, verbs}`, `spinnerTipsEnabled`, `spinnerTipsOverride` settings | none | missing | S | 4 | 04 C13 |
| CH17 | Tail `(a · b · c · d)` with per-slot width budgets: suffix · elapsed (only past 16 s unless verbose/status/tokens) · `↓ 1.2k tokens` (`↑` while requesting) · status | Always `(3s · 142 tokens · esc to interrupt)` | divergent | M | 3 | 04 C14 |
| CH18 | Thinking-word ladder: `thinking` → `still thinking` (10 s) → `thinking more` (20 s) → `thinking some more` (30 s) → `almost done thinking` (45 s) | none | missing | S | 2 | 04 C15 |
| CH19 | `esc to interrupt` lives in the **footer** hint ladder, only while loading | Inside the spinner tail | **over**/divergent | S | 2 | 04 C16 |
| CH20 | Token count is `responseLength/4`, animated toward truth at 50 ms steps | Real `message_delta` output tokens, un-animated | divergent (**ours is better**) | — | 5 | 04 C17 |
| CH21 | Below the spinner: compaction progress bar + `%`, `Next: <subject>`, `Tip: <text>` with two hard-coded overrides (30 min → `/clear`; 30 s + never-used-`/btw` → `/btw`), retry banner replacing the row, brief/remote dots variant | none | missing | L | 3 | 04 C18 |
| CH22 | Tip catalog ~40 entries with `cooldownSessions` / `priority` / `maxLifetimeShows` / `isRelevant()` / `providerAgnostic`, selected most-stale-first | none | missing | L | 5 | 04 C19 |
| CH23 | Single-subagent description conjugation on the group summary row: 77-entry irregular past table, 26 irregular gerunds, prefix handling (`re-`/`un-`/`over-`), connective handling after `and `/`then `, a ~200-verb allow-list, and refusal rules | none | missing | M | 3 | 04 C20 |

**Correction carried from 04 to an earlier research pass:** the irregular table has **77** entries,
not 71, and the conjugator drives the **grouped tool-use activity line**, not the spinner.

### Startup

| ID | Upstream | Ours | Class | Effort | Tier | Src |
|---|---|---|---|---|---|---|
| CH24 | Two first screens: an **unboxed** header (mascot + `Claude Code v2.1.220` + `model · billing` + `@agent · cwd`) for returning users, and a boxed welcome with `borderText: " Claude Code v2.1.220 "` and side-by-side feeds only on first run / unseen release notes; `flexDirection` flips at `columns >= 70` | Box is unconditional; `✻ Welcome to Claude Code` + cwd/model/mode + 3 static tips | divergent | M | 3 | 04 C21/C22 |
| CH25 | "Tips for getting started" is a **completion checklist** — `✓ ` prefix on complete items, incomplete sorted first, disabled dropped; plus a home-directory warning line | 3 hard-coded bullets | divergent | S | 2 | 04 C23 |
| CH26 | Banner degrades to one line (`Welcome to Claude Code v2.1.220`) under a screen reader or `rows < 30` | none | missing | S | 2 | 04 C24 |
| CH27 | Startup announcements: remote schema + renderer + `companyAnnouncements` | none | n/a (no remote flag service; the `companyAnnouncements` half is buildable) | S | 5 | 04 C25 |

### Terminal integration

| ID | Upstream | Ours | Class | Effort | Tier | Src |
|---|---|---|---|---|---|---|
| CH28 | Terminal title via OSC 0: idle prefix `✳`, busy alternating `⠂`/`⠐` at 960 ms; title chain `/rename` → generated topic → `--agent` name → `Claude Code`; reset on exit; `CLAUDE_CODE_DISABLE_TERMINAL_TITLE` | none | missing | S | 2 | 04 C26 |
| CH29 | Model-generated session topic title (Haiku-class call, 3–7 words, sentence case) | none | missing | M | 4 | 04 C27 |
| CH30 | Tab status OSC 21337 with idle/busy/waiting indicator + status colours; suppresses the animated title prefix when on | none | missing | S | 3 | 04 C28 |
| CH31 | Desktop notifications: iTerm2 `OSC 9`, Kitty three `OSC 99` writes, Ghostty `OSC 777`, bare bell; `auto` channel resolution including an `osascript`+`defaults export` probe of Apple Terminal's bell setting | none | missing | M | 3 | 04 C29 |
| CH32 | `Claude is waiting for your input` after `messageIdleNotifThresholdMs` with no turn running | none | missing | S | 2 | 04 C30 |
| CH33 | `idle-return-hint`: `new task? /clear to save 45.2k tokens` after the idle threshold with ≥100 k context, effectively permanent | none | missing | S | 3 | 04 C31 |
| CH34 | iTerm2 progress bar `OSC 9;4` behind `terminalProgressBarEnabled` | none | missing | S | 4 | 04 C32 |
| CH35 | Alt-screen renderer behind `tui:"fullscreen"` / `CLAUDE_CODE_NO_FLICKER`, with virtualized scrollback | none — Ink `<Static>` main-screen only | n/a | L | 5 | 04 C33 |
| CH36 | Resize: `stdout.on("resize")` **plus** `process.on("SIGCONT")`; size resync, alt-screen erase-before-paint, screen-reader diff reset | Ink's own resize handling; no `SIGCONT` handler | partial | S | 3 | 04 C34 |
| CH37 | `prefersReducedMotion`: static breathing `●` instead of the pulse, frozen title prefix, no shimmer/flash | none | missing | S | 3 | 04 C35 |
| CH38 | Screen-reader mode is a first-class layout: column footer, no mascot, `$ ` pointer, no border, suppressed spinner slots, `preserveTrailingWhitespace` | none | missing | M | 4 | 04 C36, 03 X6/V2 |
| CH39 | `Not logged in · Run /login`, `Authentication error · Try again`, `apiKeyHelper is taking a while (12s)`, `Now using usage credits`, auto-updater chips, closed-issue polling | none | missing | M | 4 | 04 C38 |

---

# 7. §F — Dialogs, pickers, panels (69)

### Permission dialogs (27)

Upstream has no "a permission dialog": it has a **registry keyed by dialog kind plus a per-tool
matcher**, 13 kinds, and everything except ExitPlanMode renders **inline in the transcript**.

| ID | Upstream | Ours | Class | Effort | Tier | Src |
|---|---|---|---|---|---|---|
| DG1 | 13 dialog kinds behind the matcher `w8y`, plus two hard-coded routes (the file-tool family, and Bash-as-`sed -i` → the file dialog with a simulated diff) | One `PermissionDialog.tsx` for everything except AskUserQuestion/ExitPlanMode | missing | L | 3 | 05 P1 |
| DG2 | Title `Bash command` / `Bash command (unsandboxed)`; body = rendered command + dim description; question `Do you want to proceed?`; footer `esc cancel · <amend> · ctrl+e explain` | `Allow Claude to use Bash?` + `$ <cmd>` clipped to 140 chars | divergent | S | 2 | 05 P2 |
| DG3 | 16-pattern destructive-command warning table (`git reset --hard` → `Note: may discard uncommitted changes`, `rm -rf`, `DROP TABLE`, `kubectl delete`, `terraform destroy`, …) in `warning` colour | none | missing | S | 2 | 05 P3 |
| DG4 | Ctrl+E explain pane: an LLM call returning `{explanation, reasoning, risk, riskLevel}` → `Low/Med/High risk` coloured; `Explanation unavailable` on failure; shimmering `responding` while loading | none | missing | M | 4 | 05 P4 |
| DG5 | Editable prefix row `Yes, and don’t ask again for: npm run *` (note the curly apostrophe) → `addRules[{Bash, ruleContent}]` → **`localSettings`**; seed derived from the parsed command and refined async | `allow_always` = an in-memory `Set<toolName>`, whole-tool granularity, never persisted, never emits `updatedPermissions` | missing | M | 3 | 05 P5/P22 |
| DG6 | Per-tool titles `Edit file` / `Create file` / `Overwrite file` / `Write file` / `Edit notebook`, subtitle = path relative to cwd | Always `Allow Claude to use <tool>?` | missing | S | 2 | 05 P6 |
| DG7 | Body is a real inline diff (`file-edit-diff` / `file-write-diff` / `notebook-edit-diff`), sharing the transcript's leaf renderer; write preview falls back to highlighted content with `(No content)` when empty | Path only | missing | M | 3 | 05 P7 |
| DG8 | `Do you want to <verbPhrase> **<basename>**?` — basename, not full path | none | missing | S | 2 | 05 P8 |
| DG9 | Four session-scope wordings by in-dir/out-of-dir × read/write, e.g. `Yes, allow all edits in **<dir>/** during this session **(shift+tab)**` | none | missing | M | 3 | 05 P9 |
| DG10 | `.claude/`-self-edit row `Yes, and allow Claude to edit its own settings for this session` → `destination:"session"` | none | missing | S | 2 | 05 P10 |
| DG11 | `confirm:cycleMode` (shift+tab) **directly picks the accept-session option** | shift+tab is the global mode ladder; no dialog binding | missing | S | 2 | 05 P11 |
| DG12 | Symlink warning `This will modify <target> (outside working directory) via a symlink` / `Symlink target: <target>` | none | missing | S | 2 | 05 P12 |
| DG13 | WebFetch: title `Fetch`, question `Do you want to allow Claude to fetch this content?`, row `Yes, and don't ask again for **<host>**` → `domain:<host>` rule | Generic dialog | missing | S | 2 | 05 P13 |
| DG14 | Skill: `Use skill "<x>"?` with exact and `<prefix>:*` rules | Generic dialog | missing | S | 2 | 05 P14 |
| DG15 | Monitor: `Poll **server/tool** every Ns` / `Open WebSocket **url**` + subprotocols | Generic dialog | missing | S | 3 | 05 P15 |
| DG16 | Workflow: `Run a dynamic workflow?` in `planMode` colour, phase summary or a dashed-border raw script, a `warning` token-cost caveat, summary/raw toggle, `ctrl+g edit script in $EDITOR` | Generic dialog | missing | M | 3 | 05 P16 |
| DG17 | PowerShell dialog, prefix placeholder `command prefix (e.g., Get-Process *)` | Generic dialog | missing | S | 5 | 05 P17 |
| DG18 | Browser / Claude-in-Chrome dialogs, verbs `Allow` / `Allow all actions on **<host>** for this session` / `Deny **(esc)**` | none | unverified | — | 5 | 05 P18 |
| DG19 | Generic `Tool use`: `<name>(<rendered>)` + a dim `(MCP)` suffix + the description clipped to 3 lines; row 2 writes a **whole-tool** rule with no `ruleContent` | Tool name + first-arg value; no description, no MCP marker | partial | S | 2 | 05 P19 |
| DG20 | Consent-reason line from a **typed** `decisionReason`: 8 variants, each with a config hint line (`/permissions to update rules`, `<settings file> to update hooks`), classifier case in `error` | none | partial | S | 3 | 05 P20 |
| DG21 | Attribution as a **frame-header suffix**: `· from the <name> agent` / `· from the "<x>" workflow`, `·` dimmed | `Subagent (<type>) asks:` on a separate line above, from a host-side correlation map | divergent | S | 2 | 05 P21 |
| DG22 | `suppressAlwaysAllowRule` hides the persistent row when accepting would over-broaden | **Cannot see the field — the SDK drops it** | n/a | — | 5 | 05 P23 |
| DG23 | `isAskCappedByOrg` (MCP `effectiveMaxPermission === "ask"`) hides the persistent row | No SDK surface | n/a | — | 5 | 05 P24 |
| DG24 | Accept/deny rows become text inputs: `and tell Claude what to do next` / `and tell Claude what to do differently`, with `allowEmptySubmitToCancel` | No feedback channel on the permission dialog | missing | S | 2 | 05 P25 |
| DG25 | `Yes, and switch to auto mode` · `· workflows run best with it on`, offered only for workflow-agent requests | none | missing | S | 3 | 05 P26 |
| DG26 | Frame `Ed` = **top rule only**, rounded, `permission` colour (`planMode` for plan, `warning` for pauses); SR prefix `Permission Required:` | Full rounded box, no SR text | divergent | S | 2 | 05 P27 |
| DG27 | Everything except ExitPlanMode renders **inline in the transcript** | All our dialogs replace the composer area | divergent | M | 3 | 05 P28, 03 V9 |

### Plan mode (7)

| ID | Upstream | Ours | Class | Effort | Tier | Src |
|---|---|---|---|---|---|---|
| DG28 | `Enter plan mode?` in `planMode`, a verbatim 4-bullet explainer, buttons `Yes, enter plan mode` / `No, start implementing now` | none — only ExitPlanMode is routed | missing | S | 3 | 05 L1 |
| DG29 | The **only** `layout:"modal"` dialog: scroll region → `Ed` titled `Ready to code?` → `Here is Claude's plan:` → markdown → consent reason; a separate top-bordered box below holds the prompt and options | `Claude has finished planning. Approve this plan?` + a 14-line window | divergent | S | 2 | 05 L2 |
| DG30 | Up to 6 conditional options including the clear-context family `Yes, clear context (N% used) and …` | 3 fixed | partial | M | 3 | 05 L3 |
| DG31 | `No, keep planning` is an **inline input** with description `shift+tab to approve with this feedback`; empty feedback returns `null` so the **dialog stays open** | Esc/`3` opens a feedback line; empty submits the deny | divergent | S | 2 | 05 L4 |
| DG32 | Clear-context options **return `deny`** and instead seed a fresh turn: `Implement the following plan:\n\n<plan>` + a transcript pointer + optional feedback, with `clearContext:true` | none | missing | M | 4 | 05 L5 |
| DG33 | Pre-step `…review it as an artifact first?` | none | n/a (claude.ai-coupled) | — | 5 | 05 L6 |
| DG34 | Footer `ctrl+g edit in <editor>` + a `success` `✓ Plan saved!` after a save | none | missing | S | 2 | 05 L7 |

### Diff surfaces (3)

| ID | Upstream | Ours | Class | Effort | Tier | Src |
|---|---|---|---|---|---|---|
| DG35 | `/diff` opens a navigable dialog: source tab strip (`Current`, `T<n>` reconstructed per turn), 5-row windowed file list with `↑ N more files`, diff pane, list↔detail modes, context-sensitive Escape | `/diff` prints `git status --short; git diff --stat` as text | missing | L | 4 | 05 D1 |
| DG36 | Per-file badges `untracked` / `Binary file` / `Large file modified` / `+A −R`; pane states `Binary file - cannot display diff`, `Large file - diff exceeds 1 MB limit`, `… diff truncated (exceeded 400 line limit)` | none | missing | M | 4 | 05 D2 |
| DG37 | Diff sidebar (`app:toggleDiffSidebar`, `app:cycleDiffBase`, `app:toggleDiffNoiseFilter`) | none | n/a — **vestigial upstream**: no handler is registered anywhere in the bundle for `app:diffFileListUp/Down` | L | 5 | 05 D3, 06 K20/K21 |

### Rewind (7)

| ID | Upstream | Ours | Class | Effort | Tier | Src |
|---|---|---|---|---|---|---|
| DG38 | `/rewind` with aliases `checkpoint`, `undo`; frame titled `Rewind` in `suggestion`; refuses in cloud sessions | Esc-Esc + `/rewind`, no aliases | partial | S | 2 | 05 R1 |
| DG39 | Each row's second line: `<basename> +A −R` / `N files changed +A −R` / `No code changes` / `⚠ No code restore`; row height 3 with checkpoints, 2 without | One line of prompt text; the dry-run runs only **after** selection | missing | M | 3 | 05 R2 |
| DG40 | Synthetic rows: trailing italic `(current)` and a leading `/resume <id> (previous session)` | none | missing | S | 2 | 05 R3 |
| DG41 | Confirm panel adds `Summarize from here` / `Summarize up to here`, each with an inline `add context (optional)` input | 3 restore options only | missing | M | 4 | 05 R4 |
| DG42 | Per-option explanations (`The conversation will be forked.`, `The code will be restored +A −R in <files>.`) plus `⚠ Rewinding does not affect files edited manually or via bash.` | A one-line dry-run summary | partial | S | 2 | 05 R5 |
| DG43 | With checkpointing **off**, selecting a row restores immediately, no confirmation | Always two-stage | divergent (**ours is safer**) | S | 5 | 05 R6 |
| DG44 | Partial-failure copy `Restored the code, but skipped N files: <reason>…` and three `Failed to restore…` variants | none | missing | S | 2 | 05 R7 |

### Pickers (12)

| ID | Upstream | Ours | Class | Effort | Tier | Src |
|---|---|---|---|---|---|---|
| DG45 | Multi-select `V3`: `${i}.` + `[x]`/`[ ]`, digit toggles, a bold submit row at `marginLeft:3` with `Submit`/`Next` | Bespoke in `QuestionDialog.tsx` | partial | S | 3 | 05 S2 |
| DG46 | ModelPicker header `Select model` in `remember`, the "becomes the default for new sessions" subtitle, and a session-only override line | `switch model  (↑/↓ · Enter · Esc)` | divergent | S | 2 | 05 S4 |
| DG47 | Rows carry `· $3/$15 per Mtok` (promo variant with the old price **struck through**), `· ~2× usage vs Sonnet`, `· Draws from usage credits`, `· Org default`, `· Legacy`, `Newer version available · select X`; disabled rows sort to the bottom | `displayName — description` from `supportedModels()` aliases | missing | M | 4 | 05 S5 |
| DG48 | Reasoning effort on `←`/`→`: 5 levels with glyphs `○ ◐ ● ◉ ◈` (+ `ultracode ✦`), a per-model support matrix, an org ceiling clamp, and a `max` caution line | none (we have a thinking-budget lever) | missing | M | 4 | 05 S6, 06 K26 |
| DG49 | `s` applies for this session only; otherwise persist `model` to `userSettings` and `effortLevel` (only low/medium/high/xhigh) | Pick applies to the live session; nothing persisted | partial | S | 3 | 05 S7 |
| DG50 | `… +N models` overflow counter with a 10-row window | Full list, no window | missing | S | 2 | 05 S8 |
| DG51 | Resume picker: `Resume session (N of M)` header, tree-select with expandable groups, search bar, `Space` preview, `Ctrl+R` rename, `Ctrl+A/B/W` scope toggles, three empty states | Flat list of `id  summary` | partial | M | 3 | 05 S9 |
| DG52 | Plugin browser (`Plugin` context: space/i/f), tabs `Discover`/`Installed`/`Marketplaces`/`Stats`, section headers, install glyph states | none | unverified | L | 5 | 05 S10 |
| DG53 | `Manage MCP servers` modal, subtitle `N servers`, per-server detail and tool drill-in | `/mcp` prints text | missing | M | 3 | 05 S11 |
| DG54 | Artifact picker (`ctrl+]`) and IDE picker | none | n/a | — | 5 | 05 S12 |
| DG55 | Autocomplete row layout `[source] [displayText, highlighted] [tag] [kind lane, 7 cols] [description]`, `skill` and `agent` kinds coloured | `/`, `@` and command completion without the kind lane or tags | partial | S | 3 | 05 S13 |

### Panels (9)

| ID | Upstream | Ours | Class | Effort | Tier | Src |
|---|---|---|---|---|---|---|
| DG56 | Todo header `**N** tasks (**M** done, **K** in progress, **J** open)` — the in-progress clause only when non-zero; overflow ` … +2 in progress, 3 pending` | `Tasks` | missing | S | 2 | 05 N1 |
| DG57 | Glyphs `✔` `success` **strikethrough + dim** / `◼` `claude` **bold** / `◻`; **no empty state** (returns `null`) | `☑` / `▶` / `☐`, no text styling | divergent | S | 2 | 05 N2 |
| DG58 | Owner tag `(@name)` at ≥60 cols, blocker line `› blocked by #12, #13`, activity sub-line for in-progress rows; in-progress rows use `activeForm`, not `content` | none | missing | S | 3 | 05 N3, 02 §6.1 |
| DG59 | Panel state persisted to the `showExpandedTodos` setting and restored at startup | `todosOpen` local state | partial | S | 2 | 05 N4 |
| DG60 | `Background` dialog: counts subtitle, 7 section headers, per-type rows, `f` foreground, `x` stop, `ctrl+x ctrl+k` stop-all, and per-type **detail sub-dialogs** (`Shell details` with last-10-lines output box; `<agentType> › <description>` with Progress/Prompt/Error sections) | One flat panel | partial | M | 3 | 05 N7 |
| DG61 | Command is `/tasks` with alias `/bashes` | `/bg` — a recorded deliberate rename (collides with `TaskPanel`) | divergent (**keep**) | S | 5 | 05 N8 |
| DG62 | `/help` is a **tabbed dialog** (`General` / `Commands` / `Custom commands`) with a searchable command browser, a docs link, and `Something else? Use /feedback…` at ≥44 rows | `/help` prints a command list | partial | M | 3 | 05 N9 |
| DG63 | Shortcuts grid: 3 columns, chords resolved from the **live binding table**, rendered lower-case with `" + "`; entries like `double tap esc to clear input`, `/btw for side question`, `/keybindings to customize` | Hard-coded 25-row 2-column list | divergent | S | 2 | 05 N10 |
| DG64 | Memory panel, `Memories recalled this session`, and `/context` as a rich system message with segments and a `Suggestions` section (`Read results using N tokens (P%)` → `save ~N`) | `/context` prints a summary | partial | M | 4 | 05 N12 |

### Other modals (5)

| ID | Upstream | Ours | Class | Effort | Tier | Src |
|---|---|---|---|---|---|---|
| DG65 | `Session paused` — API-refusal fallback with `retry_fallback` / `edit_prompt` | none | unverified | — | 4 | 05 O1 |
| DG66 | `Trust this directory?` and `WARNING: Claude Code running in Bypass Permissions mode` | `/yolo` flips the mode with no warning banner | missing | S | 2 | 05 O2 |
| DG67 | `Export conversation` / `Select export method` picker, then `Enter filename:` | `/export [file\|clipboard]` as an argument | divergent | S | 3 | 05 O3 |
| DG68 | `Working directory has changes`, `Exiting worktree session`, `You've spent $5 on the Anthropic API this session.` | none | missing | S | 3 | 05 O4 |
| DG69 | MCP elicitation dialog with a `Retry now` waiting state | none | n/a | — | 5 | 05 O5 |

---

# 8. §G — Keybindings (23) and §H — Themes (12)

### Keybindings not absorbed into ST5/ST6

| ID | Upstream | Ours | Class | Effort | Tier | Src |
|---|---|---|---|---|---|---|
| KB1 | `y` = `confirm:yes`, `n` = `confirm:no` | Unbound — we use `a`/`A`/`d`/`D` and digits | divergent | S | **0**–2 | 06 K15 |
| KB2 | `tab` next field · `shift+tab` cycle mode · `ctrl+e` toggle explanation | none | missing | S | 3 | 06 K16 |
| KB3 | `ctrl+d` on an empty composer needs **two** presses | Exits on one | divergent | S | **0** | 06 K38 |
| KB4 | Four `chat:undo` aliases, all working | `ctrl+_`/`ctrl+-` branch is **unreachable** (Ink reports `key.ctrl === false` for `0x1f`) and **inserts a literal `\x1f`**; advertised at `ShortcutsOverlay.tsx:18` | divergent (live bug) | S | **0** | 06 K39 |
| KB5 | `ctrl+z` is **not bound** and carries a reserved-key warning (SIGTSTP) | Detach + exit, hoisted above every gate | **over** | S | **0**/5 | 06 K37 |
| KB6 | `Help` context binds **only** `escape` | **Any key** dismisses, and the key also fires `ChatApp`'s global chord | divergent | S | **0** | 06 K36 |
| KB7 | `←←` on an empty composer opens the agents view, refusing with `Cannot open agents — you have unsent text in the input` | Not bound | missing | M | 4 | 06 K14 |
| KB8 | `meta+p` model picker · `meta+t` thinking · `meta+o` fast mode · `meta+w` workflow keyword | Slash commands only | missing | S each | 3 | 06 K17 |
| KB9 | `cmd+k` clear screen | `/clear` only | n/a — `cmd+*` never reaches a terminal app | — | 5 | 06 K18 |
| KB10 | `ctrl+shift+b` brief · `ctrl+]` artifact | none | n/a — no such surfaces | — | 5 | 06 K19 |
| KB11 | `ctrl+up/down`, `meta+up/down` diff file list | none | n/a — **vestigial upstream** (no handler registered) | — | 5 | 06 K20 |
| KB12 | The `Scroll` context (14): wheel up/down, `ctrl+home`/`ctrl+end`, `shift+arrows` selection, `ctrl+shift+c`/`cmd+c` copy | none | missing | L | 4 | 06 K22 |
| KB13 | The `Footer` context (11): focusable footer indicators | none | n/a | M | 5 | 06 K23 |
| KB14 | `MessageSelector`: `j`/`k`, `ctrl+n`/`ctrl+p`, and eight top/bottom jump aliases | `up`/`down`/`enter` only | partial | S | 2 | 06 K27 |
| KB15 | `Select`: `j`/`k`, `ctrl+n`/`ctrl+p`, `pageup`/`pagedown`, `home`/`end` | `ThemeDialog`/`OutputStylePicker` have `j`/`k`/`ctrl+n`/`ctrl+p`; `SessionPicker`/`ModelPicker`/`BgTasksPanel` do not; no paging anywhere | partial | S | 2 | 06 K28 |
| KB16 | `Settings`: `r` retry, `d`/`w` period, `t` sort-by-tokens, `ctrl+u`/`ctrl+d` half-page | none | missing | M | 4 | 06 K29 |
| KB17 | `Transcript`: `ctrl+e` toggle-show-all, `home`/`end` | Not bound (documented at `pager.ts:3–5`) | missing | S | 2 (→ ST2) | 06 K30 |
| KB18 | `Task`: `ctrl+x ctrl+b` as an alias for `ctrl+b` | Only `ctrl+b` | partial | S | 2 | 06 K31 |
| KB19 | `ThemePicker`: `ctrl+t` syntax-highlight toggle, `ctrl+e` edit custom theme | none | missing | M | 4 | 06 K32, T17 |
| KB20 | Pager extras `{` `}` `/` `n` `N` `[` `v` (prev/next prompt, search, match nav, print to scrollback, open in editor) | none | missing | M | 3 | 06 K33 |
| KB21 | `shift+enter` newline via `/terminal-setup` writing the host terminal's own keymap (sends `ESC CR`) | none | missing | M | 4 | 06 K40 |
| KB22 | Generic chords, space-separated, **1 s** inter-key timeout; `escape` cancels a pending chord | Two bespoke `useRef` timestamp chords with a **2 s** window, hardcoded to `ctrl+x` | partial | M | 3 | 06 K4 |
| KB23 | — | Three dead branches of ours: `pager.ts:32`'s `key.shift` (Shift+G arrives as `input === "G"`), `editor.ts:239`'s `ctrl+j` (arrives as `input:'\n'`), and KB4's | divergent | S | 2 | 06 §1.8 |

### Themes

| ID | Upstream | Ours | Class | Effort | Tier | Src |
|---|---|---|---|---|---|---|
| TH1 | 7 picker rows (`auto` + 6 palettes) including `Dark/Light mode (ANSI colors only)`; header `Choose the text style that looks best with your terminal` | First 5 rows match verbatim; both ANSI rows absent | partial | S (rows) / M (values) | 3 | 06 T2/T3/T18 |
| TH2 | Value grammar `rgb()` \| `#hex` \| `ansi256()` \| `ansi:<name>` with a validator and a 16-name ANSI allow-list | Free-form unvalidated strings; `#d97757` mixed with bare `"green"`/`"red"` in one record | divergent | S | 2 | 06 T4 |
| TH3 | `auto` resolves live: OSC 11 probe (tmux DCS-wrapped, 2 s race) → `COLORFGBG` last field → `dark`; luminance threshold 0.5; re-probes on resize and focus regain; self-disables after one silent probe | `auto` is a static alias for `dark` | missing | M (Tier 2 alone: S) | 3 | 06 T5 |
| TH4 | `lpo(e) => e.startsWith("light")` drives contrast decisions | none | missing | S | 2 | 06 T6 |
| TH5 | Every animated token has a `<base>Shimmer` twin, consumed as `shimmerColor` by a per-character glimmer renderer | No animation, no shimmer tokens | missing | M | 4 | 06 T7 |
| TH6 | 8 `*_FOR_SUBAGENTS_ONLY` identity colours dispatched through a name map — the only place a raw colour word is allowed | Subagents not colour-coded | missing | S | 3 | 06 T8 |
| TH7 | 6-token diff family (added/removed × normal/dimmed/word), selected dynamically | 2 tokens | partial | S | 2 (→ TR26) | 06 T9 |
| TH8 | `rate_limit_fill` / `rate_limit_empty` usage meter | We print text percentages | missing | S | 3 | 06 T14 |
| TH9 | Custom themes `~/.claude/themes/*.json` = `{name, base, overrides}`; overrides filtered twice (key must exist in the base **and** value must validate) so a custom theme can never add a token; 256 KB cap; chokidar hot-watch; `custom:<slug>` | none | missing | M | 4 | 06 T15 |
| TH10 | Plugin-contributed themes through the same merge | none | missing | M | 5 | 06 T16 |
| TH12 | A theme change repaints everything | Recolours **new output only** — Ink `<Static>` keeps the colours its lines were written with | n/a | L | 5 | 06 T19 |
| TH13 | 14 `rainbow_*` decoration tokens | none | n/a | — | 5 | 06 T13 |

---

# 9. Waves

Eight waves, 3–5 days of subagent-driven execution each. Dependencies are hard unless marked *soft*.

### W4.0 — Stop the bleeding · ~2 days
**Delivers.** Every Tier-0 entry: CM49 (Escape rescues the queue instead of destroying it), CM15
(Esc-Esc clears the input with text present and pushes it to history; rewind only on an empty
composer), CM10+CM11 (kill ring with `ctrl+y`/`alt+y` and the `Ctrl+Y to paste deleted text` hint),
KB4 (make `ctrl+_` reachable by matching `input === "\x1f"`, or unbind it and delete the help line),
KB6 (help overlay: `escape` only, and gate `ChatApp`'s handler on `shortcutsOpen`), KB3 (`ctrl+d`
double-press), KB5 (move detach off `ctrl+z`), KB1 (bind `y`/`n`, keep `a`/`d` as aliases), KB23
(delete the three dead branches). Plus a **help-overlay audit**: no chord may be advertised that is
not live.
**Depends on.** Nothing.
**Leaves out.** Anything needing a new abstraction. The kill ring here is a plain ring, not the
`pastedContents`-aware undo integration (CM17).

### W4.1 — One renderer, one gutter, one vocabulary · ~4 days
**Delivers.** ST1 (unified tool-row renderer, live and replay through one function), ST9 (the `Cr`
gutter and `bM` overflow primitives, applied everywhere), ST3 (the derived tool-result summary layer
per probe 77, with a tool census driving the vocabulary), ST4 (widen `ThemeTokens` to the ~30 of
upstream's 72 that we actually paint, and route every hardcoded ANSI name in `render.ts`,
`highlight.ts`, `markdown.ts`, `ChatStatusBar.tsx`, `ChatComposer.tsx` through it), TH2, TH4, TH7.
Plus the free riders once one renderer exists: LT7, LT8, LT10, LT11, LT12, LT13, LT14, LT15, LT5.
**Depends on.** W4.0 (soft — avoids merge conflicts in `editor.ts`/`ChatApp.tsx`).
**Leaves out.** Collapsing (needs ST2), ANSI/custom themes, shimmer.

### W4.2 — The live turn: collapse and expand · ~4 days
**Delivers.** ST2 (the verbose/collapsed flag threaded through every renderer, with `ctrl+e`
`transcript:toggleShowAll` as its key — KB17), LT1 (typed result rows on the derivation layer), LT2
(collapsed groups with a clause grammar built from *our* tool census), LT3, LT4, LT6, LT16, LT17,
LT18, LT20, CH23 (the conjugation table — cheap once the group clause exists).
**Depends on.** W4.1 (hard: ST1 + ST3 + ST9).
**Leaves out.** LT19 (Bash live stdout), LT21 (hook rows), LT22 (auto-mode annotations) — all
probe-gated on P84/P85 and all low-value if the probes come back negative.

### W4.3 — Composer parity · ~5 days
**Delivers.** CM21–CM27 (paste chips end to end), CM52–CM57 (persisted `history.jsonl` with
newest-wins dedup, per-index edit cache, mode filter, the `ctrl+r` hint), CM47/CM48/CM50/CM51 (queue
rescue semantics on top of W4.0's fix), CM1–CM5, CM8, CM20, CM12, CM14, CM17, CM18 (form and editing
model), CM28–CM30, CM34–CM40 (autocomplete), CM58, CM59 (both search UIs).
**Depends on.** W4.0 (hard — the Escape/kill semantics must be correct first).
**Leaves out.** Vim (CM60), images (CM42–CM45, probe-gated on P87), mouse (CM33), CM61 highlight
spans, CM41 the other completion sources.

### W4.4 — The keymap as data · ~4 days
**Delivers.** ST5 (the declarative table: 19 contexts, our bindings, one source of truth; `car()`-style
normalisation with `alt≡meta`; a reserved-key registry), ST6 (the ordered-context resolver over a
scope stack, with `swallowAll`/`preemptive` layers), KB22 (generic chords, 1 s), `~/.claude/keybindings.json`
with additive merge, `null` to unbind, chokidar hot reload and typed validation, `command:<name>`
bindings, and **every hint string generated from the live binding** (03 X1 → this is what makes DG63
and CH2 cheap). Plus KB14, KB15, KB18, KB8.
**Depends on.** W4.0 (soft). Scoped by probe P86 — bindings Ink cannot deliver get recorded as
unreachable rather than written and left dead.
**Leaves out.** KB12 (Scroll/mouse/selection), KB13, KB16, KB19, KB21.

### W4.5 — Dialogs, pickers, panels · ~5 days
**Delivers.** ST7 (`Select` + `Tabs` primitives, with `type:"input"` rows and
`allowEmptySubmitToCancel`), then the permission family on top of it: DG1, DG2, DG3, DG6, DG7, DG8,
DG12, DG13, DG14, DG19, DG21, DG24, DG26; DG5/DG9/DG10/DG25 gated on probe P79. Plan mode: DG28,
DG29, DG30, DG31, DG34. Rewind: DG38, DG39, DG40, DG42, DG44. Pickers: DG45, DG46, DG49, DG50,
DG51, DG55. Panels: DG56–DG59, DG60, DG62, DG63.
**Depends on.** W4.1 (tokens), W4.4 (soft — contexts), **probes P78 and P79 (hard)**.
**Leaves out.** DG35–DG37 (DiffDialog and sidebar), DG47/DG48 (probe P88), DG41 (probe P91), DG53,
DG64, DG4, DG16.

### W4.6 — Static transcript and markdown · ~5 days
**Delivers.** TR5 (a token-based markdown renderer) and everything it unlocks: TR6–TR21. Diffs:
TR23, TR24, TR25 (read the file for absolute numbers), TR26–TR29. Identity: TR1, TR2, TR3, TR4.
Thinking: TR30–TR33 (TR33 gated on P82). Messages: TR35, TR36, TR37, TR38, TR39 (with TH6's subagent
colours).
**Depends on.** W4.1 (tokens, gutter), W4.2 (ST2 — thinking and diffs both need the verbose flip).
**Leaves out.** TR22 (full highlight.js — a dependency decision, not a gap), TR34 (images, P87),
TR18 (streaming fence re-open — include if cheap once the tokenizer lands).

### W4.7 — Chrome and terminal integration · ~4 days
**Delivers.** ST8 (the notification queue with priorities, fold, invalidate, pin, preemption) and
then everything that becomes a queue producer: CH4 (context indicator as a transient, threshold-driven
notification), CH32, CH33. Footer rebuild: CH1, CH2, CH5, CH8, CH9, and the over-shipping removals
CH3/CH6/CH7/CH19. Spinner: CH12, CH13, CH14, CH15, CH17, CH18, CH21. Startup: CH24, CH25, CH26.
Terminal: CH28, CH30, CH31, CH34, CH36, CH37.
**Depends on.** W4.1 (tokens). Probe P89 for CH4's thresholds, P90 for CH15, P93 for CH28/CH30.
**Leaves out.** CH11 (statusLine — Tier 5), CH22 (tip scheduler), CH29, CH38, CH39, CH35.

### W4.8 — Long tail (deferred, not scheduled)
TH1/TH3/TH9 (ANSI variants, live `auto` detection, custom themes), CM60 (vim), DG35/DG36
(DiffDialog), KB12/CM33 (mouse and selection), CH38 (screen-reader mode), CM41, CM61, DG64.

---

# 10. Probes

Probe **77 is committed and already answers five of the reports' questions** — checked off below.
Sixteen remain. Several batch into one keyed session; batching is noted.

| # | Question | Answers | Gates | Batch |
|---|---|---|---|---|
| **77 ✅** | What is in a `tool_result` block? Anything structured? | 01#1, 01#23, 02#28, 02#29, 02#32 | ST3, LT1, TR23, TR25 | done |
| P78 | For each of Bash/Edit/Write/Read/WebFetch/Skill/MCP/EnterPlanMode/ExitPlanMode/AskUserQuestion, which `canUseTool` option fields arrive populated — `suggestions`, `title`, `displayName`, `description`, `decisionReason`, `agentID`, `blockedPath`, `matchedAskRule`? Do Chrome/browser tools appear at all? | 05 P5/P19/P20/P21/L1/P18, 02#44 | **the entire W4.5 permission cluster (27 entries)** | A |
| P79 | Does returning `updatedPermissions: [{type:"addRules", …, destination:"localSettings"}]` write the rule and silence the next identical ask? Same for `"session"` and `addDirectories`? | 05 P5/P9/P22 | DG5, DG9, DG10, DG25 — the whole "don't ask again" story | A |
| P80 | Does `[Request interrupted by user]` reach a client as a user message? Do context-limit / credit-balance / abort conditions arrive as assistant text with upstream's sentinel strings, or as SDK errors? | 01#13, 02#43 | LT14, TR38 | B |
| P81 | Does the `compact_boundary` frame carry a summarised-message count and direction? | 02#41 | TR36 | B |
| P82 | Are there per-block timestamps on the thinking stream events, enough to compute `Thought for 12s`? | 02#37 | TR33, LT2 clause 1 | B |
| P83 | Are nested assistant messages' `usage` blocks summable into `Done (N tool uses · Xk tokens · Ys)`? Is there a name or type beyond `parent_tool_use_id`? | 01#16, 02#44 | LT17, TR39, DG21 | B |
| P84 | Does a client see incremental stdout for a running Bash? Any wire counterpart to `backgroundTaskId` or the background affordance? | 01#14, 01#29 | LT19, LT20 | C |
| P85 | Do PreToolUse hook summaries with timing reach a client? Does the auto-mode classifier's verdict reach a client? | 01#26, 01#28 | LT21, LT22 | C |
| P86 | Ink input capability matrix in our terminals: `home`/`end`/`pageup`/`pagedown`, `shift+return`, `super`/`meta` chords, mouse click and wheel, terminal focus events, bracketed-paste boundaries | 03 V6/E6/E7/E13/A7/X3, 06 K22 | **scopes W4.3 and W4.4** — separates unreachable from unbuilt | D |
| P87 | Does the SDK accept image content blocks on a user turn? Can a pasted screenshot round-trip? | 03 T1/T2/T3, 02#39 | CM42–CM45, TR34 — a whole sub-domain | E |
| P88 | Is per-model pricing/entitlement metadata reachable from the SDK, or only from `ant models`? Is reasoning effort settable, or is `setMaxThinkingTokens` the only knob? | 05 S5/S6, 06 K26 | DG47, DG48 | F |
| P89 | Does `getContextUsage` expose window size, reserved output and the auto-compact point — enough for upstream's token-absolute `warn`/`compact`/`blocked` levels rather than a naive percentage? | 04 C3 | CH4 | F |
| P90 | Do the SDK's task items carry `activeForm`, owner, blocker, activity? | 05 N3, 04 C12, 02 §6.1 | DG58, CH15 | F |
| P91 | Is there an anchored summarize (`Summarize from here` / `up to here`)? Can a client start a fresh session seeded with a first message plus a transcript pointer? | 05 R4, 05 L5 | DG41, DG32 | G |
| P92 | Does the SDK surface auth-state changes and API-refusal/fallback events to a client? | 04 C38, 05 O1 | CH39, DG65 | G |
| P93 | Can we send OSC 11 / OSC 0 / OSC 21337 from inside a live Ink render without corrupting the frame, and does the OSC 11 reply parse? *(Terminal question, not SDK.)* | 06 T5, 04 C26/C28 | TH3, CH28, CH30 | H |

**Dropped from the reports' probe lists.** 02 row 5 ("does the SDK surface a queued-message state?")
— our queue is entirely client-side in `useChat.ts`; there is nothing for the SDK to surface. 05's
"is a per-anchor rewind dry-run cheap enough for every row?" is a performance measurement of our own
code, not an SDK probe — fold it into DG39's implementation.

**Run order.** Batch A first and alone — it unblocks the largest cluster and nothing else depends on
it. Batch B is one keyed session with four questions. C, F and G are cheap and can share a session.
D (P86) needs a pty harness, not the SDK, and can run in parallel from day one.

---

# 11. Cannot build

Two categories, deliberately separated.

## 11a. Unreachable — settled, no probe will change it

| What | Evidence | Consequence |
|---|---|---|
| **`suppress_always_allow_rule`, `decision_reason_type`, `classifier_approvable`** | Declared on `SDKControlPermissionRequest` (`sdk.d.ts` L3596–3625); **zero occurrences of all three in `sdk.mjs`** — dropped before the callback. Settled statically | DG22: upstream's rule for hiding the persist row is out of reach, so any "don't ask again" row we add will sometimes appear where upstream hides it. DG20: only the free-text `decisionReason` sentence is available — the typed variants (`error`-coloured auto-mode classifier, `/permissions to update rules`, `<settings file> to update hooks`) cannot be derived |
| **`isAskCappedByOrg`** (MCP `effectiveMaxPermission === "ask"`) | No field on the callback | DG23: the MCP-capped suppression of the persist row is unreachable |
| **Structured tool results** | Probe 77: every `tool_result` carried only `{tool_use_id, type, content, is_error}` with `content` a plain string | Not a blocker for most of LT1 — Read/Grep/Glob counts derive from the result text, Write from `input.content`, Edit's added/removed from `old_string`/`new_string`. **Absolute diff line numbers are the exception**: not on the wire at all, reachable only by reading the file ourselves (TR25) |
| **Upstream's per-tool phrasing, transcribed** | Probe 77: the model uses Bash for grep and glob, there is no `LS`, and todos are `TaskCreate`/`TaskUpdate` behind `ToolSearch` | A Grep/Glob-keyed clause table fires on nothing. LT2's grammar must be built from a tool census; upstream's `Kr_` Bash-command classifier is the transferable part |
| **Alt-screen / fullscreen renderer, and everything gated on it** | Ink `<Static>` is append-only; unmounting replays the entire scrollback (the Wave-1 lesson, already recorded) | CH35 n/a. Also n/a in the same shape: the composer's `maxVisibleLines` viewport (CM7), the footer's right-column suppression, and upstream's `ds()`-gated git/bash collapse clauses |
| **Theme change repainting history** | Same `<Static>` constraint — already recorded at `tui-ux.md:91–93` | TH12: a theme change recolours new output only |
| **IDE and LSP surfaces** | No IDE attach channel | 01#27 LSP-diagnostics attachment; DG6's `Opened changes in <IDE> ⧉` handoff; the IDE picker; the `⧉ 12 lines selected` chip |
| **Artifact publishing** | claude.ai-coupled | DG33 (plan-as-artifact pre-step), DG54, `ctrl+]` (KB10) |
| **Remote-flag services** | No `tengu_*` gate service | CH27 announcements, PR status badge, cloud-session chips, closed-issue polling, bridge chip |
| **The diff sidebar** | 06: **no handler is registered anywhere in the bundle** for `app:diffFileListUp/Down`; the actions exist only in the table, the description map and the action enum | DG37, KB11 — vestigial upstream. Cloning it would clone dead code, and our keymap must not advertise it |
| **`cmd+*` chords** | macOS system keys never reach a terminal app | KB9 (`cmd+k` clear screen) — already a recorded divergence |
| **Voice push-to-talk** | No audio surface | 03 X8, 06 K34 |

## 11b. Merely unverified — a probe decides

Every one of these has a probe assigned in §10 and **must not be recorded as unreachable until it
comes back**: Bash incremental stdout (P84), hook timing and the auto-mode verdict (P85), image
content blocks (P87), the reasoning-effort knob and model pricing metadata (P88), token-absolute
context thresholds (P89), task-item fields (P90), anchored summarize and seeded fresh turns (P91),
auth and refusal events (P92), Chrome/browser tool presence (P78), Ink's key and mouse capability set
(P86), OSC round-tripping from Ink (P93). Also unverified in the *other* direction: upstream's
session-resume divider — 02 searched six ways and found no renderer, so either upstream has none (we
over-ship) or the search missed it.

---

# 12. Scorecard corrections

`docs/parity/tui-ux.md` scores ✅ on behaviour that measurably diverges. Every correction found across
the six reports, collected. **This should be applied before the scorecard is trusted again**, and the
overall percentages recomputed afterwards — several of these move rows from 1.0 to 0.5 or 0.

### §2 Transcript / message rendering

| Line | Current | Correction |
|---|---|---|
| 255 | `User prompt echo · 🟡 · "CC uses >"` | CC uses **`❯ `** (U+276F) in the `subtle` colour **on a `userMessageBackground` band**. Not `>`. The note is wrong, not just the score |
| 256 | `Assistant message identity (● bullet, accent) · ✅` | Bullet is `⏺` on macOS, and its colour is the plain `text` token, **not an accent**. Two divergences under one ✅ → 🟡 |
| 257 | `Thinking blocks · ✅ · "CC ✻/token count"` | CC shows a **duration**, not a token count. The streaming glyph is `✻` but the content gutter is `∴`. And the content is **hidden by default** → 🟡 |
| 258 | `Tool-use rows · ✅ · "CC's ● Name(target) bullet form"` | Only the **replay** path renders `● Name(target)`; the live path renders `Name target` with no parens and no bold. Upstream bolds the name and the **row** adds the parens. Two paths disagreeing is itself the defect (ST1) → 🟡 |
| 259 | `Tool result tree glyph (⎿) · ✅` | Ours prefixes `  ⎿ ` (4 cols) to **every** line; upstream emits it **once** at 5 cols with content in a sibling flex column → 🟡 |
| 260 | `Markdown: headers/lists/quote/fenced · ✅` | No links, no images, no strikethrough, no `hr`, no task lists, no nested lists, no depth-varying heading style, no block separation. Not a ✅ → 🟡 |
| 262 | `Markdown: tables · ✅` | Upstream draws a box table with per-column alignment, three-way width fitting, a rule between every pair of data rows, a 200-row cap, and a vertical record fallback → 🟡 |
| 264 | `Edit/Write diff · ✅` | Honest about hunk-relative numbering, but silent on: no add/remove counts header, **foreground colour instead of background bands**, no word diff, no wrapping, and a 24-line cap upstream does not have → 🟡 |
| 266 | `Long-output truncation + expand · 🟡 · LOW` | **Priority is wrong.** `(ctrl+o to expand)` is one mechanism that also drives collapsed groups, verbose diffs and expanded thinking. This is ST2 — structural, not LOW |
| 267 | `Compact boundary marker · ✅` | Upstream renders a bulleted `Compact summary` with a message count and an expand affordance, not a rule → 🟡 |

### §3 Status / chrome

| Line | Current | Correction |
|---|---|---|
| 276 | `Status bar (model · mode · ctx%) · ✅` | Upstream's footer has **none of the three**. Model is in the startup header, `/status` and statusLine; cost only in `/cost` and statusLine; ctx% is a transient notification → divergent, not ✅ |
| 277 | `Spinner glyph · ✅` | Glyph set correct; **timing model wrong** (2000 ms triangle over 6 base glyphs, 100/50 ms clock — ours is 120 ms over 12); ghostty `TERM` variant missing → 🟡 |
| 278 | `Spinner thinking verbs (187, random) · ✅` | 186 upstream; we have one extra (`Evaporating`). And the random verb is the **last** fallback, not the primary source — upstream shows the active todo's `activeForm` first → 🟡 |
| 279 | `"esc to interrupt" affordance on spinner · ✅` | Upstream puts it in the **footer** hint ladder, only while loading. Never in the spinner → divergent |
| 282 | `Context-left % + threshold warning · ✅` | Different trigger model (a queued notification, hidden entirely at `level === "ok"`), different text, different surface → 🟡 |
| 283 | `Permission-mode indicator (color) · ✅` | Colours are ours, not upstream's 6-entry table; no symbol (`⏸`/`⏵⏵`), no ` on` suffix, no `(shift+tab to cycle)` → 🟡 |
| 285 | `? for shortcuts hint line · ✅` | We show a fixed 3-item string; upstream is an 11-rung one-winner ladder where `? for shortcuts` appears **only** when everything else is empty and the mode chip is default → 🟡 |
| 286 | `Plan-usage warning chip · ✅` | **Upstream has no such chip.** Scoring ✅ for something upstream does not have is a category error on a cloning scorecard → reclassify as a recorded addition, out of the parity denominator |
| — | (missing rows) | §3 has **no rows at all** for: statusLine, terminal title, desktop notifications, tab status, spinner tips, startup announcements, the notification queue, reduced motion, screen-reader mode, resize/SIGCONT |

### §1 Input / composer

| Line | Current | Correction |
|---|---|---|
| 227 | `Multiline editor (paste split) · ✅` | Upstream turns a >800-char or >2-newline paste into a `[Pasted text #N +M lines]` chip stored out of band and substituted at submit. Ours inserts verbatim → 🟡 |
| 228 | `History up/down (draft stash/restore) · ✅` | Ours is in-memory per composer mount; upstream persists `~/.claude/history.jsonl` across sessions with newest-wins dedup and a per-index edit cache → 🟡 |
| 235–236 | `Ctrl-K / Ctrl-U / Ctrl-W · ✅` | The keys exist but the killed text is **discarded**. Upstream keeps a kill ring with `ctrl+y` yank and `alt+y` yank-pop, and hints `Ctrl+Y to paste deleted text` → 🟡, and it is Tier 0 |
| 240 | `Ctrl-_ / Ctrl-- (undo edit) · ✅` | **Unreachable.** Terminals send a bare `0x1f`; Ink reports `key.ctrl === false`; the branch never fires and a literal `\x1f` is inserted. Only reducer-level tests exist, which is why nothing caught it → ❌, and `ShortcutsOverlay.tsx:18` advertises it |
| 239 | `Ctrl-J (newline) · ✅` | Observable behaviour is correct, but via a different path — the `key.ctrl` branch at `editor.ts:239` is dead. Keep ✅ with a note |
| 244 | `Queued messages while busy · ✅ · "Esc clears"` | **Esc clearing the queue destroys the text.** Upstream pops it back into the composer → 🟡, Tier 0 |
| 245 | `Placeholder / ghost text · ✅` | Upstream's placeholder is a 4-rule precedence chain over a git-seeded random pool, and one rule is the queue hint. Ours is one fixed string → 🟡 |
| 246 | `? shortcuts / help menu · ✅` | Our overlay closes on **any** key and the key also fires `ChatApp`'s global chords. Upstream's `Help` context binds only `escape` → 🟡, Tier 0 |
| 249 | `Image paste (Ctrl-V) · 🚫 "non-terminal / out of scope"` | **The rationale is wrong.** Upstream's `ctrl+v` reads the **system clipboard** — that is terminal-native. Whether we can build it is an SDK question (probe P87), not an out-of-scope call → reclassify 🚫 → ❌-pending-probe, **which changes the denominator** |

### §4 Modals / overlays and §8 Control plane

| Line | Current | Correction |
|---|---|---|
| 293 | `Permission approval dialog · ✅` | Upstream has 13 dialog kinds behind a per-tool matcher. Missing: per-tool titles, question lines, real inline diffs in the body, destructive-command warnings, symlink warnings, session/prefix/domain persist rows. Our `allow_always` is an in-memory `Set<toolName>` that never persists and never emits `updatedPermissions` → 🟡 |
| 294 | `Bash permission shows full command · ✅` | We clip to 140 chars; upstream shows the rendered command **plus** the description **plus** the destructive-pattern warning → 🟡 |
| 295 | `Model picker · ✅` | No effort axis, no `s` session-only, no pricing/entitlement metadata, no overflow counter or row window, different header and subtitle → 🟡 |
| 296 | `Resume session picker · ✅` | Upstream has a search bar, expandable groups, `Space` preview, `Ctrl+R` rename, `Ctrl+A/B/W` scope toggles and an `(N of M)` header. Ours is a flat list → 🟡 |
| 297 | `Task/todo panel · ✅` | Different glyphs, no strikethrough on completed, no bold on in-progress, no header counts, no owner/blocker/activity lines, not persisted to a setting → 🟡 |
| 299 | `Transcript pager (Ctrl-O) · ✅` | **Scored against the wrong mechanism.** Upstream's `ctrl+o` is a **verbose-mode flip** that changes what every renderer emits; ours is a scrollback pager. Both are useful; they are not the same feature → 🟡, with ST2 as the real row |
| 359 | `Plan-mode approval dialog · ✅` | Upstream's is the only `layout:"modal"` dialog, titled `Ready to code?`, with up to 6 conditional options including a clear-context family that **denies** and re-seeds a fresh turn, and an inline `No, keep planning` input that keeps the dialog open on empty submit. Ours has 3 fixed options → 🟡 |
| 358 | `AskUserQuestion · 🟡` | Correct. Add two missing facts: upstream also has a **design-preview two-column variant** when any option carries a `preview`, and an **AFK auto-resolve** that submits partial answers on timeout |
| 366 | `Subagent attribution on dialogs · 🟡` | Upstream renders it as a **frame-header suffix** (`· from the <name> agent`), not a separate line above, and colours subagents from 8 reserved theme tokens |
| — | (missing rows) | §4 has no rows for: DiffDialog, the `Select`/`Tabs` primitives, the notification queue, the background-dialog detail sub-dialogs, or EnterPlanMode |

### §4/§5 Themes, and the largest missing row of all

| Line | Current | Correction |
|---|---|---|
| 303, 322 | `ThemeDialog · 🟡 · "auto currently equals dark — no headless terminal-background detection"` | **The stated reason is wrong for the foreground REPL.** Upstream's Tier 2 (`COLORFGBG`) is a pure env read that works today; Tier 1 (OSC 11) needs raw stdin plus a stdout write, both of which the foreground REPL already owns. The constraint is real for the daemon path only. The gap is smaller than the note claims |
| 303 | `"5 of upstream's 7+ theme rows"` | It is exactly **7 built-in picker rows** (`auto` + 6 palettes), plus custom themes. The two we lack are the **ANSI variants**, whose whole point is that the terminal owns the colours |
| — | **absent entirely** | **There is no row anywhere for the theme token contract.** `ThemeTokens` is 3 tokens against upstream's 72, and ~15 colours our TUI actually paints are hardcoded ANSI names across five files, invisible to `setTheme()`. This is ST4 — the prerequisite for every other theme row |
| — | **absent entirely** | **There is no row for the keybinding table or the precedence model** — ST5/ST6, the largest structural gap in the whole inventory, and the cause of a live class of double-fire bugs |
| — | **absent entirely** | No row records `ctrl+z` as a binding **we introduced** on a key upstream reserves, nor `#` memory mode as an addition rather than parity |

### Corrections to `MAP.md` (carried from report 06)

- The keybinding table has **19** context blocks, not 20. The **20 valid contexts** live in the
  separate registry `War` (L186,159), which includes `DiffPanel` (valid, zero default bindings).
- `Terminal` and `info` are **false positives** from grepping `context:` — the first writes a Zed
  editor keymap file, the second is a slash-command category map entry.
- `Transcript` is a real context with 20 default bindings and was omitted from the list.
- The six theme **palettes** are at L156,475. L41,474 holds only the id enum.

### Corrections to an earlier research pass (carried from report 04)

- The irregular past-tense table has **77** entries, not 71.
- It is **not** used by the spinner. It conjugates the **grouped tool-use activity line** in the
  transcript.

---

# 13. Where we ship more than upstream

On a cloning brief this is a defect. Fourteen cases; my recommendation on each.

| ID | What | Recommendation |
|---|---|---|
| CH14 | `"Evaporating"` — a 187th spinner verb absent from upstream's 186 | **Delete.** Pure drift, one line, no argument for it |
| CH19 | `esc to interrupt` inside the spinner tail | **Move to the footer** hint ladder, where upstream has it, gated on `isLoading` |
| CH6 | Plan-usage warning chip `⚠ 5h 92%` | **Remove from the footer.** Upstream surfaces rate limits only via `/usage` and statusLine. Keep `/usage` |
| CH7 | `think <level>` chip | **Remove.** Upstream has it as a Config row and a spinner `effortSuffix`, never a chip |
| CH4 | Context indicator permanently visible | **Adopt upstream's model** — a threshold-triggered notification, hidden at `ok`. Ours competes with content for the whole session |
| CH3 | `model <name>` in the footer | **Keep for now, record as deliberate, remove when statusLine or a persistent `/status` surface lands.** Upstream can omit it because it has three other places to show it; we have one |
| CH5 | `⟳ streaming` and `⚙ N bg` chips | **Keep `⚙ N bg`** — our fleet feature has no other surface and upstream's equivalent (the tasks chip) exists. **Remove `⟳ streaming`** — the spinner already says it |
| CH20 | Real `message_delta` output tokens vs upstream's animated `responseLength/4` estimate | **Keep ours.** Cloning an estimate over a real number would be cloning a workaround |
| KB5 | `ctrl+z` detaches | **Keep the feature, move the key.** Upstream flags `ctrl+z` reserved for SIGTSTP with good reason. Rebind detach; this is also Tier 0 |
| KB1 | `a`/`A`/`d`/`D` + digits in the permission dialog | **Keep as aliases, add `y`/`n`** — upstream's two most reflexive confirmation keys are currently dead |
| KB6 | Any key dismisses the `?` overlay | **Remove.** A bug, not a superset — the key double-fires |
| DG43 | Rewind always two-stage | **Keep.** Upstream restores immediately when checkpointing is off; ours is safer and the extra step is cheap |
| DG61 | `/bg` rather than `/tasks` | **Keep.** A documented collision with `TaskPanel`. Add `/tasks` and `/bashes` as aliases that route to the same panel |
| CM65 | `#` memory mode in the composer | **Keep.** Upstream's `mP()` knows only `!`. Ours is a genuine addition; record it as a divergence rather than silently carrying it |
| — | `─── resumed: … ───` transcript dividers | **Keep, flag unverified.** 02 found no upstream renderer after six searches but declined to conclude one does not exist |

---

# 14. Quick wins

Obvious and tiny — each is a one-line or one-function change with visible payoff. Grouped by where
they land in the wave plan so they can be batched.

**In W4.0 (harm list, all S):** bind `y`/`n`; `ctrl+d` double-press; help overlay `escape`-only plus
the `shortcutsOpen` gate; delete the three dead branches; the help-overlay honesty audit.

**In W4.1 (one-constant changes, all S):** `⏺` on macOS / `●` elsewhere · bullet colour → `text` ·
running/done/error glyph unification · `⎿` once at 5 columns · bold tool name + row-added parens ·
`wd()` cwd-relative paths · OSC-8 file links · Bash arg 2 lines/160 chars · `sed -i` → file path ·
per-row elapsed removed · `Interrupted · What should Claude do instead?` and `Tool use rejected`
literals · delete `"Evaporating"`.

**In W4.2 (S each):** `… +N lines (ctrl+o to expand)` replacing our three ad-hoc "more" strings ·
group elapsed at 2000 ms · `(ctrl+b to run in background)` row hint.

**In W4.3 (S each):** composer border left/right off · `❯` + NBSP, dimmed while loading · `History
n/total` border label · suggestion selection wraps · `ctrl+n`/`ctrl+p` in the popup · selected row →
`suggestion` colour not `inverse` · `No commands match "…"` · readline batch (`ctrl+b`/`ctrl+f`/
`ctrl+h`/`ctrl+n`/`ctrl+p`/`alt+d`) · `Save and close editor to continue...` · paste normalisation
(ANSI/CRLF/tabs) · consecutive-dedup → newest-wins dedup · per-index edit cache.

**In W4.6 (S each):** unordered marker `•` → `-` · `hr` → `---` · task lists `[x] `/`[ ] ` · inline
code → `permission` token · blockquote `▎` + italic · code blocks lose the 2-space indent · **the
language-label polarity flip** (show it only for *unrecognised* languages, and stop dimming unknown
blocks) · heading depth styles + trailing blank · block `gap: 1` · diff header `Added N lines,
removed M lines` · diff marker spacing (`${num} - ` → `${num} -`) · `✻ Thinking…` placeholder · `∴`
gutter.

**In W4.7 (S each):** ghostty spinner glyph variant · spinner timing model · thinking-word escalation
ladder · elapsed only past 16 s · todo glyphs `✔`/`◼`/`◻` with strikethrough and bold · todo header
counts · `Claude is waiting for your input` · banner degradation at `rows < 30`.

That is **roughly 55 entries reachable in single-line or single-function edits** — a third of the
non-Tier-5 inventory, and enough that no wave is all large items.
