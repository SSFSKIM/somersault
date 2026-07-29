# C6 scenario ③ — retire/mark edges (mark note → status filter → retire-keep → retire-purge)

**Verdict: PASS** (run 2026-07-29, driver `$CLAUDE_JOB_DIR/tmp/acc-c6-retire.mjs`, keyed via
`CLAUDE_CODE_OAUTH_TOKEN`). First run passed; two cheap no-worktree haiku-arg workers; scripts
unmodified.

## Evidence

| step | observable |
|---|---|
| 0. two finished daemons | a=`0b299661/93dabc92…` b=`152d413e/26faaca7…` (blocking spawns, trivial "Reply OK" tasks) |
| 1. mark + note | `daemon-mark.sh <a> awaiting-human "escalated: test note"` — echo carries the note; meta `status=awaiting-human`, `note="escalated: test note"` |
| 1. status filter | `daemon-list.sh awaiting-human` lists exactly the marked row: `c6ra  0b299661  awaiting-human claude  1  OK.` (b absent; list never renders notes — asserted via echo+meta per spec rev 2) |
| 2. retire (no purge) | `retired c6ra [93dabc92-…] (still resumable: claude --resume 93dabc92-…)`; meta `status=retired`, reply file **kept** |
| 2. resumability | `ccx --resume <current>` from the daemon's cwd loads the conversation (replayed reply visible), clean exit |
| 3. retire purge (b) | meta/reply/err all gone |
| 4. md5 integrity | all 11 scripts unchanged |

## Notes

- The still-resumable hint names the stable uuid, which for a **never-resumed** daemon is also its
  current session — correct here; the stale-hint case after a fork is the scenario-① upstream note.
