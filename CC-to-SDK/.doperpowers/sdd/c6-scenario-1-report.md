# C6 scenario ① — real-work lifecycle (spawn → worktree work → resume-edit → reply → finalize → retire → ccx resume/rm)

**Verdict: PASS** (run 2026-07-29, driver `$CLAUDE_JOB_DIR/tmp/acc-c6-lifecycle.mjs`, keyed via
`CLAUDE_CODE_OAUTH_TOKEN`; `ANTHROPIC_API_KEY` unset). Spec: scenario ① rev 3. All observables below
are verbatim from the passing run; the scripts were **not modified** (md5 line at the end).

## Rig preamble (Task 2 smoke, same rig)

- Shim: `claude` → `node harness/dist/cli/bin.js` on PATH (the roadmap's "CLAUDE_BIN override" does
  not exist in the scripts; the shim is the mechanism).
- Smoke: `daemon-list.sh` → `(no daemons)`; `claude agents --json --all` via shim → `[]`; 11 script
  md5s stable.
- Rig adaptation (the rig bends to the scripts): `_lib.sh` metas are **flat JSON at
  `$DAEMON_HOME/<uuid>.json`** (no subdir, JSON not key=value); replies at `<uuid>.reply.txt`.
- Env pins per spec: temp `CCX_FLEET_ROOT` + `DAEMON_HOME`, `DAEMON_BOOT_ID=c6-run`,
  `DAEMON_TIMEOUT=600`, `ANTHROPIC_BASE_URL`/`CLAUDE_JOB_DIR`/`CLAUDE_CODE_SESSION_ID`/
  `CLAUDE_CODE_CHILD_SESSION`/`CLAUDE_CONFIG_DIR` affirmatively unset/default.

## Evidence

| step | observable |
|---|---|
| 1. spawn output (head) | `daemon spawned: c6a  [608cb14d / 61f4d2f5-1a9a-456f-9330-f70a05d8d706]  state=done  worktree=…/c6repo-z0E25f/.claude/worktrees/c6wt (branch worktree-c6wt)  (visible in 'claude agents')` |
| 1. spawn wall-time | 24s (blocking spawn, first turn complete) |
| 2. worktree file/branch | `hello.txt="C6-REAL-WORK"` branch=`worktree-c6wt` status=CLEAN (worker committed) |
| 2. meta.model (scripts' record) | `claude-haiku-4-5-20251001` (the arg, recorded verbatim) |
| 2. RESOLVED model (transcript) | `claude-sonnet-4-6` — see "Model note" below |
| 3. resume output (head) | `daemon resumed: c6a  [655698ec / 61f4d2f5-…]  status=idle  turns=2  current=dde85bd3-8744-44bb-9151-4a03593754b7` |
| 3. uuid stable / current forked | stable uuid unchanged; `current` = fresh fork uuid |
| 3. superseded roster row | original uuid absent from `claude agents --json --all`, current present (shape-agnostic JSON scan) |
| 3. edit landed | `["C6-REAL-WORK","C6-EDITED"]` (worker committed the edit) |
| 4. reply | non-empty, real text, not a limit banner (head: `c6a  [61f4d2f5-…]  status=idle  turns=2`) |
| 5. finalize | `noop` (blocking watchers already finalized — spec rev 2 expectation confirmed) |
| 6. retire purge | `purged c6a [61f4d2f5-…] from registry (session transcript left intact; resume with: claude --resume 61f4d2f5-…)  NOTE: work is on branch worktree-c6wt — merge or remove its worktree yourself.` meta/reply gone; worktree present |
| 7. ccx --resume <current> from worktree | REPL loads, replayed conversation shows the task content; clean exit |
| 7a. rm on post-resume fork row | exit 0, row deregistered, worktree untouched (fork rows carry no worktree linkage — `daemon-resume.sh` forks without `--worktree`) |
| 7b. dirty-keep arm (never-resumed row c6b) | `ccx: kept worktree …/c6wtb — it has uncommitted changes; e1e53a19 is deregistered, the files are untouched` — exit 0, worktree present |
| 7c. clean-delete arm (never-resumed row c6c) | worktree gone after `ccx rm` |
| 8. md5 integrity | **all 11 scripts unchanged** before and after the scenario |

## Notes

- **Model note (not a defect):** `daemon-spawn.sh` hardcodes `--permission-mode auto`; our shipped
  auto-gate (`config/autoModel.ts`, probe-18d-grounded) overrides non-auto-capable models, so the
  haiku 5th-arg pin resolves to `claude-sonnet-4-6` inside ccx while the scripts' meta records the
  arg. Deliberate incr-10 behavior meeting the scripts' hardcoded flag.
- **Upstream candidate (consumer's, recorded for the spec's Surprises):** the retire-purge resume
  hint names the **stable** uuid (`61f4d2f5…`), but after any resume the daemon's latest
  conversation is the fork (`dde85bd3…`) — the hint resumes a stale pre-fork conversation.
- **Driver iterations (driver bugs, not harness defects):** (1) addressing the daemon by the
  spawn-time short after a resume fails `_find_daemon` (meta's `short` is updated to the fork's) —
  the scripts' convention is the stable uuid; (2) the original ①.7 "dirty rm refuses" expectation
  was a spec error, corrected in rev 3 (see spec Revision Notes).
