# Slash-command coverage — `ccx` REPL vs. real Claude Code

> **Why this file exists (2026-07-30):** a user driving the REPL typed `/cd`, `/add-dir` and `/exit`
> and got `Unknown command` for all three. That is a symptom, not the disease: nobody had ever compared
> our command surface against the real one. This audit is that comparison, and it is the scope document
> for the next UX sprint. Companion to [`tui-ux.md`](tui-ux.md) (visual/interaction parity) — this file
> covers only the `/` surface.

## Evidence base

| source | what it gives | count |
| --- | --- | --- |
| `probes/probes/73-command-catalog-audit.ts` (live) | the catalog the SDK reports to us at runtime, which the palette TAB-completes | **88** entries |
| `Claude Code Src/src/commands/` (reference harness) | real Claude Code's own command set | **94** commands |
| `harness/src/tui/commands.ts` `COMMANDS` | what our REPL handles locally | **18** |

The three numbers do not overlap the way you would expect, and that mismatch is the whole finding: the
live catalog is mostly **skills and plugins** (`brainstorming`, `execplan`, `writing-plans`, `supabase`,
`playwright-cli`…), not the client-side controls a user reaches for. Real Claude Code's controls are
implemented **in its own client**, so they never appear in an SDK-reported catalog at all.

## The three classes

### A. In the catalog, not handled locally — 10 commands — **RESOLVED (Wave 1, 2026-07-30)**

`agents` · `color` · `config` · `doctor` · `effort` · `extra-usage` · `fast` · `heapdump` · `rename` · `review`

Our dispatch used to send any catalog name it did not handle to the engine **as a prompt turn**
(`runTurn("/config")`, verified by probe 31 for skills). That is right for a skill and wrong for a
client-side control. Wave 1 settled each name by classifying it in the 2.1.220 bundle:

- **Honest client-side message (7):** `agents` · `color` · `config` · `effort` · `extra-usage` ·
  `fast` · `heapdump` — all `type: "local"`/`"local-jsx"` upstream, so a prompt turn hands the model a
  command it cannot act on. `CLIENT_SIDE_NOTES` (`harness/src/tui/commands.ts`) intercepts them ahead
  of the catalog with a one-line "what it is and why not here". `/config`'s message points at launch
  flags until Wave 3 (U7) ships the settings UI.
- **Stay prompt turns (2):** `review` (reference `review.ts`, `type: 'prompt'`) and `doctor` (the
  bundle's 2.1.220 definition carries `getPromptForCommand` — it became a prompt command) — for these,
  submit-as-turn IS the upstream behavior.
- **Implemented (1):** `rename` — the lib already shipped `renameSession()` over the SDK session
  store; Wave 1 wired `/rename` (and `/tag`, from class B) to it.

### B. Absent from the catalog AND unhandled — 71 commands

The full list is reproducible with the script at the bottom. What matters is the split:

**Genuinely wanted (the sprint's likely body)** — Wave-1 statuses inline (2026-07-30):
**shipped:** `export` · `stats` · `tag` · `diff` (terminal stand-in: status + diff --stat) · `files` ·
`session` (**deliberate divergence** — upstream's is a cloud-URL/QR bridge feature; ours shows local
session info + resume hint) · `rename` (pulled in from class A).
**dropped:** `summary` — no such command exists in 2.1.220; the wanted list inherited it from the
stale February reference (spec Revision Notes, 2026-07-30).
**still open for later waves:** `add-dir` (U6, probe-gated) · `memory` · `permissions` (U7, required) ·
`plan` · `skills` · `tasks` · `theme` (U7) · `output-style` · `keybindings` · `vim` (owner-deferred) ·
`fork` · `branch` · `share` · `hooks` · `login`/`logout` (excluded below) · `terminalSetup` ·
`statusline` · `release-notes` · `upgrade` · `privacy-settings`

**Out of scope (bridge-coupled, non-terminal, or internal):** `bridge` · `chrome` · `desktop` · `mobile` ·
`voice` · `teleport` · `ide` · `install-github-app` · `install-slack-app` · `ant-trace` ·
`backfill-sessions` · `break-cache` · `debug-tool-call` · `mock-limits` · `reset-limits` ·
`rate-limit-options` · `oauth-refresh` · `onboarding` · `remote-env` · `remote-setup` · `passes` ·
`peers` · `stickers` · `good-claude` · `buddy` · `btw` · `bughunter` · `autofix-pr` · `pr_comments` ·
`perf-issue` · `issue` · `feedback` · `ctx_viz` · `thinkback` · `thinkback-play` · `assistant` ·
`workflows` · `plugin` · `reload-plugins` · `sandbox-toggle` · `env` · `version` · `install`

### C. A premise to correct: `/cd` does not exist in real Claude Code

Grepping the reference harness for a `cd` command, an alias, or a `'/cd'` string finds **nothing** — the
real command for widening the working set is **`/add-dir`**. So `/cd` is not a parity gap; whether we add
it as a convenience is a product choice, not a fidelity requirement. Worth noting that `!cd /tmp` also
cannot work as users expect: every `!` command is its own `exec`, so a directory change dies with it.

## Feasibility finding that shapes the sprint: `/add-dir` is not a free win

Adding a working-directory root at runtime is **not on the typed SDK surface**. `sdk.d.ts` declares a
control request `SDKControlRegisterRepoRootRequest` (`subtype: 'register_repo_root'`), and the
`DirectoryAdded` hook even distinguishes `source: 'slash_command' | 'register_repo_root'` — but the `Query`
handle exposes no method for it (checked method-by-method: `interrupt`, `setPermissionMode`, `setModel`,
`setMaxThinkingTokens`, `applyFlagSettings`, `initializationResult`, `reinitialize`, `supportedCommands`,
`supportedModels`, `supportedAgents`, `mcpServerStatus`, `getContextUsage`, `usage_EXPERIMENTAL…`,
`readFile`, `reloadPlugins`, `reloadSkills`, `accountInfo`, `rewindFiles`, `seedReadState`,
`reconnectMcpServer`). Our `additionalDirectories` config is **launch-only**.

The SDK also documents a constraint that outlives any transport question: the directory
*"must resolve to a strict subdirectory of cwd, or of a directory passed at launch via `--add-dir` / the
SDK `additionalDirectories` option."* So even reachable, `/add-dir /some/unrelated/path` cannot work
mid-session the way it does in the real client.

**Therefore, before designing `/add-dir`, probe two things** (declared ≠ reachable — the A1 discipline):
1. Is `register_repo_root` reachable untyped at runtime (`(q as any).registerRepoRoot?.()`, or by writing
   the control request directly)?
2. If not, does re-launching the session with a widened `additionalDirectories` and a `resume` preserve
   the conversation? That is the same mechanism `/cd` would need.

## Proposed sprint shape

Four slices, ordered by user-visible value per unit of risk. Each ends with a pty-driven acceptance run
against the real binary, because that is what caught all three of today's defects — the in-process tests
were green the whole time.

| slice | content | why this grouping |
| --- | --- | --- |
| **U1 — stop lying about the surface** | route class-A client-side controls away from the model; make an unhandled-but-catalogued command say what it is rather than silently becoming a prompt; `/help` reflects reality | pure honesty work, no new SDK questions, removes the worst class of surprise |
| **U2 — session & context controls** | `/export` · `/summary` · `/diff` · `/files` · `/session` · `/tag` · `/rename` · `/stats` | all read or format state we already hold; no SDK gaps |
| **U3 — the directory question** | probe `register_repo_root`, then `/add-dir` (and a decision on `/cd`) on whatever the probe permits | one probe gates the whole slice; do not design before it runs |
| **U4 — settings surfaces** | `/config` · `/permissions` · `/theme` · `/output-style` · `/keybindings` | genuinely new UI; largest and most taste-dependent, so it goes last |

Deliberately excluded: everything in class B's out-of-scope list, and `/login` / `/logout` (auth is
`.env`-driven here and a REPL login flow would fight the OAuth-token model this project depends on).

## Owner decisions (2026-07-30)

- **`/config` and `/permissions` are required** — U4 is in scope, not optional.
- **`/vim` is the only deferral.** Everything else in the wanted list above stays in.
- **The sprint runs as an observe→fix loop**, not one design pass. The full plan, its slices, and the
  method now live in [`../superpowers/specs/2026-07-30-tui-ux-sprint-design.md`](../superpowers/specs/2026-07-30-tui-ux-sprint-design.md);
  this file remains the command-surface evidence it draws on.
- Commands are no longer the whole story: the same session surfaced a background-work visibility gap and
  two keymap divergences from real Claude Code, both now slices in that spec.

## Reproducing the audit

```bash
cd CC-to-SDK/probes && set -a; . ../.env; set +a; npx tsx probes/73-command-catalog-audit.ts > /tmp/catalog.txt
ls "CC-to-SDK/Claude Code Src/src/commands" | sed 's/\.tsx\?$//' | sort -u      # the real command set
grep -o 'name: "[a-z-]*"' CC-to-SDK/harness/src/tui/commands.ts                 # what we handle
```

Re-run it when the SDK is bumped: the catalog is the SDK's, and it moves without a version signal — the
same reason [the model aliases](../../harness/src/config/models.ts) need re-probing.
