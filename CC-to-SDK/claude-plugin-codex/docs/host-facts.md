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
