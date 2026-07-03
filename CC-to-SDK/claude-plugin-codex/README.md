# Claude plugin for Codex

Use Claude from inside Codex — delegate tasks to a Claude worker, or get a Claude-authored code review —
without leaving your Codex session.

This is the mirror image of [`codex-plugin-cc`](../codex-plugin-cc) (the Codex plugin for Claude Code): where
that plugin lets Claude Code call out to Codex, this plugin lets **Codex** call out to **Claude**.

## What You Get

A single MCP server (`claude-companion`) exposing seven tools, plus a skill pair that teaches Codex how to use
them well:

- `rescue` — delegate a coding/investigation task to a Claude worker (background by default).
- `review` — a read-only Claude review of your working tree or a branch diff.
- `adversarial_review` — a steerable, challenge-oriented Claude review (`focus` lets you point it at a
  specific risk area).
- `status` — check on background jobs (all of them, or one by `job_id`).
- `result` — fetch the stored output of a finished job.
- `cancel` — stop an active (queued or running) job.
- `setup` — report whether the Claude worker is installed, reachable, and authenticated; also toggles the
  optional Stop review gate.
- **`claude-delegation`** and **`claude-prompting`** skills — internal guidance (not user-invocable) that
  teaches Codex the tool etiquette (always pass `cwd`, one `rescue` call per task, background-by-default,
  never auto-apply review findings) and how to write effective Claude prompts.
- An optional **Stop review gate** (a Codex hook, disabled by default) that runs a quick Claude review of each
  response and can block the turn if it finds something worth fixing first.

## Requirements

- **Node.js 18.18 or later.**
- **A local Claude Code login, or a `CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY`.** If you've already run
  `claude login` or `claude setup-token` on this machine, that's picked up automatically — no extra config
  needed. See [FAQ](#faq) for the env-var alternative.
- **The `cc-codex-appserver` binary** — the worker this plugin talks to. It ships from this monorepo's
  `CC-to-SDK/app-server` package (name `cc-harness-appserver`, bin `cc-codex-appserver`). Install it globally:

  ```bash
  npm install -g /path/to/CC-to-SDK/app-server
  ```

  or point the plugin at any built copy without a global install by setting
  `CLAUDE_COMPANION_APPSERVER="node /path/to/app-server/dist/bin.js"` in your environment before launching
  Codex. If the worker can't be found, every tool reports the exact command above and tells you to re-run
  `setup`.

## Install

Register this repo as a local marketplace, then install the plugin from it:

```bash
codex plugin marketplace add /path/to/CC-to-SDK/claude-plugin-codex
codex plugin add claude@cc-claude
```

After that, ask Codex to check readiness:

```text
Call the setup tool from the claude-companion MCP server.
```

`setup` reports worker resolution, handshake, auth method, and the review-gate state.

**Dev loop:** after editing plugin source, re-run `codex plugin add claude@cc-claude` — it overwrites the
installed cache copy in place; no version bump is needed for a local marketplace to pick up source edits.

One simple first run, from inside a git repo:

```text
Review my current changes with Claude in the background, then check status and show me the result.
```

## Usage

There are no slash commands here — Codex decides on its own when to call these tools, guided by the
`claude-delegation` skill. You can also ask for them explicitly, or drive them directly for scripting. Every
example below assumes you're in the repo you want the tool to act on; **the tools default to the server's own
cwd if you don't pass one explicitly, which is almost never what you want** — always say "in this repo" /
"in my current directory" (or pass `cwd` yourself) when calling them directly.

### `rescue`

Delegate an investigation, a fix, or follow-up work to a Claude worker.

```text
Ask Claude to investigate why the tests started failing.
Ask Claude to apply the smallest safe fix for the flaky integration test, and wait for the result.
Ask Claude to continue the last rescue thread in this repo and try the top suggested fix.
```

Args: `prompt` (required), `model` (`opus`|`sonnet`|`haiku`|`fable`|full id), `effort`
(`low`|`medium`|`high`|`xhigh`|`max`), `write` (default `true`), `resume`, `fresh`, `wait` (default `false` —
background), `cwd`.

If a prior rescue thread exists for the repo and you pass neither `resume` nor `fresh`, the call returns a
resume-offer message instead of starting work — Codex will ask you whether to continue it or start fresh.

### `review`

A normal, read-only Claude review of your uncommitted changes or a branch diff.

```text
Have Claude review my current changes.
Have Claude review this branch against main.
```

Args: `base` (branch ref), `scope` (`auto` default | `working-tree` | `branch`), `wait`, `cwd`. Never edits
files.

### `adversarial_review`

A steerable review that actively tries to disprove the change — good for pressure-testing a risky decision
before shipping.

```text
Have Claude adversarially review this, focused on race conditions in the job queue.
```

Args: same target args as `review`, plus `focus` (free text). Also read-only.

### `status`

```text
What's the status of my background Claude jobs?
Check on job task-abc123.
```

Args: `job_id` (optional, accepts a unique prefix), `wait` (poll every ~2s up to 240s), `cwd`.

### `result`

```text
Show me the result of the last Claude job.
Show me the result of task-abc123.
```

Args: `job_id` (optional, defaults to the latest finished job), `cwd`.

### `cancel`

```text
Cancel my running Claude review.
```

Args: `job_id` (required only if more than one job is active), `cwd`.

### `setup`

```text
Check whether the Claude worker is set up.
Enable the Claude review gate for this repo.
```

Args: `enable_review_gate`, `disable_review_gate` (both booleans), `cwd`. **Pass `cwd` explicitly** for the
gate toggle — it's workspace-scoped state, and the server's default `cwd` is not your session's directory.

## Review gate

The optional Stop hook runs a short Claude review of Codex's last response and can block the turn with
feedback before it's shown to you. It's off by default; turn it on with `setup {enable_review_gate: true}`
(pass `cwd`) and off the same way.

> [!WARNING]
> The review gate adds a Claude turn to every Codex response and can create a long back-and-forth loop. It
> will drain your usage limits (Codex and Claude both) faster than normal. Only enable it when you plan to
> actively monitor the session.

**It is fail-open, not fail-closed** — this is a deliberate difference from the `codex-plugin-cc` blueprint's
gate. The gate only blocks when the reviewer returns a well-formed `BLOCK: <reason>` first line. Every other
outcome — gate disabled, no assistant message to review, the worker being unavailable, a timeout, or
malformed/unparseable reviewer output — allows the stop silently (optionally with a short diagnostic
`systemMessage`), rather than blocking or hanging. A genuinely broken gate should never be able to trap a
session.

## FAQ

### Do I need a separate Claude account for this plugin?

No. It uses your local Claude Code authentication — if you're already logged in (`claude login` or `claude
setup-token`) or have `CLAUDE_CODE_OAUTH_TOKEN`/`ANTHROPIC_API_KEY` set in your environment, `setup` will
report it as ready. The worker process is spawned fresh per Codex session but reuses whatever auth your shell
already has.

### I want to use an API key or OAuth token instead of my local login. How?

The plugin's `.mcp.json` already whitelists `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`,
`CLAUDE_COMPANION_APPSERVER`, and `CLAUDE_COMPANION_DATA` via its `env_vars` list — Codex only forwards a
small fixed base environment (`HOME`, `PATH`, etc.) to the spawned MCP server, plus whatever's explicitly
whitelisted there. So exporting one of those four vars in the shell you launch Codex from is enough; you
don't need to edit `.mcp.json` yourself unless you want to whitelist something else. Note `ANTHROPIC_API_KEY`
shadows the OAuth token when both are set.

### Does this use a separate Claude runtime?

It spawns `cc-codex-appserver`, a small JSON-RPC worker built on the Claude Agent SDK — not the interactive
`claude` CLI directly, but the same SDK and the same local auth state that `claude` uses.

## Accepted divergences from the `codex-plugin-cc` blueprint

This plugin intentionally simplifies a few things relative to its Codex-side counterpart:

- **Background jobs die with the Codex host session.** `codex-plugin-cc` runs each background job as a
  detached OS process that survives independently of the invoking command. This plugin instead runs
  background jobs in-process inside the long-lived `claude-companion` MCP server, which Codex spawns once per
  session — if that session ends, any still-running background job ends with it. Use `wait:true` for anything
  you need to survive past the current session.
- **Jobs are workspace-scoped, not session-scoped.** The job store (and `rescue`'s resume-thread lookup) is
  keyed by git workspace root, not by Codex session/conversation id. Two concurrent Codex sessions in the same
  repo share job visibility and the same resume offer — an accepted simplification rather than a per-session
  namespace.
- **No `/transfer` equivalent yet.** `codex-plugin-cc` can hand a Claude Code session off to Codex as a
  resumable thread. There's no reverse (Codex → Claude session import) tool here yet.
