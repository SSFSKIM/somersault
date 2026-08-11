# QA Wave 2 — the sweep-2 delta (design)

**Purpose.** Close the open worklist of recurring QA sweep #2 (`docs/parity/qa-sweep-2-triage.md`
§3, W1–W6): the `/copy` truth family, four dialog-input defects, the effort transaction semantics,
the statusLine stdin contract, two repaint triggers, and the resume preview. Owner directive
2026-08-11: "QA wave 2 begins"; `/copy` demoted P1→P2 by owner. Programme goal unchanged: clone
Claude Code's TUI at highest fidelity; canon is the **2.1.220** bundle
(`/Users/new/claude-code-bundle/2.1.220/cli.pretty.js`).

**Grounding.** Three research documents + one live probe, all completed before this spec:
- `$JOB/tmp/wave2-ground-code.md` — root causes for W1/W2/W6 (all high confidence).
- `$JOB/tmp/wave2-ground-code2.md` — architecture facts for W3/W4/W5.
- `$JOB/tmp/wave2-ground-bundle.md` — canon adjudication of every contested behavior, with quoted
  bundle fragments (the sweep compared against installed 2.1.226; nothing here is specced off it).
- `probes/probes/103-preturn-context-and-model-caps.ts` (run live 2026-08-11):
  `getContextUsage()` **resolves pre-first-turn** with real `maxTokens`/`totalTokens`;
  `supportedModels()` carries `supportsEffort` + `supportedEffortLevels` on every model **except
  haiku, which omits the fields entirely**.

`$JOB` = `/Users/new/.claude/jobs/4b30d1a4`. Controller verified the load-bearing bundle citation
(effort staging, L441052/441077) first-hand.

---

## Epics

### EP-D1 · `/copy` tells the truth (s2qa5-21, s2qa5-22)

The live writer of `/copy`'s source is dead code on the real wire: `useChat.ts:1082` guards on
`parent_tool_use_id === undefined` but every top-level frame carries `null` (sdk.d.ts:4557). The
resume path seeds the same ref from disk (`useChat.ts:1672`), which is why only resumed sessions
ever have a value — pinned forever. And `replaceDocument()` resets every measurement except this
one, so cleared text reaches the clipboard.

Build:
1. Both nesting guards go falsiness (`!data.parent_tool_use_id`): `useChat.ts:1082` **and** the
   `syncLiveOpen` twin at `:771` (same bug; its death also freezes the live-open animation epoch).
2. `lastAssistant.current = ""` joins the `replaceDocument()` reset block (the two seeding sites
   assign after the swap, so resume/rewind keep their seed by construction).
3. Fixture sweep: assistant/tool fixtures in `useChat.test.tsx` + `f1-tool-transcript.ts` gain
   `parent_tool_use_id: null` so the suite pins the wire shape, not the omission.

Target semantics (canon L444892): newest non-error assistant message of the live conversation;
`/clear` empties it. Ship 1+2 together — either alone leaves half the family standing. Fold: the
empty-state string becomes canon's `No assistant message to copy` (ccx says `nothing to copy`).
Parked, recorded: canon's `/copy N` over a 20-deep list (L444892/445068) — a separate feature,
backlog.

### EP-D2 · Dialog input integrity (s2qa3-10, s2qa3-12, s2qa4-11, s2qa3-11)

**(a) Amended deny row.** The first-Enter swallow is Wave T's deliberate empty-submit rule firing
through `Select.submitInput` → `onCancel` (Select.tsx:218-221), which collapses input mode. Keep
the rule; stop spending it on the wrong verb: add an `onEmptySubmit` seam to `Select` (fallback:
`onCancel`), have the five consult bodies leave the row open with a one-line nudge, and while
`inputMode` is on the footer advertises the real contract (`enter send · esc cancel`).

**(b) Plan reject speaks for itself.** Spec-review overturn: ccx already ships canon's inline row
verbatim (`PlanDialog.tsx:144` — placeholder, description, text→`plan_reject`-with-feedback,
empty→cancel→bare deny all match L500713/500973/500991). The real defect is downstream: on a
feedback-less reject the gate **fabricates** `"User rejected the plan. Continue planning."`
(`gate.ts:33` and `:68`) — a phrase that exists nowhere in the bundle — and the model reads it as
an instruction and keeps streaming, which is exactly what the sweep filmed. Build: drop the
fabricated sentence from both arms; a bare plan reject carries canon's shape (no feedback). If the
SDK's deny type requires a `message`, use a descriptive non-imperative one (`"User rejected the
plan."`), never an instruction. Observable: the turn ends; no model follow-up paragraph. The plan
dialog's empty-Enter stays canon's bare-deny (it is the ordinary "keep planning" verb, not a
silent permission deny — D-W2 does not apply here).

**(c) Double Ctrl-C over a dialog.** Overlay contexts explicitly unbind `ctrl+c` and unbound =
consumed (`bindings.ts:189` et al., resolver:75, KeymapProvider:176), so the exit arm at
`ChatApp.tsx:526` is unreachable; and even armed, the hint is gated out by `!paneOwned`
(`ChatApp.tsx:936`). Canon (L184112): dialogs bind the 800 ms exit latch on their own scope;
second press exits. Build: drop `"ctrl+c": null` from the six overlay suppression sets (Select,
Settings, Help, MessageSelector, EffortDialog, SessionPicker — Transcript and HistorySearch
*rebind* and stay), and let an armed exit print its hint over pane-owning surfaces. Amend the
`keys-bindings.test.ts` pins that assert the nulls.

**(d) SDK warning in the frame.** ccx always passes `canUseTool` (host.ts:389 → every engine) and
the SDK answers `canUseTool`+bypass with `process.emitWarning` → our own stderr over the Ink
frame. Dropping `canUseTool` in bypass is NOT safe — permission mode is runtime-mutable and
`canUseTool` is construction-only; a bypass launch would be permanently brokerless after a mode
step-down. Build: take over Node's `warning` channel at the CLI entry before Ink mounts —
`CLAUDE_SDK_*`-coded warnings to the debug seam, everything else re-printed in ccx's stderr shape.

### EP-D3 · Effort is a transaction (s2qa4-05, s2qa4-06; folds s2qa4-10)

Canon (L440938/441052/441077, controller-verified): the picker seeds effort into local state,
←/→ writes only that state behind a dirty flag, Enter (or `s`) commits, Esc discards; the Haiku
row is replaced by "Effort not supported for Haiku" with inert arrows (L441142). ccx wires ←/→
straight to `session.setEffort` per keypress (ModelPicker.tsx:145-156 → useChat.applyEffort) and
its support gate treats absent `supportsEffort` as supported — and the live catalog **omits the
field for haiku** (probe 103), so the gate never fires.

Build: stage-commit-discard in ModelPicker (seed at open; ←/→ writes local state behind a dirty
flag; commit via the existing apply path, **guarded on the dirty flag**, on all THREE commit
paths — Enter/model-select, the `s` this-session chord if present, and the `ModelSwitchConfirm`
accept at `ModelPicker.tsx:174`; Esc/cancel discards). Flip the gate polarity (absent/false →
unsupported) driven from the **already-threaded live catalog** (`session.capabilities().models`,
`useChat.ts:1731/1741` — NOT a new `supportedModels()` call). The lock row itself already exists
and keys off the focused row (`EffortRow.tsx:32-38`, `ModelPicker.tsx:210-214`) — the change is
polarity only, at `ModelPicker.tsx:144` and `useChat.ts:387`. Fold: `/effort <level>` prints a
`⎿`-gutter confirmation (canon has one; s2qa4-10) instead of applying silently.

### EP-D4 · statusLine stdin contract (s2qa6-04, s2qa6-05, s2qa6-06; folds s2qa5-10)

Canon payload is 12 always + 9 conditional fields (L484846). ccx's gaps, per-field
(ground-code2 §4 table has the full thread-from map):

| field | build |
|---|---|
| `transcript_path`, `prompt_id` | latch from headless-firing hooks (`UserPromptSubmit`) into refs beside `statusCtxRef`; cleared at `replaceDocument`. Absent pre-first-turn (SessionStart is dormant headlessly) — accepted, documented. |
| `session_id` | mint-and-reconcile: client uuid at mount and at every `replaceDocument` boundary, overwritten by the engine id when `system/init` lands. Never null, boundary-fresh, eventually real (canon's id is client-minted; D-W4). **Named cost:** the id changes identity once per conversation (mint → engine), and pre-turn payloads carry an id but no `transcript_path` — a script keying on `session_id` sees the swap. A8 pins what a script observes across it. |
| `fast_mode` | literal `false` in upstream's slot (ccx exposes no fast-mode control; canon emits `false` too). |
| `rate_limits` | passthrough from `statusUsageRef` (already fetched), emitted only when `rate_limits_available !== false`; map SDK `utilization` → canon `used_percentage`. **Unverifiable live under this project's credentials** (`rate_limits_available` is false under both an API key and a setup-token OAuth token) — ships with a unit-level pin on the mapping instead of a live cell. |
| `context_window_size` | one `getContextUsage()` **at mount only** (probe 103: resolves pre-turn with real numbers) — kills the `0` first paint. **No boundary read** (D-W8): Wave S deliberately hides the number after `replaceDocument` until the next turn measures a real one (`useChat.ts:818-820`), and a boundary-time call can race the engine swap probe 103 never tested. The s2qa5-10 fold is withdrawn — it returns to the backlog. |

**Failure semantics — canon overrules Wave C:** 2.1.220 removes the row when the command fails
(L484981); ccx's keep-last-good was a decision made off sweep-1 testimony. Reverse it: widen
`onText` to `(t: string | undefined)`, pass failures through (`statusLine.ts:258`), Footer already
drops the row on `undefined`.

**No-change verdicts (recorded, not built):** styling stays SGR 2 dim — ccx already matches canon
(L484986; the sweep compared 2.1.226's grey). Refresh triggers stay turn-boundary-only — canon has
no Ctrl-C/resize trigger (L484930); s2qa6-22 is 2.1.226 drift, parked. ccx's `refreshInterval` IS
implemented (`statusLine.ts:273-274`) — the grounding's contrary claim is wrong; nobody "fixes" it.

**One trigger gap IS built** (spec-review finding 5, from the grounding's own Q4): ccx fires the
command twice at startup and again at turn start where canon runs once per moment — dedupe so a
boot produces one run and a turn one refresh; A8 asserts the run count.

### EP-D5 · Repaint round two (s2qa2-07, s2qa2-05)

**(a) Resize burst.** No debounce anywhere on the resize path; the only correction is per-write,
narrowing-only, and its async repair deliberately bails when the size moved again
(`resizeRepaint.ts:191`) — in a burst that guard is always true, so residue is permanent. Build:
trailing debounce (~80 ms) at the signal so `old→new` spans the settled pair, plus one bounded
post-settle repair pass that is a **new, direction-independent function measured off the live
frame at settle time** — NOT `correctionAfterRepaint` with a fresh sample (spec-review finding 4:
a round-trip burst like 120→90→150→120 nets `old === new`, so every narrowing-gated path
early-returns while the intermediate shrinks' residue is real). Erase stays viewport-bounded — the
over-erase safety argument stands.

**(b) Stale picker header on grow.** At 60×15 Ink takes its tall-frame branch (bypasses
log-update); the only resync is gated on the pager closing (`ChatApp.tsx:482-488` — a named
residual), and `tallWrites` stands down before the user grows. Build: on the grow edge while a
tall write is outstanding, issue viewport-only `eraseViewport(rows)` + forced repaint through
`clearViewport.ts:40-56` — scrollback-safe by construction, keeps log-update honest, stays an
edge not a level. **No reflow-verdict precondition** (spec-review finding 3: the verdict is only
ever set on a narrowing, so a grow-only session would never qualify; `eraseViewport` doesn't need
the verdict's erase-depth bound because viewport-only cannot over-erase).

**Parked out of this wave:** s2qa2-06 (history reflow on width change). Every honest fix inside
the Ink `<Static>` renderer either duplicates the transcript into scrollback per reflow or
requires the `ESC[3J` wipe Wave R explicitly rejected; the shape that dissolves it is the
alternate-screen renderer — **FULLSCREEN-1**, which 2.1.226's alt-screen-at-24-rows default has
just made more urgent. Owner question, not a wave task (D-W5).

### EP-D6 · Resume preview is a transcript, not an excerpt (s2qa4-13 + s2qa4-14)

The preview prints raw persisted row text, bypassing the species router (`sessionPickerModel.ts:
172-193`) — hence the leaked `<command-name>`/`<local-command-stdout>` envelopes. Canon (L476605)
**replaces the picker with a full-screen rendered transcript** under its own footer. The picker
already fetches the full message array; `replayDocument(msgs, {id, width})` +
`projectCompact(document, ctx)` are the exact primitives the replay path uses. Build: render the
projection's tail into the existing pane under the `PREVIEW_ROWS` budget with a `↓` remainder
affordance. **Documented divergence (D-W9):** in-pane tail instead of canon's full-screen
takeover — this closes s2qa4-13 fully and s2qa4-14 partially; the takeover is a separate UI unit
left in the backlog. The count-vs-rows invariant (`isPreviewMessage` as the single predicate)
must survive, and A10 asserts it.

---

## Out of scope (dispositioned)

- s2qa2-06 history reflow and s2qa2-08 bottom-anchoring → FULLSCREEN-1 (owner question).
- s2qa6-22 refresh triggers, s2qa6-23 styling → 2.1.226 drift / already-matching (no change).
- `ultracode` effort level → exists in 220 behind the Workflows gate (L441199/76284 — sweep's
  "2.1.226 addition" label corrected); ccx has no Workflows surface; parked.
- The P3/P4 tail of the triage stays in the backlog except the named fold (s2qa4-10). Newly
  backlogged at spec review: s2qa5-10 (D-W8), `/copy N`, the full-screen preview takeover (D-W9).

## Acceptance

Suites green (`npm run typecheck`, `npm run test:unit`, `npm run test:tui`, `npm run build`), plus
each shipped finding's **sweep repro re-run** in the isolated-HOME tmux harness
(`docs/parity/qa-driver.md`; ready-needle `⏸ manual mode on`):

- A1 `/copy` after two live replies copies the newest reply (fresh session, keyed).
- A2 resumed session: `/copy` advances with new replies; after `/clear`, `/copy` reports the
  empty state (canon copy) and no cleared text reaches the clipboard.
- A3 permission dialog: Tab-amend, type text, Enter → deny-with-feedback reaches the model;
  Tab-amend, Enter empty → row stays open with a nudge, footer shows `enter send · esc cancel`.
- A4 plan dialog: option 3 with text → deny carrying the feedback; option 3 empty Enter → bare
  deny and the turn ENDS — no model follow-up paragraph, no `Continue planning` text anywhere.
- A5 `/model` open → Ctrl-C Ctrl-C exits ccx with status 0; hint visible over the dialog.
- A6 bypass consent accept → no `CLAUDE_SDK_*` text anywhere in the frame.
- A7 `/model` effort row: ←/→ then Esc → effort unchanged (`/status`); ←/→ then Enter → applied.
  Cursor on Haiku → lock row, arrows inert. `/effort high` prints a `⎿` confirmation.
- A8 statusLine probe script dumping its stdin JSON: first paint has non-zero
  `context_window_size`, a non-null `session_id`, and `fast_mode: false`; after a turn,
  `transcript_path` and `prompt_id` present and `session_id` now equals the engine id (the
  mint→engine swap is pinned as-observed); boot produces exactly ONE run and a turn exactly one
  refresh; failing command (`exit 1`) takes the row down.
- A9 resize burst (three rapid `resize-window` calls): settled frame has exactly one composer
  block, zero stale rules. Picker at 60×15 → grow to 120×40: `Select model` appears exactly once.
- A10 `/resume` preview renders transcript rows — no raw `<command-name>`/`<local-command-stdout>`
  anywhere in the pane — and the message count still agrees with `isPreviewMessage` (the
  count-vs-rows invariant).

Keyless cells run under pty isolation; keyed cells (A1/A2/A7 apply-path, A8 turn fields) over the
OAuth token per `CC-to-SDK/.env` rules. **Clipboard hazard (triage §5.3):** A1/A2 write the
operator's real system clipboard, which `HOME` isolation cannot scope — the runner saves and
restores the clipboard around those cells (`pbpaste` before, `pbcopy` after).

## Decision Log

- **D-W1 [DECIDED-AUTO]** Guard fix is falsiness, not `!== null`, matching every other nested-frame
  reader in the tree; fixtures pinned to the wire shape. *Rejected:* schema-validating the frame
  (heavier, protects nothing extra).
- **D-W2 [DECIDED, narrowed at spec review]** Empty-Enter nudge applies to **consult amend rows
  only** (permission dialogs), where an empty submit would be a silent deny-without-message (Wave
  T t3's rule). The plan dialog keeps canon's empty→bare-deny — there the empty Enter IS the
  ordinary "keep planning" verb, and removing it would leave Esc-Esc as the only rejection path.
  *Rejected:* the v1 uniform-nudge rule (spec-review finding 6: it deleted canon's only bare-deny
  verb on the plan dialog).
- **D-W3 [DECIDED-AUTO]** Suppress SDK warnings at the process warning channel, not by dropping
  `canUseTool` — the option-level fix leaves bypass launches permanently brokerless after a
  runtime mode step-down (host.ts:619 is reachable from the ladder). *Rejected:* option-level fix
  + engine reopen on step-down (much larger change).
- **D-W4 [DECIDED-AUTO]** `session_id` = mint-and-reconcile (client uuid at mount/boundary,
  engine id when it lands). Canon's id is client-minted; reporting stale ids violates Wave S;
  reporting null violates canon. *Rejected:* always-engine-id (null at exactly the moments the
  sweep flagged); always-minted (lies once the engine id exists).
- **D-W5 [DECIDED / OWNER-OPEN]** History reflow (s2qa2-06) parks into FULLSCREEN-1. Inside the
  current renderer the only shapes are duplicate-scrollback-per-reflow or the `ESC[3J` wipe Wave R
  rejected; both costs exceed the defect. The alt-screen renderer dissolves it — and 2.1.226 now
  defaults to it at ≤24 rows. **Owner input wanted on whether FULLSCREEN-1 gets scheduled.**
- **D-W6 [DECIDED-AUTO]** statusLine failure semantics flip to canon (row removed). Wave C's
  keep-last-good was decided off sweep-1 testimony; the bundle settles it (L484981). The reserved
  blank pre-first-run row stays out (separate recorded divergence, unchanged).
- **D-W7 [DECIDED-AUTO]** Preview fix is the transcript-tail render, not the cheap tag strip —
  the strip would be deleted by the real fix and the primitives already exist.
- **D-W8 [DECIDED, spec review]** No `getContextUsage()` at the `replaceDocument` boundary — only
  at mount. The boundary read would silently reverse Wave S's hidden-until-measured rule
  (`useChat.ts:818-820`) and can race the engine swap, which probe 103 never tested. s2qa5-10
  returns to the backlog. *Rejected:* boundary read sequenced after `system/init` (deferrable
  complexity; turn-end already restores the row).
- **D-W9 [DECIDED, spec review]** Resume preview renders in-pane (tail, `PREVIEW_ROWS`, `↓`
  affordance) rather than canon's full-screen picker takeover with its own footer — the takeover
  is a separate UI unit, backlog. Closes s2qa4-13 fully, s2qa4-14 partially; recorded in
  `tui-ux.md` at re-score.
- **D-W10 [DECIDED, Task 3 review + bundle]** The exit arm's first press bumps the clear-draft
  token ONLY when the composer is the active surface. The Task 3 fall-through exposed that a
  Ctrl-C over an overlay silently cleared the parked draft (deferred to remount); canon's latch
  (`Pee` L183445 / `h5u` L183477) passes no first-press callback — over any dialog the first
  press arms and does nothing else, and draft clearing belongs to the focused composer's own
  gesture. Applies uniformly, including the parked decision dialogs that had always fired the
  bump (same divergence, older). *Rejected:* keep-the-bump (ccx-only behavior a user can't see
  happen and never chose).

## Surprises & Discoveries *(living)*

- The `parent_tool_use_id === undefined` guard class: fixtures omit the field, so strict-undefined
  guards pass the suite and die on the wire (which sends `null`). Two call sites; fixture sweep
  added. The sweep's "regressed" label for s2qa5-21 was probably mis-attributed — sweep 1's cell
  likely ran resumed (the guard landed 2026-08-03, before sweep 1).
- Three of the wave's defects are deliberate rules missing their affordance, not broken code
  (empty-submit swallow, overlay ctrl+c unbind, keep-last-good statusLine). The fix is as much
  footer/hint work as logic work.
- Probe 103: pre-turn `getContextUsage()` works; haiku's catalog entry omits `supportsEffort`
  entirely — the absent-means-supported polarity was the exact gate defect.
- The controller re-verified the effort-staging bundle citation before speccing; the second
  grounding agent had called ccx's live-apply "a sourced 2.1.220 decision" — the source was wrong,
  the same mis-citation class as Wave C's token-warning ceiling.
- Task 1 fix: the SDK session store STRIPS `isApiErrorMessage`/`error`/`apiErrorStatus` from
  persisted rows — a flag filter on the resume path would have been dead code. The surviving
  discriminator is `message.model === "<synthetic>"`, which is the CLI's own "not a real reply"
  predicate (all four mint sites verified in 2.1.227). Declared ≠ persisted.
- Task 3 exposed a second-order defect its own fix created reach for: the fall-through made the
  global arm's first-press draft-clear fire over overlays. The bundle settled it (D-W10) — the
  reviewer's "should be an explicit choice" instinct was exactly right.

## Outcomes & Retrospective

Pending — written at finish.

## Revision Notes

- v1 (2026-08-11): authored post-grounding; probe 103 run first (live-probe-first).
- v2 (2026-08-11, spec review — 12 findings, all adopted): EP-D2(b) rewritten — the inline plan
  row already ships; the defect is gate.ts's fabricated `Continue planning.` string (Critical 1;
  the sweep's "rejects immediately" observation was the model obeying the invented instruction).
  D-W2 narrowed to consult rows (finding 6). Boundary context read dropped, D-W8 (Critical 2).
  Grow-edge resync loses its verdict precondition (finding 3); post-settle repair declared
  direction-independent (finding 4). Startup double-fire dedupe added; refreshInterval
  already-implemented noted (finding 5). D-W4 identity-swap cost named + A8 pin (finding 7).
  D-W9 in-pane preview divergence recorded (finding 8). Canon /copy empty-string + /copy N
  disposition (finding 9). EP-D3 corrected to capabilities().models / polarity-only / three
  commit paths (finding 10). rate_limits unit-pin note (finding 11). Clipboard save/restore in
  acceptance (finding 12).
