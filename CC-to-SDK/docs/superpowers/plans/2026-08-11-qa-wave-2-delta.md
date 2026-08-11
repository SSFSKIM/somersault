# QA Wave 2 (sweep-2 delta) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use doperpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close sweep #2's open worklist W1–W6 as specced in
`docs/superpowers/specs/2026-08-11-qa-wave-2-delta-design.md` (the spec is normative; this plan
sequences it).

**Architecture:** Nine sequential tasks over `harness/` — no parallel dispatch (Tasks 1, 5, 6
all touch `useChat.ts`; 2, 3 touch the keys/dialog layer). Each task is red-first: pin the
current defective behavior or add the failing test, then fix.

**Tech Stack:** TypeScript, Ink, `@anthropic-ai/claude-agent-sdk`, vitest.

## Global Constraints

1. Work from `CC-to-SDK/harness/`. Gates per task: `npm run typecheck` + `npm run test:unit` +
   `npm run test:tui` (scoped `npx vitest run <file>` while iterating). NEVER `npm test`.
2. Commit completed work to `main`; **no Co-Authored-By or any attribution**; never push.
3. The 2.1.220 bundle (`/Users/new/claude-code-bundle/2.1.220/cli.pretty.js`) is canon. Cited
   line numbers in the spec/grounding are normative; if your reading of the bundle contradicts a
   citation, STOP and report (do not silently pick one).
4. Grounding docs (read the section for your task before coding):
   `/Users/new/.claude/jobs/4b30d1a4/tmp/wave2-ground-code.md` (Tasks 1–4, 8),
   `wave2-ground-code2.md` (Tasks 5–7), `wave2-ground-bundle.md` (canon verdicts, all tasks).
5. Never print/log/commit `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN`. No live sessions in
   unit/tui suites.
6. Snippet honesty: code blocks below are the intended shape, not verbatim gospel — match the
   file's local idiom; comments only for constraints the code can't show.
7. Do not edit `.doperpowers/sdd/progress.md` (controller-owned).

---

### Task 1: `/copy` truth (EP-D1; s2qa5-21, s2qa5-22)

**Files:**
- Modify: `harness/src/tui/useChat.ts` (:771, :1082-1085, replaceDocument block ~:827-895)
- Test: `harness/test/tui/useChat.test.tsx`, `harness/test/fixtures/f1-tool-transcript.ts`

**Interfaces:** none new. Consumes existing `lastAssistant` ref + `replaceDocument()`.

- [ ] **Step 1 — red:** in `useChat.test.tsx`, change the three `/copy` fixtures (lines ~1301-1345)
  to carry `parent_tool_use_id: null` (the wire shape). The "reaches /copy" case must now FAIL
  (guard at :1082 is `=== undefined`). Add a new failing case: live reply → `/clear` → `/copy`
  → expect "nothing to copy" (pins the boundary reset).
- [ ] **Step 2:** run `npx vitest run test/tui/useChat.test.tsx` — expect the two failures.
- [ ] **Step 3 — fix:** `useChat.ts:1082` guard becomes `!data.parent_tool_use_id`; same change to
  the `syncLiveOpen` twin at `:771`. Add `lastAssistant.current = "";` inside `replaceDocument()`
  beside the `setCtxPct(undefined)` reset (comment class: measured against a conversation that is
  gone). Do NOT touch the seeding sites (:1672, :2128) — they assign after the swap by design.
- [ ] **Step 4:** fixture sweep: add `parent_tool_use_id: null` to assistant/tool frames in
  `f1-tool-transcript.ts` and any other fixture feeding `appendSdk` paths (grep
  `type: "assistant"` under `harness/test/`). Suite must stay green — failures here mean another
  strict-undefined guard exists; find and fix it the same way.
- [ ] **Step 5:** the empty-state string at `useChat.ts:1482` becomes canon's
  `No assistant message to copy` (was `nothing to copy`); update the tests that quote it.
- [ ] **Step 6:** verify the rewind seed still passes (`useChat-rewind.test.tsx:135`), full gates,
  commit `f5(wave2-t1): /copy reads the wire, not the fixtures`.

### Task 2: Empty-submit seam + plan feedback row (EP-D2a+b; s2qa3-10, s2qa3-12)

**Files:**
- Modify: `harness/src/tui/select/Select.tsx` (:218-221 submitInput), `harness/src/tui/dialogs/optionRows.ts`,
  `harness/src/tui/dialogs/{GenericPermission,FilePermission,BashPermission,SkillPermission,MonitorPermission}.tsx`
  (onCancel wiring ~:79), `harness/src/permissions/gate.ts` (:33, :68), `harness/src/tui/dialogs/ConsultFooter.tsx` (:19)
- Test: `harness/test/tui/keys-migration-dialogs.test.tsx` + the permission-dialog suites + a gate unit test

**Interfaces:**
- Produces: `SelectProps.onEmptySubmit?: (row) => void` — called when Enter lands on an input row
  whose text is empty and `allowEmptySubmitToCancel` is false; fallback when absent: `onCancel()`
  (current behavior, so non-dialog Selects are untouched).

- [ ] **Step 1 — red:** test: amended deny row + empty Enter → the row STAYS in input mode and a
  nudge line renders; footer while inputMode reads `enter send · esc cancel`. Both fail today
  (first Enter collapses via onCancel; footer shows `esc cancel` only).
- [ ] **Step 2:** add `onEmptySubmit` to Select's `submitInput` branch (empty && !allowEmpty →
  `o.onEmptySubmit ? o.onEmptySubmit(row) : o.onCancel()`). Wire the five consult bodies: keep the
  row open, set a one-line nudge (reuse the dialogs' existing notice/hint slot; copy:
  `type a message, or esc to cancel`). ConsultFooter: while `inputMode`, print
  `enter send · esc cancel`.
- [ ] **Step 3 — the fabricated plan-reject string (spec v2, EP-D2b):** the PlanDialog inline row
  ALREADY ships canon's shape (`PlanDialog.tsx:144`, `:285-302`) — do NOT touch it, and the plan
  dialog's empty-Enter→bare-deny stays (D-W2 does not apply there). The defect is
  `harness/src/permissions/gate.ts:33` and `:68`: both arms substitute the invented sentence
  `User rejected the plan. Continue planning.`, which the model obeys by continuing. Red-first:
  unit test on the gate — a `plan_reject` with no feedback must NOT produce that sentence.
  Fix: bare plan reject sends canon's shape (no feedback text). If the SDK deny type requires
  `message`, use `User rejected the plan.` — descriptive, never imperative. Check the `:33`
  bare-`{kind:"deny"}` arm too (system teardown path).
- [ ] **Step 4:** confirm via the existing plan-dialog suites that option 3 with typed text still
  produces the deny carrying feedback (unchanged path), and nothing renders `Continue planning`.
- [ ] **Step 5:** gates; commit `f5(wave2-t2): empty Enter nudges; the gate stops putting words in
  the user's mouth`.

### Task 3: Ctrl-C reaches the exit arm over dialogs (EP-D2c; s2qa4-11)

**Files:**
- Modify: `harness/src/tui/keys/bindings.ts` (Select :189, Help :69, MessageSelector :120,
  EffortDialog :146, SessionPicker :177, Settings :270), `harness/src/tui/ChatApp.tsx` (:936 exitArm gate)
- Test: `harness/test/tui/keys-bindings.test.ts` (:107 GRANDFATHERED, :113, :200-213),
  `harness/test/tui/keys-migration-dialogs.test.tsx`

- [ ] **Step 1 — red:** test: with the `/model` picker open, two `app:interrupt` dispatches within
  the arm window exit (assert `onExit` called / exit path invoked). Fails today (ctrl+c unbound in
  Select context = consumed).
- [ ] **Step 2:** remove ONLY the `"ctrl+c": null` entries from the six overlay contexts. Leave
  every other null. Leave Transcript/HistorySearch (they rebind). Update the pinned expectations
  in `keys-bindings.test.ts` (the EffortDialog must-be-null loop :200-207 loses `ctrl+c`).
- [ ] **Step 3:** hint visibility: at `ChatApp.tsx:936` let the `exitArm` term render despite
  `paneOwned` (drop `!paneOwned` for exitArm only). Test: armed exit hint renders while
  modelPicker.open.
- [ ] **Step 4:** confirm decision-dialog behavior unchanged (`keys-migration-dialogs.test.tsx:377`
  still green). Gates; commit `f5(wave2-t3): ctrl+c falls through overlays to the exit arm`.

### Task 4: SDK warnings leave the frame (EP-D2d; s2qa3-11)

**Files:**
- Modify: `harness/src/cli/bin.ts` (before Ink mounts; if the REPL path bypasses bin.ts, the seam
  goes at the top of `harness/src/cli/main.ts`)
- Test: `harness/test/unit/` new file `warning-channel.test.ts`

- [ ] **Step 1 — red:** unit test: install the takeover, `process.emitWarning("x", {code:
  "CLAUDE_SDK_CAN_USE_TOOL_SHADOWED"})` → nothing on stderr, entry lands in the debug sink;
  `process.emitWarning("y", {code:"OTHER"})` → re-printed once in ccx shape (`ccx: warning: …`).
- [ ] **Step 2:** implement: `process.removeAllListeners("warning")` + one listener; `CLAUDE_SDK_`
  prefix → debug seam (use the existing debug log hook if wired; otherwise drop), else re-print to
  stderr. Extract as a small exported function so the test needs no subprocess.
- [ ] **Step 3:** gates; commit `f5(wave2-t4): SDK process warnings routed off the frame`.

### Task 5: Effort transaction (EP-D3; s2qa4-05/06, fold s2qa4-10)

**Files:**
- Modify: `harness/src/tui/ModelPicker.tsx` (:145-162), `harness/src/tui/EffortRow.tsx`,
  `harness/src/tui/ChatApp.tsx` (:830 onEffortChange wiring), `harness/src/tui/useChat.ts`
  (applyEffort :1812-1822 — unchanged mechanics, new call timing), `harness/src/tui/commands.ts`
  (/effort level confirmation)
- Test: `harness/test/tui/model-picker.test.tsx`, `harness/test/tui/effort.test.tsx`

**Interfaces:**
- ModelPicker holds `pendingEffort` local state seeded from current effort at open; commits via
  the existing `onEffortChange(pendingEffort)` ONLY on Enter/model-select (the picker's existing
  confirm path) when dirty; Esc/cancel discards.

- [ ] **Step 1 — red:** tests: (a) open picker, two `→` steps, Esc → `applyEffort` NEVER called,
  session effort unchanged; (b) two `→` then Enter → called once with the final level; (c) cursor
  on haiku → effort row renders `Effort not supported for Haiku`, `←/→` no-ops. All three fail
  today (live-apply per keypress; gate polarity).
- [ ] **Step 2:** stage-commit-discard per the interface above (canon: L440938 seed, L441052 local
  step + dirty flag, L441077 commit **guarded on the dirty flag**, cancel no-op). Wire ALL THREE
  commit paths: Enter/model-select, the `s` this-session chord if present, and the
  `ModelSwitchConfirm` accept (`ModelPicker.tsx:174`).
- [ ] **Step 3:** gate polarity: support = `model.supportsEffort === true` (absent/false →
  unsupported), driven from `session.capabilities().models` — the catalog ALREADY threaded to the
  picker (`useChat.ts:1731/1741`); do NOT add a `supportedModels()` call. The lock row already
  exists and keys off the focused row (`EffortRow.tsx:32-38`, `ModelPicker.tsx:210-214`, pinned by
  `model-picker.test.tsx:459-467`) — the change is polarity only (`ModelPicker.tsx:144`,
  `useChat.ts:387`). Probe 103: haiku's catalog entry omits the field.
- [ ] **Step 4 — fold:** `/effort <level>` prints a `⎿`-gutter confirmation row (match the
  transcript's existing result-gutter idiom; include level). Red-first: today it applies silently.
- [ ] **Step 5:** gates; commit `f5(wave2-t5): effort stages, commits on Enter, locks on haiku`.

### Task 6: statusLine contract (EP-D4; s2qa6-04/05/06, fold s2qa5-10)

**Files:**
- Modify: `harness/src/tui/statusLine.ts` (payload :430-463, onText :258, types :328-334),
  `harness/src/tui/useChat.ts` (snapshot :658-681, mount effect :632-714, replaceDocument,
  hook registration), `harness/src/tui/Footer.tsx` (:138 — verify only), `harness/src/hooks/builders.ts`
  (reuse), `harness/src/config/resolveOptions.ts` (hook wiring if needed)
- Test: `harness/test/unit/statusline.test.ts`, `harness/test/tui/useChat.test.tsx`

- [ ] **Step 1 — red (negative pins first):** assert today's payload has NO `transcript_path`,
  `prompt_id`, `fast_mode`, `rate_limits`; `context_window.context_window_size === 0` with null
  percentages when snapshot has no context; `onText` never called with `undefined` on failure.
  These pins flip one by one as steps land — each field arrival is a visible diff.
- [ ] **Step 2 — hook latch:** passive `UserPromptSubmit` hook latches `transcript_path` +
  `prompt_id` into refs beside `statusCtxRef` (useChat :648-649); cleared in `replaceDocument`;
  spread into the payload conditionally (absent pre-first-turn is accepted).
- [ ] **Step 3 — fast_mode:** literal `false` in upstream's slot (between `exceeds_200k_tokens`
  and `effort`; the slot comment at statusLine.ts:454-457 names it).
- [ ] **Step 4 — rate_limits:** widen `StatusLineUsage` to carry the windows; emit only when
  `rate_limits_available !== false`; map SDK `utilization` → payload `used_percentage` (canon
  shape). This path is live-unreachable under the project's credentials (available=false for API
  key AND setup-token OAuth) — the unit pin on the mapping IS the verification; no live cell.
- [ ] **Step 5 — context at MOUNT ONLY (D-W8):** call `refreshCtx()` (the existing
  `getContextUsage` wrapper, useChat :1219-1229) once in the statusLine mount effect — probe 103
  proves pre-turn resolution. Do NOT add a boundary read: Wave S hides the number after
  `replaceDocument` until the next turn measures a real one (`useChat.ts:818-820` is the recorded
  decision), and a boundary call can race the engine swap. s2qa5-10 stays in the backlog.
- [ ] **Step 5b — startup/turn-start dedupe:** ccx currently runs the command twice at startup
  and again at turn start (mount run + state-delta effect overlap). Dedupe so a boot produces
  exactly one run and a turn one refresh; pin with a fake-runner call counter.
- [ ] **Step 6 — session_id mint-and-reconcile (D-W4):** `statusSessionIdRef` = client uuid at
  mount and at each `replaceDocument`; overwritten when the adapter's engine id lands (mirror of
  chatAdapter :48/:98/:130). Payload always emits it. Unit-pins: boundary mints a NEW id (not the
  old engine id, not null); the mint→engine overwrite is a NAMED identity swap — pin the observed
  sequence (pre-turn payload: minted id, no transcript_path; post-turn: engine id + path).
- [ ] **Step 7 — failure semantics (D-W6):** `onText: (t: string | undefined)`; statusLine.ts:258
  passes failures through; Footer :138 already drops the row. Flip the Step-1 pin.
- [ ] **Step 8:** gates; commit `f5(wave2-t6): statusLine speaks canon's contract`.

### Task 7: Repaint round two (EP-D5; s2qa2-07, s2qa2-05)

**Files:**
- Modify: `harness/src/tui/resizeRepaint.ts` (:99, :118, :166-194), `harness/src/tui/chatMain.tsx`
  (:407 subscription), `harness/src/tui/ChatApp.tsx` (:482-488 recovery effect, :218-221)
- Test: `harness/test/unit/resize-repaint.test.ts`, `harness/test/tui/resize-state.test.tsx`

- [ ] **Step 1 — red (burst):** driver-level test with fake `size()` mutating mid-probe: today
  `correctionAfterRepaint` emits nothing (the :191 bail). Pin it, then assert the post-settle
  repair emits exactly one correction after the debounce window with the settled size.
- [ ] **Step 2:** trailing debounce (~80 ms, injectable timer per the module's existing seam
  style) on the resize signal so old→new spans the settled pair; add ONE bounded post-settle
  repair pass as a NEW, direction-independent function measured against the live frame at settle
  time — NOT `correctionAfterRepaint` with a fresh sample (a round-trip burst nets old === new,
  and every narrowing-gated path early-returns while the intermediate shrinks' residue is real).
  Erase stays viewport-bounded (the :6-9 safety argument is unchanged). Cover the round-trip
  burst (120→90→150→120) in the driver test.
- [ ] **Step 3 — red (picker header):** ChatApp-level pin: stub `resumeOutput.tallWrites() → 1`,
  drive a grow, assert `resyncViewport` NOT called today; then flip to called-once under the fix.
- [ ] **Step 4:** add the grow edge: terminal grew while a tall write is outstanding →
  viewport-only `eraseViewport(rows)` + forced repaint via `clearViewport.ts:40-56`. NO
  reflow-verdict precondition (the verdict only ever exists after a narrowing; viewport-only
  erase cannot over-erase, so it doesn't need the verdict's depth bound). Keep it an edge, not a
  level (ChatApp :466-480 lesson); do NOT loosen the tallWrites stand-down (the t8 over-erase
  hazard, chatMain :134-149).
- [ ] **Step 5:** gates; commit `f5(wave2-t7): resize settles once; tall dialogs resync on grow`.

### Task 8: Resume preview renders the transcript (EP-D6; s2qa4-13+14)

**Files:**
- Modify: `harness/src/tui/sessionPickerModel.ts` (:141, :147-193), `harness/src/tui/SessionPicker.tsx` (:124-132, :219-240)
- Test: `harness/test/tui/session-picker.test.tsx`

- [ ] **Step 1 — red:** feed the preview a session containing a slash-command pair
  (`<command-name>` echo + `<local-command-stdout>` reply) and a tool turn; assert NO raw angle
  tags in the rendered pane, and that the pane shows projected transcript rows (species-routed),
  tail-anchored, ≤ PREVIEW_ROWS, with a `↓ N more` affordance when truncated. (D-W9: in-pane
  tail, a recorded divergence — canon replaces the picker full-screen; that takeover is backlog,
  do not attempt it here.)
- [ ] **Step 2:** replace `previewLines`/`rowText` with
  `projectCompact(replayDocument(msgs, {id, width}), ctx)` (the replay path's primitives —
  replay.ts:50-56, toolRenderer.tsx:1045); build a picker `ProjectionContext` (width from the
  pane, no expand hints). Preserve the count-vs-rows invariant (`isPreviewMessage` stays the
  single predicate for the count).
- [ ] **Step 3:** keep `session-picker.test.tsx:165-183`'s invariant green; update the :90 shape
  test deliberately (it pins the old excerpt).
- [ ] **Step 4:** gates; commit `f5(wave2-t8): resume preview is a transcript, not an excerpt`.

### Task 9: Final verification — the spec's acceptance as written

**Files:** none (evidence only).

- [ ] **Step 1:** full gates: typecheck, unit, tui, build. Record numbers.
- [ ] **Step 2:** run A1–A10 from the spec AS WRITTEN in the isolated-HOME tmux harness
  (`docs/parity/qa-driver.md`; ccx ready-needle `⏸ manual mode on`; `HOME` under literal `/tmp`;
  `CCX_FLEET_ROOT` at the isolated home; prefs-mtime assertion at start and end). Keyed cells
  (A1, A2, A7 apply-path, A8 turn fields) load the OAuth token via
  `set -a; . ../.env; set +a` and never print it. A8 uses a statusLine script that dumps its
  stdin JSON to a file in the scratch project. A1/A2 touch the operator's REAL clipboard: save it
  first (`pbpaste > save.txt`), restore after (`pbcopy < save.txt`).
- [ ] **Step 3:** evidence to `$CLAUDE_JOB_DIR/tmp/wave2-A*.txt`; each cell's verdict quoted with
  needle lines in the task report.
- [ ] **Step 4:** any cell that cannot run as written is a FINDING (spec drift or defect) — report
  it; do not reinterpret the cell.
