# The drift ritual (W4.3)

The SDK moved 33 releases in one month; `coverage.md`/`full-potential.md` rot in weeks. This is the
monthly (or on-demand: before any wave, after any SDK bump) remeasure procedure. It is deliberately a
*ritual*, not CI — steps 2–4 need judgment.

## 1. Name-level drift scan (mechanical)

```bash
node scripts/drift-check.mjs          # human report; --json for automation
```

Diffs installed vs npm HEAD `sdk.d.ts` on four surfaces: Options fields, Query methods, SDKMessage
union members, top-level exported names. Exits 2 on parse failure (false-clean guard). No drift ≠ no
change — bodies/jsdoc/semantics move without renames; skim the npm changelog when versions differ.

## 2. On drift: classify each name

- **Added** → a new premise. File it in `full-potential.md` §1 as 🔬 unverified; probe before
  building (the A1 lesson — declared ≠ reachable). Knob-shaped additions go through the W4.1 pattern
  (one-line resolveOptions wire + knobs.test.ts row) only *after* a probe or a structural-passthrough
  judgment.
- **Removed** → check `coverage.md` + `harness/src` consumption (`grep -rn <name> harness/src`).
  Consumed-and-removed = a break: bump + fix before the routine bump lands it on you. Also re-check
  the standing-exclusions floor — 0.3.211 *deleted* `runAssistantWorker`/`connectRemoteControl`; the
  floor shrinks on its own.

## 3. Bump + re-verify (when adopting the new version)

Bump all four package.jsons (harness/tui/app-server/probes), then:

```bash
cd probes && set -a; . ../.env; set +a; npx tsx probes/00-health-check.ts   # ALWAYS first
cd harness && npm run typecheck && npm run test:unit                        # 560+ green
# keyed live sweep (each ~5-30s): knobs, structured, otel, session-store, mcp-topology,
# warm-pool, tenant — plus any probe touching a drifted surface
```

`test/unit/index.test.ts` (surface pin) and `knobs.test.ts` (Options mapping) are the tripwires most
likely to catch silent SDK shape changes.

## 4. Update the maps

`coverage.md` §7 remeasure note + affected domain rows; `full-potential.md` §1 rows (verdict flips),
§2 recount, standing-exclusions floor. Refresh the relevant memory file.

## Run log

| date | installed → HEAD | verdict |
| --- | --- | --- |
| 2026-07-17 | 0.3.211 → 0.3.212 | zero name-level drift on all four surfaces (63 Options fields / 32 Query methods / 39 SDKMessage members / 236 exports) — no action |
| 2026-08-18 | 0.3.227 → 0.3.234 (adopted; harness+probes+app-server bumped) | name-level: +2 exports only (`SDKContextUsage`/`SDKContextUsageCategory`). Full-text diff found what the four-surface scan can't (non-exported control types): **added** — `context_usage` structured sibling on the `/context` synthetic assistant message; init gains `effort` + `terminal_slash_commands`; `queued_notifications` capability + user-message `fromMode` (CCR-flavored); `ApiKeySource` union widened, legacy members retained. **Removed** — `get_plan` + `get_workspace_diff` control requests, `bypass_permissions_disabled` exit reason: zero consumers in `harness/src`, no premise rows, free. **Semantics** — dialog-kind contract inverted (declare in `supportedDialogKinds`, never answer undeclared kinds): our passthrough already models it. Gates: typecheck + 2891 unit + 3546 tui green; keyed health + knobs/structured/session-store + M4 acceptance. One TUI failure during verification was the worktree's 97-char cwd truncating the `/permissions` Workspace path row, not the SDK (control: same fail on 0.3.227, same cwd) — test fixed to prefix-match |
| 2026-08-21 | 0.3.234 → 0.3.237 (adopted; app-server bumped — harness and probes were already at 0.3.237 in main, app-server had been missed) | name-level: **zero drift on all four surfaces**. **The full-text `sdk.d.ts` diff again found what the scan cannot** (41 lines; the scan's clean verdict is scoped to four surfaces and this is the second consecutive bump where that scope was the difference). **Added** — `classifierContext` on a hook result (host-asserted intent for the auto-mode permission classifier; filed 🔬 in full-potential §1, unprobed, zero consumers); `account_on_hold` joins `SDKAssistantMessageError` (zero consumers, free); a `spellcheck` block joins the settings schema. **Removed** — nothing. **Doc-only** — the provider list lost `anthropicGoogleCloud` from an example and gained an "e.g.", so it is now explicitly non-exhaustive. **`spellcheck` is the live proof of the parked `KNOWN_TOP_LEVEL` rot**: it is absent from the 87 hand-transcribed keys, so `config/value/write` warns `unknown top-level settings key "spellcheck" (written anyway)` for a key upstream ships — the drift arrived on the first bump after the item was written down. Gates: health check ✅ live; typecheck clean; tui 152 files / 3872 tests; unit 235 files / 3239 tests on three consecutive runs. **One earlier unit run reported a single failure whose name was lost to output truncation and did not reproduce in three subsequent full runs** — recorded as an unidentified flake rather than called clean, because an unidentified flake is what a real regression hides behind |
