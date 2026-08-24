# bl4 round ledger — 2026-08-24
Spec: CC-to-SDK/docs/superpowers/specs/2026-08-24-bl4-clickgate-gifwebp-design.md
Plans: 2026-08-24-bl4-t-gifwebp.md (4 tasks), 2026-08-24-bl4-t-clickgate.md (6 tasks)
Pre-round main: 5562e74f80 (F10 close-out). Repo found mid pull-rebase (flattening, detached, conflicted); aborted, main restored intact.
Order: T-GIFWEBP merges first, T-CLICKGATE second; whole-round codex review to zero after both.
BASE b5fef2d5ff
T-GIFWEBP Task 1: complete (b5fef2d5ff..dd81352147, review clean; real-bytes check all 4 variants)
T-GIFWEBP Task 2: complete (dd81352147..21a87779f9, review clean; 3 mutations bit; clipboardImage enumeration verified in-scope-correct)
T-GIFWEBP MERGED 26a1d8ddab; gates on merged tree next
T-GIFWEBP merge gates on 26a1d8ddab: typecheck clean, unit 3676/3676, tui 4651 passed/11 skipped. Ticket complete.
T-CLICKGATE Task 1: complete (b5fef2d5ff..f93933d4ff incl. fix wave b93d3db2e7 + review fixes; original reviewer approved; parked: species.ts !command echo path — line-species, not tool_result, candidate follow-up)
T-CLICKGATE Task 2: complete (f93933d4ff..c5685315d4, review clean; 3 mutations bit; hover gate flipped, F10 hover-everything delta closed)
T-CLICKGATE Task 3: implemented c5685315d4..c54c7bb5c1; review found 1 Important (mandated viewport-boundary cell missing, undisclosed) -> fix wave dispatched. Reviewer rulings: double-click-on-expanded word-select edge = canon-consistent, owner UX question (report at close-out); ownerKey reid-mismatch bug root-caused+fixed at the right layer. Parked minors: hover-suppression e2e cell for expanded items.
T-CLICKGATE Task 3: complete (c5685315d4..0f78a4c7b7 incl. boundary-cell fix; original reviewer approved, spec met)
T-CLICKGATE Task 4: complete (0f78a4c7b7..dee9bd7d67, review clean; hostile-OSC-8 traced unreachable; link no-op generic in clickTargetAt, D12 gap recorded)
T-CLICKGATE Task 5: verify-only, no commit — fullscreen markers already bare (useChat.ts expandHint:fullscreen?"":... predates ticket, added for chips, covers both marker producers). D6 already satisfied.
T-CLICKGATE MERGED 05d9eeddad; merged-tree gates: typecheck clean, unit 3676/3676, tui 4687/11 skipped. Whole-round codex review from 5562e74f80 launched.
Whole-round codex review round 1 (base 5562e74f80): 7 findings. THREE P1 + two P2 are in CC-to-SDK/reforge/ — NOT this round's work; reforge is an active concurrent session (commits 22:06 today); findings relayed to owner, deliberately not fixed here. Round's own: 2 P2 in harness (item-click resolver checks per-row clickable while hover checks owner set -> header click dead; taskStopRows hardcodes clickable:false while clipping). ONE fix subagent dispatched.
Fix wave 1: a0a7eacdf6 + 4ae21d751e (both red/green; writeRows audited no-escape, left as canon). Scoped re-review of fix range launched.
Fix-range re-review (base 05d9eeddad): ZERO actionable defects. Campaign converged 2 -> 0 on round code (reforge findings relayed, not this round's).
ROUND CLOSED. Not pushed.
PUSHED (owner request): merged origin/main (app-server M7, 68 commits; conflict in chatAdapter resolved in favor of M7's stagedSubmit.ts extraction with bl4's four-reader chain carried into it), gates green on merged tree (unit 3962/3962, tui 4689/11 skipped), pushed as 39c29a8f67. Reforge findings (3 P1 + 2 P2) relayed to session cc-to-sdk-79.

## Reforge relay outcome (2026-08-24, post-push)

cc-to-sdk-79 confirmed it IS the reforge session. All five relayed findings reproduced, none
rejected, all fixed in reforge commit 9a8e509a97: config isolation moved into runTurn.ts; leak
check now discards the staged cassette and fails the scenario; flaky-path suppression replaced by
source-level canonicalization (tool_result sort by tool_use_id, explicit cache-breakpoint count,
consecutive single-result message sort) after the compare-against-oracle-alternatives remedy proved
insufficient (sampling can't certify unseen orderings); tsconfig widened to all dirs (TS2339 fixed);
unknown/valueless --scenario aborts exit 2, empty verdict set refused.

NOTE for future review sweeps of reforge/: three scenarios (plain, background-task, fork-session)
show FAIL because recording hits a sustained account-level 429 (no retry-after header; token refresh
didn't help). Environmental, not code — documented in reforge/README.md. Do not re-flag.
