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
