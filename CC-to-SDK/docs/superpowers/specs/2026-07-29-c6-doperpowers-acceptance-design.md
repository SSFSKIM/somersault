# C6 — Doperpowers End-to-End Acceptance (design)

**Stage C6 of the clone roadmap** (`docs/parity/clone-roadmap.md` §C6) — the final stage. The roadmap's
primary metric is binary: *do unmodified doperpowers daemon scripts run on our binary?* C6 is that
metric **actually run, with real work flowing** — an acceptance stage, not a build stage. It ships no
planned features; it ships evidence, plus fixes for whatever defects the integrated runs surface.

## Purpose

Every prior acceptance run (A1 2026-07-26, the resume-half and finalize-arms runs 2026-07-26/27 —
recorded in `2026-07-26-clone-process-surface-spine-design.md` § Outcomes) proved the **state machine**
of the doperpowers contract under a rate-limited account or a stalled transport: no turn ever produced
real model work, no worker ever parked on a question, and `daemon-retire.sh` / `daemon-mark.sh` never
appeared in a PASS table. C6 closes exactly those gaps:

1. **Real work** — a worker writes actual code in an actual worktree, across a fork-resume.
2. **The park seam** — a worker blocks on `AskUserQuestion`, the scripts see and render it, a human
   answers through `ccx attach`, and the turn completes. This exercises Goal B's seam under the
   unmodified scripts for the first time (the `blocked` state was dead code against ccx at A1 time;
   `host.ts` now live-reports `{state:"blocked", status:"idle", waitingFor}`).
3. **`daemon-retire.sh` and `daemon-mark.sh`** — the two scripts never yet exercised.
4. **The content layer** — the porting doc's acceptance test ("Let's make a react todo list" →
   `brainstorming` auto-triggers in a clean session), scored as **parity against the real `claude`**,
   because the doperpowers fork removed the SessionStart bootstrap and triggering now rides Claude
   Code's native skill surfacing — a clone owes what the original does, not what upstream's retired
   design promised.

Not in scope: feature work of any kind; new vitest suites (unless a defect fix needs a guard test);
fixing doperpowers' own bugs (recorded for upstream instead — the `stopped`-poller mismatch precedent).

## The contract under test

The eleven scripts of `doperpowers/7.25.0/skills/orchestrating-daemons/scripts/` (`_lib.sh`,
`_codex_lib.sh`, `daemon-{spawn,resume,reply,list,mark,finalize,retire}.sh`, `codex-{spawn,resume}.sh`),
**unmodified**: md5 all eleven before and after every scenario; any drift is an automatic FAIL of the
whole scenario. (`codex-*.sh`/`_codex_lib.sh` are md5'd for integrity but not driven — they target the
codex engine, not `claude`.)

## Scenarios

Four focused, independently re-runnable scenarios (Decision Log #1). Each gets its own driver in
`$CLAUDE_JOB_DIR/tmp/`, reusing the proven `acc-lib.mjs` + `ptyrun.py` rig, and a verbatim evidence
report in `.doperpowers/sdd/` (the A1 convention). Model policy (user-confirmed): **haiku**
(`claude-haiku-4-5-20251001`, via `daemon-spawn.sh`'s 5th positional `model` arg) for scenario ①–③
workers — the process contract does not depend on model quality; **the default model on both binaries**
for scenario ④ — skill-triggering *is* model-quality-dependent and the baseline must be like-for-like.

### ① Real-work lifecycle (spawn → work → fork → finalize → retire purge)

The gap: no prior run ever verified a worker's *work product*.

1. In a throwaway git repo, `daemon-spawn.sh <name> "<task that writes a specific file with specific
   content AND commits it>" <cwd> <wtname> claude-haiku-4-5-20251001`. The commit instruction is
   load-bearing: `ccx rm`'s clean-delete (step 7) only fires on a clean worktree, and an untracked
   file is dirt.
2. **PASS requires the file to exist inside `<repo>/.claude/worktrees/<wtname>` on branch
   `worktree-<wtname>` with the demanded content** — real work, in the worktree, not the repo root.
3. `daemon-resume.sh` with a follow-up task that *edits* that file. PASS: stable daemon uuid unchanged,
   fresh session uuid, superseded roster row purged (the fork contract), and the edit landed.
4. `daemon-reply.sh` returns the actual reply text (not a limit banner — the first time this is
   possible).
5. `daemon-finalize.sh` prints **`noop`** — the blocking spawn/resume watchers already recorded the
   reply and finalized the meta to `idle`, so there is nothing left to finalize. (The `done`→`idle`
   arm itself was closed in A1's record; ① does not need to re-reach it, and expecting `idle` here
   would be unobservable.)
6. Snapshot the meta's `current` uuid **before** retiring (purge deletes the meta, and
   `daemon-retire.sh`'s printed resume hint names the **stable original** uuid — stale after any
   fork, since the fork purged that session's transcript; candidate upstream finding). Then
   `daemon-retire.sh <id> purge`: registry files (meta/reply/err) gone, the **worktree deliberately
   left in place** with the script's "merge or remove its worktree yourself" NOTE printed (the script
   never auto-deletes worktrees), and the transcript still resumable — `ccx --resume <current-uuid>`
   run **from the worktree** (resume is cwd-scoped, and the worktree is the daemon's cwd) loads the
   conversation.
7. Then **our** contract closes the loop, as actually shipped (rev 3). Three arms:
   **(a) post-resume row:** `daemon-resume.sh` forks with `--bg --resume` and **no `--worktree`**, so
   the fork's roster row carries no worktree linkage — `ccx rm <fork-short>` exits 0, deregisters the
   row, and leaves the worktree untouched (worktree cleanup after a resume is manual, agreeing with
   the script's own "merge or remove its worktree yourself" NOTE).
   **(b) dirty-keep arm** (on a never-resumed worktree'd worker): dirty the worktree with a scratch
   file → `ccx rm` exits 0, **deregisters the row, keeps the worktree** and prints the
   `kept worktree … uncommitted changes` notice — it does NOT refuse; `lifecycle.ts` documents this
   as deliberate because doperpowers' purge routine *purposely* dirties worktrees
   (`.daemon-turn-live` sentinel) so `rm` preserves the checkout later turns run in.
   **(c) clean-delete arm** (on another never-resumed worktree'd worker): retire purge → `ccx rm` →
   worktree gone.

### ② Park-and-answer (the roadmap's "spawned into a worktree, parked, answered, and resumed")

**Pre-probe first (live-probe-first discipline).** The blocked-reply renderer's `AskUserQuestion` arm
needs the assistant `tool_use` to be **on disk mid-turn**, and probe 62 proved the engine does not
write the transcript mid-turn for an ordinary tool call. Whether it *flushes at an AskUserQuestion
park* is unknown. So ② opens with a probe (`probes/probes/NN-transcript-at-park.ts`): park a session
on `AskUserQuestion`, read the on-disk transcript, record whether the question's `tool_use` is
present. The probe's answer decides which renderer arm the PASS chain asserts — the question text
(flushed) or `_lib.sh`'s harness-prompt marker (not flushed). Both are recorded outcomes, not
failures; only an *empty* recorded reply is a FAIL.

**The chain, corrected against the actual finalize code** (`status=="idle" && state=="blocked"` is
normalized to `done-blocked` → records the blocked-shape reply, finalizes the meta, prints `idle` —
ccx's park row is exactly that shape, `{state:"blocked", status:"idle"}`, so `live`-on-park is
unobservable against ccx; `live` requires `status:"busy"`, i.e. mid-turn before the park):

1. Spawn a **worktree'd** worker (`--no-wait`) whose task instructs it to ask the human a question
   via `AskUserQuestion` before proceeding.
2. While the turn is still working: `daemon-finalize.sh` prints `live` (the mid-turn arm, meta
   untouched) — asserted on the way, cheap.
3. `claude agents --json --all` (ccx via the PATH shim) shows the row reach
   `{state:"blocked", status:"idle", waitingFor}`.
4. `daemon-finalize.sh` on the parked worker prints **`idle`**: the blocked-shape reply is recorded
   (question text or marker, per the probe) and the meta finalized. A second call prints `noop`.
   *Pre-registered consumer semantic, not a defect on either side:* doperpowers treats blocked+idle
   as "session over, resumable-or-attachable" (its own renderer text says "Resume with an
   answer/instruction … or 'claude attach'"); a ccx park is additionally still **live** — the same
   session can be answered in place. A superset, aligned with the consumer's own guidance.
5. `daemon-reply.sh` returns that recorded blocked reply — actionable, never empty.
6. **Leg A — attach-answer (the Goal B seam):** `ccx attach <short>` renders the parked question;
   answering interactively releases the turn; detach; the roster row reaches `state:"done"`.
7. **Leg B — the scripts' own answer path, on a second parked worker:**
   `daemon-resume.sh <id> "<answer>"` — the consumer's documented route for a blocked daemon: stops
   the parked turn (ccx records the terminal state before the interrupt releases the park — the
   probe-63 ordering), forks with the answer as the new turn, the fork completes with a reply that
   reflects the answer, and the superseded parked turn is purged. This is the roadmap's "resumed".
8. Stretch (only if cheap after both legs pass): the permission-prompt park variant, exercising the
   renderer's marker arm deliberately rather than as the probe-determined fallback.

### ③ Retire/mark edges

1. On a finished (`done`) daemon: `daemon-mark.sh <id> awaiting-human "escalated: test note"` →
   `daemon-list.sh awaiting-human` (the script's status filter) lists exactly that row. The note is
   asserted via `daemon-mark.sh`'s own echo and the meta file — `daemon-list.sh` never renders notes
   (it builds rows from updated/name/short/status/engine/turns/reply only).
2. `daemon-retire.sh <id>` (no purge): prints `retired … (still resumable: …)`, meta `status=retired`,
   registry files kept, transcript resumable.
3. `daemon-retire.sh <id> purge` on a second daemon: registry files (meta/reply/err) deleted.

### ④ Content-layer parity ("Let's make a react todo list")

1. **Baseline first**: real `claude` CLI, clean session, throwaway project dir, default model, the
   exact prompt `Let's make a react todo list`. Record whether `brainstorming` auto-triggers **before
   any code is written** (observable: the skill invocation appears in the transcript/TUI, and no code
   files exist in the project dir at that point).
2. Same run on `ccx`.
3. **PASS = parity**: ccx matches the baseline. Both-positive is the strong pass; both-negative is
   recorded as *vacuous-but-parity* (the fork removed the bootstrap; a both-negative outcome is
   upstream's regression, not ours). ccx-negative/real-positive is a FAIL and becomes a defect.
4. Both runs drive the REPL through the pty rig; the transcript is the evidence. The evidence report
   records each side's **resolved model** (ccx's default is opus-4-8 via `resolveOptions`; the real
   claude's default may differ — "default on both" means each binary's own default, and the recorded
   pair contextualizes any divergence) and confirms both binaries surface the **same doperpowers
   7.25.0 skills** through the same settings sources before the prompt is sent.

## The rig

All previously proven, reused as-is:

- **PATH shim**: a temp dir with `claude` → `node <repo>/CC-to-SDK/harness/dist/cli/bin.js`, prepended
  to `PATH`, so the unmodified scripts' `claude` calls resolve to ccx (the A1 technique). (The
  roadmap's C6 line mentions "the `CLAUDE_BIN` override" — no such knob exists in any of the eleven
  scripts; the PATH shim is the real, proven mechanism. The close-out fixes the roadmap line.)
- **`CCX_FLEET_ROOT`** at a temp dir — the real fleet is never touched.
- **`DAEMON_HOME`** at a temp dir — `_lib.sh` defaults the scripts' registry to
  `$HOME/.claude/orchestrating-daemons`, the user's **real** daemon registry; unpinned, every
  scenario would write metas into it and ③'s list assertions would read live daemons. The override
  is explicitly supported "for tests".
- **`DAEMON_TIMEOUT`** bounded (600 s) — the default is 18000, and a wedged worker would hold a
  blocking driver for hours.
- **`ANTHROPIC_BASE_URL` affirmatively unset** — the finalize-arms run stalled the transport through
  it; a leftover would silently re-create that rig.
- **`CLAUDE_CONFIG_DIR` left at default** — `_lib.sh`'s transcript reader hardcodes
  `$HOME/.claude/projects`, so config-dir isolation would break every transcript-reading script.
  Accepted consequences, documented rather than isolated: session transcripts land in the real
  `~/.claude/projects` (cleaned up by the driver at scenario end), and `_session_purge`
  unconditionally `rm -rf`s `$HOME/.claude/jobs/<short>` — the real jobs dir; shorts are random
  8-hex, so a collision with a live Claude Code job id is negligible (~2⁻³²) but is on record.
- **Env scrubbing** in every spawn path: `CLAUDE_JOB_DIR`, `CLAUDE_CODE_SESSION_ID`,
  `CLAUDE_CODE_CHILD_SESSION` (the A1 job-adoption trap — we run from inside a Claude Code session).
- **`DAEMON_BOOT_ID`** pinned to a constant for the whole run (macOS `kern.boottime` drifts a second
  or two; unpinned, `_lib.sh`'s host-identity gate can declare its own daemon foreign and silently
  skip purge).
- **Credentials**: OAuth token from `CC-to-SDK/.env` (`CLAUDE_CODE_OAUTH_TOKEN`); `ANTHROPIC_API_KEY`
  stays unset. Never print either.
- **pty disciplines** (C5's lessons, verbatim): settle after every frame change before the next key;
  never wait on a phrase the submitted prompt contains — wait on real disk state or a marker only the
  model emits; `--bg` hosts end after their one prompt, so interactive halves use the process the
  script actually spawned.
- Leftover-process hygiene: before and after each scenario, kill only *our own* stray `ccx` hosts
  (identified by the temp `CCX_FLEET_ROOT` in their argv), never by name.

## Defect policy

Findings triage exactly as A1's:

- **Ours** → a fix task (sonnet implementer + fresh sonnet reviewer per the SDD loop), a guard test
  where the teardown-liveness pattern applies (sabotage-verified: revert the fix, watch it fail,
  restore), then re-run the affected scenario only.
- **The consumer's** (doperpowers' own — e.g. the known `stopped`-poller mismatch) → recorded in this
  spec's Surprises for upstream; never worked around by editing scripts.
- **Environmental** → documented in the evidence report.

## Close-out

The final task updates `docs/parity/clone-roadmap.md` (§C6 marked shipped with a pointer here, plus
the roadmap's closing status — C1–C6 all shipped), refreshes `docs/parity/coverage.md` where the
acceptance settles rows, writes this spec's Outcomes tables from the verbatim reports, and updates the
project memory.

## Acceptance (behavior-phrased summary)

- Scenarios ①–④ each end in a PASS table with verbatim evidence, all script md5s unchanged.
- Any FAIL is either fixed-and-rerun (ours) or recorded for upstream (theirs) — no silent skips.
- The roadmap's C6 section reads shipped, with this spec as the record.

## Decision Log

1. **Scenario matrix over one grand scenario over vitest-first** (user-confirmed). A grand
   single-narrative run is closest to real usage but one flaky pty step invalidates the whole chain
   and every fix re-runs everything on real usage; vitest-first builds infrastructure the parity
   baseline (driving the *real* claude binary) can't live in anyway. Four re-runnable scenarios
   isolate failure and match how A1/A2/Goal B/C5 acceptance actually succeeded.
2. **Content-layer PASS = parity vs the real claude, not an absolute trigger bar** (user-confirmed).
   The doperpowers fork removed the SessionStart bootstrap; holding ccx to "must trigger" would hold
   the clone to a standard the original may no longer meet. Rejected: absolute bar (fails on upstream
   regressions we don't own); skipping the test (the roadmap names it, and the substrate proof alone
   doesn't cover triggering).
3. **Haiku workers / default-model content runs** (user-confirmed). Rejected: default everywhere
   (spends subscription usage where the contract is model-independent); haiku everywhere (risks a
   vacuous both-negative on scenario ④, since triggering is model-quality-dependent).
4. **Pure acceptance scope** (user-confirmed). Rejected: folding in hardening tail items (dilutes the
   binary metric); minimal re-run without park/answer and content (leaves the roadmap's own C6 text
   unmet).
5. **Controlled track** (user-confirmed): spec → plan → subagent-driven execution, controller runs
   keyed live halves — the shape that shipped every prior stage.

## Surprises & Discoveries

- (pre-registered from exploration) The A1-era memory understated the proven surface: the spine spec's
  Outcomes show `daemon-finalize.sh`'s `live`/`absent`/`error` arms were closed on 2026-07-27 via the
  stalled-transport technique. C6's gap analysis was corrected against the spec, not the memory.
- (pre-registered, caught in spec self-review) `daemon-retire.sh` **never deletes worktrees** — it
  prints a "merge or remove its worktree yourself" NOTE by design. The design's first draft wrongly
  assigned worktree deletion to retire-purge; it belongs to *our* `ccx rm` clean-delete contract, now
  scenario ①.7.
- (rev 2, independent spec review) The reviewer's central catch: **the first draft's ② chain was
  unobservable** — it expected `live` on a parked worker, but `daemon-finalize.sh` normalizes ccx's
  park shape (`state:"blocked", status:"idle"`) to `done-blocked` → prints `idle` and finalizes.
  Both facts were already in this project's own records (the Goal-B-mandated row shape; probe 62's
  transcript-not-written-mid-turn) and the draft cited one of them while contradicting it. Same
  review also caught: ①.5's `idle` expectation unreachable after blocking watchers (→ `noop`);
  `DAEMON_HOME` unpinned (real registry pollution); the stale stable-uuid resume hint after a fork
  (candidate upstream finding); `daemon-list.sh` never rendering notes; the missing
  commit-for-clean-worktree precondition; and the scripts' `daemon-resume.sh <id> "<answer>"` path
  being the roadmap's actual "resumed" (now ② Leg B).
- (Task 1, probe 69) **Verdict: FLUSHED** — unlike probe 62's ordinary mid-turn tool calls, an
  `AskUserQuestion` park DOES flush the pending assistant `tool_use` block to the on-disk transcript:
  sampled ~0.5s into an 8s park hold, the session `.jsonl` held 11 lines; the probe's own check is
  quote-delimited grep-grade, but the Task 1 report's **manual transcript parse** confirmed an
  assistant entry (index 9) whose `content` carries a `tool_use` block named `AskUserQuestion`, and
  scenario ② corroborates it end-to-end (the recorded blocked reply carried the real question text).
  Nothing built on this is grep-only.
- (scenario ①, execution) **Two shipped-behavior corrections** folded into rev 3: `ccx rm` on a dirty
  worktree does NOT refuse — it deregisters the row and *keeps* the worktree with a `kept worktree`
  notice (deliberate: doperpowers' purge purposely dirties worktrees via a `.daemon-turn-live`
  sentinel so `rm` preserves the live checkout); and post-resume fork rows carry **no** worktree
  linkage (`daemon-resume.sh` forks with `--bg --resume` and omits `--worktree`), so `rm` on a fork
  row never touches the directory. Also confirmed the pre-registered upstream candidate: the
  retire-purge resume hint prints the **stale stable uuid**, not the post-fork `current`.
- (scenario ①/②, execution) **The `--permission-mode auto` model auto-gate is load-bearing under the
  scripts.** `daemon-spawn.sh`/`daemon-resume.sh` hardcode `--permission-mode auto`; ccx's shipped
  auto-gate (`config/autoModel.ts`, probe-18d) then overrides a non-auto-capable model, so the
  haiku-5th-arg workers resolve to `claude-sonnet-4-6` inside ccx (the scripts' meta still records the
  arg verbatim). Not a defect — the shipped incr-10 behavior meeting the scripts' own flag.
- (scenario ④, execution) **Content-layer trigger is both-negative → vacuous-but-parity.** Even the
  real `claude` on Opus 5 does not auto-invoke `brainstorming` for "Let's make a react todo list" — it
  scaffolds directly; ccx matches. The `/`-palette-dropdown check was a **capture artifact** (no
  dropdown renders under the pty for *any* command, builtin `/model` included); the authoritative
  catalog layer (`settingSources`→`supportedCommands()`) shows ccx carrying all **15** doperpowers
  skills incl. `brainstorming`; the real binary was directly observed surfacing `brainstorming` from
  the *same* `settingSources`, so skill surfacing is at parity (the full 15-count was enumerated on
  ccx — both binaries draw the catalog from identical `settingSources`, so the set matches by
  construction).

## Outcomes & Retrospective

**C6 SHIPPED 2026-07-29 — the clone roadmap's primary metric is met and the roadmap is complete.**
All four scenarios PASS live (keyed via `CLAUDE_CODE_OAUTH_TOKEN`); the eleven doperpowers 7.25.0
scripts were **md5-identical before and after every scenario** (never edited); zero ccx code defects
surfaced (the defect loop was empty). Test gate: typecheck clean, `npx vitest run` = 1510 passed /
64 skipped, 0 failures (up from C5's 1379 only because the app-server M1 merge landed before C6 began
— C6 added no harness source).

| scenario | what it proved | verdict |
|---|---|---|
| ① real-work lifecycle | `daemon-spawn` (worktree'd) → worker wrote+committed `hello.txt`=`C6-REAL-WORK` on `worktree-c6wt` → `daemon-resume` forked (stable uuid kept, `current` forked, superseded row purged, `C6-EDITED` committed) → `daemon-reply` real text → `daemon-finalize` `noop` → `daemon-retire purge` (NOTE printed, worktree kept) → `ccx --resume <current>` from the worktree replayed → `ccx rm` three arms (fork-row unlinked / dirty-keep notice / clean-delete) | **PASS** |
| ② park-and-answer | `--no-wait` worktree'd spawn parked on `AskUserQuestion`; `daemon-finalize` walked `live`→`idle`→`noop` exactly as rev 2 predicted; recorded blocked reply carried the flushed question text (probe 69); **both** answer paths worked — `ccx attach` + QuestionDialog (Enter=FORMAL → `greeting.txt`=`FORMAL` committed) and the scripts' own `daemon-resume <id> "<answer>"` (→ `greeting.txt`=`CASUAL` committed) | **PASS** |
| ③ retire/mark edges | `daemon-mark awaiting-human "<note>"` (echo + meta), `daemon-list awaiting-human` status filter, `daemon-retire` (keep → meta `retired`, reply kept, `ccx --resume` still loads), `daemon-retire purge` (files gone) | **PASS** |
| ④ content-layer parity | Both the real `claude` (Opus 5) and `ccx` (opus-4-8) go straight to scaffolding on "Let's make a react todo list" — neither auto-invokes `brainstorming` → **vacuous-but-parity**; ccx's SDK catalog carries all 15 doperpowers skills incl. `brainstorming`, and the real binary was observed surfacing `brainstorming` from the same `settingSources` — skill surfacing at parity | **PASS** |

**Retrospective.**
- **The finalize state machine was the load-bearing unknown, and rev 2's model held exactly.** The
  one Critical the spec review caught (park is reported `blocked+idle`, which `daemon-finalize`
  normalizes to `done-blocked`→`idle`, so `live` is unobservable on a park) was confirmed verbatim in
  scenario ②. Designing ② around the real normalization instead of the intuitive "live-on-park" is
  what made it pass first-run.
- **Two spec claims bent to shipped consumer-driven behavior at execution time** (rev 3): `ccx rm` on
  a dirty worktree keeps-and-deregisters (never refuses — doperpowers purposely dirties worktrees),
  and post-resume fork rows carry no worktree linkage. Both were *our own* shipped semantics the spec
  had mis-stated; neither was a code change. The lesson repeats C5's: the spec is a hypothesis, and
  the first live run is its first honest test.
- **One upstream candidate confirmed** (recorded, not worked around): `daemon-retire.sh`'s
  resume hint prints the stale stable uuid, not the post-fork `current`.
- **A pty cross-binary lesson for any future content test:** the real `claude` positions each word
  with cursor escapes, so stripping ANSI concatenates text *without spaces* — assertions must match a
  whitespace-removed view. And "Welcome back &lt;name&gt;" is the ordinary logged-in greeting, not
  session adoption (only the `CLAUDE_CODE_CHILD_SESSION` marker is the real tell).
- **Process:** the one subagent spike (probe 69) and one subagent close-out flanked four
  controller-run live scenarios — the C5/Goal-B acceptance shape. No fix tasks were needed.

## Revision Notes

- rev 1 (2026-07-29): initial design, brainstormed and approved section-by-section.
- rev 2 (2026-07-29): independent spec review (fable) — ② rewritten around the real finalize
  semantics + pre-probe + resume-as-answer Leg B; ①.1 commit precondition, ①.5 `noop`, ①.6
  current-uuid snapshot; ③.1 note assertion corrected; rig gains `DAEMON_HOME`, `DAEMON_TIMEOUT`,
  `ANTHROPIC_BASE_URL`-unset, `CLAUDE_CONFIG_DIR`-default pins; ④ records resolved models; roadmap's
  stale `CLAUDE_BIN` mention flagged for close-out.
- rev 3 (2026-07-29, during scenario ① execution): ①.7 corrected — the spec asserted `ccx rm`
  REFUSES on a dirty worktree, but the shipped, deliberate contract (`cli/lifecycle.ts` rmSession)
  is: deregister the row, KEEP the worktree, print the `kept worktree` notice, exit 0 — because
  doperpowers' own purge routine purposely dirties the worktree (`.daemon-turn-live` sentinel) so
  `rm` preserves the checkout later turns run in; a hard refusal would leak the roster row and break
  the consumer. Spec bent to the shipped consumer-driven semantics; clean-delete arm moved to a
  second cheap worker. Not a code change. Extended same-day: the dirty/clean arms are only reachable
  on **never-resumed** rows — daemon-resume's fork argv omits `--worktree`, so post-resume rows have
  no worktree linkage and `rm` leaves the directory alone (arm (a)); ①.7 is now three arms on three
  rows.
