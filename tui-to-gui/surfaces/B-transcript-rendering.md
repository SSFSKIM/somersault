# Lane B — transcript and message rendering

**Date.** 2026-09-09, completed 2026-09-10. **Canon.** Claude Code 2.1.263
(`/Users/new/claude-code-bundle/2.1.263/`). **Cards.** B-01 … B-68 (68).

**SPEC 263 chapters read.** `41-tui-rendering.md` §41.7.1, §41.7.4, §41.7.5, §41.8.6, §41.13.3,
§41.13.4, §41.15.3, §41.16.1–§41.16.12, §41.17.1–§41.17.11, §41.23.1–§41.23.5, §41.24.6,
§41.26.2 (the complete `/config` row table); `11-query-loop-and-messages.md` §11.2.9–§11.2.11,
§11.7.6, §11.8.2–§11.8.4, §11.14.4, §11.15, §11.15.1; `13-context-management.md` §13.8, §13.11.1,
§13.15, §13.15.6, §13.19.1–§13.19.4; `28-slash-commands.md` §10.1–§10.5;
`35-session-persistence.md` §35.21; `03-settings-and-configuration.md` (timestamp, time-format,
time-zone, `copyOnSelect`, `copyFullResponse`, `showTurnDuration` rows);
`14-tool-interface-and-registry.md` and `45-headless-and-sdk-protocol.md` (tool roster and
`tool_use_summary` pass-through cross-checks); `A4-glossary.md`, `A5-cross-version-notes.md`.

**Verification spent in `cli.pretty.js` (2.1.263).** Twenty-one greps, each cited at the card that
uses it. The load-bearing ones: the fold constants `var v1 = 3, Q2n = 10` (:759693) and the
affordance `(${e} to expand)` (:759691); `"Interrupted "` (:832497) and
`What should Claude do instead?` (:832492); the **five interruption sentinels plus
`User rejected tool use`, `API Error: Request was aborted.` and `Operation stopped by hook`**, all
on one line (:156656); `Already in context (…)` / `Unchanged since last read` (:39514); the
compact-boundary detail builder `${n} message(s) summarized` / `${tokens} tokens summarized`
(:833265); `Waiting for permission…` (:835189, and the composer copy at :511212); `TaskOutput`'s
`Read output (… to expand)` (:417410); `MultiEdit` occurrences (:419941, :675444, :735641 —
verb/permission tables only, **no renderer**); the `ReportFindings` renderer (:834705–834745) and
its model-facing result `No findings reported.` / `${n} finding(s) reported.` (:757253); the
post-edit diagnostics row `Found N new diagnostic(s) in M file(s) (ctrl+o to expand)` (:835272);
the **`collapsed_read_search` cluster renderer** (:838361+, verbs and counters at :838560–:838700,
final assembly at :838676) and its construction (:711554), threshold `if (t + r >= 2)` (:712104)
and compact fallback sentence (:712098); `grouped_tool_use` construction (:488958); the cluster's
`Thinking`/`Thought for` split (:838533) and hook sub-line (~838471); the turn-summary verb list
`["Baked","Brewed","Churned","Cogitated","Cooked","Crunched","Sautéed","Worked"]` with fallback
`"Worked"` (:839089), its suffix assembly (:839480), its hide-when-empty gate (:833212) and the
glyph constant `Dw = "✻"` = `✻` (:282803); and the global-config defaults line carrying
`showTurnDuration: !0, showMessageTimestamps: !1, copyFullResponse: !1` (:98885).

**afleet files read.** Sources: `App/Timeline/Rendering/Rows/` (`ToolResultForms.swift`,
`MessageRows.swift`, `ToolCallRow.swift`, `ClusterRow.swift`, `ThinkingDisclosure.swift`,
`CompactBoundaryRow.swift`, `OpaqueRow.swift`, `NoticeRows.swift`, `TaskRunRow.swift`,
`TurnSummaryRow.swift`, `SentFileRow.swift`, `AgentChip.swift`, `FileLink.swift`,
`TimelineRowBuilders.swift`), `App/Timeline/Rendering/` (`TextSanitiser.swift`,
`TimelineListView.swift`, `TimelineTableController.swift`, `TimelineRendering.swift`,
`TimelineRenderContext.swift`, `LinkActivation.swift`, `README.md`),
`App/Timeline/ChannelTimelineModel.swift`, `App/Timeline/Rows/RowRegistry.swift`,
`App/Decisions/AttributedDiffRenderer.swift`, `App/Decisions/DiffRendering.swift`,
`App/Decisions/SentFileRowView.swift`, `App/Threads/ThreadView.swift`,
`App/Threads/ThreadModel.swift`, `App/Views/ChannelColumnView.swift`,
`Workbench/Sources/FilesPanel/FileViewers.swift`. Specs:
`docs/doperpowers/specs/2026-09-03-afleet-workspace-design.md` §3, §7.3, §8.3, §8.4 and the
Decision Log; `.../2026-09-07-c6-conversation-surface.md`;
`.../2026-09-08-c6.1-timeline-renderer.md` §§3–9, §§11–15, §13 and Outcomes.
`docs/tech-debt-tracker.md` entries 127, 128, 132, 135, 136, 137, 138, 187, 321, 322, 325–327.
Parity: `docs/tui-parity/README.md` §5 (A-41, A-11/14, A-15/16/17) and §7;
`docs/tui-parity/areas/41-tui-rendering.md`, `.../11-14-query-loop-tool-interface.md`,
`.../15-16-17-file-bash-sandbox.md`, `.../20-tasks-background.md`, `.../24-21-permissions-plan-questions.md`,
`.../30-29-32-plugins-skills-styles.md`, `.../31-27-mcp-hooks.md`,
`.../33-34-43-44-ide-lsp-voice-artifacts.md`, `.../46-19-48-37-chrome-web-enterprise-cloud.md`,
`.../13-10-23-context-memory-session-tools.md`, `.../28-slash-commands.md`;
`docs/tui-parity/evidence/2026-09-03-control-request-shapes.md` (probe 11, probe 10).

**somersault clone evidence.** `CC-to-SDK/docs/parity/tui-ux.md` §2 (36 rows) and its F1, F3, F4
and Wave R sections; `CC-to-SDK/docs/superpowers/specs/2026-06-19-chat-rich-tool-rendering-design.md`;
`.../2026-08-06-wave-r-repaint-geometry-design.md`. Carried into cards only where the clone
verified a canon quirk against the binary (byte-verified strings, probe numbers), never as design.

**Denominator covered.** Chrome glyphs, the bullet state machine, gutters and indentation, the
input-box border (41.16.1–4 → B-01…B-05); the renderer side table and shared result primitives
(41.16.5–6 → B-14, B-15); **per-tool result forms, every tool** (41.16.7 → B-16…B-39, twenty-four
cards covering roughly forty tools and three renderer families); diffs and the diff sidebar
(41.16.8–9 → B-40…B-42); interruption and rejection (41.16.10 → B-44…B-46); rate-limit
auto-continue (41.16.11 → B-47); static commitment (41.16.12 → B-56); markdown pipeline, tokens,
lists, tables, links, highlighting, gutter, mermaid, images, width rules, streaming (41.17 →
B-48…B-55); the fold, `ctrl+o`, `ctrl+e`, `verbose`, brief/focus (41.23 → B-06…B-10); virtual list,
scroll anchoring, the commit cursor (41.8.6, 41.15.3 → B-56); untrusted-text sanitising (41.7.4 →
B-57); hyperlinks (41.7.5 → B-54); `textWrap` modes (41.7.1 → B-55); thinking blocks (SPEC 11.15 →
B-11); `tool_use_summary` clusters (SPEC 11.2.9 and the binary's own cluster renderer → B-12,
B-13); turn duration, timestamps, time format (41.26.2, SPEC 11.14.4 → B-60); selection,
`copyOnSelect`, `copyFullResponse`, `/copy` (41.13.3, 41.24.6 → B-58); `/export` (SPEC 35.21 →
B-59); inline attachments and command-echo wrappers (SPEC 11.8.2–4, SPEC 28 §10 → B-61…B-65);
compaction display (SPEC 13 → B-66…B-68).

**Additions to the stated denominator** (found in the family, not listed in the task prompt):

1. **The transcript's real cluster renderer.** The prompt asked for `tool_use_summary` clusters;
   the terminal does not use `tool_use_summary` in the transcript at all — it derives a categorised
   sentence from fourteen counter families in the `collapsed_read_search` renderer, and
   `tool_use_summary` exists for a mobile client. Carded as B-12, with `grouped_tool_use`,
   `work_segment` and `speaker_label` as B-13. SPEC 41.16 documents none of them.
2. **`ReportFindings` has a real, structured, width-adaptive renderer** (B-35). SPEC 41.16.5 lists
   the tool; §41.16.7 documents no form.
3. **The post-edit diagnostics row** (B-43), in no SPEC section.
4. **`Waiting for permission…` as a result-body replacement** (B-46) — one clause in 41.16.10, a
   distinct transcript state in fact.
5. **`MultiEdit` is not a rendered tool in 2.1.263** (B-20), carded `superseded` so the map shows
   the full denominator.
6. **The universal error form's five denial causes** (B-15, B-44, B-45): `non_execution_kind` on
   the wire distinguishes user rejection, permission rule, auto-mode block, interruption and
   cancellation, where the terminal renders one dim sentence.

---

## Headline

1. **afleet renders ten tool result forms; the terminal has about forty, and everything else falls
   to `Done · N lines`.** `App/Timeline/Rendering/Rows/ToolResultForms.swift:97-110` switches on
   `Read`, `Edit`, `Write`, `Bash`, `Grep`, `Glob`, `Agent`, `WebFetch`, `WebSearch`, `TodoWrite`
   and an `mcp__` family; C6.1 §13 scopes the rest out and tracker 136 states the cost exactly —
   *"a reader gets a count where the terminal gives a sentence."* `Skill`, `LSP`, `TaskOutput`,
   `NotebookEdit`, `Monitor`, `ExitPlanMode`, `PushNotification`, `ReportFindings`, `AskUserQuestion`,
   the `Cron*` trio, the worktree pair, `memory_write` and the Chrome and computer-use families all
   render as `Done`. Every one is class **R** with its data on the wire. This is the largest unit of
   remaining work in the lane and it decomposes cleanly (B-16…B-39) — but build B-14's structured
   result slot first, or twenty cards get built twice.

2. **afleet draws no diff after an edit, and it already owns a diff renderer.**
   `ToolResultForms.swift:131-143` counts `structuredPatch` into `Added N lines, removed M lines`
   and sets no expandable body. `App/Decisions/AttributedDiffRenderer.swift` renders a real
   line-level diff, but its only reachable caller is `PermissionCardView` — so a diff appears
   *before* an edit and never after it (tracker 137). `structuredPatch` is class **P**, "*exactly
   the jsdiff shape the TUI renders*". Routing it into the result row (B-18, B-40) is the highest
   value-per-cost item in the lane; giving the renderer line numbers, hunk headers and background
   bands (B-41) is the next.

3. **The terminal's four disclosure controls are one dial; three of them map onto afleet's three
   layers and the fourth has no home.** The fold, `verbose` and `/focus` become afleet's clusters,
   expanded and prose layers (B-10) — a mapping the root spec decided and **never wrote down**
   (`2026-09-03-afleet-workspace-design.md:2910-2911` is the entire definition). `ctrl+o`'s raw
   reading maps onto no layer: it should be a **Raw panel tab** (B-07), so raw and rendered are on
   screen together, which is the one thing a terminal structurally cannot do. afleet names "the raw
   view" three times and specifies it nowhere; the nearest built thing, `App/Threads/ThreadView.swift`,
   has no production caller.

4. **Three defects are visible to a user today.** (a) A slash-command or skill invocation renders
   as literal XML in a user bubble, because nothing parses SPEC 28 §10's
   `<command-name>`/`<command-message>`/`<local-command-stdout>` wrappers (B-61) — the parity
   inventory calls this *"the single most visible skills rendering task"*. (b) An **interrupted**
   tool renders as `Error: …` in red, because `ToolResultForms` keys on `is_error`, which the wire
   documents as the *interrupted* flag rather than a failure (B-44) — the terminal is at pains to
   say *nothing refused it*. (c) A row waiting on a permission card still says `Running…` (B-46).

5. **Four surfaces exceed in the GUI by not being text, and the wire already carries all four.**
   Images and PDFs: bytes on the wire twice over, terminal prints `Read image (240KB)`, afleet
   prints `Read image` — a thumbnail is strictly better (B-17, B-53). Mermaid: never drawn in the
   terminal (SPEC 41.17.8), deferred by C6.1 §7 pending an architect ruling on vendoring mermaid.js
   11.16.1, which the binary already ships for artifacts (B-52). `ReportFindings`: the findings live
   only in the tool *input* and never re-enter the conversation, so the wire is the GUI's only copy
   (B-35). And tables: afleet already draws real `NSTextTable`s, which beats box-drawing (B-49).

6. **The one place the wire is genuinely poorer is live Bash output, and the honest GUI form is to
   say so.** Class **D**, measured independently by afleet's probe 11 and the somersault clone's
   probes 84/100: the published `tool_progress` schema *has no output field at all*. The terminal
   draws five wrapped lines plus `+N lines · 12s · timeout 2m`. Proposal (B-23): tail
   `persistedOutputPath`, which **is** class P, and where there is no path show elapsed plus
   `Output arrives when the command finishes` — never an empty five-line box shaped like the
   terminal's.

7. **Two divergences from canon are deliberate and one is a gap.** afleet **escapes** raw HTML
   where SPEC 41.17.2 passes `token.text` through unescaped, and sanitises host-side where the CLI
   sanitises at paint time; both are correct, recorded in source, and must survive review (B-48,
   B-57). The gap: `TextSanitiser.swift` implements the control-character strip but **not** the
   bidi-override and zero-width pass the terminal iterates up to ten times, and afleet applies no
   clamp at all to strings it hands `UNUserNotification`. That is the one security regression in
   the lane. Separately, there is **no copy affordance anywhere** in `App/Timeline/` — no pasteboard
   write, no context menu, no cross-row selection (B-58).

---

## 1. The row grammar

### B-01 · Chrome glyphs and the row-prefix vocabulary

**Terminal.** Twenty-four glyph constants on three source lines carry the whole visual grammar of
the transcript (SPEC 41.16.1). The load-bearing ones: `❯` (`>` in the ASCII symbol set) prefixes a
user message in `subtle`; `⏺` on macOS / `●` elsewhere is the universal tool **and** assistant
bullet; `⎿` opens every tool-result and child line; `∴` is the extended-thinking bullet, dim and
italic; `✻` marks `✻ Thinking…`, scheduled fires and turn summaries; `∙` separates inline segments
in a progress row; `※` prefixes a recap row; `⧉` marks IDE selections and artifact chips; `↳`
marks nesting; `↻` an MCP resource update in `success`; `⑂` a fork; `♪` an audio attachment; `▌`
the REPL streaming caret; `!` a bash-mode message in `bashBorder`; `⚠` a pinned notice; `├ └ │ ┬ ┴`
the agent tree. The spec records three absences worth carrying: no `#` memory prefix, no `%` mode
prefix, and **no `☒`/`☐` todo chrome anywhere**.

**Job.** One glance tells you what kind of thing a row is — who said it, whether it is a result or
a message, how deep it nests — before you read a word of it. Without it every row is a paragraph.

**Wire.** T. `docs/tui-parity/areas/41-tui-rendering.md` §41.16.1–4 rows class the glyph vocabulary
as terminal-only: nothing on the wire names a glyph; the *distinctions* the glyphs encode (role,
tool vs message, nesting depth, agent identity) are all derivable from the frame types afleet
already reduces.

**afleet today.** `superseded`. `App/Timeline/Rendering/Rows/MessageRows.swift:14-46` (`RowFrame`)
replaces the glyph grammar with an author label, an optional capsule badge and a timestamp;
`ToolCallRow` uses the tool's `userFacingName` as the author and the MCP server name as the badge.
Nesting is `.padding(.leading, 12)` inside a cluster (`ClusterRow.swift:70`) rather than a gutter
glyph. Nothing is lost that a reader used; what *is* lost is that the terminal distinguishes
**tool result** from **tool call** structurally (`⎿` vs `⏺`), and afleet draws both inside one
`RowFrame` with no visual break — see B-03.

**GUI form.** Keep `RowFrame`. Region: Timeline. Replace the glyph vocabulary with three
orthogonal cues rather than one prefix column: (a) an **author identity** — avatar/initial for
you, the model badge for Claude, a small monochrome SF Symbol per tool family — in the leading
12pt column; (b) a **role tint** on the author label only, never on the body; (c) a **left rule**
for nesting depth (cluster members, agent-tree rows), 1pt at `.quaternary`, one per level, which
is the GUI's `⎿`/`├└` equivalent and reads at a glance. `[exceeds]` Distinct symbols per tool
family (file, shell, search, web, agent) carry more than the terminal's single `⏺` ever did.
Two glyphs are worth keeping literally because they carry meaning no icon does: `⧉` for an
artifact/IDE-selection chip and `⑂` for a fork marker.

```
┌───────────────────────────────────────────────────────────────────────────┐
│ ⌘ Claude  [opus-5]  18:42:07                                              │
│ Here is the change I made.                                                │
│                                                                           │
│ ▎ 🔍 Grep   18:42:09                                                      │
│ ▎ pattern: "func render"                                                  │
│ ▎ Found 12 files                              [ Show output ]             │
└───────────────────────────────────────────────────────────────────────────┘
   ↑ the 1pt left rule is the GUI's ⎿ / nesting gutter
```

**Drops / keeps / gains.** Drops: every glyph, the ASCII fallback set, the macOS `⏺`/`●` split.
Keeps: the *distinctions* the glyphs encoded — role, call vs result, nesting depth, fork, artifact.
Gains: per-tool-family iconography; colour that is not limited to a 6-name theme table.

**Open.** Does the owner want per-tool icons at all, or a uniform neutral mark? Slack's own
convention is an avatar per author and nothing per message kind; afleet's timeline has more kinds
than Slack does.

### B-02 · The bullet state machine

**Terminal.** One bullet cell carries four states (SPEC 41.16.2). Running: theme-default colour,
dimmed, and the glyph **blinks between the bullet and a space** on a 600 ms period
(`var pL = 600`). Done: `success`, not dim. Errored: `error`, not dim. Queued: theme default,
dim, **no blink**. The assistant prose bullet is always `color: "text"` and appears only on the
message's first content block. System rows key off level: `warning` → the warning colour,
`notice` → `inactive`, `info` → **no bullet at all** plus dim text.

**Job.** Peripheral-vision status. You can tell, without reading, how many calls are still in
flight and whether any failed.

**Wire.** R. `areas/41-tui-rendering.md` §41.16.1–4: `set_in_progress_tool_use_ids` is dropped
before the wire, so "running" is exactly *a `tool_use` with no matching `tool_result`* — which
C3 already computes as `ToolCallItem.status`.

**afleet today.** `built`, partially. `Rows/ToolCallRow.swift:88` draws
`ProgressView().controlSize(.mini)` for `form.isRunning` and colours the headline `.red` on error;
`ToolResultForms.form(for:)` (`ToolResultForms.swift:44-50`) maps `running`/`denied`/`failed`/
completed. **Queued has no state** — there is no `.queued` case, so a tool waiting behind a
permission prompt looks identical to one executing. C6.1 §8 records the running derivation.

**GUI form.** Keep the four states; give each its own affordance rather than one glyph.
Running → the existing mini `ProgressView` (an indeterminate spinner is the GUI's blink, and it is
better: it says "working" without stealing attention with a 600 ms flash). Done → no ornament at
all (absence is the strongest "fine"). Errored → the headline in `.red` plus a filled
`exclamationmark.triangle.fill` in the leading column. **Queued → a hollow ring plus the headline
`Waiting…`**, matching the terminal's `Waiting…` copy for a queued Bash. Deviation named: the
terminal *dims* running rows and afleet does not — keep afleet's, because dimming a row a user is
actively watching is worse in a window that is not width-constrained.
`[exceeds]` A per-channel count of in-flight calls belongs in the channel header, not in the row.

**Drops / keeps / gains.** Drops: the 600 ms blink; the dim-while-running convention. Keeps: four
states, error colour, the "first content block only" rule for the assistant bullet. Gains: a
determinate progress affordance where the tool reports one (MCP progress, B-37).

**Open.** None.

### B-03 · Gutters, indentation and unselectable chrome

**Terminal.** The canonical result gutter is five columns: two spaces, `⎿`, a space and a
**non-breaking** space, all dim, wrapped in `pd` so the cells sit in the `noSelect`
`"from-left-edge"` plane and copying a message never picks up chrome (SPEC 41.16.3, 41.13.3).
Second-level nesting (hook sub-lines) is 7 columns; a body under a 5-column gutter is
`marginLeft: 5`; the standard indent is `paddingLeft: 2`; agent-tree rows are `paddingLeft: 3`;
diff and `Write` previews are laid out at `columns − 12`. The universal tool bullet and the
extended-thinking gutter are *not* in the `noSelect` plane — they are ordinary selectable text.

**Job.** Two jobs at once: indentation says what belongs to what, and the selection exclusion means
a drag-copy of a result yields the result and not a column of `⎿`.

**Wire.** T (layout); the selection-exclusion rule is a UX rule worth copying, not data.

**afleet today.** `built`, and the selection property is inherited for free. Every row body is a
separate `Text` with `.textSelection(.enabled)` (`ToolCallRow.swift:110`,
`ThinkingDisclosure.swift:70`, `OpaqueRow.swift:36`), and the author/badge/timestamp line is not
selection-enabled — so AppKit gives afleet the `noSelect` behaviour structurally. Indentation is
`.padding(.horizontal, 12)` on `RowFrame` plus `.padding(.leading, 12)` for cluster members.

**GUI form.** Keep. Two additions. (a) Make the nesting indent a **1pt left rule** as in B-01, so
depth survives at small widths where 12pt of whitespace does not read. (b) The terminal's
`noSelect` rule has a stronger GUI form: `[exceeds]` a **"Copy row"** hover action and a
**"Copy result text"** context item that copy exactly the payload, so the user never has to drag
precisely. This subsumes `copyOnSelect` (B-58) for the common case.

**Drops / keeps / gains.** Drops: fixed column arithmetic (`columns − 12`, `marginLeft: 5`), the
non-breaking-space trick. Keeps: nesting-by-indent, chrome excluded from copy. Gains: explicit
copy actions; depth legible at any width.

**Open.** None.

### B-04 · The user message row and the input-box rules

**Terminal.** A user message is prefixed `❯` in `subtle` (SPEC 41.16.1). The composer below it is
**not a box**: `borderLeft` and `borderRight` are `false` and `borderTop` is unspecified, and the
layout code defaults an unspecified edge to width 1 — so the composer renders as **two horizontal
rules**, above and below, with no sides (SPEC 41.16.4, `chunk-qs63rzfp.js:508653`). The rule colour
is `bashBorder` in bash mode; otherwise, when this session is itself a teammate, that agent's or
team's colour mapped through the `*_FOR_SUBAGENTS_ONLY` table; otherwise `promptBorder`. Plan mode
does **not** tint it. In screen-reader mode the whole style object is `{}`, so no border at all. A
bash-mode message block is a background fill, not a box.

**Job.** The rules are the boundary between "what I have said" and "what I am about to say", and
the colour is a persistent, ambient claim about *which session this is* — the one place the
terminal shows teammate identity without a label.

**Wire.** Mixed. Permission mode is on the wire; the subagent/team colour identity is derived from
`agent_id`/team context (`areas/41-tui-rendering.md` §41.16.1–4 row: "Permission mode on the wire;
subagent identity via …"). R.

**afleet today.** `built` for the row (`MessageRows.swift:96-152`, `UserMessageBody`:
right-aligned, author `You`, markdown body, attachments named, an `Edit` link and the
rewind-refusal note). The composer's own frame is lane C. The **colour identity** is not carried:
nothing tints a channel by agent or team colour.

**GUI form.** Keep the right-aligned user row (it is Slack-shaped and it beats `❯`). Translate the
border's *job*, not its shape: the two rules become the composer's own top divider (lane C), and
the **tint becomes a 3pt leading accent bar on the channel row in the sidebar and on the channel
header**, coloured by the session's agent/team colour when it has one and by permission mode when
it is `bypassPermissions` — an ambient identity claim that survives scrolling, which the
terminal's border does not (it is off-screen once you scroll). Bash-mode's background fill maps to
a monospaced user row with a `.quaternary` fill, which afleet should draw when the message came
from the `!` shell escape.

**Drops / keeps / gains.** Drops: the two-rules-no-sides shape; the screen-reader empty-style
branch. Keeps: the colour's meaning; the bash-mode fill. Gains: identity visible while scrolled.

**Open.** Does the owner want teammate colour surfaced at all in v1, given teams are out of scope
(root spec §3, "teams and cloud are out")? If not, this collapses to the bash-mode fill alone.

### B-05 · The assistant prose row and the streaming tail

**Terminal.** One `⏺` in `color: "text"`, on the first content block only; subsequent blocks of the
same message get no bullet (SPEC 41.16.2). While streaming, `▌` is the REPL caret (41.16.1) and
the text renderer uses `textWrap: "wrap-stream"`, which drops the final wrapped row so a
partially-arrived line does not leave a stale trailing row on screen (SPEC 41.7.1). Streaming
markdown freezes a prefix and re-lexes only the tail (41.17.11, card B-55).

**Job.** Reading the model's answer as it arrives, without the layout jumping.

**Wire.** R. `stream_event` deltas under `--include-partial-messages`
(`areas/41-tui-rendering.md` §41.17 streaming row).

**afleet today.** `built`, and well. `AssistantMessageBody` (`MessageRows.swift:170-200`) draws
the model badge, the thinking disclosure above the text, the markdown body, and a `Superseded`
label plus 50 % opacity for a retracted chain. Streaming is
`TimelineTableController.applyPreview` with a per-row reload rather than a whole-table reload
(`TimelineTableController.swift:41-56`, and the counted `reloadedRows` invariant), and
`RenderedRow.append` parses only closed blocks, leaving the tail plain
(`TimelineRendering.swift:143-159`). The `wrap-stream` last-row rule is not reproduced and does not
need to be — SwiftUI relays out rather than painting rows.

**GUI form.** Keep as built. Two refinements. (a) The terminal's "bullet only on the first content
block" rule is the statement *this is all one message*; afleet's equivalent is that one
`RowFrame` holds all blocks, which it already does — keep it, and do **not** split a message with
interleaved tool calls into several author rows. (b) `[exceeds]` a caret is unnecessary, but a
**subtle shimmer or a trailing `▌`-equivalent on the last line while streaming** is the only cue
that text is still arriving in a window with no spinner in view; today the only cue is the
activity strip (lane A), which may be scrolled out of sight.

**Drops / keeps / gains.** Drops: `⏺`, `▌`, `wrap-stream`'s stale-row rule. Keeps: one row per
message; block-boundary parsing; retraction dimming. Gains: retraction is *visible* (the terminal
has no superseded rendering at all — see `areas/11-14-query-loop-tool-interface.md`: retraction is
half-signalled, class D).

**Open.** None.

## 2. Density and disclosure

### B-06 · The fold

**Terminal.** A long tool result is folded to **three wrapped lines** plus an affordance
(SPEC 41.23.1). The constants are `var v1 = 3, Q2n = 10` (`cli.pretty.js:759693`, verified). The
effective wrap width is `max(columns − 10, 10)`; the character scan is capped at `3 × width × 4`
so a huge result is not measured in full; and a **fourth** line is shown when hiding it would hide
exactly one line — the terminal refuses to write `… +1 line`. The affordance is built by
`(${e} to expand)` (`cli.pretty.js:759691`, verified) and composed with the overflow count
`… +${n} ${lines}` (SPEC 41.16.6) into the canonical `… +12 lines (ctrl+o to expand)`. Seven
renderers override the three-line default:

| Renderer | Limit |
|---|---|
| Error blocks | 10 lines |
| `Write` preview | 10 lines |
| `memory_write` | 10 lines, 200 chars each |
| `Bash` command header | 2 lines, 160 chars |
| Rejected-write preview | 10 lines |
| `Agent` progress | 3 sub-messages |
| System rows | 5 lines, 200 chars |

**Job.** Keeps the conversation readable: a 900-line grep result does not bury the two sentences
of prose on either side of it, and the count tells you whether opening it is worth it.

**Wire.** R. `docs/tui-parity/areas/41-tui-rendering.md` §41.23 classes the fold as host policy —
the whole result text arrives in `tool_result` / `tool_use_result`; nothing on the wire says
"three lines".

**afleet today.** `built`, in a different shape. `App/Timeline/Rendering/Rows/ToolResultForms.swift`
gives every form a `headline`, an optional `detail` and an optional `raw` expandable body
(`ToolResultForm`, `:12-29`), and `ToolCallRow.ToolResultBody` (`:77-119`) shows a disclosure
button reading `Show output` / `Hide output` (`:104`) when `raw` is non-empty. Three gaps.
(a) **No count** — the terminal always says how much is hidden; afleet says only "there is more".
(b) **Two forms set `raw` to nothing at all**, so their content is not folded, it is absent:
`Edit` (`:131-143`) and `TodoWrite` (`:211-216`). (c) **Expansion state does not survive a channel
switch**: `TimelineCollapseState` is a bare `Set<String>` with no store
(`App/Timeline/Rendering/TimelineRenderContext.swift:16-27`), held as `@State` in
`TimelineListView.swift:32`, and `App/Views/ChannelColumnView.swift:80-81` applies `.id(row.key)`,
which discards it on every channel change. It drives five disclosures — thinking, clusters, opaque
rows, tool output, turn summaries — so the loss is uniform.

**GUI form.** Region: Timeline row. Keep the fold; change its unit and its memory.

1. **Unit.** Fold at a *height budget* (about six lines at the row's font size), not three wrapped
   terminal lines — a 900-pixel window has room the 80-column terminal did not, and the terminal's
   three is a scarcity number, not a legibility one. Named deviation.
2. **Copy.** Keep the count verbatim in GUI voice: `+128 lines` as a trailing dim chip on the
   summary row, and a disclosure triangle as the control. Drop `(ctrl+o to expand)` — the chip is
   the control.
3. **Memory.** `[exceeds]` Expansion is **per row and persistent** for the session. The terminal
   cannot do this: `ctrl+o` and `verbose` are global modes, so expanding one result expands every
   result. A GUI reader expands the one grep they care about and leaves the rest folded, and comes
   back to it later still open.
4. **Bulk.** A turn-level `Expand all` / `Collapse all` in the row's hover menu and in the turn
   summary row (B-60) restores the global gesture for people who want it.
5. Keep the terminal's refusal to hide exactly one line — it is a small, correct piece of taste.

**Drops / keeps / gains.** Drops: the three-line constant, `ctrl+o to expand` as copy, the
per-renderer limit table (the GUI has one budget). Keeps: the count, the fold itself, the
never-hide-one-line rule. Gains: persistent per-row expansion; expansion state that survives
scrolling away.

**Open.** Should expansion state persist across app restarts (it is per-row state on a
possibly-huge transcript), or reset per session? Session-scoped is the cheap answer.

### B-07 · `ctrl+o` — the transcript screen, and afleet's missing raw layer

**Terminal.** `ctrl+o` is `app:toggleTranscript` in the `Global` scope; it flips the REPL's
`screen` between `"prompt"` and `"transcript"` and **replaces the whole layout subtree**
(SPEC 41.23.2). Transcript mode forces verbose (the message list ORs its verbose flag with
`screen === "transcript"`), bypasses the `Agent`-progress height collapse and keeps every progress
row, drops the backgrounded-agent parenthetical, and short-circuits the `isStatic` predicate to
true (SPEC 41.16.7, 41.16.12). Its bottom bar is one of three — a search bar, the help panel, or a
hint bar reading `↑↓ scroll · v to open in <editor> · ? for shortcuts`, shortened to
`? for shortcuts` when it does not fit — with a right-aligned `verbose ` badge. The help panel is
a three-column legend: `↑↓ j/k scroll`, `ctrl+u/d half page`, `space b page`, `g/G top/bottom`,
`{/} prev/next prompt`, `/ search`, `n/N next/prev match`, `[ print to scrollback`,
`v open in <editor>`, `ctrl+o toggle transcript`, `q exit`, `? close help`. Exit is
`transcript:exit` on `ctrl+c`, `escape` or `q`.

**Job.** Three jobs the folded list cannot do: read the whole thing without losing your place in
the conversation; **search** it; and get it out (`v` to an editor, `[` to scrollback).

**Wire.** P for the content — the records are the JSONL the CLI writes and afleet already folds
them (root spec §7.3, "the transcript-record reducer is primary"). T for the screen itself.

**afleet today.** `routed-only`, and it is the one structural gap in the density story. The root
spec names "the raw view" three times as the place hidden things go —
`2026-09-03-afleet-workspace-design.md:937` (`session_state_changed` and `isSynthetic` frames
"are hidden from the timeline and kept only in the raw view"), `:1276` (§8.3 Hidden meta) and
`2026-09-07-c6-conversation-surface.md:269` — but **no section specifies it**. Two partial builds
exist and neither is reachable as a raw reading of the conversation.
`App/Timeline/Rendering/Rows/OpaqueRow.swift:30,43` prints canonical JSON, but only for a frame
the reducer did not model. A genuine per-row raw view — tool input JSON, output JSON and the
structured result — exists at `App/Threads/ThreadView.swift:105-112`, but
`ThreadModel.open(_:)` (`App/Threads/ThreadModel.swift:182`) **has no production caller**:
`ThreadAnchor` is constructed only inside `App/Threads/` and in tests, and no timeline row carries
a gesture that opens a thread (`AppTests/TaskCardBackgroundingTests.swift:79` states it). The code
for this card is largely written; what is missing is the route to it and the whole-transcript
reading.

**GUI form.** Region: **Panel** — a `Raw` tab beside Thread and Agents, poppable to its own
window like every other tab (root spec §8.5 region rules). Not a mode. This is the single largest
`[exceeds]` in the lane: the terminal must *replace* the conversation to show the raw reading
because it has one rectangle; afleet can show both at once, scroll-synced.

```
┌─ Channel: somersault ─────────────────────────┬─ Panel ▸ Raw ────────────────────┐
│ ⌘ Claude                                      │ 🔍 Find in transcript      3/17  │
│ Here is the change I made.                    │ ─────────────────────────────────│
│                                               │ ▸ user      18:41:55  msg_01A…   │
│ ▎ Edit  App/Foo.swift                         │ ▾ assistant 18:42:07  msg_01B…   │
│ ▎ +12 −4                        [ Show diff ] │   ├ thinking  (1,204 tok)        │
│                                               │   ├ text      "Here is the …"    │
│ ✻ Cogitated for 1m 4s · done 3:45pm           │   └ tool_use  Edit  toolu_01C…   │
│                                               │ ▸ user (isSynthetic)  ⓘ hidden   │
│                                               │ ▸ tool_result toolu_01C… ✓       │
└───────────────────────────────────────────────┴──────────────────────────────────┘
   the timeline keeps its density; the Raw tab is the ctrl+o reading, side by side
```

Contents, in the terminal's own order: every record the reducer holds, including the ones the
timeline hides (`isSynthetic` user frames, `session_state_changed`, meta reminders), each
expandable to its JSON. Selecting a row in the timeline reveals it in Raw and vice versa. Keyboard:
`⌘F` scoped to the panel (the terminal's `/` and `n`/`N`); `⌘⌥R` to toggle the tab. The
terminal's `v` (open in editor) becomes **Reveal the JSONL in Finder** plus **Open in the Files
panel**, since afleet knows the transcript path from `filePath` on the mirror frames; `[` (print
to scrollback) has no GUI meaning and is dropped.

**Drops / keeps / gains.** Drops: the mode flip; `[`; the hint bar and its three-column help
panel (a GUI panel does not need a key legend); the `verbose ` badge. Keeps: every record, in
order, including the hidden ones; search; export to an editor. Gains: raw and rendered on screen
together; search that scopes and highlights without repainting the conversation; per-record JSON
without a mode.

**Open.** Should the Raw tab show the *records* (afleet's reducer input, matching `ctrl+o`) or the
*wire frames* (stream-json envelopes)? They differ — root spec §7.3 says the transcript persists
records, not envelopes. My reading is records by default with a `Show wire frames` toggle, because
`ctrl+o` is a record reading and the wire view serves debugging, not reading.

### B-08 · `ctrl+e` — show all / hide previous messages

**Terminal.** `ctrl+e` is `transcript:toggleShowAll` in the `Transcript` scope (SPEC 41.23.3 —
note `ctrl+r` is *not* an expand key, it is `history:search`). It draws a **titled rule above the
message list** reading `<chord> to show <bold N> previous messages`, and its inverse
`<chord> to hide <bold N> previous messages`, and it contributes a footer segment
`<chord> to show all` / `<chord> to collapse`. It exists because the element-tree commit cursor
(§41.15.3, card B-56) unmounts old messages: `ctrl+e` is how you get them back.

**Job.** The terminal caps how much history is mounted for performance; this is the escape hatch
that says how much was cut and puts it back.

**Wire.** R — the cap is a host performance policy; the messages themselves are all in the
reducer.

**afleet today.** `superseded`. `App/Timeline/Rendering/TimelineListView.swift` and
`TimelineTableController.swift` back the timeline with an `NSTableView` virtualised by item
identity (root spec §8.3), which mounts a window of *rows* but never drops *items* from the model.
There is nothing to restore, so there is nothing to show.

**GUI form.** No control. The rule this card carries into the GUI is a **negative** one worth
stating in the map: afleet must not adopt a message cap. If the reducer ever needs one — a
250k-record session — the honest GUI form is not a keystroke but a **`Load earlier messages` row
pinned at the top of the list** with the count, which is the same affordance every chat client
uses and which the terminal's titled rule is already shaped like. Copy: `Load 1,204 earlier
messages`.

**Drops / keeps / gains.** Drops: the chord, the titled rule, the footer segment. Keeps: the
count, if a cap is ever needed. Gains: no cap at all in the common case.

**Open.** None.

### B-09 · `verbose`

**Terminal.** `verbose` is a settings-schema key described `Show full tool output instead of
truncated summaries`, with a companion `viewMode: "default" | "verbose" | "focus"`
(SPEC 41.23.4). Resolution is a four-step chain and the order matters: `--verbose` wins outright;
otherwise if `viewMode` is set, verbose is `viewMode === "verbose"` and **the settings cascade is
never consulted**; otherwise if brief is on, verbose is forced false; only then does it fall
through to `Eo("verbose", false)`. In `/config` the row is `Verbose output` (41.26.2), default
`false`. It is not one flag with one effect: it changes `Read`'s header suffix and switches the
path from project-relative to **absolute** (41.16.7); it skips `Bash`'s live preview entirely;
it makes the `claude-in-chrome` family fall through to the generic MCP renderer and the
`computer-use` family return `null`; it expands `TaskOutput`'s description, prompt, harness
header, result and error; it makes `Agent`'s web-fetch form append the full report; it changes the
`Invalid tool parameters` normalisation in the error renderer; and it disables word-diff dimming
paths. `ctrl+o` forces it on.

**Job.** One switch that says "stop summarising, show me what actually happened", for when a
summary is hiding the thing you need.

**Wire.** R — every richer form verbose reveals is built from data the wire already carries
(`docs/tui-parity/areas/41-tui-rendering.md` §41.23 rows).

**afleet today.** `undesigned` as a control. The `raw` body on a form is the moral equivalent for
one row, but there is no session-wide verbose and no `viewMode`.

**GUI form.** Region: **Channel header menu** plus the **Settings window**. A single
`Show full tool output` toggle in the channel's overflow menu, mirrored as an app-level default in
Settings (afleet's own settings, not Claude Code's — C5 §9). Semantics: it sets the *default*
expansion state of new result rows; per-row expansion (B-06) still wins locally, so turning
verbose off does not slam shut a row the reader deliberately opened. That is the deviation, and
the reason is that the terminal's global-only model is a consequence of having one density knob,
not a design goal. Two verbose behaviours are worth keeping literally because they are not about
volume: **absolute paths** in `Read` headers, and `TaskOutput`'s prompt and description. Make
those two a separate, always-on affordance — path on hover as a tooltip (B-16), prompt in the
task row's disclosure (B-24) — rather than gating them behind a verbosity switch.

**Drops / keeps / gains.** Drops: `--verbose`, `viewMode`, the four-step resolution chain, the
verbose-only error-string normalisation. Keeps: one user-facing switch with the terminal's own
description. Gains: verbose as a *default* rather than an override; the two non-volume verbose
behaviours available without it.

**Open.** None.

### B-10 · Brief mode, `/brief` and `/focus`

**Terminal.** Three related things (SPEC 41.23.5). `/brief` is `Toggle brief-only mode`; `/focus`
is `Toggle focus view: just your prompt, summary, and response`; and `briefTranscript` /
`isBriefOnly` are the two app-state flags behind them. `viewMode: "focus"` makes the verbose
resolver return false unconditionally. Brief mode is gated by `CLAUDE_CODE_BRIEF` or the
`tengu_kairos_brief` gate plus the `userMsgOptIn` launch option, so it is not universally
available. Its visible product is a hidden-message count carried on the turn-duration record and
rendered in the turn summary row as `<N> messages hidden (/focus to show)` (`cli.pretty.js:839480`,
verified) — so the terminal tells you exactly what focus mode took away.

**Job.** Read a long session as a conversation: your prompt, what came back, and nothing else.

**Wire.** R. The hidden-count is derived by the host from the messages it chose to hide
(`cli.pretty.js:712050`); nothing on the wire marks a message "brief-hidden".

**afleet today.** `routed-only`, and the routing is thinner than it looks. The Decision Log entry
is two lines and no more: `- Decision: Three-layer density. Rejected: TUI mirror; prose only.` /
`  Date/Author: 2026-09-03 / kimmi with Claude` (`2026-09-03-afleet-workspace-design.md:2910-2911`),
with the phrase `timeline with three-layer density and native markdown` at `:100`. **The three
layers are never enumerated anywhere in afleet's specs** — §8.3 describes clusters and their
expansion but does not name a layer model, and C6.1 does not either. The layers are inferable from
§8.3's mechanics (prose messages; tool calls collapsed into one cluster row; clusters expandable
inline to one row per call) and that is the reading this study uses. No control toggles between
them today, and there is no brief/focus equivalent at all.

**GUI form.** Region: **Channel header**, a three-position segmented control or a menu with
three checked items — `Prose`, `Clusters`, `Expanded` — matching the three layers by name. Mapping,
which is the answer to the lane's first question:

| Terminal | afleet layer | Control |
|---|---|---|
| `/focus`, `viewMode: "focus"`, brief mode | Layer 1 — prose | `Prose` |
| Default: fold at 3 lines, tool rows visible | Layer 2 — clusters | `Clusters` (default) |
| `verbose` / `viewMode: "verbose"` | Layer 3 — expanded | `Expanded` |
| `ctrl+o` transcript screen | *no layer* — a **panel tab** (B-07) | `Raw` tab |
| `ctrl+e` show-all | *nothing* — no cap exists (B-08) | — |

The terminal's four settings are one dial because a terminal draws one density at a time. afleet's
three layers are the same dial with `ctrl+o` factored out into a second, simultaneous view. Keep
the hidden-count copy: when `Prose` is selected, each turn summary row reads
`12 rows hidden — Show` with the link switching that one turn to `Clusters`. `[exceeds]` The
layer is per channel and persists; the terminal's is global and per process.

**Drops / keeps / gains.** Drops: `/brief`, `/focus`, the feature gate, `CLAUDE_CODE_BRIEF`, the
two overlapping state flags. Keeps: three densities, the hidden-count disclosure. Gains: per-turn
override; a named control instead of two commands with overlapping meanings.

**Open.** Are the three layers a per-channel preference or an app default with per-channel
override? Product call. My reading: app default, per-channel override, both persisted.

## 3. Grouping: thinking, clusters, segments

### B-11 · Thinking blocks

**Terminal.** Extended thinking has its own bullet — `∴`, dim and italic (SPEC 41.16.1) — and its
own animated frame cycle `∴ ∷ ∵ ∷` while the model is thinking. The header uses `✻`
(`cli.pretty.js:282803` confirms `Dw = "✻"`). Thinking labels escalate on four thresholds,
10 s / 20 s / 30 s / 45 s (SPEC 41.18.5 constants). Inside a tool cluster the thinking segment is
`Thinking for <bold 12s>` while live and `Thought for <bold 12s>` when done, with the duration
floored at 1000 ms (`cli.pretty.js:838533`, verified). Whether thinking text is drawn at all is
`showThinkingSummaries`, default **false**, described `Request API-side thinking summaries and
show them in the conversation and in the transcript view (ctrl+o)` (SPEC 03 §settings). Two
model-facing substitutions can surface as visible text when a strip empties a message:
`[No message content]` and `[Thinking removed]` (SPEC 11.15). `redacted_thinking` is never
rewritten, only dropped. 2.1.263 adds a `thinking_stripped` record; it renders to nothing
(SPEC 11.15.1).

**Job.** Two different jobs, and the terminal conflates them: a *progress* signal (something is
happening, for this long) and a *content* disclosure (what it was reasoning about).

**Wire.** P for the blocks, R for the duration. Thinking blocks arrive as content blocks on the
assistant message; the live estimate is `system/thinking_tokens` (root spec §8.3). The 10/20/30/45
label escalation is host-side and terminal-only.

**afleet today.** `built`. `App/Timeline/Rendering/Rows/ThinkingDisclosure.swift` renders a
collapsible disclosure above the assistant text; root spec §8.3 specifies
`a collapsible "Thought for N seconds", with the live estimate from system/thinking_tokens while
streaming`. That is a faithful translation of the terminal's cluster segment. What is not carried:
the present-tense `Thinking for …` while live (afleet shows the estimate, not the tense switch),
and collapse state is per render, not remembered.

**GUI form.** Keep. Region: Timeline, inside the assistant `RowFrame`, above the text. Four
refinements.

1. Keep the terminal's tense split literally: `Thinking for 12s` while the block is open,
   `Thought for 12s` once the message completes. It is a one-word change and it is the clearest
   possible liveness cue.
2. Persist the disclosure state per row (B-06's rule), and add a channel-level default
   `Always expand thinking` in the header menu — the terminal's `showThinkingSummaries` is exactly
   that switch and it belongs in the same place as the density control (B-10).
3. `[exceeds]` Render redacted thinking as an explicit dim row — `Thinking (redacted by the API)`
   — rather than as nothing. The terminal shows nothing, which reads as "it did not think".
4. Do **not** render `thinking_stripped`. Faithful, and it carries no reader value.

**Drops / keeps / gains.** Drops: `∴`, the `∴ ∷ ∵ ∷` animation, the four escalation thresholds
(a spinner replaces them — lane A). Keeps: duration, the tense split, the collapse, the
default-off content. Gains: persistent per-row expansion; a visible redaction state.

**Open.** Should afleet default `showThinkingSummaries` on? The terminal's default is false. My
reading: keep false, because it is a cost/latency decision on the API side, not a display one.

### B-12 · The tool-call cluster

**Terminal.** Runs of tool calls are rewritten into synthetic row types before rendering
(SPEC 41.16.12 names the four: `grouped_tool_use`, `collapsed_read_search`, `work_segment`,
`speaker_label`). Two matter here.

`grouped_tool_use` groups calls **by tool name within one `message_id`**
(`cli.pretty.js:488958`, verified) — parallel `Grep`s in one assistant message become one row.

`collapsed_read_search` is the real cluster. It aggregates a run of tool calls into counters —
`searchCount`, `readCount`, `listCount`, `replCount`, memory counts, `mcpCallCount`, `bashCount`,
`gitOpBashCount`, `editFileCount` with `linesAdded`/`linesRemoved`, `agentCount`, `frameCount`,
scratchpad and workshop write counts, `hookCount`/`hookTotalMs`, `thoughtForMs` — and renders one
sentence of categorised parts (`cli.pretty.js:838361`+, verified). Each part switches tense on
`isActiveGroup`: `reading`/`read`, `searching`/`searched`, `listing`/`listed`, `calling`/`called`,
`editing`/`edited`, `making`/`made`, plus git nouns `committed`, `amended commit`, `pushed to`,
`rebased onto`, `cherry-picked`, `merged`, `commented on`, `marked ready`, `marked draft`,
`enabled auto-merge on`. Edits carry `+A −R` inline. A trailing `…` is appended while active, an
elapsed timer runs, and the row ends with the standard expand affordance. The collapse threshold
is **two** trailing read/search calls (`cli.pretty.js:712104`, `if (t + r >= 2)`); below that the
run stays as individual rows. The compact fallback sentence joins its parts with `, ` and
capitalises **only the first**: `Searched for 3 patterns, read 12 files`
(`cli.pretty.js:712098`). A hook sub-line hangs under the cluster: `  ⎿  Ran 3 PreToolUse hooks
(412ms)`. And `collapsed_read_search` is **never static** (SPEC 41.16.12) — it re-renders every
frame, because its counters are live.

Separately, `tool_use_summary` (SPEC 11.2.9) is a model-written label produced by a small fast
model after a tool batch. Its prompt says it `appears as a single-line row in a mobile app and
truncates around 30 characters, so think git-commit-subject, not sentence`, past tense, examples
`Searched in auth/`, `Fixed NPE in UserService`, `Ran failing tests`. It is emitted only when
`emitToolUseSummaries` is on and there is no `agentId`, is never fed back to the model, and never
reaches disk. **The terminal's cluster row does not use it** — the terminal derives its own
sentence from counters. The label exists for a mobile client.

**Job.** Compress ten tool calls into one line you can skim past, while telling you exactly what
kind of work happened and giving you a way in.

**Wire.** P for `tool_use_summary` (`45-headless-and-sdk-protocol.md` §1486: "passed through");
R for the counters — every count is derivable from the `tool_use` frames afleet already reduces
(`docs/tui-parity/areas/11-14-query-loop-tool-interface.md`).

**afleet today.** `built`. `App/Timeline/Rendering/Rows/ClusterRow.swift` draws one row per run,
members indented at `.padding(.leading, 12)`. Root spec §8.3 specifies clusters
`labeled by the engine's own tool_use_summary (summary, preceding_tool_use_ids), falling back to
counts and elapsed time when no summary arrives; expandable inline to one row per call`. So
afleet's priority is the **inverse** of the terminal's: label first, counts as fallback.

**GUI form.** Keep afleet's structure and fix the label priority. Region: Timeline row, with the
member rows disclosed inline beneath it.

Recommendation, and it is a deliberate deviation from afleet's current spec: **derive the counted
sentence and use `tool_use_summary` as a subtitle, not as the label**. Reasons, in order. (a) The
summary is optional and gated; the counts always exist, so a summary-first design has two visual
shapes for the same row depending on a setting nobody set. (b) The summary is written for a
30-character mobile row; afleet's row is 600 points wide. (c) The counts are *navigable* — `Read 12
files` can carry the file names on hover and open the Files panel; `Fixed NPE in UserService`
cannot. (d) The terminal, which is the faithfulness baseline, derives. So:

```
▎ Searched 3 patterns · Read 12 files · Ran 4 commands · Edited 2 files  +34 −11    1m 04s  ▸
▎ Fixed NPE in UserService                                                     ← tool_use_summary
   ⎿ Ran 3 PreToolUse hooks (412 ms)
```

Keep the tense split (`Reading …` live, `Read …` done) — it is free liveness. Keep the `+A −R`
chip on the edit part. Keep the elapsed timer. Keep the hook sub-line as a secondary line, since
it is the only place hook cost is ever shown. Replace the trailing `…` with the row's existing
progress affordance. `[exceeds]` Each count is a **click target**: `Read 12 files` opens a popover
listing the paths (the terminal has `readFilePaths` and shows only the last one as a display
hint); `Edited 2 files` scrolls to the first edit row; `agent · 2` opens the Agents tab.

**Drops / keeps / gains.** Drops: the `, `-join with first-word capitalisation (a GUI row uses
`·`-separated chips), the trailing `…`, the never-static rule (afleet's table reloads one row).
Keeps: the categories, the tense split, the counts, `+A −R`, elapsed, the hook sub-line, the
two-call threshold. Gains: clickable counts; the summary and the counts both visible instead of
one replacing the other.

**Open.** Should the two-call collapse threshold be higher in a window? Two feels low when a row
is cheap. Suggest three, and say so.

### B-13 · Speaker labels and work segments

**Terminal.** Two more synthetic row types (SPEC 41.16.12). `speaker_label` draws a
`SpeakerLabel` with a speaker and a timestamp above a run of messages from one origin, always
static, with `marginTop: 1`; the message renderer takes `followsSpeakerLabel` and
`followsInboundLabel` flags so the message below it drops its own attribution
(`cli.pretty.js:489437`, verified). `work_segment` draws a `WorkSegmentMessage` and is static
exactly when `!isLive`. Both render `null` when the optional module supplying them is absent, so
both are feature-gated surfaces.

**Job.** In a session with more than one participant — a teammate session, a daemon-delivered
peer message, an inbound message from another session — say who is talking without repeating an
author on every row.

**Wire.** R. Origin kind is on the user frame (root spec §7.3 lists
`origin kind (human, peer, channel, coordinator…)` on `UserMessage`); the grouping is host policy.

**afleet today.** `built` for the underlying model, `undesigned` for the label. Root spec §7.3
gives `case peerMessage(PeerMessage) // user-role messages with a non-human origin` and §8.3's
**Members** rule says authorship follows the member model with a model badge per author. So every
row carries its own author — afleet has no run-grouping and therefore no speaker label.

**GUI form.** `superseded` in effect, and correctly. Slack's own convention — which afleet's shell
adopts — is exactly the terminal's: consecutive messages from one author collapse their
attribution and the first row carries the avatar and the time. Implement that in `RowFrame`
(suppress the author line when the previous row has the same author within a short window) and
the `speaker_label` row disappears as a separate concept. `work_segment` has no afleet analogue
and needs none; its live/finished distinction is already carried by row status. One thing worth
keeping: the terminal separates the *speaker* label from the message body, which means a peer
message from another session is visually a different thing from your own message. afleet should
keep peer messages visually distinct (a different author chip), not merge them into `You`.

**Drops / keeps / gains.** Drops: both row types. Keeps: run-grouping of attribution; peer/inbound
messages distinguishable from human ones. Gains: nothing beyond Slack-standard behaviour.

**Open.** None — teams are out of v1 scope (root spec §3, "teams and cloud are out"), so the peer
case is thin until they are in.

## 4. The renderer table and shared result primitives

### B-14 · The renderer side table

**Terminal.** Which renderer draws a tool's result is a three-stage lookup (SPEC 41.16.5): a
renderer on the tool object wins; then the `builtinRenderFamily` factories; then a static table
keyed by `uiTableKey ?? name`. Nine dispatchable slots exist —
`renderToolResultMessage`, `renderToolUseErrorMessage`, `renderToolUseRejectedMessage`,
`renderToolUseProgressMessage`, `renderToolUseQueuedMessage`, `renderToolUseTag`,
`renderGroupedToolUse`, `userFacingNameBackgroundColor`, `isResultTruncated` — so a tool can have
five different renderings for five different states, not one. `uiTableKey` lets tools share a
renderer: every MCP tool maps to `mcp`, Slack's send tool to `mcp-slack-send`, registered REPL
evals to `repl-registered`. Two `builtinRenderFamily` factories cover `claude-in-chrome` and
`computer-use`. Nine entries are lazy get-accessors (`Bash`, `Edit`, `Write`, `memory_write`,
`Read`, `TaskOutput`, `NotebookEdit`, `PowerShell`, `Skill`); the eager block covers about thirty
more. Only two tools define `renderToolUseQueuedMessage` at all — `Bash` and `PowerShell`, both
literally `Waiting…` (`docs/tui-parity/areas/11-14-query-loop-tool-interface.md`).
`renderGroupedToolUse` exists on `Agent` only.

**Job.** A tool result is not a blob: each tool gets a sentence in its own vocabulary, and each
*state* of each tool gets its own sentence.

**Wire.** R throughout. `docs/tui-parity/areas/41-tui-rendering.md` §41.16.5–.6: the six renderer
hooks plus `userFacingName`, `getActivityDescription`, `getToolUseSummary`,
`isSearchOrReadCommand` and `isTransparentWrapper` are all client-side code. One trap recorded
there: `can_use_tool.display_name` on the wire is a **generic prettifier**
(`mcp__srv__do_thing` → `Do Thing`), *not* the terminal's `userFacingName` — class D. So a GUI
that wants the terminal's names must carry its own table.

**afleet today.** `built`, at a tenth of the size. `ToolResultForms.form(for:)`
(`App/Timeline/Rendering/Rows/ToolResultForms.swift:42-50`) resolves running → denied → error →
completed, then switches on ten tool names plus an `mcp__<server>__<tool>` family
(`:97-110`). C6.1 §8 scopes it explicitly: "*Per-tool result forms (parity §41.16.7 tabulates
about thirty) are implemented for `Read`, `Edit`, `Write`, `Bash`, `Grep`, `Glob`, `Agent`,
`WebFetch`, `WebSearch`, `TodoWrite` and a generic MCP family … every other tool takes a generic
form and the remainder is a tracker entry*"
(`docs/doperpowers/specs/2026-09-08-c6.1-timeline-renderer.md:447-452`), with §13 declaring
"*Per-tool result forms beyond the eleven named in §8*" out of scope (`:723-728`). Tracker 136
(`docs/tech-debt-tracker.md:1869-1878`) names the casualties and states the cost exactly:
"*a reader gets a count where the terminal gives a sentence.*"

**GUI form.** Region: Timeline. Keep afleet's `ToolResultForm` value type — `headline`, `detail`,
`raw`, `isError`, `isRunning` — and extend it in two ways rather than growing the switch alone.

1. **Add the missing states.** The terminal has five per tool; afleet has four. Add `queued`
   (the `Waiting…` state, B-02) and keep the terminal's rule that only shell tools have one.
2. **Add a `structured` slot** beside `raw`. Almost every card in §5 below wants to render
   something that is neither a headline nor a text blob — a diff, a thumbnail, a findings table, a
   notebook cell, a percentage bar. A form should be able to return a small view, not only
   strings. This is the single structural change that turns the twenty remaining tools from
   "write twenty string formatters" into "write twenty small views", and it is the seam that lets
   `[exceeds]` happen at all.
3. **Keep the family mechanism.** `uiTableKey` is exactly right for a GUI too: the MCP family, the
   Chrome family and the computer-use family should each be one form, not thirty.
4. Do **not** adopt `display_name` from the wire as the tool's label. It is a different string
   from what the terminal shows. Carry a name table.

**Drops / keeps / gains.** Drops: lazy chunk loading, `isResultTruncated`,
`userFacingNameBackgroundColor` (a colour per tool family, superseded by B-01's iconography).
Keeps: the family mechanism, five states, per-tool vocabulary. Gains: structured result views.

**Open.** None — this is a mechanical decision inside afleet, and the brief says a card names the
seam and stops.

### B-15 · Shared result primitives and the universal error form

**Terminal.** Six primitives compose every result row (SPEC 41.16.6): `xe` the `⎿` gutter wrapper,
`pd` the `noSelect: "from-left-edge"` wrapper, `jie` the overflow count `… +${n} ${lines}`, `Ac`
the expand affordance, `vh` count-plus-affordance, and `Yd` the universal error renderer. The
error renderer normalises three cases. A **non-string** result becomes `Tool execution failed`.
For a string, `verbatim` defaults false: it extracts any `tool_use_error` payload, removes
`<error>`/`</error>` tags and trims; only when **both** `verbose: false` and `verbatim: false`
does a string containing `InputValidationError: ` become `Invalid tool parameters`; otherwise it
gets an `Error: ` prefix unless it already starts `Error: ` or `Cancelled: `. Errors truncate at
**10 lines**, not the usual three.

**Job.** One error vocabulary across forty tools, so a failure always reads the same way and never
leaks a stack trace or an XML wrapper into the conversation.

**Wire.** R. `docs/tui-parity/areas/41-tui-rendering.md` §41.16.5–.6: the full result text is in
`tool_use_result`; error text is in the `tool_result` block, "*often wrapped
`<tool_use_error>…</tool_use_error>` … strip the wrapper for display*". A **richer** classification
is available than the terminal uses: `tool_result_meta.non_execution_kind` takes
`user-rejected`, `permission-rule`, `automode-blocked`, `automode-unavailable`,
`automode-parsing-error`, `interrupted`, `cancelled` — class P, and the inventory notes it is
"*finer-grained than the TUI's*"
(`docs/tui-parity/areas/11-14-query-loop-tool-interface.md`).

**afleet today.** `built`, and faithfully. `ToolResultForms` (`:64-68`) reproduces all four error
arms verbatim: `Tool execution failed` for no text, `Invalid tool parameters` for
`InputValidationError: `, the first line as-is when it already starts `Error: ` or `Cancelled: `,
and `Error: <first line>` otherwise — with the full text kept in `raw` in three of the four cases.
The headline goes `.red` in `ToolCallRow.swift:95`. What is not carried: the 10-line error
truncation (afleet folds everything into `raw`, which is better), and the
`non_execution_kind` classification, which afleet does not read at all.

**GUI form.** Region: Timeline row. Keep the four arms and the copy verbatim. Three changes.

1. `[exceeds]` **Use `non_execution_kind`.** It is on the wire, it is class P, and it distinguishes
   the five things the terminal renders as one dim line — a user rejection, a permission-rule
   denial, an auto-mode block, an interruption, a cancellation. Each deserves a different row:
   B-44 and B-45 spend it.
2. Keep `Invalid tool parameters` **and** show the real message behind the disclosure. The
   terminal's normalisation exists because the raw string is long and ugly; a GUI can have both.
3. Never truncate an error at 10 lines. Fold it (B-06) with the count.

Deviation named: the terminal renders the error inside the result row in `error` colour and
nothing else. afleet should additionally raise a **failure entry in the Activity view** for an
error the user did not cause, because Activity is the cross-channel query of failures
(root spec §8, Activity view) and a terminal has no such place.

**Drops / keeps / gains.** Drops: `⎿`, the 10-line cap, `verbatim`'s double-negative. Keeps: all
four error strings, the wrapper stripping, the `error` colour. Gains: a real failure taxonomy from
`non_execution_kind`; errors visible from outside the channel.

**Open.** None.

## 5. Per-tool result forms

Every card in this family shares one wire verdict, stated once here rather than repeated:
`docs/tui-parity/areas/41-tui-rendering.md` §41.16.7 opens "*Every row below has its structured
input in the `assistant` frame's `tool_use` block and its structured result in the `user` frame's
`tool_use_result`, so the class is **R** unless noted.*" Each card names only its exceptions.

### B-16 · `Read` — text files

**Terminal.** `Read <bold N> line(s)` in a one-row wrapper (SPEC 41.16.7). Two more text forms
exist and are easy to miss: `Already in context (<path>)` and `Unchanged since last read`
(`cli.pretty.js:39514`, verified). Errors are `File not found` and `Error reading file`. The
tool-use header appends one of three suffixes, tested in order: ` · pages N` when a page selection
is present; otherwise **in verbose mode only**, when an offset or a limit is given, ` · lines A-B`
where `A = offset ?? 1` and `B = A + limit − 1`, or ` · from line A` with only an offset;
otherwise nothing. Verbose also switches the displayed path from project-relative to **absolute**.
The separator is U+00B7 MIDDLE DOT.

**Job.** Confirm the model read the file you think it read, at the size you expect, without opening
the result.

**Wire.** P, richer than the terminal. `docs/tui-parity/areas/15-16-17-file-bash-sandbox.md`:
`tool_use_result` is the whole `ReadOutput` union — for text,
`{type:"text", file:{filePath, content, numLines, startLine, totalLines, truncatedByTokenCap?}}`.
The truncation banner the terminal draws is an attachment and is dropped, **but**
`truncatedByTokenCap: true` is on the wire and its `.describe()` reads "*A programmatic signal for
internal consumers; survives output reconstruction (unlike the render-time banner)*" — the
inventory's verdict is "*Anthropic anticipated this. Nothing is lost.*"

**afleet today.** `built`. `ToolResultForms.swift:120-126` gives `Read N line(s)` with a detail of
`lines A-B` / `lines from A` and the file body in `raw`; `ToolCallHeader.subject(of:)`
(`ToolCallRow.swift:63-73`) deliberately returns nil for `read`/`write`/`edit` because "*the path
is the subject, and it is a link*", and `FileLink.swift:118` renders it as the last two path
components with `.truncationMode(.middle)`, opening through `LinkActivation` (Command → new
window). Not carried: `Already in context` / `Unchanged since last read`, the two error strings
(they fall to the generic error form), and `truncatedByTokenCap`. Non-`.read` input falls to the
generic form (`:116`).

**GUI form.** Region: Timeline row. Keep the headline. Five changes, all cheap.

1. Show `lines A-B` **always**, not only in verbose — a GUI row has the width and the range is the
   most useful fact after the count.
2. Show the project-relative path as the link label and the **absolute path on hover** as a
   tooltip. That is the terminal's verbose behaviour without the mode (B-09).
3. Add the two "no read happened" forms verbatim: `Already in context` and
   `Unchanged since last read`, dim, with no expandable body. They are the difference between "it
   looked" and "it remembered", and losing them makes a cached read look like a fresh one.
4. `[exceeds]` When `truncatedByTokenCap` is true, draw a `Truncated` chip on the row. The terminal
   draws a banner the wire does not carry; the wire carries a flag the terminal does not use.
5. `[exceeds]` The expanded body should be the **Files panel viewer**, not `.caption.monospaced()`
   — afleet has Monaco and a syntax highlighter; a 400-line file read deserves them.

**Drops / keeps / gains.** Drops: the verbose gate on the line range, ` · pages N` (see B-17),
the U+00B7 separator. Keeps: the count, the range, the two cached-read forms, the two error
strings. Gains: a real file viewer inline; a truncation signal the terminal never had.

**Open.** None.

### B-17 · `Read` — images, PDFs and notebooks

**Terminal.** Four more forms, all one row (SPEC 41.16.7): `Read image (<size>)`,
`Read PDF (<size>)`, `Read <bold N> page(s) (<size>)` for a paginated PDF, and `Read <bold N>
cells` — or `No cells found in notebook`. No pixel is ever drawn: SPEC 41.17.9 establishes that no
inline-image protocol is emitted anywhere in the bundle (no iTerm2 `1337;File=`, no kitty
graphics, no Sixel) and that there is no `imageDisplay` or `inlineImages` setting. Images in the
message list are text placeholders, `[Image #N]` or `[Image]`, wrapped in an OSC 8 link to the
`file://` URL when the path resolves.

**Job.** Confirm the model actually received the picture, and how big it was.

**Wire.** **P, and this is the lane's largest free win.**
`docs/tui-parity/areas/15-16-17-file-bash-sandbox.md`: an image arrives as
`{type:"image", file:{base64, type, originalSize, dimensions}}` — and the bytes are on the wire
**twice**, once as a content block and once as `tool_use_result.file.base64`. A notebook arrives
as `{type:"notebook", file:{cells}}`. PDFs are the one caveat: `tool_use_result.pages` is removed
by `stripForCreation`, so page bytes live only in the content blocks, with `outputDir` pointing at
`<projectDir>/<sessionId>/tool-results/pdf-<uuid>/`. README §7 lists this under "*Where the GUI
exceeds the terminal*": "*render mermaid, inline images, screenshots, PDF pages and notebook
cells (terminal prints placeholders for all)*".

**afleet today.** `built`, minimally. `ToolResultForms.swift:117-118` gives `Read image` and
`Read PDF` with the body in `raw` — **without the size** the terminal shows, without the page
count, without the cell count, and without rendering anything.
`MessageRows.MessageText` (`:233-236`) renders attachments in prose as the tokens `[image]`,
`[<title>]` and `[document]`, which is the terminal's placeholder behaviour reproduced in a window
that does not need it.

**GUI form.** Region: Timeline row, expanded body. This is where a GUI stops imitating.

```
▎ 📄 Read   ui/mock.png                                     18:42:09
▎ Read image · 1024 × 768 · 240 KB
▎ ┌──────────────────────┐
▎ │                      │   ← the actual image, max 220pt tall,
▎ │      thumbnail       │      click to open in the Files panel
▎ └──────────────────────┘
```

- **Image**: headline `Read image · <W> × <H> · <size>` (the terminal has only the size; the wire
  has `dimensions`). Body: the decoded thumbnail, capped at ~220pt, click-to-open in the Files
  panel, right-click to copy or save.
- **PDF**: headline `Read PDF · <N> pages · <size>`. Body: a horizontal strip of page thumbnails
  from the content blocks, click to open `outputDir` in the Files panel.
- **Notebook**: headline `Read <N> cells`. Body: the cells as a stack of source/output pairs —
  README §7 asks for exactly this ("*a notebook view for `NotebookEdit`*"). Keep
  `No cells found in notebook` verbatim.
- Replace `[image]` / `[document]` prose tokens with an inline thumbnail chip.
- Keep the size in every headline; it is the terminal's only quantitative fact here and it is the
  one that tells you a screenshot was pasted at 8 MB.

**Drops / keeps / gains.** Drops: `[Image #N]` placeholders, the OSC 8 `file://` wrapper. Keeps:
the four headlines and their counts and sizes; `No cells found in notebook`. Gains: the picture.

**Open.** Should a decoded image be cached to disk or held in memory? A long session with fifty
screenshots is real. Suggest: thumbnail in memory (LRU), full bytes re-decoded on demand from the
record.

### B-18 · `Edit`

**Terminal.** The result is a summary of the patch (SPEC 41.16.7):
`Added <bold N> lines` alone, `Removed <bold N> lines` alone, or
`Added 5 lines, removed 3 lines` together — note the positional capitalisation, `R` when it stands
alone and `r` when it follows. Pluralisation is `> 1`, so `1 line`. Rejection is
`User rejected update to <bold path>` in `subtle`. Whether the *diff itself* is drawn is decided
by `wWe`'s four-way selection (SPEC 41.16.8): a `previewHint` wins outside condensed/verbose; a
`condensed` style returns the summary for any file; `collapsed` plus nonverbose returns the summary
plus the expand affordance; **everything else renders the full diff**. So in the ordinary case the
terminal *does* show a diff, folded, with `(ctrl+o to expand)`. The somersault clone byte-verified
the header at `cli.pretty.js` for 2.1.220 including the positional capitalisation, and recorded
that "*The 24-row cap is gone — upstream caps nothing*"
(`CC-to-SDK/docs/parity/tui-ux.md` §2 row 11).

**Job.** See what changed, immediately, without leaving the conversation.

**Wire.** **P, exactly.** `docs/tui-parity/areas/15-16-17-file-bash-sandbox.md`: `tool_use_result`
carries `structuredPatch: [{oldStart, oldLines, newStart, newLines, lines}]` plus `oldString`,
`newString`, `originalFile` (**not** blanked), `userModified`, `replaceAll`, `gitDiff?` and
`staleRecovered?` — "*exactly the jsdiff shape the TUI renders.*"

**afleet today.** `built`, and this is the biggest single loss in the lane.
`ToolResultForms.swift:131-143` produces `Edited` / `Added N line(s)` / `Removed N line(s)` /
`Added N line(s), removed M line(s)` with the path as `detail` — and sets **`raw` to nothing**.
There is nothing to expand. afleet owns a diff renderer,
`App/Decisions/AttributedDiffRenderer.swift`, but its only reachable call chain is
`DiffView` → `ToolInputView` → `PermissionCardView:346,351` → `DecisionCardView` → three hosts
including `App/Timeline/Rendering/Rows/DecisionRow.swift:81`. So a diff appears in the timeline
only inside a **pending permission card** — before the edit. After the edit the user sees a count.
Filed as tracker 137 (`docs/tech-debt-tracker.md:1880-1887`): "*A tool row's diff is a count, not
a diff.*"

**GUI form.** Region: Timeline row, expanded body. Route `tool_use_result.structuredPatch` into the
`Edit` form's structured slot (B-14) and render it with the existing renderer. See B-40 for the
diff's own form. Keep the terminal's summary as the collapsed headline **verbatim**, positional
capitalisation and all, with `+N −M` as a coloured chip beside it. Keep `User rejected update to
<path>` verbatim (afleet already has it, `:75`). `[exceeds]` Add a `Revert this edit` hover action
— afleet has checkpoints (`fileCheckpointingEnabled`) and the file path, and the terminal has no
per-edit undo at all. `[exceeds]` Add `Open in Files panel at line <newStart>`.

**Drops / keeps / gains.** Drops: `previewHint`, the `condensed`/`collapsed` style predicates
(afleet has one fold rule, B-06). Keeps: the summary sentence with its capitalisation trick, the
rejection copy, the diff itself. Gains: the diff *after* the edit, not only before it; revert;
jump to the changed line.

**Open.** None. This is the highest value-per-cost item in the lane.

### B-19 · `Write`

**Terminal.** `Wrote <bold N> <unit> to <bold path>` with an optional suffix
` — previous content replaced (no diff shown)`, a **10-line** syntax-highlighted preview of the
new content, and the overflow affordance (SPEC 41.16.7). The rejected form draws a 10-line preview
too. The clone recorded that the preview is the first 10 lines followed by a bare `… +N lines`
with **no expand affordance and no count header**, and that an unknown extension renders plain,
not dim (`CC-to-SDK/docs/parity/tui-ux.md` §2 row 16).

**Job.** Confirm a new file was created and glance at what went into it.

**Wire.** P. Same `structuredPatch` payload as `Edit`; the inventory adds that the
` — previous content replaced (no diff shown)` suffix corresponds exactly to
`originalFile === null`, which happens when the previous content exceeded **10 MB**
(`docs/tui-parity/areas/15-16-17-file-bash-sandbox.md`).

**afleet today.** `built`. `ToolResultForms.swift:146-150`: `Wrote N line(s) to <filePath>` with
`input.content` in `raw`. So the preview exists and is unbounded rather than 10 lines — better.
Missing: the ` — previous content replaced (no diff shown)` suffix, and the preview is
`.caption.monospaced()` with no highlighting (the highlighter exists,
`TimelineRendering.CodeHighlighter.shared:953`, but only markdown code fences reach it).

**GUI form.** Region: Timeline row. Keep the headline verbatim including the suffix — it is the
only signal that a large file was overwritten with no diff available, and it is derivable from
`originalFile === null`. Route the preview through `CodeHighlighter` with the language from the
file extension (afleet already has `styling(code:language:)` at `TimelineRendering.swift:1026`).
Fold at the B-06 budget, not 10 lines, and always show the count — the terminal's bare `… +N lines`
with no affordance is a bug-shaped behaviour, not a design. `[exceeds]` `Open in Files panel` on
the path; when `originalFile` is present, offer `Show diff` as well as the preview, since a `Write`
over an existing file *is* a diff and the terminal never shows one.

**Drops / keeps / gains.** Drops: the 10-line cap, the affordance-less overflow marker. Keeps: the
headline, the unit pluralisation, the replaced-content suffix, the preview. Gains: syntax
highlighting; a diff for an overwrite.

**Open.** None.

### B-20 · `MultiEdit` — not a rendered tool in 2.1.263

**Terminal.** Nothing. `MultiEdit` has **no registry row** and **no side-table entry** in 2.1.263.
The name survives only in the progress-verb map and in permission rule sets
(`cli.pretty.js:419941`, `:675444`, `:735641` — verb and permission tables only, no renderer). A
2.1.263 session therefore never draws a `MultiEdit` result.

**Job.** Historically: apply several edits to one file and report them as one change.

**Wire.** T by absence. Nothing on the wire produces it because the tool is not registered.

**afleet today.** `superseded` — correctly, by not existing. `ToolResultForms` does not switch on
it and should not.

**GUI form.** None. The card exists so the map shows the full denominator and so nobody
re-implements a form for a tool that no longer ships. If a future version restores it, its GUI form
is `Edit` (B-18) with one diff per edit in the structured slot.

**Drops / keeps / gains.** Drops: everything. Keeps: nothing. Gains: nothing.

**Open.** None.

### B-21 · `NotebookEdit`

**Terminal.** `Updated cell <bold n>:` followed by the new source, syntax-highlighted, at
`marginLeft: 2` (SPEC 41.16.7). Rejection is `User rejected <operation> <path>`
(`cli.pretty.js:850111`, verified — note the shape differs from `Edit`'s, which has a `to`).

**Job.** See which cell changed and what is now in it.

**Wire.** R, with rich material. The notebook's cells arrive under
`{type:"notebook", file:{cells}}` for a read (`areas/15-16-17-file-bash-sandbox.md`); the edit's
input and result are the ordinary `tool_use` / `tool_use_result` pair. README §7 asks explicitly
for "*a notebook view for `NotebookEdit`*".

**afleet today.** `undesigned`. Not in `ToolResultForms`'s switch, so it renders as
`Done · N lines` from the generic form (`:238`). Named in tracker 136.

**GUI form.** Region: Timeline row. Headline `Updated cell <n>` plus the cell type
(`code` / `markdown`) and the edit mode (`replace` / `insert` / `delete`) as chips. Body: the cell,
rendered the way a notebook renders it — code cells through `CodeHighlighter`, markdown cells
through the markdown pipeline (B-48). `[exceeds]` For a replace, show a diff of the cell rather
than only the new source; `structuredPatch`-equivalent data is derivable from the input's
`old_string`/`new_string`. `[exceeds]` `Open notebook in Files panel at cell n`. Keep the
`Updated cell <n>` headline and the rejection copy verbatim.

**Drops / keeps / gains.** Drops: `marginLeft: 2`. Keeps: the headline, the highlighted cell
source. Gains: a real cell rendering, a cell-level diff, navigation into the notebook.

**Open.** Does afleet's Files panel render `.ipynb` at all today? If not, the `Open notebook`
action is a dependency on C7.5, not on this card.

### B-22 · `Bash` — the command header and the completed result

**Terminal.** The command header truncates to **2 lines and 160 characters**
(SPEC 41.23.1 override table). The completed body, when there was neither stdout nor stderr nor a
cwd-reset warning, ends in one of **four** states, tested in this order (SPEC 41.16.7):
a `backgroundTaskId` gives `Running in the background (↓ to manage)`; otherwise a non-empty
`returnCodeInterpretation` is displayed as-is and **wins over both remaining states**; otherwise
`noOutputExpected` gives `Done`; otherwise `(No output)`. An image in the output becomes
`[Image data detected and sent to Claude]`. Queued is `Waiting…`; running is `Running…`.

**Job.** Know whether the command worked, and read its output.

**Wire.** P for everything in this card. `docs/tui-parity/areas/15-16-17-file-bash-sandbox.md`
gives `returnCodeInterpretation` its own row with the four observed values —
`No matches found`, `Files differ`, `Condition is false`,
`Some directories were inaccessible` — plus `noOutputExpected`, `staleReadFileStateHint`, and a
`gitOperation` object `{commit?, push?, branch?, pr?}` whose `.describe()` reads "*Client-facing —
lets clients render git activity without re-parsing stdout; **not surfaced to the model***".
One trap recorded there and independently reproduced by the clone: "*`is_error` is the
`interrupted` flag, **not** the exit code*", and no numeric exit code appears on the wire at all
(`CC-to-SDK/docs/parity/tui-ux.md` §2 row 14, "*P94 correction, confirmed on 0.3.220*").

**afleet today.** `built`, three of four states. `ToolResultForms.swift:159-165`:
`Running in the background`, `(No output)`, and `Done` with a detail of `N line(s) of output` and
the body in `raw`. Missing: `returnCodeInterpretation` — which is the one that carries meaning
(`No matches found` is a very different row from `Done`) — the `noOutputExpected` distinction, and
`[Image data detected and sent to Claude]`. The command itself is the header subject
(`ToolCallRow.swift:63-73`, `.font(.caption.monospaced()).lineLimit(2)`), which matches the
terminal's 2-line clip.

**GUI form.** Region: Timeline row. Keep the four states in the terminal's precedence order and
add the missing two strings verbatim; `returnCodeInterpretation` in particular should be the
headline when present, because it is the engine telling you what a non-zero exit *meant*.
Deviations: (a) drop the 160-character clip on the command — show the whole command, wrapped, in
monospace, with a `Copy command` hover action; a window has the room and a truncated command is
useless for re-running. (b) `[exceeds]` Render `gitOperation` as a chip row — `committed a1b2c3d`,
`pushed to origin/main`, `opened PR #412` with the PR as a link into the GitHub panel. The wire
carries it, the model never sees it, and the terminal only uses it inside cluster rows (B-12).
(c) `[exceeds]` `Re-run in the Terminal panel` on the hover menu: afleet has GhosttyKit panes and
the cwd; the terminal user has to retype.

**Drops / keeps / gains.** Drops: the 2-line/160-char header clip, `↓ to manage` as copy. Keeps:
the four states and their order, `Done`, `(No output)`, `Waiting…`, `Running…`. Gains:
`returnCodeInterpretation` surfaced, git activity as chips, re-run.

**Open.** None.

### B-23 · `Bash` — live output, background and the sandbox badge

**Terminal.** While a foreground command runs, the terminal draws its **last five wrapped rows**
of output plus a footer of `+N lines` or `~N lines`, a duration/timeout badge and an optional byte
size; with no preview text yet it draws `Running… ` plus the badge alone (SPEC 41.16.7). The
preview window is built newest-line-first against the **wrapped** row count with
`var M = 5, U = 5` — five display rows, five gutter columns, wrap width `max(1, columns − 5)` — and
a line that does not fit contributes only its **last** rows and marks the preview `clipped`.
Verbose skips the preview entirely. The badge renders `(timeout 2m)`, `(12s · timeout 2m)` or
`(12s)`. Internally the terminal polls the output file every **1000 ms** and tails **4096 bytes**.
Backgrounding is `ctrl+b`; a sandboxed call renders under the `userFacingName` `SandboxedBash`.

**Job.** Watch a long command work, and know it has not hung.

**Wire.** **D — the largest genuine gap in the lane, measured twice.**
`docs/tui-parity/areas/15-16-17-file-bash-sandbox.md`: "*Not on the wire. `tool_progress` is
dropped by filter `Cu` and, when re-injected, is gated on `CLAUDE_CODE_REMOTE` or
`CLAUDE_CODE_CONTAINER_ID`. Worse: the published `tool_progress` schema has **no output field at
all** — only `tool_use_id`, `tool_name`, `elapsed_time_seconds`, `task_id`, `heartbeat`,
`subagent_*`.*" afleet's probe 11
(`docs/tui-parity/evidence/2026-09-03-control-request-shapes.md`) drove a five-second five-line
loop and got exactly one frame carrying `elapsed_time_seconds: 3` and nothing else. The somersault
clone reached the same verdict independently from probes `84-bash-stdout-background.ts` and
`100-tool-progress-stream.ts`, and responded by **cutting** its `(Ns · N lines)` suffix and adding
a guard cell asserting it never appears (`CC-to-SDK/docs/parity/tui-ux.md` §2 row 31, F3 section).
`ctrl+b` backgrounding is also **D**: "*the wire models the state but offers no way to cause it.*"

Three things in this card are **P**, and they are the way out.
1. **`persistedOutputPath` / `persistedOutputSize`.** The inline cap is `BASH_MAX_OUTPUT_LENGTH`,
   default 30,000 bytes, ceiling 150,000, read from the start; overflow is copied to
   `<sessionStore>/<sessionId>/tool-results/<taskId>.txt` (64 MiB cap) framed by
   `<persisted-output>` / `Output too large (<size>). Full output saved to: <path>` /
   `Preview (first 2000 chars):`.
2. **Background bash**, fully: the result text
   `Command running in background with ID: <id>. Output is being written to: <path>. …` plus
   `backgroundTaskId`, `backgroundedByUser`, `backgroundedByTurnAbort`,
   `backgroundedToDeliverMessage`, `timedOutAfterMs`, `backgroundEndsWithFinalResponse`.
3. **The stall watchdog**: after 45 s without growth, if the last 1024 bytes match one of seven
   interactive-prompt regexes, a `task_notification` fires — "*the only 'this command needs a TTY'
   surface that exists.*"

The sandbox badge is **D** (`SandboxedBash` requires re-implementing a predicate and an excluded
-command list; there is no wire signal that a specific call ran sandboxed), but
`<sandbox_violations>` is **P**: the terminal strips it, the wire keeps it, with line prefixes
`deny file-read-data …`, `deny network-outbound <host>:<port> (<reason>)` and
`deny http-request GET <url> (<reason>)`.

**afleet today.** `built` with the limitation recorded in source.
`ToolResultForms.swift:152-157` carries the comment: "*The live 'last five lines while running'
the terminal shows is not available here: parity §41.16.7 records that `tool_progress` frames are
emitted only under `CLAUDE_CODE_REMOTE`*". C6.1 §8 states the intended route: "*Bash's live output
is the `TaskOutputTailer`'s*" (`2026-09-08-c6.1-timeline-renderer.md:447-452`). Root spec §7.3 says
the same at the architecture level: "*no Bash output is on the wire under any flag (Parity F-23),
so live shell output is read from the task output file.*" So the tailer is designed; the running
row today shows `Running…` and nothing else (`:84`, `:89`).

**GUI form.** Region: Timeline row while running; Terminal panel for the escape hatch. Three
layers, in order of what is available.

1. **Tail the file.** When `persistedOutputPath` or a background task's output path is known,
   tail it and draw the last lines live. This is strictly better than the terminal's five rows: a
   GUI row can hold twelve, and it can scroll.
2. **When there is no path, be honest.** Draw the elapsed timer and the timeout badge verbatim
   (`12s · timeout 2m`) plus one dim line: `Output arrives when the command finishes`. Do **not**
   draw an empty five-line box that never fills — that is the terminal's shape without the
   terminal's data, and it reads as a hang.
3. `[exceeds]` **Surface the watchdog.** When the `task_notification` fires, turn the row into a
   warning: `Waiting for input — this command may need a terminal`, with
   `Open in Terminal panel` as the action. The terminal has no such affordance.

Sandbox: `[exceeds]` render `<sandbox_violations>` as a collapsible list under the result with the
three prefixes parsed into `file` / `network` / `http` rows. The terminal strips them entirely, so
a sandboxed denial is currently invisible to a terminal user and can be visible to an afleet user.
The `SandboxedBash` badge itself: skip it — the badge is derived state the wire does not carry, and
inventing it risks being wrong about a security-relevant claim.

**Drops / keeps / gains.** Drops: the five-row newest-first preview algorithm, the 1000 ms/4096-byte
poll, `ctrl+b`, the `SandboxedBash` name. Keeps: the elapsed/timeout badge copy, the background
result text, the `+N lines` count. Gains: a scrollable tail; an explicit "no live output" state
instead of a fake one; the stall watchdog as a visible prompt; sandbox violations.

**Open.** Owner call: is tailing the persisted output file acceptable, given it is afleet reading a
file the CLI owns? Root spec §7.3 already commits to it, so this is a confirmation, not a new
decision.

### B-24 · `TaskOutput` and background task rows

**Terminal.** `TaskOutput` has four states (SPEC 41.16.7). No task → `No task output available`. A
`local_bash` task delegates its synthesised stdout/error to the `Bash` renderer. A successful
`local_agent` renders `Read output (<expand chord> to expand)` — verified at
`cli.pretty.js:417410` — unless verbose, where it expands the description, the prompt, the harness
header, the result and the error. Still-running, timed-out and not-ready tasks use readiness
messages (`Task is still running…`, `Task not ready`). A `remote_agent` renders description and
status plus verbose output or an expand hint; every other task renders description and status and
**at most the first 500 output characters**. `TaskStop` renders `<displayed command> · stopped`,
with the ellipsis form only when truncation changed the displayed command.

**Job.** Check on work that is running somewhere other than in front of you.

**Wire.** R for the rendering; the task frames themselves are P
(`docs/tui-parity/areas/20-tasks-background.md`; `docs/tui-parity/areas/41-tui-rendering.md`
§41.16.7 lists the four strings). One structural note from `areas/20-tasks-background.md`:
Task-tool rows are "*absorbed silently — no visible tool-use row at all; 'pops out on error'*",
with `is_error` as the trigger, and the absorbing wrapper covers `TodoWrite` and the
`TaskCreate`/`Get`/`Update`/`List` family.

**afleet today.** `built` as a row kind, `undesigned` as a result form.
`App/Timeline/Rendering/Rows/TaskRunRow.swift` draws a task run with an author of
`agentType ?? kind.wire`, a status badge, and `activeForm(of:)` (`:35-42`) giving
`description` or `Running…` / `summary ?? "Done"` / `Failed` / `Stopped`; the output file is always
drawn as a `FileLinkLabel`, and `TaskCardSeam` (`:55-114`) mounts C6.3's `TaskCardView` when a
context exists. The `TaskOutput` *tool* is not in `ToolResultForms`'s switch, so its result renders
as `Done · N lines`. Named in tracker 136.

**GUI form.** Region: Timeline row plus the **Agents panel**. Keep afleet's `TaskRunRow`; it is
already richer than the terminal's four strings. Two additions.

1. Give `TaskOutput` its own form that **delegates**: `local_bash` → the `Bash` form (B-22/B-23),
   `local_agent` → the `Agent` form (B-29). That is exactly what the terminal does and it removes a
   whole class of "unnamed result".
2. `[exceeds]` Replace `Read output (ctrl+o to expand)` and the 500-character cap with the tailed
   output file (B-23) and an `Open in Agents panel` action. The terminal's verbose expansion of
   description, prompt and harness header should be **always visible** in the row's disclosure, not
   verbose-gated: a subagent's prompt is the single most useful thing about a task run and afleet
   has a whole panel for it.

Keep `TaskStop`'s `<command> · stopped` verbatim, and keep the terminal's silent-absorption rule
for task-management tools: `TaskCreate`/`Update`/`List` should not draw rows unless they error.

**Drops / keeps / gains.** Drops: the 500-character cap, the expand chord copy, the verbose gate on
prompt/description. Keeps: the four readiness strings, delegation by task kind, silent absorption,
`· stopped`. Gains: live output; the prompt always visible; a panel to open into.

**Open.** None.

### B-25 · `Glob`

**Terminal.** `Glob` shares one renderer with `Grep` (SPEC 41.16.7). Its form is
`Found <bold N> file(s)`, singularised by slicing the trailing `s` when the count is 1, so a zero
result renders `Found 0 files` — the literal `No files found` exists only as **model-facing**
`tool_result` content, emitted when `filenames.length === 0`. The user and the model see different
wording for the same empty result. Errors are `File not found` and `Error searching files`.

**Job.** Know how many files matched before deciding to read the list.

**Wire.** P. `docs/tui-parity/areas/15-16-17-file-bash-sandbox.md`:
`{filenames, numFiles, durationMs, truncated, totalMatches?, countIsComplete?}` — so `truncated`
and `durationMs`, which the terminal never shows, are available.

**afleet today.** `built`. `ToolResultForms.swift:183-184` gives `Found N file(s)` with the body in
`raw`. One recorded quirk: `Glob` never reaches the `content`/`count` arms because the mode is read
only from `.grep` input (`:174`) — which is correct, since `Glob` has no modes.

**GUI form.** Region: Timeline row. Keep `Found N files`. `[exceeds]` Render the expanded body as a
**list of file links** (afleet has `FileLink.swift`) rather than a text blob, so each result opens
in the Files panel. Add a `Truncated` chip when `truncated` is true — the terminal shows a count
that may be a lie and never says so. Show `durationMs` only when it is large (> 2 s), as a dim
suffix. Keep both error strings.

**Drops / keeps / gains.** Drops: the trailing-`s` slicing trick (use proper pluralisation), the
model/user wording split. Keeps: `Found N files`, both errors. Gains: clickable results, a
truncation signal, a slow-glob signal.

**Open.** None.

### B-26 · `Grep`

**Terminal.** Three modes on the shared renderer (SPEC 41.16.7): `content` reports lines, `count`
reports matches and files, `files_with_matches` (the default) reports files. The sentence is
`Found <bold N> <label>` with a secondary ` across N files`. The empty case is subtle: `Grep` emits
`No files found` to the model only when the page is not an empty offset into a positive total; with
pagination active, a positive `totalFiles` and a zero current page, it emits
`No entries at this offset. [Showing results with pagination = <N>]` instead. The collapsed form is
one row plus the affordance; the verbose form indents the body by 5.

**Job.** Find where something is, and know whether the search was worth opening.

**Wire.** P, richer than shown.
`{mode, numFiles, filenames, content?, numLines?, numMatches?, totalFiles?, totalLines?,
appliedLimit?, appliedOffset?}` (`areas/15-16-17-file-bash-sandbox.md`). The inventory adds that
the terminal "*flattens all symlink refusals to `Error searching files`; the GUI can surface the
specific one.*"

**afleet today.** `built`, all three modes. `ToolResultForms.swift:176-184`: `Found N line(s)` for
`content`, `Found N match/matches` with `across N file(s)` for `count`, `Found N file(s)` by
default; `matchTotal` parses `<path>:<n>` lines (`:291-296`). The pattern is the header subject
(`ToolCallRow.swift:63-73`).

**GUI form.** Region: Timeline row. Keep all three sentences verbatim. Three GUI moves.

1. `[exceeds]` **Render `content` mode as grouped results**, the way every editor does: file
   heading, then `line: text` rows with the matched span highlighted, each row a link into the
   Files panel at that line. afleet already parses `<path>:<n>`; the display is the work.
2. `[exceeds]` Show `appliedLimit` / `appliedOffset` as a `Page 2 of N` chip when pagination is
   active, and keep the terminal's `No entries at this offset` copy for the empty-page case — it
   is the difference between "nothing matches" and "nothing on this page".
3. Surface the specific symlink/permission error instead of flattening to
   `Error searching files`.

**Drops / keeps / gains.** Drops: the 5-column verbose indent, the flattened error. Keeps: three
mode sentences, `across N files`, the pagination copy. Gains: grouped, clickable, highlighted
results; a page indicator; specific errors.

**Open.** None.

### B-27 · `WebFetch`

**Terminal.** `Received <bold size> (<status>)`, with `Fetching…` while in flight
(SPEC 41.16.7). `Agent` has a special web-fetch variant that renders `Received <size>` from the
summed UTF-8 byte length of the report's text blocks, and appends the full report in verbose.

**Job.** Confirm a page was fetched and how much came back.

**Wire.** R. `areas/41-tui-rendering.md` §41.16.7 row. The permission dialog's domain is
reconstructed host-side from `new URL(input.url).hostname`
(`areas/24-21-permissions-plan-questions.md`).

**afleet today.** `built`. `ToolResultForms.swift:196-200`: `Received <size> (<code>)` or
`Received <size>`, body in `raw`; running is `Fetching…` (`:86`). The URL is the header subject
(`ToolCallRow.swift:66`). This is a faithful, complete translation.

**GUI form.** Region: Timeline row. Keep as built. Two GUI-only additions.
`[exceeds]` Render the fetched content in the expanded body **as markdown** (the tool returns
markdown-converted page text) through the existing pipeline, rather than as monospaced plain text —
one line of routing, and it turns an unreadable blob into a readable page.
`[exceeds]` Make the URL open in the **Browser panel** rather than the system browser, since afleet
has one; Command-click keeps the system-browser behaviour via `LinkActivation`.

**Drops / keeps / gains.** Drops: nothing. Keeps: the headline, the status code, `Fetching…`.
Gains: readable content; in-app browsing.

**Open.** None.

### B-28 · `WebSearch`

**Terminal.** `Did <n> search(es) in <duration>`, with progress `Searching: <query>` and
`Found <n> results for "<query>"` (SPEC 41.16.7).

**Job.** Know what was searched for and how long it took.

**Wire.** **Split: D for the headline, P for something better.**
`docs/tui-parity/areas/46-19-48-37-chrome-web-enterprise-cloud.md`: "*`searchCount` and
`durationSeconds` are dropped*" — so `Did 3 searches in 4s` is **not** reconstructible. But the
tool result carries `Links: [{"title","url"}, …]` as JSON, which is **P**, and README §7 lists
"*WebSearch `Links` JSON*" under where the GUI exceeds. `page_age`, `encrypted_content` and the
snippets are dropped server-side.

**afleet today.** `built`, approximating. `ToolResultForms.swift:203-206` gives
`Did N search/searches` — **without the duration**, which is the honest response to the data gap,
though nothing records why. Running is `Searching: <query>` / `Searching…` (`:87-88`), which
matches canon.

**GUI form.** Region: Timeline row. Keep `Did N searches` and drop the duration permanently; add a
short note in the card, not the UI. `[exceeds]` Parse `Links` and render the expanded body as a
**result list** — title as a link, hostname and favicon beneath — instead of raw JSON. Each link
opens in the Browser panel. This is the terminal's blind spot: it has the JSON and prints a
sentence.

**Drops / keeps / gains.** Drops: ` in <duration>` (not on the wire). Keeps: the count sentence,
both progress strings. Gains: a clickable result list.

**Open.** None.

### B-29 · `Agent` — completion

**Terminal.** `Done (7 tool uses · 41.2k tokens · 3m 12s)` — three ` · `-joined parts built from
`totalToolUseCount`, `totalTokens` and `totalDurationMs` (SPEC 41.16.7). Two variants precede it:
the built-in `web-fetch` agent renders `Received <size>` outside transcript mode, and a cloud agent
(`status === "remote_launched"`) renders a launch line carrying the task id and session URL. The
somersault clone corrected its own census here: the completion is "*a gutter row with the bullet
suppressed*" (`CC-to-SDK/docs/parity/tui-ux.md` §2 row 17), and its data comes from a three-rung
ladder — sidecar, then `task_notification`, then derived from children.

**Job.** Know a subagent finished and what it cost.

**Wire.** R. `areas/41-tui-rendering.md` §41.16.7; `areas/18-agents-subagents.md` for the frames.
Grouping uses `parent_tool_use_id`, which is P; the layout is not
(`areas/11-14-query-loop-tool-interface.md`).

**afleet today.** `built`, partially. `ToolResultForms.swift:190-193` gives
`Done (N tool use(s))` or `Done` — **the token count and the duration are dropped**. Separately,
`ToolCallRow.isAgentChip` (`:23`) routes `name == "Agent"` away from the ordinary row into
`AgentChip.swift`, which draws a capsule with the agent type, a status and elapsed seconds
(`:154-165`), groups parallel agents by `message.id` into `Running 2 agents` (`:54-59`), and
navigates into the Agents tab — `.disabled(!content.canNavigate)` (`:176`), because a channel
opened from its files has a nil run id (tracker 187).

**GUI form.** Region: Timeline row (the chip) plus the Agents panel. Keep the chip; it is a better
form than the terminal's row and it is the afleet-native shape. Restore the two missing numbers:
the chip's completed state should read `Done · 7 tools · 41.2k tokens · 3m 12s`, matching canon's
three parts, because cost per subagent is the thing a fleet operator most wants and it is already
computed. Keep `Running 2 agents` (it is exactly the terminal's grouped-agent header). Keep the
`web-fetch` special case as `Received <size>` — it is a genuinely different job. For a cloud agent,
render the session URL as a link; teams and cloud are out of v1 scope (root spec §3) so this is a
one-line stub, not a surface.

**Drops / keeps / gains.** Drops: the gutter row shape, `⏺` suppression. Keeps: the three-part
`Done (…)` composition, the grouped header, the web-fetch variant. Gains: navigation into a panel;
per-agent cost visible without expanding.

**Open.** None.

### B-30 · `Agent` — progress and the backgrounded form

**Terminal.** Progress starts at `Initializing…` (SPEC 41.16.7). Under a height budget it collapses
to one line: `In progress… · <bold N> tool uses · <tokens>`. Otherwise, outside transcript mode, it
shows the **last three** filtered sub-messages footed by the overflow affordance; transcript mode
bypasses the collapse and retains **all** progress rows. Grouped agents render a header plus one
tree row per agent, each with a `⎿` status line reading `Initializing…`,
`Running in the background` or `Done`, drawn with `├ └ │ ┬ ┴` at `paddingLeft: 3`.

The backgrounded variant (`status === "async_launched"`) has two headlines and a conditional hint,
all keyed on transcript mode: outside it, the built-in `web-fetch` agent gives
`Fetching in background` and everything else `Backgrounded agent`; in transcript mode the headline
is always `Backgrounded agent`. The parenthetical is gated the same way and reads
`(↓ to manage, ctrl+o to expand)`, or `(↓ to manage)` when the task carries no prompt; in
transcript mode the prompt is rendered below the headline instead.

**Job.** Watch a subagent work without opening it, and get back to one you sent to the background.

**Wire.** R. Progress arrives as `agent_progress` frames; `areas/18-agents-subagents.md` covers the
frame set. The three-sub-message window and the height collapse are host policy.

**afleet today.** `built` as a chip with elapsed time (`AgentChip.swift:164-165`), `undesigned` for
progress content. No sub-messages are shown; the chip shows type, status and seconds. Root spec
§8.3 specifies the chip and the `Running N agents` group, not a progress feed.

**GUI form.** Region: the chip's disclosure, and the **Agents panel** for the full reading. The
terminal's whole design here is a height-budget negotiation — three sub-messages, collapse to one
line, expand in transcript mode — and afleet does not have that constraint, so translate the *job*
and not the mechanism.

- Collapsed chip: `Explore · 7 tools · 1m 04s` with a live spinner. This is the terminal's
  one-line collapse, and it should be the default.
- Chip disclosure: the last five sub-messages, live, scrollable. Not three, and not all.
- Agents panel: every progress row, the prompt, the description, the tree. This is the terminal's
  transcript-mode reading, given a permanent home. `[exceeds]` — the terminal has to swap screens.
- Backgrounded: keep `Backgrounded agent` and `Fetching in background` verbatim as the chip
  headline; replace `(↓ to manage, ctrl+o to expand)` with two hover actions,
  `Manage` (opens the Agents panel) and `Show prompt` (expands in place). Always show the prompt
  affordance when a prompt exists — the terminal hides it in one mode and shows it in another for
  layout reasons only.
- Keep the tree glyphs' *meaning* as B-01's left-rule nesting, not as `├└`.

**Drops / keeps / gains.** Drops: the three-message window, the height-collapse predicate, the
transcript-mode branching, `├└│┬┴`, `↓ to manage` as copy. Keeps: `Initializing…`,
`In progress… · N tool uses`, `Backgrounded agent`, `Fetching in background`, the per-agent status
line vocabulary. Gains: progress and conversation on screen together; a durable home for the full
feed.

**Open.** None.

### B-31 · `AskUserQuestion` — the answered echo

**Terminal.** The rejected form is `User declined to answer questions` followed by one line per
question (SPEC 41.16.7). The answered form is not a result renderer at all — the question card is
the surface, and what remains in the transcript is the tool result carrying the answers.

**Job.** After the fact, see what you were asked and what you chose.

**Wire.** P. `docs/tui-parity/areas/24-21-permissions-plan-questions.md`: it arrives as
`can_use_tool` with `requires_user_interaction: true` and `input = {questions, metadata?}`;
`answers` and `annotations` are stripped from the schema the host sees, and the schema mandates
that "*one-tap Approve/Deny must not be offered: the tool's approval card IS the user-interaction
surface*". Question previews are off by default for `sdk-`-prefixed clients unless
`CLAUDE_CODE_QUESTION_PREVIEW_FORMAT` is set — D with a workaround.

**afleet today.** The **card** is lane D's (root spec §8.4, Question card;
`App/Decisions/`). The **echo** — what the row looks like once answered — is `undesigned`:
`AskUserQuestion` is not in `ToolResultForms`'s switch, so an answered question collapses to
`Done · N lines`.

**GUI form.** Region: Timeline row, replacing the card in place once answered. Keep the terminal's
rejection copy verbatim (`User declined to answer questions`, then the questions). For the answered
case, the row should read `Answered: <question header> — <chosen option>`, with the full question
and every option in the disclosure and the chosen one marked. That is faithful to the terminal in
spirit — the terminal leaves the question visible in scrollback — and better in fact, because the
terminal's answered question is just a card that stopped being interactive.
`[exceeds]` `Change answer` is **not** offered: the tool result is already sent. Say so if the user
tries, rather than pretending.

**Drops / keeps / gains.** Drops: nothing. Keeps: the rejection copy and its per-question lines.
Gains: a durable, readable record of the choice.

**Open.** Does the answered echo belong to this lane or to lane D (decision cards)? The card is
D's; the post-answer row is a transcript row and is carded here. Orchestrator should dedupe.

### B-32 · `ExitPlanMode` and `EnterPlanMode`

**Terminal.** `ExitPlanMode` has three outcomes (SPEC 41.16.7). An empty or blank plan gives
`Exited plan mode`. `awaitingLeaderApproval` gives `Plan submitted for team lead approval`, an
optional `Plan file: <path>`, then `Waiting for team lead to review and approve...`. Otherwise:
`User approved Claude's plan`, an optional `Plan saved to: <path> · /plan to edit`, and the
rendered plan. Rejection is `User rejected Claude's plan:` in a **round box coloured `planMode`** —
the somersault clone byte-verified this literal including the ASCII apostrophe, and recorded that
it renders in `subtle`, not SGR dim (`CC-to-SDK/docs/parity/tui-ux.md` §2 row 27).
`EnterPlanMode` gives `Entered plan mode` plus an explanatory line. Note SPEC 41.16.4: plan mode
does **not** tint the input border.

**Job.** Mark the boundary where a plan was proposed and accepted or refused, and keep the plan
readable afterwards.

**Wire.** P (`areas/41-tui-rendering.md` §41.16.7 marks both `ExitPlanMode` and
`AskUserQuestion` rejection as P rather than R).

**afleet today.** `undesigned` as a result form; the plan **card** is lane D's
(root spec §8.4 lists a Plan card). `ExitPlanMode` is not in `ToolResultForms`'s switch, so the
post-decision row is `Done · N lines`. The clone recorded a residual worth carrying: canon prints
`⏺ Updated plan` then `⎿ /plan to preview`, and the clone prints neither header row.

**GUI form.** Region: Timeline row. Keep all six strings verbatim. The plan body should render
through the markdown pipeline (B-48) in the row's disclosure, expanded by default — a plan is prose
the user is meant to read, not tool output. `Plan saved to: <path>` becomes a `FileLink` opening in
the Files panel; drop the ` · /plan to edit` clause and replace it with an `Edit plan` action that
opens the file, since afleet has an editor and the terminal has a slash command. Keep
`User rejected Claude's plan:` and give it the terminal's boxed treatment as a bordered card in the
`planMode` accent — it is one of the few places the terminal draws a box, and the box is carrying
meaning. Team-lead approval is out of v1 scope (root spec §3) and gets the strings but no
interaction.

**Drops / keeps / gains.** Drops: `/plan to edit` as copy, the round-box glyphs. Keeps: all six
outcome strings, the accent colour's meaning, the plan body. Gains: a readable plan; an editable
plan file.

**Open.** Same dedupe question as B-31: the pending plan card is lane D's.

### B-33 · `Skill`

**Terminal.** Two shapes (SPEC 41.16.7). For `status: "forked"`: `Running in the background` when
backgrounded, otherwise `Done`. Otherwise `Successfully loaded skill` plus two **independently
optional** suffixes, ` · N tools allowed` and ` · <model>`.

**Job.** Know a skill was loaded, which model it will run under, and how much tool access it took.

**Wire.** P for the data, R for the rendering.
`docs/tui-parity/areas/30-29-32-plugins-skills-styles.md` gives the four result strings verbatim —
`Skill "<name>" launched (forked execution, running in the background).`,
`Skill "<name>" completed (forked execution).`,
`Loaded skill instructions (read-only): <name>…`, `Launching skill: <name>` — and adds the row that
matters most for this lane: the skill's **invocation echo** rides the wire as
`<command-message>`/`<command-name>`/`<command-args>` or `<skill-format>true</skill-format>`, with
the first carrying `sourceToolUseID`. The inventory's verdict: "*A GUI must do the same grouping or
the user sees a raw XML blob as a 'user message' — this is the single most visible skills
rendering task.*" See B-61.

**afleet today.** `undesigned`. Not in the switch; renders as `Done · N lines`. Named in
tracker 136.

**GUI form.** Region: Timeline row. Headline `Loaded skill <name>` with the model and tool-count
suffixes as chips rather than ` · ` text — `opus-5`, `12 tools`. Keep
`Running in the background` for the forked case and link it to the Agents panel.
`[exceeds]` The skill name should be a link that opens the skill's `SKILL.md` in the Files panel;
afleet knows the path from the skill listing. `[exceeds]` Show which tools were allowed, on hover,
rather than only the count — it is a permission fact and the terminal reduces it to a number.
Critically, the **echo** must be suppressed from the timeline as a user message (B-61); a card here
without B-61 leaves the XML visible.

**Drops / keeps / gains.** Drops: the ` · `-joined suffixes as text. Keeps: all four result strings,
the counts, the model. Gains: the skill file one click away; the allowed-tool list.

**Open.** None.

### B-34 · `LSP`

**Terminal.** One renderer with a noun table (SPEC 41.16.7): `goToDefinition` → definition(s),
`findReferences` → reference(s), `documentSymbol`/`workspaceSymbol` → symbol(s),
`goToImplementation` → implementation(s), `prepareCallHierarchy` → call item(s), `incomingCalls` →
caller(s), `outgoingCalls` → callee(s), `hover` with a positive count → `Hover info available`, and
an unknown operation → result(s). Counted forms read `Found <bold N> <noun>` and add
`across <bold M> files` **only when `M > 1`**. When either count is absent it renders the raw
result. The error is `LSP operation failed`.

**Job.** Confirm a code-navigation query found something, and how widely spread it was.

**Wire.** R for this renderer. Separately and importantly, the **diagnostics** attachment is
**D**: `docs/tui-parity/areas/33-34-43-44-ide-lsp-voice-artifacts.md` records that it is dropped by
filter `Cu`, "*the model sees `<new-diagnostics>…`, the host sees nothing*" — and adds the crucial
qualifier "*this is not a parity gap with the terminal, it is an absolute gap*", since the terminal
does not display it either. See B-43.

**afleet today.** `undesigned`. Renders as `Done · N lines`. Named in tracker 136.

**GUI form.** Region: Timeline row. Keep the noun table and both sentence forms verbatim, including
the `M > 1` rule for `across N files` — it is a small piece of good copy. Keep
`Hover info available` and `LSP operation failed`. `[exceeds]` Render the results as a list of
`file:line` links into the Files panel, exactly as B-26 proposes for `Grep`: an LSP result *is* a
navigation result and a list of links is its native form. `[exceeds]` For `hover`, render the hover
markdown in the disclosure instead of asserting that info is available and hiding it.

**Drops / keeps / gains.** Drops: nothing. Keeps: nine nouns, both sentence forms, the `M > 1`
rule, the error. Gains: navigable results; hover content shown.

**Open.** None.

### B-35 · `ReportFindings`

**Terminal.** SPEC 41.16.5 lists `ReportFindings` in the eager renderer table but **§41.16.7
documents no form for it** — a spec gap this study fills. The renderer is real, structured and
width-adaptive (`cli.pretty.js:834705-834745`, verified): findings are grouped by file, each drawn
as `● <line> [<category>] <summary>` with `[skipped]` / `[no change needed]` suffixes, a `✓` in
`success` when `outcome === "fixed"`, and a severity colour from the verdict — `CONFIRMED` → error,
`PLAUSIBLE` → warning — with the category column capped at **24 columns** and a width-conditional
layout switch. The model-facing result is only `No findings reported.` or
`<n> finding(s) reported.` (`cli.pretty.js:757253`, verified).

**Job.** Read a review's findings where the review happened.

**Wire.** **P for the data, and the data is the only copy.**
`docs/tui-parity/areas/24-21-permissions-plan-questions.md`: the input schema is `level` plus
`findings[≤32]`, each `{file, line?, summary, short_summary?≤60, failure_scenario, category?≤40,
verdict?, outcome?}`, and — the load-bearing sentence — "*The findings **never re-enter the
conversation** (the tool result is only `No findings reported.` / `<n> findings reported.`), so the
`tool_use` **input** is the GUI's only copy.*" Gated on `CLAUDE_CODE_REPORT_FINDINGS`. README §7
asks for "*a findings panel for `ReportFindings`*".

**afleet today.** `undesigned`. Renders as `Done · N lines`, and since the findings are in the
*input* rather than the result, `raw` shows the count string and nothing else — the findings are
invisible.

**GUI form.** Region: Timeline row for the summary, **Panel** for the reading. The row reads
`<n> findings · <k> confirmed · <j> fixed` with a severity-coloured dot. The disclosure renders the
terminal's own grouping — file heading, then one row per finding: line, category chip, summary,
with `verdict` as the colour and `outcome` as a state (`fixed` gets `✓`, `skipped` and
`no change needed` get their suffixes verbatim). `[exceeds]` Each finding's `file`/`line` is a link
into the Files panel; `failure_scenario` — which the terminal never shows at all — goes in the
finding's own disclosure. `[exceeds]` A `Findings` view in the Activity panel aggregates findings
across channels, which is what a fleet operator actually wants and which the terminal structurally
cannot offer.

**Drops / keeps / gains.** Drops: the 24-column category cap, the width-conditional layout switch,
`●`. Keeps: grouping by file, the category and line columns, the verdict colours, the outcome
suffixes verbatim. Gains: `failure_scenario` visible; findings clickable; findings queryable across
channels.

**Open.** Is `CLAUDE_CODE_REPORT_FINDINGS` set in afleet's spawned environment? If not, this card
is dormant until it is — an environment decision, not a rendering one.

### B-36 · `memory_write` and the memory tools

**Terminal.** `memory_write` renders a header plus **10 lines capped at 200 characters each**, then
`… +N more lines` (SPEC 41.16.7, and the fold override table in 41.23.1). It is one of the nine
lazy table entries.

**Job.** See what was written to memory without opening the memory file.

**Wire.** R (`areas/41-tui-rendering.md` §41.16.7 row).

**afleet today.** `undesigned`. Renders as `Done · N lines`. Named in tracker 136.

**GUI form.** Region: Timeline row. Headline `Wrote to memory · <path>` with the written content in
the disclosure, rendered as **markdown** (memory files are markdown) rather than clipped lines.
Drop the 200-character per-line clip — it exists to protect an 80-column terminal. `[exceeds]` The
memory path is a `FileLink` into the Files panel, so a user can see the whole memory file, which
the terminal never offers. Memory reads and searches appear only inside cluster rows in the
terminal (B-12's `memorySearchCount` / `memoryReadCount` / `memoryWriteCount` counters, and the
verbs `Recalled N memories`, `Searched memories`, `Wrote N memories`); keep those counters in
afleet's cluster row and keep the verbs verbatim.

**Drops / keeps / gains.** Drops: the 10-line / 200-character clip. Keeps: the header, the cluster
verbs and counters. Gains: markdown rendering; the memory file one click away.

**Open.** None.

### B-37 · MCP tools, MCP progress, and the Chrome / computer-use families

**Terminal.** Four related renderers (SPEC 41.16.5–41.16.7).

*Generic MCP*, reached through `uiTableKey: "mcp"`: `[Image]` per image block, `(No content)` for
an empty result, and an oversize warning.

*MCP progress*: no progress row, no data, or an undefined progress value → `Running…`; with a
positive total, a **20-column percentage bar**, with a sanitised `progressMessage` as a separate
dim line above it when supplied; without a positive total, the sanitised `progressMessage` or the
fallback `Processing… <n>`.

*MCP resource tools*: `ListMcpResourcesTool` → `(No resources found)` else pretty JSON;
`ReadMcpResourceDirTool` → `(Empty directory)` else pretty JSON; `ReadMcpResourceTool` →
`(No content)` else pretty JSON.

*`claude-in-chrome`*: returns `null` for a non-object result; in **verbose** mode it falls through
to the generic MCP renderer *before* verb dispatch; only non-verbose mode maps 17 verbs to a dim
one-liner (`navigate` → `Navigation completed`, `computer` → `Action completed`, `find` →
`Search completed`, `read_page` → `Page read`, and thirteen more), and the `switch` has **no
default**, so an unmatched verb renders nothing. The tag adds a `[View Tab]` hyperlink.
*`computer-use`*: 14 verbs (`screenshot`/`zoom` → `Captured`, the five click verbs → `Clicked`,
`type` → `Typed`, `key`/`hold_key` → `Pressed`, `scroll` → `Scrolled`, `left_click_drag` →
`Dragged`, `open_application` → `Opened`), and it returns `null` **in verbose mode** — the parity
inventory flags the inversion explicitly: "*Note the inversion: verbose hides these.*"

**Job.** Give a tool nobody wrote a renderer for a sentence anyway, and show progress on a slow one.

**Wire.** Mixed, and the mix matters.
- Generic MCP results: P, including large-result handling — persisted to
  `mcp-<server>-<tool>-<ts>` or replaced by `[OUTPUT TRUNCATED - exceeded 25000 token limit]`, with
  `files_persisted` frames naming the files (`areas/31-27-mcp-hooks.md`).
- **MCP progress: D.** "*MCP progress notifications reach the host only if it is the MCP
  transport*" (`areas/41-tui-rendering.md` §41.16.7). So the percentage bar is reconstructible only
  for servers afleet itself hosts.
- MCP tool descriptions and input schemas: **D** — `mcp_status.tools` carries only
  `{name, annotations}`, "*annotations carries `readOnly` at most; no descriptions and no input
  schemas*" (`areas/31-27-mcp-hooks.md`).
- Chrome and computer-use verb maps: R.

**afleet today.** `built` for the generic family, `undesigned` for the rest.
`ToolResultForms.swift:227-231` keys on `mcp__<server>__<tool>` and gives `(No content)` for an
empty body or `<tool> · <server>` with a detail of `N line(s)`. There is no progress bar, no
resource-tool form, and no Chrome or computer-use family — all named in tracker 136.

**GUI form.** Region: Timeline row.

1. Keep the generic family and keep `(No content)` verbatim. Add `[Image]` → an actual inline
   thumbnail (B-17's rule), since an MCP image block carries bytes.
2. **Progress**: implement the bar for servers afleet hosts (its own in-process
   `send_user_file` server, at minimum) and fall back to `Running…` plus elapsed everywhere else.
   Keep `Processing… <n>` verbatim for the no-total case. Do not draw a bar you cannot fill.
3. **Resource tools**: replace pretty JSON with a small tree view, and keep
   `(No resources found)` / `(Empty directory)` / `(No content)` verbatim.
4. **Chrome and computer-use**: implement both verb maps as one shared form (they are two tables
   and a switch, and they turn thirty-one meaningless `Done` rows into sentences). Two corrections
   to canon, both named: render the verb line **regardless of verbosity** — the terminal's
   inversion (verbose hides computer-use, verbose bypasses Chrome) is a code accident, not a
   design; and give the switch a **default** so an unknown verb renders the verb name rather than
   nothing. `[exceeds]` For `screenshot`/`zoom` → `Captured`, render the screenshot; the bytes are
   in the result. `[View Tab]` becomes a link into the Browser panel.
5. Handle `[OUTPUT TRUNCATED - exceeded 25000 token limit]` as a chip, and use `files_persisted` to
   offer `Open persisted output` — the terminal has neither.

**Drops / keeps / gains.** Drops: the verbose inversions, the no-default switch, pretty-printed
JSON as a display form, the 20-column bar width. Keeps: all thirty-one verb strings, the four
`(No …)` strings, `Processing… <n>`, `Running…`. Gains: screenshots drawn; a resource tree; a
truncation signal; persisted output reachable.

**Open.** How many MCP servers does a typical afleet session host itself? That determines whether
the progress bar is worth building at all.

### B-38 · The long tail: scheduling, worktrees, notifications, messaging and list tools

**Terminal.** Fourteen tools sharing one shape — a single line of specific copy (SPEC 41.16.7).

| Tool | Rendered form |
|---|---|
| `TaskStop` | `<displayed command> · stopped` (with `…` only when truncation changed the command) |
| `Monitor` | `Monitor started · task <id> · persistent` or `· timeout Ns` |
| `CronCreate` | `Scheduled <bold id> (<schedule>)` |
| `CronDelete` | `Cancelled <bold id>` |
| `CronList` | `No scheduled jobs`, else one row per job with `(recurring)` / `(one-shot)` / `[session-only]` |
| `RemoteTrigger` | `HTTP <status> (<N> lines)` |
| `EnterWorktree` | `Switched to worktree on branch <bold b>` plus a dim path |
| `ExitWorktree` | `Kept worktree` / `Removed worktree (branch <bold b>)`, then `Returned to <cwd>` |
| `PushNotification` | six outcomes: `Not sent because "Push when Claude decides" is disabled in /config.`; `Not sent because you're active in this terminal.`; `Terminal notification sent.`; `Not sent — Remote Control is off. Enable with /remote-control.`; `Terminal and mobile notification sent.`; `Mobile notification sent.`; and **no output** when the disable reason is undefined |
| plugin/skill list tools | `<count> <noun|nouns>` (six tools share one count renderer) |

**Job.** Each is a one-line receipt: something was scheduled, cancelled, switched, sent or listed.

**Wire.** R throughout (`areas/41-tui-rendering.md` §41.16.7); the underlying frames are P.

**afleet today.** `undesigned`, all of them — `Done · N lines`. Tracker 136 names `TaskStop`, the
worktree pair, `Monitor`, the cron trio and the MCP resource readers by name.

**GUI form.** Region: Timeline row. These are the cheapest cards in the lane: fourteen strings.
Implement all of them verbatim as headlines. Four GUI additions worth the extra line of code.

1. `EnterWorktree` / `ExitWorktree`: the branch and the path become links into the Source Control
   and Files panels. A worktree switch is a **context change** and deserves the visual weight of a
   divider row, not a result line — it is the one item in this table that changes what every
   subsequent row means.
2. `CronList`: render as a small table (id, schedule, kind) rather than one row per job, keeping
   `(recurring)` / `(one-shot)` / `[session-only]` verbatim, and keep `No scheduled jobs`.
3. `PushNotification`: keep all six strings, but rewrite the two that name terminal-only mechanisms
   — `Not sent because you're active in this terminal.` becomes
   `Not sent because you're active in this channel.`, and
   `Not sent — Remote Control is off. Enable with /remote-control.` keeps its meaning but points at
   afleet's own settings. Named deviation: the copy references surfaces afleet does not have.
4. `RemoteTrigger`: colour the row by HTTP class.

**Drops / keeps / gains.** Drops: bold-span formatting, `/config` and `/remote-control` as
destinations. Keeps: all fourteen forms' wording and counts. Gains: navigable worktree and branch;
a real cron table; correctly-worded notification outcomes.

**Open.** None.

### B-39 · `TodoWrite`

**Terminal.** **There is no renderer.** `TodoWrite` is absent from the side table, its
`userFacingName` returns the empty string and its `renderToolUseMessage` returns `null`
(SPEC 41.16.5). SPEC 41.16.1 confirms the absence from the other direction: there is **no `☒`/`☐`
todo chrome anywhere** in the glyph vocabulary. Todos surface only as a progress bar in the diff
sidebar (B-42) and in the tasks panel. So a `TodoWrite` call draws nothing at all in the transcript.

**Job.** Track what the model plans to do and what it has finished.

**Wire.** **D, and worse than it looks.** `docs/tui-parity/areas/20-tasks-background.md`:
"*Not on the wire and **not on disk** — `~/.claude/todos/` exists but has no writer.*" The only
source is `tool_use.input.todos`, which is the **full replacement list on every call** — so a host
must treat each call as a snapshot, not a delta. The tool is enabled only when the Task tools are
off. The row also records that `TodoWrite` is one of the tools "*absorbed silently*" by a
transparent wrapper: no visible tool-use row, "*pops out on error*". The somersault clone's probe
22b independently found a version where the tool did not exist at all — the model answered
verbatim "*TodoWrite isn't in my available tools*"
(`CC-to-SDK/docs/superpowers/specs/2026-06-19-chat-rich-tool-rendering-design.md`).

**afleet today.** `built`, and it **exceeds canon**. `ToolResultForms.swift:211-216` gives
`Updated N todo(s)` with a detail of `N completed`, and the source comment says so explicitly
(`:208-210`): "*exceeds the terminal: parity §41.16.7 records that `TodoWrite` has no result
renderer at all there*". Like `Edit`, it sets no `raw`, so the list itself is not shown.

**GUI form.** Region: Timeline row **and** a persistent surface. Two parts.

1. **The row.** Keep `Updated N todos · N completed` as the collapsed headline, and add the list to
   the disclosure: one line per todo with a state glyph (`○` pending, `◐` in progress, `●` done)
   and the item text, with newly-completed items marked. Because each call is a full snapshot, the
   row can show the **delta** — `✓ Wrote the parser` — which is the single most useful thing about
   a todo update and which no terminal surface shows.
2. `[exceeds]` **A persistent list.** The terminal's only durable todo surface is a progress bar in
   a sidebar that requires ≥110 columns and a git repository (B-42). afleet should keep the current
   todo list in the **Thread panel or the channel header** as a small checklist that updates in
   place, since the wire gives a full snapshot every time and reconstruction is trivial. The
   somersault clone reached the same design independently — a pinned bordered `Tasks` box above the
   composer, with nothing rendered when empty
   (`2026-06-19-chat-rich-tool-rendering-design.md`) — which is corroboration that the row alone is
   not enough.

**Drops / keeps / gains.** Drops: nothing (there is nothing to drop). Keeps: silent absorption on
success is **not** kept — afleet draws a row, deliberately. Gains: the todo list visible at all;
completion deltas; a persistent checklist.

**Open.** Where does the persistent list live — channel header, Thread tab, or a new panel tab?
Product call. Header is cheapest and most visible; a tab is more room and less noise.

## 6. Diffs

### B-40 · The diff in a tool result

**Terminal.** `wWe`, the structured-patch renderer, selects one of four outputs in order
(SPEC 41.16.8): a `previewHint` wins when the style is not `condensed` and verbose is off; with no
hint, `condensed` plus non-verbose returns the added/removed summary for **any** file; otherwise
`collapsed` plus non-verbose plus at least one changed line returns the summary **plus the expand
affordance**; all remaining cases render the **full diff**. The same renderer draws the body of the
file-edit permission dialog. The patch structure is a vendored jsdiff `structuredPatch` emitting
`{oldStart, oldLines, newStart, newLines, lines}` with `\ No newline at end of file` handling.
Context is **3 lines**, and there is no "collapse a hunk to N lines" mechanic.

**Job.** See exactly what changed, in place, without opening an editor.

**Wire.** **P.** `docs/tui-parity/areas/15-16-17-file-bash-sandbox.md`: `structuredPatch` is on the
wire in the jsdiff shape the terminal renders, alongside `oldString`, `newString`, `originalFile`,
`userModified`, `replaceAll` and an optional `gitDiff`. README §7 lists "*a real diff viewer for
`Edit`/`Write` with `structuredPatch`*" as a place the GUI exceeds.

**afleet today.** `undesigned` in the timeline, `built` elsewhere. See B-18: the only reachable
path to `App/Decisions/AttributedDiffRenderer.swift` runs through `PermissionCardView`, so a diff
appears before an edit and never after it. Tracker 137.

**GUI form.** Region: Timeline row, expanded body. Feed `tool_use_result.structuredPatch` into the
`Edit` and `Write` forms' structured slot (B-14) and draw it with the renderer afleet already owns.
Collapsed state is the summary sentence plus `+A −R`; expanded is the diff.

```
▎ ✎ Edit  App/Timeline/Rendering/Rows/ToolResultForms.swift        18:42:09
▎ Added 5 lines, removed 3 lines                     +5 −3    [ Show diff ▾ ]
▎ ┌─────────────────────────────────────────────────────────────────────┐
▎ │ 128    let form = ToolResultForms.form(for: call)                    │
▎ │ 129  - return ToolResultForm(headline: summary, raw: nil)            │
▎ │ 129  + return ToolResultForm(headline: summary,                      │
▎ │ 130  +                       raw: nil,                               │
▎ │ 131  +                       patch: result.structuredPatch)          │
▎ │ 132    }                                                             │
▎ └─────────────────────────────────────────────────────────────────────┘
```

Keep from canon, deliberately: **unified presentation only** (no side-by-side — the parity
inventory records that no side-by-side renderer exists, and a 600-point timeline row is the wrong
place for one; the Files panel is where side-by-side belongs); **three lines of context**;
**word-level diffing with the 40 % bail**; and the ANSI renderer's numbering semantics, not the
Ink renderer's — the two disagree, and `areas/41-tui-rendering.md` §41.16.8 says outright
"*Pick the ANSI/unified semantics*", where context lines take the new numbering.

Correct three things. (a) **Restore syntax highlighting on removed lines.** The terminal renders
them unhighlighted; the somersault clone verified that this is a real code path (`-` emits one
style/text pair) and kept it, but in a GUI with real colour the asymmetry reads as a bug rather
than as a signal. Named deviation. (b) **Draw line numbers.** afleet's `DiffLine` already computes
`beforeNumber`/`afterNumber` (`App/Decisions/DiffRendering.swift:23-24`, filled at
`AttributedDiffRenderer.swift:88,92,96`) and `attributed()` ignores them (`:130-141`); the terminal
always draws them. (c) **Draw hunk headers.** afleet's renderer has no `@@` anywhere; with three
lines of context a multi-hunk patch currently reads as one continuous block. The terminal's
between-hunk marker is a dim `...` in the gutter — either that or a real `@@` header, but not
nothing.

Do **not** re-introduce a body line cap. The somersault clone removed its 24-row cap after finding
"*upstream caps nothing*" for the transcript body (`CC-to-SDK/docs/parity/tui-ux.md` §2 row 11);
the 400-line cap in `areas/41-tui-rendering.md` §41.16.8 belongs to the **sidebar** (B-42), not the
result row. Fold long diffs with B-06's budget and a `+N more lines` count instead.

`[exceeds]` `Open in the Files panel` on the diff header, opening the file at `newStart`;
`Revert this edit`; `Copy patch`.

**Drops / keeps / gains.** Drops: `previewHint`, `condensed`/`collapsed` predicates, side-by-side
(never existed), the removed-lines-unhighlighted rule. Keeps: unified layout, 3-line context, word
diff with the 40 % bail, ANSI numbering. Gains: line numbers, hunk headers, highlighting on both
sides, revert, copy, jump-to-file.

**Open.** None.

### B-41 · Diff row geometry and the four truncations

**Terminal.** The row shape is `<space><padded line number><space><marker><code><right pad>`, with
a gutter width of the largest line number's digit count **plus three**, and the gutter is
`noSelect: "from-left-edge"` so a copied diff carries code and not numbers (SPEC 41.16.8). Six
theme keys drive it: `diffAdded`, `diffRemoved`, `diffAddedDimmed`, `diffRemovedDimmed`,
`diffAddedWord`, `diffRemovedWord`. Unchanged lines get **no background**; their gutter is forcibly
dim but their body follows the caller's `dim` flag. The somersault clone verified that the body is
a full-width **background band** per row, not a foreground colour, and that highlighting composes
**band-under-token** (`CC-to-SDK/docs/superpowers/specs/2026-08-06-wave-r-repaint-geometry-design.md`,
EP-R5), and that three separate palettes exist — Monokai/dark, an entirely different light set, and
a 256-colour fallback. Four truncations coexist:

| Level | Limit | Marker |
|---|---|---|
| Per line | 2000 characters | ` … [+N chars]` |
| Per file, **sidebar only** | 400 hunk lines | `… diff truncated (exceeded 400 line limit)` |
| Between hunks | — | a dim `...` in the gutter |
| Collapsed tool result | not a line count | the summary plus the expand affordance |

The Ink path reserves a whole row for the per-line marker when it would not fit on the last wrapped
row; the ANSI path appends it as ordinary text so it can itself wrap.

**Job.** Make a diff scannable: numbers on the left, one colour per side, nothing that copies
wrong.

**Wire.** T (geometry) / R (colours). The patch data is P (B-40).

**afleet today.** `built`, minimally. `AttributedDiffRenderer.swift:145-147` uses `"+ "` / `"- "` /
`"  "` markers and green/red/`.secondary` **foreground** colours only (`:133-138`), with a
`.system(.caption, design: .monospaced)` font and `.textSelection(.enabled)` (`:125`). No
background bands, no word diff (deliberate, `:57-61`), no line numbers drawn, no hunk headers, no
virtualisation, no syntax highlighting. Failure copy exists and is good:
`This file could not be read, so the tool's input is shown instead of a diff.`
(`App/Decisions/DiffRendering.swift:167`) and
`This change is too large to draw, so the tool's input is shown instead of a diff.` (`:172-173`).

**GUI form.** Region: wherever a diff is drawn. Adopt three things from canon and one from the
clone.

1. **Background bands, not foreground colour.** This is the clone's byte-verified finding and it
   is the correct GUI choice too: a full-row tint reads at a glance and survives syntax
   highlighting on top of it. Six colours, mapping the six theme keys, in light and dark.
2. **Line numbers in a non-selectable leading column.** afleet gets `noSelect` for free by not
   marking the gutter selectable — the same structural trick as B-03.
3. **Word-level diff with the 40 % bail.** afleet's renderer deliberately omits it; canon has it in
   both renderers and it is the difference between reading a changed line and re-reading it.
4. Keep the **2000-character per-line clamp** and its ` … [+N chars]` marker — a 40,000-character
   minified line will otherwise stall layout — and give the marker its own row rather than letting
   it wrap.

Keep both of afleet's failure strings verbatim; the terminal has no equivalent and they are better
than a blank.

**Drops / keeps / gains.** Drops: `columns − 12` arithmetic, the Ink/ANSI row-reservation split,
the 400-line sidebar cap (belongs to B-42). Keeps: the gutter shape, `noSelect`, six theme keys,
the per-line clamp and its marker, the between-hunk marker. Gains: bands, word diff, highlighting,
selectable code without numbers.

**Open.** None.

### B-42 · The diff sidebar

**Terminal.** A right-hand panel that exists only in the **fullscreen** renderer and only when the
feature gate `tengu_jazzy_ripple` is **off**, the client is not thin, the pane has focus, the
terminal is at least **110 columns** and there is a git repository (SPEC 41.16.9). First auto-open
needs **144** columns. Width is `min(floor(columns × 0.45), 90, columns − 70)`. `/diff` or
`app:toggleReplTab` toggles it, flipping `replTab` between `"convo"` and `"diff"` — so in the
terminal, the diff panel and the conversation are **mutually exclusive**. Its base cycles
session → uncommitted → branch on `app:cycleDiffBase`. The header reads `<bold N> files changed
+A −R` with a `✕` close control, plus a **todo progress bar** when todos exist. Per-file hunks
truncate at 400 lines with `… diff truncated (exceeded 400 line limit)`. Six empty states, in test
order:

| Condition | Headline | Sub-line |
|---|---|---|
| Diff read failed | `Diff unavailable` | `Couldn't read the git diff — it will retry on the next change` |
| No files, no commits | `No commits yet` | `Nothing to diff against until the repo's first commit` |
| No files, base `uncommitted` | `No uncommitted changes` | — |
| No files, base `branch`, resolved | `No changes vs <branch>` | — |
| No files, base `branch`, unresolved | `No changes vs HEAD` | `No base branch to compare against — showing changes vs HEAD` |
| No files, base `session` | `No changes this session` | — |

Outside those conditions `/diff` falls back to a modal `DiffDialog`. There is also a
`dPt` message for the non-repository case: `The diff panel shows git changes — the current
directory isn't in a git repository`.

**Job.** See the whole session's changes as one reviewable set, not scattered across tool rows.

**Wire.** Mount gate T; header, empty states and base cycling R;
`get_workspace_diff` is the wire source, and base-selector support is recorded **Unverified**
(`docs/tui-parity/areas/41-tui-rendering.md` §41.16.9).

**afleet today.** `built` as a different thing, and better. afleet has a **Source Control panel
tab** (root spec §2 region list; C7.7 spec `2026-09-09-c7.7-scm-panel.md`) which is a permanent,
poppable panel — none of the terminal's five mount conditions apply, and it does not displace the
conversation.

**GUI form.** `superseded` by the Source Control tab, with four things carried across.

1. **The three bases.** session / uncommitted / branch, as a segmented control in the tab's header.
   The *session* base is the one a terminal-shaped tool invented and it is the most valuable of the
   three for an agent workspace — "what has this agent changed since I started watching".
2. **The header.** `<N> files changed +A −R` verbatim.
3. **All six empty states, verbatim**, plus the non-repository message. They are unusually good
   copy — each names the reason and the next step — and empty states are exactly what a panel is
   worst at.
4. **The todo progress bar** moves to wherever the persistent todo list lands (B-39), not into
   Source Control.

Drop the 400-line per-file cap in favour of virtualised rendering; a panel can scroll.

**Drops / keeps / gains.** Drops: the 110/144-column gates, the `tengu_jazzy_ripple` inversion, the
`replTab` mutual exclusion, the modal fallback, the 400-line cap, `✕`. Keeps: three bases, the
header, six empty states and the no-repo message. Gains: diff and conversation visible together;
no width gate; a poppable window.

**Open.** Does C7.7's Source Control panel already offer a *session* base? If not, that is the one
substantive addition this card asks for.

### B-43 · The post-edit diagnostics row

**Terminal.** Under a file-edit result the terminal draws
`Found N new diagnostic(s) in M file(s) (ctrl+o to expand)`
(`cli.pretty.js:835272`, verified). SPEC 41.16.7 does not document it — an addition this study
makes to the stated denominator. The diagnostics block itself uses basename-only headers, 1-based
positions, the glyphs `✘ ⚠ ℹ ★`, a `[code]` and a `(source)`, with a 4000-character cap and at
most 10 per file / 30 total.

**Job.** Learn immediately that an edit broke the build, in the place the edit happened.

**Wire.** **D, and absolutely so.** `docs/tui-parity/areas/33-34-43-44-ide-lsp-voice-artifacts.md`:
the `diagnostics` attachment is dropped by filter `Cu` — "*the model sees `<new-diagnostics>…`, the
host sees nothing*" — with the qualifier that this is "*not a parity gap with the terminal, it is
an absolute gap*". So the row cannot be reconstructed from the wire.

**afleet today.** `undesigned`, and unbuildable from the current protocol.

**GUI form.** Region: Timeline row, attached to the edit result. Two routes, and the card names
both rather than pretending the first works.

1. **From the wire: not possible.** State it in the row's absence; do not draw a placeholder.
2. **From afleet's own tooling: possible and better.** afleet hosts a Files panel with an editor
   and can run its own LSP or `swift build` / `tsc` against the workspace. If it does, the row
   becomes `<N> new diagnostics in <M> files` with the diagnostics listed in the disclosure —
   glyph, `file:line`, message, `[code]`, `(source)` — each a link into the Files panel at the
   position. That is strictly better than the terminal, which shows a count and hides the rest
   behind `ctrl+o`.

Either way, keep the sentence shape verbatim if it is ever drawn, and keep the four glyphs' meaning
as severity colours.

**Drops / keeps / gains.** Drops: `(ctrl+o to expand)`, the 4000-character and 10/30 caps. Keeps:
the sentence, the severity vocabulary. Gains: nothing from the wire; everything from afleet's own
tooling, if the owner wants it.

**Open.** Owner call, and a real scope question: does afleet run diagnostics itself? That is a
product decision about what kind of workspace afleet is, not a rendering decision. Until it is
answered this row does not exist.

## 7. Interruption, rejection, waiting and rate limits

### B-44 · Interruption rendering

**Terminal.** There is **no strikethrough in message chrome** — an interrupted or rejected block is
never struck through (SPEC 41.16.10; the only struck-through chrome in the build is a completed
task-board subject). The rendering is `Interrupted ` dim, optionally followed by `· ` and the
detail `What should Claude do instead?` (`cli.pretty.js:832492`, `:832497`, verified). The
transcript sentinels are a family of five, all verified at `cli.pretty.js:156656`:
`[Request interrupted by user]`, `[Request interrupted by user for tool use]`,
`[Tool call did not complete: the turn was ended to deliver the message that follows. Nothing
refused it; re-run it if still needed.]`, `[Tool call skipped: the turn ended to deliver the
message that follows before this call ran. Nothing refused it; re-run it if still needed.]` and
`The user doesn't want to take this action right now. STOP what you are doing and wait for the user
to tell you how to proceed.` — plus `API Error: Request was aborted.` and
`Operation stopped by hook`. The somersault clone found that the sentinel match is `startsWith`,
not equality, and that this is load-bearing: one of the three appends a statsig-gated suffix, so
`===` "*genuinely breaks when the flag is on*" (`CC-to-SDK/docs/parity/tui-ux.md` §2 row 22). The
clone also recorded that canon paints the interrupt line **twice** on Escape-during-tool and the
clone paints it once.

**Job.** Make it unambiguous that work stopped because you stopped it, and that nothing refused it.

**Wire.** P. `areas/41-tui-rendering.md` §41.16.10 classes `Interrupted` and
`Interrupted · What should Claude do instead?` as P; the sentinels ride the transcript.
`areas/11-14-query-loop-tool-interface.md` adds the finer classification:
`tool_result_meta.non_execution_kind` includes `interrupted` and `cancelled` as distinct values.

**afleet today.** `undesigned`. `ToolResultForms` has no interrupted state at all — an interrupted
call falls into the error arm (`is_error` is set) and renders as `Error: <first line>`, which is
exactly wrong: the terminal is at pains to say *nothing refused it*. Note the trap
`areas/15-16-17-file-bash-sandbox.md` records: "*`is_error` is the `interrupted` flag, **not** the
exit code*", so afleet's error arm is currently catching interruptions and calling them failures.

**GUI form.** Region: Timeline row. Add an `interrupted` state to `ToolResultForm`, keyed on
`non_execution_kind` rather than on `is_error`. Render it in `.secondary`, never in `.red`, with
the headline `Interrupted` and the terminal's detail `What should Claude do instead?` shown only
when the turn ended without a follow-up prompt. Keep the two "nothing refused it" sentinels'
meaning as a dim sub-line — they are the most carefully written strings in this family and their
whole job is to stop a reader concluding that a tool was denied. `[exceeds]` Offer `Re-run` on the
row: the input is in the `tool_use` block, afleet has the composer, and the sentinel literally says
"*re-run it if still needed*". The terminal cannot do this. Never draw strikethrough — canon
deliberately does not, and the temptation in a GUI is strong.

**Drops / keeps / gains.** Drops: nothing worth keeping is dropped; the raw sentinel text stays out
of the timeline (it is model-facing). Keeps: `Interrupted`, `What should Claude do instead?`, the
no-strikethrough rule, the "nothing refused it" reassurance. Gains: interruption distinguished from
failure; re-run.

**Open.** None.

### B-45 · Rejection rendering

**Terminal.** Rejection is `subtle` plus dim, never struck through (SPEC 41.16.10), and five
distinct renderers exist rather than one:

| Source | Copy |
|---|---|
| `Edit` / `Write` | `User rejected <operation> to <bold path>` + a 10-line preview |
| `NotebookEdit` | `User rejected <operation> <path>` |
| `ExitPlanMode` | `User rejected Claude's plan:` in a round box coloured `planMode` |
| `AskUserQuestion` | `User declined to answer questions` + one line per question |
| generic | `User rejected tool use` |

The somersault clone byte-verified the plan literal including the ASCII apostrophe and confirmed it
renders in `subtle`, not SGR dim (`CC-to-SDK/docs/parity/tui-ux.md` §2 row 27).

**Job.** Record that *you* said no, distinctly from the tool failing.

**Wire.** P for the copy (`areas/41-tui-rendering.md` §41.16.10: "*Per-tool rejection renderers —
P*"). **Richer than the terminal** for the reason: `non_execution_kind` separates `user-rejected`
from `permission-rule`, `automode-blocked`, `automode-unavailable` and
`automode-parsing-error` (`areas/11-14-query-loop-tool-interface.md`) — five distinct denial causes
the terminal renders as one sentence.

**afleet today.** `built`, for one tool. `ToolResultForms.swift:75-77`:
`User rejected update to <filePath>` for `Edit`, and `User rejected <userFacingName>` for
everything else — which is a reasonable generic but is not canon's `User rejected tool use`, and
drops the other three specific forms.

**GUI form.** Region: Timeline row. Keep all five copies verbatim and route by tool as canon does.
Then spend `non_execution_kind`, which is the whole `[exceeds]` of this card: a row denied by a
**permission rule** should say so and offer `Edit rule` (afleet writes permission rules from
decision cards already, root spec §8.4), and a row blocked by **auto mode** should name auto mode
and offer `Review in Activity`. Rendering five different causes as `User rejected tool use` is the
terminal being unable to see a distinction the wire makes. Keep the `planMode`-coloured box for the
plan rejection. Keep the `Edit`/`Write` preview but fold it at B-06's budget rather than 10 lines,
and prefer a **diff** over a preview when `structuredPatch` is present — the user is being shown
what they refused.

**Drops / keeps / gains.** Drops: the 10-line preview cap, `subtle` as a colour name. Keeps: all
five copies, per-tool routing, the plan box. Gains: five denial causes distinguished; a route to the
rule that caused the denial; the refused change shown as a diff.

**Open.** None.

### B-46 · `Waiting for permission…`

**Terminal.** While a permission prompt is open the tool result body is **replaced** by
`Waiting for permission…` (SPEC 41.16.10; `cli.pretty.js:835189`, verified — and the composer
carries the same copy at `:511212`). SPEC mentions it in a single clause; it is a distinct
transcript state and gets its own card.

**Job.** Explain why a tool row has stopped moving: it is not hung, it is waiting for you.

**Wire.** P (`areas/41-tui-rendering.md` §41.16.7 classes `Waiting for permission…` as P).

**afleet today.** `undesigned` as a result state. afleet raises a permission **card** in the
timeline (root spec §8.4; `App/Decisions/PermissionCardView.swift`), which is a stronger signal
than the terminal's replaced body — but the *tool row itself* keeps showing `Running…`
(`ToolResultForms.swift:89`), which is now false: nothing is running.

**GUI form.** Region: Timeline row. Add a `waiting` state and render the headline
`Waiting for permission…` verbatim with a hollow, non-spinning indicator — a spinner claims work is
happening. `[exceeds]` Make the row **scroll to the decision card** on click, since in a long
transcript the card may be far above or below. `[exceeds]` If the channel is not in view, the
waiting state is exactly what should drive a sidebar badge and an Activity entry — afleet already
routes decisions to Activity (root spec §2), and this state is the reason the badge exists.

Note the ordering rule worth keeping from the terminal: the **tool row and the prompt are
separate**, and the row degrades rather than disappearing. afleet must not hide the tool row while
its card is open.

**Drops / keeps / gains.** Drops: the body replacement (afleet has no body yet). Keeps:
`Waiting for permission…` verbatim; the row staying visible. Gains: click-to-card; a correct
non-spinning indicator; cross-channel visibility.

**Open.** None.

### B-47 · Rate-limit auto-continue rendering

**Terminal.** Six surfaces (SPEC 41.16.11), and one negative fact worth stating first: **there is
no `Claude usage limit reached` literal** — the family is `Usage limit reached · …`.

*The pinned notice*, registered at `high` priority in the pinned bar as `⚠ <text>`, three texts:
`Your usage limit has reset · press enter to continue`;
`Usage limit reached · continuing shortly · esc to cancel`;
`Usage limit reached · continuing automatically at <time> · esc to cancel` (or
`… when it resets · esc to cancel`).

*Transcript notices*, an eleven-row event table. The ones that carry policy:
`Usage limit reached again after you continued · continuing automatically <at time|shortly> · the
automatic-continue setting no longer ends this wait (esc or /rate-limit-options still can)`;
`Automatic continue was turned off · this task will not resume on its own`;
`Automatic continue stopped · the usage limit now resets more than 24 hours out, so this task will
not resume on its own (/rate-limit-options to wait anyway)`;
`Automatic continue did not run · the continuation was blocked before it reached the model, so this
task did not resume on its own · send a prompt to continue`;
`Automatic continue stopped after repeated usage-limit hits · this task will not resume on its own
(/rate-limit-options to try again)`; plus `Usage limit available again · continuing now`,
`Usage limit has reset · press enter to continue` and `Usage limit reset · continuing automatically`.

*The inline block* under the rate-limit message: `Continuing shortly · esc to cancel` or
`Continuing automatically at <time> · esc to cancel`, plus a `Press ⏎ to continue after reset`
line, with the headline coloured `error` (or `warning` for spend limits).

*Cancellation*: escape, `ctrl+c`, or a confirmed `chat:killAgents` cancel and raise an 8-second
toast `Automatic continue cancelled · /rate-limit-options to re-arm`.

The limit vocabulary is `five_hour` → `session limit`, `seven_day` → `weekly limit`,
`seven_day_opus` → `Opus limit`, `seven_day_sonnet` → `Sonnet limit`,
`seven_day_overage_included` → `Fable limit`, `overage` → `usage credit limit`. Approaching-limit
strings join up to three ` · ` parts: `You've used <N>% of your <limit>` or `Approaching <limit>`,
`resets <clock>`, and an optional CTA. The clock is 12-hour with minutes suppressed on the hour and
the meridiem lower-cased — `3pm`, `3:45pm` — switching to a dated form beyond 24 hours; countdowns
collapse to one unit above five minutes.

**Job.** Tell you that work has paused for a reason outside your control, when it will resume, and
how to stop waiting.

**Wire.** R for all six surfaces (`areas/41-tui-rendering.md` §41.16.11). Two caveats there:
`/rate-limit-options` is `local-jsx` and therefore **X** — unreachable from a host — and the
`autoContinueAtUsageLimit` setting (default true) is **not** in the headless `/config` key list.
Only the spinner row ticks; the pinned and inline rows re-render on a 30-second poll.

**afleet today.** `undesigned`. Root spec §2 names a **Channel banner** whose listed triggers
include "rate limit", and the Activity view aggregates rate limits — so the *destination* exists
and nothing specifies the form. Classify `routed-only` for the banner, `undesigned` for the
transcript notices and the inline block.

**GUI form.** Region: three, matching the terminal's three.

1. **Channel banner** (the pinned notice). One strip above the timeline, `warning` tinted, with the
   three texts verbatim except that `esc to cancel` becomes a `Cancel` button and
   `press enter to continue` becomes a `Continue` button. Keep the clock format exactly — `3:45pm`,
   lower-cased meridiem — because it appears in three places and consistency is the point.
2. **Timeline notice rows** (the transcript notices). Keep all eleven strings verbatim; they encode
   policy that a shorter paraphrase would lose, particularly the "*the automatic-continue setting no
   longer ends this wait*" clause. Replace the `/rate-limit-options` references: that command is
   unreachable from a host (**X**), so the copy must point at afleet's own control. Named deviation,
   and it is forced.
3. **Activity view.** Rate limits are already an Activity category (root spec §2).
   `[exceeds]` A rate limit is a *fleet-wide* fact — every channel on the account is affected — and
   the terminal can only ever tell one session. afleet should show it once, in Activity and in the
   sidebar, not once per channel banner.

Keep the six limit labels verbatim and the approaching-limit sentence shape. The CTA table
(`/usage-credits`, `/upgrade`, admin wording) is lane E's territory if it exists; here, render
whatever CTA text arrives.

**Drops / keeps / gains.** Drops: `esc`/`enter` as copy, `/rate-limit-options` as a destination,
the 30-second poll, `⚠`. Keeps: all sixteen-odd strings, the limit vocabulary, the clock and
countdown formats, the three-surface split. Gains: one fleet-wide notice instead of per-session;
buttons instead of chords.

**Open.** What replaces `/rate-limit-options`? It is a real settings surface with a real job
(re-arm, wait anyway, turn off) and afleet has no equivalent. Owner call: an afleet Settings pane,
or a menu on the banner.

## 8. Markdown

### B-48 · The markdown pipeline and token rendering

**Terminal.** The bundle vendors **marked** and builds two renderers on it: a pure token → ANSI
string function and a set of Ink components where tables, lists and blockquotes get dedicated
components and everything else is ANSI inside one text node (SPEC 41.17.1). GFM is **on**,
`breaks` is **off**, so a single newline is not a `br` token — but embedded newlines in text tokens
survive to the terminal, so `breaks: false` is a tokenisation rule, not newline removal. Three
tokenizer overrides are installed: `del` accepts only `~~x~~` (single-tilde is not strikethrough);
`def` returns undefined, **disabling link reference definitions entirely** so `[text][id]` renders
literally; and `table` re-runs after escaping `|` inside backtick spans and **bails to a paragraph
if any row has more cells than the header**. Token rendering, exhaustively (SPEC 41.17.2): headings
are bold (h1 adds italic and underline) with **no `#` prefix and no colour**, always followed by two
newlines; `codespan` uses the `permission` theme colour with **no backticks and no background**; a
fenced `code` block has **no fence, no border and no indent**, and an unknown language emits the
language string dimmed on its own line then the raw text; `blockquote` prefixes each non-blank line
with a dim `▎` and italicises; `hr` is the three ASCII characters `---`, not a rule; `image` draws
nothing (bare href, or `alt (href "title")`); and **`html` is `token.text` — raw passthrough,
unescaped and unsanitised**.

**Job.** Make the model's prose readable: emphasis, structure, code.

**Wire.** R. The text arrives as plain markdown in content blocks; every rendering decision is
host-side. `docs/tui-parity/areas/41-tui-rendering.md` §41.17 flags the passthrough explicitly:
"*markdown `html` tokens are raw passthrough in the TUI (R, security-relevant: implement the
passes, do not copy the passthrough)*".

**afleet today.** `built`, and this is the one place afleet is deliberately **better than canon**.
`App/Timeline/Rendering/TimelineRendering.swift` runs Apple's `swift-markdown` into
`NSAttributedString` through `MarkdownText.shared` (an LRU of 512, `:470-476`), reached from three
call sites only — user, assistant and peer message bodies (`MessageRows.swift:115,179,200`) and the
streaming preview. Headings h1–h6 at sizes `[24,20,17,15,14,13]`; emphasis, strong applied over
child runs, inline code on a `quaternarySystemFill`, links with `.link` and `linkColor`;
strikethrough **only `~~x~~`**, reproducing canon's tokenizer override (`:904-923`). Raw HTML is
**escaped, never passed through** (`:701-708`, `:858-861`) — the divergence is called out in source
at `:624-625`. C6.1 §5 records that link reference definitions cannot be reproduced and says so
rather than papering over it (`2026-09-08-c6.1-timeline-renderer.md:344-351`).

Three real gaps, all verified by absence in `TimelineRendering.swift`:
- **Blockquotes are invisible.** `case let quote as BlockQuote` (`:667-672`) recurses with
  `indent + 1`, but `indent` is consumed only by the two list arms, so a quoted paragraph renders
  through the ordinary `Paragraph` arm with no marker, no indent and no styling. The terminal draws
  `▎` and italics.
- **Thematic breaks vanish.** `---` hits the default arm, `plain()` of a childless node returns the
  empty string, and nothing is appended.
- **Inline markup inside a heading is flattened** by `plain()` (`:656`), so a link in a heading
  loses its destination.

Tool results, thinking bodies, notices and cards are all plain `Text` — markdown reaches messages
only.

**GUI form.** Region: Timeline. Keep the pipeline; fix the three gaps; keep the HTML divergence.

1. **Keep escaping HTML.** This is the one card in the study that says *do not be faithful*. The
   terminal's raw passthrough is a rendering-injection hazard and the parity inventory says so in
   as many words. Record it as a permanent, deliberate divergence.
2. **Draw blockquotes** as canon does in spirit: a 3pt leading rule in `.quaternary` plus italic
   body, nested by depth. This is a five-line fix to consume `indent` in the `Paragraph` arm.
3. **Draw thematic breaks** as a 1pt full-width `.separatorColor` rule. Canon draws literal `---`
   because it cannot draw a rule; afleet can.
4. **Keep inline markup in headings** — do not flatten; a link in a heading is a link.
5. Reproduce the terminal's remaining defaults, which afleet mostly already does: no `#` prefix,
   no backticks around inline code, no border on code blocks, `~~`-only strikethrough, link
   reference definitions unresolved.
6. **Route markdown into more places.** Tool results that return markdown — `WebFetch` (B-27),
   `ExitPlanMode` (B-32), `memory_write` (B-36), MCP text results (B-37) — should reach
   `MarkdownText`, not `.caption.monospaced()`. That is one routing change and it upgrades six
   cards at once.

**Drops / keeps / gains.** Drops: ANSI composition, the two-renderer split, `▎` as a literal, `---`
as a literal, HTML passthrough. Keeps: GFM on, `breaks` off, the three tokenizer overrides, no `#`,
no backticks, no fence borders. Gains: escaped HTML; real rules and blockquotes; markdown in tool
results.

**Open.** None.

### B-49 · Tables

**Terminal.** Two renderers, chosen by nesting rather than configuration (SPEC 41.17.4).
*Top-level* tables get box-drawing — `┌─┬┐ ├─┼┤ └─┴┘`, `│` verticals, one space of padding per
side — with layout constants of 4 columns of outer slack, minimum column width 3, at most **4
wrapped lines per row**, at most **200 rows**. The column-width algorithm is five steps: compute a
minimum width (widest whitespace-delimited word, floored at 3) and a natural width per column; the
budget is `max(terminalWidth − (1 + 3 × columns) − 4, columns × 3)`; use natural widths if they
fit; else distribute slack proportionally to `natural − minimum`; else scale the minimums down and
switch to hard wrapping. If any row needs more than 4 wrapped lines, or the box is wider than
`terminalWidth − 4`, it **falls back to a vertical key/value layout**, one `header: value` per line
separated by a `─` rule of `min(width − 1, 40)` columns. Truncated tables end
`… <N> more rows not shown`. Header cells are **force-centred**; body cells honour markdown
alignment; multi-line cells are vertically centred. *Nested* tables and the string API get ASCII
pipes instead. Screen-reader mode flattens each row into `header: value` clauses. The somersault
clone verified three corrections at implementation contact: borders are **not** dim; tables are
**exempt** from ambient markdown dim; and a nested row keeps its closing pipe
(`CC-to-SDK/docs/parity/tui-ux.md` §2 row 9).

**Job.** Read tabular data as a table.

**Wire.** R. The markdown text is on the wire; every layout decision is host-side.

**afleet today.** `built`, and it is the clearest `[exceeds]` in the markdown family. Root spec §8.3
says "*tables native*", and `TimelineRendering.swift:729-769` renders GFM tables as real
`NSTextTable`s with 1pt `.separatorColor` borders, 4pt padding and a bold header row. It even
reproduces canon's tokenizer override faithfully: a body row wider than its header **bails the
whole table to a paragraph** (`:731-735`, with `hasARowWiderThanItsHeader` at `:775-785` and
`cellCount` honouring `\|` at `:795-807`).

**GUI form.** Keep as built. Four refinements, none structural.

1. Honour markdown **column alignment** on body cells, and **do not** force-centre headers —
   canon's centring is a box-drawing aesthetic, not a data one. Named deviation.
2. Drop the 200-row cap and the 4-wrapped-line ceiling; virtualise instead. The vertical key/value
   fallback exists because a terminal runs out of columns; a resizable window does not, and a
   poppable panel certainly does not.
3. Keep `… <N> more rows not shown` **only** if a cap is ever reintroduced.
4. `[exceeds]` Column sorting on a header click, and `Copy table as TSV` on the hover menu. Neither
   is expensive once the table is a real `NSTextTable`, and both are things a reader of a
   model-generated table immediately wants.

**Drops / keeps / gains.** Drops: box-drawing, the five-step width algorithm, the vertical
fallback, the 200-row and 4-line caps, forced header centring, the ASCII-pipe nested renderer.
Keeps: the header-width bail-out rule, GFM alignment, the header emphasis. Gains: real tables at
any width; sorting; copy as TSV.

**Open.** None.

### B-50 · Lists

**Terminal.** **Unordered bullets are always the ASCII hyphen `-`, at every depth** (SPEC 41.17.3).
Ordered markers cycle by depth: decimal at depth 0, lowercase base-26 letters at depth 1, lowercase
Roman numerals at depth 2 (only when `start >= 1` and the number ≤ 3999), decimal at depth ≥ 3. The
somersault clone corrected its own plan here — the depth that selects the marker is the **child's**
depth, and both its census and its plan were one level off
(`CC-to-SDK/docs/parity/tui-ux.md` §2 row 6). Continuation indent is the parent indent plus the
marker's display width plus one, capped at **32 columns**. A post-pass glues a number and its
period to the preceding word with U+00A0 so a wrap cannot strand `1.` at the start of a line where
it would read as a marker. The Ink list components are used only under a **300-node / 64-depth**
budget and only outside screen-reader and prompt modes; otherwise the string renderer runs.
Task-list items are prefixed `[x] ` / `[ ] ` as text.

**Job.** Read a list as a list, with nesting legible.

**Wire.** R.

**afleet today.** `built`. `TimelineRendering.swift:673-696`: unordered lists use `"• "` with a
4-space indent per level; ordered lists number from `list.startIndex` rather than the enumeration
offset, which is the correct reading of `start`. Two gaps: the ordered marker does **not** cycle by
depth (always decimal), and `ListItem.checkbox` is never read, so task lists lose their boxes.

**GUI form.** Region: Timeline. Keep afleet's `•` — canon's ASCII `-` is a font-availability
concession, and a bullet at depth 0 with `◦` at depth 1 and `▪` at depth 2 reads better than three
identical hyphens. Named deviation, and the one place in this family where being unfaithful is
obviously right. Do **adopt** the ordered-marker cycle (`1.` → `a.` → `i.` → `1.`), because that
one is genuinely informative about depth and costs a small function. Drop the 32-column indent cap
and the 300-node budget; a window has room and `NSAttributedString` has no complexity cliff at
300 nodes. Drop the U+00A0 glue post-pass — it solves a terminal wrapping artefact. **Add
checkboxes**: read `ListItem.checkbox` and draw `☐` / `☑` (or, better, a real disabled
`Toggle`-shaped glyph), keeping canon's `[x] `/`[ ] ` semantics; a model writing a checklist in
prose is common and the boxes currently vanish.

**Drops / keeps / gains.** Drops: ASCII `-`, the 32-column cap, the 300/64 budget, the U+00A0 glue,
the string-renderer fallback. Keeps: `start`-based numbering, the depth-cycling ordered markers,
task-list semantics. Gains: depth-varying bullets; visible checkboxes.

**Open.** None.

### B-51 · Code blocks, syntax highlighting and the line-number gutter

**Terminal.** Two independent highlighters (SPEC 41.17.6). **A** maps highlight.js onto 16-colour
chalk with a 34-entry scope map, walking the emitter's node tree and returning unhighlighted source
on any throw; scope lookup strips `hljs-` and walks dotted scopes right to left. 186 grammars are
registered lazily. **B** is the true-colour highlighter used for code blocks and diffs, with three
palettes — Monokai-extended for dark, an entirely different GitHub-derived set for light, and an
ANSI indexed fallback — plus daltonized variants; language detection is filename-driven (a basename
map for `Dockerfile`, `Makefile`, `Rakefile`, `Gemfile`, `CMakeLists`, then the extension, then
shebangs and `<?php`/`<?xml` prologues); lines clamp at **2000 characters** with ` … [+N chars]`;
tabs expand to 8-column stops. Gating: `syntaxHighlightingDisabled` disables both, and
`CLAUDE_CODE_SYNTAX_HIGHLIGHT` set falsy is an additional gate on B. The gutter (SPEC 41.17.7) is
one leading space, the number right-aligned in `String(maxLineNumber).length` columns, one trailing
space, with blank gutters on wrapped continuation rows; context lines dim the numbers; and it is
**suppressed entirely** — width 0 — when the block starts at line 1 **and the fullscreen renderer
is off**. So an inline-renderer code block starting at line 1 has no gutter and the same block in
fullscreen has one.

**Job.** Read code as code.

**Wire.** R. The parity inventory adds one detail worth knowing: the bundle carries a
non-upstream **Cedar** grammar (alias `cedarpolicy`) among its 180-odd languages
(`areas/41-tui-rendering.md` §41.17).

**afleet today.** `built`, and well-chosen. C6.1 §6 pins **PhraseHQ/HighlightKit** exactly,
selected "*for fidelity (port of highlight.js 11.11.1, 375 differential fixtures), not speed*"
(`2026-09-08-c6.1-timeline-renderer.md:366`); `CodeHighlighter.shared`
(`TimelineRendering.swift:953`, LRU 256) highlights fenced code off-main with a plain fallback and
a later re-fill (`:659-665`). The somersault clone reached the same conclusion independently:
extending a hand-written scope map "*costs the same structural work and still misses ~373 of ~383
languages*" (`CC-to-SDK/docs/superpowers/specs/2026-08-06-wave-r-repaint-geometry-design.md`, W-R5).
Gaps: no line-number gutter anywhere; the highlighter is reached only from markdown fences, not
from `Write` previews (B-19), `NotebookEdit` cells (B-21) or diffs (B-40); and tracker 135 records
that the streaming preview keeps highlighting across a `syntaxHighlightingDisabled` flip.

**GUI form.** Region: Timeline. Keep HighlightKit. Four changes.

1. **Route the highlighter everywhere code appears**: `Write` previews, notebook cells, diff rows,
   `Bash` output when the command is a formatter, MCP JSON results. Canon does exactly this — the
   same highlighter serves markdown fences *and* diffs — and afleet's is reachable from one place.
2. **Draw a line-number gutter** on code blocks, always, in a non-selectable leading column
   (B-03's rule). Do not reproduce the fullscreen/inline split: it is a layout accident, the SPEC
   itself notes "*nothing in this branch reads accessibility or screen-reader state*", and a GUI
   has one answer. Named deviation: afleet always shows numbers; the inline terminal sometimes does
   not.
3. Keep the **2000-character line clamp** and its ` … [+N chars]` marker.
4. Honour a `syntaxHighlightingDisabled` equivalent in afleet's own settings, and clear the
   streaming preview cache on the flip (tracker 135).

`[exceeds]` A `Copy` button on every code block, and `Run in Terminal panel` when the fence language
is `bash`/`sh`/`zsh` — the two things a reader does with a code block, neither of which the
terminal offers.

**Drops / keeps / gains.** Drops: the 16-colour highlighter, the ANSI palette, 8-column tab stops,
the gutter-suppression branch. Keeps: filename-driven language detection, the 2000-character clamp,
three-palette theming (as light/dark), the gating setting. Gains: highlighting in six more places;
always-visible line numbers; copy and run.

**Open.** None.

### B-52 · Mermaid — never drawn in the terminal

**Terminal.** Mermaid diagrams are **never drawn** (SPEC 41.17.8). A ```` ```mermaid ```` fence hits
the `code` case and, because `mermaid` is not a bundled grammar, takes the unsupported-language path
— a dimmed `mermaid` label line followed by the raw diagram source. The only mermaid transform in
the bundle is markdown → HTML for the **artifact publisher**, rendered by mermaid.js **in a
browser**, served over HTTP from the artifact host as `/_runtime/mermaid-11.16.1.min.js`. Nothing
is loaded by the TUI.

**Job.** Read a diagram the model drew.

**Wire.** R. The fence text is on the wire.
`docs/tui-parity/README.md` §41.17 calls mermaid and inline images "*the two biggest visual wins for
a GUI*", and §7 lists rendering mermaid first among the places the GUI exceeds.

**afleet today.** `designed`, deferred, with the deferral itself well-recorded. Root spec §8.3:
"*diagrams deferred behind a rendering seam (a mermaid fence renders as a code block, as the
terminal does; amended 2026-09-09 at C6.1's merge, tracker entry names mermaid.js 11.16.1)*".
C6.1 §7 (`2026-09-08-c6.1-timeline-renderer.md:419-431`) defers it behind the `TimelineRendering`
seam and escalates the vendoring question to the architect.

**GUI form.** Region: Timeline, inside the assistant message body. Render the diagram. The version
is already chosen — mermaid.js 11.16.1, the same the binary ships for artifacts — and the delivery
question is the only open one: a bundled `WKWebView` running the vendored script, versus a native
renderer. `WKWebView` is the answer, because it matches the binary's own artifact pipeline exactly,
and C6.1 §11 already establishes a `WKWebView` fallback branch in `TimelineRendering`.

States: while rendering, show the fence as a code block (the current, canon-faithful behaviour) —
so a failure degrades to exactly what ships today. On success, the SVG, sized to the row width,
with `Open in a window` and `Copy as PNG` actions. On a mermaid parse error, keep the code block
and add a dim `Diagram could not be rendered` line. Re-render on light/dark change — the binary's
injected runtime does exactly this, listening for `prefers-color-scheme`.

**Drops / keeps / gains.** Drops: the dimmed `mermaid` label line. Keeps: the code-block rendering
as the fallback and the loading state. Gains: the diagram.

**Open.** Owner/architect call, already escalated by C6.1 §7: vendor mermaid.js 11.16.1 into the
app bundle, or not? Vendoring is ~3 MB of JavaScript and a `WKWebView` per diagram. My reading:
vendor it — the binary already ships it, the version is pinned, and this is one of the two largest
visible wins in the whole study.

### B-53 · Inline images and image placeholders

**Terminal.** No inline-image protocol is emitted **anywhere** in the bundle (SPEC 41.17.9): no
iTerm2 `1337;File=`, no kitty graphics, no Sixel. The only OSC 1337 reference sets a profile
property. There is no `imageDisplay` or `inlineImages` setting. Images in the message list are text
placeholders: `[Image #N]` when an index is known and `[Image]` otherwise, wrapped in an OSC 8 link
to the `file://` URL when the path resolves and hyperlinks are supported, with any stored
description following, dimmed. Attached files render as `› [image] <path> (<size>)` or
`› [file] …`, the glyph being U+203A. The placeholder grammar recognised when re-expanding composer
text is
`/\[(?:Pasted text #\d+( \+\d+ lines)?|Image #\d+|Audio #\d+|\.\.\.Truncated text #\d+ \+\d+
lines\.\.\.)\]/g`.

**Job.** Know that an image is part of the conversation.

**Wire.** **P.** Image bytes are on the wire as content blocks (and twice over for a `Read`, see
B-17). README §7: "*render mermaid, inline images, screenshots, PDF pages and notebook cells
(terminal prints placeholders for all)*".

**afleet today.** `built` as placeholders — which is faithful to a terminal and wrong for a window.
`MessageRows.MessageText:233-236` renders attachment tokens `[image]`, `[<title>]` and
`[document]`; `UserMessageBody:118` joins attachment names with `" · "`.
`App/Timeline/Rendering/TimelineRendering.swift` has **no `Markdown.Image` case at all** — an
image in markdown falls to the default arm, is flattened by `plain()` (`:862-864`), and renders as
**alt text as ordinary prose** with no image and no link. So a markdown image is worse off in
afleet than in the terminal, which at least prints the href.

**GUI form.** Region: Timeline, inside message bodies. Draw the image.

- **Content-block images** (pasted, `Read`, MCP, screenshots): an inline thumbnail capped at ~220pt,
  click to open in the Files panel or a window, right-click to copy or save. Keep any stored
  description as a dim caption beneath — that is the terminal's dimmed description, preserved.
- **Markdown images**: at minimum, render the alt text as a **link** to the href, which is what the
  terminal does and what afleet currently loses. Better: fetch and draw `file://` and same-origin
  images, and draw remote ones behind an explicit `Load image` control — an auto-loading remote
  image in model output is a privacy beacon, and the terminal's refusal to draw it is accidentally
  the safe behaviour.
- **Attachments** on a user message: a row of thumbnail chips with name and size, not a
  `" · "`-joined string of names. Keep the size — the terminal shows it and it is the fact that
  tells you a 12 MB screenshot went to the model.
- Drop `[Image #N]` in the timeline but **keep the placeholder grammar** for the composer's
  round-trip (lane C), since it is the format the CLI expects back.

**Drops / keeps / gains.** Drops: `[Image #N]`, `[Image]`, `› [image]` rows, the OSC 8 `file://`
wrapper. Keeps: the description caption, the size, the composer placeholder grammar. Gains: the
image; a deliberate remote-load decision.

**Open.** Load remote markdown images automatically or on demand? My reading: on demand, with the
host shown. This is a privacy call the owner should confirm.

### B-54 · Links, hyperlinks and the `owner/repo#123` linkifier

**Terminal.** Rendered links use OSC 8 (SPEC 41.17.5), coloured `chalk.blue` in light themes and
`chalk.blueBright` otherwise, degrading to `text (url)` — or the bare URL — when hyperlinks are
unsupported. `mailto:` strips the scheme; a markdown title is appended as ` ("title")`; Claude
artifact and frame URLs are prefixed `⧉`; a post-pass appends ` (url)` where the visible label
alone would be ambiguous. Link identity for stitching a wrapped link back together is a **31-based
rolling hash** rendered in base 36 (SPEC 41.7.5) — not djb2, though the parity inventory records it
as djb2, which is a defect worth noting.

The `owner/repo#123` linkifier is a small, opinionated surface. The grammar requires the reference
to start at the beginning of the string or after a character that is not a word character, `.`, `/`
or `-`, so `a/b#1` inside a path is not matched. Host selection: the git repository's host, or
`github.com` when there is none; the issue path segment is `/-/issues/` for GitLab and `/issues/`
otherwise; and when the forge is **not** GitLab and the host is one of `gitlab.com`,
`bitbucket.org`, `codeberg.org`, `gitea.com`, `git.sr.ht`, `dev.azure.com`, the reference is left
**unlinked**. It exits early if hyperlinks are unsupported or the text has no `#`.

**Job.** Make a reference clickable without the model having to write a URL.

**Wire.** R for the linkification; T for OSC 8 itself.

**afleet today.** `built` for markdown links, `undesigned` for the linkifier.
`TimelineRendering.swift:836-848` renders links with `.link` and `linkColor`; destinations resolve
at **activation, not parse time** (`TimelineLinkDestination`, `:372-420`), so nothing
channel-shaped enters the shared cache, routed through `.environment(\.openURL, …)` (`:271-273`)
and an `NSTextViewDelegate` inside table cells (`:319-323`). `LinkActivation.swift:25-33` reads
`NSApp?.currentEvent?.modifierFlags` at activation and sends Command-click to a new window. There is
no `owner/repo#123` linkifier and no `⧉` artifact prefix. Note the heading gap from B-48: a link
inside a heading loses its destination.

**GUI form.** Region: Timeline. Keep afleet's activation-time resolution — it is a genuinely better
design than the terminal's bake-at-parse and it is why the markdown cache is shareable.

1. **Implement the linkifier**, host selection and forge allow-list included. It is thirty lines and
   it turns every `owner/repo#123` in model prose into a link into the GitHub panel — which afleet
   has and the terminal does not. Keep the exact grammar, including the leading-character rule that
   prevents matching inside paths.
2. Keep ` ("title")` for titled links and the `mailto:` scheme strip.
3. Restore `⧉` for artifact and frame URLs — B-01 already argues that `⧉` is one of two glyphs worth
   keeping literally.
4. **Route link destinations to panels**: a repo/issue URL to GitHub, an http(s) URL to Browser
   (Command-click for the system browser), a `file://` URL to Files, and a path-shaped label through
   `FileLink`. The terminal has one destination — the OS.
5. Fix the heading flattening (B-48).

Drop the unsupported-hyperlink degradation and the ` (url)` disambiguation post-pass: a GUI link is
never ambiguous because hover shows the target.

**Drops / keeps / gains.** Drops: OSC 8, the rolling-hash link id, `text (url)` degradation, the
` (url)` post-pass. Keeps: the linkifier grammar and forge rules, ` ("title")`, `mailto:`
stripping, `⧉`. Gains: links into afleet's own panels; hover targets.

**Open.** None.

### B-55 · Streaming markdown, `textWrap` and the width utilities

**Terminal.** The streaming component keeps a **frozen prefix** and re-lexes only the tail
(SPEC 41.17.11). The chunk size is 4096 and the split point `ft(s)` is chosen in order: the last
newline in the buffer, accepted only if its index is at or past the midpoint 2048; otherwise the
last space **at or before** `length − 1536`, again only past 2048; otherwise a hard cut at
`length − 1536`, moved back one code unit when the next character is a low surrogate so a surrogate
pair is never split. When a split would land inside an open fence — detected by
`/^ {0,3}(`{3,}|~{3,})([^\n]*)$/gm` — the fence's opening line is **re-prepended** to the tail so the
fragment still lexes as code. Separately, `textWrap: "wrap-stream"` wraps like `wrap` but **drops
the final line and its soft-wrap entry**, so a partially arrived line does not leave a stale
trailing row (SPEC 41.7.1). The ellipsis is always U+2026, never three dots, and four truncators
exist: path-aware (keeps the trailing `/basename`), end, start, and hard clip with no ellipsis
(SPEC 41.17.10).

**Job.** Read a long answer as it arrives without the layout thrashing or a code fence flickering.

**Wire.** R. `stream_event` deltas under `--include-partial-messages`
(`areas/41-tui-rendering.md` §41.17 streaming row). `areas/41-tui-rendering.md` §41.7.1 names
`wrap-stream` as "*the one copyable behaviour*" of the whole `textWrap` family.

**afleet today.** `built`, and it is the part of the renderer with the most evidence behind it.
`TimelineTableController.applyPreview` (`:41-56`) reloads one row rather than the table, keyed
`"preview:" + (messageID ?? "streaming")` (`:311-313`) and continued only on a **prefix** match
(`:288`); `RenderedRow.append` (`TimelineRendering.swift:143-159`) parses only closed blocks and
leaves the tail plain; `PublishCoalescer` (`ChannelTimelineModel.swift:591-627`) is a 33 ms trailing
edge, 30 Hz. C6.1 §4 states that both of canon's rules were carried over deliberately: the
**open-fence re-prepend** and **`wrap-stream`** (`2026-09-08-c6.1-timeline-renderer.md:309`).
Two cautions recorded in afleet's own Outcomes and worth repeating: the streaming split "*shipped
**silently lost text*** … It passed S7's gate. **A performance gate is not a correctness gate**"
(`:1053-1057`), and the 30 Hz gate under-drove itself to ~23 Hz because of a `>= 1/rate` wait on a
60 Hz display link (`:1087-1101`).

**GUI form.** Region: Timeline. Keep as built. Three notes rather than changes.

1. `wrap-stream`'s job — never lay out a partially arrived line as a settled row — is satisfied
   structurally by SwiftUI relayout; do not port the mechanism.
2. The 4096/2048/1536 split constants are a terminal's re-lex budget. afleet's equivalent is the
   block-boundary parse, which is a better rule. Keep it, and keep the open-fence re-prepend, which
   is not a budget rule but a correctness one.
3. `[exceeds]` The one streaming affordance the terminal cannot have: a **shimmer or caret on the
   last line** while text is arriving (B-05), because in a window the spinner may be scrolled out of
   view. In the terminal the spinner is always at the bottom.

Keep U+2026 and the four truncators' *behaviours* — in particular the **path-aware** one, which
`FileLink.swift:118` already reproduces with `.truncationMode(.middle)`.

**Drops / keeps / gains.** Drops: `wrap-stream`, the nine `textWrap` modes, the 4096-char chunker,
the SGR re-open fixup. Keeps: frozen prefix + live tail, the open-fence re-prepend, path-aware
middle truncation, U+2026. Gains: a liveness cue that does not depend on the footer being visible.

**Open.** None.

## 9. The list machinery

### B-56 · Virtual list, scroll anchoring, the commit cursor and static commitment

**Terminal.** Three cooperating mechanisms.

*The windowing list* (SPEC 41.8.6, 41.15.3) assumes height 3 for an unmeasured row, quantises
scroll so a re-render is forced only every 40 rows, uses viewport-proportional overscan
`max(60, min(round(viewport × 1.5), 80))`, falls back to the last 30 items when the viewport is
unknown, caps rendered **non-zero-height** items at **300**, clamps a fast scroll's range expansion
to **25 items**, and rebuilds a `Float64Array` of cumulative tops only when the height-cache version
or the item count changes. On a width change every cached height is scaled by `oldCols / newCols`
and the range is **frozen for two frames** while heights settle. Item keys are
`${uuid}-${conversationId}`; a duplicate uuid gets a `#N` suffix and the anomaly is reported rather
than silently repaired.

*Scroll anchoring*: in a layout effect, when not sticky, remember the item whose layout top is
nearest above the viewport top, and on the next frame correct `scrollTop` by however much that
anchor moved. Skipped when a pending scroll delta or a node-level anchor is already active.

*The element-tree commit cursor* (SPEC 41.15.3, 41.16.12) caps how many messages remain **mounted**
— a 200-message window with 50 entries of slack, tightening to 30 in transcript mode. A message
behind the cursor is unmounted and its painted rows live in the terminal's scrollback: "*This is
the real static commit*". "Static-ness" is four cooperating layers, not an Ink `<Static>` (there is
none in this build): the terminal layer paints only `[prevHeight, nextHeight)`; the React layer's
`isStatic` predicate licenses a memo skip (a `collapsed_read_search` row is **never** static; a
tool use becomes static only when it is not streaming, not in progress, has no outstanding
`PostToolUse` hook, and every sibling tool-use id is resolved); the element-tree layer unmounts;
the cell layer blits unchanged subtrees. Repaint triggers are `/clear` (new conversation id → all
keys change → full remount), rewind and compact (conversation-id bump), `ctrl+l`/`cmd+k`, resize,
and a stderr write while the alternate screen is active.

**Job.** Keep a 10,000-message transcript scrollable and stop the view from jumping when a row
above you changes height.

**Wire.** R. `areas/41-tui-rendering.md` §41.8.6 calls out two rules as UX rather than performance:
"*(a) scroll anchoring — remember the item nearest the viewport top and correct `scrollTop` by
however much it moved after a commit … (b) freeze the range for two frames after a width change
while heights re-settle*". §41.16.12 adds a directive: "*A GUI should treat `conversation_reset` and
`compact_boundary` as the transcript-boundary markers the TUI treats them as, including inserting a
visible divider at `compact_boundary`.*" And it names the terminal's structural loss:
"*once a message scrolls into terminal scrollback it can never be restyled, re-wrapped or
re-searched*" — class T, and the reason static commitment exists at all.

**afleet today.** `built`, and this is the most complete part of afleet's renderer.
`App/Timeline/Rendering/TimelineTableController.swift` backs the timeline with an `NSTableView` and
`NSScrollView`, `usesAutomaticRowHeights = false` (`:143`), heights cached by row key and dropped
only for named ids (`:249`), with four publish paths — unchanged (`:242`), same-keys reload
(`:251`), pure append (`:256-264`), full `setRows` (`:266`). All three parity §41.8 behaviours are
present: `anchorAtViewportTop` (`:364-370`), `settleScroll` (`:378-388`), `scrollToBottom`
(`:391-396`), a silent re-pin in `viewportMoved` (`:413-417`), a `bottomTolerance` of 2 (`:124`),
honouring `autoScrollEnabled` (`:380`). `TimelineRowHostView` (`:679-756`) keeps one
`NSHostingView` per key across reloads so SwiftUI state survives. The jump-to-bottom pill is
`TimelineListView.swift:144-160`, copy `"<N> new"` or `"Jump to latest"` (`:152`). **There is no
item cap and no commit cursor** — the model holds every item. C6.1's Outcomes record p99 of
1.47–1.62 ms against a 16 ms bound, with hosting dominating and "*at ~0.2 ms per update it dominates
nothing that matters*" (`2026-09-08-c6.1-timeline-renderer.md:1063-1080`); the margin warning is
"*the margin went from roughly tenfold to about twofold, and every future row kind spends from what
is left*" (`:1120-1125`). Tracker 132 names the real risk: every row's height is measured through a
throwaway hosting view on reload — "*the thing a long transcript would find*".

**GUI form.** Region: Timeline. Keep as built; adopt four things and reject one.

1. **Adopt the width-change freeze.** afleet drops height caches only for named ids; a window
   resize invalidates every height at once and there is no two-frame settle. This is the single
   most likely source of a visible jump when a user drags the panel divider.
2. **Adopt height *scaling* on a width change** rather than invalidation, so the prefix sums stay
   approximately right during the resize.
3. **Adopt the duplicate-key repair and the anomaly report.** afleet keys rows by item id; the
   terminal found duplicate uuids often enough to build a `#N` dedupe and three named invariant
   reports. That is field evidence, not paranoia.
4. **Adopt the `compact_boundary` divider directive** — already built
   (`CompactBoundaryRow.swift`), see B-66.
5. **Reject the 300-item and 200-message caps.** They exist because a terminal cannot re-lay-out
   scrollback. afleet can, and its whole `[exceeds]` here is that **nothing is ever committed**:
   every row stays restylable, re-wrappable and searchable forever. Tracker 132's height-measurement
   cost is the thing to fix if a long transcript stalls, not a cap.

`[exceeds]` Because nothing is static, afleet can offer what the terminal explicitly cannot:
transcript-wide **search with highlight-in-place** (B-07's panel, but scoped to the timeline too),
re-wrapping on resize, and a theme change that repaints history.

**Drops / keeps / gains.** Drops: the 300/200/50/30/25/40 constants, the commit cursor, the four
static layers, `isStatic`, the repaint-trigger table. Keeps: scroll anchoring, the width-change
freeze, height caching keyed by identity, duplicate-key repair, the jump-to-bottom pill, the
compact divider. Gains: a transcript that is never frozen — searchable, re-wrappable, re-themable
to its first message.

**Open.** At what transcript length does tracker 132's per-reload hosting measurement actually
stall? A probe, not a design question — but it decides whether "no cap" survives contact.

### B-57 · Untrusted-text sanitising

**Terminal.** Two separate utilities with separate callers (SPEC 41.7.4), and the SPEC is explicit
that this is *not* a universal screen-rendering step. `ZU` strips
`\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}`, U+2028, U+2029, default-ignorable code points and U+2800 (Braille
blank), optionally preserving zero-width joiners and variation selectors. `up` starts with that and
then iterates **up to ten times** removing bidi overrides (U+202A–U+202E, U+2066–U+2069),
zero-width marks (U+200B–U+200F), U+FEFF and the private-use area until stable. Terminal
**notification** text is sanitised separately: every code point below 32 and every C1 control
(127–159) becomes a space. Against this, SPEC 41.17.2 renders a markdown `html` token as
`token.text` — **raw passthrough, unescaped and unsanitised**.

**Job.** Stop text the model did not write — a file, a web page, a tool result — from taking over
the display.

**Wire.** **R, and flagged security-relevant twice.**
`docs/tui-parity/areas/41-tui-rendering.md` §41.7.4: "*the CLI sanitises at paint time, so the host
receives the raw text … This is a security-relevant rebuild, not cosmetics.*" And §41.17:
"*markdown `html` tokens are raw passthrough in the TUI (R, security-relevant: implement the
passes, do not copy the passthrough)*".

**afleet today.** `built`, and **deliberately better than canon** — the one card in this lane whose
recommendation is to stay unfaithful. `App/Timeline/Rendering/TextSanitiser.swift` implements the
strip set as a single pass, exempting `\n` and `\t` (`:36-46`), and its doc comment states the
stakes: "*This is security-relevant and it is nobody else's in this cut. The engine sanitises at
paint time and the host receives the raw text*" (`:5-7`).
`ToolCallRow.swift:29-30, :88-92` records that **everything** derived from engine text goes through
it, not only `raw`. And `MarkdownText` **escapes** raw HTML where canon passes it through
(`TimelineRendering.swift:701-708`, `:858-861`, divergence noted at `:624-625`).

**GUI form.** Keep, and close three gaps.

1. **Add the bidi pass.** afleet implements `ZU`'s strip set but not `up`'s second stage —
   bidi overrides (U+202A–U+202E, U+2066–U+2069) and zero-width marks are not removed. A right-to
   -left override in a file path or a tool result is the classic display-spoofing attack and it is
   exactly what the terminal's ten-iteration loop exists to defeat. This is the one substantive
   security gap in the lane.
2. **Sanitise notification text separately.** The terminal has a distinct, stricter pass for
   notification strings (everything below 32 and 127–159 → space). afleet hands strings to
   `UNUserNotification` with no equivalent clamp. A notification is rendered by the OS, outside
   afleet's control, and it is the surface where a control character does the most damage.
3. **Keep the HTML escaping** permanently and record it, as afleet already does, as an intentional
   divergence from canon.

`[exceeds]` A GUI can do something a terminal cannot: *show* that text was sanitised. A row whose
content had characters stripped can carry a small dim `sanitised` marker with a hover explaining
what was removed, rather than silently altering what the user sees.

**Drops / keeps / gains.** Drops: the ten-iteration loop shape (one fixed-point pass is
equivalent). Keeps: the full strip set, `\n`/`\t` exemption, the single-source rule, HTML escaping.
Gains: bidi and zero-width removal; a notification-specific clamp; visible evidence of sanitising.

**Open.** None. This is a bug to fix, not a decision to take.

## 10. Copy, export, time

### B-58 · Selection, `copyOnSelect`, `copyFullResponse` and `/copy`

**Terminal.** Selection state is `{anchor, focus, isDragging, virtualAnchorCol, virtualFocusCol}`
(SPEC 41.13.3). Two rules make it usable: cells in the `noSelect` plane are skipped — with
`"from-left-edge"` extending the exclusion to column 0, so copying a message never picks up
`⏺`/`⎿` chrome — and the `softWrap` row plane lets a selection over wrapped rows reassemble into
the original logical lines. `followScroll` compensation keeps a selection anchored to content when
the container scrolls under it. `copyOnSelect` is a global-config boolean defaulting to **true**,
fullscreen only, labelled `Copy on select` in `/config`.

`/copy` is `Copy Claude's last response to clipboard (or /copy N for the Nth-latest)`
(SPEC 41.24.6). It opens a picker offering the full response plus **one entry per fenced code
block**, then an `Always copy full response` entry described
`Skip this picker in the future (revert via /config)`. The full-response entry is labelled
`Full response` with the description `<n> chars, <m> lines`. Every selection copies **and writes a
sidecar file** (directory mode `0700`, UTF-8, extension from the code block's language defaulting
to `.txt`), returning:

```text
Copied to clipboard (${n} characters, ${s} lines)
Also written to ${d}
```

On a clipboard failure the summary line is **unchanged** and a warning is inserted *between* the
two: `⚠ ${reason}; the file below is unaffected`. When the sidecar write also fails, the
`Also written to` line is dropped and the warning shrinks to a bare sign plus the reason. Choosing
`always` persists `copyFullResponse` and appends
`Preference saved. Use /config to change copyFullResponse`; the `/config` row is labelled
`Skip the /copy picker`, default false.

**Job.** Get text out — a whole answer, one code block, or an arbitrary selection — without a mouse
drag that also picks up chrome.

**Wire.** `/copy` is `local-jsx` and therefore **X** from a host
(`docs/tui-parity/areas/41-tui-rendering.md` §41.24.6) — a GUI must rebuild it. Clipboard transport
is T (OSC 52 or a platform tool). The inventory flags the selection rule as "*the single most
copyable selection rule: **chrome must be unselectable and wrapped lines must copy as one logical
line***".

**afleet today.** `undesigned`, and it is a conspicuous hole in a Slack-shaped window. There is
**no `NSPasteboard` write, no context menu and no Copy button anywhere** under `App/Timeline/`.
The only copy affordance is `.textSelection(.enabled)` on four sub-views — `ThinkingDisclosure.swift:61`,
`ToolCallRow.swift:112`, `OpaqueRow.swift:32`, `TimelineRendering.swift:253` — and `RowFrame`
itself is not selection-enabled, so there is **no cross-row selection**: a user cannot drag from
one message into the next. afleet does inherit the `noSelect` property structurally (B-03), since
author, badge and timestamp are not selectable.

**GUI form.** Region: Timeline, context menus and hover actions. Four affordances, replacing one
command and one setting.

1. **Cross-row selection.** Make the timeline's text layer selectable across rows, excluding
   chrome, with wrapped lines copying as one logical line. This is the terminal's rule and it is
   the baseline every macOS user expects.
2. **`Copy message`** on hover and in the row's context menu — the terminal's `/copy` full-response
   case, one click instead of a command and a picker.
3. **`Copy code`** on every fenced code block (B-51) — the terminal's per-code-block picker
   entries, made direct.
4. **`Copy row`** / **`Copy result text`** on tool rows (B-03), which is what a `noSelect` gutter is
   really protecting.

Drop `copyOnSelect`: it is a terminal convention that fights macOS conventions, and afleet is not
fullscreen-only. Drop `copyFullResponse` and the picker with it — the picker exists because a
terminal has one gesture; a GUI has hover menus. Keep the **sidecar file** idea as
`Save code block as…` on a code block, because writing a 400-line block to a file is genuinely
useful and afleet has `NSSavePanel`. Keep the confirmation counts (`<n> characters, <m> lines`) as
a brief toast — they are the only feedback that the right thing was copied.

**Drops / keeps / gains.** Drops: `/copy`, its picker, `copyOnSelect`, `copyFullResponse`, OSC 52,
the three-line failure composition. Keeps: chrome excluded from selection, wrapped-line
reassembly, the character/line counts, the sidecar-file idea as a save action. Gains: cross-row
selection; per-message and per-block copy without a command.

**Open.** None.

### B-59 · `/export`

**Terminal.** `Export the current conversation to a file or clipboard`, argument hint `[filename]`
(SPEC 35.21). The export is **plain text only** — produced by rendering the transcript through the
same renderer the detailed-transcript view uses, concatenating the static frames with no separator,
and stripping ANSI. **There is no JSON or Markdown option**, and no width option is passed, so it
uses the renderer's default width. The menu copy:

```text
Export conversation
Select export method
  Copy to clipboard      Copy the conversation to your system clipboard
  Save to file           Save the conversation to a file in the current directory
Enter filename:
```

(The second description becomes `… in the directory claude was launched from` when the workspace is
remote and the launch directory differs.) Results: `Conversation copied to clipboard`,
`Conversation exported to: <path>`, `Failed to export conversation: <error>`, `Export cancelled`.
The filename pattern is `<YYYY-MM-DD-HHMMSS>-<slug>.txt`, falling back to
`conversation-<stamp>.txt`; the slug is the first user message's first line, truncated to 49
characters plus `…` only when it exceeds 50, lowercased, non-alphanumerics collapsed to `-`. A
relative path resolves against the launch directory in remote workspaces and the current directory
otherwise; parent directories are created. Distinct from `/export`: the transcript viewer's `v` key
writes `cc-transcript-<epochMillis>.txt`, opens it in `$VISUAL`/`$EDITOR`, and *does* set a width
(`max(80, columns − 6)`) and trim trailing whitespace.

**Job.** Take the conversation somewhere else — a bug report, a document, a colleague.

**Wire.** **X → R.** `docs/tui-parity/areas/28-slash-commands.md`: `/export` is `local-jsx` and
absent from the live headless command list; the live refusal is
`/export isn't available in this environment.`, delivered as an **assistant** frame with no user
echo. So a host must rebuild it entirely — and it has better material, since afleet holds the
records. README §7 lists "*real export formats instead of `/export`*" among the places the GUI
exceeds.

**afleet today.** `undesigned`. Zero hits for `NSSavePanel`, `.fileExporter` or a transcript writer
across `App`, `FleetKit/Sources` and `Workbench/Sources`.

**GUI form.** Region: **Menu bar** (File ▸ Export Conversation…, ⌘⇧E) plus the channel header's
overflow menu. This is one of the study's clearest cases for the menu bar, which root spec §2 notes
is "*largely unused so far — a legitimate destination for many terminal keybindings and
commands*".

An `NSSavePanel` with a format popup, because the terminal's single plain-text format is a
limitation, not a choice:

| Format | Contents |
|---|---|
| **Markdown** (default) | Messages as prose, tool calls as collapsed detail blocks, diffs as fenced diffs, timestamps optional |
| **Plain text** | Canon's format, for parity |
| **JSON** | The records, which is what the Raw view (B-07) shows and what a bug report needs |
| **HTML** | Self-contained, with images inline — the only format that survives a screenshot-heavy session |

Keep the filename pattern verbatim — `<YYYY-MM-DD-HHMMSS>-<slug>.txt` with the same slug rules — it
is well designed and it sorts. Keep all four result strings, retargeted (`Conversation exported to:
<path>` becomes a toast with a `Reveal in Finder` action). Keep `Copy to clipboard` as a second
menu item. `[exceeds]` **Export a selection or a turn range**, not only the whole conversation: the
terminal has no message selection to scope by; afleet does (lane F's message selector). `[exceeds]`
`Export all channels in this project` for a fleet-level report.

**Drops / keeps / gains.** Drops: the slash command, the two-step picker, plain-text-only, the
`v`-key editor variant. Keeps: the filename pattern and slug rules, the four result strings, the
clipboard option. Gains: four formats; scoped export; reveal-in-Finder.

**Open.** Is Markdown or JSON the better default? Markdown for humans, JSON for filing an issue
against afleet. Suggest Markdown, with JSON one click away.

### B-60 · Timestamps, turn duration and the turn-summary row

**Terminal.** Three settings and one row.

`showMessageTimestamps` is a boolean, **default false**, described `Stamp each message with its
arrival time`; its `/config` row is `Show message timestamps` and it sits under
**Experimental** (SPEC 41.26.2). `timeFormat` defaults to `auto` and takes
`auto` / `12-hour` / `24-hour` / `24-hour-utc` ("18:05Z") **or a strftime pattern** — any value
containing `%` — with the documented caveat that "*A pattern replaces the time everywhere; message
timestamps show only the pattern, so include %Y-%m-%d for the date*". `timeZone` takes an IANA name
and falls back to the system zone on an unknown one. `timeFormat` sits under **Display**.

`showTurnDuration` is a boolean, **default true**, `/config` row `Show turn duration`, described in
the settings schema as `Show "Cooked for Nm Ns" after each assistant turn`. The row it controls is
drawn with the `✻` glyph (`Dw = "✻"`, `cli.pretty.js:282803`) and reads
`<Verb> for <duration> · done <clock>` — where the verb is chosen deterministically by hashing the
message uuid against
`["Baked", "Brewed", "Churned", "Cogitated", "Cooked", "Crunched", "Sautéed", "Worked"]` with a
fallback of `Worked` (`cli.pretty.js:839089`, verified). Optional suffixes, all ` · `-joined
(`cli.pretty.js:839480`, verified): a budget readout `<used> / <limit> (NN%)` or
`<used> used (<limit> min ✓)`; `· N nudges`; `<N> messages hidden (/focus to show)`;
`Waiting for <N> background agents and <M> dynamic workflows to finish`; and
`· <N> still running`. The whole row is **hidden** when there is no budget limit, no hidden count,
no pending agents and no pending workflows (`cli.pretty.js:833212`) — so in an ordinary turn with
`showTurnDuration` on, you get the verb line and nothing else.

**Job.** Two different jobs. A timestamp says *when*; a turn summary says *how long and what it
cost*.

**Wire.** P for the data, R for the rendering. The `turn_duration` record carries `durationMs`,
`budgetTokens`, `budgetLimit`, `budgetNudges`, `messageCount`, `pendingBackgroundAgentCount` and
`pendingWorkflowCount` (SPEC 11.14.4); it is a display record and is on afleet's own
never-on-the-wire exclusion list for the record reducer (root spec §7.3), i.e. it comes from the
transcript file, not the stream.

**afleet today.** `built`, with a different default and a different composition. Every row that
passes a timestamp to `RowFrame` shows an absolute `HH:MM:SS` in
`.caption2.monospacedDigit()` (`MessageRows.swift:35-38`) — so afleet's timestamps are **always
on**, where canon's default is off. `CompactBoundaryRow`, `DecisionRow` and `SentFileRow` show
none. There is no `RelativeDateTimeFormatter` anywhere in the repo, no time-format setting and no
time-zone setting. The turn summary is `TurnSummaryRow.swift`: author `Turn`, badge `stopReason`,
headline `<N> turns · 12.4s · $0.0431` (`:39-43`), folded by default (`:6`), with
`<n> permission denial(s) this turn` and the subtype in the disclosure (`:28`, `:32`). So afleet
adds **cost**, which canon's turn row does not carry, and drops the verb, the `done <clock>` suffix
and the pending-work clauses.

**GUI form.** Region: Timeline row.

*Timestamps.* Keep them on by default — canon's default-off is a vertical-space decision and afleet
has a horizontal column for them. Two changes. (a) Show `HH:MM` and put seconds in the tooltip;
seconds on every row is noise, and `HH:MM:SS` monospaced is wide. (b) `[exceeds]` Add a **relative**
reading for recent rows (`2m ago`) that switches to absolute past an hour — the Slack convention,
and afleet has no `RelativeDateTimeFormatter` today. Add the timestamp to `CompactBoundaryRow` and
`DecisionRow`, which currently have none. Carry `timeFormat`'s four presets into afleet Settings and
skip the strftime escape hatch; carry `timeZone`, because a user watching a fleet across zones needs
it and it is one formatter parameter.

*Turn summary.* Merge afleet's row with canon's. Proposed line:
`✻ Cogitated for 1m 04s · done 3:45pm · 3 turns · $0.0431`, with the verb kept — it is the terminal's
one piece of personality and it costs a hash — and cost kept, which is afleet's addition and matters
more in a fleet. Keep canon's hide-when-empty rule inverted: afleet should always show the row,
because it is the turn boundary and a Slack-shaped timeline needs one; canon hides it because a
terminal cannot afford a divider. Named deviation. Keep all four suffix clauses verbatim, including
`<N> messages hidden (/focus to show)` retargeted to the density control (B-10) and
`Waiting for N background agents … to finish`, which is a genuinely useful liveness signal.
`[exceeds]` Make `3 turns` and `$0.0431` click through to the Activity view filtered to this turn.

**Drops / keeps / gains.** Drops: `showMessageTimestamps` default-off, strftime patterns, the
hide-when-empty rule, `✻`. Keeps: the eight verbs and their hash selection, `done <clock>`, the
budget and nudge readouts, the pending-work clauses, the four `timeFormat` presets, `timeZone`.
Gains: relative times; cost in the turn row; timestamps on every row kind; click-through to
Activity.

**Open.** Keep the random verb? It is charming in a terminal and may read as noise in a work
window. Owner call; my reading is keep it — it is the only warmth in the transcript.

## 11. Attachments, echoes and system rows

### B-61 · Command echo wrappers

**Terminal.** A slash command that runs locally does not appear as itself; it appears as a wrapped
user message (SPEC 28 §10). Six tag constants exist: `command-name`, `command-message`,
`command-args`, `local-command-stdout`, `local-command-stderr`, `local-command-caveat`. A
`local` / `local-jsx` command emits, **with literal 12-space indentation on the second and third
lines**:

```text
<command-name>/${name}</command-name>
            <command-message>${name}</command-message>
            <command-args>${args}</command-args>
```

A `prompt` command emits a different field order with **no** indentation and drops
`<command-args>` when empty. Output is wrapped `<local-command-stdout>…</local-command-stdout>` and
`<local-command-stderr>…</local-command-stderr>`; an empty `local-jsx` result renders
`<local-command-stdout>(no content)</local-command-stdout>`. A caveat is prepended to commands that
did not request a model turn, on a message marked `isMeta: true`:
`Caveat: The messages below were generated by the user while running local commands. DO NOT respond
to these messages or otherwise consider them in your response unless the user explicitly asks you
to.` The terminal recognises a message as harness-generated when its text starts with
`<local-command-stdout>`, `<local-command-stderr>`, `<command-message>`, `<command-name>`,
`<bash-input>` or `<task-notification>`, strips the markup, and shows the command name and args and
the stdout body. The somersault clone found that `<local-command-stdout>` renders as **markdown**,
not plain lines (`CC-to-SDK/docs/parity/tui-ux.md` §2 row 14).

**Job.** Show what command you ran and what it printed, without showing the plumbing.

**Wire.** P for the data. `docs/tui-parity/areas/30-29-32-plugins-skills-styles.md` records that
these wrappers ride the wire and states the consequence bluntly: "*A GUI must do the same grouping
or the user sees a raw XML blob as a 'user message' — this is the single most visible skills
rendering task.*" The first wrapper carries `sourceToolUseID`.

**afleet today.** `undesigned`, and this is a **visible defect**, not just a gap.
`MessageRows.UserMessageBody` renders a user frame's text as markdown with no wrapper detection, so
a `local` command echo currently renders as literal XML in a right-aligned user bubble. Nothing in
`App/Timeline/` greps for `<command-name>` or `<local-command-stdout>`. The root spec's §7.3
reducer rules hide `isSynthetic` frames, and the caveat message is `isMeta: true` — so the caveat
is hidden — but the echo itself is not synthetic and is not hidden.

**GUI form.** Region: Timeline row, a distinct row kind. Parse the six tags, drop the markup, and
render:

```
▎ ⌘ /export                                                        18:41:55
▎ Conversation exported to: ~/2026-09-10-183012-fix-the-parser.txt
```

— a command chip carrying the name and args, then the stdout body rendered as **markdown** (canon's
behaviour), stderr in `.red`, and `(no content)` verbatim for the empty case. Keep the caveat
message hidden. Suppress the raw wrapper text entirely; it is model-facing.
`[exceeds]` Make the command chip clickable to re-run it in the composer, and make an echoed
command's row visually a **user action**, not a user *message* — a subtly different kind of row,
which the terminal cannot express because it has one user prefix.

This card is a prerequisite for B-33: the skill-loading variant uses the same tags with
`<skill-format>true</skill-format>` and **no leading `/`** on the name, and without wrapper parsing
every skill invocation shows as XML.

**Drops / keeps / gains.** Drops: every tag, the 12-space indentation, the two field orders, the
caveat text. Keeps: the command name and args, the stdout body as markdown, `(no content)`, stderr
distinction. Gains: commands as a distinct row kind; re-run.

**Open.** None. This is a defect with a known fix.

### B-62 · Queued command echoes and queued messages

**Terminal.** `queued_command` is one of only three attachment types that reach the wire at all
(the others being `tool_host_result_lines` and `hook_system_message`). SPEC 11.8.3 records a detail
that matters for rendering: a `queued_command` "*is rendered twice, once normally and once with
`inHumanTurn: true`*", carried in a `renderedInHumanTurn` field that is new in 2.1.263 and exists
for `queued_command` only.

**Job.** Show a message you typed while the model was busy, in the place it will be sent, before it
is sent.

**Wire.** P — `queued_command` is one of the three surviving attachment types
(`docs/tui-parity/areas/11-14-query-loop-tool-interface.md`, which records that ~31 of 35 attachment
types vanish and calls it "*the single largest structural loss in ch. 11*").

**afleet today.** The **queue chip** is lane C's (root spec §2 composer region: "*queue chip*";
C6.2 spec). The transcript-side echo — the row a queued command produces once it is sent — is
`undesigned` and falls into B-61's problem: it arrives as a wrapped user frame.

**GUI form.** Region: Composer (the chip, lane C) and Timeline (the echo). The timeline side is
small and follows B-61: render the queued command as a command row when it is sent, and while it is
queued show it **dimmed, in place, at the bottom of the timeline** rather than only as a chip — the
terminal's double render is exactly this idea (once queued, once in the turn), and a Slack-shaped
window has an obvious form for it: the pending-message treatment every chat client uses.
`[exceeds]` A queued message should be cancellable from the timeline row, not only from the chip.

**Drops / keeps / gains.** Drops: `inHumanTurn` as a mechanism. Keeps: the double render's meaning
— queued now, sent later. Gains: the pending message visible where it will land; cancel in place.

**Open.** Overlaps lane C's queue chip. Orchestrator should assign the composer half to C and the
timeline half here.

### B-63 · Hook system messages and hook rows

**Terminal.** `hook_system_message` is the third wire-visible attachment type, and it **renders to
nothing** in the transcript (SPEC 11.8.2 marks it R, ∅). Hook activity appears in exactly one
place: a sub-line under a tool cluster reading `  ⎿  Ran 3 PreToolUse hooks (412ms)`
(`cli.pretty.js` ~838471, verified). Hook sub-lines use the 7-column second-level gutter
(SPEC 41.16.3). System rows generally fold at 5 lines and 200 characters (SPEC 41.23.1) and key
their bullet off level: `warning` → the warning colour, `notice` → `inactive`, `info` → **no bullet
at all** plus dim text (SPEC 41.16.2). The somersault clone found the hook line **unreachable** from
the SDK wire (probe 85).

**Job.** Know that your own automation ran, and what it cost.

**Wire.** Mixed. `hook_system_message` is one of the three surviving attachment types
(`areas/11-14-query-loop-tool-interface.md`), and `hook_started` / `hook_progress` /
`hook_response` frames exist — root spec §7.3 builds a `hookRun(HookRun)` item from them. But the
cluster's `Ran N PreToolUse hooks (Xms)` line was found unreachable by the clone's probe 85, so the
aggregate timing may not be reconstructible.

**afleet today.** `built`, and richer than canon. `App/Timeline/Rendering/Rows/NoticeRows.swift`
draws a `HookRunRow` with the event as author, the outcome as badge, the hook name in the body, and
`exit <code>` in red when non-zero (`:8-22`), plus a `NotificationRow` with author
`Notice` / `Notice (file only)` and error-level text in red (`:30-46`). The terminal renders hook
system messages as nothing and hook activity as one aggregate line; afleet draws a row per run.

**GUI form.** Region: Timeline row. Keep afleet's per-run rows — they are better — but adopt the
terminal's **aggregation** when a turn has many: collapse consecutive hook runs into one row reading
`Ran 3 PreToolUse hooks · 412 ms`, expandable to the individual rows. That is canon's sentence and
afleet's data, and it stops a turn with eight hooks from being mostly hooks. Keep the non-zero exit
code in red and keep the outcome badge. Keep the terminal's system-row **level vocabulary** —
`warning`, `notice`, `info` — and its rule that `info` gets no ornament at all; afleet's
`NotificationRow` should follow it rather than drawing every notice identically.
`[exceeds]` A failing hook belongs in the Activity view (failures are an Activity category), and
`Open hook config` from the row's menu.

**Drops / keeps / gains.** Drops: the 5-line/200-character system fold, the 7-column gutter,
`hook_system_message` rendering to nothing (afleet shows it). Keeps: the aggregate sentence, the
three levels and their ornamentation, the exit code. Gains: per-run detail with aggregate
collapse; hook failures visible from outside the channel.

**Open.** Is the aggregate `(412ms)` timing reconstructible from `hook_started` / `hook_response`
timestamps? Probably, and it is a probe, not a design question.

### B-64 · Skill-loading metadata and the vanished attachments

**Terminal.** SPEC 11.8.2 catalogues **114 attachment type names**, two new in 2.1.263 and both
rendering to nothing (`thinking_stripped` and `deferred_tools_record`). Sixteen types are a literal
no-op list (`autocheckpointing`, `background_task_status`, `todo`, `task_progress`, `ultramemory`,
`compaction_reminder`, `current_session_memory`, `thinking_reminder`, `companion_intro`,
`pen_mode_enter`, `pen_mode_exit`, `ultrawork_request`, `echo_activities`, `verify_plan_reminder`,
`fold_nudge`, `context_tip`), and an **unknown** attachment type is **silently dropped** — the
error reporter it routes through is inert in this build. Skill loading uses the command-echo tags
with a third tag and no leading `/`:

```text
<command-message>${name}</command-message>
<command-name>${name}</command-name>
<skill-format>true</skill-format>
```

There is also one shared ambient-context sentence appended by several delta renderers:
`This is ambient context — do not narrate it to the user unless they ask or it is directly relevant
to their request.`

**Job.** Most of these are model-facing plumbing. The few that are not — skill loading, file and
IDE attachments, plan-file references — tell the user what context entered the conversation.

**Wire.** **D, heavily.** `docs/tui-parity/areas/11-14-query-loop-tool-interface.md`: about
**31 of 35** TUI-visible attachment types vanish before the wire; only `queued_command`,
`tool_host_result_lines` and `hook_system_message` survive. The inventory calls it "*the single
largest structural loss in ch. 11*". Separately, `isSynthetic` on the wire conflates `isMeta`,
`isVisibleInTranscriptOnly` and `isCompactSummary` into one flag — class D — with the guidance
"*A GUI should not render `isSynthetic` user frames as user messages*".

**afleet today.** `built` for the hiding, `undesigned` for the showing. Root spec §7.3's reducer
rule is "*`user` frames with `isSynthetic` (meta reminders such as 'Available agent types') are
hidden from the timeline and kept only in the raw view*", which is exactly right and matches the
inventory's guidance. `App/Timeline/Rendering/Rows/SentFileRow.swift` renders the one attachment
afleet mints itself (`mcp__afleet__send_user_file`), mounting C6.3's view with the copy
`Delivered.` / `Not delivered.` /
`This file could not be read, so no preview is shown.`. The skill-loading echo shows as raw XML
(B-61).

**GUI form.** Region: Timeline. Three rules rather than 114 forms.

1. **Hide the plumbing.** Keep hiding `isSynthetic` frames, and keep them in the Raw view (B-07) —
   which is the only reason the Raw view has to exist for this family. Never render the ambient
   -context sentence.
2. **Show the four that carry user meaning**, each as a small chip row rather than prose: a skill
   was loaded (B-33), a file or IDE selection was attached (`⧉`, B-01), a plan file was referenced,
   a compact file was referenced. These are "context entered the conversation" events and a
   workspace should say so.
3. **Do not silently drop an unknown attachment.** Canon's reporter is inert, so an unrecognised
   type disappears. afleet already has the right answer — `OpaqueRow` renders unmodelled frames as
   canonical JSON with the design note "*Never nothing, and never fatal*"
   (`OpaqueRow.swift:8-10`) — and should route unknown attachments there rather than dropping them.
   `[exceeds]`, and it is the honest behaviour.

Because ~31 of 35 types never reach the wire, most of this card is a **negative** result: the
denominator is large and the reachable set is three. Record it and move on.

**Drops / keeps / gains.** Drops: 100-odd attachment forms that never reach a host anyway, the
ambient-context sentence, silent dropping. Keeps: `isSynthetic` hiding, the raw-view retention,
`SentFileRow`'s three strings. Gains: unknown attachments visible instead of vanished; context
entries as chips.

**Open.** None.

### B-65 · Sent files and user attachments

**Terminal.** Attached files render as a row `› [image] <path> (<size>)` or `› [file] …`, the glyph
being U+203A SINGLE RIGHT-POINTING ANGLE QUOTATION MARK (SPEC 41.17.9). IDE selections and
artifacts are prefixed `⧉` (SPEC 41.16.1). There is no terminal equivalent of afleet's outbound
`send_user_file` — that tool is afleet's own.

**Job.** Show what you gave the model, and what it gave back.

**Wire.** P inbound (attachment paths and sizes ride the user frame); afleet's own MCP server
supplies the outbound direction.

**afleet today.** `built` in both directions, and the outbound side has no canon at all.
`MessageRows.UserMessageBody:118` joins attachment names with `" · "` — names only, no sizes, no
thumbnails. `App/Timeline/Rendering/Rows/SentFileRow.swift` mounts C6.3's `SentFileRowView`
(`App/Decisions/SentFileRowView.swift:82`) with `Delivered.` (`:102`), `Not delivered.` (`:103`)
and `This file could not be read, so no preview is shown.` (`:106`), plus resolved `FileLinkLabel`s
— empty without a context and empty for a relative path with no cwd (`:53-58`).

**GUI form.** Region: Timeline row. Inbound: replace the `" · "` name list with a row of chips
carrying an icon, the filename, the size and — for images — a thumbnail (B-17, B-53). Keep the size:
it is the terminal's one quantitative fact and it is the one that explains a slow turn. Keep `⧉`
for an IDE selection, and render a selection chip as `<file>:<startLine>-<endLine>` linking into the
Files panel at the range. Outbound: keep `SentFileRow` as built, add a thumbnail or file-type icon,
and add `Reveal in Finder` / `Open` actions. `[exceeds]` Drag a file onto a timeline row to attach
it — a window affordance with no terminal analogue, though that is lane C's composer surface.

**Drops / keeps / gains.** Drops: `›`, `[image]` / `[file]` as text tokens, the `" · "` join.
Keeps: the size, `⧉`, the three `SentFileRow` strings. Gains: thumbnails, sizes on every
attachment, links into Files, reveal/open.

**Open.** None.

## 12. Compaction

### B-66 · The compact boundary

**Terminal.** A **dim system row** whose text is the literal `Compacted`, with no glyph
(SPEC 13.19.3). Its detail line is one of `<summary> (<binding> to see them)` or
`<binding> for history`, where the binding is the current `app:toggleTranscript` chord — so the
usual rendering is `Compacted   3 messages summarized (ctrl+o to see them)`. The summary clause is
`<N> message(s) summarized` when `messagesSummarized > 0`, else `<tokens> tokens summarized` when
`preTokens > 0`, else nothing (`cli.pretty.js:833265`, verified). The underlying record is
`content: "Conversation compacted"`, `level: "info"`, with
`compactMetadata: {trigger, preTokens, userContext, messagesSummarized}`. The summary itself is
minted as a user message with `isCompactSummary: true` and `isVisibleInTranscriptOnly: true` — a
transcript-only row.

**Job.** Mark the seam where the conversation's history was replaced by a summary, and give a way
back to what was there.

**Wire.** **P for the boundary, R with a catch for the summary.**
`docs/tui-parity/areas/13-10-23-context-memory-session-tools.md`: the frame carries snake_case
`compact_metadata` with `trigger`, `pre_tokens`, `post_tokens`, `cumulative_dropped_tokens`,
`duration_ms`, `user_context`, `messages_summarized`, `precomputed`,
`pre_compact_discovered_tools`, `preserved_segment` and `preserved_messages`. The catch: the summary
arrives as an ordinary `user` frame and `isVisibleInTranscriptOnly` is **not** on the wire, so it
must be detected by its text always beginning
`This session is being continued from a previous conversation that ran out of context.` **One
cross-corpus disagreement to note:** the somersault clone read the live `compact_boundary` frame key
by key at 2.1.220 and found the message count **not present** (`CC-to-SDK/docs/parity/tui-ux.md` §2
row 21, "*P81*"), while afleet's inventory records `messages_summarized` on `compact_metadata` at
2.1.259. Version skew is the likely explanation; a design that depends on the count should verify at
the target version.

**afleet today.** `built`. `App/Timeline/Rendering/Rows/CompactBoundaryRow.swift` draws a hairline
rule with a label from `label(of:)` (`:26-34`): the trigger defaults to `"unstated"`; without token
counts it reads `Truncated (<trigger>)` or `Compacted (<trigger>)`; with them,
`Compacted (auto) · 154000 → 12000 tokens`. Orange when `hardTruncation` (`:18`). No timestamp and
no author. Root spec §8.3: "*compaction is a divider*". §7.3 records the live/reopen asymmetry
honestly: "*During a live session the items before the boundary stay on screen; after a reopen the
timeline shows the boundary and the summary in their place. This is stated behavior, not drift.*"

**GUI form.** Region: Timeline, a full-width divider. Keep afleet's row — the hairline rule is the
right GUI form and canon's dim text row is a terminal doing its best. Four additions.

1. Keep afleet's `<pre> → <post> tokens` readout; it is better than canon's single number and the
   wire carries both.
2. Add the **message count** when `messages_summarized` is present, keeping canon's wording:
   `Compacted · 42 messages summarized · 154k → 12k tokens`. Verify availability at the target
   version first (see the disagreement above).
3. Replace `(ctrl+o to see them)` with a **`Show summary` disclosure** on the divider itself,
   rendering the summary message inline — detected by its opening sentence. The summary is the most
   important thing at a compact boundary and canon hides it behind a mode.
   `[exceeds]` Also offer `Show what was summarised`, which the Raw view (B-07) can supply and the
   terminal can only reach through `ctrl+o`.
4. Keep `Truncated` distinct from `Compacted` and keep the orange for a hard truncation — canon has
   no such distinction and afleet's is more truthful.

Add a timestamp; every other row kind has one and a boundary's time is meaningful.

**Drops / keeps / gains.** Drops: `(ctrl+o to see them)`, `for history`, dim-text-as-divider.
Keeps: `Compacted`, the summarised-message wording, the trigger, the token counts, the
truncation distinction. Gains: the summary readable inline; the pre-compaction history reachable;
a timestamped seam.

**Open.** Confirm `messages_summarized` is present at afleet's target CLI version — a probe.

### B-67 · The five-phase compaction progress

**Terminal.** `applyCompactProgress` has exactly five arms (SPEC 13.19.4), which drive the spinner
rather than the transcript:

| Event | Message |
|---|---|
| `hooks_start` `pre_compact` | `Running PreCompact hooks…` |
| `hooks_start` `post_compact` | `Running PostCompact hooks…` |
| `hooks_start` `session_start` | `Running SessionStart hooks…` |
| `compact_start` | `Compacting conversation` plus an optional hint, with `isCompacting` set |
| `compact_end` | resets the overrides |

Hook events also switch the spinner to the blue "system" colour pair. Remote sessions render
`sdk_status: "compacting"` as a system record reading `Compacting conversation…`. The failure
strings are `Not enough messages to compact.`,
`Conversation too long. Press esc twice to go up a few messages and try again.`,
`Compaction blocked by PreCompact hook`, and
`Compaction interrupted · This may be due to network issues — please try again.`, with two toasts:
`Error compacting conversation` (error colour) and `compaction blocked by PreCompact hook`
(warning).

**Job.** Explain a long pause during which nothing else can happen.

**Wire.** **D (minor).** `docs/tui-parity/areas/13-10-23-context-memory-session-tools.md`:
`compact_progress` is dropped before the wire. The remote `sdk_status: "compacting"` path is the
only progress signal a host gets.

**afleet today.** `undesigned`. Nothing renders a compaction in progress; the boundary row appears
only once compaction has finished.

**GUI form.** Region: **Channel banner** (root spec §2 lists a strip above the timeline) plus the
sidebar badge. A compaction blocks the whole session for tens of seconds and the honest form is a
banner, not a spinner line: `Compacting conversation…` with an indeterminate bar. Use the
`sdk_status` signal where it exists and infer from the turn otherwise; keep the three hook messages
verbatim if `compact_progress` ever reaches the wire, since they explain a pause that is *not*
the model's fault. Keep all four failure strings and both toasts, retargeting
`Press esc twice to go up a few messages` — that is lane F's rewind picker in afleet, so the copy
becomes `Rewind a few messages and try again`. Named deviation, and forced by the gesture not
existing.
`[exceeds]` Because a compaction is per channel and afleet shows many, the sidebar row should carry
a compacting state so a user does not switch to a channel that is mid-compaction and think it hung.

**Drops / keeps / gains.** Drops: the spinner colour pair, `esc twice` as a gesture. Keeps: the five
phase messages, all four failure strings, both toasts. Gains: a banner instead of a spinner line;
a per-channel compacting state in the sidebar.

**Open.** None.

### B-68 · Microcompact

**Terminal.** Nothing is drawn, twice over (SPEC 13.15.6). Microcompact removes the **bodies** of
old tool results without summarising anything, replacing each with
`[Old tool result content cleared]` (spill sentinel `<persisted-output>`), keeping the five most
recent eligible results intact and freeing at least 20,000 tokens toward a 75,000-token target. A
system record with `subtype: "microcompact_boundary"` is recognised by the transcript renderer and
**rendered as nothing** — and "*No code path in this build constructs one*". So the user sees
neither the boundary nor the clearing.

**Job.** Free context silently. The design intent is that it is invisible.

**Wire.** **D.** `docs/tui-parity/areas/13-10-23-context-memory-session-tools.md`: microcompact's
`hint_clears` is "*explicitly not emitted on the SDK stream*"; the CLI rewrites old tool results in
place to `[Old tool result content cleared]` or a `<persisted-output>Tool result saved to: <path>`
pointer. The consequence for a host is stated bluntly: "*The GUI's own copy of the transcript
silently goes stale … **Workaround**: none on the wire.*"

**afleet today.** `undesigned`, and correctly so for the display — but the **staleness** is a real
correctness issue nobody has addressed. afleet's record reducer holds the original tool results; the
CLI's on-disk transcript has had them rewritten. On a reopen, afleet re-reads the file (root spec
§7.3, "*on process exit the record reducer re-reads each stream's file and reconciles by uuid*")
and will find cleared bodies where it previously held content.

**GUI form.** Region: Timeline row, minimally. Follow canon and draw **no boundary** — the whole
point is invisibility, and a divider for "some old output got smaller" is noise.

Do one thing canon does not: when a tool result's body reads `[Old tool result content cleared]`
after a reload, render it as a dim state on the row — `Output cleared to free context` — rather than
as the literal sentinel or as an empty result. And when the replacement is a
`<persisted-output>Tool result saved to: <path>` pointer, make the path a `FileLink` so the output
is still reachable. `[exceeds]` afleet holds the pre-clear content in memory during a live session;
it can keep showing it, and should, because a GUI's transcript need not degrade just because the
model's context did. That is the sharpest example in the lane of afleet being able to keep something
the terminal must throw away.

**Drops / keeps / gains.** Drops: nothing (nothing is drawn). Keeps: invisibility as the default.
Gains: a readable state instead of a sentinel; persisted output reachable; live content retained
across a clear.

**Open.** Should afleet's reducer prefer its in-memory copy over a re-read file when the file's
version is a clearing sentinel? That is a reducer rule, not a rendering one, and belongs to whoever
owns §7.3's source arbitration — but this card is where the requirement surfaces.

---

## Ranking input

`built*` means built but materially incomplete against the terminal. Cost is for the afleet work
this card proposes, not for the terminal behaviour.

| Card | Surface | afleet status | User value | Build cost | Depends on |
|---|---|---|---|---|---|
| B-01 | Chrome glyphs → author identity, tint, left rule | superseded (built) | med — legibility at a glance | S — icon set + a rule | — |
| B-02 | Bullet state machine (4 states) | built* — no `queued` | med — in-flight vs blocked | S — one case | B-14 |
| B-03 | Gutters, indent, unselectable chrome | built | low — already correct | S — left rule + copy actions | B-58 |
| B-04 | User row and the input-box rules | built | low — v1 has no teams | S — bash-mode fill | — |
| B-05 | Assistant prose row and streaming tail | built | med — streaming cue | S — a shimmer | B-55 |
| B-06 | The fold | built* — no count, no persistence | **high** — every result row | S — count + a store | B-14 |
| B-07 | `ctrl+o` → Raw transcript panel tab | routed-only | **high** — the missing third layer | M — a panel tab + search | B-56, ThreadView route |
| B-08 | `ctrl+e` show all | superseded | low — no cap exists | S — nothing to build | B-56 |
| B-09 | `verbose` | undesigned | med — a default-density switch | S — one toggle | B-06, B-10 |
| B-10 | Brief / `/focus` / three-layer control | routed-only | **high** — names the layer model | M — a control + per-turn override | B-06, B-12 |
| B-11 | Thinking blocks | built | med — tense + redaction | S | tracker 127, 138 |
| B-12 | The tool-call cluster | built* — counts only, no categories | **high** — the most-seen row | M — categorised parts + clickable counts | B-14, tracker 128 |
| B-13 | Speaker labels / work segments | superseded | low — teams out of v1 | S — attribution run-grouping | — |
| B-14 | The renderer side table | built* — 10 of ~40 | **high** — the seam for all of §5 | M — a `structured` slot + 2 states | — |
| B-15 | Shared primitives + error form | built | med — `non_execution_kind` | S | B-44, B-45 |
| B-16 | `Read` text | built | med | S — 2 strings + hover path | B-14 |
| B-17 | `Read` image / PDF / notebook | built* — no pixels | **high** — a free visual win | M — image, PDF strip, cell view | B-14, B-53 |
| B-18 | `Edit` | built* — count, no diff | **high** — highest value per cost | S — route `structuredPatch` | B-40 |
| B-19 | `Write` | built* — no highlighting | med | S | B-51 |
| B-20 | `MultiEdit` | superseded | none — not a tool in 2.1.263 | none | — |
| B-21 | `NotebookEdit` | undesigned | med | M — a cell view | B-14, B-17 |
| B-22 | `Bash` header + completed result | built* — 3 of 4 states | **high** — most-run tool | S — 2 strings + git chips | B-14 |
| B-23 | `Bash` live output, background, sandbox | built* — records the gap | **high** — the biggest wire gap | M — tail the file + honest state | root spec §7.3 tailer |
| B-24 | `TaskOutput` / background tasks | built (row), undesigned (form) | med | S — delegate by kind | B-22, B-29 |
| B-25 | `Glob` | built | med — clickable results | S | B-14 |
| B-26 | `Grep` | built | **high** — grouped clickable matches | M — a results list | B-14, FileLink |
| B-27 | `WebFetch` | built | med — markdown body | S — one routing change | B-48 |
| B-28 | `WebSearch` | built | med — the `Links` list | S — parse + list | B-54 |
| B-29 | `Agent` completion | built* — chip drops tokens/duration | med | S — 2 numbers | AgentChip |
| B-30 | `Agent` progress / backgrounded | undesigned | med | M — a progress feed + panel | C6.4 Agents tab |
| B-31 | `AskUserQuestion` echo | undesigned | med | S | lane D |
| B-32 | `ExitPlanMode` / `EnterPlanMode` | undesigned | med | S — 6 strings + markdown | lane D, B-48 |
| B-33 | `Skill` | undesigned | med | S | **B-61** |
| B-34 | `LSP` | undesigned | med | S — noun table + links | B-14 |
| B-35 | `ReportFindings` | undesigned | med — high if the gate is on | M — a findings view | `CLAUDE_CODE_REPORT_FINDINGS` |
| B-36 | `memory_write` | undesigned | low | S | B-48 |
| B-37 | MCP + Chrome + computer-use families | built* — generic only | med — 31 verbs at once | M — 2 tables + a bar | B-14 |
| B-38 | The long tail (14 tools) | undesigned | med — cheapest per row | S — 14 strings | B-14 |
| B-39 | `TodoWrite` | built* — exceeds canon, no list | med | S (row) / M (persistent list) | — |
| B-40 | The diff in a tool result | undesigned in timeline | **high** — tracker 137 | S — route the patch | B-18, B-41 |
| B-41 | Diff geometry and truncations | built* — no bands, numbers, words | **high** | M — bands + word diff + numbers | AttributedDiffRenderer |
| B-42 | The diff sidebar | superseded by Source Control | med — the *session* base | S — a base selector | C7.7 |
| B-43 | Post-edit diagnostics | undesigned, unbuildable from wire | low until afleet runs diagnostics | L — own toolchain | owner decision |
| B-44 | Interruption | undesigned — read as an error today | **high** — a correctness bug | S — one state on `non_execution_kind` | B-15 |
| B-45 | Rejection | built* — 1 of 5 forms | med | S — 4 strings + causes | B-15 |
| B-46 | `Waiting for permission…` | undesigned | med — row lies today | S | lane D |
| B-47 | Rate-limit auto-continue | routed-only (banner) | med — rare but blocking | M — banner + notices + Activity | lane E, Activity |
| B-48 | Markdown pipeline | built, exceeds canon on HTML | med — 3 gaps | S — quotes, rules, headings | — |
| B-49 | Tables | built, exceeds canon | low — already good | S — alignment + sort | — |
| B-50 | Lists | built* — no depth cycle, no checkboxes | low | S | — |
| B-51 | Code blocks, highlighting, gutter | built* — one call site | med | S — route + a gutter | B-19, B-21, B-40 |
| B-52 | Mermaid | designed, deferred | **high** — a headline visual win | M — vendor + `WKWebView` | architect ruling |
| B-53 | Inline images | built as placeholders; markdown images lost | **high** | M | B-17 |
| B-54 | Links and the `owner/repo#123` linkifier | built (links), undesigned (linkifier) | med | S — ~30 lines | GitHub panel |
| B-55 | Streaming markdown, `textWrap`, width | built, well evidenced | low — done | S | — |
| B-56 | Virtual list, anchoring, static commitment | built, most complete area | med — width freeze | S — freeze + scale + dedupe | tracker 132 |
| B-57 | Untrusted-text sanitising | built, exceeds canon; **bidi gap** | **high** — security | S — one more pass | — |
| B-58 | Selection, copy, `/copy` | undesigned — nothing at all | **high** — expected of any window | S — selection + 3 menu items | B-03 |
| B-59 | `/export` | undesigned | med | M — 4 formats + a panel | B-07 (JSON), menu bar |
| B-60 | Timestamps, turn duration, turn summary | built, different defaults | med | S — merge two rows | — |
| B-61 | Command echo wrappers | undesigned — **XML visible today** | **high** — a visible defect | S — parse 6 tags | — |
| B-62 | Queued command echoes | lane C (chip); undesigned (row) | med | S | B-61, lane C |
| B-63 | Hook rows | built, exceeds canon | low | S — aggregate collapse | — |
| B-64 | Skill metadata and vanished attachments | built (hiding), undesigned (showing) | low — 31 of 35 unreachable | S — route unknown to `OpaqueRow` | B-07, B-33 |
| B-65 | Sent files and attachments | built | med | S — chips + sizes | B-17 |
| B-66 | The compact boundary | built | med — the summary inline | S | B-07 |
| B-67 | Five-phase compaction progress | undesigned | med — explains a long pause | S — a banner | Channel banner |
| B-68 | Microcompact | undesigned; **staleness unaddressed** | med — correctness | S (display) / M (reducer rule) | root spec §7.3 |

## For the map

1. **One widget carries two-thirds of this lane: the result row with a structured body.** B-14's
   proposed `structured` slot beside `raw` is what B-17 (thumbnails), B-18/B-40 (diffs),
   B-21 (cells), B-26 (match lists), B-35 (findings), B-37 (progress bars, screenshots),
   B-39 (todo lists) and B-51 (highlighted code) all need. Twenty-odd cards collapse into
   "one seam plus twenty small views". Build the seam first or build every card twice.

2. **The terminal has one density dial because it has one rectangle; afleet's win is having two
   surfaces at once.** Every terminal disclosure mechanism — the fold, `ctrl+e`, `verbose`,
   `ctrl+o`, brief — is a setting of that dial. Three of them map onto afleet's three layers
   (B-10). The fourth, `ctrl+o`, does not map onto a layer at all and should become a **panel tab**
   (B-07). That single move is the lane's biggest structural claim: raw and rendered on screen
   together, which is the thing a terminal structurally cannot do.

3. **The region that is overloaded is the tool result row; the region that is under-used is the
   panel.** Six cards independently propose "…and open it in a panel": Files (B-16, B-25, B-26,
   B-36, B-40), Agents (B-24, B-30), Browser (B-27, B-28, B-37), Source Control (B-38, B-42),
   GitHub (B-54), Raw (B-07). The transcript's job in a window is to be *scannable and clickable*,
   not to be complete; completeness belongs to the panels. The terminal has to put everything in
   the row because there is nowhere else.

4. **Never steal the reading position.** The terminal's most carefully engineered UX rule is scroll
   anchoring (B-56): remember the item nearest the viewport top and correct `scrollTop` by however
   much it moved, and freeze the range for two frames after a width change. afleet has the first
   and not the second. Every row in this lane can change height after it is drawn — a fold opens, a
   diff arrives, an image decodes, a cluster's counters tick — so this is not a nicety.

5. **Persist per-row disclosure, and scope it to the channel, not to the mount.** afleet's
   `TimelineCollapseState` is a `Set<String>` in `@State` that `ChannelColumnView`'s `.id(row.key)`
   discards on every channel switch. It drives five different disclosures. A GUI's whole advantage
   over `verbose` is that expansion is per row and remembered; today it is neither.

6. **Copy is missing entirely and it is the most conspicuous gap for a Slack-shaped window.**
   No pasteboard write, no context menu, no cross-row selection anywhere in `App/Timeline/`. The
   terminal has `copyOnSelect` on by default, a `/copy` picker and a `noSelect` plane engineered so
   a drag never picks up chrome. afleet inherits the chrome exclusion structurally and has nothing
   else (B-58).

7. **Three surfaces in this lane are places where the *wire is richer than the terminal*, and they
   should be built as such**: `structuredPatch` (a real diff, B-40), image and notebook bytes
   (B-17), and `non_execution_kind` (five denial causes where the terminal shows one, B-44/B-45).
   Conversely exactly one surface is genuinely poorer on the wire — live Bash output (B-23) — and
   the correct response there is an explicit "output arrives when the command finishes", not an
   empty box shaped like the terminal's.

8. **Two divergences from canon are deliberate and must be protected in review**: afleet **escapes**
   raw HTML where the terminal passes it through, and afleet **sanitises host-side** where the
   terminal sanitises at paint time. Both are recorded in source. A future "faithfulness" pass could
   plausibly undo either. B-57 also names the one place afleet is *less* safe than canon: no bidi
   or zero-width pass.

9. **Copy that names a terminal mechanism has to be retargeted, and the study should say so once
   rather than per card.** `ctrl+o to expand`, `↓ to manage`, `esc to cancel`,
   `/rate-limit-options`, `/config`, `/focus to show`, `press esc twice` and
   `you're active in this terminal` all appear in strings this lane keeps otherwise verbatim. The
   rule: keep the sentence, replace the gesture with afleet's own, and never keep a reference to a
   surface afleet does not have.

10. **A rate limit, a compaction and a failing hook are channel events that a fleet operator needs
    to see from outside the channel.** Three separate cards (B-47, B-67, B-15/B-63) end up pointing
    at the Activity view and the sidebar badge. The terminal can only ever tell the one session it
    is; afleet's whole shape is that it does not have to.

## Spec defects

1. **SPEC 41.16 documents no renderer for `ReportFindings`.** §41.16.5 lists it in the eager table;
   §41.16.7 gives it no form. The renderer is real, structured and width-adaptive
   (`cli.pretty.js:834705-834745`) — grouping by file, a severity column, a line column and a
   layout switch. Card B-35 documents it.

2. **SPEC 41.16 documents no renderer for the tool-call cluster, which is the most-seen row in the
   transcript.** The four synthetic row types — `grouped_tool_use`, `collapsed_read_search`,
   `work_segment`, `speaker_label` — appear *only* in §41.16.12's `isStatic` table
   (`41-tui-rendering.md:4910-4915`) and nowhere else in the chapter. The
   `collapsed_read_search` renderer at `cli.pretty.js:838361`+ produces a categorised, tense-switching
   sentence over fourteen counter families, plus a hook sub-line and an elapsed timer; the collapse
   threshold is two trailing read/search calls (`cli.pretty.js:712104`); and the compact fallback
   sentence is built at `cli.pretty.js:712098`. Cards B-12 and B-13 document them.

3. **SPEC 41.16.7 omits the post-edit diagnostics row.**
   `Found N new diagnostic(s) in M file(s) (ctrl+o to expand)` is drawn under a file-edit result
   (`cli.pretty.js:835272`) and appears in no section. Card B-43.

4. **SPEC 41.16.7 lists `MultiEdit` nowhere, but the tool is still named in SPEC 14's roster
   context and in permission documentation**, which reads as though it renders. It does not: there
   is no registry row and no side-table entry in 2.1.263. Card B-20 records the absence so it is not
   re-derived.

5. **`Waiting for permission…` is a distinct transcript state given one subordinate clause.**
   SPEC 41.16.10 mentions it in passing; it replaces a result body wholesale and has its own copy
   (`cli.pretty.js:835189`). It deserves its own subsection. Card B-46.

6. **SPEC 41.17.5 / 41.7.5 disagree with the parity inventory on the hyperlink id hash.** SPEC
   41.7.5 states — correctly, with the source — that the link id is a **31-based** rolling hash
   (`h = (h << 5) - h + c`) rendered in base 36, and explicitly notes "*It is not djb2*".
   `docs/tui-parity/areas/41-tui-rendering.md` §41.7.5 records it as "*a djb2 id in base 36*". The
   SPEC is right; the inventory row should be corrected.

7. **tui-parity and the somersault scorecard disagree on whether the compact boundary carries a
   message count.** `docs/tui-parity/areas/13-10-23-context-memory-session-tools.md` lists
   `messages_summarized` on `compact_metadata` (observed at 2.1.259); the clone's P81 read the live
   `compact_boundary` frame key by key at 2.1.220 and found neither `summarizeMetadata` nor the
   count (`CC-to-SDK/docs/parity/tui-ux.md` §2 row 21). Most likely version skew, but B-66's
   proposed copy depends on it and it should be re-probed at afleet's target version.

8. **The afleet root spec names "the raw view" three times and never specifies it.**
   `2026-09-03-afleet-workspace-design.md:937` and `:1276`, and
   `2026-09-07-c6-conversation-surface.md:269`, all send hidden content there — `isSynthetic` user
   frames, `session_state_changed`, meta reminders — but no section defines what it is, where it
   lives or how it is opened. The nearest built thing, `App/Threads/ThreadView.swift:105-112`, has
   **no production caller** (`App/Threads/ThreadModel.swift:182`;
   `AppTests/TaskCardBackgroundingTests.swift:79` states it). Card B-07 proposes the surface.

9. **The afleet root spec's "three-layer density" is a decision with no definition.** The Decision
   Log entry is two lines (`2026-09-03-afleet-workspace-design.md:2910-2911`) and the phrase appears
   once more at `:100`; **the three layers are never enumerated anywhere in afleet's specs**. §8.3
   describes clusters and their expansion but names no layer model, and C6.1 does not either. This
   study infers prose / clusters / expanded from §8.3's mechanics (card B-10) — that inference should
   be written into the root spec rather than left to a reader.

10. **`docs/tui-parity/areas/41-tui-rendering.md` §41.16.7's `Bash` row understates the live-output
    verdict relative to the README.** The row says `tool_progress` frames "*are emitted only when
    `CLAUDE_CODE_REMOTE` or `CLAUDE_CODE_CONTAINER_ID` is set*", which reads as "gated". The
    `15-16-17` area file and probe 11 establish the stronger fact that the published `tool_progress`
    **schema carries no output field at all**, so even when emitted it cannot carry stdout. The
    §41.16.7 row should carry the stronger sentence, because a reader who stops at §41.16.7 will
    plan for a flag that would not help.
