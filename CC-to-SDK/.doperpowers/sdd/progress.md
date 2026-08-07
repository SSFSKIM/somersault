Task 9: complete (suites: typecheck clean, 1202 unit, 422 tui; driver gained RAW:/RAWQ: prefixes (01ed5fbc7a + follow-up) — plan-review I3 fix, RAWQ added mid-acceptance because ink parses one keypress per pty chunk so chord bytes need separate sub-2s writes; pty acceptance runs w2-a + w2-b: panel row "❯ ⟳ b1tmha74 · local_bash · for i in $(seq 1 90)…" + Enter-tail tick14-25 LIVE MID-RUN (acceptance #2 all four properties), pager 10–17→9–16→1–8 of 17 + q close (acceptance #5a), history search everywhere-scope load→tick filter→Esc-accept→prompt IN COMPOSER frame 2069 (#5b; empty-then-filled frame pair = the designed one-render prefill effect), killAgents ALL THREE branches live (no-tasks notice run A; arm→◼ stopping 1→◼ task stopped→status chip cleared run B). ZERO defects found by the pty run — first wave with a clean acceptance.)
- Wave T Task 8: complete (commits f0cbc87cc6 + 56f87763f5 + d4fd91fd96, review PASS/APPROVED, sabotage-verified ×4).
  MID-TASK RETRACTION W-T22: item (a) reverted. The implementer read the bundle and found our "broken promise"
  WebFetch No-row label is upstream VERBATIM (L506771); controller check found the idiom repeats at L544640,
  near-twins at L503212, and appears as the `placeholder` on every input-form decline row (L504874/505650/506294).
  Shipping a rewrite would have had this wave pinning one upstream-verbatim row as canon (item (c)/W-T16) while
  unilaterally rewriting another. Now: one copy fix (the separator) + TWO canon pins. Spec commit 12fadc5399.
  Divergence accepted knowingly: separator gated on `withLabel`, not `showLabelWithValue` — the amended No row
  renders through the `withLabel` branch (all six permission bodies pass `inlineDescriptions`), so the flag alone
  would have missed the only row A16 covers.
- Wave T Task 9: complete (commit c781a57d5d, review PASS/APPROVED). SANCTIONED DEVIATION from the brief's
  prescribed location, verified by me before acceptance: the third sentinel is a cancelled `tool_result` content
  string (`CLo` L298302), NOT an `ERe` exit-9 case (L426473 tests only the other two), and `render.ts:236` skips
  every non-`text` block before `classifyUserText` — so the brief's `startsWith` at `species.ts:160` would never
  have fired on a real frame AND would have false-positived on any user prompt quoting the sentence. Constant
  landed in species.ts as instructed; classification landed in `toolResult.ts` `normalizeToolResult`, routing
  through the existing `interrupted` status to the identical dim row.
- DURABLE FACT (task 9 reviewer): `node_modules/@anthropic-ai/claude-agent-sdk/manifest.json` declares
  version 2.1.220, commit 4073f595 — the CLI the SDK spawns is THE SAME BUILD as our canon bundle. Canon is now
  version-pinned to what actually runs, not merely assumed to match.
- FIDELITY NOTE (task 9 reviewer): on Esc-during-tool upstream paints the Interrupted row TWICE (once via `HVo`'s
  F7 branch, once via `ERe` exit 9). Our once-only behavior is the sanctioned F3 divergence, not upstream fidelity.
- PROCESS LESSON #2: two agents running npm concurrently destroyed `harness/node_modules` mid-review (recovered
  with `npm ci`). Reviewers must be told NOT to re-run the full suites when another worker is active — the
  implementer's counts are the evidence.
- Wave T Task 10: complete (commits e105b06c53 + 19d6cf10dd, review PASS / CHANGES-REQUESTED→fixed).
  RECOVERED ORPHAN: the implementer process died before committing and left NO report. Work was found
  uncommitted in the tree, verified green by the controller (typecheck clean, unit 1408, tui 2686), committed,
  then reviewed as unreviewed code from an unknown author. Review found the feature complete and canon-exact
  (sYf L500705-711, lYf L500727-731, tYf L501047 all transcribed correctly) plus two Important gaps.
  Fixes 19d6cf10dd: (1) the availability wiring at ChatApp.tsx:464 was 100% untested — reviewer PROVED it by
  deleting both props out-of-repo and watching all 186 ChatApp-level tests still pass, because every one of
  them renders without hookOpts/model, i.e. exactly the neither-available arm the OLD code produced;
  (2) applyPlanUpgrade's `this.model !== undefined` carve-out contradicted its own docblock — on an unknown
  model it granted `auto` and wrote the chip with no swap and no report. Reachable: `set_model` with no model
  is valid on the wire (ops.ts:43) and permanently blanks the host's model truth.
  Fixer correction to my brief: a host with no model in config does NOT have model===undefined (resolvedModel
  falls back to DEFAULTS.model, which is auto-capable). Only the bare `set_model` op reaches that state.
- Wave T Task 10 review, brief over-inclusive: the plan listed TWELVE test files to migrate; two of them
  (useChat.test.tsx:917, permissionsModel.test.ts:140) use "plan_approve" only as a bare kind string with no
  payload and correctly needed no change. Ten migrated, none weakened; host-park.test.ts was strengthened.
- OPEN LIVE QUESTION, routed to Task 15 (bypass consent gate) — NOT answered by this wave yet:
  is `setPermissionMode("bypassPermissions")` REFUSED or SILENTLY IGNORED on a session launched without
  `allowDangerouslySkipPermissions`? If refused, t10's new catch reports it and mode truth stays honest. If
  silently ignored, host.ts:555 writes a lying chip. The dialog never offers bypass in that state, but the
  host wire accepts the mode from any client with no availability gate. Same exposure the pre-existing
  set_permission_mode control op already has, so not a regression — but it is the one live-SDK premise
  Task 10's design rests on that nobody has probed. Task 15 must probe it.
- FIDELITY OBSERVATION (t10 review): an ATTACHED client can never be offered the bypass arm — bypassAvailable
  comes from hookOpts and the attach path (main.ts:184-190) passes none. Errs toward the narrower grant, which
  is the honest direction and consistent with how `model` is handled, but the same host offers different arms
  depending on how you connect to it.
- Wave T Task 11: complete (commits 4b7884ecf7 + 7881041839, review PASS/APPROVED, 8 sabotages all caught).
  ITEM (d) RESOLVED NEGATIVE — approve-with-feedback is UNREACHABLE, and this is now proven twice over.
  Upstream chain: handleUserAllow (L272004-008) → buildAllow (L272000-001) → L298586-589, where acceptFeedback
  becomes a SECOND {type:"text"} block appended to the tool_result content. No canUseTool can reach that.
  Reviewer strengthened the case beyond the type argument: the CLI zod-validates the SDK's canUseTool response
  (YOn/VdE, L556553) and zod STRIPS unknown keys, so a smuggled acceptFeedback is deleted at runtime, not
  merely untyped; and the "spare updatedInput key" route is actively dangerous — updatedInput is validated
  against the tool's own input schema (L298492-495) and a failure converts the call into an InputValidationError.
  So: UI half only, SHIFT_TAB_HINT stays trimmed, gate drops it explicitly (gate.ts:73-77).
- YAGNI adjudicated (t11): the `feedback` field KEEPS its place. One VERIFIED live consumer today —
  appserver/server.ts:278 broadcasts decision/resolved with the whole outcome object — pinned by reading the
  actual broadcast off the connection sink, not by assertion. The "one line to change if the SDK grows a
  channel" argument was explicitly discounted as speculative and is NOT load-bearing.
- Comment-accuracy defect class (t11 fix): FOUR copies of a false claim ("the host sees what the approver
  said") had to be corrected — host.ts:701 emits `decision: outcome.kind` ONLY. In this repo comments are the
  canon record, so an overstated one is a real defect: the next reader believes the REPL surfaces feedback and
  never builds the piece that would. Known gap now recorded ONCE (PlanDialog divergence 3): an approved-plan
  transcript row carrying the text is what would complete it.
- FIVE citation anchors drifted 1-2 lines and were corrected (L229930 is the plan-file WRITE, L229928 the read;
  L230000 is the `## Approved Plan:` echo). The t11 fixer also caught TWO of the reviewer's own line numbers
  being off by one and wrote the correct ones. Citation drift is now a recurring defect class in this wave.
- DASHED_BORDER is the repo's first custom Ink BoxStyle (stock cli-boxes has no dashed style; upstream's ink
  fork registers it at L179535). Eight glyphs transcribed and codepoint-verified: ╌ U+254C top/bottom,
  ╎ U+254E left/right, spaces on all four corners. Ink 5.2.1 accepts a BoxStyle object (styles.d.ts:142).
  Known omission recorded: upstream suppresses the border under a screen reader (L424996); ccx paints
  unconditionally, same class of gap DialogFrame already records for srPrefix.
- Wave T Tasks 12+13: complete (b0e610ca52, b7dd9610dc, fix 4a0d353a5c; review PASS / CHANGES-REQUESTED→fixed).
  CRITICAL caught by review, measured not reasoned: the stalled watchdog re-armed on ANY message frame, so it
  painted "✻ Waiting for API response · check your network" 10s into a healthy `Bash(npm test)` run. Canon
  cannot produce that — upstream's Ss (L358804-822) measures silence INSIDE the API fetch (mr.lastAt is the last
  stream chunk), so local tool execution can never trip it; and our only mid-tool keepalive (tool_progress,
  pks=30000, L239568) is 3x the threshold, so a one-minute command would oscillate stalled→spinner→stalled.
  Fixed by anchoring the watchdog to turn start: armed once, retired by the first frame proving the API answered,
  never re-armed. Disarm sits AFTER the api_retry early return on purpose — a retry frame is evidence of
  FAILURE, not health.
- IMPORTANT (t13): the retrying label printed the raw wire slug, so the very outage this feature exists for read
  `✻ unknown · Retrying in 33s · attempt 7/10` — probe 96's own sample is {"error":"unknown"}. The wire `error`
  field is `pir()` (L157864-873) returning overloaded|rate_limit|authentication_failed|server_error|unknown,
  none of which appear in canon's UI. Canon has a prose table for exactly this frame — rZp, L437178-437190 —
  mapping error_status to "Rate limited"/"API overloaded"/"Authentication failed"/"API error". Ported verbatim;
  the wire `error` field is no longer read at all.
- STALLED-DURATION resolved negative and closed positively (t13 + review): upstream DOES render
  `· will retry in <dur>` on the stalled row (L407997), computing it before the kind branch (L407976) from
  {kind:"stalled", deadline: Date.now() + Math.max(0, Kn - ss)} (L358821). But Kn is the stalling fetch's own
  abort timeout (L358962 → pYi/dYi L99030-044: env vars + auth-kind branch + remote gate), all INSIDE the claude
  CLI subprocess. The reviewer closed the hole positively: the ONLY site emitting this frame onto the SDK stream
  is L431679 and it yields exactly five fields (attempt, max_retries, retry_delay_ms, error_status, error).
  No second emission site, no stalled-kind wire frame. The number is genuinely unobtainable → clause dropped.
- BRIEF MECHANISM ERROR (t12, confirmed by review): SILENT_SUBTYPES (species.ts:610) is
  ["thinking","model_refusal_no_fallback","api_error"] — api_retry is NOT a member. The transcript null comes
  from the `typeof content !== "string"` guard at species.ts:653. Behavior depended on was real; only the cited
  mechanism was wrong.
- CITATION DRIFT, now a confirmed recurring defect class in this wave: ELEVEN more anchors corrected across
  t12/t13 (stalled label L407992 not L407989-91; stalled tail L407997 not L407995; retrying tail L408007;
  retrying label L408010; countdown L407976 not L407975; glyph box L407985 not L407984; Ss starts L358804 not
  L358806; rZp is L437178-437190 not -189). The fixer caught two the reviewer missed AND corrected one of the
  reviewer's own. Every citation must be opened and read, never copied forward.
- Wave T Task 14: complete (78ad5de275 + fix df41be4629; review PASS/APPROVED).
  MEASUREMENT REFUTED THE PREMISE (the task's real deliverable). "The failure renders twice" was false. With a
  user_message_uuid the frame took the SUCCESS branch: submit() resolved, turn-end carried no error, transcript
  showed ONE row and ZERO ✗. The real defect was that a dead connection was judged a SUCCESSFUL TURN. The second
  line existed only on the uuid-LESS variant, where fifoWaiter matched nothing and readLoop's finally rejected
  with "session disposed" — not a duplicate, a line naming the WRONG CAUSE.
  SEMANTICS: submit() RESOLVES with an error-tagged result (TurnOutcome.error?: TurnFailure), does not reject.
  Reviewer strengthened the case: on rejection the failure reaches the transcript THREE times (chatAdapter.ts:108
  rethrows → useChat.ts:1313 appends ✗ from the .catch, AND useChat.ts:601 appends ✗ from the turn-end arm).
  Fixes: (1) turnFailureOf treated ANY finite api_error_status as failure, contradicting this repo's OWN health
  rule — probes 94/94b classify unhealthy only at >= 400, and validResultFrameShape accepts any finite number on
  a success frame. Latent false positive in the worst direction: runStructured would THROW ON A VALID RUN. Now
  gated at >= 400 (the phrasing also keeps NaN a non-failure). (2) three surfaces discarded the new error tag —
  appserver broadcast turn/completed{status:"completed"} for a failed turn (one-shot, nothing overwrites it),
  daemon UDS returned {type:"done"}, and stream() dropped it. All three now read outcome.error.
  Reviewer's reachability inversion: sdk.d.ts:4300 declares user_message_uuid ONLY on SDKResultSuccess, and
  probe 96's api_error frame IS subtype:"success" — so in streaming-input mode path A is likely the REAL path,
  making the uuid-less path largely theoretical AND the fifoWaiter api_error allowance possibly never-firing.
  Unsettled without a variant-C rerun with a streaming prompt. CHEAP — worth doing in a later wave.
- Wave T Task 15: complete (235f6f7f85 + fix 9045a8bad0; review PASS / CHANGES-REQUESTED→fixed).
  CRITICAL SAFETY HOLE caught by review: `ccx --bg --dangerously-skip-permissions` reached bypass with NO consent
  ever, and propagated (`ccx attach` onto such a session inherits it). The implementer had flagged it and
  concluded there was no upstream precedent — there IS, at L451420-21, and it is exactly this shape: upstream
  refuses --bg with bypass until the disclaimer was accepted interactively once, and names how to accept it.
  Now transcribed (claude → ccx) and failing through the run arm's existing fail(…, 2) path.
  `-p` stays ungated and that IS canon: the gate at L554501-04 sits inside the interactive REPL startup (QHE,
  L576722) and no equivalent exists on the print path.
- ESCAPE-EXIT-CODE adjudicated by the reviewer AGAINST the implementer, with a 6-step dispatch trace: upstream's
  Lu(0) is NOT dead code — it is exactly what Escape runs. keybindingScope is set in only TWO places bundle-wide
  (har L183653 = "Confirmation", dispatcher root L398345 = "Global"); the Select NEVER sets one (select:cancel
  lives in the separate handler registry, a different mechanism). Capture-phase dispatch at the root collects
  ["Confirmation","Global"], ePt returns the FIRST match, Confirmation binds escape→confirm:no, har consumes it,
  Lu(0) executes. The legacy fallback that WOULD have picked Select is never reached.
  The cited precedent (BashPermission.tsx:14, PlanDialog.tsx:63-64) does not transfer: those are Ed-framed, and
  Ed (L437992-438014) is a plain box with no har, no scope, no confirm:no — so there confirm:no goes unconsumed
  and the legacy path DOES land on select:cancel. REAL RULE: an `nr` frame with an active cancel intercepts
  Escape; every other frame lets it fall through to the Select. Behavior shipped (Escape → 0) was already right;
  the COMMENT asserting otherwise was the defect.
- React-free guarantee made STRUCTURAL (t15 fix): the acceptance predicate lived twice (canon reader in a .tsx
  that pulls ink, plus a raw prefs re-read in main.ts) purely to dodge the React constraint. Now one React-free
  module both import. The old guard was line-shaped and missed BOTH a multi-line static import AND anything
  transitive; rewritten statement-shaped with a transitive walk, and sabotage-proven against ink imported two
  hops away in prefs.ts.
- Wave T Task 16: complete (b7b353ab27; review PASS/APPROVED). MEASURED FIRST and the lie was REAL:
  a rejecting setPermissionMode painted the refused mode with no error, no other guard caught it. Fixed:
  mode truth moves only after the setter resolves; rejection appends `✗ <mode> refused by the engine
  (<engine message>) — staying in <prev>`, mirroring host.ts applyPlanUpgrade. Implementer found a SECOND
  instance one line up — the auto arm's setModel(...).catch(() => {}) plus an unconditional model-state
  write and an "↻ switched model to…" announcement, so a refused SWAP painted a model that wasn't running.
- Wave T Task 17: complete (f38366e94a + fix 9e81a0326c; review PASS/APPROVED). BRIEF ERROR caught by me
  before dispatch: it said borderStyle="dashed", but stock cli-boxes has NO dashed style — Task 11 had
  already transcribed the glyphs into DASHED_BORDER. Moved to a shared src/tui/boxStyles.ts as its second
  consumer. SCOPE JUDGMENT upheld by review: the implementer wrapped the WHOLE file-write-diff body because
  canon ial L505692 reads SM({paddingX:1, children: oal}) where oal is ALREADY the ternary — upstream frames
  both arms. Higher fidelity than the brief asked for; the narrow reading is measurably wrong.
- NEW GAP recorded but deliberately not closed (t17): Qsl L505550 wraps the EDIT arm in the same SM at
  paddingX:0 — the dashed rules are not create-specific and ccx's Edit dialog lacks them. Pinned by a test
  asserting the CURRENT ABSENCE so a follow-up must flip it visibly. Notebook arm (fal L505729-825) has no
  SM, so ours is already correct there.
- PROBE 99 (77f82ea073) — settled the wave's last unverified premise AND overturned a standing one:
  · setPermissionMode("bypassPermissions") without the launch flag REJECTS with the engine's own sentence.
    Task 16's catch genuinely fires; the fix is PROVEN, not merely plausible.
  · setPermissionMode("auto") on a non-auto model ALSO REJECTS ("auto mode unavailable for this model").
    The standing premise — inherited from probe 18d and repeated in TEN places — that an unsupported model
    makes auto fall back to `default` IN SILENCE is FALSE for the runtime setter. The engine refuses loudly.
    Swap-first ordering stays correct (it is what makes auto SUCCEED), but the lying-chip hazard it was
    written to prevent cannot arise on that path. Corrected in 64c7f8f956 across autoModel.ts, host.ts,
    useChat.ts, appserver/planUpgrade.ts, a test fixture, and four USER-FACING strings warning of the wrong thing.
  · Probe 18d's claim was SCOPED, not deleted: 18d/24-P2a tested the LAUNCH path; 99 tested the RUNTIME
    setter. Different paths — the launch-path claim is untouched and would need its own probe.
  · system/init carries permissionMode every turn and still reported the PREVIOUS mode after both
    rejections, so a client can reconcile from frames rather than trusting the setter's return.
- Wave T Task 18 (final verification): 4a7a640d85. ALL FOUR gates green including `npm run build`, run for the
  FIRST TIME this wave and clean (all four public .d.ts resolve). A1-A19+A10b walk: 17 proven by test,
  1 needing live TTY (A1), 1 surface-shipped/wiring-deferred (A6), 1 not met as written (A9 — the W-T21
  retraction never reached the criterion's wording; shipped behavior was correct throughout). A9 amended and
  nine undocumented deltas written as spec Revision Notes v2.
- Parity re-score a7f0aa75e6: HONEST, no inflation. tui-ux 71.3 → 71.5% (movement ONLY from rows that did not
  previously exist); coverage.md domain percentages UNCHANGED — Wave T consumes no new SDK surface, so the
  honest result is correction notes, not movement. Nothing promoted for effort: the wave's biggest work landed
  inside rows already scored ✅, which now record that their ✅ was scored ahead of its evidence.
- EXTERNAL WHOLE-BRANCH REVIEW (codex gpt-5.6-sol, base 7af9e093dc) found FOUR MORE real defects after all 18
  tasks and their per-task reviews had passed — fixed in f98a3ade3a:
  · P1 `--detachable --dangerously-skip-permissions` in a NON-TTY skipped consent AND skipped the non-TTY
    rejection (the detachable branch runs before it), silently spawning a persistent autonomous bypass host.
  · P2 THE STALL WATCHDOG NEVER FIRED IN ITS OWN SCENARIO. disarmStall() ran on every non-api_retry frame under
    the false comment "every OTHER frame IS proof the API answered" — but `system/init` is the CLI's LOCAL
    startup frame (probe 99: arrives at 3.31s every turn). On a blackholed endpoint init disarmed the 10s timer
    and the stalled row never appeared during the ~75s silence. Fixing the earlier false POSITIVE had created a
    false NEGATIVE. Proof set now: assistant, stream_event, result, tool_progress, tool_use_summary + system
    subtypes thinking_tokens / model_refusal_* / task_*. `user` frames EXCLUDED — the SDK replays them
    (SDKUserMessageReplay), so they are the same local-echo trap. thinking_tokens INCLUDED — during redacted
    thinking it can be the only wire traffic, and excluding it would re-create the false alarm.
  · P2 `--worktree` + bypass created the worktree BEFORE the consent prompt, so declining left it behind —
    contradicting the gate's own comment that a refusal "costs nothing that has to be unwound".
  · P2 the consult footer advertised `tab amend` on rows that ignore Tab (e.g. the Bash dialog's focused Yes
    row) — a false affordance, and inconsistent with W-T22, which removed copy for exactly that reason.
  LESSON: run the external whole-branch review BEFORE declaring a wave done. Per-task reviews are scoped to
  their diff and structurally cannot see cross-task interactions like the init-frame/watchdog collision.
- WAVE T COMPLETE. Final: typecheck clean, unit 1464, tui 2738 / 9 skipped, build clean. 40 commits on main
  from 7af9e093dc, NOT pushed. Remaining for the programme: Waves R, S, C (each needs its own grounding round
  per D9), plus the recurring QA sweep per D6.
## Wave R (plan: docs/superpowers/plans/2026-08-06-wave-r-repaint-geometry.md, v2)
Base: 7c9de3fc0c. 13 tasks. Grounding + SP-R0 + plan review complete before task 1.
Task 1: dispatched (terminal size as React state)
Task 1: review clean (spec PASS + quality PASS); 2 Minors -> fix dispatched. commit 76ef0c17a8
Task 1: complete (commits 76ef0c17a8..ed32e037c1, review clean, 2 Minors fixed)
Task 2: impl 87fb643af5 (DONE_WITH_CONCERNS); tall-frame-chunk hazard verified real (pager path) -> fix dispatched
Task 2: complete (commits 87fb643af5..48baa79683, review PASS/PASS, 2 Important fixed: empty-clear guard tested, frame cleared on erase)
Task 3: impl 77552aa953 (DONE_WITH_CONCERNS); verdict-rule false positive caught by implementer, deviation accepted; Task 4 gated on a colBefore feasibility check
Task 3: complete (commits 77552aa953..bc5bfe602e; review PASS/PASS w/ 1 Critical + 2 Important, all fixed; answerable domain proved)
Task 3: FINAL (commits 77552aa953..3540220b3b; 2 review rounds, 1 Critical + 4 Important fixed; oracle fires on 105/118 widths, tmux verified)
Task 4: impl 93d6dad962 (DONE) — parking premise OVERTURNED by measurement: a bare column move can never answer (tmux clamps a reflowing cursor to its line's USED cells; Ink's cursor row is blank), so the park PADS with spaces. Erase count therefore carries ceil(parkedCol/newWidth) for the cursor row, not the plan's flat +1. Also: the brief's synchronous count would have over-erased — eraseLines leaves the cursor on the topmost cleared row, so we emit only region-ink+1 and Ink's own erase covers the rest. Two Task 2 recorder repairs folded in (bodies not ending in a newline are nobody's frame; escapes-only writes restore the park).
Task 4: review ❌/Needs-fixes — 2 Critical, 2 Important. Sabotage pass: 23 mutations, 18 caught, 5 slept (all on the staleness axis). Both erase counts independently re-derived from ansi-escapes + log-update and CONFIRMED correct; padding departure independently reproduced.
Task 4: fix round 1 f236ad32a5 — Critical(stale-width over-erase: 13 rows erased over 7 occupied) closed by re-reading deps.size() in the continuation, caching the verdict but abandoning the emission; Important(parkedCol stale across the tall-frame write) closed, and the fixer found the SAME lie in the erase-only branch on its own. 6 new tests, each sabotage-verified against its own mutation. unit 1543 (+6), tui 2747/9-skipped, typecheck+build clean.
Task 4: OPEN — Critical 1 (residue survives a rapid multi-event drag) is a DESIGN question, not a patch. Mechanism confirmed in Ink's source by the controller: resized() defers the actual write through throttledLog, and log-update dedupes identical output away entirely, so a SIGWINCH does not imply a write. Measurement of FIXED-vs-BASELINE drag behaviour dispatched to decide extend-vs-ship-partial.
Task 4: drag measurement landed (46 cells, 3 reps each): FIXED better-or-equal to BASELINE in every scenario, ZERO content loss either build (markers byte-identical in scrollback). Fine one-column drag is the honest gap: 1 composer + 3 stale rules vs baseline 3-4 composers + ~6 rules. Verdict: unimproved case, NOT a regression. INCIDENT: the measurement agent tore down with `tmux kill-server`, killing the owner's `main` and `sdk` sessions — W-R8 now bars every all-sessions form; per-name kill-session only.
Task 4b: authored into the plan (frame-write-time correction; W-R9 in spec Decision Log). Deletes correctionBeforeRepaint + sync emission path; corrector injects between Ink's erase prefix and body against the LIVE width; fine drag becomes the acceptance cell.
Task 4b: complete (commit f9913e1bcd, review Spec ✅ / Approved, ZERO Critical/Important in the change). Write-time corrector verified: arithmetic independently re-derived from ansi-escapes + log-update (union exactly inkErases+shortfall rows); double-correction guard traced as genuinely load-bearing (dedupe case would stack a second erase); 12 sabotage mutations, 11 caught. Both implementer deviations (width>=2 refusal; verdict() self-write suppression) ratified as refusals that can only under-erase. Burst/stepped/widen all clean 3/3; fine first-session drag residual is a NAMED gap (spec Surprises 9), controller-owned. Carried to Task 8 (in plan text): reset widthAtPaint on the 2J branch; keep inkErases read off the wire. MINORS for final review: (1) rewritten one-shot consumption unpinned (sabotage slept); (2) Static-flush erase-only window named but untested; (3) double-correction guard pinned at driver level only, no proxy+driver integration pin; (4) parkedCol can understate the park row after an escapes-only re-park at a narrower width (safe side).
Task 4/4b: EP-R1 core DONE. BASE for Task 5: f9913e1bcd
Task 5: complete (commits 6ab4e72fd8 + fix e5c8e3bf37 + controller fix2, review ❌/Needs-fixes → re-review ✅/Approved). Matrix PROVEN non-decorative: sabotaged correction caught in 5/7 cells, height-only controls stay green; rule-count pin caught the exact-multiple 160→80 blindness LIVE. CI truth restored: .github/workflows/cc-to-sdk.yml EXISTS (implementer claimed otherwise) — matrix now a Node-22 step with RESIZE_MATRIX_REQUIRE_TMUX=1 (renamed from CI_REQUIRE_TMUX: is-in-ci treats ANY CI_* var as CI and Ink then never subscribes to resize); ccx children launch CI=false (ratified: real interactive pty; chalk side effect measured null; capture-frames.py precedent). A5 cell restructured (shrink before first submit, TWO shrinks — one-shrink is repaired by correctionAfterRepaint and stays green under the write-corrector stub). Four dialogs threaded (Model/Rewind/Session pickers + PlanDialog), each pin individually sabotage-verified. Controller fix2: settle_frame replaces the two one-shot captures + sleep 1 (re-review finding A, CI flake risk); matrix re-run 7/7. LEDGER NOTES: "frozen at mount" premise was FALSE (default params re-evaluate every render; real rationale is single-source-of-truth) — plan Task 5 "Why" text inherits that error; FilePermission columns gap left (needs PermissionDialog signature widening); qa-driver.md needles fixed to "⏎ send". BASE for Task 6: HEAD after fix2.
Task 6: complete (commits a5c403465e + fix 8ee86567af, review ✅/Needs-fixes → all 6 findings fixed). A3 test PASSED on current build — kept as guard, no fix invented (Step-2 rule). HONEST SCOPE (reviewer F1, measured): the keyless test guards the one-spinner-slot and interrupt-clears invariants ONLY; it is structurally blind to the resize axis (spinner renders no width-dependent quantity; test stays green with Task 1's resize wiring reverted). CONTROLLER RAN THE LIVE A3 CELL KEYED: 8/8 matrix incl. a3 — escRows/elapsedRows exactly 1 through shrink 80 + grow 100 mid-stream, 0 after Esc, preconditions genuinely asserted (2 streamed rows >80 cols), no flake on first run, isolation held. LEDGER NOTES for final review: (a) renderMarkdown does NOT wrap prose at any width — opts.width reaches only renderTable (mdTable.ts:124); the mid-turn staleness gap is REAL ONLY for a top-level markdown table streaming across a stall (reviewer F3 corrected the implementer's broader claim); (b) tmux -e credential bound: a server started by the keyed call holds the argv for its life (same-uid only, nothing on disk — accepted); (c) settle_frame_hold (3-capture hold) exists for streaming screens, idle cells keep the cheap form. BASE for Task 7: 8ee86567af
Task 7: complete (commits 4a78034df6 + fix a6458ad6e6, review ✅/Needs-fixes → both Importants fixed, sabotage-verified). /clear now: viewport-only erase (NO 3J, byte-matched to upstream yJr = fI+(YIe+Mps(1))^n+fI), forced repaint via Ink's writeToStdout shape (log.clear→raw write→re-log) — createForceRepaint REJECTED with measured reason (app.clear zeroes counters; raw bytes leave next render appending BELOW → duplicate composer) and now DELETED (t7-fix). tmux: zero-keystroke repaint at 600ms/2s/4s, scrollback 135 lines w/ all 91 markers intact vs control 30/0. A7 amended (echo dies with viewport, L178442 controller-verified); second impossible-premise instance (banner-in-frame) recorded. Reviewer proved the /clear guarantees are UNDONE by the tall-frame branch (3J wipe + fullStaticOutput resurrects cleared transcript, SECRETTRANSCRIPT ×2) — carried into Task 8's brief as raised stakes (abe90e299b). InkModel test pattern (debug:true kills all dedupe in ink-testing-library — model + tmux is the response) noted for Task 8. MINOR on ledger: unit count 1548→1547 (one createForceRepaint-only test retired with the primitive). BASE for Task 8: a6458ad6e6
Task 8: complete (commits 3d95b02a54 + fix b8ee2ce5b0, review ❌/Needs-fixes → Critical fixed with A/B teeth both directions). EP-R4 shipped: proxy resyncs frame/widthAtPaint/park on the 2J branch; 3J stripped from Ink's tall chunk (scrollback 40→40 vs 40→0); tallWrites counter + pager-close clearViewport repaint for the zero-byte dedupe close. CRITICAL caught by review: repaint gated on HISTORY (tall ever written) not STATE — `?`//help//model/launch-frame all armed it, only pager close cleared it → fired on unprepared screens, 6 live rows destroyed (A/B: effect removed → 6/6 survive). Fix: recorded frame write clears the counter; Critical repro now 6/6 both screen+scrollback, pager recovery at 60×15 intact, sabotage 4 red. NAMED RESIDUALS: fullStaticOutput replay resurrects /clear'ed transcript (unfixable at proxy; Ink's clear path never resets it) + one full static copy appended to history per tall render (88→172→256→340; evicts real lines at default history-limit). CANON FACT: upstream has NO tall-frame branch at all — hazard class is Ink-only. Spec Surprises 10-12. MINORS on ledger: widthAtPaint=0 reset unfalsifiable (frame gate subsumes it — correctly implemented, no teeth possible); A8 has no CI cell (matrix predicate requires contentAboveFrame>=1 which pager-close shape violates — needs a predicate decision); non-pager tall surfaces (`?` at small panes) still stay painted on close (pre-existing Ink dedupe, now safe but unrecovered). BASE for Task 9: b8ee2ce5b0
Task 9: complete (commits ac0cbaaf1d + fix f6e1e10b57, review ✅/Needs-fixes → all 6 fixed). highlight.js@11.11.1 exact-pinned (bundle's own version, DmH L418956), lazy memoized createRequire singleton (~60ms off TUI mount). Transcription verified MECHANICALLY by reviewer: 24+24 dark/light (zero coinciding values) + 12-key ansi256 (bundle beat the spec's "24") + 16 storage keywords (not 17 — comment fixed) + 5 filenames, all byte-exact. Whole table now fixture-pinned (60 palette cells + keywords + filenames + 3 foregrounds). 12 lur aliases installed hljs can't resolve (php3-8, mysql, oracle, freepascal cluster) added with L222493 cite — reachable set now the full 383. Both fns degrade to unstyled/undefined on loader failure (setHljsLoaderForTest seam). NOTES for Tasks 10-12: Segment encoding = hex for dark/light, ansi256(n) grammar for fallback — but resolveThemeColor currently FLATTENS ansi256(n) to hex before Ink (Task 11 must settle pass-through vs drop); selectPalette keys off COLORTERM (brief-mandated substitute; upstream keys off theme name + emit-time quantisation via chalk level — divergence recorded in code). BASE for Task 10: f6e1e10b57
Task 10: complete (commit 27539e3db2, review ✅/Approved, zero Critical/Important). ResolvedPatch.filePath threaded resolve→both rungs→renderDiff→row renderers, deliberately unread; byte-identical rendering PROVEN (315 render pairs across 9 patches × 7 widths × 5 themes, zero mismatches); memo safety structural (only 2 construction sites, no spread/clone of patches anywhere in src). Sidecar-over-input precedence UPGRADED from judgment to bundle fact: upstream's VHH (L424365) destructures the RESULT's filePath and never consults input — result leads is canon. Notebook arm resolves .ipynb path into file_path, matching upstream L505816 — Task 11 must NOT "correct" toward cellPath. MINORS → Task 11's dispatch: (1) pin the precedence with divergent input/sidecar values; (2) the thread-through has no guard until detectLanguage consumes it — Task 11 must assert a Dockerfile patch reaches it; (3) the ?? inputPath fallback on the sidecar rung is unreachable (editShape/writeShape require string filePath) — comment overstates. BASE for Task 11: 27539e3db2
Task 11: complete (commits 6e71a4d94c + fix f54bddfa3d, review ✅spec/❌quality → Critical + 2 Important + 4 Minor all fixed). A9 core shipped: added/context rows tokenized (i2p L419813 shape), removed rows FLAT (pinned both ways), context number-cell dim asymmetry pinned. A10 verified through the real stack (dark≠light truecolor triples; ansi256 palette emits real 38;5;n indices — resolveThemeColor now PASSES THROUGH ansi256(n), measured: flattening to hex hit a DIFFERENT palette entry at chalk level 2). A11 pinned (bare Dockerfile → keyword-coloured FROM). CRITICAL caught by reviewer fuzzing (504 combos): wrap-ansi NFC-normalizes internally so NFD source lost leading indentation/trailing chars SILENTLY in a pre-approval diff — fixed both layers (per-segment NFC + piece-not-found fallback emits the piece as one flat row: mis-colour possible, text loss impossible). Fixer CORRECTED the reviewer's I2: bare ESC byte loses nothing; a full SGR sequence in source is what breaks (13 visible cols on a 7-col row) — test pins the row-width bound. Palette memo term + fill foreground now pinned (were silently mutable). detectLanguage hoisted to once per body; palette in memo key; theme switch re-renders, streaming stays cached. Divergence ledger: context rows still get a right fill upstream lacks (pre-existing, invisible). BASE for Task 12: f54bddfa3d
Task 12: impl ca3852ef5b (review ✅/Approved). Band-under-token shipped: add side tokenize-then-overlay (only bg changes at boundary, color survives — A9 clause 3); remove side flat-then-cut, bundle reading INDEPENDENTLY CONFIRMED (L419813 span selection by marker BEFORE ZmH; KmH/YmH populate ranges for both pair members against the flat cWo pair). Whole-row wrap matches upstream a2p (band re-opens on continuation row, confirmed live) — implementer's wrap concern resolved in ccx's favour. DEFERRED (spec): port Q$p+diffArrays to replace diffWords — jsdiff normalizes whitespace to the NEW side so remove-side bands land wrong on reindented lines (pre-existing since F4; t12 made it text-safe, highlight-only). Fixer dispatched for I2 (whole-row wrap totally unpinned — per-part restore leaves 48 tests green) + M1 (f4 boundary assertion vacuous under ansi256/CI default) + two-range off-by-one localization.
Task 12: complete (commits ca3852ef5b + fix 675a6fabdb, test-only). Whole-row wrap + continuation band pinned (per-part restore → exactly the 2 new cases red); f4 boundary assertion now bites in ALL THREE palettes (comment token exists in jmH; asserts shared colour is the scope colour, NOT fg); off-by-one localizes in diffRender.test.ts. EP-R5 COMPLETE. BASE for Task 13: 675a6fabdb
Task 13: complete. Full gates green at 675a6fabdb (typecheck; unit 1588/149 files; tui 2796/9 skipped; build). A1-A12 ALL MET: A1/A2/A5 fresh keyless matrix 7/7; A3 keyless guard + controller's keyed 8/8 earlier this session; A4 fresh tmux (one picker, no wrong-width rules after 120→80 with /model open); A6 zero-keystroke repaint in 0.25s, markers prove blank; A7 scrollback intact + pipe-pane shows 3J=0; A8 tall pager close clean + immediate resize clean; A9/A10/A11 pinned suites + live truecolor capture (tokens in added line, flat removed, bg-only word boundary, 38;5;n degradation, Dockerfile RUN keyword); A12 workflow step verified. CONTROLLER RAN THE TWO-TURN KEYED CELL: two real streamed turns, 120→80 between, 80→120 after — rules=2 wrongWidth=0, one composer, both turns intact. FIFTH NAMED RESIDUAL found by verification: short-pane shrink strands one rule row ABOVE the viewport top (unreachable by any erase; revealed by later height growth; spec Surprises 13). Verifier's two instrument bugs recorded honestly (byte-locale grep over box glyphs; contentAboveFrame is a staging self-check).
WAVE R CODE COMPLETE (Tasks 1-13). Pending: external whole-branch codex review.
WAVE R CLOSED 2026-08-07. External codex review (gpt-5.6-sol, base 7c9de3fc0c): 3 findings (P1 mount-fire recovery — mechanism partly refuted but fixed on firmer ground, transition-gated; P2a stderr restore misclassified as Static — confirmed against ink.js:157-171, dropped-frame memory added; P2b matrix could kill colliding-name sessions — per-run pid names, register-after-create, decoy A/B verified). All closed in 6346f0c40a. Retrospective written into spec Outcomes. Final: unit 1592, tui 2797/9, matrix 7/7 keyless + controller-keyed cells, build clean. NEXT: Wave S (session-truth), needs its own grounding round.

## WAVE S (session truth) — begins 2026-08-07
- Owner directives at Wave R close: FULLSCREEN-1 DECIDED — fullscreen renderer becomes its own roadmap wave after S and C. Wave S begins now with its grounding round.
- Grounding round dispatched (3 opus workers): P0 code truth, bundle transcription, P1/P2 code truth. All three landed.
- CONTROLLER RAN THE KEYED S1 REPRO (4 runs, 5 instrument bugs fixed along the way — see spec §12 item 20). VERDICT: qa5-05/qa4-11 REPRODUCE, but the diagnosis on file (and the grounding worker's, and the spec's DECIDED-AUTO) are all wrong. The rewind is CORRECT at the data layer (post-rewind row parentUuid → the assistant row before the anchor); the session file is APPEND-ONLY and never truncated (19→20→24 rows measured); the replay is flat (`parentUuid` appears NOWHERE in src/). Fix = walk the parent chain from newest leaf. Spec §6 EP-S1 re-cut, DECIDED-AUTO retracted (c51c98f6fa).
- UNFILED DEFECT FOUND: ccx cannot rewind to its own FIRST message (no prevUuid → conversation:false → confirm panel offers only "1. Never mind"). Assigned to EP-S3. Frame: waveS-04-first-anchor-unrestorable.txt
- Grounding reports: waveS-grounding-P0.md, waveS-grounding-bundle.md, waveS-grounding-P1P2.md
- Stream S re-cut in the umbrella spec (736fb5a625): S2 sheds qa5-04 (MISREAD, → ANCHORS-1 open question) and grows to 9 surfaces; S3 gains the first-anchor defect + upstream's 6-option set; S4's body MOVES to Settings/Permissions (rewind+session pickers already correct, /model needs only the counter); S5 corrected (dollar total already right; ctx goes stale not resets); S7's premise corrected (no SDK progress field — upstream's bar is 1-e^(-s/90) theatre; ~90k-line anchor drift); S8 gains upstream's narrow gate + the prefs-write ordering trap.
- Wave S feature spec v1 authored + committed (d807cebe61): 8 epics, A1-A14, W-S1..W-S10, 3 open questions (ANCHORS-1, SLASH-PERSIST-1, CTRL-B-1), 5 surprises, 4 deferrals. Spec review dispatched (opus) before the plan.
- SPEC REVIEW returned "plan CANNOT be written from this spec" — 3 Critical, 6 Important, 7 Minor. Controller VERIFIED the spine refutation independently against the REAL rewound session file (not fixtures): getSessionMessages returns 4 rows = the live branch only (TWO/THREE correctly absent), and parentUuid is STRIPPED from returned rows (keys: type,uuid,session_id,message,parent_tool_use_id,parent_agent_id,timestamp). W-S1 INVERTED in spec v2 (8f198fd04a): the SDK already branch-resolves; the defect is TIMING (at rebuild the fork row doesn't exist — the 20th row is `last-prompt`, which doesn't move the leaf); fix = truncate the reader's rows at anchor.prevUuid, which v1 had rejected. Rejected walking parentUuid ourselves for 3 independent reasons incl. it would BREAK compaction relinking (now criterion A2).
- Spec v2 also: EP-S3b + EP-S4 migration split out; A2 replaced (original already passed at HEAD); A3/A4/A5/A6/A8/A13 re-worded; W-S5 justification withdrawn (upstream has NO persistent context chip); W-S11 added (record deliberate divergences); 3 dropped items restored (double rebuild de-dup, rewind window constant, qa4-07(ii) count); ANCHORS-1 flagged as unverified premise (probe 68b never re-run; reviewer's fixture suggests anchors SURVIVE compaction).
- WAVE S PLAN AUTHORED + committed (2daf468f1b): docs/superpowers/plans/2026-08-07-wave-s-session-truth.md — 13 tasks. Global Constraints carry the credential/isolation/tmux-teardown rules, W-S10's instrument rule, and the FILE-vs-reader-OUTPUT distinction. Task order: T1 EP-S1 spine (truncateAtAnchor + wire prevUuid + double-rebuild de-dup + parentUuid guard) · T2 EP-S2 one state emit · T3 A4 guard + EP-S3b first-message restore via clearSession · T4 /model counter off onViewChange + rewind window constant re-derived · T5 Settings→Select · T6 Permissions→Select · T7 /cost fields · T8 ctx chip after /clear · T9 --continue + resolveResumeArg (3 outcomes incl. `pending`) · T10 resume cancel line + Ctrl+A/Ctrl+W + preview count · T11 compaction busy/bar · T12 model-switch confirm gated BEFORE the prefs write · T13 verification (incl. re-measuring ANCHORS-1). Appendix names the seven things deliberately NOT built.
- SPEC v3 (same commit): PLANNING FOUND A THIRD UNFAILABLE CRITERION. EP-S3 (rewind confirm panel) is ALREADY BUILT — rewindModel.ts:186-245 carries the option set/gating/head clause/both explanation lines, wired at RewindPicker.tsx:263-281 by F6 T10. EP-S3 now has zero work items; A4 re-cast as a regression guard; its one residual (the `prevUuid != null` gate at RewindPicker.tsx:263) moved into EP-S3b, because that gate is HONEST until host.rewind can serve the case behind it — both halves move together or the panel lies. Surprise 6 records the pattern: epics written from what the BUNDLE contains rather than what CCX contains, only compared when someone names the files to edit.
- Plan review dispatched (opus, general-purpose — doperpowers:plan-reviewer agent type is not registered in this session). Briefed to hunt for a FOURTH already-built item and to read Select.tsx + both dialogs in full for T5/T6 feasibility.
- ANCHORS-1 CLOSED BY MEASUREMENT (probe 68e, new, run keyed by the controller). 4 pre-boundary anchors -> 1 post-boundary, ZERO survivors. The premise on file is CORRECT and the spec review's contrary fixture was wrong. NOT A DEFECT: getSessionMessages returns the compacted view (compact_summary row + preserved tail + post-boundary turns), so the pre-boundary prompts are absent from the reader's output entirely — which is honest, because the model no longer holds them. No work follows. STRONGEST EVIDENCE YET FOR W-S1(c): a hand-rolled parentUuid walk over raw JSONL would resurrect exactly these 4 discarded anchors; criterion A2 is the guard. RUNTIME CORRECTION to sdk.d.ts:2965 — preserved_segment is NOT superseded; the live boundary frame carries BOTH it and preserved_messages, plus trigger/pre_tokens/post_tokens/cumulative_dropped_tokens/duration_ms (17914 -> 1229 tokens, 16685 dropped, 11.9s). Spec Surprise 7 + Open questions row + plan T13 S2 + plan appendix all updated.
- Plan Task 3 CORRECTED before dispatch (a1915d7be2), from a controller check: `clearSession` is NOT an SDK method (sdk.d.ts declares only resumeSessionAt:1815) — it is the HOST's own method at host.ts:449, whose body is swapEngine({resume:undefined, resumeAt:undefined}). And calling this.clearSession() from inside rewind() would NEST a second swapInFlight window (host.ts:451-453), whose inner finally reopens the busy gate mid-swap. Task 3 now calls swapEngine directly, has no feature-test and no BLOCKED path, and gained a busy-window-stays-closed test. Also gained Step 7: a null anchor must SKIP Task 1's 8x375ms poll (correct result is zero rows; polling makes a successful empty restore read as a 3s hang). Predicate is `prevUuid !== null`, not falsy — undefined means "anchor unknown" (old host) where rows ARE still expected.
- WAVE S EXECUTION BEGINS. BASE for Task 1: a1915d7be2. Task 1 implementer dispatched (opus) in parallel with the plan review — Task 1's premises were controller-measured twice, so a review finding there costs one fix round rather than the wave.
