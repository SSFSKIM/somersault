# CLAUDE.md — CC-to-SDK

A self-contained **TypeScript** sub-project (independent of the surrounding Rust fork): replicate Claude
Code's harness features on top of the **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`), shipped as a
headless library/service. When working anywhere under `CC-to-SDK/`, this file + the root `../CLAUDE.md` both
apply; `harness/CLAUDE.md` auto-loads on demand for build/test detail.

## Structure (one line each)

- **`harness/`** — the product: the headless harness, an npm package (`cc-harness`). **Has its own `CLAUDE.md`** (commands, module map, conventions). This is where almost all work happens.
- **`tui/`** — `cc-harness-tui`: the interactive **Ink** daemon console (`cc-harness-console` bin) over the core's public `connectDaemon`/`DaemonClient`. **Has its own `CLAUDE.md`.** Build `harness/` first (it depends on `cc-harness` via `file:../harness`).
- **`docs/parity/coverage.md`** — the **capability scorecard** and **source of truth** for what's built vs. reachable vs. out-of-reach (10 domains, %). Read it first to know the current state before proposing work.
- **`docs/superpowers/specs/`** + **`plans/`** — per-feature design specs and implementation plans (one `YYYY-MM-DD-<feature>` pair each).
- **`probes/`** — a self-contained npm workspace of **live SDK capability probes** (`probes/probes/NN-*.ts`, run with `tsx`). The evidence base for every design decision.
- **`Claude Code Src/`** — TypeScript reference harness; **research only, not built** — read for reference, don't edit.

## The governing discipline: live-probe-first (the "A1 lesson")

The original feature specs were reverse-engineered from a **February snapshot of Claude Code that is now
stale**. So **every "the SDK can / can't do X" premise must be VERIFIED against the real SDK before you
design or build on it** — write a probe in `probes/probes/`, run it live, and let the result drive the
design. This has repeatedly flipped premises (cron/push are dead headless; session-store + hooks are alive;
of 30 hook events only 8 fire headlessly). Declared ≠ reachable. Don't trust `sdk.d.ts` alone.

**Two research layers — use the right tool for each.** Probing answers *runtime reachability* (the
declared-vs-reachable question, which only a live run can settle). For the *declared-surface* layer —
Claude API / REST facts, model ids, which models support a beta, pricing/token rules, the standard
`stream_event` / tool-use / messages schemas — reach for the **`ant` CLI** (Anthropic's Claude
Developer Platform CLI: `ant messages|models|batches…`) or the **`/claude-api` skill** instead of
grepping `sdk.d.ts` by hand. They're faster and authoritative for "what exists / intended semantics,"
but they sit on the *declared* side of the line: they cannot tell you whether the installed
`@anthropic-ai/claude-agent-sdk` actually delivers it headlessly. Use them to ground a probe, never to
replace it (e.g. `ant models` would have hinted `taskBudget` is opus-class — but only the probe proved
sonnet/haiku 400 and that `maxBudgetUsd`-exceeded throws instead of returning a result).

## Workflow

Features go **brainstorm → spec (`docs/superpowers/specs/`) → plan (`docs/superpowers/plans/`) →
subagent-driven execution** (superpowers skills). Each feature is live-probed first, ships with unit + a
gated live test, and ends by refreshing `docs/parity/coverage.md` + the relevant memory. Git rules are the
root `../CLAUDE.md` defaults: commit completed work to the current branch (incl. `main`) without asking, **no
`Co-Authored-By`**, and **never push / open PRs without an explicit request**.

## Commands & secrets

All build/test commands run from **`harness/`** — see `harness/CLAUDE.md`. **Live tests gate on
`ANTHROPIC_API_KEY` _or_ `CLAUDE_CODE_OAUTH_TOKEN`** and read them from **`CC-to-SDK/.env`** (gitignored —
never commit or print either). Without a key/token, live suites skip cleanly; run them keyed with
`set -a; . ../.env; set +a; npx vitest run test/live/<file>`. **Prefer the OAuth token** (`claude setup-token`
→ `CLAUDE_CODE_OAUTH_TOKEN`): it bills your **Pro/Max subscription** instead of metered API credits. The SDK
spawns the bundled `claude` CLI and inherits the parent env, so the token reaches it; but `ANTHROPIC_API_KEY`
**shadows** the OAuth token when both are set — keep the API-key line commented in `.env`. Verified by
`probes/probes/28-oauth-subscription-auth.ts` (`accountInfo()` → `apiProvider:"firstParty"`).
