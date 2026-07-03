# Host facts — claude-plugin-codex walking skeleton

Settled live against `codex-cli 0.140.0` on this machine (macOS, zsh) by installing the plugin from
this repo and driving it from a scratch git repo (`/tmp/claude-plugin-smoke`). This is the ledger
Tasks 12/15 read before building the real `setup`/session-transfer tools and the real hook gate.

**Bottom line: the exact file contents given in the Task 2 brief for `.mcp.json` and
`hooks/hooks.json` do NOT work as shipped.** Both rely on a bare relative path (`./scripts/...`)
resolving against the plugin root, and it does not — Codex resolves both against the session's
**workspace** cwd. Two one-line fixes make everything work; they're applied in this repo's
`plugins/claude/.mcp.json` and `plugins/claude/hooks/hooks.json` and documented below. Every other
file matches the brief verbatim.

## 1. `.mcp.json` path resolution — NOT plugin-root-relative by default

**Finding:** the brief's literal `.mcp.json` (`"command": "node", "args":
["./scripts/claude-companion-mcp.mjs"]`, no `cwd` field) makes Codex spawn the server with the
**session's workspace directory as cwd**, not the plugin root. Confirmed by a crash: running
`codex exec` against the brief's exact `.mcp.json` produced this in the (`RUST_LOG=debug`) log,
sourced from `codex_rmcp_client::stdio_server_launcher`:

```
MCP server stderr (node): Error: Cannot find module '/private/tmp/claude-plugin-smoke/scripts/claude-companion-mcp.mjs'
    code: 'MODULE_NOT_FOUND'
```

i.e. Codex tried to resolve `./scripts/claude-companion-mcp.mjs` against
`/private/tmp/claude-plugin-smoke` (the scratch workspace), not against the plugin's installed
cache root. The server never started in any exec run using the brief's unmodified `.mcp.json`, so
the model could never see or call `setup` (its 100+-tool tool-search index that turn had nothing to
find — see §5).

**Mechanism confirmed from source** (`codex-rs/codex-mcp/src/plugin_config.rs`,
`normalize_plugin_mcp_server_value`): for a locally-installed plugin (`PluginMcpServerPlacement::Declared`),
Codex only rewrites a server's `cwd` field, and only if it is present and relative — it joins it onto
the plugin root. It does **not** touch `command`/`args` at all, and it does **not** default `cwd` to
the plugin root when the field is absent (that auto-default only applies to the `Environment`
placement variant, used for remote/cloud-routed placement, not local `codex plugin add`).

**The fix** (applied in `plugins/claude/.mcp.json`): add an explicit `"cwd": "."`:

```json
"claude-companion": {
  "command": "node",
  "args": ["./scripts/claude-companion-mcp.mjs"],
  "cwd": ".",
  "env_vars": [...],
  ...
}
```

With this, a live `setup` call returns:

```json
{
  "cwd": "/Users/new/.codex/plugins/cache/cc-claude/claude/0.1.0",
  "node": "v22.18.0",
  "env": { "HOME": true, "PATH": true, "CLAUDE_CODE_OAUTH_TOKEN": true, "ANTHROPIC_API_KEY": false, "CLAUDE_COMPANION_APPSERVER": null }
}
```

**cwd = the plugin cache root**, confirming `"cwd": "."` resolves relative to plugin root as
designed. It is **not** the workspace (`/private/tmp/claude-plugin-smoke` never appears once the fix
is applied) — later tasks that need to locate sibling files/data next to the server script can rely
on `process.cwd()` once `"cwd": "."` (or any relative `cwd`) is set.

## 2. MCP child process — cwd, spawn source, env whitelist

- **cwd** = the **installed plugin cache root** (`~/.codex/plugins/cache/<marketplace>/<plugin>/<version>/`),
  once `.mcp.json` declares `"cwd": "."` (see §1) — **not** the session workspace.
- **Spawned from the cache copy**, not the source repo. `codex plugin add claude@cc-claude` copies
  `plugins/claude/` verbatim into `~/.codex/plugins/cache/cc-claude/claude/0.1.0/`; re-running
  `codex plugin add claude@cc-claude` after editing the source **overwrites the cache in place**
  (no version bump needed for a local marketplace to pick up source edits — confirmed with
  `diff -r plugins/claude ~/.codex/plugins/cache/cc-claude/claude/0.1.0` after a re-add).
- **Eagerly spawned at session start**, regardless of whether the model ever calls a tool from it —
  Codex connects to every configured MCP server (`context7, openaiDeveloperDocs, claude-companion,
  node_repl` in this session, per `codex.conversation_starts` telemetry) to build its tool index. This
  is how the MODULE_NOT_FOUND crash in §1 surfaced even in "do nothing" prompts.
- **env_vars whitelist is real and confirmed working.** With `.mcp.json`'s
  `"env_vars": ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "CLAUDE_COMPANION_APPSERVER", "CLAUDE_COMPANION_DATA"]`,
  the spawned process's **full env key list** (captured via a temporary diagnostic build of the
  stub, not committed) was exactly:
  ```
  CLAUDE_CODE_OAUTH_TOKEN, HOME, LANG, LOGNAME, PATH, SHELL, TERM, TMPDIR, USER, __CF_USER_TEXT_ENCODING
  ```
  i.e. a small fixed base set (`HOME, LANG, LOGNAME, PATH, SHELL, TERM, TMPDIR, USER,
  __CF_USER_TEXT_ENCODING`) **plus** only the whitelisted keys that were actually set in the host
  shell. `CLAUDE_CODE_OAUTH_TOKEN` was set on the host (sourced from `CC-to-SDK/.env`) and appeared;
  `ANTHROPIC_API_KEY`/`CLAUDE_COMPANION_APPSERVER`/`CLAUDE_COMPANION_DATA` were unset on the host and
  were **absent from the key list entirely** (not present-as-empty). None of the dozens of ambient
  dev-shell vars (`CMUX_*`, `GHOSTTY_*`, `NVM_*`, `TMUX*`, …) leaked through — this is a genuinely
  cleared spawn, unlike hooks (§3).
- **Tool naming as seen by the model**: `mcp__claude_companionsetup` (hyphen in the server name
  becomes `_`; no separator renders between the server-name segment and the tool name in the
  collapsed display — cosmetic, not something this plugin controls).
- **PATH is passed through verbatim, not guaranteed to contain `node`.** §1's env dump shows `PATH`
  is in the base whitelist, so a bare `"command": "node"` resolves against whatever PATH the
  *process that launched Codex* had — not necessarily an interactive dev shell's PATH. On this
  dev machine (Codex launched from an interactive zsh with nvm/Homebrew set up) that PATH included
  `node`, so the original `.mcp.json` worked here. **Confirmed failing live in a different launch
  context** (2026-07-04, real user report): with Codex launched such that its PATH lacked `node`
  entirely (e.g. `/usr/bin:/bin` only — the classic macOS GUI-launched-app PATH, missing
  Homebrew/nvm dirs), the MCP server never spawned, `claude-companion`'s tools never appeared in
  tool discovery, and there was **no diagnostic anywhere the model or user could see** — the only
  way to notice was to dig through Codex's own debug logs. Codex's plugin/MCP host code
  (`codex-rs/core-plugins`, `codex-rs/codex-mcp`) exposes **no bundled-Node path or env var** a
  plugin could rely on instead (grepped for `bundled_node`/`node_path`/`NODE_PATH` — no matches).
  **Fix applied**: `.mcp.json`'s `command` is now `sh ./scripts/launch-mcp.sh`, a small POSIX
  wrapper that tries `PATH` first, then a short list of common absolute install locations
  (`/opt/homebrew/bin/node`, `/usr/local/bin/node`, `/usr/bin/node`, `~/.nvm/versions/node/*/bin`),
  and only then fails — loudly, on stderr — instead of silently. This does not fully solve the
  underlying host limitation (there is still no first-class way for a plugin to discover a
  guaranteed-present Node runtime), but it closes the specific gap a real user hit.
- **Codex Desktop *does* bundle its own Node — at a discoverable, fixed-name path** — even though
  §2 above found no env var or plugin-host API exposing it. **Confirmed live (2026-07-04, same
  user, second round)**: the first fix above (generic Homebrew/nvm fallback candidates) still
  wasn't enough — a real Codex Desktop session's PATH had no `node` at all, and none of those
  generic candidates matched either, so tool discovery still silently failed even with
  `launch-mcp.sh` in place. The user found Codex Desktop's own bundled Node by hand at
  `~/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node` (`v24.14.0` on their
  machine) and used it to manually launch the appserver successfully. `codex-primary-runtime` is a
  stable, non-version-suffixed directory name (confirmed via `ls ~/.cache/codex-runtimes/` —
  Codex's own runtime manager owns it, it isn't a plugin concern), so it's now the **first**
  candidate in `launch-mcp.sh`'s fallback list (globbed as `*/dependencies/node/bin/node` in case
  the runtime name ever varies) — since it's the very Node Codex itself depends on to run, it's a
  more reliable bet on a Codex Desktop machine than any generic dev-shell guess. Also added to
  `WORKER_MISSING_TEXT`/README as the concrete override example for the separate
  `cc-codex-appserver` worker-binary resolution (a different problem from the MCP server's own
  Node-finding, but the same underlying fix).

## 3. Hook process — cwd, env, plugin-root variable

- **cwd** = the **session's workspace directory** (e.g. `/private/tmp/claude-plugin-smoke`), always —
  confirmed both from source (`hooks/src/events/session_start.rs` passes `request.cwd`, which
  `core/src/hook_runtime.rs` sets to `turn_context.cwd`, the session's cwd) and empirically (the
  probe's own `cwd` field). Unlike MCP servers (§1), there is **no per-hook `cwd` override field** in
  `hooks.json` — hook commands always run from the workspace.
- **A plugin-root variable does exist, confirmed two ways**: `${CLAUDE_PLUGIN_ROOT}` and
  `${PLUGIN_ROOT}` are both (a) substituted into the hook **command string** before it runs, and
  (b) exported as literal env vars in the hook's process environment (alongside
  `${CLAUDE_PLUGIN_DATA}`/`${PLUGIN_DATA}` for the plugin's writable data dir). Confirmed from
  `codex-rs/hooks/src/engine/discovery.rs` (`env.insert("PLUGIN_ROOT", ...); env.insert("CLAUDE_PLUGIN_ROOT", ...)`)
  and from the live probe's env-key dump, which includes `PLUGIN_ROOT`, `CLAUDE_PLUGIN_ROOT`,
  `PLUGIN_DATA`, `CLAUDE_PLUGIN_DATA`.
- **The brief's literal `hooks.json` command (`node "./scripts/hook-probe.mjs"`, bare relative path)
  does not work**, for the same reason as §1: with cwd = workspace, the relative path doesn't exist
  there. **The fix** (applied in `plugins/claude/hooks/hooks.json`):
  ```json
  "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hook-probe.mjs\""
  ```
- **Hook env is the full inherited host/shell environment**, not a cleared set like the MCP child.
  The live probe's `env` key list included everything ambient in the launching shell/terminal
  (`CMUX_*`, `GHOSTTY_*`, `NVM_*`, `TMUX*`, `SSH_AUTH_SOCK`, …) plus the four plugin-root/data vars
  above — a stark contrast to the MCP server's ~10-key cleared env (§2). Later tasks should not
  assume hook processes see a minimal/whitelisted environment.
- **Sample captured `stdin` payload** (`SessionStart`, `source: "startup"`):
  ```json
  {
    "session_id": "019f255b-fd35-7aa1-83dc-07b3e3ae56d3",
    "transcript_path": "/Users/new/.codex/sessions/2026/07/03/rollout-2026-07-03T09-23-33-019f255b-fd35-7aa1-83dc-07b3e3ae56d3.jsonl",
    "cwd": "/private/tmp/claude-plugin-smoke",
    "hook_event_name": "SessionStart",
    "model": "gpt-5.5",
    "permission_mode": "default",
    "source": "startup"
  }
  ```

## 4. Hook trust — a real approval gate, separate from the MCP path

Newly-installed plugin hooks are **untrusted** by default. In the interactive TUI (no
`--dangerously-bypass-hook-trust`), the first turn after install paused on a review screen:

```
Event     SessionStart
Source    Plugin - claude@cc-claude
Command   node "/Users/new/.codex/plugins/cache/cc-claude/claude/0.1.0/scripts/hook-probe.mjs"
Timeout   10s
Trust     Trusted
```

Toggling it on (space/enter) records a `trusted_hash` in `~/.codex/config.toml` under
`[hooks.state."claude@cc-claude:hooks/hooks.json:session_start:0:0"]`; after that the hook runs
silently on every subsequent session without re-prompting. `codex exec --dangerously-bypass-hook-trust`
bypasses this same gate for headless runs (confirmed via source:
`hooks/src/engine/discovery.rs` only admits an `Untrusted` handler into the runnable set when
`bypass_hook_trust` is set).

## 5. Open item: SessionStart hook did not fire under headless `codex exec`, in any variant tried

This is the one fact in this ledger that is **not** fully settled — flagging for whoever builds on
this in Task 15.

- The hook (with the `${CLAUDE_PLUGIN_ROOT}` fix from §3, and with
  `--dangerously-bypass-hook-trust`) **never produced any observable effect under `codex exec`** —
  not the probe file, not even an unconditional diagnostic write to `/tmp` (inside the exec sandbox's
  writable roots) added temporarily to rule out a sandbox-permission cause, not a `hook: SessionStart`
  line in the CLI's own hook-lifecycle output (which *did* print for a `Stop` hook from a different,
  already-trusted plugin in the same run — so the general hook pipeline is alive in exec; only
  `SessionStart` was silent).
- The **exact same plugin, unmodified**, fired correctly in the **interactive TUI** (`codex`, no exec
  flag) on the first turn after the user's first message — not at process boot, only once a turn
  actually starts. That run produced the `stdin` payload shown in §3.
- Net: this looks like an **exec-mode-specific gap in `codex exec`'s SessionStart hook dispatch**
  (source inspection of `core/src/session/turn.rs`/`core/src/hook_runtime.rs` shows the same
  `run_pending_session_start_hooks` call site is shared by both TUI and exec, and `SessionSource::Exec`
  is a distinct, exec-specific value passed at session construction — so the root cause is somewhere
  in that shared path's interaction with exec's session bootstrap, not something this plugin's config
  controls). Task 15 should validate the real hook gate **interactively**, and treat headless `exec`
  SessionStart delivery as unverified until re-tested against a newer Codex build.
- The MCP tool path (§1–2) is unaffected by this and is fully confirmed working under both `codex exec`
  and the interactive TUI.

## 6. Installed plugin cache path

```
~/.codex/plugins/cache/cc-claude/claude/0.1.0/
```
(`~/.codex/plugins/cache/<marketplace-name>/<plugin-name>/<plugin-version>/`)

## 7. Exact CLI commands that worked

```bash
# One-time: register this repo as a local marketplace, then install the plugin from it.
codex plugin marketplace add /Users/new/Documents/GitHub/codex_somersault/CC-to-SDK/claude-plugin-codex
codex plugin add claude@cc-claude

# Dev loop after editing plugin source: re-run add — it overwrites the cache in place, no version bump needed.
codex plugin add claude@cc-claude

# Headless smoke test (from a scratch git repo):
mkdir /tmp/claude-plugin-smoke && cd /tmp/claude-plugin-smoke && git init
codex exec "Call the setup tool from the claude-companion MCP server and paste its exact output."

# To also exercise the SessionStart hook headlessly (still doesn't fire — see §5):
codex exec --dangerously-bypass-hook-trust "..."

# To exercise the hook for real: interactive TUI, approve the one-time hook-trust prompt, send any message.
codex   # then approve "SessionStart hooks" → Hook 1 → space to trust, esc, esc; then send a message

# Inspect: what got installed, and confirm cache mirrors source after a re-add.
codex plugin list --json
diff -r plugins/claude ~/.codex/plugins/cache/cc-claude/claude/0.1.0
```

## Deviations from the brief's literal file contents

Both are one-field/one-token fixes, not shape changes — every manifest, every other file, and every
test matches the brief verbatim:

1. `plugins/claude/.mcp.json` — added `"cwd": "."` to the `claude-companion` server entry (§1).
2. `plugins/claude/hooks/hooks.json` — command changed from `node "./scripts/hook-probe.mjs"` to
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/hook-probe.mjs"` (§3).

## 8. Task 15 live confirm: Stop review gate hook, interactive TUI

Settled live against the same `codex-cli 0.140.0`, driven via `tmux` (send-keys/capture-pane) since
the Stop-hook trust prompt and the gate round both require the interactive TUI, not `codex exec` (per
§5's caution). `plugins/claude/hooks/hooks.json`'s `SessionStart` probe entry was replaced with the
real `Stop` hook (`node "${CLAUDE_PLUGIN_ROOT}/scripts/stop-review-gate-hook.mjs"`, `timeout: 900`) —
same `${CLAUDE_PLUGIN_ROOT}` mechanism confirmed in §3, no new deviation needed. Re-ran
`codex plugin add claude@cc-claude` after adding the hook script (no version bump — confirmed cache
mirrors source via `diff -r`, same as §7).

**Hook trust for a new event on an already-trusted plugin is a SEPARATE approval, not inherited.**
Even though this plugin's `SessionStart` hook (Task 2) was already trusted from an earlier session,
swapping it for a `Stop` hook triggered a fresh "Hooks need review" gate on the very next `codex`
launch — confirmed via the hooks-review screen showing `Stop: 2 installed, 1 Active, 1 Review` (the
"2" is this hook plus one from an unrelated already-trusted plugin). Approved with `t` (trust) from
the per-hook detail screen, which showed the exact expected command/timeout:
```
Event     Stop
Source    Plugin - claude@cc-claude
Command   node "/Users/new/.codex/plugins/cache/cc-claude/claude/0.1.0/scripts/stop-review-gate-hook.mjs"
Timeout   900s
Trust     Trusted (after pressing t)
```
Trust persists across new `codex` sessions once set (no re-prompt on subsequent launches), same as §4.

**`setup {enable_review_gate:true}` without an explicit `cwd` silently targets the wrong workspace.**
First call (`Call the setup tool ... with enable_review_gate set to true`, no `cwd` mentioned) reported
"Review gate: enabled" — but `getConfig`/`setConfig` resolved against `companion.cwd`, which defaults
to the MCP server's OWN spawn cwd (`.mcp.json`'s `"cwd": "."` → the **plugin cache root**, per §1-2),
not the session's workspace. Confirmed by inspecting `resolveStateDir("/private/tmp/claude-plugin-smoke-15")`'s
`state.json` immediately after: `stopReviewGate: false`, unaffected. Re-running with the model
explicitly told to pass `cwd` (`"cwd" set to the exact current working directory (run pwd if
unsure)`) fixed it — the model ran `pwd`, got `/private/tmp/claude-plugin-smoke-15`, and called
`claude-companion.setup({"cwd":"/private/tmp/claude-plugin-smoke-15","enable_review_gate":true})`;
`state.json` then showed `stopReviewGate: true` for the right workspace. This is a pre-existing
per-tool `cwd` default (every companion.mjs tool's schema already documents `cwd: "...defaults to the
server cwd"`) rather than anything Task 15 touched, but it is an easy live footgun worth flagging for
whoever next drives this plugin from a fresh workspace: **always pass `cwd` explicitly** in tool calls
that mutate or read workspace-scoped state (`setup`, `status`, `result`, `cancel`, `review`).

**Two real Stop-gate rounds observed, both correctly fail-open, no crash, no false block:**

1. First round reviewed the *previous* (setup-only) turn. The real Claude reviewer complied with the
   contract exactly — `finalText` was `"ALLOW: Previous turn was only a setup/status check ... no code
   changes were made, so there is nothing to gate."` (first line, no preamble). Hook exited 0 with no
   stdout at all (clean allow) and the TUI showed nothing — confirms a compliant ALLOW is fully silent
   to the user, as designed. Job recorded: `id: gate-mr4x50bb-yo1qvm`, `jobClass: "gate"`, `kindLabel:
   "Claude Stop Gate Review"`, `status: "completed"`.
2. Second round reviewed a genuine code-editing turn (added and committed a real `multiply(a, b)`
   function). The TUI showed `Running 2 Stop hooks` while it ran (confirms Codex actually invokes this
   hook process, not a no-op), then after ~35s: `Stop hook (completed) / warning: claude stop-gate
   skipped: malformed gate output` — the turn ended normally (not blocked), with our `systemMessage`
   surfaced verbatim by Codex as a `warning:` line. Inspecting the job file
   (`~/.codex/claude-companion/<repo-hash>/jobs/gate-mr4x756d-sh5tnb.json`) showed the reviewer's real
   `finalText` was a full, *correct* review — it verified the actual commit/diff/exports, concluded
   there were no issues — but wrote several paragraphs of investigation narrative **before** the
   `ALLOW: ...` line, instead of putting `ALLOW:`/`BLOCK:` as the literal first line per the prompt's
   `compact_output_contract`. The hook's parser (checks only `rawOutput.split(/\r?\n/,1)[0]`) correctly
   classified this as non-compliant and took the fail-open "malformed gate output" branch rather than
   guessing, misparsing, or blocking on a partial match — exactly the required behavior. **Finding for
   future work (not fixed here, per the brief's "keep the exact output contract" instruction):** real
   models asked to "verify against the repository state" before answering (the `grounding_rules`/
   `dig_deeper_nudge` sections) tend to narrate that investigation in the same final message rather
   than confining it to a strictly-first `ALLOW:`/`BLOCK:` line, so in practice a non-trivial fraction
   of real code-change reviews may land on the fail-open "malformed" path (safe, but underuses the
   gate's actual signal) rather than a clean `ALLOW:`/`BLOCK:`. A future revision could parse the
   *last* `ALLOW:`/`BLOCK:`-prefixed line in the response instead of strictly the first, or add a
   closing reminder to the prompt repeating the first-line rule right before the response point.

Net: the full contract is confirmed live end-to-end — real hook process spawn, real short-lived
appserver spawn (`CLAUDE_COMPANION_APPSERVER` pointed at the built `app-server/dist/bin.js`), a real
Claude thread/turn per gate check, correct job bookkeeping (`gate-` prefix, "Claude Stop Gate Review"
label), and fail-open behavior holding on a genuine (not manufactured) edge case.
