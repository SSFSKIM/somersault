# Tool-Stream Wave (TS) — fullscreen tool-cluster collapse + click-to-expand

**Purpose.** Close the biggest remaining fullscreen-fidelity gap: in canon 2.1.234's
flicker-free renderer, every tool call that is not a Write/Edit/Agent/plain message is
absorbed into a compact, live-streaming cluster line, and clicking that line expands the
cluster's calls in place — the only granular expansion control in fullscreen. ccx today
folds only read/search/list runs (the pre-fullscreen 2.1.220 policy) and discards every
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
- no expanded-row background tint (a hover-family affordance; meaningless without it),
- no click-to-position-cursor in the composer, no auto-copy-on-select,
- tap detection approximates canon's "no selection produced" with "press and release in
  the same cell" (under mode 1000 there are no motion reports, so a drag is exactly a
  press and a release in different cells; the two rules coincide).

Everything in §1 items 1–5 and 7 ships at full fidelity, minus the pieces above.

**Not applicable to ccx (absent from the SDK tool surface), skipped with no divergence
recorded:** PowerShell, REPL, workshop/scratchpad/memory-path Write/Edit, team memory.
**Out of scope, unchanged:** the classic renderer's fold policy (canon gates every
widening on `Ns()`; ours gates on the fullscreen renderer the same way), brief mode
(ctrl+shift+b), `/tui` gating, the ctrl+o pager.

## 3. Design

### 3.1 Fold-policy widening (pure model: `toolFold.ts` + `foldPendingState.ts`)

`classifyToolEvent` gains a `fullscreen: boolean` input (canon threads `Ns()` through the
policy itself, 236816 — ours threads the renderer identity from the caller; the pure
module stays clock- and environment-free). Under `fullscreen`:

- **Bash**: every call classifies into the run. Read-ish commands keep feeding
  read/search/list counts exactly as today; non-read commands feed a new
  `bashCount` + `bashCommands` (id → command string) on `GroupCounts` (canon 237020,
  237152). Standalone-Bash rendering remains the classic renderer's behavior.
- **ToolSearch**: absorbed silently — counted nowhere, breaks nothing (canon 236808).
- **TodoWrite, TaskCreate, TaskGet, TaskUpdate, TaskList**: absorbed silently, but an
  errored result **pops the call out** — the run flushes and the call renders standalone
  (canon `popsOutOnError`, 236809; the pop-out is the errored-workshop-write branch at
  237199 generalized to this family).
- **Git-operation scraping** (canon `odS`, 237212): when a cluster closes with
  `bashCommands`, successful git commits/pushes/merges/rebases and `gh` PR actions are
  scraped from the recorded commands + results into `commits[] / pushes[] / branches[] /
  prs[]` on the counts, and those bash calls move out of `bashCount` into
  `gitOpBashCount` (so "committed abc123f" and "ran 2 shell commands" never double-count
  one call). The implementing task re-reads canon's scraper (from 237212 into `odS`) and
  ports its recognition rules verbatim; this spec pins only the output shape and the
  no-double-count invariant.
- **WebFetch and WebSearch stay non-collapsible** — canon's policy, verified, even though
  intuition says "reads collapse".

`foldClauses` grows the fullscreen clauses in canon's fixed order (518545–518635):
git parts ("committed"/"amended commit"/"cherry-picked" + short shas, "pushed to" +
branches, "merged"/"rebased onto" + ref, PR verb + number) come after the edit parts and
before "searched for"; "ran N shell command(s)" comes last before the memory parts.
Verb pairs are present/past per the grounding table. The existing bold-count ranges,
title-case-first rule, active `…`, and the `foldPendingState` watermark ratchet all
apply unchanged to the new counts.

**Live dressing** (canon §6, droppable to a follow-up ticket if it crowds the wave): the
per-tool elapsed `· N.Ns` ticker and the bash `(Ns · N lines)` suffix, both appearing only
after 2 s in flight. The existing active hint gutter (`latestDisplayHint`) already covers
canon's "current tool" line; it gains bash commands as hint sources.

### 3.2 Mouse click pipeline (input: `keys/parse.ts` → `keys/KeymapProvider.tsx`)

- `parse.ts`: SGR reports with `button & 3 !== 3` and no motion bit decode into a new
  `MouseEvent` variant — `{ kind: "mouse"; action: "press" | "release"; button: 0 | 1 | 2;
  col: number; row: number; ctrl; alt; shift }` (1-based col/row as the terminal sends
  them; wheel stays a `KeyEvent` exactly as today; everything else stays
  `ignored("mouse")`).
- `KeymapProvider` routes `kind: "mouse"` to a registered click sink (a ref-callback slot
  beside the existing deps, same pattern as `onUnknownSequence`) instead of dropping it.
  Mouse events never enter the binding table — canon's clicks are not keybindings either.
- **Tap detection** lives in the sink's owner: a `press(0)` records `(col,row)`; a
  `release` at the same cell within no particular deadline is a click; anything else
  discards the anchor. Only button 0 clicks act; modified clicks (ctrl/alt/shift) are
  ignored (Shift never arrives anyway — terminals bypass reporting for shifted mouse).

### 3.3 Hit-testing and expansion state (fullscreen renderer)

- The fullscreen viewport already knows, for the frame it just sliced, which wrapped row
  came from which item (`wrapItems.ts` `sourceId`). It exposes the current frame's
  row-map — `(terminalRow) → itemId | undefined` — through the same ref-channel family the
  scroll handle uses (`scrollRef`), accounting for the region's top offset, the jump
  pill's row, and the retained scroll offset. Rows belonging to the pill, banner, dock,
  park row, or blank tail resolve to `undefined`.
- **Expansion state**: `expandedFolds: Set<string>` keyed by the run's **anchor id**
  (`memberIds[0]` — already the stable identity `foldPendingState` ratchets on; the
  content-derived key gives canon's stays-expanded-while-growing behavior for free). It
  lives beside the transcript state in `ChatApp`/`useChat`, session-lifetime, never
  persisted, surviving ctrl+o round-trips and later turns.
- **Projection**: `groupItems` receives the set through `ProjectionOptions`. An expanded
  run emits, instead of the one fold row, the existing **per-call verbose items** of its
  members (the same items the ctrl+o pager and classic verbose view already render), each
  re-tagged so its row-map entries resolve back to the run's anchor id. Clicking any row
  of the expanded block — or the collapsed row — toggles the anchor in the set. A click
  on a row whose item is neither a fold row nor a member of an expanded run is a no-op
  (v1 clickable species: fold clusters only; canon's clickable error/truncated results
  are reserved).
- **Dialog guard**: while any dialog/overlay owns the keymap, clicks are inert (the sink
  checks the same gate the scroll keys already respect).
- Clusters (and expanded member items) are **already outside any Static region** in
  fullscreen — the viewport is fully virtualized — matching canon's
  `collapsed_read_search → never static` (549695). No work, but the invariant is named
  so nobody "optimizes" expanded members into Static later.

### 3.4 Chip suppression (canon Ett)

In the fullscreen renderer every `(ctrl+o to expand)` chip renders as nothing: the
`expandHint` already threaded through `ProjectionOptions`/`RenderMessageOptions` is set
to the empty string by the fullscreen render path (the three-state contract in
`keys/hints.ts` already treats `""` as "no hint"), covering the fold row, `hiddenToolUsesLine`,
and `outputFold`'s compact marker. Classic renderer and pager keep their chips.

## 4. Acceptance (observable behavior; keyed live cells run under the tmux driver with an isolated HOME under /tmp + CCX_FLEET_ROOT)

- **A1 (cluster forms).** Fullscreen, live keyed turn that Reads 2 files, Greps once, and
  runs 2 non-read Bash commands with no interleaved text: exactly one dim cluster line
  when settled, reading `Searched for 1 pattern, read 2 files, ran 2 shell commands`
  (bold counts; first word capitalized; no `(ctrl+o to expand)` chip anywhere on it).
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
  cluster nor appears in its copy; a TodoWrite that errors renders standalone.
- **A7 (git ops).** A turn whose Bash runs `git commit` + `git push` yields cluster copy
  containing `committed <shortsha>` and `pushed to <branch>`, and those two calls are not
  also counted in "ran N shell commands".
- **A8 (no regression).** Wheel scrolling, Shift/Option drag-select, wheelGuard's 75 ms
  arrow suppression, and every existing keybinding behave as before (suites: unit, tui,
  resize-matrix all green; the BL5 acceptance pokes re-pass).
- **A9 (classic untouched).** On the classic renderer (`--tui default`), fold policy,
  copy, and chips are byte-identical to before this wave (snapshot evidence).

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

## 7. Surprises & Discoveries

- (seeded from grounding) Canon has no "flicker-free collapse component" — fullscreen
  only widens what feeds the pre-existing `collapsed_read_search` species, and makes the
  row clickable in the virtual list. Two mechanisms, not one.
- Click/selection coexistence is deferral (press-anchors-selection, click-on-empty-
  release), not modifier keys — the opposite of the BL5 assumption that DECSET 1000
  forces modifier-gated selection everywhere.
- No telemetry fires on inline expand in canon — there is no event name to imitate.

## 8. Outcomes & Retrospective

Pending — written at finish.

## 9. Revision Notes

- 2026-08-18: v1 authored from the canon grounding doc + module reads (toolFold,
  foldPendingState, toolRenderer, parse/KeymapProvider/types, wrapItems,
  FullscreenViewport/Frame).
