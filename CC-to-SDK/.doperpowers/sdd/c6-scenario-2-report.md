# C6 scenario ② — park-and-answer (--no-wait spawn → finalize walk → attach-answer → resume-as-answer)

**Verdict: PASS** (run 2026-07-29, driver `$CLAUDE_JOB_DIR/tmp/acc-c6-park.mjs`, keyed via
`CLAUDE_CODE_OAUTH_TOKEN`). Spec: scenario ② rev 2; probe 69 verdict **FLUSHED** picked the
question-text arm for step 4. First full run passed every arm; scripts unmodified (md5 line below).

## Evidence

| step | observable |
|---|---|
| 1. --no-wait spawn (worktree'd, haiku arg) | `daemon spawned (no-wait): c6p  [264ea34f / 4f889a74-6cf4-416f-812d-a0aaadc10cba]  status=working  (reply: daemon-reply.sh 264ea34f)` |
| 2. finalize mid-turn | printed `live`, meta.updated **untouched** |
| 3. roster row at park | `{"state":"blocked","status":"idle"}` — `waitingFor` is NOT on the roster row (it lives on the host status op, Goal-B design); the park's identity is proven by the attach leg below |
| 4. finalize on the park | printed `idle`; recorded reply = the harness marker `[pending AskUserQuestion — daemon is blocked on it; answer with daemon-resume.sh <id> "<answer>"]` **plus the flushed question**: `Q: Which greeting styl… options: FORMAL / CASUAL` (probe-69 FLUSHED arm confirmed end-to-end) |
| 4b. second finalize | `noop` |
| 5. daemon-reply | returns the recorded reply (question + options text) |
| 6. Leg A — `ccx attach` | parked QuestionDialog rendered (FORMAL option visible); Enter selected FORMAL; Ctrl+Z detach; roster reached `done`; **`greeting.txt="FORMAL"` committed in the worker's worktree** |
| 7. Leg B — `daemon-resume.sh <id> "Answer: CASUAL — …"` on a second parked worker | parked turn stopped, fork `281a6ab1…` completed, superseded row purged, reply: `` Done. `greeting.txt` contains `CASUAL` and is committed as "greeting". `` — **`greeting.txt="CASUAL"` on disk**: the fork carried the answer through (the empirically-uncertain leg settled POSITIVE) |
| 8. md5 integrity | all 11 scripts unchanged |

## Notes

- **The full park seam under the scripts is now proven live**: a bg worker parks on
  `AskUserQuestion`; `daemon-finalize.sh` normalizes blocked+idle exactly as spec rev 2 predicted
  (`live` → `idle` → `noop`); the recorded blocked reply is actionable (it names
  `daemon-resume.sh` and carries the question); and BOTH answer paths work — ours (`ccx attach` +
  dialog) and the scripts' own (`daemon-resume` fork).
- **Stretch (permission-park variant) skipped deliberately**: both mandated legs passed on the first
  run, and the scripts treat every blocked state identically (`state=="blocked"` → `done-blocked`);
  the permission-park decision surface itself was already live-proven in Goal B acceptance ①. No
  additional script-facing behavior would be exercised.
- Driver notes: answering used Enter on the default-highlighted first option after an Ink settle
  (C5 pty discipline); detach via Ctrl+Z then client kill (host is a separate process).
