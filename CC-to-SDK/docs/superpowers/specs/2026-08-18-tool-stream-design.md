# Tool-Stream Wave (TS) — fullscreen tool-cluster collapse + click-to-expand

**Purpose.** Close the biggest remaining fullscreen-fidelity gap: in canon 2.1.234's
flicker-free renderer, every tool call that is not a Write/Edit/Agent/plain message is
absorbed into a compact, live-streaming cluster line, and clicking that line expands the
cluster's calls in place — the only granular expansion control in fullscreen. ccx today
folds only read/search/list/MCP runs (the pre-fullscreen 2.1.220 policy) and discards every
mouse report except wheel ticks. This wave widens the fold policy to canon's fullscreen
clauses and builds the click pipeline, without regressing text selection.

**Canon ground truth:** `docs/superpowers/grounding/2026-08-18-tool-stream-ground.md`
(every claim line-cited into `~/claude-code-bundle/2.1.234/cli.pretty.js`). Line numbers
below cite that binary reprint. **Canon moves with this wave: 2.1.234 is the citation
target for new work** (2.1.220 citations already inside shipped modules stay as they are —
they were verified against that binary and rewriting them re-verifies nothing).

**Owner sign-offs already given:** the wave itself ("you can write spec", 2026-08-18) and
the v1 cut keeping current mouse modes (proposed in the grounding report-out, not
objected).

---

## 1. What canon does (the target, compressed)

The full mechanics are in the grounding doc; the load-bearing facts:

1. **One predicate decides absorption** — `Krr(name, input, tools)` (236795). Collapsible:
   Glob, Grep, Read (always); Bash *entirely* when fullscreen (236816), read-ish commands
   only otherwise; MCP tools; ToolSearch (fullscreen only, silently); TodoWrite +
   TaskCreate/TaskGet/TaskUpdate/TaskList (silently, popping out on error); REPL;
   Write/Edit into memory/scratchpad/workshop paths. Everything else —
   **Write, Edit, NotebookEdit, Agent, Task, WebFetch, WebSearch** — returns
   `isCollapsible: false` and breaks the cluster.
2. **A cluster is one contiguous run** (`iNp`, 237092). Breakers: assistant text, a
   non-collapsible tool call, a user prompt. Absorbed without breaking: thinking blocks
   (wall-clock added to `thoughtForMs`), attachments, system messages; neutral items are
   buffered and re-emitted after the cluster.
3. **Header copy** (`ZIl`, 518464): comma-joined `verb + bold count + noun` parts in a
   fixed order, first part title-cased, present tense + trailing `…` while active, past
   tense + dim when settled. Fullscreen-only parts: git operations scraped from bash
   stdout ("committed <shas>", "pushed to <branch>", "merged/rebased onto <ref>", PR
   actions) and "ran N shell commands". Counts are watermarked (never tick backwards,
   518466). There is **no** "N tool uses" string.
4. **Tools stream inside the collapsed cluster from the first call** — spinner, undimmed,
   live `⎿` hint line with the current file/pattern/command, per-tool elapsed ticker after
   2 s, bash `(4s · 120 lines)` suffix after 2 s. The block never un-collapses on its own.
5. **Click is the only per-cluster expansion path** (none of canon's 112 keybinding
   actions does it). State: a component-local `Set` of keys `collapsed-<firstUuid>`
   (549749) flipping the row's `verbose` prop; content-derived key, so a live cluster
   stays expanded while it grows; session-lifetime, never persisted.
6. **Click vs selection is deferral, not modifiers** (208013): press drops a selection
   anchor; the click fires on release only if no selection was produced.
7. **Fullscreen suppresses every `(ctrl+o to expand)` chip** (Ett context, 549824 →
   511132) and deactivates ctrl+e; ctrl+o remains the everything-expanded screen.
8. Canon arms `?1000h ?1002h ?1003h ?1006h` ("full", 207331) — motion tracking (1003) is
   what powers hover — and runs its own selection engine with copy-on-select.

## 2. The v1 cut (decided)

**Keep ccx's current mouse arming (`?1000h ?1006h`).** Full fidelity needs 1002/1003,
which swallows *all* drag reporting and forces us to build canon's selection/copy engine
in the same wave. With 1000-only, press+release still arrive; Shift/Option-drag still
reaches the terminal's native selection (the BL5 status quo). What this costs, each a
**recorded divergence** reserved for a follow-on "full mouse" wave:

- no hover brighten (needs 1003),
- no expanded-row background tint (canon gates the tint on *expanded*, not hovered —
  549131; we drop it because the line-based row renderer has no per-item background
  span, a cost call, not a hover dependency),
- no click-to-position-cursor in the composer, no auto-copy-on-select,
- tap detection approximates canon's "no selection produced" with "press and release in
  the same cell" (under mode 1000 there are no motion reports, so a drag is exactly a
  press and a release in different cells; the two rules coincide).

Everything in §1 items 1–5 and 7 ships at full fidelity, minus the pieces above.

**Not applicable to ccx (absent from the SDK tool surface), skipped with no divergence
recorded:** PowerShell, REPL, workshop/scratchpad/memory-path Write/Edit, team memory.
**Out of scope, unchanged:** the classic renderer's fold policy — **a recorded
divergence, not parity**: the Bash/ToolSearch/git widenings are genuinely `Ns()`-gated in
canon, but TodoWrite/Task-board absorption is unconditional (`Joi.includes`, 236807), so
canon 2.1.234's *classic* renderer absorbs those too while ccx classic stays at its
shipped 2.1.220 subset. Also out: brief mode (ctrl+shift+b), `/tui` gating, the ctrl+o
pager.

## 3. Design

### 3.1 Fold-policy widening (pure model: `toolFold.ts` + `foldPendingState.ts`)

`classifyToolEvent` gains a `fullscreen: boolean` input (canon threads `Ns()` through the
policy itself, 236816 — ours threads the renderer identity from the caller; the pure
module stays clock- and environment-free). Under `fullscreen`:

- **Bash**: every call classifies into the run. Read-ish commands keep feeding
  read/search/list counts exactly as today; non-read commands feed a new
  `bashCount` + `bashCommands` (id → command string) on `GroupCounts` (canon 237020,
  237152). Standalone-Bash rendering remains the classic renderer's behavior.
- **ToolSearch**: absorbed silently — counted nowhere, and it never pops out (canon
  236808). It does **not** break a run, but it is a member like any other and can *open*
  one, owning the anchor (addendum §A.1) — memberIds and anchor identity see it.
- **TodoWrite, TaskCreate, TaskGet, TaskUpdate, TaskList**: absorbed silently, but an
  errored result **pops the call out** (canon `popsOutOnError`, 236809). Grounded by T1's
  addendum (`grounding/2026-08-18-tool-stream-ground-addendum.md`), which governs the
  mechanism; the load-bearing results:
  - silently-absorbed calls ARE members and contribute no header copy; they can be
    `messages[0]` and own the run's anchor (canon 237195–237197, 237027);
  - an error result for such a tool **always closes the run**; the call is *relocated*
    after the cluster only in canon's narrow case (it is the last message, all its
    tool_uses errored, and no hooks/relevant-memories were absorbed) — otherwise it stays
    inside the cluster and only the run closes (canon 237198–237210);
  - a run whose every member is silent has all counters zero. Canon still emits a
    zero-height clickable row (518513, 549764); **we emit no row** — an invisible
    clickable region has no meaning in an item-based projection, and this preserves
    today's behavior for suppressed tools. Recorded divergence.
  - **an errored silent call is never swallowed** (round 5, corrected round 6). Canon's
    `n.push(c)` (237210) sits OUTSIDE the branch — the error row is emitted on *all three*
    paths, including the one where the call stays inside an emitted cluster. So the rule is
    unconditional: **an errored `popsOutOnError` call always renders standalone once its run
    closes**, whether it relocated, stayed, or belonged to a run that emits no group at all.
    Relocation then decides only MEMBERSHIP — whether the call is also in `memberIds` (it is
    when it stayed; it is not when it relocated). Two consequences that travel:
    - anchor stability is unaffected: a call that stays keeps its place in `memberIds`,
      including `memberIds[0]`;
    - **Task 8 obligation**: expanded rendering iterates `memberIds`, so a member that has
      already been emitted standalone must be skipped there or the failure renders twice.
      (Canon has no such problem: it renders the `tool_use` inside the cluster and the
      `tool_result` standalone — two halves of one call, not one call twice. Our atoms carry
      call and result together, so the halves cannot be split the way canon splits them.)
    The narrower round-5 wording — standalone only when the group was suppressed — left the
    original hole open in the commonest ordering: an errored board write inside a cluster
    that has other, visible members, where the summary reads "Read 1 file" and the failure
    appears nowhere.
  - **the relocate/stay test is a window test on sequences**, not a lookahead. Canon asks
    whether anything else was pushed into `o.messages` between the silent call's own
    message and the arrival of its error result. Our atoms carry `callSequence` and
    `result.resultSequence`, so the same question translates exactly: relocate only if no
    other atom's call or result sequence falls strictly inside the open window
    `(call.callSequence, call.result.resultSequence)`. A "does the next atom join the run"
    approximation answers a different question and diverges on three orderings (a
    sequentially-issued follow-on, a concurrent sibling whose result lands first, and a
    thought arriving after the error). One endpoint rule completes it (round 6): siblings
    issued in the SAME message share the errored call's `callSequence` and so sit exactly on
    the window's edge, invisible to a strict scan. Canon handles them through
    `f.every(id => id errored)` (237200) — a batch relocates only if every sibling in it
    errored. Ours is the same predicate: an atom sharing the errored call's `callSequence`
    blocks relocation **unless it also errored**. Strict-inside is deliberate for every other
    atom and must be pinned by a cell, since flipping it to inclusive otherwise changes
    nothing any test can see. **Recorded divergence (round 7):** canon builds its errored-id
    set from the *arriving result message alone* (237199), so "every sibling errored" means
    "every sibling errored in this same message"; ours means "errored at any time". They part
    only when same-entry siblings error in *different* entries — canon keeps the call inside
    the cluster, we relocate it out — and only for disk-sourced multi-block entries, since the
    live engine splits parallel calls into separate frames with distinct sequences. The effect
    is membership-only now that the failure row is unconditional.
  One invariant this spec owns regardless of canon: a pop-out must not shift the anchor
  identity of an already-formed run — expansion state and the watermark latch key on it.
  (Canon can retract a run wholesale because `iNp` re-derives from the full message list
  every pass, 237093; a streaming renderer cannot unpublish a row.)
- **Git-operation scraping** (canon `odS`, 237212): scraped **as each bash result is
  absorbed** — canon runs `odS` inside the accumulation loop, so "committed abc123f"
  appears in the live header mid-turn, not only at close. Successful git
  commits/pushes/merges/rebases and `gh` PR actions are scraped from the recorded
  commands + results into `commits[] / pushes[] / branches[] /
  prs[]` on the counts. The no-double-count is a **render-time subtraction, not a
  transfer**: `bashCount` stays gross, `gitOpBashCount` is a parallel tally bumped once
  per result that yielded any op, and the shell clause prints
  `max(0, ratchet(bashCount) - gitOpBashCount)` — the watermark ratchets the *gross*
  count and the subtraction happens after it (canon 518466–518467, verbatim
  `le = Ns() ? Math.max(0, P.current - Z) : 0`). Decrementing `bashCount` at accumulation
  instead would latch the clause at its pre-git value forever, since the ratchet never
  falls. The recognition rules are T1's addendum §B (canon `vFr`, 194436–194473), ported
  as documented there, with two deliberate departures from canon's own bugs: the
  `--amend` test runs against the same quote-stripped command string the other flag tests
  use, and each tool_use_id is scraped at most once per result batch. Canon consults no
  exit code — we mirror that (output-shape recognition only).
- **WebFetch and WebSearch stay non-collapsible** — canon's policy, verified, even though
  intuition says "reads collapse".
- **A live `/tui` renderer flip must still replay each committed row exactly once**
  (round 9, corrected round 10 — a REQUIREMENT, not a divergence). The wave made the fold
  policy renderer-dependent, and the review measured the consequence: flipping out of
  fullscreen and then prompting once puts BOTH the cluster row and the individual per-call
  rows for the same calls on the main screen. That violates an invariant the code states
  outright (`ChatApp.tsx:1154–1156`: "WHAT IS NOT ACCEPTABLE, and is pinned: a SECOND copy.
  The replay must REPLACE"), and it compounds per flip because Ink's static buffer only
  grows. Cause: fullscreen commits rows into `staticItems` while its `<Static>` holds
  `EMPTY_ITEMS`, so they are never painted; on the way back `<Static>` re-emits them as
  fullscreen-shaped rows, and the next mutation re-projects classically and finds the
  per-call ids unspent. The repair re-projects the committed items under the new policy and
  remounts through the existing `staticEpoch` key (a keyed remount deletes and re-creates in
  ONE commit — the machinery `/clear` and rewind already use), so the replay REPLACES.
  Clearing the transcript outright stays rejected: it costs the user their history.
- **PR numbers are text, not links** (recorded divergence, round 8). Canon renders the visible
  characters `#12` and registers the hyperlink as a side effect of its own row component
  (`Ktt`, 518049–518070); our `FoldClause` is text-plus-bold-ranges with nowhere to hang an
  href. The scraped `GitPrOp.url` is carried through the counts so a future render layer can
  use it, and the clause text is byte-correct in both canon forms (`#12` linked, `PR #12`
  unlinked). Nothing schedules the affordance; Task 13 records it as backlog rather than
  leaving the field unowned.

`foldClauses` grows the fullscreen clauses in canon's fixed order (518545–518635):
git parts ("committed"/"amended commit"/"cherry-picked" + short shas, "pushed to" +
branches, "merged"/"rebased onto" + ref, PR verb + number) come after the edit parts and
before "searched for"; "ran N shell command(s)" comes last before the memory parts.
Verb pairs are present/past per the grounding table. The existing bold-count ranges,
title-case-first rule, active `…`, and the `foldPendingState` watermark ratchet all
apply unchanged to the new counts.

**Live dressing** (canon §6, droppable to a follow-up ticket if it crowds the wave): the
per-tool elapsed `· Ns` ticker and the bash `(Ns · N lines)` suffix, both appearing only
after 2 s in flight. **The ticker's format is whole seconds under a minute**, not a decimal:
canon's formatter at this call site (`da`, bundle 82602) is byte-identical to our
`format.ts:formatDuration`, and its one-decimal branch is gated on `ms < 1`. `· 2.0s` is
unreachable; canon prints `· 2s`, and `· 1m 5s` past the minute. The existing active hint gutter (`latestDisplayHint`) already covers
canon's "current tool" line; it gains bash commands as hint sources. **Probe gate —
SETTLED, and it cut half the dressing.** Probe 100 (`probes/probes/100-tool-progress-stream.ts`,
live on SDK 0.3.220) found no per-tool progress feed reachable headlessly: between a
tool's `tool_use` and its `tool_result` the default environment delivers zero
`tool_progress` frames, and no frame of any kind carries an output-line count (eleven
spellings scanned). The single elapsed carrier, `tool_progress.elapsed_time_seconds`,
appears only under `CLAUDE_CODE_REMOTE`/`CLAUDE_CODE_CONTAINER_ID` and only once per 30 s
per call — not a stream, and not a flag we adopt. Consequences, both binding:
- **The bash `(Ns · N lines)` suffix is CUT — recorded divergence.** Its line half has no
  source and must not be faked; its second half would duplicate the ticker.
- **The elapsed ticker ships**, driven by our own clock off the member's local start time,
  not by any SDK progress field. **That start time is stamped locally on first sighting,
  not read from the transcript** — our wire carries no timestamps at all (P82), and
  `ToolEvent` holds `callSequence`, not a clock. `FoldPendingState` stamps a member the
  first time a projection sees it in flight and never moves the stamp, the same
  arrival-stamp doctrine `agentProgress` already uses. Canon can afford `Date.parse` off a
  message timestamp (518532-518543); we cannot, and must not invent the field. `system/task_started`
  and `system/task_notification` do arrive ungated and carry the real `tool_use_id`, but
  they are edges we already have — no new dependency is taken on them.
One trap recorded for any future progress work: `tool_progress.tool_use_id` is a synthetic
producer id (`"bash-progress-0"`); the real id lives in `parent_tool_use_id`.

### 3.2 Mouse click pipeline (input: `keys/parse.ts` → `keys/KeymapProvider.tsx`)

- `parse.ts`: SGR reports with `(button & 64) === 0`, **`(button & 128) === 0`**,
  `(button & 32) === 0` (no motion), `(button & 3) !== 3`, and `col >= 1 && row >= 1`
  decode into a new `MouseInputEvent` variant — `{ kind: "mouse"; action: "press" |
  "release"; button: 0 | 1 | 2; col: number; row: number; ctrl; alt; shift }` (1-based
  col/row as the terminal sends them; wheel stays a `KeyEvent` exactly as today;
  everything else stays `ignored("mouse")`). The `& 64` term makes the rule
  order-independent of the wheel check — without it, buttons 64/65/66 alias to 0/1/2.
  **The `& 128` term is the same hazard one octave up** (added round 11): buttons 8–11 add
  128 exactly as 4–7 add 64, so without it a five-button mouse's "back" press decodes as a
  left click and fires a tap the user never made. The coordinate floor exists because the
  type promises 1-based cells and a downstream `row - 1` index would otherwise reach -1.
  The type is named `MouseInputEvent`, never `MouseEvent`: DOM's global is in scope (no
  `lib` override) and a missing import would bind it silently and typecheck clean.
- **Anonymous releases stay ignored, deliberately.** `\x1b[<3;C;Rm` decodes to nothing.
  Under SGR (mode 1006) a release carries its true button number — structural, not
  incidental: xterm.js ORs the anonymous `3` only for the legacy X10 encoding. On a
  hypothetical terminal that did emit anonymous SGR releases the tap would never complete
  (press seen, release dropped) — a dead gesture rather than a misfire, which is the safe
  side. If insurance is ever wanted, the cheap form is to accept `(button & 3) === 3` only
  when the final byte is `m` AND a press is outstanding.
- **Mouse reports reach ccx only in the fullscreen renderer.** Tracking rides the
  alt-screen enter sequence (`altScreen.ts`), so a classic launch never arms it and inline
  users get no mouse reports at all. Acceptance for the click cells must run fullscreen.
- `KeymapProvider` routes `kind: "mouse"` to a **`useMouseSink` registry hook** (the F2
  registry pattern — innermost-wins, render-time registration — not a `KeymapDeps`
  callback: the deps are supplied at the `chatMain` mount, but the sink's owner is
  `ChatApp`, a descendant holding the tap state, expansion set, and row-map ref). Mouse
  events never enter the binding table — canon's clicks are not keybindings either.
- **Tap detection** lives in the sink's owner. **The anchor is the resolved cluster, not
  the cell** (corrected round 15): a `press(0)` records `(col,row)` *and* the anchor
  `anchorAt` resolves there; a `release` is a click only when it lands on the same cell
  **and still resolves to the same anchor**. There is no deadline. Only button 0 acts;
  modified clicks (ctrl/alt/shift) are ignored (Shift never arrives anyway — terminals
  bypass reporting for shifted mouse). A second press re-arms at its own cell rather than
  disarming — the reading a user expects, and pinned either way.
  Why identity rather than position: the wave's first cut discarded the anchor only on a
  wheel tick, on the theory that the wheel is what moves the page. It is not the only
  mover, and not even the common one — **sticky-bottom streaming shifts the document under
  a held button with no gesture at all**. Measured during T10's review: press on
  `Read 2 files`, two assistant messages arrive mid-click, and the release expands
  `Read 3 files` — a cluster the user never touched, in exactly the live-turn state where
  tool clusters appear. A physical click holds the button 60–150 ms; stream deltas arrive
  far more often than that. Comparing the resolved anchor covers the wheel, keyboard
  scroll, streaming, resize re-wrap and a document swap in one comparison, and is strictly
  stronger than the cell test alone. Keep the wheel discard as well — it is cheap, it is
  what canon does, and it kills a gesture the page has already invalidated.

**Architectural fact that governs every click question in this wave (recorded round 12):
ccx has no occlusion, because occlusion is omission.** `FullscreenFrame` is flow layout —
the region is clamped and the bottom band is its SIBLING; when a seam is up the dock is not
rendered rather than covered, and nothing is absolutely positioned anywhere on the path. So
a row map published by the viewport is always CURRENT, never shadowed by something painted
over it, and there is no "is something on top of this cell" question to answer. Canon can be
looser here because it re-walks its live frame on every click; we do not need to, for the
opposite reason. Do not reach for an occlusion signal — reach for ownership (who currently
owns input) instead.

### 3.3 Hit-testing and expansion state (fullscreen renderer)

- The fullscreen viewport already knows, for the frame it just sliced, which wrapped row
  came from which item (`wrapItems.ts` `sourceId`). It exposes the current frame's
  row-map through the same ref-channel family the scroll handle uses (`scrollRef`), and
  the map resolves **directly to fold anchor ids**, not raw item ids:
  `anchorAt(col, row) → string | undefined` (shipped shape, round 14 — the bound stays
  with the data it belongs to rather than being handed to the caller). Resolving at
  projection time (the projection knows each fold row's, active hint block's, and
  expanded member's owning anchor) is what keeps the churning fold-row item ids
  (`group:<memberIds>:row|pending-row|unclosed-row`, growing with the run) out of the
  click path — the same instability the anchor-key decision already rejects. Rows
  belonging to the pill, dock, park row, blank tail, or any non-fold item resolve to
  `undefined`. **Vertical origin**: the viewport knows its row grant but not where the
  region sits on the terminal, so `FullscreenFrame` publishes the region's absolute top
  row through the same channel — explicit, rather than a "region is always row 1"
  invariant that a future banner would silently break.
- **Column bound**: a click past a row's **painted extent, gutter columns included**, is
  dropped — canon drops blank-cell clicks (549361), so the empty space right of a
  cluster's text must stay inert here too. **The measure is display width, never
  character count** (corrected round 14, after the earlier `text.length` wording proved
  wrong twice over): the active-cluster leader `⏺` is one character occupying two
  columns, so counting characters leaves the last cell of every active cluster row inert;
  and a gutter block paints its body at a five-column offset, so counting only `text`
  would bound a hint-block row at ~4 columns while its text sits at 6–9 — the whole body
  of every hint block and tool result unclickable, with only the blank connector cells
  live. Bound on `stringWidth(text)` plus the row's gutter columns.
  Unspecified and deliberately left alone for now: a click in the leading blank connector
  columns of a gutter-block continuation row currently hits. Canon's rule is stated only
  for the space to the RIGHT of the text; Task 12 looks at it.
- **Expansion state**: `expandedFolds: Set<string>` keyed by the run's **anchor id**
  (`memberIds[0]` — already the stable identity `foldPendingState` ratchets on; the
  content-derived key gives canon's stays-expanded-while-growing behavior for free). It
  lives beside the transcript state in `ChatApp`/`useChat`, session-lifetime, never
  persisted, surviving ctrl+o round-trips and later turns. Its lifecycle mirrors
  `FoldPendingState.reset()`'s discipline: cleared wherever the transcript document is
  swapped or rewound (`/clear`, rewind, `/resume`); stale anchors are harmless but the
  intent is pinned so the two states never drift apart.
- **Projection**: `groupItems` receives the set through `ProjectionOptions`. An expanded
  run emits, instead of the one fold row, the existing **per-call verbose items** of its
  members (the same items the ctrl+o pager and classic verbose view already render), each
  re-tagged so its row-map entries resolve back to the run's anchor id. Clicking any row
  of the expanded block — or the collapsed row — toggles the anchor in the set. A click
  on a row whose item is neither a fold row nor a member of an expanded run is a no-op
  (v1 clickable species: fold clusters only; canon's clickable error/truncated results
  are reserved).
- **Dialog guard**: while a dialog or overlay is mounted, clicks are inert. The gate is
  `ChatApp`'s dialog-chain/pane-ownership state — NOT the scroll-key gate, which is
  deliberately looser (ctrl+u/d scroll the transcript behind a decision dialog by
  design, `FullscreenViewport.tsx:174-178`; a click must not toggle content behind one).
- Clusters (and expanded member items) are **already outside any Static region** in
  fullscreen — the viewport is fully virtualized — matching canon's
  `collapsed_read_search → never static` (549695). No work, but the invariant is named
  so nobody "optimizes" expanded members into Static later.

### 3.4 Chip suppression (canon Ett)

In the fullscreen renderer every `(ctrl+o to expand)` chip renders as nothing: the
`expandHint` already threaded through `ProjectionOptions`/`RenderMessageOptions` is set
to the empty string by the fullscreen render path (the three-state contract in
`keys/hints.ts` already treats `""` as "no hint"). The suppression is deliberately
**blanket** — it reaches every `expandHint` consumer, including the backgrounded-agent
hint, the agent done-hint, and the batch header (`toolRenderer.tsx:224/284/339`), which
matches canon's Ett context wrapping the whole virtual list; fullscreen snapshot deltas
in those rows are expected, and A9's byte-identity claim binds the classic renderer
only. The suppression also reaches the ctrl+o pager while in fullscreen — canon-faithful
too (canon's overlay is the same virtualized component under the same Ett provider,
grounding §7). The classic renderer keeps its chips everywhere.

## 4. Acceptance (observable behavior; keyed live cells run under the tmux driver with an isolated HOME under /tmp + CCX_FLEET_ROOT)

- **A1 (cluster forms).** Fullscreen, live keyed turn that Reads 2 files, Greps once, and
  runs 2 non-read Bash commands with no interleaved text: exactly one dim cluster line
  when settled, reading `Searched for 1 pattern, read 2 files, ran 2 shell commands` —
  modulo an optional leading `Thought for <duration>, ` clause (a live turn usually
  thinks; when present it takes the capital and `searched` goes lowercase). Bold counts;
  no `(ctrl+o to expand)` chip anywhere on it.
- **A2 (breakers).** A turn that Reads, then Writes a file, then Reads again: two
  clusters with the Write's full row between them. Agent dispatches and assistant text
  likewise render outside clusters, unchanged from today.
- **A3 (live form).** While the turn runs: spinner glyph, undimmed text, present-tense
  verbs with `…`, a `⎿` hint line naming the current file/pattern/command; counts never
  decrease across frames (watermark).
- **A4 (click expands).** Sending the SGR byte sequences for press+release
  (`\x1b[<0;{col};{row}M` then `\x1b[<0;{col};{row}m`, same cell) on a settled cluster row replaces it
  in place with the members' per-call rows; the same click on any of those rows collapses
  back. Press and release in different cells does nothing.
- **A5 (state lifetime).** An expanded cluster stays expanded across a later turn and
  across a ctrl+o round-trip; a fresh `ccx` session starts with everything collapsed.
- **A6 (absorbed-silent + pop-out).** TodoWrite inside a read run neither breaks the
  cluster nor appears in its copy, but DOES appear among the per-call rows when the
  cluster is expanded (it is a member); a TodoWrite that errors renders standalone.
- **A7 (git ops).** A turn whose Bash runs `git commit` + `git push` yields cluster copy
  containing `committed <shortsha>` and `pushed to <branch>`, and those two calls are not
  also counted in "ran N shell commands".
- **A8 (no regression).** Wheel scrolling, Shift/Option drag-select, wheelGuard's 75 ms
  arrow suppression, and every existing keybinding behave as before (suites: unit, tui,
  resize-matrix all green; the BL5 acceptance pokes re-pass).
- **A9 (classic untouched).** On the classic renderer (`--tui default`), fold policy,
  copy, and chips are byte-identical to before this wave (snapshot evidence).
- **A10 (stays expanded while growing).** Clicking a cluster **mid-turn**, while its run
  is still accreting members, keeps it expanded as later calls arrive and after it
  settles — this is the cell that forces the anchor-id key; an implementation keyed on
  the churning fold-row item id passes A1–A9 and fails here.
- **A11 (elapsed ticker).** While a cluster's newest member is still running, the active
  row carries `· <duration>` between the clause run and the trailing `…` once that member
  has been in flight two seconds — whole seconds (`· 2s`, `· 11s`), never a decimal. It is
  absent before two seconds, absent on the settled row, and absent on the classic
  renderer. No `(Ns · N lines)` byte/line suffix appears on a long-running Bash member —
  that half is CUT (probe 100) and its appearance would mean someone fabricated a count.

## 5. Testing strategy

- Pure model (policy, clustering, clauses, git scraping, watermark): unit tests in
  `test/unit/`, table-driven against the canon citations.
- Input: parse-level tests feeding raw SGR bytes; provider-level tests pinning routing
  (mouse → sink, never composer, never bindings) and tap detection.
- Renderer: `test/tui/` cells on both instruments (ink-testing-library + fakeTty) for
  fold rendering, row-map correctness under scroll offsets/pill/resize, expansion
  round-trip, chip suppression.
- Live: one keyed acceptance script driving a real pty via tmux `send-keys`/raw byte
  injection for A1–A7; A4's click bytes are printf'd into the pty. First click task
  verifies the runtime premise "press+release arrive under `?1000h` in our tracked
  terminals" before building on it (probe-first discipline; the wheel half is already
  BL5-proven).

## 6. Decision Log

- **v1 keeps `?1000h ?1006h`; hover/selection engine deferred.** Rejected: arming canon's
  full `1000+1002+1003+1006` now — it kills terminal-native selection outright, so it
  cannot ship without canon's selection+copy engine, roughly doubling the wave; the
  cluster/click behavior the owner asked for doesn't need it. Recorded divergences in §2.
- **Tap = same-cell press+release.** Rejected: porting canon's "no selection produced"
  rule literally — without motion reports there is no drag state to consult; under mode
  1000 the two rules are behaviorally identical.
- **Expansion re-projects members as per-call items, reusing existing verbose renders.**
  Rejected: a nested "verbose branch inside the cluster item" (canon's shape) — our
  projection pipeline is item-based, and the per-call renders already exist and are
  pinned by F3/F4 tests; a second nested rendering path would duplicate them.
- **Anchor id (`memberIds[0]`) as the expansion key.** Rejected: a per-frame index or the
  fold row's item id — both change as the run grows or re-forms; the anchor is already
  the ratchet key `foldPendingState` proved stable.
- **Mouse events route to a dedicated sink, not the binding table.** Rejected: modeling
  click as a pseudo-key binding — coordinates don't fit the binding vocabulary, and canon
  keeps clicks out of its 112 actions too.
- **WebFetch/WebSearch stay expanded.** Grounded (`Krr` step 7) — noted because it is the
  one policy row a reasonable implementer would "fix" the wrong way.
- **Citation target moves to 2.1.234 for new work; shipped 2.1.220 citations stay.**
  Rejected: bulk-rewriting old citations — they were verified against the binary they
  name, and the 2.1.220 tree is no longer on disk to re-verify against.
- **Row-map resolves to anchor ids at projection time; the frame publishes the region's
  absolute top row.** Rejected: mapping to raw item ids (fold-row ids churn with the
  run — the instability the anchor-key decision exists to avoid) and a "region is
  always terminal row 1" invariant (implicit geometry a future banner would silently
  break). Both per spec-review round 1.
- **Git ops scrape per absorbed result, not at cluster close.** Rejected: close-time
  scraping — canon runs `odS` in the accumulation loop, so "committed …" is visible
  live; close-time would be a mid-turn divergence A3/A7 could not see. Per spec-review
  round 1.

## 7. Surprises & Discoveries

- (seeded from grounding) Canon has no "flicker-free collapse component" — fullscreen
  only widens what feeds the pre-existing `collapsed_read_search` species, and makes the
  row clickable in the virtual list. Two mechanisms, not one.
- Click/selection coexistence is deferral (press-anchors-selection, click-on-empty-
  release), not modifier keys — the opposite of the BL5 assumption that DECSET 1000
  forces modifier-gated selection everywhere.
- No telemetry fires on inline expand in canon — there is no event name to imitate.
- (T1) The no-double-count is a subtraction after the watermark, not a transfer at
  accumulation — the "obvious" reading of the invariant builds a counter that can never
  fall. A latch, not a crash: tests must assert the shell clause *disappearing*.
- (T1) `popsOutOnError` is not a flag consulted at render; canon plants a zero-valued
  entry in the workshop-edit ledger so the existing un-count helper returns true without
  changing any counter (237142–237145). The mechanism is a reuse, not a dedicated path.
- (T1) A run made only of silent calls is, in canon, a zero-height row that still reports
  itself clickable — canon's own edge, arguably a bug, and the one place we deliberately
  render nothing instead.
- (T2) The declared-vs-reachable line held again: an in-flight progress channel exists in
  the wire vocabulary and is unreachable in practice — gated behind a remote/container
  flag and throttled to one sample per 30 s. The half of canon's bash suffix that looked
  hardest (elapsed) turned out to be the half we can build ourselves; the half that looked
  trivial (a line count) is the one with no source at all.
- (T1) Canon's git recognition never consults an exit code; success is inferred from
  output shape alone (`vFr`, 194436–194473), while the neighbouring telemetry path does
  check it. Fidelity here means copying the looser rule.
- (T5b) Ink 5.2.1 makes render ORDER, not remounting, the load-bearing property of a
  renderer flip. `<Static>` resets its emit index on `items.length` alone (Static.js:16–22),
  so a keyed remount buys nothing a re-projection does not already give; Ink takes an
  *untrottled immediate* render whenever the static node is dirty (reconciler.js:73–80 +
  ink.js:36–42), so an intermediate render is bytes on screen rather than a supersedable
  frame; and Ink creates a LEGACY React root (ink.js:60), so `setState` outside batching
  flushes synchronously and two state commits are two paints. Any embedder that swaps a
  render policy over Ink inherits all three.
- (T6) Under SGR (mode 1006) a mouse RELEASE carries its true button number — the anonymous
  `3` is an X10-encoding artifact, and carrying the button is what mode 1006 is for. Also:
  with motion tracking (1002) unarmed, tmux drops drag-motion entirely, so a drag reaches
  the app as press-here plus release-there with nothing between — exactly the shape a
  same-cell tap detector discards, which is why the v1 mouse cut costs less than it looks.
- (T6) A type named `MouseEvent` would have bound DOM's global silently and typechecked
  clean (no `lib` override in this project). The hazard is not the missing import; it is
  that the missing import has a plausible global waiting for it.
- (T7) **ccx has no occlusion, because occlusion is omission.** Nothing on the fullscreen
  path is absolutely positioned: a seam surface makes the dock *not render* rather than
  cover it. So a published row map is always current and there is no "is something on top
  of this cell" question — click questions here resolve by ownership, never by geometry.
- (T9) A row's clickable extent is display width, never character count, and the two part
  company in both directions at once: the active-cluster leader `⏺` is one character in two
  columns, and a gutter block paints its body at a five-column offset. Also worth carrying:
  Ink reports size but never position, so the frame's absolute origin is an asserted
  invariant with a paint-order canary, not a measurement.
- (T10) The wheel is not what moves a document. **Sticky-bottom streaming moves it under a
  held mouse button with no gesture at all** — a physical click holds 60–150 ms and stream
  deltas arrive far more often — so a tap anchored to a terminal cell expands a cluster the
  user never touched. Anchoring on the resolved cluster identity covers wheel, keyboard
  scroll, streaming, resize re-wrap and document swap in one comparison.
- (T12) **The SDK delivers a parallel tool batch's results together, in issue order.** A
  fast Read issued alongside a slow Bash had its `tool_result` timestamped ~20 s after the
  read must have finished and 13–26 ms *after* the Bash's result. Arrival order and
  completion order therefore coincide on this wire, which is what makes the external
  review's reordering scenario (E1) real in the code and unreachable through today's
  transport.
- (T12) The fullscreen renderer drops OSC-8 hyperlink labels: a file-tool header paints
  `⏺ Read(` and stops where classic paints `⏺ Read(alpha.txt)`. Pre-existing — reproduced
  identically on the last pre-wave commit `ec9e7a2f97` — and tmux handles the hyperlinks
  correctly when driven directly, so it is ours. This wave changed its *exposure*, not its
  existence: expanded clusters put many file rows on the main frame.

## 8. Outcomes & Retrospective

**The wave shipped.** In the fullscreen renderer, adjacent tool calls fold into one dim
cluster row (`Searched for 1 pattern, read 2 files, ran 2 shell commands`) with all Bash
collapsing, silent absorption of TodoWrite/Task-board tools and ToolSearch, and git
operations scraped from bash output into their own clauses; while the turn runs the row is
live — spinner, present-tense verbs, a `⎿` hint line and an elapsed `· 2s` once the newest
member has run two seconds; clicking a cluster expands it in place into its members'
per-call rows and clicking again collapses it. The classic renderer is unchanged.
Thirteen planned tasks plus one re-scoped repair (T5b), a whole-branch external review and
two acceptance runs, from base `832475b7e5` to `28053d292b`. Gates at close: typecheck
clean, `test:tui` 3748 passed / 9 skipped, `test:unit` 2891 passed.

**Acceptance: 10 PASS · 1 partial · 0 FAIL**, and the evidence is not uniform — read the two
tiers separately. **Live-verified** (a real keyed turn over a pty under tmux): A1 (cluster
forms), A3 (live form), A5's ctrl+o round trip, A11 (elapsed ticker, five sub-claims with a
held-open control on the classic arm), and A10 in part. **Replay-verified** (hand-written
session JSONL resumed through the harness's pure replay path, which builds the same
in-memory document a live turn builds; everything downstream — folding, projection,
rendering, hit-testing, click handling — is the shipped code driven over a real pty):
A2, A4, A6, A7, A8, A9. Replay is genuine evidence for those cells and weaker evidence than
a live turn; the distinction is recorded rather than averaged away.

**A10 is a partial and must not be rounded up.** The cell as written passes live: a cluster
clicked ~17 s into a turn with two members still in flight stayed expanded through three
later arrivals and after settling, which does discriminate against an implementation keyed
on the churning fold-row item id. But the specific defect the external review found — a
later-issued call finishing first, reordering the run and orphaning the expansion — could
not be produced, because of the transport fact recorded in §7: results arrive in issue
order. **So E1's fix (anchor on the earliest-issued `callSequence`) is correct and cheap but
defensive, not load-bearing.** It stays, because a transport that batches differently, or a
future non-batched path, makes the scenario live.

### What this wave is worth telling the next one

**Nine prescribed test cells could not fail, across ten tasks.** Not nine bugs — nine cells
that would have gone green forever while the behavior they named was broken. The recurring
shape is now clear enough to state as a rule: *a cell written from a design document
reproduces the SITUATION a bug lives in; a cell that catches the bug has to isolate the
MECHANISM from whatever else papers over it.* What did the papering over, each time, was
ordinary and invisible from the document: a 600 ms live-repaint interval that re-projects on
its own tick, a fallback path that reaches the same answer by another route, an ASCII
fixture where two candidate rules coincide, a fixture that renders between two events so a
stamp and an arrival share a timestamp. When writing a cell from a spec, ask what else in
the running system could produce the asserted output — and if the answer is "something",
the cell is not yet a test. Sabotage is the cheap check: mutate the line the cell is for and
watch it go red.

**Three independent defects shared one class: a value computed at the wrong moment.** The
elapsed timer stamped a start when a projection first *looked* rather than when the call
*arrived*; the compact-summary chip baked a renderer-dependent string at ingest, so no later
flip could correct it; the cluster anchor derived identity from an ordering that is stable
only before calls settle. A fourth instance was found and deliberately left unfixed
(`useChat.ts:1477` — unobservable today, since `systemNoticeLines` forwards `expandHint` to
none of its branches; it becomes a live defect the moment one starts drawing a chip). The
generalizable form: **prefer deriving at use over storing at ingest**, and be most suspicious
where the stored value depends on something that can change later — a renderer identity, an
ordering, a clock. Two structural moves closed the class rather than the instances: the read
that secretly wrote was split into a write interface and a pure read interface, so the render
path can no longer create a stamp *by construction*; and when the anchor key changed meaning,
the pop-out invariant needed a new proof derived from the new meaning, not an edited comment.

**Over-faithfulness is a fidelity port's characteristic failure, not under-building.** Twice
the spec prescribed behavior read out of the reference product that our transport cannot
deliver: a decimal duration format the reference's own formatter cannot emit at that call
site (the decimal formatter is a different function, used for other rows), and a start
timestamp our wire does not carry at all. Both were caught by implementers reading the
bundle rather than the brief. Copying an observable behavior and copying its inputs are
different instructions — when a port names a mechanism, verify that the mechanism's inputs
exist here before pinning a cell to its output.

**Six of the wave's corrections were to the governing artifacts — the spec and plan — found
during execution by implementers and reviewers who overruled their briefs.** A plan
parenthetical that contradicted the very citation it quoted survived plan review and a spec
round, and became visible only when a later task consumed it. That is the intended direction
of information flow: the brief is the best available guess, and the person with the code open
is the one holding the evidence. The corollary the wave also earned: a characterization
handed up in a task report is a *claim* — one such claim became a recorded "known limitation"
that measurement later showed does not exist.

### Recorded divergences from the reference product

Each is deliberate, priced, and lives in the section that owns it; collected here because the
scorecard reader looks for them in one place.

1. **The bash `(Ns · N lines)` suffix is CUT** (§3.1, round 4). Probe 100
   (`probes/probes/100-tool-progress-stream.ts`, live on SDK 0.3.220): zero `tool_progress`
   frames arrive between `tool_use` and `tool_result` in the default environment, no frame of
   any kind carries an output-line count (eleven spellings scanned), and the one elapsed
   carrier is gated behind `CLAUDE_CODE_REMOTE`/`CLAUDE_CODE_CONTAINER_ID` and throttled to
   one sample per 30 s. The line half has no source and must not be faked; A11 carries a
   guard cell asserting the suffix never appears.
2. **An all-silent cluster emits no row** (§3.1, round 3). Canon emits a zero-height but
   clickable row; an invisible clickable region has no meaning in an item-based projection.
3. **The errored-sibling set is per-lifetime, canon's is per-arriving-message** (§3.1,
   round 7). They part only when same-entry siblings error in different entries, which only
   disk-sourced multi-block entries produce, and the effect is membership-only now that the
   failure row is unconditional.
4. **PR numbers render as text with no link affordance** (§3.1, round 8). Canon registers the
   hyperlink as a side effect of its own row component; `FoldClause` is text plus bold ranges
   with nowhere to hang an href. The scraped `GitPrOp.url` is carried through the counts so a
   future render layer can use it — **the one open backlog item this wave leaves behind**.
5. **The elapsed ticker's start time is a local first-ingest stamp** (§3.1, round 16). Canon
   reads a wire message timestamp; our wire carries no timestamps at all. So the ticker is
   accurate to one repaint rather than to the call's true start, and an unstamped member
   renders no ticker rather than a zero.
6. **An expanded cluster that is still running shows no progress at all** (measured in T12's
   second run). Expanding a live cluster drops the blinking leader row, the `⎿` hint block
   and the elapsed ticker in one step; in-flight members render as bare header rows —
   seventeen seconds of `⏺ Bash(…sleep(20)…)` with nothing beneath it. Opening a live cluster
   trades all progress signalling for the member list. **What canon does in this state is
   still unmeasured against the bundle**; this is the wave's most substantive fidelity gap
   and the natural first item of a follow-up.
7. **The v1 mouse cut** (§2): mouse arming stays `?1000h ?1006h`, so there is no hover
   brighten, no expanded-row background tint, no click-to-position-cursor in the composer and
   no auto-copy-on-select, and tap detection approximates canon's "no selection produced"
   with "press and release in the same cell" (under mode 1000 the two rules coincide).
   Reserved for a follow-on full-mouse wave with canon's selection engine.
8. **The classic renderer keeps its 2.1.220 fold subset** (§2). Canon's `Joi` list is
   unconditional, so canon 2.1.234's *classic* renderer absorbs the task-board tools too.
9. **Two canon scraper bugs are not ported** (§3.1, round 3): the raw-string `--amend` match
   and the per-block re-scrape.

Three smaller items are recorded here because they were decided during execution and belong
with the list rather than in a task report. (a) **§2's "PowerShell — not applicable, skipped"
is now stale**: T3's implementer ported canon's separate PowerShell classifier (cmdlet sets
and all 87 aliases, 15 of them outcome-changing) while chasing a naming Minor; the reviewer
verified it statement by statement and judged it defensible-but-should-have-been-a-ticket, so
it ships fullscreen-gated **with no live evidence, because the tool is unreachable on this
platform**. (b) The **session-picker preview stays classic inside a fullscreen session** —
deliberate, unchanged, and noted so nobody reads it as a fold bug. (c) An **SGR report torn
across two reads leaks its tail into the composer as text**; this is pre-existing per-chunk
input behavior, and the repair belongs where paste re-joining lives, not in the mouse decoder.

**One entry is deleted rather than carried.** The "expanded rows persist into the classic
replay" limitation — recorded from a report's characterization, withdrawn in round 13 — was
measured live in T12 and **does not exist**: expanding a cluster and flipping to classic
shows the recomputed COLLAPSED row with its chip, and nothing from the expanded form leaks.
Trap recorded with the measurement, because it silently produced a non-event on the first
attempt: with the renderer pinned by an environment variable, `/tui default` answers
`Saved. The default renderer does not apply here (env_on)` and switches nothing.

### Follow-ups leaving the wave

- **The fullscreen renderer drops OSC-8 hyperlink labels** (§7, T12). Pre-existing, not a
  regression from this wave — reproduced identically on `ec9e7a2f97` — but expanded clusters
  put many file rows on the main frame, so its exposure is new. Its own ticket; scored on
  `docs/parity/tui-ux.md`'s tool-use row.
- **The open-expanded-cluster progress gap** (divergence 6) — needs a bundle measurement
  before it needs a design.
- **The PR-link affordance** (divergence 4) — the data is carried; nothing schedules the
  render layer.
- **A third instance of the wrong-moment class at `useChat.ts:1477`** — reported, not fixed,
  deliberately: it needs the same species-tag treatment and is wider than this wave.
- **Probe-number collision:** `100-tool-progress-stream.ts` (this wave) collides with Wave
  C's `100-prompt-suggestion-and-spinner-tokens.ts`, as `106` and `109` already collide from
  earlier waves. Bare "probe 100" is ambiguous in this document's prose — **cite by
  filename**; renaming is left to a housekeeping pass rather than done here.

## 9. Revision Notes

**Round 17 — 2026-08-19, T13 close-out (execution).** §8 written, §7 grown with what Tasks
5b–12 overturned, and the last owed measurement resolved: the withdrawn "expanded rows
persist into the classic replay" limitation was measured live and does not exist, so it is
deleted rather than carried. Two things the close-out refused to smooth over: **A10 is
recorded as a partial**, because the reordering scenario its fix addresses is unreachable
through today's SDK transport (results of a parallel batch arrive together, in issue order),
and the acceptance evidence is split into live-verified and replay-verified tiers rather than
averaged. Scorecard: `docs/parity/coverage.md` records the wave with **no domain score
moved** — it consumes no SDK surface — and `docs/parity/tui-ux.md` carries the two rows that
actually move plus one mark-DOWN for the OSC-8 defect the acceptance run found.

**Round 16 — 2026-08-19, T11 review (execution).** The last code task, and the round where the
spec was wrong twice about the SAME feature. Both errors were mine, both were found by the
implementer, and both were then confirmed independently by the reviewer and by me in the bundle.
(1) §3.1 claimed the member's start time "is already stamped in the transcript"; our wire carries
no timestamps at all (P82) and `ToolEvent` holds `callSequence`, not a clock. Canon can afford
`Date.parse(message.timestamp)`; we cannot, and the honest port keeps canon's observable behavior
while replacing its mechanism — recorded as a divergence, not papered over. (2) The prescribed
`· 2.0s` pins a string canon CANNOT emit: its formatter here (`da`, 82602) floors to whole seconds
under a minute, and the decimal formatter in that same module (`OAt`) is a different function this
call site never calls. Ninth dead cell of the wave. The general lesson has now inverted: a
fidelity port's characteristic failure is not under-building but over-faithfulness — writing what
canon appears to do from a reading, against inputs we do not have.

Two more findings worth keeping. The review found the wave's last real defect, and its shape is
worth naming: `startedAt()` both read and wrote, so "when did this call start" silently meant
"when did a projection first bother to ask" — and the expanded-cluster early return sits above
that call, so an OPEN cluster stamped nothing and a 40-second call could print `· 3s`. The fix
moved the stamp to ingest (the `stampAgentCalls` precedent, replay guard and all) and then split
the capability so the render path cannot write at all: `stamp()` on `FoldStartStamps`,
`startedAt()` as a pure read on `FoldPendingHooks`. And a second unbitten guard beyond the
disclosed one — `toolFold.ts:368`'s pre-silent-return ordering guards reachable behavior yet no
cell bit it.

A gap in §4 itself is closed here: the ticker shipped as visible behavior with no acceptance cell,
so the live run would have "accepted" the wave without once looking at it. **A11** is added.

**Round 15 — 2026-08-19, T10 review (execution).** The chain closes: a click on a collapsed
cluster expands it, end to end. The review found the one defect isolated tests structurally
could not — the tap was anchored to a terminal CELL, so any document movement between press
and release lands it on whatever cluster now occupies that cell, and streaming moves the
document with no gesture at all. Proven with a live probe. §3.2's tap rule above is corrected
to anchor on the resolved cluster identity. Two more dead cells found by the implementer
(seven and eight for the wave): the ctrl+o pager cell cannot test the gate, because the pager
REPLACES the viewport so the hit map is detached and the click is inert for reasons unrelated
to the gate — replaced with the model picker, a seam surface that leaves the viewport painting
beneath it, which is the only shape in this codebase where the gate is the sole refuser (a
consequence of round 12's "occlusion is omission"). And the gate's `fullscreen` term is
unfalsifiable: three independent facts already make a classic click impossible. Kept anyway,
deliberately — one token, versus letting "classic has no click path" rest on three incidental
facts that separate refactors could each remove with no cell noticing.

**Round 14 — 2026-08-19, T9 review (execution).** PASS/PASS. §3.3's column-bound rule was
wrong in two independent ways and is corrected above — the implementer caught the wide-leader
half and overrode the brief; the reviewer found the worse half, that the literal rule would
have made every gutter-block body row unclickable. The map's shape is also updated to what
shipped. And the fifth dead cell of the wave, this one on the exact line the implementer
deliberately changed: reverting the width rule back to character count leaves all five cells
green, because every string in the fixture is ASCII — so the one place a later hand is most
likely to "correct" the code back to the brief is the one place nothing would stop them. A
fixture with real width is being added. Recorded, not changed: the whole region-top context
channel is unfalsifiable (deleting the frame's contribution and deriving the constant locally
keeps every cell green), so what the suite pins is that SOME gate exists, not that the gate is
the published origin.

**Round 13 — 2026-08-19, T8 review (execution).** PASS/PASS, five minors, no defect in the
diff. Two entries here are corrections to MY OWN artifacts rather than to the work. (1) The
"expanded rows persist into the classic replay" limitation is withdrawn pending measurement
(see the 2026-08-18 note below) — it was recorded from a report's characterization, never
observed, and T5b's repair plausibly removed it. (2) A fourth prescribed cell pinned nothing:
the "stays expanded while growing" cell, written against a run with a still-OPEN member,
passes even under a finalized-only toggle, because an open call keeps a 600 ms live-repaint
interval that re-projects the pending region on its own tick. The implementer found it and
rewrote it against a settled-but-unclosed run (no interval, so the toggle's own re-projection
is the only thing that can move the row); the reviewer reproduced both halves by sabotage —
the original passes the broken build in 669 ms, one tick after the toggle. The general lesson,
now four for four: a cell written from a design document describes the SITUATION a bug occurs
in; a cell that catches the bug has to isolate the MECHANISM from everything else that might
paper over it.

**Round 12 — 2026-08-19, T7 review (execution).** Both handed-down decisions were made
deliberately and both were judged correct — a swallowing surface swallows clicks, and a
button gesture clears a pending chord. But the review found the implementation's *recorded
reason* for the first one factually false of this codebase: it argued from stale row maps and
surfaces drawn over the viewport, and neither exists here. That prompted the architectural
note above, which is the durable output — the next task that reaches for an occlusion signal
would otherwise have found a comment promising one. The right grounds are symmetry with the
text branch, §3.3's dialog mandate, and (the one swallower-specific reason) that toggling
expansion state during a rewind hold mutates state across the very document swap the hold
protects.

**Round 11 — 2026-08-19, T6 review (execution).** The live premise is CONFIRMED — a real
mouse press/release into a terminal emulator armed with exactly our two modes emits the
expected SGR pair, and those bytes survive tmux transport into an app arming only those
modes. The reviewer corroborated the load-bearing half structurally (the true button number
on release is what mode 1006 is FOR), which is stronger than the observation alone. The
review also found that §3.2's own decode rule was one term short: extended buttons 8–11 add
128 the way 4–7 add 64, so the rule as written turned a five-button mouse's "back" press
into a left click. Rule corrected above, along with a 1-based coordinate floor, the
anonymous-release decision, and the fullscreen-only reach of mouse reporting.

**Round 10 — 2026-08-19, T5 review (execution).** Round 9's decision is withdrawn. It rested
on the flip damage being *staleness* (history folded under the old policy); the reviewer
measured it and it is *duplication* — both the cluster row and its per-call rows on screen for
the same calls, violating a pinned invariant and compounding per flip. Accepting a seam was
defensible; accepting a duplicating replay is not. Re-scoped as its own task (plan Task 5b).
The lesson is narrow and worth keeping: a characterization handed up from a task report ("it
goes stale") is a claim, and a decision built on it is only as good as that claim.

**Round 9 — 2026-08-19, T5 switch-over (execution).** Making the fold policy
renderer-dependent created an interaction that did not exist before: a live `/tui` flip now
leaves already-finalized rows folded under the old policy. Decided and recorded above — accept
the seam rather than clear the user's visible transcript, since append-only `<Static>` makes
re-projection additive rather than corrective. Task 13 records it in the scorecard.

**Round 8 — 2026-08-19, T4 review (execution).** Three corrections. (1) The scrape gate was
inherited too wide from Task 3's plan text, whose parenthetical ("canon records every bash
command for the scraper, 237152") contradicted the very quote it cited — canon records only in
its `isBash` branch. Live repro: `grep -A2 "git push" ci.log` over a CI log produced a phantom
"Pushed to main" clause and swallowed a real shell-command clause. Recording and scraping are
now both gated on the bash classification, matching 237152. (2) The PR hyperlink gap is recorded
above rather than left unowned. (3) The plan's Task 4 interface block still declared the op
arrays as `string[]`; the shipped record shapes are now in the plan, since Tasks 5 and 8 read it
for their input types.

**Round 7 — 2026-08-19, T3 gate review (execution).** Task 3 approved. One canon divergence
recorded above (the errored-sibling set is per-message in canon, per-lifetime in ours —
reachable only on disk-sourced multi-block entries, membership-only in effect), and Task 8's
plan gained the de-duplication obligation the round-6 rule created.

**Round 6 — 2026-08-19, T3 fix re-review (execution).** The round-5 "never swallowed" rule
was itself too narrow, and the re-review caught it: canon's error row is pushed
unconditionally (237210, verified in the binary by the controller — the push sits outside
the if/else), so the rule is now unconditional and relocation decides membership only. The
original failure mode — a failed board write invisible inside a cluster with other members —
was still open under the round-5 wording. This adds one Task 8 obligation (skip an
already-standalone member when rendering an expanded cluster). Also pinned: the same-message
sibling endpoint case, which a strictly-inside window misses, resolved with canon's own
all-siblings-errored predicate.

**Round 5 — 2026-08-19, T3 review (execution).** Two §3.1 additions forced by the first
code task's review. (1) The pop-out relocate/stay test is pinned as a *sequence-window*
test, after the implementer's one-atom-lookahead translation was shown to diverge from
canon on three orderings — the failure being a failed board write folded invisibly into a
summary. (2) A composition hole between two existing pins is closed: "no group for an
all-silent run" plus "an error closes the run" could between them make an errored
bookkeeping call vanish with no row anywhere; an errored silent call is now explicitly
never swallowed. Both are behavior the spec owns, not implementation detail.

**Round 4 — 2026-08-19, T2 probe gate (execution).** Probe 100 settled §3.1's live-dressing
gate NOT REACHABLE: the bash `(Ns · N lines)` suffix is cut and recorded as a divergence,
the elapsed ticker ships on our own clock. Plan Task 11 shrinks to the ticker half; §4's
acceptance is unaffected (no cell named the suffix).

**Round 3 — 2026-08-19, T1 canon addendum (execution).** The spec-mandated canon re-read
landed (`grounding/2026-08-18-tool-stream-ground-addendum.md`, commit `ab08873656`) and
corrected §3.1 in three places. (1) The git no-double-count **mechanism** was wrong: the
spec said the bash calls "move out of `bashCount` into `gitOpBashCount`"; canon keeps
`bashCount` gross and subtracts at render *after* the watermark ratchet. Implemented as
written, the shell clause would latch at its pre-git value permanently — verified in
canon at 518466–518467 by the controller before adopting. The invariant was right; the
mechanism is now canon's. (2) Pop-out was under-specified: an error always closes the run,
but relocation happens only in canon's narrow last-message/all-errored/no-hooks case;
otherwise the errored call stays inside the cluster. (3) "ToolSearch breaks nothing" was
right on counting, wrong on identity — every silent call can *open* a run and own its
anchor. Two new decisions recorded above: all-silent clusters emit no row (canon's
zero-height clickable row is not portable to an item-based projection), and two canon
scraper bugs (raw-string `--amend` matching, per-block re-scrape) are not ported.

- 2026-08-18: v1 authored from the canon grounding doc + module reads (toolFold,
  foldPendingState, toolRenderer, parse/KeymapProvider/types, wrapItems,
  FullscreenViewport/Frame).
- 2026-08-18: review round 1 (independent spec reviewer; 11 Important + 6 Minor, all
  adopted): classic-renderer rationale corrected to a recorded divergence (Joi is
  unconditional in canon); git scraping moved to per-result absorption; pop-out
  consumption flagged as a mandated canon re-read with the anchor-stability invariant
  pinned and members-when-expanded grounded; mouse decode gains `(button & 64) === 0`;
  sink is a `useMouseSink` registry hook, not a KeymapDeps callback; row-map resolves
  anchor ids + textWidth with the frame publishing the region top; blank-tail clicks
  dropped (column bound); dialog gate named (not the scroll gate); bash-suffix
  progress-stream premise gets a probe gate; A1 tolerates the thought clause; A6 pins
  members-in-expansion; A10 added (mid-turn expansion persistence); expansion-set
  lifecycle mirrors FoldPendingState.reset(); chip suppression documented as blanket;
  tint-drop rationale re-justified on cost.
- 2026-08-18: plan review round 1 corrections flowing back: §3.4's "pager keeps its
  chips" was wrong — in fullscreen the suppression reaches the pager too, and that
  matches canon (its overlay sits under the same Ett provider); recorded one known
  limitation for the plan's T8 — items committed to the classic replay while a cluster
  was expanded stay expanded-form after a later `/tui default` (same trade family as the
  fullscreen wave's "answers commit whole"). **WITHDRAWN pending measurement, round 13:
  this limitation was never observed, and reading the code after T5b suggests it does not
  exist** — `refoldFor` does not append, it re-projects the whole document under the new
  policy, replaces `publishedIds` wholesale and runs on the fullscreen side of the flip
  where `<Static>` is holding nothing, so the classic arm's first sight of the list is
  already the recomputed collapsed one. T8's reviewer could neither reproduce it nor
  disprove it (at the harness's row grant nothing settles out of the live window, so there
  is nothing to observe). **Task 12 measures it live; Task 13 records the measured answer
  or deletes the entry.** Recording an unmeasured divergence is exactly the failure round
  10 was written about. **MEASURED AND DELETED (2026-08-19, T12): the limitation does not
  exist.** An expanded cluster flipped to classic replays as the recomputed COLLAPSED row
  with its chip; nothing from the expanded form leaks. The withdrawal was correct, and the
  entry is closed rather than carried into the scorecard. One trap came with the
  measurement, because it silently produced a non-event on the first attempt: with the
  renderer pinned by an environment variable, `/tui default` answers `Saved. The default
  renderer does not apply here (env_on)` and switches nothing.
