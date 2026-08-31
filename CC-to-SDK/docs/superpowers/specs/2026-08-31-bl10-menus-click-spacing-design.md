# bl10 — Slash-command menu shell, expanded-click hit region, inter-block spacing

**Round:** bl10 (2026-08-31) · **Canon:** Claude Code 2.1.251 (`~/claude-code-bundle/2.1.251/cli.pretty.js`,
first round on the re-tooled ESM-chunk bundle) · **Status:** v1
**Research base (all cites resolved there):** `.doperpowers/sdd/2026-08-31-bl10-round/research-slash-menus.md`
(R1), `research-click-collapse.md` (R2), `research-spacing.md` (R3).

## 1. Purpose

Three owner observations, post-research:

1. Canon's slash-command menus ("/status, /mcp, /plugins each load a menu bar") are real and ride **one
   shared dialog framework** — a tab shell (`Pg` L122645), tab pane (`Zi` L122728), dialog frame with an
   auto keyhint bar (`me` L568952), and a command-`type` discriminator. We transcribed the tab *strip*
   faithfully and deliberately skipped the rest; three of our dialogs hand-roll the same boilerplate, and
   `/status`/`/usage`/`/cost`/`/stats`/`/mcp` fall back to text dumps. Build the shell, the `/mcp`
   browser, and the missing entry points. (`/compact` was a **MISREAD** — text-only in canon too.)
2. "Click expands but re-click doesn't collapse" is a **hit-region [BUG]**: our fold state machine and
   dispatch are correct two-way toggles (pty-verified in bl4), but an expanded block's clickable width
   stays at painted-glyph width, while canon's expanded block paints a full-width background rectangle
   whose styled cells defeat the blank-cell filter — in canon you can click anywhere on the band to
   close. We even pin the wrong behavior at `test/tui/fold-click.test.tsx:707`.
3. "Our TUI is too tight between blocks" is **[NOT-BUILT]**: canon puts exactly one blank line above
   every top-level transcript block (`addMargin`, `gm` L18761–18768; invariant across metadata-header
   modes), plus spinner/composer margins. We emit zero everywhere — the F1 research recorded the rule
   verbatim but `RenderItem` never grew a margin concept. One adjacent **[BUG]**: inside an expanded
   cluster, absorbed-thinking rows get their leading blank but sibling member rows don't.

## 2. Design

### 2.1 T-MENU — the dialog shell and its first tenants

**Shell (the load-bearing piece).**
- Extend `select/Tabs.tsx` with the pane half: a `<Tab title id>` child component that renders its
  children only when `selectedTab === (id ?? title)` (canon `Zi` L122728). The shell derives the tab
  list from its children (canon `Pg` behavior), supporting both uncontrolled (`defaultTab`) and
  controlled (`selectedTab` + `onTabChange`) modes.
- Lift `dialogs/DialogFrame.tsx` toward canon's `me` (L568952): `title` (bold, role color), optional
  dim `subtitle`, optional right-aligned dim `titleEnd` (truncate-start), body, and an **auto keyhint
  bar** fed by an action→description registry (canon `Ye`/`Z` L568825/568835): the frame renders the
  hints for the currently reachable key scope(s), capped at 4, instead of each dialog hand-writing a
  footer string. `Esc → onCancel` binds in the frame.
- **Deferred within the shell** (D3): canon's header/body focus split (`Sf`, `registerOptIn`,
  `navFromContent`) — real canon behavior, but no surface we ship this round needs it, and it is the
  fiddliest part. The tab strip keeps our current always-active navigation.
- Migrate `SettingsDialog`, `PermissionsDialog`, `HelpDialog` onto the shell — the migration must
  **delete** the triplicated `TABS`/`TAB_SPECS`/body-switch boilerplate, not wrap it.

**Entry points (the owner-visible half).**
- `/status`, `/usage`, `/cost`, `/stats` open `SettingsDialog` on their tab (`Status`/`Usage`/`Usage`/
  `Stats`; `/config` + `/settings` keep `Config`), mirroring canon where all six commands open one
  dialog (`gq` L762665, `/status` entry `defaultTab:"Status"` L594062). The text formatters
  (`formatStatus` etc.) remain as library functions. **Information-equivalence gate (D13,
  plan-review F3):** an arm switches from text to dialog only when the dialog loader preserves the
  arm's semantics — Status re-measures context freshly on open (today's tab reads possibly stale
  `ctxPct`), the Stats tab carries `/stats`'s in-flight staleness disclaimer, and `/cost`'s
  cost/duration/per-model detail must be present in the Usage/Stats panes before its text arm is
  removed (where canon's pane lacks a field our text shows, keep the field as a recorded additive
  divergence — information preservation outranks strict pane parity). Equivalence tests precede arm
  removal.
- `/permissions` gains the missing **Auto mode** tab, inserted before Workspace. Canon's true order
  (verified at L829914-829953 against a wrong R1 reading, plan-review F5) is
  Recently denied · Allow · Ask · Deny · Auto mode · Workspace — our existing five tabs already match;
  **no reorder**. Auto mode ships **display-only** this round (D12): render the auto-mode rule data our
  model exposes, else canon's empty state; no add/edit mutations (canon's tab is conditional on
  `isAutoModeAvailable` and carries a builtins/search UI we have no data contract for yet).
- **`/mcp` browser**: a view-stack dialog (canon's second idiom, router L582270) —
  `list → server-menu → server-tools → server-tool-detail`. Root: frame titled "Manage MCP servers",
  subtitle `N servers`, grouped rows, windowed list with `↑ N more above`/`↓ N more below`, keyhint
  footer. Enter drills in; Esc pops one level (root Esc closes). Server menu shows the
  Type/URL/Command/Status field block. **Data source (D5 amended, plan-review F4):** a typed
  normalization of `session.mcpServerStatus()` rows — the SDK already returns per-server `tools`
  (`{name, description?, annotations?}`, `sdk.d.ts:1141-1151`) plus config/scope; the drill-downs
  derive from that, NOT from a flattened `mcp__<server>__` catalog (no such session inventory
  exists). **Geometry (F6):** the MCP dialog joins `paneOwned` so transcript/task-panel/spinner
  unmount beside it, like every rows-dependent overlay. **Skipped** (D5): `agent-server-menu`
  branch, OAuth/authenticate flow, the "Show all connectors" toggle — no corresponding surface in
  our session model.
- **No dialog-registry refactor this round** (D4): dialogs keep mounting through the existing
  `overlayChain`/`useChat` state-field pattern. The three-files-per-dialog tax is real (R1 §3.5) but
  this round adds only one new dialog; the `oj`-style table pays off when `/plugin`/`/hooks`/`/skills`
  land. Logged as backlog-shaped debt.

### 2.2 T-SPACE — the spacing invariant

- **The invariant: one blank row above every top-level RENDERED block.** Implemented as the
  established stand-in device (a `kind:"line"` item with empty text and a stable id —
  `toolRenderer.tsx:1061-1065` documents it), emitted **above each realized non-empty render unit**
  (plan-review F1: raw `Anchored` entries are NOT visible blocks — `buildAnchoredEntries` retains
  empty carriers whose content was filtered or absorbed, and the visible completed-tool anchor is
  added separately — so a separator gates on the unit actually contributing items, and each carries
  a unique durable boundary id, pairwise-distinct so `publishedIds` can never silently dedup two).
  Emission happens at the four concat sites:
  `weaveStandaloneHooksFlat` fast path (:1582) and interleave loop (:1587), `foldAnchored`'s out-loop
  arms (:1747-1763), and `projectPending`'s items loop (:1845-1857). Above-not-between is what makes
  the Static/window/pending region boundaries work without cross-region lookback, and reproduces
  canon's 2-blank banner→prompt seam for free. **No document-start suppression** — canon has none
  (`addMargin` ignores index).
- Model it as the invariant "1 blank above every block", NOT as threading canon's `addMargin` prop:
  canon's metadata-header modes shuffle *which element* carries the margin but never the visible gap
  (R3 §1.1). No `marginTop` field on `RenderItem` (D6).
- `projectMessageEntry`'s per-content-block loop (:900-903) gets the same separator between
  consecutive retained content blocks of one message, reconciled with the `shouldShowDot`
  consecutive-text-blocks rule (the plan pins the exact interaction).
- **[BUG] fix**: `expandedMemberItems` member arm (:1097) gets the leading blank that
  `thinkingRowItems` (:1069) already has — canon `LC` is unconditional `marginTop:1` (L193259).
- **Live streaming joins the invariant** (plan-review F8): the streaming paths bypass the anchor
  concat sites (`Transcript.tsx:27-32` classic; `streamingItems.ts` → `FullscreenViewport.tsx:371`
  fullscreen), so a live assistant block would stay glued to its predecessor until finalized. One
  stable, unbanded separator is added to the shared streaming representation; the
  streaming→finalized transition keeps exactly one gap (no jump, no accumulation).
- **Chrome**: the spinner slot (`TurnSpinner`, shared with `RetryRow`/`CompactionRow` at
  `ChatApp.tsx:1985-1987`) gets `marginTop:1` on the slot (canon `Gn` L77727, unconditional);
  the composer gets `marginTop:1` dropped to 0 while the suggestion palette is open (canon L160599;
  the authoritative palette state lives in `ChatComposer.tsx` and must be wired from there).
  **Dock budgets are remeasured, not left** (plan-review F2): `MAIN_DOCK_ROWS` (`liveWindow.ts:38-56`,
  currently the measured 14 incl. spinner=1, composer=3) becomes 16 with the two new margin rows,
  and `dockDialogRows` re-derived; tall-write tests at short/normal heights for spinner, retry,
  compaction, and palette-open states guard the Ink `outputHeight >= rows` clear/replay cliff.
- **Skipped** (D8): the REPL block's trailing `marginBottom:1` (no REPL tool surface) and canon's
  brief-layout composer condition (no brief layout).
- **Risk under management**: every block grows one painted row — live-window and pager **row budgets**
  must be re-verified, not just re-snapshotted; the resize matrix and pty cells are part of the
  ticket's battery.

### 2.3 T-CLICK — the asymmetric hit region (lands after T-SPACE merges)

- **One explicit band marker drives both paint and hit width** (D9 as revised by plan-review F7:
  `item.expanded` is NOT a valid proxy for painted cells — the absorbed-thinking margin row already
  carries `expanded:true` + `foldAnchor`, and expanded headers are tagged expanded while only result
  bodies get `withExpandedMarker`). A row-level marker (`band`) is set exactly on the rows that
  belong to the visual band — header, body, padding — and **never** on spacing separators/margins
  (canon-faithful: canon's margins sit outside the background box). The hitmap widens a row to full
  column count iff it carries the marker; the renderer paints the full-width band from the same
  marker. `clickTargetAt`'s existing `col > at.width` guard then answers correctly in both states.
- The band extends to `expandedMemberItems` rows, so an expanded fold cluster looks open and
  advertises the widened region. Hover suppression on expanded items stays (canon-faithful; the band
  replaces hover feedback).
- Flip `test/tui/fold-click.test.tsx:707` to assert the expanded blank tail **does** collapse; keep
  :696 (collapsed blank tail inert) — the asymmetry is the point. Update the `docs/parity/tui-ux.md`
  blank-tail rule to the asymmetric form.
- **Not defects, untouched** (D10): rapid same-pixel re-click within 500 ms reads as double-click
  word-select (canon identical, `bv=500` L373798) — recorded as a UX note since the widened region
  makes it slightly more likely; ctrl+o stays the global transcript toggle (canon has no per-block key).

## 3. Ticket/merge topology

Wave 1: **T-MENU** and **T-SPACE** in parallel worktrees. They are NOT fully disjoint (plan-review
F6): T-MENU's `/mcp` arm and T-SPACE's dock geometry both touch `ChatApp.tsx`, which is hereby a
**declared reconciliation seam** — the second wave-1 merge re-runs the first ticket's ChatApp-adjacent
tests, and the merge battery adds a combined short-terminal + maximum-dock integration test (MCP
dialog open, spinner ticking, palette open) that neither branch can run alone. **T-CLICK** branches
from post-both-merges main because its fold-click frames sit atop changed spacing and its band marker
must see T-SPACE's separators. Whole-round codex review + fix waves under the ledger's pre-committed
convergence rule.

## 4. Acceptance (behavior-phrased)

- **A1** `/status` opens the Settings dialog on the Status tab; `/usage` and `/cost` on Usage; `/stats`
  on Stats; `/config`//`/settings` unchanged on Config. Esc closes. No text dump in the transcript.
  Information-equivalence holds per D13: Status re-measures context on open; Stats carries the
  staleness disclaimer; every field `/cost`'s text form shows today is visible in the dialog
  (equivalence tests prove it before an arm is removed).
- **A2** `/mcp` opens "Manage MCP servers" with grouped server rows and windowed scrolling; Enter
  drills list → server-menu → server-tools → server-tool-detail; Esc pops exactly one level; root Esc
  closes; the dialog reflects the session's live MCP data (same source `formatMcpStatus` reads today).
- **A3** The Permissions dialog shows six tabs in canon's true order (Recently denied · Allow · Ask ·
  Deny · Auto mode · Workspace — the existing five keep their positions, Auto mode inserts before
  Workspace); the Auto mode tab renders real data where our model has it, else canon's empty state,
  and is explicitly display-only (D12). Tab-order and keyboard-cycling pins updated deliberately.
- **A4** SettingsDialog/PermissionsDialog/HelpDialog render through the shared shell (tab pane + frame
  + auto keyhint bar); the per-dialog TABS/TAB_SPECS/body-switch boilerplate is gone; each frame's
  keyhint bar derives from the action registry, not a hand-written string.
- **A5** Clicking the blank tail of an **expanded** block (past end-of-text, inside the band)
  collapses it; clicking the blank tail of a **collapsed** block still does nothing; the expanded band
  spans the full terminal width and its painted extent equals the widened hit extent row-for-row (one
  marker drives both); spacing separators above/below an expanded block are neither banded nor
  clickable; an expanded fold cluster shows the band. Existing 27 fold-click tests still pass with
  :707 flipped.
- **A6** Rendered frames show exactly one blank row above every top-level block (prompt echo,
  assistant text, tool row, thinking, system notice, next turn's prompt), one above the spinner slot
  and the composer (0 while the suggest palette is open), one between expanded-cluster members; tool
  header → its `⎿` body stays 0; markdown paragraph gap stays 1. Verified against the recorded canon
  frame fixture (`test/fixtures/upstream-frames/f1-tool-rendering/01-read-complete.ansi` seam rows
  14-21). A LIVE-streaming assistant block shows its gap from the first delta, the gap does not
  accumulate across deltas, and finalization keeps exactly one gap (no geometry jump). Empty anchor
  carriers (filtered tool content, absorbed thinking, suppressed notices, coalesced entries) emit NO
  separator — no phantom or double gaps.
- **A7** Full battery green: unit + tui suites, resize matrix, and the existing pty cells; live-window
  and pager row-budget tests re-verified against the +1-row-per-block geometry; `MAIN_DOCK_ROWS`
  remeasured to 16 (and `dockDialogRows` re-derived) with tall-write tests covering spinner, retry,
  compaction, and palette-open at short and normal terminal heights; the combined post-merge geometry
  test (§3) green.

## 5. Deferred (recorded, not silent)

`/plugin` (own round: 5 tabs + 6 sub-views + key scope + marketplace model), `/hooks`, `/skills`
(cheap once the shell lands — round-2 filler), `/diff` dialog, `/context` grid (a static render, not
a modal — belongs to transcript rendering), `/autocompact`, `/memory`, `/export` method picker,
`/ide`, `/sandbox`, `/artifacts`, `/release-notes`, `/import`, Stats tab's nested Overview·Models
strip, `Sf` header/body focus split, dialog-registry (`oj`) refactor, `/compact` custom-instructions
argument, cloud/account/setup family (out of reach).

## 6. Decision Log

- **D1-bl10** `/compact` classified MISREAD (canon `type:"local"`, L502735; ours already matches).
  No work; `/autocompact` (the menu the owner likely saw) deferred. Rejected: building a /compact menu.
- **D2-bl10** Shell before tenants: build Tab pane + frame upgrade first, migrate the three existing
  tabbed dialogs in the same ticket. Rejected: adding `/mcp` and status-routing on the hand-rolled
  pattern (fourth+ duplication of the boilerplate the round exists to delete).
- **D3-bl10** Defer canon's header/body focus split (`Sf`/`registerOptIn`/`navFromContent`). Nothing
  shipped this round needs it; it is the fiddliest shell piece. Rejected: full-fidelity focus model now.
- **D4-bl10** No dialog-registry (`oj`-style) refactor this round; keep `overlayChain` + per-dialog
  state fields. One new dialog doesn't amortize the churn, and the overlay chain is a hot surface for
  concurrent sessions. Logged as backlog-shaped debt. Rejected: introducing the registry now.
- **D5-bl10** `/mcp` scope = `list → server-menu → server-tools → server-tool-detail`; skip
  agent-server-menu, OAuth, show-all-connectors (no corresponding session surface). Rejected: full
  canon branch parity against surfaces we can't populate.
- **D6-bl10** Spacing = separator **item above each anchor** at the four concat sites, via the
  established blank-line device; no `marginTop` field on `RenderItem`/`RenderLine`. A field would
  touch every consumer of item geometry (wrap, pager, hitmap, height) for the same visual result.
  Rejected: the field; also rejected: between-anchors separators (breaks region boundaries and the
  banner seam).
- **D7-bl10** Model canon as the invariant "one blank above every block", not as `addMargin`
  threading — canon's header modes move the margin between elements but never change the visible gap.
- **D8-bl10** Skip REPL trailing margin + brief-layout composer condition (no such surfaces). Logged.
- **D9-bl10** (v2) Click fix = asymmetric hit width driven by an explicit row-level **band marker**
  set on exactly the rows composing the visual band, never on separators/margins; hit width AND
  full-width paint derive from the same marker. v1's `expanded`-flag proxy was killed by plan-review
  F7 (the absorbed-thinking margin row carries `expanded:true`; headers are tagged expanded without a
  band). Rejected: emulating canon's `cellIsBlank` screen-buffer test (no packed cell buffer to ask);
  rejected: the expanded-flag proxy.
- **D10-bl10** Double-click word-select eating a fast re-click is canon parity — untouched, noted as
  UX residue. Ctrl+o remains the global toggle; no per-block key added (canon has none).
- **D11-bl10** (plan review F1) Separators attach to realized non-empty render units, not raw
  `Anchored` entries (empty carriers exist by design: filtered tool content, absorbed thinking,
  coalesced entries); each separator has a unique durable boundary id. Rejected: per-anchor emission
  (phantom/double gaps); rejected: stability-only id tests (publishedIds dedup hides collisions).
- **D12-bl10** (plan review F5) R1's permissions tab order was a misread — canon is Recently denied ·
  Allow · Ask · Deny · Auto mode · Workspace (L829914-829953), so our five existing tabs already
  match and Auto mode simply inserts before Workspace. Auto mode ships display-only; its
  add/edit/builtins contract is deferred. Rejected: the reorder (a regression); rejected: "functional"
  acceptance without a data contract.
- **D13-bl10** (plan review F3) Information-equivalence gate: a text arm converts to a dialog arm
  only when the dialog preserves its semantics (fresh context measurement, staleness disclaimer,
  cost detail). Where canon's pane lacks a field our text shows, keep the field as recorded additive
  divergence. Rejected: silent rerouting (regresses correctness and information).
- **D14-bl10** (plan review F8) The spacing invariant covers LIVE streaming via one stable unbanded
  separator in the shared streaming representation, with a jump-free streaming→finalized transition.
  Rejected: finalization-only spacing (visible geometry jump per turn).
- **D15-bl10** (plan review F6) `ChatApp.tsx` is a declared reconciliation seam for wave 1; the MCP
  dialog joins `paneOwned`; a combined max-dock/short-terminal geometry test runs post-merge; T-CLICK
  branches from post-BOTH-merges main. Rejected: "disjoint worktrees" as originally claimed.
- **D16-bl10** (plan review F2) Dock budgets are remeasured, not inherited: `MAIN_DOCK_ROWS` 14 → 16,
  `dockDialogRows` re-derived, tall-write tests guard the Ink clear/replay cliff. Rejected: leaving
  the measured constant and spending the safety slack silently.

## 7. Surprises & Discoveries

- Canon's `/status`//`/config`//`/usage`//`/cost`//`/stats`//`/settings` are all ONE dialog opened on
  different tabs — the "many menus" are mostly one component (R1 §2.1).
- `local-jsx` is not always a modal: `/context` renders to a string and posts it as a system message
  (R1 §1.4) — "is it a menu?" needs two bits, not one.
- Canon's spacing survives every mode because the margin *moves* between the message body and the
  metadata-header row; the visible gap is invariant (R3 §1.1).
- Our own F1 research had recorded the spacing rule verbatim in July; the item model shipped without a
  place to put it (R3 §3) — a reminder that research→model handoff needs a traceability check.
- The click bug is not in the 27-times-tested state machine but in hit-geometry that no test aimed at;
  the one test that did aim there pinned our code's behavior, not canon's (R2 §2.5).

## 8. Outcomes & Retrospective

Pending — written at finish.

## 9. Revision Notes

- v1 (2026-08-31): authored from R1/R2/R3 verdicts.
- v2 (2026-08-31): all eight codex plan-review findings verified and adopted (F1 separators→realized
  units D11; F2 dock budgets D16; F3 information-equivalence D13; F4 /mcp data from
  `mcpServerStatus().tools` normalization; F5 permissions order corrected, Auto mode display-only
  D12; F6 ChatApp seam + paneOwned + T-CLICK rebase D15; F7 band marker D9v2; F8 streaming separator
  D14). R1's permissions-order claim corrected in place per the bundle (L829914-829953).
