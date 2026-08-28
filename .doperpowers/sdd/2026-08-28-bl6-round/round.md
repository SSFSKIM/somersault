# bl6 round — attach first-frame race + expanded-cluster absorbed blocks

OPENED 2026-08-28. Owner approved shape: two tickets + one stretch, same pipeline as bl4/bl5
(research → spec+plans → pre-execution adversarial plan review → parallel worktree tickets with
per-task review → sequential --no-ff merges with full gates → whole-round codex review → fix waves →
close-out). Canon for the round: installed Claude Code **2.1.250** at
~/.local/share/claude/versions/2.1.250 (Mach-O 64-bit arm64, 206,479,552 bytes — python mmap
offset-find + windowed extraction, NEVER grep -o). NOTE canon moved 2.1.246 → 2.1.250 since bl5;
every prior cite must be re-located.

## Tickets
- **T-ATTACH** (harness correctness bug): `ccx attach` drops the FIRST frame pushed after a fresh
  attach — follow() establishment race in the attach transport. Discovered bl5 T-LINKOPEN Task 4;
  reproduced 3/3; workaround = warmup sentinel loop in harness/scripts/linkopen-cells.sh:119-140.
  Suspect surface: src/cli/attach.ts, src/host/server.ts, src/host/wire.ts (follow establishment).
- **T-CLUSTER** (renderer parity, bl2's replacement ticket): canon's expanded running cluster
  renders absorbed content kinds ccx omits — absorbed `<TS…` user/attachment messages, absorbed
  thinking blocks, PreToolUse hook block, relevant memories (bl2 cites at 2.1.236 bundle
  L531531–531542, STALE — re-locate in 2.1.250). ccx's `expandedMemberItems` walks tool memberIds
  only; the thinking half has a direct ccx analogue (`thoughtForMs` accumulator).
- **D8 stretch** (build only if canon re-verify shows stable shapes): new canon clickable kinds
  `collapsed_read_search`, `goal_status` attachments with reason, advisor results.

## Log
- Research dispatched: R-ATTACH (repo diagnosis + repro) and R-CLUSTER (2.1.250 canon extraction +
  D8 recon), parallel opus agents. Reports → research-attach.md / research-cluster.md in this dir.
- R-ATTACH complete (report research-attach.md). PREMISE FLIP (bl5's lesson recurs — a parked
  item's title encoded a wrong premise): the first-frame drop is NOT a production attach-transport
  bug. The real host replays buffered frames on follow (SessionHost.follow drains TurnBuffer before
  registering, src/host/host.ts:730-772) and the client backlog drops nothing; the loss lives in the
  pty drivers' stand-in host — fake-host.mjs pushes into an empty `followers` set with no buffer
  (fake-host.mjs:119-126,153-166). Race window measured ±30ms around the follow op; the drivers'
  "mode on" readiness signal is not ordered after follow. Recommended fix: ~6-line replay-on-follow
  in fake-host.mjs (replay:true frames) + an integration test pushing before connect (working
  throwaway repro at $CLAUDE_JOB_DIR/tmp/bl6attach/node-repro.mjs: red today, green with replay) +
  DELETE warmup_follow from linkopen-cells.sh. T-ATTACH therefore shrinks to a test-infra ticket;
  round's main weight shifts to T-CLUSTER. Verify the host-side replay claim during spec authoring.
- R-CLUSTER complete (report research-cluster.md, 2.1.250 offsets). Q1 CONFIRMED w/ corrections:
  expansion branch 177043425-177044786; four absorbed kinds, fixed order; tag is <task-notification>
  (not <TS…); expansion REPLACES the collapsed row (ccx already matches); task-notification
  absorption is focus-mode-only (out of reach). Thinking row = ∴ gutter + full body dim markdown,
  NO duration. Membership by adjacency (v2n 162017418). Q2 D8: STABLE-BUILDABLE (predicate
  177230933, byte-identical across .247/.248/.250; click = in-place expand toggle) but goal_status/
  advisor reachability via SDK unverified. Q3: bl5 link-gate + sniffer UNCHANGED in 2.1.250.
- SCOPE SET: T-ATTACH = fake-host replay-on-follow + red-green integration test + delete
  warmup_follow (production untouched; rewound-window replay gap + follow-established signal →
  backlog). T-CLUSTER = retain absorbed thinking bodies in FoldGroup + interleave-by-sequence
  expansion (∴ dim markdown, no duration) + pty cell. Hook block / memories / goal_status / advisor:
  probe-gated, DEFERRED past bl6 (weekly cap exhausted until Aug 31; declared≠reachable discipline).
- Spec v1 committed 91e6df67b8 (docs/superpowers/specs/2026-08-28-bl6-attach-cluster-design.md).
- Plans committed 892aeef03b (t-attach 3 tasks, t-cluster 4 tasks; T-ATTACH merges FIRST — A4 dep).
- Pre-execution adversarial plan review launched (codex-companion 7.65.0 with-effort xhigh,
  gpt-5.6-sol; stderr → $CLAUDE_JOB_DIR/tmp/bl6-planreview.events.log).
## Plan review round (pre-execution)
3 findings, all high. ADJUDICATED: F1 ACCEPTED (t-attach test invented a positional socket arg;
fake-host derives from CCX_FLEET_ROOT/hostSocketPath(pid), prints SOCKET=, needs dist/ — §2.2
rewritten, loud-skip guard + mandated build); F2 ACCEPTED (pre-run `pending` accumulator gates on
ms>0 at toolFold.ts:556 — bodies must ride clock-independent + mandatory production-pipeline test
cell; the exact tests-pass-wiring-dead mode of prior rounds); F3 PARTIALLY ACCEPTED (premise
refuted: 0 combined [thinking,tool_use] entries / 13,781 thinking entries across 12 recent real
transcripts — ordinal machinery rejected, free equal-key tie-break adopted). Spec v2 + amended
plans committed 4e9c65b8fc (D10-D12).
## Execution
- Worktrees cut from 4e9c65b8fc: .claude/worktrees/bl6-t-attach, bl6-t-cluster. TASK BASE both
  = 4e9c65b8fc. Skill scripts at doperpowers 7.65.0 subagent-driven-execution.
- T-ATTACH Task 1 (fake-host replay + red-green integration) and T-CLUSTER Task 1 (fold-model
  retention incl. pending extension) dispatched in parallel, sonnet implementers.
- T-ATTACH Task 1: complete (e6fb091167, review clean — spec PASS, quality Approved; 3 mutations:
  2 red [replay-stamp strip; drain revert — reproduced the implementer's exact red signature],
  1 silent [drain-on-every-follow indistinguishable in any single-connection test — pre-existing
  file-wide gap, rated Minor/informational]). MINOR ROLL-UP: multi-connection second-follow
  coverage gap in fake-host tests — tech-debt note, surface at whole-round review.
- T-ATTACH Task 2: complete pending review (1be6bb84f2) — 3 idle + 1 loaded pty runs all cells PASS
  sentinel-free. NOTE: research-attach.md's claim of a select-pty.sh stream-shift drop-tolerance did
  NOT verify (implementer grep/read: no such logic in select-pty.sh or hover-cells.sh) — research-doc
  claim corrected here, files untouched. Reviewer dispatched w/ fresh run + feature-kill mutation
  (revert replay buffer → cells must fail).
- T-ATTACH Task 2: complete (1be6bb84f2, review clean — spec compliant, quality Approved; reviewer's
  own fresh pty run 3/3; feature-kill mutation [replay buffer reverted] failed 3/5 runs (~60%) —
  cells PROVEN dependent on the replay contract, race confirmed probabilistic; recorded per reviewer
  recommendation). Research select-pty tolerance claim did not verify (independently re-confirmed).
- T-ATTACH Task 3 (verify): PASS — typecheck clean, unit+tui suites exit 0 on branch, diff = exactly
  fake-host.mjs + linkopen-cells.sh + host-client.test.ts, zero src/ files. TICKET COMPLETE.
- T-ATTACH MERGED to main --no-ff as 1f78cd9c5c. Assembled-tree gates: typecheck clean, tui
  4710/4721 (11 gated skips); unit first pass 4014/4015 (1 unidentified failure, name not captured),
  IMMEDIATE full rerun 4015/4015 green; imageCodec-encode standalone 2×17/17 — consistent with the
  pre-existing tracked flake, watch at next gate.
- T-CLUSTER Task 1: complete (affa569316, review clean — spec PASS, quality Approved; 4/4 mutations
  RED incl. the optional breaker-preserve check [caught by implementer's own bonus test];
  foldAtoms test-only export judged acceptable — production calls it directly at all 3 sites).
- T-CLUSTER Task 2: complete pending review (6720327fde) — implementer killed by a usage-limit
  outage AFTER finishing (commit + report on disk, foreground tui 4716/4727 recorded in report, but
  final status never delivered; agent record unrecoverable, resume attempts NO-OP'd). Reviewer
  dispatched with instructions to treat every report claim as unverified and reproduce them; full
  test:tui re-gate deferred to the merge gate. Report concerns to adjudicate: untested equal-key
  tie-break (D12 robustness); bare-bones synthetic message in thinkingRowItems.
- T-CLUSTER Task 2: complete (6720327fde, review clean — spec PASS, quality Approved NO findings;
  4/4 mutations RED incl. optional expanded-flag drop; both report concerns adjudicated acceptable
  [D12 tie-break robustness; bare-bones synthetic message mirrors projectMessageEntry precedent];
  reviewer independently reproduced the orphaned report's claims per outage protocol).
- main merged INTO bl6-t-cluster as ab30d42e53 (Task 3's pty cell needs T-ATTACH's fake-host replay
  contract in-branch; disjoint files, clean merge). Task 3 (pty cell, thinkcluster producer,
  sentinel-free first push) dispatched.
- T-CLUSTER Task 3: complete (e227751f9e, review clean — spec matches, quality Approved no findings;
  reviewer 2 fresh PASS runs + feature-kill mutation FAILED the cell as required + post-restore
  PASS; click-routing concern adjudicated adequate [link-before-fold is deliberate bl5 behavior,
  wait_for_capture re-polls live]).
- T-CLUSTER Task 4 (verify, controller-run): ALL PASS — typecheck clean, unit 4015/4015, tui
  4716/4727 (11 gated skips) on branch; A3/A4 evidence cross-checked; membership-parity note written
  (divergence recorded: ccx lacks canon's signed-thinking flush — follow-up candidate with the
  deferred probe wave). TICKET COMPLETE. (Chained gate invocation died once with exit 144, no
  output — re-run individually, all green; transient.)
- T-CLUSTER MERGED to main --no-ff as 6350a6d2cd. Assembled-tree gates: typecheck clean, unit
  4015/4015, tui 4716/4727 (11 gated skips); BOTH pty matrices re-run on assembled tree:
  cluster-expand 1/1 PASS, linkopen 3/3 PASS. Both tickets merged.
- Whole-round codex review launching (--base 68eea02350ce2bc9f1124576133412025aaf6bf4, gpt-5.6-sol).
## Whole-round review (base 68eea02350)
ZERO findings on the first pass ("No actionable defects were found in the replay or fold-expansion
paths"). No fix wave. Campaign 0->0.
- Close-out: parity blocks + spec retrospective committed c781d6bbed; memory bl6-round-shipped
  written + MEMORY.md indexed; worktrees/branches cleaned. ROUND CLOSED 2026-08-29 (not pushed).
