# Claude Plugin for Codex (`claude-plugin-codex`) — Design Spec

**Date:** 2026-07-03
**Status:** design (awaiting user review → implementation plan)
**Feature:** the exact mirror of OpenAI's `codex-plugin-cc` (a Claude Code plugin that spawns Codex
workers via `codex app-server`): a **Codex plugin that spawns Claude workers** via our
`cc-codex-appserver` (the Claude-backed drop-in for `codex app-server`,
`CC-to-SDK/app-server/`). Delegate tasks and reviews to Claude from inside Codex, with background
jobs, polling, cancellation, and an optional stop-review gate.

---

## 1. Goal & context

`codex-plugin-cc` (cloned at `CC-to-SDK/codex-plugin-cc/`, upstream `openai/codex-plugin-cc`) gives
Claude Code users `/codex:rescue`, `/codex:review`, `/codex:adversarial-review`, `/codex:status`,
`/codex:result`, `/codex:cancel`, `/codex:setup`, `/codex:transfer` — all driven through the Codex
app-server JSON-RPC protocol.

Because `cc-codex-appserver` speaks that **same protocol** backed by Claude, the mirror needs no new
protocol: a Codex-side plugin reuses the original's client spine and points it at our binary instead
of `codex app-server`. The work is (a) re-expressing the plugin surface in **Codex's** plugin format,
(b) porting the provider-agnostic runtime spine, and (c) closing a small, pre-verified protocol gap
in `cc-codex-appserver`.

**Scope decision (user-approved):** full mirror **minus `/transfer`**. Session transfer
(Codex rollout → Claude session) has no importer on either side; it is a fresh feature, deferred.

**Architecture decision (user-approved):** MCP-server engine (see §3).

---

## 2. The source blueprint and what ports

From the full functional map of `codex-plugin-cc` (research 2026-07-03):

**Ports nearly verbatim (provider-agnostic spine)** — all under `plugins/codex/scripts/lib/`:
`args.mjs`, `process.mjs` (spawn/terminateProcessTree), `fs.mjs`, `prompts.mjs` (template
interpolation), `git.mjs` (review-target resolution + context collection), `state.mjs` /
`tracked-jobs.mjs` / `job-control.mjs` (file-based job store, progress, polling, cancel),
`render.mjs` (minus label strings), the `captureTurn` streaming state machine + JSON-RPC client
core in `app-server.mjs`/`codex.mjs`, and `schemas/review-output.schema.json`.

**Swapped:**
- Binary: `spawn("codex", ["app-server"])` → spawn `cc-codex-appserver` (discovery in §8).
- Models/effort: `spark→gpt-5.3-codex-spark` aliases → Claude aliases (§5); effort enum → harness
  thinking levels.
- Prompts: `gpt-5-4-prompting` skill + templates → Claude-worker prompting doctrine.
- Branding/namespacing: `codex:*` → `claude` plugin; "Resume in Codex" → n/a round one (§13).

**Dropped (deliberately):**
- **The broker** (`app-server-broker.mjs`, `broker-*.mjs`, unix sockets/named pipes, single-flight
  + interrupt pass-through). It existed because each CC command invocation was a fresh short-lived
  process needing to share one app-server. Our engine is a long-lived MCP server — it *is* the
  shared process. Nothing replaces the broker.
- `review/start` usage: the original used it only for native review; adversarial review was always
  `turn/start` + `outputSchema`. The mirror does **both** reviews via `turn/start` + schema.
- `thread/list` fallback: tracked job files were always the primary source of resume candidates;
  round one uses them exclusively.
- `/codex:transfer` + `externalAgentConfig/import` (deferred, §13).

---

## 3. Host-surface constraints → architecture

Two research findings force the shape:

1. **Codex plugins cannot ship slash commands or subagent definitions.** The manifest supports
   exactly: `skills`, `hooks`, `mcpServers`, `apps` (`codex-rs/core-plugins/src/manifest.rs`,
   `PluginDetail` in `app-server-protocol/src/protocol/v2/plugin.rs:640`). Commands re-express as
   **MCP tools** (engine) + **skills** (guidance).
2. **Sandbox asymmetry.** In CC, plugin scripts ran via the Bash tool (no network sandbox by
   default). In Codex, model-run shell executes inside the seatbelt sandbox with **network blocked
   by default** — fatal for a Claude worker that needs the Anthropic API. MCP servers are spawned
   by Codex itself, outside the exec sandbox. Therefore the engine is an MCP server; shell is used
   only by hook handlers (which also run harness-side).

**Engine:** one zero-dependency Node ESM MCP server (`claude-companion`), spawned by Codex per
session via the plugin's `.mcp.json`. It embeds the ported spine, holds the `cc-codex-appserver`
child over stdio, runs background jobs as in-process async tasks, and persists jobs to a file-based
state dir so `status`/`result` survive across Codex sessions.

```
Codex (host)
 ├─ skills: claude-delegation, claude-prompting
 ├─ hooks: Stop → stop-review-gate-hook.mjs (command handler, harness-side)
 └─ MCP server "claude-companion" (unsandboxed, stdio)
     ├─ tools: rescue / review / adversarial_review / status / result / cancel / setup
     ├─ job store (state/tracked-jobs/job-control ports; file-based)
     └─ spawns → cc-codex-appserver (stdio, Codex v2 JSON-RPC "lite")
                 └─ Claude Agent SDK → Claude worker
```

**MCP stdio is hand-rolled** (~150 LoC: `initialize`, `notifications/initialized`, `tools/list`,
`tools/call` over newline-delimited JSON-RPC 2.0) to keep the plugin **zero-runtime-dependency**
like the original — Codex's plugin cache copies files; it does not run `npm install`.

---

## 4. Project layout

A sibling project mirroring the `codex-plugin-cc` repo shape:

```
CC-to-SDK/claude-plugin-codex/
├── .agents/plugins/marketplace.json      # local marketplace catalog: { source: "local", path: ./plugins/claude }
├── plugins/claude/
│   ├── .codex-plugin/plugin.json         # name "claude"; declares mcpServers, hooks, skills
│   ├── .mcp.json                         # claude-companion: node scripts/claude-companion-mcp.mjs
│   ├── skills/
│   │   ├── claude-delegation/SKILL.md    # merges codex-cli-runtime + codex-result-handling contracts
│   │   └── claude-prompting/SKILL.md     # Claude-worker prompting doctrine (+ references/)
│   ├── hooks/hooks.json                  # Stop → scripts/stop-review-gate-hook.mjs (timeout 900)
│   ├── scripts/
│   │   ├── claude-companion-mcp.mjs      # MCP server entry
│   │   ├── stop-review-gate-hook.mjs     # hook entry
│   │   └── lib/                          # ported spine (§2) + mcp-stdio.mjs + appserver client
│   ├── prompts/                          # claude-review.md (new), adversarial-review.md (ported),
│   │   │                                 #   stop-review-gate.md (ported)
│   └── schemas/review-output.schema.json # reused verbatim
├── tests/                                # node:test suites (§11)
├── package.json                          # dev deps only (typescript for JSDoc checks), engines node>=18.18
└── README.md                             # mirror of the original's README, Claude-flavored
```

Install loop (dev): `codex plugin marketplace add <abs path to claude-plugin-codex>` →
`codex plugin add claude@<marketplace>` → new thread. (Verification V5.)

---

## 5. Tool surface

Seven MCP tools, 1:1 with the original's commands. All take an optional `cwd` (workspace root —
the model fills it; adjusted if V3 shows Codex provides it). All return human-readable Markdown
(the ported `render.mjs` output), never protocol errors.

| Tool | Params (beyond `cwd`) | Mirrors |
|---|---|---|
| `rescue` | `prompt` (req), `model?`, `effort?`, `write?` (default true), `resume?`/`fresh?`, `wait?` | `/codex:rescue` (+ `codex-rescue` agent collapse, §6) |
| `review` | `base?`, `scope?` (`auto`\|`working-tree`\|`branch`), `wait?` | `/codex:review` |
| `adversarial_review` | `base?`, `scope?`, `focus?`, `wait?` | `/codex:adversarial-review` |
| `status` | `job_id?`, `wait?` (poll ≤240s / 2s) | `/codex:status` |
| `result` | `job_id?` | `/codex:result` |
| `cancel` | `job_id?` | `/codex:cancel` |
| `setup` | `enable_review_gate?`, `disable_review_gate?` | `/codex:setup` |

- **Model aliases:** `opus→claude-opus-4-8`, `sonnet→claude-sonnet-5`,
  `haiku→claude-haiku-4-5-20251001`, `fable→claude-fable-5`; full ids pass through; omitted →
  appserver/harness default (`claude-opus-4-8`).
- **Effort:** `low|medium|high|xhigh|max` → harness thinking levels (wired in §7); omitted →
  harness default.
- **Background-first:** `rescue`/`review`/`adversarial_review` default to background (return job id
  immediately); `wait:true` opts into foreground. Rationale: Codex MCP tool calls have a finite
  configurable timeout and there is no mid-call user prompt to mirror the original's
  wait-vs-background `AskUserQuestion` (V4 informs docs/defaults).
- **The `codex-rescue` subagent collapses into the tool.** The original needed a thin sonnet agent
  to translate a request into one companion CLI call; an MCP tool with a typed schema *is* that
  translation. The `claude-delegation` skill carries the agent's routing rules
  (resume-vs-fresh, alias mapping, default `--write`) as model guidance instead.

---

## 6. Runtime flows

**rescue.** Create job record (id `task-<base36>-<rand>`, persisted `queued`) → resolve thread:
`resume` → `thread/resume` with the newest tracked threadId for this workspace; else
`thread/start`. Thread params mirror the original: `approvalPolicy:"never"` (→ appserver posture
`permissionMode:"auto"`, no approval round-trips), `sandbox: "workspace-write"` when `write` else
`"read-only"`, `cwd`, `model`. Then `turn/start` with the prompt (+ `effort`). The ported
`captureTurn` consumes notifications (`turn/started`, `item/*`, `turn/completed`), streaming
progress into the job log + job JSON; the `final_answer` agentMessage is the result. Foreground:
tool result = rendered output. Background: in-process async task updates the same job files;
`status`/`result` read them. If no `resume`/`fresh` given and a resumable tracked thread exists,
the tool result *offers* it ("call again with `resume:true` to continue thread …") — the
interactive question becomes a model-mediated round-trip.

**review / adversarial_review.** Same git targeting as the original (`git.mjs` port):
`auto` = working-tree if dirty else branch-vs-default-branch; `base` forces branch review. Context
collection identical (inline diff if ≤2 files & ≤256KB, else self-collect instructions — note the
worker's Read/Grep run under the SDK sandbox with `read-only` posture). Both run
`turn/start` + `outputSchema` (review schema) on a fresh `read-only` thread; `review` uses the new
neutral `claude-review.md` prompt, `adversarial_review` the ported adversarial prompt with
`focus` interpolated. Output parsed/normalized/sorted by the ported `render.mjs`
(findings-first, severity-ordered, exact file:line).

**status / result / cancel.** Pure job-store reads (ported `job-control.mjs`: newest-first,
enriched with phase/elapsed/log-tail preview; Markdown table for the no-arg form). Jobs are scoped
**per workspace** (state dir keyed by realpath hash, as the original) — not per host session; the
original's session binding came from a CC `SessionStart` env hook with no Codex equivalent, and
workspace scoping is the useful part. `cancel` resolves the active job → `turn/interrupt` (new,
§7) → mark `cancelled`; if the RPC fails, kill and respawn the appserver child (cancel-by-kill is
the documented fallback semantic of the current appserver).

**setup.** Reports: worker binary found (discovery §8) + version; auth state via `account/read`
(new, §7) — "logged in via Claude subscription (OAuth)" / "API key" / "not authenticated" with
`claude setup-token` / env-var guidance; review-gate state. `enable_review_gate` /
`disable_review_gate` toggle `config.stopReviewGate` in the state dir. Missing worker → install
guidance (§8). Every other tool short-circuits to this guidance when the worker is unavailable
(mirrors `getCodexAvailability` gating).

**Stop review gate.** `hooks.json`: `Stop` → command handler `stop-review-gate-hook.mjs`
(timeout 900s). The hook reads stdin JSON, loads gate config from the workspace state dir, and if
enabled spawns a **short-lived** appserver (it cannot reach the MCP server's child) to run the gate
turn: `stop-review-gate.md` ported, `{{CLAUDE_RESPONSE_BLOCK}}` ← the hook input's last assistant
message field (exact field per V1 schema). First output line `ALLOW: <reason>` → allow;
`BLOCK: <reason>` → emit the blocking decision; malformed/timeout/worker-missing → **allow with a
logged warning** (fail-open — see divergence note in §12). Gate jobs are recorded in the job store
relabeled "Claude Stop Gate Review" (mirror of `STOP_REVIEW_TASK_MARKER`).

**Teardown.** Codex kills the MCP server at session end → appserver child gets stdin EOF and
disposes (its documented shutdown path); running background jobs are marked `interrupted` on next
`status` read via a liveness check (pid + heartbeat timestamp in the job JSON — the
teardown-liveness pattern). This matches the original's semantics: its `SessionEnd` hook also
killed the session's running jobs.

---

## 7. `cc-codex-appserver` extensions (v0.2 — all backward-compatible)

| Method | Backing (all pre-verified live) | Notes |
|---|---|---|
| `turn/interrupt` | `Session.interrupt()` (`harness/src/session/session.ts:108`) | Reply `{}`; translator emits `turn/failed` `{reason:"interrupted"}` for the captured turn. |
| `thread/resume` | SDK session-store resume (probe: session-store suite) | Registry maps threadId→resumed Session; same posture/sandbox params as `thread/start`. Thread ids are globally-unique `thr_<8-hex>` (Task 3's `registry.ts` `allocId()`), persisted in a file-based **sidecar** (`app-server/src/threads.ts`: `recordThread`/`lookupThread`, atomic writes, pruned to the newest 200) mapping threadId → SDK `sessionId` + `cwd`. `thread/resume` looks the id up here, rebuilds thread config with `resume: sessionId`, and replies `-32602 INVALID_PARAMS` on an unknown id — this is what lets a resume survive an appserver process restart, not an in-memory-only registry. |
| `account/read` | `accountInfo()` (probe 28) | Map to `{ account: { type: "chatgpt"-analog … } }` shape the client's classifier reads; exact field mapping written against the plugin client's `codex.mjs:817-958` expectations. |
| `thread/name/set` | no-op | Accept + `{}` (the original tolerates "unknown method" here anyway). |
| `config/read` | static stub | `{ config: { model: <harness default> } }`, enough for the client's provider probe not to error. |
| `effort` wiring | harness thinking levels (P1 probe) | Accept `effort` on `thread/start`/`turn/start`; map `low…max` → `setMaxThinkingTokens` levels. |

**Stretch (not blocking ship):** translator emits `commandExecution`/`fileChange` item
notifications derived from SDK `tool_use` blocks (Bash / Edit-Write), so `status` progress previews
show real activity. Without it, previews show agentMessage text only — functional, sparser.

**`outputSchema` rides `thread/start` directly** — it is a field on `ThreadStartParams` (not a
separate call/method, and not on `turn/start`): `thread/start {..., outputSchema}` is consumed
inside `buildCfg`, which sets the SDK's `outputFormat: {type:"json_schema", schema: outputSchema}`
(Task 8). §6's `review`/`adversarial_review` flows already pass the review schema exactly this way.

**Probe 36 verdict (structured output, response side):** `outputFormat` is genuinely wired into the
SDK turn — `Session.submit()` resolves an additive `structuredOutput` field from the SDK's own
`structured_output` result — but that value is **not yet surfaced on the appserver's JSON-RPC
wire**: `runTurn` still returns only `{result}` to the client. This is a deliberate, already-flagged
scope boundary (Task 8's own report, revisited and left open by Task 13), not a blocker here: this
project's `review`/`adversarial_review` tools don't depend on it — they parse the model's raw final
text as JSON themselves (`parseStructuredOutput`) and fall back to raw-output rendering on a parse
failure, exactly as §6/§9 already describe. See Task 8's and Task 13's reports for the exact
wire-shape gap if a future task wants to close it.

Existing consumers are unaffected: the Director never calls the new methods, and no existing
response shape changes. New unit tests per method; the contract fake (`CC_APPSERVER_FAKE=1`) learns
scripted responses for the new methods so plugin tests stay key-free.

---

## 8. Worker discovery & auth

**Discovery order** (mirrors "global `codex` binary" with a dev escape hatch):
1. `CLAUDE_COMPANION_APPSERVER` env (absolute path or command) — also the dev hook: point it at
   `CC-to-SDK/app-server/dist/bin.js`,
2. `cc-codex-appserver` on `PATH`.

Availability probe: spawn candidate with `app-server --help`-style args and a 5s `initialize`
handshake (the binary tolerates Codex-style argv). Install guidance mirrors
`npm install -g @openai/codex`: round one documents `npm install -g` from the local
`CC-to-SDK/app-server` checkout (package is unpublished; publishing is out of scope).

**Auth** is entirely delegated (the appserver has no auth code): the SDK-spawned `claude` CLI uses
the user's stored Claude Code login; `CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY` in the
environment also work (API key shadows the token). **This requires an explicit `env_vars`
whitelist, not just env inheritance** (V2 corrects the original assumption of a passthrough): Codex
only forwards a small fixed base set to an MCP child plus whatever keys the server's own
`env_vars` array in `.mcp.json` names, so `plugins/claude/.mcp.json` whitelists exactly
`CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, `CLAUDE_COMPANION_APPSERVER`,
`CLAUDE_COMPANION_DATA` — a var set on the host shell but missing from this list never reaches
`claude-companion` at all. `setup` surfaces the state via `account/read`. FAQ story mirrors the
original: *"uses your local Claude Code authentication."*

---

## 9. Error handling

- **Worker missing / not authenticated:** every tool returns the setup guidance text (never a
  protocol error).
- **Appserver child crash mid-turn:** job → `failed` with the stderr tail (child stderr is piped
  to the job log, unlike the Director's DEVNULL).
- **Child liveness:** MCP server respawns the child on next tool call if it died idle.
- **Malformed structured output** (reviews): fall back to raw output rendering (ported behavior).
- **Concurrency:** threads are independent SDK sessions — no single-flight semantics needed; cap
  concurrent background jobs at 3 per workspace, further `rescue`/review calls queue as `queued`
  jobs (visible in `status`).
- **Job files:** pruned to the original's `MAX_JOBS=50` per workspace.

---

## 10. Verification items (live-probe-first, Codex-side)

The A1 discipline aimed at the *Codex host* — each is settled by a live check on the user's
installed `codex` before the dependent piece is built:

- **V1 — Stop-hook block semantics:** does Codex's `Stop` hook support block-with-reason
  (decision JSON) like CC's? Source: `codex-rs/hooks/schema/generated/*.schema.json` + a live hook.
  If blocking is unsupported → gate degrades to a warning injection (`prompt`-type handler or
  logged note) and §6's gate section is amended.
  **Answer (confirmed):** yes — a clean exit 0 with `{"decision":"block","reason":"..."}` works
  exactly like CC's: the reason feeds back to the model and the turn continues rather than ending.
  Confirmed at the source/contract level (`codex-rs/hooks/src/events/stop.rs`, e.g. the
  `block_decision_with_reason_sets_continuation_prompt` test + the generated schema's `reason`
  requirement) and by Task 15's shipped `stop-review-gate-hook.mjs`, whose `block(reason)` branch
  implements exactly this shape; the live interactive session in `docs/host-facts.md` §8 exercised
  the same hook end-to-end on real turns (both the compliant `ALLOW:` and the fail-open
  "malformed gate output" paths fired for real) confirming the hook process/trust/parsing pipeline
  works, though that particular run didn't happen to land a genuine `BLOCK:` verdict. No degrade
  needed — §6's gate section stands as designed.
- **V2 — MCP-server spawn environment:** unsandboxed network, env inheritance, spawn cwd.
  **Answer (confirmed, `docs/host-facts.md` §1–2):** MCP servers run **unsandboxed** (outside
  Codex's exec seatbelt, network open) and spawn with **cwd = the plugin's installed cache root**
  (`~/.codex/plugins/cache/<marketplace>/<plugin>/<version>/`), not the session workspace — but only
  because `.mcp.json` declares `"cwd": "."` explicitly; without it Codex resolves relative `args`
  paths against the session workspace instead (the crash this repo's `.mcp.json` had to route
  around). Env is **not** a raw passthrough: the child gets a small fixed base set
  (`HOME`/`LANG`/`LOGNAME`/`PATH`/`SHELL`/`TERM`/`TMPDIR`/`USER`/`__CF_USER_TEXT_ENCODING`) plus only
  the keys the server's own `env_vars` array whitelists **and** that are actually set on the host
  shell (absent-if-unset, never present-as-empty).
- **V3 — Workspace cwd delivery:** does Codex pass workspace roots to MCP servers (initialize
  params / tool-call context)? Until proven, tools carry an explicit `cwd` param.
  **Answer (confirmed, `docs/host-facts.md` §1, §3):** no — Codex does not pass workspace roots to
  MCP servers (per V2 their cwd is the plugin cache root, not the workspace), so every tool keeping
  an explicit `cwd` param (as designed) is load-bearing, not defensive. Task 16 flagged omitting it
  as the #1 usage footgun (the "cwd footgun"): any tool that mutates/reads workspace-scoped state
  silently targets the wrong directory if `cwd` isn't passed (see `setup`'s workspace-cwd footgun in
  `docs/host-facts.md` §8).
- **V4 — MCP tool timeout:** default + per-server config (`tool_timeout_sec`); informs the
  background-first defaults and README guidance.
  **Answer (confirmed, `docs/host-facts.md` §2 + this project's shipped `.mcp.json`):** default is
  300s; `plugins/claude/.mcp.json` raises it to `"tool_timeout_sec": 1200` (20 minutes) for the
  `claude-companion` server. The background-first design (§5) keeps most long-running calls off this
  ceiling entirely — 1200s is headroom for the `wait:true` foreground path, not the common case.
- **V5 — Install loop:** local marketplace add → plugin add → skills visible + MCP tools callable
  + hook registered, on the user's installed codex.
  **Answer (confirmed working, `docs/host-facts.md` §7):** `codex plugin marketplace add <path>` →
  `codex plugin add claude@cc-claude` installs the plugin (skills, MCP tools, hook) as designed; the
  dev loop after editing source is a plain re-run of `codex plugin add claude@cc-claude` — it
  overwrites the cache copy in place, **no version bump required** (confirmed via
  `diff -r plugins/claude ~/.codex/plugins/cache/cc-claude/claude/0.1.0` showing zero drift after a
  re-add).

---

## 11. Testing

- **Unit (`node:test`, mirroring the original's suites):** job store / tracked-jobs / job-control
  ports (including the pid+heartbeat liveness check), args + alias/effort mapping, prompt
  interpolation, git target resolution, render, MCP stdio framing + dispatch, `captureTurn` against
  recorded notification streams (including the missing-`turn/completed` inferred-completion path).
- **Contract (key-free):** the real MCP server spawning the real `app-server/dist/bin.js` under
  `CC_APPSERVER_FAKE=1`, driven end-to-end: `rescue` → `status` → `result`; `cancel` mid-turn;
  `setup` against the fake; review flow with scripted schema output.
- **Appserver (vitest, in `app-server/`):** new-method unit tests + fake-mode scripting for them.
- **Live (gated on `CC-to-SDK/.env` creds, skips cleanly):** one real `rescue` round-trip
  (foreground, small prompt) + one `adversarial_review` asserting schema-valid findings.
- **Teardown-liveness tests first** (the recurring bug class): child-death mid-turn, MCP-server
  SIGTERM with a running background job, appserver stdin-EOF disposal, cancel-during-stream.
- **Manual (V5):** install into the user's codex; run the README quick-start
  (`rescue` → `status` → `result`).

---

## 12. Accepted divergences from the original

1. **No slash commands / no subagent** — Codex plugins can't ship them; MCP tools + skills replace
   them (§3, §5).
2. **Background jobs die with the host session** — same effective semantics as the original's
   `SessionEnd` kill; jobs *records* persist and are readable next session.
3. **No broker** — architectural simplification with identical observable behavior.
4. **Reviews are prompted turns, not `review/start`** — output contract (schema) unchanged.
5. **Wait-vs-background prompt becomes background-first + model-mediated resume offers** — Codex
   MCP tools cannot ask the user mid-call.
6. **Stop gate fails open** (allow + warning) where the original failed closed (block with
   guidance) on malformed/timeout — a blocking failure inside Codex's hook engine with a
   900s-timeout risks wedging the host session; revisit after V1.
7. **Per-workspace (not per-session) job scoping** — no CC-style `SessionStart` env-file mechanism
   in Codex.
8. **Progress previews sparser** until the §7 stretch item lands.

---

## 13. Out of scope / deferred

- `/transfer` (Codex→Claude session import) — fresh feature, own spec later.
- Publishing `cc-harness-appserver` to npm; marketplace distribution beyond the local catalog.
- "Resume in Claude Code" affordance on results (the original prints `codex resume <id>`; a
  `claude --resume <sessionId>` analog needs the appserver to expose the underlying SDK session id
  — deferred with `/transfer`).
- `thread/list`-backed resume discovery (tracked jobs suffice).
- Windows named-pipe/broker paths (no broker) and Windows testing generally.

## 14. Ship checklist

Unit + contract green key-free; live pair green keyed; V1–V5 answered and folded back into this
spec; README quick-start verified via V5; `docs/parity/coverage.md` note (this is a new *consumer*
of the appserver, not a harness domain change) + memory refresh; commit per repo git rules.
