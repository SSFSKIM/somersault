# Lane B — transcript and message rendering

**Date.** 2026-09-09. **Canon.** Claude Code 2.1.263 (`/Users/new/claude-code-bundle/2.1.263/`).

**SPEC 263 chapters read.** `41-tui-rendering.md` §41.7.1, §41.7.4, §41.7.5, §41.8.6, §41.13.3,
§41.13.4, §41.15.3, §41.16.1–§41.16.12, §41.17.1–§41.17.11, §41.23.1–§41.23.5, §41.24.6,
§41.26.2 (Display config rows); `11-query-loop-and-messages.md` §11.2.9, §11.2.10, §11.2.11,
§11.8.3, §11.8.4, §11.14.4, §11.15; `13-context-management.md` §13.8, §13.15.6, §13.19.3,
§13.19.4; `28-slash-commands.md` §10; `35-session-persistence.md` §35.21;
`14-tool-interface-and-registry.md` (tool roster cross-check).

**Verification spent in `cli.pretty.js` (2.1.263).** `What should Claude do instead?` (:832492);
`Already in context (…)` / `Unchanged since last read` (:39514); the compact-boundary detail
builder `${n} message(s) summarized` / `${tokens} tokens summarized` (:833265); the fold
constants `var v1 = 3, Q2n = 10` (:759693) and the affordance `(${e} to expand)` (:759691);
`"Interrupted "` (:832497); `Waiting for permission…` (:835189, and the composer copy at
:511212); `TaskOutput`'s `Read output (… to expand)` (:417410); `MultiEdit` occurrences
(:419941, :675444, :735641 — verb/permission tables only, no renderer); the `ReportFindings`
renderer `EC`/`LC` (:834705–834745) and its model-facing result `No findings reported.` /
`${n} finding(s) reported.` (:757253); the post-edit diagnostics row
`Found N new diagnostic(s) in M file(s) (ctrl+o to expand)` (:835272).

**afleet files read.** (see per-card citations)

**Denominator covered.** Chrome glyphs / bullet state machine / gutters / input-box border
(41.16.1–4); renderer side table and shared result primitives (41.16.5–6); per-tool result forms,
all of them (41.16.7); diffs and diff sidebar (41.16.8–9); interruption and rejection (41.16.10);
rate-limit auto-continue rendering (41.16.11); static commitment (41.16.12); markdown pipeline,
tokens, lists, tables, links, highlighting, gutter, mermaid, images, width rules, streaming
(41.17); the fold, `ctrl+o`, `ctrl+e`, `verbose`, brief/focus (41.23); virtual list, scroll
anchoring, commit cursor (41.8.6, 41.15.3); untrusted-text sanitising (41.7.4); hyperlinks
(41.7.5); `textWrap` modes (41.7.1); thinking blocks (SPEC 11.15); `tool_use_summary` clusters
(SPEC 11.2.9); turn duration, timestamps, time format (41.26.2 Display rows, SPEC 11.14.4);
selection, `copyOnSelect`, `copyFullResponse`, `/copy` (41.13.3, 41.24.6); `/export` (SPEC 35.21);
inline attachment rendering and command-echo wrappers (SPEC 11.8.3, SPEC 28 §10); compaction
display (SPEC 13).

**Additions to the stated denominator** (found in the family, not listed in the task prompt):

1. **The post-edit diagnostics row** — `Found N new diagnostics in M files (ctrl+o to expand)`
   drawn under a file-edit result (`cli.pretty.js:835272`). SPEC 41.16.7 does not list it.
2. **`ReportFindings` has a real, structured, width-adaptive renderer** (grouping by file, a
   severity badge column, a line column, and a width-conditional layout switch), not a one-liner.
   SPEC 41.16.5 lists the tool in the eager table but §41.16.7 documents no form for it.
3. **`Waiting for permission…` as a result-body replacement** (41.16.10 mentions it in one
   clause); it is a distinct transcript state and gets its own card.
4. **`MultiEdit` is not a rendered tool in 2.1.263** — no registry row (SPEC 14 §14 tool table)
   and no side-table entry; the name survives only in the progress-verb map and permission sets.
   Carded as `superseded` so the map shows the full denominator.

---

## Headline

1. **The terminal's one density knob maps onto afleet's three layers cleanly, and the mapping is
   already half-built — what is missing is the third layer.** The terminal's fold (3 wrapped
   lines, SPEC 41.23.1), `ctrl+e` (show/hide previous messages, 41.23.3), `verbose` (41.23.4) and
   `ctrl+o` (41.23.2) are four settings of one dial, because a terminal can only ever draw one
   density at a time. afleet's layer 1 (prose) = brief/focus; layer 2 (clusters + folded results)
   = the default fold; layer 3 (expanded) = `verbose`. `ctrl+o`'s *raw* reading — every record,
   nothing folded, searchable — has **no afleet equivalent**: `OpaqueRow` gives raw JSON for one
   unrecognised frame, and nothing gives it for a recognised one. Card B-07 proposes it as a
   **panel tab**, not a mode, so the GUI keeps both densities on screen at once, which is the one
   thing the terminal structurally cannot do.

2. **afleet implements 10 tool result forms; the terminal has about 40, and everything else in
   afleet falls to `Done · N lines`.** `App/Timeline/Rendering/Rows/ToolResultForms.swift:96-110`
   switches on ten names (`Read`, `Edit`, `Write`, `Bash`, `Grep`, `Glob`, `Agent`, `WebFetch`,
   `WebSearch`, `TodoWrite`) plus an `mcp__` family; C6.1 §13 names the rest as deliberately out
   of scope. So `Skill`, `LSP`, `TaskOutput`, `NotebookEdit`, `Monitor`, `ExitPlanMode`,
   `PushNotification`, `ReportFindings`, the `Cron*` family, the worktree tools and the
   Chrome/computer-use families all render as `Done`. Every one of them is class **R** in
   `docs/tui-parity/areas/41-tui-rendering.md` §41.16.7 — the data is on the wire. This is the
   largest single unit of remaining work in this lane and it decomposes into independent cards
   (B-20 … B-39).

3. **afleet draws no diff for an `Edit` or a `Write`, and it already owns a diff renderer.**
   `ToolResultForms.edit` (`ToolResultForms.swift:130-145`) counts `structuredPatch` lines into
   `Added N lines, removed M lines` and sets `raw: nil` — so there is nothing to expand.
   `App/Decisions/AttributedDiffRenderer.swift` renders a real line-level diff, but only inside a
   permission card, which is *before* the edit. After the edit the user sees a count. Routing
   `tool_use_result.structuredPatch` into the result row (B-40) is the highest value-per-cost item
   in the lane.

4. **The one place the wire genuinely cannot follow the terminal is live Bash output, and afleet
   should say so rather than show an empty row.** `docs/tui-parity/README.md` §5 A-15/16/17 and
   A-41 both class it **D** (`tool_progress` carries only `elapsed_time_seconds`; probe 11). The
   terminal draws the last five wrapped lines plus `+N lines · 12s · timeout 2m` (SPEC 41.16.7).
   afleet's comment in `ToolResultForms.bash` already records this. Proposal (B-23): tail
   `persistedOutputPath` — which **is** structured and class **P** — and where there is no
   persisted path, show elapsed plus an explicit "output arrives when the command finishes".

5. **Four terminal surfaces exceed in the GUI by simply not being text, and three of them are
   free.** Images and PDFs: the bytes are on the wire (**P**, A-15/16/17), the terminal prints
   `Read image (240KB)`, afleet prints `Read image` — a thumbnail is strictly better (B-17).
   Mermaid: never drawn in the terminal (SPEC 41.17.8), deferred by C6.1 §7 pending an
   architect ruling on vendoring mermaid.js 11.16.1 (B-52). Tables: afleet already draws real
   `NSTextTable`s, which beats the terminal's box-drawing fallback (B-49). `TodoWrite`: the
   terminal has **no** renderer at all (SPEC 41.16.5) and afleet already draws the list (B-39).

6. **afleet's text sanitiser is better than canon and must stay that way.**
   `App/Timeline/Rendering/TextSanitiser.swift` implements SPEC 41.7.4's strip set as one
   fixed-point pass, exempting `\n` and `\t`, and `MarkdownText.build` **escapes** raw HTML where
   SPEC 41.17.2 passes `token.text` through unescaped. That divergence is deliberate and correct;
   the card (B-57) records it as the one place the study says *do not be faithful*. One gap: the
   sanitiser runs on rendered text but the terminal also clamps notification text separately, and
   afleet has no equivalent clamp on strings it hands to `UNUserNotification`.

7. **Five whole surfaces in this family are undesigned in afleet: interruption/rejection copy
   beyond `Edit`, the rate-limit inline block, `/copy` and `/export`, transcript search, and the
   per-row timestamp/turn-duration settings.** `ToolResultForms.denied` covers `Edit` and falls
   back to `User rejected <tool>`; the terminal has five distinct rejection renderers plus
   `Interrupted · What should Claude do instead?` (SPEC 41.16.10). There is no copy affordance at
   all beyond `textSelection(.enabled)` on expanded bodies — no `/copy` picker, no
   `copyFullResponse`, no `/export`. These are small, high-frequency, and every one of them is a
   thing a Slack-shaped window is expected to have.

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
