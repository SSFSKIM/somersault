# bl10 round ledger — opened 2026-08-31

Mandate (owner message, post-bl9): three observations against canon **2.1.251** (bundle at
`~/claude-code-bundle/2.1.251/`, freshly re-tooled for the Bun ESM chunk-graph format — see its MAP.md;
`cli.pretty.js` = 39.5 MB / 881,404 lines, greppable, VERSION 2.1.251 confirmed):

1. **Slash-command menus** — commands like `/status`, `/compact`, `/mcp`, `/plugins` each load their own
   slash-command menu surface in canon; owner wants real investigation of how each works and a
   slash-command-menu TUI implementation. "There are lots of slash commands that has its own slash
   command menu."
2. **Click-to-collapse** — our tool-use streams expand on click but do NOT re-collapse on re-click;
   verify canon 2.1.251's actual click semantics and diagnose ours.
3. **Inter-block vertical spacing** — owner: our TUI's blank-line spacing between tool streams /
   agent messages is too tight vs the real TUI, which is more spacious ("더 여유있는 모양").

Discipline: observations are testimony, not diagnosis — research first (opus), then spec+plans,
codex adversarial plan review, worktree execution (sonnet implementer/reviewer pairs, mutation
checks), sequential --no-ff merges with reconciliation gates, whole-round codex review + fix waves,
full close-out. Nothing pushed without explicit request.

Base: main at `0a3e06814c` (peer PR #13 engine-core merged — SDK 0.3.250/0.3.251 adoption; bl9
content verified intact: 71260812b2 reachable, liveActivitySeq present in useChat.ts ×8).

## PRE-COMMITTED convergence rule (binding before the review loop opens)

Same rule as bl8/bl9, with bl9's outcome-class refinement:
- After wave 3, LOG findings instead of fixing — EXCEPT regressions the waves themselves introduced.
- Two consecutive waves refining our own fix ⇒ stop patching, replace with the single invariant.
- Outcome-class distinction: destructive outcomes (content/state loss) = regression exception → fix;
  safe-direction imprecision (bounded staleness / cosmetic) = log.
- A round producing only logged debt and dismissals = convergence; stop.

## Operational rules carried forward
- nohup-detach for codex reviews: launch (`nohup … & disown`) in a FOREGROUND Bash call; watcher in a
  SEPARATE run_in_background call. Findings → durable file ending `EXIT=$?`; stderr → job tmp.
- Subagent dispatch prompts preemptively include the background-wait unstick line.
- Coordinate with peer sessions (ListAgents/SendMessage) before any merge if main moves again.
- Research on opus; implementers/reviewers/fixers on sonnet; no fable subagents.

## Log

- 2026-08-31: Round opened. Ledger + convergence rule committed before any review loop. Dispatching
  R1 (slash-command menus), R2 (click-to-collapse), R3 (vertical spacing) research in parallel.

- 2026-08-31: R1/R2/R3 all DONE (research-slash-menus.md, research-click-collapse.md,
  research-spacing.md). Verdicts: /compact = MISREAD (text-only in canon too; the menu is
  /autocompact); slash menus ride ONE shared framework (Pg tab shell L122645 + Zi pane L122728 +
  me frame L568952 + auto keyhint bar; oj dialog table L144758) — we have the tab strip only;
  click-collapse = [BUG] hit-region (state machine + tests fine; expanded rows keep glyph-width
  clickable bound where canon's background rectangle makes the whole band clickable;
  FullscreenViewport.tsx:282/315/448; wrong pin at fold-click.test.tsx:707); spacing = [NOT-BUILT]
  one mechanism (canon: 1 blank above EVERY top-level block via addMargin, gm L18761; ours: zero
  everywhere; 4 concat sites in toolRenderer.tsx + spinner/composer chrome) + one [BUG]
  (expandedMemberItems member arm lacks the leading blank thinkingRowItems has).
  Round shape: T-MENU (shell + /mcp + status-family routing + permissions Auto mode tab),
  T-SPACE (separator invariant + chrome), T-CLICK (hit-region widen + band). Wave 1: T-MENU ∥
  T-SPACE in parallel worktrees; T-CLICK after T-SPACE merges (its fold-click frames sit atop
  changed spacing).

- 2026-08-31: Plan review (codex gpt-5.6-sol, planreview-findings.md) returned 8 findings (6 high,
  2 medium) — ALL verified and adopted (7th consecutive round the gate pays): F1 anchors≠blocks →
  separators over realized units (D11); F2 MAIN_DOCK_ROWS 14→16 + dockDialogRows + palette state in
  ChatComposer (D16); F3 status-family info-equivalence gate (D13); F4 /mcp from mcpServerStatus()
  .tools, no flattened inventory exists (D5 amended); F5 R1 MISREAD canon permissions order — our 5
  tabs already match, only INSERT Auto mode before Workspace, display-only (D12; research file
  corrected); F6 ChatApp.tsx declared reconciliation seam + MCP joins paneOwned + combined geometry
  test post-merge + T-CLICK branches from post-BOTH-merges (D15); F7 expanded-flag is not a band —
  explicit band marker drives paint AND hit width (D9 v2; the absorbed-thinking margin row carries
  expanded:true); F8 streaming bypasses anchors → separator in shared streaming representation (D14).
  Spec v2 + plans v2 committed 99e422091a. Notable: the review caught a research misread (F5) that
  the round would have shipped as a regression.

- 2026-08-31: EXECUTION opens. Wave 1: worktrees bl10-t-menu + bl10-t-space off 99e422091a; sonnet
  implementer/reviewer pairs; review-package BASE recorded per task. T-CLICK waits for both merges.
T-MENU T1: complete (99e422091a..185c85d727, review clean; minors: keyhint ordering approximation documented; hintScope-gates-bar judgment call)
- T-SPACE T1: implemented 7d609954aa, review PASS/APPROVED with 3 mutation checks green.
  Implementer found + canon-verified the expanded-cluster double-blank conflict (now spec D17);
  reviewer adjudicated the three concerns: outer-separator skip CORRECT, :gap ids collision-free,
  projectPending pushes MIXED (advisor tail + withheld hooks need separators -> fix wave; live hook
  counter exempt per canon di L189434). Fixer dispatched for the two Importants.
T-SPACE T1: complete (99e422091a..0181bbd7cc incl. fix wave, re-review APPROVED w/ mutation evidence)
T-MENU T2: implemented bd5b6c26d5; review FAIL on A4 keyhint clause only (implementer's two justifications refuted with code cites — Esc separable from bar; registry extras cover '/ to search'); fixer dispatched. Mutations green (order swap 6 fails, body swap 26 fails). Nit: AUTO_MODE_EMPTY dim vs canon italic — in fix wave.
T-SPACE T2: complete (0181bbd7cc..864a2ae30a, review PASS/APPROVED, 3 mutations caught; MINOR logged for final-review triage: streaming->finalized transition test is pure-function composition, not orchestration integration)

- 2026-08-31: REPO MIGRATION mid-round (peer notice, verified): codex_somersault ARCHIVED on GitHub
  (isArchived:true, last push 03:57Z); project moved to the somersault monorepo
  (/Users/new/Developer/GitHub/somersault, github SSFSKIM/somersault, main). Verified: somersault
  dcbc25fb's CC-to-SDK tree == old main 0a3e06814c's (my bl10 base) byte-identical; harness/src/tui
  tree UNCHANGED even at somersault HEAD (the new reforge campaign there doesn't touch TUI).
  PLAN: wave-1 execution continues in the old-repo worktrees (self-contained); at merge phase,
  format-patch/git-am the bl10 doc commits (8c61f97513, 99e422091a, 87f50411ab) + ticket branches
  onto somersault main, then run the --no-ff merges THERE; T-CLICK worktree gets created in
  somersault. Old-repo local main is frozen per the move (no more merges land on it). Peer's
  bl11-advisor-mirror PR #1 (appserver-only) has zero overlap; merge timing theirs.
- Peer coordination: somersault main confirmed harness-untouched since restructure (measured: git diff --stat dcbc25fb..origin/main -- CC-to-SDK/harness EMPTY). Peer's PR #1 (bl11-advisor-mirror, appserver-only) left for the OWNER to merge — absorbing it locally would desync an open PR from origin; flagged for close-out report.
- Peer PR #1 merged to somersault main by owner (merge 8a07f1d6, 12:24Z) — fetch before first bl10 landing; harness delta = appserver+parity docs only.
T-MENU T2: complete (185c85d727..3f354be436 incl. keyhint fix wave, re-review APPROVED, scope clean)
T-SPACE T3: implemented b452f811c2 (slot margin, composer palette-conditional margin, MAIN_DOCK_ROWS 14->16, dockDialogRows, 8 tall-write guards); reviewer dispatched with dock-arithmetic audit + 29-vs-71 pre-existing-reds reconciliation mandate.
T-MENU T3: implemented 5215fecdf7; review PASS/APPROVED with 2 Important TEST gaps (dialog-side fresh re-measure masked by arm's refreshCtx — no arrow-key-into-Status test; /cost per-model numerics unpinned); fixer dispatched. Minor: double refreshCtx load-bearing (verified by isolation mutations). Nit: formatUsage reset-time unasserted.
T-SPACE T3: review Spec PASS / Quality REJECTED — production code independently re-derived correct, but guard tests toothless (slot-margin sabotage survives whole suite; tall-write test's RED-FIRST header claim doesn't reproduce; palette wiring guarded only incidentally). Baseline RECONCILED: 71 pre-existing reds byte-identical at both ends (the '29' was a curated subset, all 29 within the 71), ZERO new regressions. Fixer dispatched for guard teeth.
T-MENU T3: complete (3f354be436..6630296a49 incl. test-pin fix wave, re-review APPROVED both mutations independently confirmed)
T-SPACE T3: complete (864a2ae30a..f3ba5dd22e incl. guard-teeth fix wave, re-review APPROVED, both sabotages independently confirmed). Rebaseline checklist inherited: 71 pre-existing reds, byte-identical through T2/T3.
T-MENU T4: complete (6630296a49..824cbd8494, review PASS/APPROVED; paneOwned D15 present + mutation-verified as unguarded — PRE-EXISTING mechanism gap across settings/permissions/mcp arms, logged for final-review triage / shared regression test backlog; MCP_EMPTY literal deliberately trimmed vs canon, no action).
T-SPACE T4 INCIDENT: my T4 implementer fanned out its own subagents and a duplicate-coordinator situation arose (one worker stood down and reported). Worktree state verified healthy: 12 orderly canon-cited rebaseline commits f3ba5dd22e..889ba9391f; uncommitted resize-matrix.sh edit (stale ready-needle fix, adjudication pending); resize-matrix running on DEFAULT tmux server (deviation from private-socket rule — flagged). Sent explicit sole-coordinator mandate to my direct child with cleanup + report contract.

- 2026-09-01: T-MENU COMPLETE (5/5 tasks, battery green, A1-A4 walked). FIRST SOMERSAULT LANDING:
  doc commits cherry-picked (1e663cbdd, aaa0f4366, 9ba4fa786), branch rebased --onto somersault main
  (99e422091a base), gates re-run on the post-bl11 tree (typecheck clean, tui 4979, unit 4406),
  merged --no-ff as d1494375e. LOCAL only, not pushed. Old-repo main frozen.
- Session-limit 429 killed the T-SPACE T4 coordinator + workers mid-matrix (~00:20 KST reset);
  coordinator RESUMED with sole-coordinator mandate (workers' 12 rebaseline commits all landed
  pre-crash). Peer heads-up: BL12 (CLAUDE_CONFIG_DIR, settingsFile.ts) — zero bl10 overlap,
  confirmed. Flag for close-out: local-vs-origin divergence growing; owner may want to push.
T-SPACE T4: DONE (controller-completed after coordinator crash+stalls; matrix root cause corrected — needle/flag self-contradiction, fixed 28ade331d6; battery green: tui 4948/0, unit 4396/0, matrix 10/0; true baseline was 78 not 71 — 7 test/unit mirrors found by the coordinator)

- 2026-09-01: SECOND LANDING: bl10-t-space rebased --onto somersault main (18 commits, clean — seam
  regions disjoint), combined-tree gates green (typecheck, tui 5025/0, unit 4396/0), merged --no-ff
  f6a60bb07. T4 coordinator's own close-out arrived post-merge, consistent with controller record;
  root cause of duplicate-coordinator incident disclosed: SEVEN forked subagents each inheriting the
  full session context incl. "you are the Task 4 implementer" framing -> scope overrun + dist/ build
  races. MEMORY LESSON for close-out: forks inherit identity framing; dispatch workers as fresh
  agents with scoped briefs, or explicitly re-frame identity in fork prompts.
  Next: D15 combined geometry test (merge-battery debt) + T-CLICK off f6a60bb07, both in somersault.
- 2026-09-01: D15 geometry test merged (2c147cc55 via merge). T-CLICK T1 implemented 64e461201 (band+paint), reviewer running.

- 2026-09-01: SECOND MAIN REWRITE absorbed. The reforge/campaign session ran `git pull --rebase` on
  local somersault main (~03:0x), flattening my two --no-ff merge bubbles (d1494375e, f6a60bb07) and
  PUSHING the result — verified: git diff f6a60bb07..main -- CC-to-SDK/harness EMPTY (all bl10
  content byte-identical on the rewritten main); T-MENU commits on origin under ORIGINAL hashes,
  T-SPACE replayed under new hashes (88dc1394d tip family). Net loss: merge structure only. bl10
  T-MENU+T-SPACE are now PUBLIC on origin/main via that session's push (NOT mine — disclose to
  owner). Geometry test re-transplanted + merged as 5487ff750 (lesson re-applied: pipeline
  `| tail -1` masks rebase exit status — the second conflicted merge was my own chaining bug).
  Asked m2b to identify/relay the reforge session (prefer --rebase=merges while lanes land merges).
- T-CLICK T1: review Spec FAIL/Quality REJECTED — Important: band background doesn't paint under
  gutter columns ("  ⎿  " connector + "∴ " inline gutter), contradicting canon's full rectangle;
  Minor: paint tests strip SGR so they can't see it. Fixer dispatched (red-first mandated).
- m2b relayed the rebase-etiquette ask to cc-to-sdk-00/9b/a4 (reforge owner unknown). CORRECTION for disclosure: geometry merge 5487ff750 is ALSO on origin/main now (pushed by another session post-re-landing, merge commit PRESERVED this time). Running origin/main disclosure list: T-MENU commits, T-SPACE commits, geomtest merge — all bl10 content public except T-CLICK.
- Rebaser identified: cc-to-sdk-9b (reforge/campaign lane); switched to --rebase=merges going forward. Path-ownership claim recorded: reforge/, engine-ts/, ledger/, campaign spec = 9b's lane, main-side authoritative on conflict unless coordinated. Zero overlap with bl10 TUI paths. cc-to-sdk-a4 = docs-only, uninvolved.
T-CLICK T1: complete (64e461201 + gutter-paint fix 4788084eb, re-review APPROVED both mutations). NOTE: original T1 report lost with geomtest worktree removal (my cleanup error) — recreated at somersault/.doperpowers/sde/2026-08-31-bl10-t-click/; review verdicts preserved in ledger.
T-CLICK T2: complete (f144f7dcf, review PASS/APPROVED, both mutations caught; hitmap.ts verified no parallel bound needed)

- 2026-09-01: T-CLICK COMPLETE (3/3 tasks; pty cell proved the band fix in the real binary — raw
  capture shows the 48;2;70;70;70 band appearing on expand, byte-identical collapse on blank-tail
  click; docs rule flipped). Third landing: branch transplanted --onto current main (campaign lane
  had moved tip to a018edf7b; my earlier merges SURVIVED this time — 9b's --rebase=merges held),
  gates green (typecheck, tui 5038/0), merged --no-ff 9de86af69. ALL THREE TICKETS ON somersault
  LOCAL MAIN. Whole-round codex review launched (nohup-detached, foreground launch) against a
  synthetic scope branch at /tmp/bl10-review-scope (bl10-only diff re-applied on 7a8c290fa — keeps
  the three other lanes' interleaved commits out of the native review). Convergence rule from the
  round-open entry GOVERNS the fix waves that follow.
- Round review returned 4 findings (1×P1, 3×P2), ALL verified in code: P1 mcpDialog missing from
  inputOwnerRef overlay arm (present in paneOwned — the SAME class the geometry test guarded, at a
  different predicate; seamActive false in fullscreen + decision double-render); P2 silent catch->[]
  masks mcpServerStatus failure as "No MCP servers configured"; P2 keyhints enumerate whole scope
  (no-op hints advertised, cap evicts working hints); P2 unclipped MCP root labels wrap and break
  the 1-row windowing budget. Fix wave 1 dispatched (single fixer, all four, red-first each).
- Fix wave 1 landed all 4 (verified at HEAD: overlay arm :593, mcpFetchErrorText, hintActions escape hatch, root-row truncation; tui 5047/0). INCIDENT: 9b's stage-everything commits swept the fixer's uncommitted edits 3x — bl10 content rides reforge-authored commits 1cf8423e2/abf3a4542/0b3321b6b/3451b6165, mapping in 6e0882d59; relay sent asking 9b for explicit-path staging/worktrees. Re-review 1 launched on rebuilt scope branch (post-wave-1, 70 files +5034/-466).

## Re-review 1 verdicts (2026-09-01)

6 findings (1 P1, 5 P2), ALL verified real in code, all regressions-of-new-code class → wave 2 fixes all six (rule: pre-wave-3, destructive/regression = fix):
- F1 P1 CONFIRMED: resize-matrix.sh (:343 stage_content, :474 a5, :523 scrollback) + hover-cells.sh (:123 h1) stage content via `/status`, now a modal dialog. T-SPACE battery passed pre-merge only (branch lacked T-MENU's conversion); merged tree never had a green matrix. Fix = restage scripts (`! echo` local staging proven at :823) + full battery rerun.
- F2 CONFIRMED: SettingsDialog readOnlyTabBody maps ALL tabLines unwindowed → tall-write hazard on short terminals for /cost payloads. Fix = window to available rows.
- F3 CONFIRMED: commands.ts:470 had `status ?? state`; mcpDialogModel.ts:61 drops `state` → legacy "connected" renders failed. Fix = restore fallback pre-validation.
- F4 CONFIRMED by selectKeys.ts:18-22 own contract: McpDialog passes plain index + render-captured onAccept; batched stdin reads stale focus. Fix = ref-backed focus/getter.
- F5 CONFIRMED: server-tools view reuses mcpListVisibleRows(rows) despite +2 chrome rows (name, marginTop) and untruncated tool name. Fix = tools-specific budget + truncation.
- F6 CONFIRMED: Help search state → hintScope ["Help"] advertises "esc dismiss" while browser footer says "Esc to clear". Fix = hintActions override in search state.
Wave 2 sequencing: fixer A (code F2-F6, sonnet) then fixer B (scripts F1 + battery, sonnet) — sequential to avoid dist/ build race.

Wave 2A complete (fixer A, sonnet): F2 5df713990, F3 e059407a1, F4 65caa2de6, F5 b826bd410, F6 cf3dbe156. typecheck clean; test/tui 201 files / 5061 passed. F4 reclassified LATENT: bug currently masked — Ink mounts a React Legacy Root (ink/build/ink.js:59-61) so raw-stdin setState flushes synchronously between same-chunk events; fix applied anyway per selectKeys contract (regression guard against future Ink/React root change), test is guard-only not red-first. Report: somersault/.doperpowers/sde/2026-08-31-bl10-t-click/fixwave2-report.md. Fixer B (F1 scripts + battery) dispatching next.

Wave 2B complete (fixer B, sonnet): resize-matrix.sh 2b7f89a8e, hover-cells.sh 430188dcc — `/status` staging replaced with `! printf` bash-mode staging, per-site row accounting + comments re-derived against the real binary. resize-matrix GREEN on merged tree: 10 passed / 0 failed (a3 + m1-streaming skip keyless, documented). hover-cells: h2 pass; h1 FAILS on a PRE-EXISTING intent conflict — T-CLICKGATE Task 2 (bl4, f06085c8e) gates hover un-dim to clickable-stamped owners; local/bash output never qualifies (hover.test.tsx:407 documents intent; live frames byte-identical). VERDICT: not a bl10 regression → LOG tech debt at close-out (redesign h1 to hover a real tool-result block, or retire the cell). Script header now documents the expected FAIL. Wave 2 CLOSED: all 6 rereview1 findings addressed (5 fixed+tested, F1 fixed+battery-proven, h1 residue logged). Next: rebuild scope branch v3 (post-wave-2), launch re-review 2.

Scope branch v3 rebuilt (26d88a4aa, 83 files +5520/-532 vs 7a8c290fa, post-wave-2). Re-review 2 launched detached (pid 40313, gpt-5.6-sol, base 7a8c290fa) -> rereview2-findings.md; watcher btz7s6qcx. Convergence check: rule says a round of only logged-debt/dismissals converges the loop.

## Re-review 2 verdicts (2026-09-01)

4 P2 findings, all in new dialog code:
- RF1 LOG (tech debt): Settings read-only clip makes tail fields unreachable on short terminals. This is a refinement request against wave 2A's own F2 fix — per the pre-committed rule (two consecutive waves refining our own fix => hold the invariant), the invariant "body never exceeds frame budget" holds + tested; clip is safe-direction, bounded (Status fits at >=~20 rows). Debt item: navigable scrolling for read-only tabs.
- RF2 FIX: multiline MCP tool descriptions — stringWidth ignores \n while render preserves it, breaking one-row budgeting -> overflow/tall-frame replay. Destructive class.
- RF3 FIX: server-menu nav (count=1) writes clamped 0 into serverFocus -> Esc returns to root with focus reset. Real state bug in original T-MENU code, trivial.
- RF4 FIX: server-menu error/command + tool-detail description strings unbounded -> tall-frame replay on long diagnostics. Destructive class.
Wave 3 = one sonnet fixer, all three in McpDialog.tsx(+model/tests). Then re-review 3; only-log-class report converges.

Wave 3 complete (sonnet fixer): RF2 51a5b587d (flattenLabel normalizes \n/control whitespace pre-measure), RF3 0e9193e35 (server-menu movement no-op, serverFocus untouched), RF4 9c40f611d (detail views row-budgeted, MCP_DETAIL_* constants mirroring existing chrome-constant style). typecheck clean; test/tui 5065 passed / 0 failed. Concerns noted (hand-derived chrome constants; flattenLabel trims edges) — both acceptable, house style. Report: fixwave3-report.md. Next: scope v4 + re-review 3; per rule, wave 3 is done so from here only regressions-our-waves-introduced get fixed, everything else is logged.

## Re-review 3 verdicts (2026-09-01)

4 P2: 1 dismissed-as-logged, 3 fixed (all residue of our own waves — the class the post-wave-3 rule still fixes):
- RF3-1 DISMISS (already logged): Settings clip reachability = repeat of rereview2 RF1, tech-debt item stands.
- RF3-2 FIX: hover-cells h1 exits rc=1 BY DESIGN (wave 2B left it red); `npm run test:hover-cells` therefore always fails. Correct fix = flip the assertion to pin the INTENDED behavior (hover leaves local-output dimming unchanged — T-CLICKGATE gate holds in the real binary), keep band-negation half; hoverable-fixture upgrade stays tech debt.
- RF3-3 FIX: tool-detail renders currentServer.name/tool.name (+ annotations join) as raw Text — wrap/newline breaks the fixed-row accounting wave 3 added -> tall-frame replay. Flatten+truncate like other labels.
- RF3-4 FIX: fetch-reject path keeps servers=[] so subtitle says "0 servers" beside the wave-1 error text; gate the count subtitle on the error state.
Wave 4 = one sonnet fixer. Then re-review 4; only repeats/log-class converges.

Wave 4 complete (sonnet fixer): W4-1 a5cd9cfc0 (h1 flipped to positive T-CLICKGATE pin; hover-cells live run 2/2 pass exit 0, tmux clean), W4-2 49adf21b4 (tool-detail names/annotations flattened+truncated), W4-3 374927576 (subtitle gated on fetch error). Red-first tests each; typecheck clean; test/tui 5067 passed / 0 failed. Report: fixwave4-report.md. Next: scope v5 + re-review 4 = convergence check (only repeats/log-class => converge to close-out).

## Re-review 4 verdicts (2026-09-01)

2 P2 (trend 6->4->4->2, increasingly peripheral):
- RF4-1 FIX-AS-INVARIANT: server-menu (:209) + tools-view (:236) headings raw -> wrap/newline breaks row budgets (tall-frame replay = destructive). Third consecutive refinement of label-bounding (w3 tools labels, w4 detail names) -> per rule, replace with single invariant: flatten ALL MCP metadata strings at the mcpDialogModel normalization boundary (newline vector dies once, everywhere) + width-clamp the two heading sites.
- RF4-2 LOG (tech debt): expanded header's full-width band paints but click inert when body rows scrolled out of viewport (clickableOwnersOf sees no clickable body row). No content/state loss, owner gate pre-dates bl10, paint==hit invariant holds. Debt: stamp headers clickable for expanded/expandable results or widen owner derivation.
Wave 5 = single invariant fix (sonnet). Then re-review 5 as final convergence check.

Wave 5 dispatched (sonnet): flatten-at-normalization invariant in mcpDialogModel + width-clamp the two heading sites (brief: fixwave5-brief.md).

Wave 5 complete (sonnet): 31b2bf5da red tests, f731f1406 fix — flattenLabel applied inside normalizeMcpServers/normalizeTool for ALL metadata strings + both heading sites width-clamped; e758c1f12 report. typecheck clean; test/tui 5072 passed / 0 failed. Next: scope v6 + re-review 5 (final convergence check; per post-wave-3 rule only regressions-our-waves-introduced can trigger another wave).

## Re-review 5 verdicts (2026-09-02)

3 P2:
- RF5-1 DISMISS (twice-logged repeat): Settings clip reachability — tracker entry stands; reviewer now cites spec D13, noted in entry's tension line.
- RF5-2 LOG: MCP detail values clipped with no full-text route — refine-class of our own bounding waves, safe direction, data intact in model. Tracker entry added (ee2856245 + follow-up commit).
- RF5-3 FIX (wave-introduced regression, rule-mandated): PermissionsDialog:684 uniform hintActions advertises `Enter select` on Workspace where activate() no-ops for non-session rows; pre-wave-1 footer omitted it. Wave 6 = focused-row-derived hints on Workspace.
Composition: 1 repeat + 1 refine-log + 1 tiny wave-regression. Loop nearly converged; wave 6 then re-review 6 FINAL — pre-declared: findings re-litigating the clip-vs-scroll tension count as dismissals; only NEW wave-introduced regressions could extend, else converge.

Wave 6 complete (sonnet): eda7e5545 — Workspace hint focus-derived (immutable row drops select; Add-directory/session rows keep it; other tabs unchanged). typecheck clean; test/tui 5074 passed / 0 failed. Report: fixwave6-report.md. Next: scope v7 + re-review 6 (FINAL per pre-declaration).

Hash-replay note (2026-09-02): waves 2A/2B/3/4 commit hashes were rewritten by the concurrent lane's rebase (again). Content verified present on current main: wave-2A family 2f058c718..fb3f79c2f, wave-2B c67c1a774 (restage), wave-4 h1 flip 724d2e66c; flattenLabel/model + subtitle gate confirmed in working tree. Waves 5-6 hashes survive as committed (31b2bf5da/f731f1406/eda7e5545). Unit suite on merged tree: 278 files / 4420 passed, 0 failed.

## Re-review 6 verdicts (2026-09-02)

4 P2 (trend 6-4-4-2-3-4; counts flat but CLASSES converged to three recurring ones):
- RF6-1 FIX (round-introduced hint regression, 3rd site): Config-tab search state derives hints from full Settings+Tabs scopes while Select unmounted/Tabs disabled — same class as Help F6 (wave 2) + Workspace RF5-3 (wave 6). Fix as CLASS SWEEP: audit every hintScope/hintActions site for state-dependence.
- RF6-2 FIX (wave-introduced): McpDialog fetch-error message rendered unbounded (width+rows) — the ONE remaining unclipped string site; tall-frame class = destructive. Sweep for any other unbounded string renders in dialog surfaces.
- RF6-3 LOG (pre-adjudicated latent class): view-stack reads render-time `view` under batched stdin — same masking as wave-2A F4 (Ink Legacy Root flushes setState synchronously between same-chunk events; empirically proven then). Debt entry with fix direction (ref-back view like focus).
- RF6-4 FIX (wave-5-introduced): flattenLabel at normalization rewrote `name` (the identity used for React keys + view lookups) — whitespace-differing names collide, wrong server's details shown. Fix = raw name stays identity; flattened value becomes a separate display label.
Wave 7 dispatched as class-closing sweeps. Then re-review 7: per the standing rule only NEW wave-introduced regressions extend further; recurrences of these three closed classes or clip-vs-scroll relitigation = converge.

Sweep incident #4: concurrent W6/C9 lane commit 061988b8e absorbed the rereview6 latent-view-stack tracker entry (stage-everything pattern persists despite relay). Content verified at HEAD; attribution muddled only. No action beyond this note.

Wave 7 complete (sonnet): f24d8a536 W7-1 hint-state sweep (Config search + one extra: Permissions loading), 90acd9036 W7-2 unbounded-string sweep (fetch error + one extra site), d29f6c1e0 W7-3 server identity raw/label split, 2cf36b16d W7-3 follow-up tool identity (same class, my extension after the fixer's own concern flagged it — red proven by temp revert). typecheck clean; test/tui 5090 passed / 0 failed. DialogFrame dormant title-width gap logged as debt fdc722481. Report: fixwave7-report.md. Next: scope v8 + re-review 7 under standing convergence terms (only NEW wave-introduced regressions extend; closed-class recurrences or clip-vs-scroll = converge).

Cleanup (settled half): old-repo worktrees bl10-t-menu/bl10-t-space + branches removed; somersault worktree bl10-t-click + branches bl10-t-click/bl10-t-menu/bl10-t-space removed (all content verified on main earlier). /tmp/bl10-review-scope + branch + main-snapshot ref retained until re-review 7 completes (review reads that checkout).

## Re-review 7 verdicts (2026-09-02)

5 findings (P1+3P2+P3):
- RF7-1 P1 FIX (adjudication REVERSED): clip-vs-scroll, 4th raise, now with a NEW fact — fetchSettingsUsage:3114 orders formatCost AFTER formatUsage, so short-terminal clip eats /cost's entire purpose = D13 content-loss class, not imprecision. My "clip is fine" call was wrong on the D13 axis. Fix = scroll offset over the pre-rendered RenderLine[] (small, precedented by mcpWindow/browserVisibleRows idioms); DELETE the tracker's Settings-clip entry on land.
- RF7-2 FIX (round-introduced race): /status arm awaits refreshCtx BEFORE openSettings; slow getContextUsage + user opens another overlay => stacked overlay flags. Fix = open first (fetchSettingsStatus already re-measures independently per its own comment), refresh after.
- RF7-3 DISMISS-as-logged: MCP view-stack render-captured reads = rr6-3 repeat, latent (Legacy Root sync flush, empirically proven wave 2A). Tracker entry stands.
- RF7-4 OUT-OF-SCOPE (bl12 lane): settingsFile.ts config-dir write (bl12 commits cde4bbe6a/8554113f4/81fa83429) vs PermissionsDialog:108's canon-verbatim "~/.claude/settings.json" copy. Real mismatch, bl12's surface — relayed via m2b.
- RF7-5 P3 FIX (round-introduced copy bug): closeSettings appends "Config dialog dismissed." for status-family routes.
PRE-COMMITTED EXIT RULE for re-review 8: findings are dispositioned FINAL — fix only a destructive regression inside wave-8's own edits; everything else logs to the tracker; the loop CLOSES regardless of rr8's content.

RF7-4 CLOSED by the bl12/m2b lane (2026-09-02): PermissionsDialog "User settings" description now derives from settingsPath(cwd, settingsFileDeps) (display can't drift from the write path, attach included); regression cells added. PR #5 (bl14-permissions-userpath, off main @611522bf0), NOT merged — awaiting user/normal review flow. If re-review 8 re-finds it on the scope branch (which predates the PR), disposition = already-fixed-elsewhere, no action.

Wave 8 complete (sonnet): 7b53de049 W8-2 (/status opens before await), b6f19efd2 W8-3 (dismissal names actual dialog; 4 pre-existing tests using "Settings absent from frame" as close-proxy collaterally repaired to tab-strip absence), 0b2e56076 W8-1 (read-only tabs scrollable — /cost fields reachable at every geometry; tracker's clip entry DELETED as paid). typecheck clean; test/tui 5098 passed / 0 failed. Report: fixwave8-report.md. Next: scope v9 + re-review 8 — dispositions FINAL per the pre-committed exit rule.

## Re-review 8 verdicts (2026-09-02) — FINAL DISPOSITIONS per the pre-committed exit rule

5 P2:
- RF8-1 LOG: advisor_tool_result rows stamp clickable but never expanded/band (toolRenderer:951) — T-CLICK parity gap, not wave-8; advisor rows keep pre-band click behavior. Tracker.
- RF8-2 FIX (destructive regression INSIDE wave-8's edit — the one class the exit rule fixes): readOnlyScrollWindow's end-loop breaks when one logical line's wrapped cost exceeds the budget → that line renders at NO offset, permanent content loss. Verified at SettingsDialog.tsx:169-173.
- RF8-3 LOG: expanded gutter-block paints band bg on first gutter row only — paint discontinuity, hit still functional; T-CLICK class, not wave-8. Tracker.
- RF8-4 LOG: subtitle shows "0 servers" while loading (servers undefined) — transient mislabel, wave-4 residue class. Tracker.
- RF8-5 LOG: count===1 views advertise navigate/page hints — hint-accuracy class edge. Tracker.
LOOP CLOSED. After RF8-2's fix lands: no further review (per the rule), cleanup + ledger closure + final report.

Wave 9 complete (sonnet, the exit rule's one mandated fix): 2a30510e9 — readOnlyScrollWindow claims an oversized line (end=start+1 + oversizedRows) and readOnlyTabBody paints its head + truthful marker. Red-first; typecheck clean; test/tui 5101 passed / 0 failed. Fixer residuals: segments-path latent (no caller emits segments on these tabs) + maxOffset overshoot when the LAST line alone is oversized (blank trailing offset, line still reachable at its own offset) — both imprecision, LOGGED. REVIEW LOOP CLOSED: 9 codex passes, 9 fix waves, 26 findings fixed, 10 logged, 1 closed by bl12 lane (PR #5).

## ROUND CLOSED (2026-09-02)

Close-out complete: spec v3 (§8 retrospective + revision notes, status v3), coverage.md bl10 bullet, tui-ux.md bl10 narrative, tech-debt tracker (10 bl10 entries; Settings-clip entry PAID by wave 8; bl9 D21 pointer deleted), memory bl10-round-shipped.md + MEMORY.md index, all tallies corrected to final (9 codex passes / 9 waves / 26 fixed / 10 logged / 1 closed by bl12). Cleanup: ticket worktrees+branches removed both repos; /tmp/bl10-review-scope worktree + branch deleted. Final battery: unit 4420/0, tui 5101/0, resize-matrix 10/0, hover-cells 2/2, t-click pty cell — all green on the assembled main. NOT pushed by this session; T-MENU/T-SPACE/geomtest content public on origin/main via other lanes' earlier pushes; waves 1-9 + close-out docs local at closure.
