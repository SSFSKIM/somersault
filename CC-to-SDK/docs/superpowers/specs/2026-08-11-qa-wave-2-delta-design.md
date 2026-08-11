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
`/clear` empties it. Ship 1+2 together — either alone leaves half the family standing.

### EP-D2 · Dialog input integrity (s2qa3-10, s2qa3-12, s2qa4-11, s2qa3-11)

**(a) Amended deny row.** The first-Enter swallow is Wave T's deliberate empty-submit rule firing
through `Select.submitInput` → `onCancel` (Select.tsx:218-221), which collapses input mode. Keep
the rule; stop spending it on the wrong verb: add an `onEmptySubmit` seam to `Select` (fallback:
`onCancel`), have the five consult bodies leave the row open with a one-line nudge, and while
`inputMode` is on the footer advertises the real contract (`enter send · esc cancel`).

**(b) Plan option 3.** Canon (L500713): an inline input row inside the dialog; submitted text →
deny-with-feedback, empty → bare deny. ccx implements the inline row and the text path verbatim;
the empty-Enter path follows ccx's (a) rule — nudge, not silent deny. **Documented divergence**
(D-W2 below), same rationale as Wave T t3.

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

Build: stage-commit-discard in ModelPicker (seed at open, commit via the existing apply path on
Enter/model-select, discard on Esc/cancel); flip the gate polarity (absent/false → unsupported)
and drive it from `supportedModels()`'s `supportsEffort`/`supportedEffortLevels`; render the
canon lock row. Fold: `/effort <level>` prints a `⎿`-gutter confirmation (canon has one;
s2qa4-10) instead of applying silently.

### EP-D4 · statusLine stdin contract (s2qa6-04, s2qa6-05, s2qa6-06; folds s2qa5-10)

Canon payload is 12 always + 9 conditional fields (L484846). ccx's gaps, per-field
(ground-code2 §4 table has the full thread-from map):

| field | build |
|---|---|
| `transcript_path`, `prompt_id` | latch from headless-firing hooks (`UserPromptSubmit`) into refs beside `statusCtxRef`; cleared at `replaceDocument`. Absent pre-first-turn (SessionStart is dormant headlessly) — accepted, documented. |
| `session_id` | mint-and-reconcile: client uuid at mount and at every `replaceDocument` boundary, overwritten by the engine id when `system/init` lands. Never null, boundary-fresh, eventually real (canon's id is client-minted; D-W4). |
| `fast_mode` | literal `false` in upstream's slot (ccx exposes no fast-mode control; canon emits `false` too). |
| `rate_limits` | passthrough from `statusUsageRef` (already fetched), emitted only when `rate_limits_available !== false`; map SDK `utilization` → canon `used_percentage`. |
| `context_window_size` | one `getContextUsage()` at mount and at the boundary (probe 103: resolves pre-turn with real numbers) — kills the `0` first paint AND gives `/status` its context row after a boundary (s2qa5-10 fold). |

**Failure semantics — canon overrules Wave C:** 2.1.220 removes the row when the command fails
(L484981); ccx's keep-last-good was a decision made off sweep-1 testimony. Reverse it: widen
`onText` to `(t: string | undefined)`, pass failures through (`statusLine.ts:258`), Footer already
drops the row on `undefined`.

**No-change verdicts (recorded, not built):** styling stays SGR 2 dim — ccx already matches canon
(L484986; the sweep compared 2.1.226's grey). Refresh triggers stay turn-boundary-only — canon has
no Ctrl-C/resize trigger (L484930); s2qa6-22 is 2.1.226 drift, parked.

### EP-D5 · Repaint round two (s2qa2-07, s2qa2-05)

**(a) Resize burst.** No debounce anywhere on the resize path; the only correction is per-write,
narrowing-only, and its async repair deliberately bails when the size moved again
(`resizeRepaint.ts:191`) — in a burst that guard is always true, so residue is permanent. Build:
trailing debounce (~80 ms) at the signal so `old→new` spans the settled pair, plus one bounded
post-settle repair pass measured against the frame true at that moment. No grow-direction erase,
no wider regions — the over-erase safety argument stands.

**(b) Stale picker header on grow.** At 60×15 Ink takes its tall-frame branch (bypasses
log-update); the only resync is gated on the pager closing (`ChatApp.tsx:482-488` — a named
residual), and `tallWrites` stands down before the user grows. Build the safer variant from
grounding: on a grow with a known `"reflow"` verdict, issue viewport-only `eraseViewport(rows)` +
forced repaint through `clearViewport.ts:40-56` — scrollback-safe by construction, keeps
log-update honest, stays an edge not a level.

**Parked out of this wave:** s2qa2-06 (history reflow on width change). Every honest fix inside
the Ink `<Static>` renderer either duplicates the transcript into scrollback per reflow or
requires the `ESC[3J` wipe Wave R explicitly rejected; the shape that dissolves it is the
alternate-screen renderer — **FULLSCREEN-1**, which 2.1.226's alt-screen-at-24-rows default has
just made more urgent. Owner question, not a wave task (D-W5).

### EP-D6 · Resume preview is a transcript, not an excerpt (s2qa4-13 + s2qa4-14)

The preview prints raw persisted row text, bypassing the species router (`sessionPickerModel.ts:
172-193`) — hence the leaked `<command-name>`/`<local-command-stdout>` envelopes. Canon (L476605)
renders the session as a real transcript, envelopes unwrapped. The picker already fetches the full
message array; `replayDocument(msgs, {id, width})` + `projectCompact(document, ctx)` are the exact
primitives the replay path uses. Build the right version: render the projection's tail into the
pane under the existing `PREVIEW_ROWS` budget with a `↓` remainder affordance. Doing 14 deletes 13;
the count-vs-rows invariant (`isPreviewMessage` as the single predicate) must survive.

---

## Out of scope (dispositioned)

- s2qa2-06 history reflow and s2qa2-08 bottom-anchoring → FULLSCREEN-1 (owner question).
- s2qa6-22 refresh triggers, s2qa6-23 styling → 2.1.226 drift / already-matching (no change).
- `ultracode` effort level → exists in 220 behind the Workflows gate (L441199/76284 — sweep's
  "2.1.226 addition" label corrected); ccx has no Workflows surface; parked.
- The P3/P4 tail of the triage stays in the backlog except the two named folds (s2qa4-10,
  s2qa5-10).

## Acceptance

Suites green (`npm run typecheck`, `npm run test:unit`, `npm run test:tui`, `npm run build`), plus
each shipped finding's **sweep repro re-run** in the isolated-HOME tmux harness
(`docs/parity/qa-driver.md`; ready-needle `⏸ manual mode on`):

- A1 `/copy` after two live replies copies the newest reply (fresh session, keyed).
- A2 resumed session: `/copy` advances with new replies; after `/clear`, `/copy` says nothing to
  copy (no cleared text on the clipboard).
- A3 permission dialog: Tab-amend, type text, Enter → deny-with-feedback reaches the model;
  Tab-amend, Enter empty → row stays open with a nudge, footer shows `enter send · esc cancel`.
- A4 plan dialog option 3 with text → deny+feedback; canon furniture intact.
- A5 `/model` open → Ctrl-C Ctrl-C exits ccx with status 0; hint visible over the dialog.
- A6 bypass consent accept → no `CLAUDE_SDK_*` text anywhere in the frame.
- A7 `/model` effort row: ←/→ then Esc → effort unchanged (`/status`); ←/→ then Enter → applied.
  Cursor on Haiku → lock row, arrows inert. `/effort high` prints a `⎿` confirmation.
- A8 statusLine probe script dumping its stdin JSON: first paint has non-zero
  `context_window_size` and a non-null `session_id`; after a turn, `transcript_path` and
  `prompt_id` present; failing command (`exit 1`) takes the row down.
- A9 resize burst (three rapid `resize-window` calls): settled frame has exactly one composer
  block, zero stale rules. Picker at 60×15 → grow to 120×40: `Select model` appears exactly once.
- A10 `/resume` preview renders transcript rows — no raw `<command-name>`/`<local-command-stdout>`
  anywhere in the pane.

Keyless cells run under pty isolation; keyed cells (A1/A2/A7 apply-path, A8 turn fields) over the
OAuth token per `CC-to-SDK/.env` rules.

## Decision Log

- **D-W1 [DECIDED-AUTO]** Guard fix is falsiness, not `!== null`, matching every other nested-frame
  reader in the tree; fixtures pinned to the wire shape. *Rejected:* schema-validating the frame
  (heavier, protects nothing extra).
- **D-W2 [DECIDED]** Empty-Enter on a feedback/amend row nudges and stays open — uniformly, incl.
  plan option 3 — diverging from canon's empty→bare-deny. Rationale: Wave T t3's rule (no silent
  deny with no message) is a deliberate safety divergence already shipped; splitting behavior by
  dialog would be worse than either uniform rule. *Rejected:* full canon match (reintroduces the
  silent empty deny t3 outlawed).
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
- **D-W7 [DECIDED-AUTO]** Preview fix is the full transcript-tail render (14), not the cheap tag
  strip (13) — the strip would be deleted by the real fix and the primitives already exist.

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

## Outcomes & Retrospective

Pending — written at finish.

## Revision Notes

- v1 (2026-08-11): authored post-grounding; probe 103 run first (live-probe-first).
