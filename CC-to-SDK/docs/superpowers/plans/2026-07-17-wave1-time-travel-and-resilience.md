# Wave 1 — Session Time-Travel + Daemon Resilience — Plan

Spec: `../specs/2026-07-17-wave1-time-travel-and-resilience-design.md` (probes 37/37b/38/39 all live-verified first).
Items are independent; they execute sequentially because they land in shared seams
(`session.ts`, `resolveOptions.ts`, `supervisor.ts`, `server.ts`, `client.ts`, `index.ts`).

## Task 1 — time-travel (W1.1)
1. `config/types.ts`: `resumeAt?: string`, `forkSession?: boolean` (+ docs); `resolveOptions`: wire to
   SDK `resumeSessionAt` / `forkSession`. Unit: resolveOptions passthrough.
2. `session/index.ts`: `rewindSession(id, messageId, config?)` — `{fork: true}` → forkSession branch;
   default in-place (destructive — doc loudly). Unit: DI-fake asserts options carry resume+resumeSessionAt(+forkSession).
3. Daemon: supervisor `rewind(id, messageId, {fork})` (dispose+replace pool entry, same daemon id,
   registry sessionId update on fork) + `rewind` op in server/client. Unit: supervisor swap + wire.
4. Live e2e `test/live/rewind.e2e.test.ts`: 2-turn build → fork-rewind (original intact) → in-place
   rewind (turn 2 forgotten). Refresh coverage.md row + full-potential E table.

## Task 2 — reinitialize + interrupt receipt (W1.2)
1. `Session.reinitialize()` (callQValue); `interrupt()` returns the receipt (`Promise<unknown>`).
2. Bridge: `reinitialize` control frame optional-method; daemon op `reinit`. Interrupt ok-response
   carries the receipt.
3. Unit: bridge/dispatch; live: reinit mid-session returns init payload (fold into rewind e2e file or
   its own small file).

## Task 3 — limits classification (W1.3, no live)
1. `src/limits/classify.ts`: `LimitKind`/`LimitState`, `classifyLimitText`, `classifyLimitMessage`
   (SDK prefix constants + observed org-policy/credit strings + rate_limit_event).
2. Session `limitState` tracking (result reclassifies/clears; rate_limit_event updates).
3. Supervisor copies to `SessionRecord.limit` after submit (success and throw paths).
4. Unit only (incident-string fixtures). Export from index.ts (pin in index.test).

## Task 4 — background tasks (W1.4)
1. Session: consume `background_tasks_changed` (REPLACE) → `backgroundTasks` getter; `stopTask(id)`;
   `backgroundAll(toolUseId?)`.
2. Daemon ops `bg_tasks` / `stop_task` (server+client+supervisor).
3. Unit: fake-stream level semantics (replace, not merge); live e2e with until-loop long-runner
   (NEVER leading-sleep — CLI blocks it): launch bg → changed set non-empty → stopTask → set empties.

## Closeout
- `npm run typecheck` + full unit + gated live (keyed) green.
- Refresh `docs/parity/coverage.md` (+§ for Wave 1) & `full-potential.md` rows (E/A/G tables) — mark
  Wave 1 items ✅; update memory (`sdk-0-3-211-bump-and-full-potential-roadmap.md` progress note; new
  probe findings into a wave-1 memory).
- Commit per task or as one wave commit; no push.
