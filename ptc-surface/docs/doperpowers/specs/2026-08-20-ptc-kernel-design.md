# PTC — Programmatic Tool Calling for Claude Code on a Persistent IPython Kernel

## Purpose

Claude Code drives every tool call through one model inference round-trip, and every tool result
lands in the model's context. That shape is fine for "read this file, edit that line" work and bad
for the workloads the RLM literature measures: bulk read-and-filter over hundreds of files,
semantic map-reduce over chunks, fan-out to many subagents with programmatic fan-in, long
iterative loops whose intermediate state should live in variables rather than conversation
history.

**PTC** (Programmatic Tool Calling) gives a Claude Code session a **persistent IPython kernel** as
a tool, with Claude-Code-equivalent capabilities pre-bound as Python functions. After this change,
a user can ask Claude Code to "audit all 400 test files for flaky patterns" and watch it write one
Python cell that reads every file into variables, filters them deterministically, fans out three
`agent.spawn(...)` children over the survivors, gathers their answers, and prints a 30-line
summary — with the model's context receiving only that summary. State (variables, imports, parsed
data, child-agent handles) persists across tool calls, across turns, across compaction, and across
`claude --resume`.

To see it working end to end:

```bash
cd ptc && uv run ptc setup          # provision the kernel venv
claude --plugin-dir ./plugin        # start Claude Code with the ptc plugin
# in the session:  "use the ptc kernel: load all *.py under src/, count defs per file,
#                   keep the result in a variable, show top 10"
# later, after quitting:  claude --resume <session-id>
#                   "print the variable from before"   → same data, no re-read
```

This is the productization of the conversation in `ptc-surface/Conversation.md` (external input:
RLM harnesses, Prime Agent, Anthropic PTC): Prime Agent's programming model, transposed onto
Claude Code as an MCP server + CLI + skill instead of a whole replacement harness.

### Terms of art

- **RLM** (Recursive Language Model): an inference harness where long context and intermediate
  state live in an external REPL as variables, and the model writes code — including sub-model
  calls — to process them.
- **PTC** (Programmatic Tool Calling): the narrower primitive — the model emits one program that
  orchestrates many tool calls; intermediate results stay out of model context.
- **Kernel**: a detached `ipykernel` process speaking the Jupyter wire protocol (ZeroMQ
  shell/iopub/control channels), one per Claude Code session, holding the Python namespace.
- **Cell**: one code submission to the kernel. Identified by the kernel's **execution count**
  (the integer IPython shows as `In [n]`), broadcast on iopub `execute_input`.
- **Yield**: `exec` returning `status: running` with a `cell_id` before the cell finishes, so the
  model regains control while the cell keeps running (Codex code-mode's `exec`/`wait` pattern).
- **Session key**: the string that names a kernel — normally the Claude Code session id.
- **Depth**: how many agent-spawn levels below the user's session a process is. The user's session
  is depth 0; its kernel-spawned children are depth 1.

## Non-goals (v1)

- No security sandbox. The kernel runs model-written code with the user's OS permissions —
  same trust model as Prime Agent, stated loudly (see Trust model).
- No `ccx serve` / fleet-attach backend, and no messaging *other running Claude Code sessions*.
  The `AgentBackend` seam exists so these can be added later.
- No in-kernel `glob()`/`grep()` functions and **no search guidance in the skill** — searching
  stays wherever the model already does it (its native rg-backed tools, or whatever it runs in a
  shell).
- No direct Anthropic API client anywhere. All model calls made *from the kernel* go through the
  Claude Agent SDK → `claude` CLI, billing the user's subscription when they are OAuth-logged-in.
- No dill/state snapshots: a kernel restart loses the namespace (child agents remain resumable
  via the on-disk registry). Prime's snapshot layer is future work.
- No Codex-side installation testing. Registering the same MCP server in Codex
  (`codex mcp add ptc -- ptc-mcp`) is documented, not exercised by the acceptance suite.
- No Workflow *tool* replication: `workflow` ships as thin helpers + doctrine, because PTC itself
  is the orchestration language (a Workflow script is just a Python cell here).

## Architecture

```
Claude Code session  (pid P, session id S, depth 0)
 ├─ native tools (Read/Edit/Bash/Agent/…)          ← unchanged; the hybrid lane
 ├─ plugin hook  SessionStart → ~/.ptc/run/claude-<P>.json  {session_id, cwd}
 ├─ Skill  ptc  (doctrine: when & how to use the kernel)
 └─ MCP server "ptc"  (stdio adapter, child of P)
        tools: exec · wait · interrupt · restart · kernels
        │   Jupyter protocol (jupyter_client / ZeroMQ)     ┌── ptc CLI (from Bash or a human shell)
        ▼                                                   ▼
   detached ipykernel, keyed by S     ~/.ptc/kernels/<S>/{connection.json, pid, cells/, audit.jsonl, agents.json}
        namespace:  read write edit bash agent llm web_fetch web_search history workflow
        ├─ agent(provider="claude") → claude-agent-sdk (in-kernel) → `claude` subprocesses (depth+1)
        ├─ agent(provider="codex")  → `codex app-server` stdio JSON-RPC client
        ├─ llm() / web_search()     → scoped one-shot SDK queries (subscription-billed)
        └─ idle watchdog (self-exits after PTC_IDLE_HOURS without a cell)
```

Three processes total, no broker daemon: **the kernel is the long-lived process** (spawned with
`start_new_session=True`, surviving Claude Code exit and adapter crashes), and both the MCP
adapter and the CLI are thin, stateless-ish Jupyter clients over the same connection file. The
Jupyter shell channel serializes cell execution kernel-side, so two clients cannot interleave
cells. The only host→kernel channel is environment at spawn; the only kernel→host channel is
Jupyter output. There is no reverse "host bridge" (Prime's `host_request` comm) because children
are spawned *from inside* the kernel — nothing authoritative lives in the adapter.

### Prior art this design leans on (pointers, not dependencies)

- **Prime Agent** (`ptc-surface/prime-agent/`): the doctrine text
  (`packages/coding-agent/src/core/prompts/rlm.ts`), the single-tool shape
  (`src/core/tools/ipython.ts`, 64 KiB/stream truncation, no cell timeout, interrupt-based),
  `edit` skill semantics (`skills/edit/`), admission-only `rlm()` (which we deliberately do NOT
  copy — see Decision Log).
- **Codex code-mode** (`codex-rs/code-mode-protocol/src/description.rs`): the `exec`/`wait`
  yield protocol, `cell_id` resumption, per-call output token budgets.
- **CC-to-SDK** (`CC-to-SDK/`): the Claude Agent SDK capability map (probes), the
  `codex app-server` client shape (`codex-plugin-cc/plugins/codex/scripts/lib/app-server.mjs`),
  OAuth-vs-API-key billing facts (probe 28).

## The kernel layer

### Provisioning

`~/.ptc/venv`, created and refreshed by `uv` (`ptc setup`, auto-run on first use):

- Python **3.12** (`uv python install 3.12; uv venv ~/.ptc/venv --python 3.12`).
- Packages: `ipykernel`, `jupyter_client`, `nest_asyncio`, `claude-agent-sdk`, `httpx`,
  `markdownify`, `pydantic`, `pyyaml`, `pandas`, `numpy`, plus the local `ptc` package
  (editable when run from a checkout).
- A `~/.ptc/venv/.ptc-version` stamp (package version + python version + dependency-set hash);
  mismatch triggers re-provision. A lock directory guards concurrent provisioning.

**Not** in the venv: `anthropic` (no API billing path), project dependencies (the skill forbids
installing a target project's deps into the kernel — run project code through the project's own
environment, verbatim Prime doctrine).

### Spawn and keying

A kernel is spawned on first `exec` for a session key:

```
~/.ptc/venv/bin/python -m ipykernel_launcher -f ~/.ptc/kernels/<key>/connection.json
```

- `start_new_session=True` (detached; survives the parent), `cwd` = the session's project
  directory, stdout/stderr → `~/.ptc/kernels/<key>/kernel.log`.
- Environment: the adapter's environment, minus nothing, plus
  `PTC_SESSION=<key>`, `PTC_CWD=<cwd>`, `PTC_DEPTH=<n>`, `PTC_MAX_DEPTH`, and the tunables below.
- `connection.json` mode 0600; a `pid` file enables liveness checks (`kill(pid, 0)`) and
  `ptc kill`.
- A bootstrap cell (executed by whichever client spawned the kernel, at
  `SNAPSHOT`-style raised output cap) binds the runtime API into the namespace, applies
  `nest_asyncio`, installs the per-cell output tee and the idle watchdog, and sets
  `NO_COLOR=1` / uncolored IPython.

**Session-key resolution**, in order (first hit wins):

1. Explicit `session` argument on the MCP tool call / `-s` on the CLI.
2. The plugin's **SessionStart hook** run-file: the hook process and the MCP adapter are both
   children of the same `claude` process, so both see the same `getppid()`. The hook writes
   `~/.ptc/run/claude-<PPID>.json = {"session_id": ..., "cwd": ..., "written_at": ...}`; the
   adapter reads `~/.ptc/run/claude-<its own PPID>.json`. Stale files (> 7 days, or dead pid)
   are garbage-collected opportunistically.
3. `PTC_SESSION` env (set for kernels' own child processes, so a child's adapter joins the
   child's key, not the parent's).
4. `CLAUDE_CODE_SESSION_ID` env (present in Bash-tool environments; makes the CLI correct by
   default).
5. Fallback: `adapter-<adapter pid>` (functional, but not resume-stable) — the adapter notes the
   degraded keying in its first tool result.

The skill additionally interpolates `${CLAUDE_SESSION_ID}` (Claude Code substitutes it inside
SKILL.md at load), so the model itself knows the session id and can pass `session=` explicitly if
resolution ever misfires. Same key ⇒ same kernel: `claude --resume <S>` reattaches to S's live
kernel with the namespace intact.

### Per-cell capture, audit, watchdog

- **Output tee (kernel-side)**: an IPython `pre_run_cell`/`post_run_cell` hook pair tees
  `sys.stdout`/`sys.stderr` for every cell into `~/.ptc/kernels/<key>/cells/<execution_count>.log`
  (raw, uncapped). Because capture is kernel-side, it works identically for MCP and CLI clients
  and survives adapter restarts; `wait` is implemented against these files.
- **Audit log**: every mutation made through the runtime API appends a JSON line to
  `~/.ptc/kernels/<key>/audit.jsonl`:
  `{ts, cell, kind: "write"|"edit"|"bash"|"agent", path?, added?, removed?, command?, task?, provider?}`.
  Raw `open(...,"w")` writes are *not* captured — the audit trail is visibility for the
  cooperative path, not enforcement (Trust model).
- **Idle watchdog (kernel-side thread)**: self-exits the kernel after `PTC_IDLE_HOURS` (default
  6) with no cell execution, removing its run directory's `pid` file. `ptc list` shows last-used
  times; `ptc kill`/`ptc restart` are the manual controls.

## The MCP adapter (`ptc-mcp`)

A stdio MCP server (Python `mcp` SDK), registered by the plugin's `.mcp.json`. It declares
server-level `instructions` (a ~10-line condensation of the skill: persistent namespace, assign
don't print, yield/wait, `session=` escape hatch) so the basics survive even when the skill is not
loaded. Five tools:

| tool | params | behavior |
|---|---|---|
| `exec` | `code: str` (required), `session?: str`, `timeout_s: int = 300`, `max_output_chars: int = 12000` | Run a cell. If the kernel is **idle**: submit, stream until done or `timeout_s`, then either return the finished result or yield `status: running` + `cell_id` + partial output. If the kernel is **busy** with another cell: do not queue silently — return `status: busy` + the running `cell_id` + guidance (`wait`, `interrupt`, or resubmit later). |
| `wait` | `cell_id: int`, `session?`, `timeout_s: int = 300`, `max_output_chars: int = 12000` | Return output produced since the previous yield for that cell (tail of `cells/<id>.log` past the recorded offset), plus completion status. May yield again. Works from a fresh adapter (offsets are kept in a sidecar `cells/<id>.offset`). |
| `interrupt` | `session?` | `interrupt_request` on the control channel, then SIGINT after 2 s if still busy. Returns the interrupted cell's tail. |
| `restart` | `session?` | Shut down + respawn + re-bootstrap. States plainly that the namespace was lost and child agents remain resumable via `agent.list()`. |
| `kernels` | — | List known kernels: key, pid, alive?, cwd, last-used, depth. |

### Result shaping (shared by MCP and CLI)

```
[cell 14 · ok · 1.8s]
<stdout>
<stderr, prefixed "stderr:" per line when both present>
<result repr, if the cell's last expression produced one>
<on error: ename+evalue and a trimmed traceback (frames inside ptc internals elided)>
edited src/a.py (+3/−1) · wrote notes/out.md · ran: npm test · spawned agent "api-reviewer"
```

- Header states cell id, status (`ok | error | running | busy | interrupted`), duration.
- **Truncation**: head+tail slices totaling `max_output_chars`, elision marker
  `… [truncated N chars — full output: ~/.ptc/kernels/<S>/cells/14.log]`. The cap keeps results
  far under Claude Code's default 25 000-token MCP output ceiling (`MAX_MCP_OUTPUT_TOKENS`).
- **Mutation footer** built from the cell's `audit.jsonl` entries (see above) — one line, only
  when mutations occurred.
- **Images**: `display_data` with `image/png`/`image/jpeg` (matplotlib, PIL) becomes an MCP image
  content block after the text block, capped at 2 per cell and ~1.5 MB each; always also saved to
  `cells/<id>-<k>.png` and named in the text. (Spike S5 verifies Claude Code renders the block;
  the file path is the fallback.)
- `structuredContent` mirrors everything machine-readably:
  `{cell_id, status, duration_ms, stdout, stderr, result_repr, error?, mutations[], images[], full_log}`.

Long-cell safety: Claude Code's MCP tool timeout defaults to ~27.8 h (`MCP_TOOL_TIMEOUT`), so the
adapter's own `timeout_s` yield is the binding limit, never the host's.

## The CLI (`ptc`)

Console script in the venv, also invocable as `uv run ptc`. Shares every code path with the
adapter (same client library, same result shaping, text output).

```
ptc setup                       # provision/refresh ~/.ptc/venv
ptc exec [-s KEY] [-t SECS] [CODE | -]     # run a cell (CODE arg, or stdin with -)
ptc wait  -s KEY CELL_ID [-t SECS]
ptc interrupt [-s KEY]
ptc restart   [-s KEY]
ptc list                        # kernels + last-used + alive
ptc kill [-s KEY | --all]
ptc doctor                      # venv state, versions, run-file visibility, claude/codex on PATH
```

Default `-s`: `$PTC_SESSION`, else `$CLAUDE_CODE_SESSION_ID`, else the newest live kernel (with a
notice). The CLI exists for humans debugging a kernel and for harnesses without MCP; the skill
does not teach it.

## The in-kernel runtime API

Pre-bound by bootstrap (also importable: `from ptc.runtime import *`). Local, instant operations
are **sync**; anything crossing a process or the network is **async** (top-level `await` works in
IPython, and `asyncio.gather` is the fan-out idiom). All functions raise normal Python exceptions.

### Files

```python
read(path, offset: int | None = None, limit: int | None = None, numbered: bool = False) -> str
write(path, content: str) -> str            # creates parents; audits {kind:"write", path, added=<lines>}
edit(path, old: str, new: str, replace_all: bool = False) -> str
```

`edit` is Prime/Claude-Code-exact: `old` must match **exactly once** (unless `replace_all`);
0 matches → `ValueError("string not found …")`; >1 → `ValueError("found N occurrences …— widen
the snippet")`. Returns `"Edited <abspath> (+a/−r)"` and audits with line-delta counts.

### Shell

```python
await bash(cmd, timeout: float = 120, cwd=None, env=None, background: bool = False)
    -> BashResult(code, stdout, stderr, timed_out)          # background=False
    -> BashHandle(.pid, .poll(), await .wait(), .output(), .kill())   # background=True
```

`asyncio.create_subprocess_shell` under the kernel's loop; audits `{kind:"bash", command}`.
IPython's own `%%bash` cells and `%cd` keep working and the skill carries Prime's verbatim
mechanics (first-line rule; each `%%bash` is a throw-away subshell; `%cd` + `os.environ` persist).

### Agents

```python
await agent.run(task, *, provider="claude",           # "claude" | "codex"
                model=None, system=None, allowed_tools=None,
                permission_mode="bypassPermissions", cwd=None,
                max_turns=None, effort=None, output_schema=None) -> AgentResult
agent.spawn(task, *, name=None, **same_options) -> AgentHandle      # starts immediately, sync return
await agent.fork(task, **same_options) -> AgentResult               # child inherits THIS conversation
await agent.gather(*handles) -> list[AgentResult]
agent.list() -> list[AgentInfo]        # live + registry (survives kernel restart)
agent.resume(session_id, **options) -> AgentHandle
```

- `AgentResult(text, session_id, structured, cost_usd, num_turns, duration_ms)`;
  `structured` is populated when `output_schema` (a JSON Schema dict) was given.
- `AgentHandle`: `.name`, `.session_id`, `.status` (`running|done|error|interrupted`),
  `await .result()`, `await .send(msg)` (a follow-up turn on the same session — this is the
  SendMessage equivalent), `.messages()` (transcript so far), `.history()` (parsed `Transcript`),
  `.interrupt()`, `.close()`.
- **Claude backend**: `claude-agent-sdk` in-kernel. `run` = `query(...)`; `spawn` =
  `ClaudeSDKClient` with its own session (streamed to a registry entry as it goes); `fork` =
  `resume=<the parent Claude Code session id, from PTC_SESSION>` + `fork_session=True`. Children
  get `cwd` = kernel cwd, the user's default model unless `model=` given, and env
  `PTC_DEPTH=<depth+1>` so their own kernels know their depth.
- **Codex backend**: a ~200-line stdio JSON-RPC client that spawns `codex app-server` and speaks
  `initialize` → `thread/start {cwd, approvalPolicy: "never", sandbox, model?}` →
  `turn/start {threadId, input:[{type:"text",text}]}` → collect `item/completed` agentMessage
  items until `turn/completed`. `send` = another `turn/start` on the same thread; `resume` =
  `thread/resume`; `fork` → `NotImplementedError("codex fork; use provider='claude'")`. Any
  server→client approval request that arrives despite the policy is auto-approved and logged
  (spike S4 pins the exact params).
- **Fan-in semantics (deliberate divergence from Prime)**: results are awaited **in code** —
  `await h.result()` blocks the *cell*, not the model; the exec/wait yield keeps the model free.
  Handles persist in the namespace across turns, so "spawn now, gather next turn" works without
  any host-side message injection (which Claude Code cannot do).
- **Depth guard**: `PTC_MAX_DEPTH` (default 1). At `PTC_DEPTH >= PTC_MAX_DEPTH`,
  `agent.run/spawn/fork` raise
  `RuntimeError("agent depth limit reached (PTC_DEPTH=1, PTC_MAX_DEPTH=1); raise PTC_MAX_DEPTH to allow grandchildren")`.
- **Concurrency**: one semaphore (default 8, `PTC_MAX_CONCURRENCY`) across all SDK-spawning
  calls (`agent.*`, `llm`, `web_search`) bounds subprocess storms.
- **Registry**: `~/.ptc/kernels/<key>/agents.json` — `{name, provider, session_id/thread_id,
  task_head, status, created_at, last_turn_at}`; written on every state change; `agent.list()`
  merges live handles with the file so a restarted kernel can still `agent.resume(...)`.

### Sub-LM calls

```python
await llm(prompt, *, model="haiku", system=None, max_tokens=4096, json_schema=None) -> str | dict
```

One-shot SDK `query()` with **no tools** (`tools=[]`, `max_turns=1`), `json_schema` mapped to the
SDK's `output_format={"type":"json_schema", "schema": ...}` (returns a parsed dict). This is the
RLM `llm_query` primitive for semantic map-reduce:
`await asyncio.gather(*[llm(f"Classify:\n{c}") for c in chunks])`. Subscription-billed via the
`claude` CLI's own auth. No API client exists in this codebase.

### Web

```python
await web_fetch(url, *, prompt=None, timeout=30) -> FetchResult(url, status, title, text)
await web_search(query, *, allowed_domains=None, blocked_domains=None, max_results=10)
    -> list[SearchResult(title, url, snippet)]
```

- `web_fetch`: `httpx` GET (redirects followed, 10 MB cap) → `markdownify` → full text stays in
  the returned object (the PTC spirit: filter in code, don't summarize by default). `prompt=`
  runs `llm(prompt, over the text)` and fills `FetchResult.summary`.
- `web_search`: a scoped one-shot SDK query allowed only the `WebSearch` tool; the runtime
  **parses the `WebSearch` tool_result block out of the message stream** and returns the
  structured results, discarding the model's prose (spike S6 pins the block shape). Domain
  filters pass through to the tool input. Subscription-billed.

### History (lossless memory)

```python
history(session: str | None = None) -> Transcript
Transcript: .path, .messages (list[dict]), .user(), .assistant(), .tool_calls(name=None),
            .search(regex), .text()          # convenience projections over the raw JSONL
```

Resolves `~/.claude/projects/<munged-cwd>/<session>.jsonl` (munge: non-alphanumeric → `-`);
falls back to globbing `~/.claude/projects/*/<session>.jsonl`. Default session =
`PTC_SESSION`. This is the PRO-LONG-style lever: pre-compaction history stays queryable as data.
`AgentHandle.history()` returns the same type for children.

### Workflow helpers

```python
await workflow.parallel(*aws, limit=8) -> list        # gather with a bound + per-item error capture
await workflow.pipeline(items, *stages) -> list       # per-item stage chaining, no inter-stage barrier
workflow.phase(name)                                  # progress marker printed + audited
```

Doctrine, not machinery: the skill shows Workflow-tool-style patterns (fan-out → verify →
synthesize) written as plain cells.

## Skill and packaging

### Repository layout — `ptc-surface/ptc/`

```
ptc/
  pyproject.toml            # package "ptc"; console scripts: ptc, ptc-mcp
  src/ptc/
    kernel.py               # spawn/discover/lifecycle, venv provisioning, run-file GC
    client.py               # jupyter_client wrapper: execute, follow, interrupt (shared MCP/CLI)
    shape.py                # result shaping + truncation + mutation footer
    runtime/                # what gets imported INTO the kernel
      __init__.py           #   read/write/edit/bash/llm/web_fetch/web_search/history/workflow
      agents.py             #   agent.* – SDK backend, registry
      codex.py              #   codex app-server client
      bootstrap.py          #   bound at kernel start; tee, watchdog, nest_asyncio
    mcp.py                  # the MCP server (ptc-mcp)
    cli.py                  # the ptc CLI
  plugin/
    .claude-plugin/plugin.json
    .mcp.json               # {"mcpServers": {"ptc": {"command": "<venv>/bin/ptc-mcp"}}}
    hooks/hooks.json        # SessionStart → writes ~/.ptc/run/claude-<ppid>.json
    skills/ptc/SKILL.md
  test/                     # unit / integration (real kernel) / live (auth-gated) / acceptance
  README.md                 # install, trust model, Codex registration note
```

### SKILL.md content contract

Frontmatter `name: ptc`, description tuned to trigger on: bulk file analysis, many-step
programmatic work, fan-out/aggregation, long-running loops, multi-agent orchestration, "keep this
in a variable". Body teaches, in order (Prime's doctrine transposed, tightened for a hybrid
harness):

1. **What the kernel is** — persistent notebook; variables/imports/handles survive calls, turns,
   compaction, and `--resume`. Session id available as `${CLAUDE_SESSION_ID}` for explicit
   `session=`.
2. **When to use it vs native tools** — use PTC for bulk read/filter/transform, fan-out,
   aggregation, iterative loops with state, agent orchestration; use native Edit for a single
   known edit, native Read for images/PDFs/notebooks, native tools whenever the user should see
   and approve each step. (No search guidance — deliberate omission.)
3. **Working discipline** — assign large results to named variables and print compact summaries;
   output truncates at ~12k chars with the full log path; never poll with `time.sleep`, use
   yield/wait; project code runs in the project's own environment, never install project deps
   into the kernel.
4. **Files & shell** — `read/write/edit` semantics (uniqueness rule verbatim), `await bash(...)`,
   `%%bash` first-line rule + throw-away-subshell mechanics, `%cd`/`os.environ` persistence.
5. **Agents** — the four forms with one-line use cases: `run` (blocking one-shot), `spawn`+
   `gather` (parallel fan-out), `fork` (child inherits this conversation — "ask about our
   discussion"), `send` (follow-up on a persistent child); provider="codex" for a Codex worker;
   depth and concurrency limits; children run under `bypassPermissions` — delegate only work
   you'd run yourself.
6. **llm map-reduce** — chunk → `gather(llm(...))` → synthesize; `json_schema` for structured
   labels.
7. **Web** — `web_fetch` keeps full text in the variable (filter in code); `web_search` returns
   structured results.
8. **History** — `history()` for anything pre-compaction; `handle.history()` for children.
9. **Pitfalls** — do not invent wrappers that don't exist (verbatim Prime's negative
   instruction, adapted); the kernel is not the project's runtime; restart loses variables but
   not agent sessions.
10. **Worked examples** — three short end-to-end cells: bulk audit; spawn-3-gather; fork-recall.

### Installation modes

- Dev: `claude --plugin-dir ptc-surface/ptc/plugin`.
- Settings snippet (README): allow `mcp__ptc__*` in `permissions.allow` for prompt-free use.
- Codex (documented only): `codex mcp add ptc -- ~/.ptc/venv/bin/ptc-mcp` — works because the
  adapter is plain stdio MCP; session keying degrades to explicit `session=`/`PTC_SESSION`.

## Trust model (README + skill, stated identically)

Allowing `mcp__ptc__exec` **is** the security decision: from then on, model-written Python runs
with your OS permissions, outside Claude Code's per-tool permission prompts and sandbox, and
children spawned from the kernel default to `bypassPermissions`. The audit footer and
`audit.jsonl` give visibility, not enforcement. Use a worktree/container for untrusted work. The
kernel env should not carry `ANTHROPIC_API_KEY` if you want subscription billing — the key
shadows OAuth in the `claude` CLI and silently flips billing to metered API.

## Configuration reference

| env (config file mirrors) | default | meaning |
|---|---|---|
| `PTC_HOME` | `~/.ptc` | root for venv/kernels/run |
| `PTC_SESSION` | — | session key override; set on kernel + children |
| `PTC_DEPTH` / `PTC_MAX_DEPTH` | `0` / `1` | agent-spawn depth guard |
| `PTC_MAX_CONCURRENCY` | `8` | SDK-subprocess semaphore |
| `PTC_YIELD_S` | `300` | default `exec`/`wait` timeout_s |
| `PTC_MAX_OUTPUT_CHARS` | `12000` | default result cap |
| `PTC_IDLE_HOURS` | `6` | kernel self-reap |

## Delegated unknowns → spikes

Each spike is a small runnable probe committed under `ptc/test/spikes/`; promote/discard criteria
are binding.

- **S1 — SDK inside ipykernel's loop.** `claude-agent-sdk` (anyio) running on ipykernel's
  asyncio loop with `nest_asyncio`, including two concurrent `ClaudeSDKClient`s under
  `asyncio.gather`. *Promote* if both complete and the kernel stays responsive. *Fallback*
  (pre-designed): run all SDK I/O on one dedicated background thread with its own loop; the
  public API is unchanged.
- **S2 — live-session fork.** `resume=<parent session>, fork_session=True` while the parent
  Claude Code session is mid-turn (its JSONL partially flushed). *Promote* if the fork child
  answers a parent-only fact. *Fallback*: document fork as sound between turns; mid-turn the
  child sees the transcript up to the last flushed message (acceptable; note in skill).
- **S3 — hook PPID discovery.** SessionStart hook and MCP adapter observe the same PPID in
  release Claude Code 2.1.236, including `--resume` (hook must fire per-start and rewrite the
  run-file). *Promote* if `kernels()` shows the right key with zero configuration. *Fallback*:
  chain already includes `${CLAUDE_SESSION_ID}` (skill) and `CLAUDE_CODE_SESSION_ID` (CLI).
- **S4 — headless codex approvals.** Exact `thread/start` params (`approvalPolicy`, `sandbox`)
  that produce zero server→client approval requests on current `codex app-server`
  (codex-cli 0.146.0). *Promote* when a trivial turn completes unattended. *Fallback*:
  client-side auto-accept of approval requests.
- **S5 — MCP image blocks.** Claude Code 2.1.236 renders an image content block returned by an
  MCP tool. *Promote* → plots visible inline. *Fallback*: text mentions the saved PNG path only.
- **S6 — WebSearch tool_result shape.** The structured results block is reachable in the SDK
  message stream and parseable. *Promote* → `web_search` returns `list[SearchResult]`.
  *Fallback*: return the raw block(s) plus best-effort regex extraction, flagged in the docstring.

## Acceptance

All commands run from `ptc-surface/ptc/`. "A session" means `claude --plugin-dir ./plugin` (or
`claude -p` for scripted checks) with `mcp__ptc__*` allowed. Live/acceptance tests are gated on
`claude` being logged in; they skip cleanly otherwise.

- **A1 State persists across calls.** In one session: `exec("x = 42")`, later `exec("print(x)")`
  → `42`.
- **A2 State survives resume.** Quit; `claude --resume <S> --plugin-dir ./plugin`;
  `exec("print(x)")` → `42` on the same kernel (verify pid unchanged via `kernels`).
- **A3 Yield/wait/interrupt.** `exec("import time; time.sleep(600)", timeout_s=5)` returns
  `status: running` + cell_id within ~5 s; `wait(cell_id, timeout_s=5)` yields again;
  `interrupt()` settles the cell as interrupted; a following `exec("1+1")` returns `2`.
- **A4 Fan-out/fan-in.** One cell: `hs = [agent.spawn(t) for t in tasks3]; print(len(hs))` ends;
  next cell `await agent.gather(*hs)` returns 3 results; `agent.list()` shows all three;
  after `restart()`, `agent.list()` still shows them and `agent.resume(<id>)` + `.send()` gets a
  reply.
- **A5 Fork recalls the parent conversation.** Mid-session (after discussing a marker fact),
  `await agent.fork("what marker fact did we establish? answer only the fact")` → the fact.
- **A6 Audit footer.** A cell calling `edit()` on a repo file returns a footer containing
  `edited <path> (+a/−r)`; `audit.jsonl` has the matching entry.
- **A7 web_search structured + subscription.** With no `ANTHROPIC_API_KEY` in the kernel env,
  `await web_search("anthropic claude release notes")` returns ≥1 `SearchResult` with real URLs
  (parsed from the tool_result, not prose).
- **A8 llm map-reduce.** `await asyncio.gather(*[llm(f"one word for: {w}") for w in five])` →
  5 non-empty strings; with `json_schema` → parsed dicts.
- **A9 history().** After ≥2 turns, `history().user()` contains the first user prompt verbatim
  (and still does after a `/compact`).
- **A10 CLI shares the kernel.** From the session's Bash tool: `ptc exec 'print(x)'` → `42`
  (same kernel as A1, keyed by `CLAUDE_CODE_SESSION_ID`).
- **A11 Skill triggers.** `claude -p --plugin-dir ./plugin "analyze all python files under
  src/ for TODO density; keep intermediate data in variables"` → the transcript contains a
  `mcp__ptc__exec` call (the model chose the kernel unprompted).
- **A12 Truncation.** `exec("print('y'*100000)")` → result ≤ ~12k chars, contains the elision
  marker and a `cells/<n>.log` path whose file holds the full 100k.
- **A13 Images.** A matplotlib cell yields an image block visible in Claude Code (S5), or —
  fallback documented — the saved-PNG path.
- **A14 Depth guard.** A spawned child asked to use *its* ptc kernel to spawn a grandchild gets
  the depth RuntimeError (its env: `PTC_DEPTH=1`).
- **A15 Codex worker.** `await agent.run("print exactly DONE", provider="codex")` →
  `AgentResult.text` containing `DONE`, no human interaction.

## Milestones

- **M1 — kernel + surface.** Venv provisioning; spawn/discovery (hook, run-file, keying);
  exec/wait/interrupt/restart/kernels on MCP + CLI; result shaping incl. truncation + footer;
  read/write/edit/bash + audit; skill v0 + plugin packaging. Spikes S3, S5.
  Exit: A1–A3, A6, A10, A12.
- **M2 — agents + llm.** SDK backend (run/spawn/fork/gather/send/resume/registry), codex
  backend, depth + concurrency, `llm()`. Spikes S1, S2, S4. Exit: A4, A5, A8, A14, A15.
- **M3 — web + history + polish.** web_fetch/web_search (S6), history(), workflow helpers,
  skill final wording, README + trust model, full acceptance run incl. A7, A9, A11, A13.

## Decision Log

- Decision: Build PTC as an MCP server + CLI + skill *on top of* Claude Code, not a replacement
  harness.
  Rationale: The project goal is Claude Code gaining Prime-style PTC; the conversation's own
  verdict is that hybrid (native lane + programmatic lane) beats PTC-only. Claude Code keeps
  mutation approval, vision, and its ecosystem; the kernel adds the programmatic lane.
  Date/Author: 2026-08-20 / design session (user + Claude).

- Decision: Claude children are spawned by the **Python Agent SDK in-kernel**; Codex children by
  a stdio `codex app-server` client. Rejected: routing Claude children through CC-to-SDK's
  `ccx serve` app-server (WS-only, extra server to run, four hops), and shipping both backends in
  v1. An `AgentBackend` seam keeps fleet-attach addable later.
  Rationale: fewest processes, subscription auth for free, children are full Claude Code agents
  (including this plugin → controlled recursion).
  Date/Author: 2026-08-20 / grill round 1.

- Decision: **Detached kernel per session, surviving client restarts**; no broker daemon.
  Rejected: adapter-owned session-scoped kernel (dies with Claude Code, breaks `--resume`);
  a Conversation.md-style broker daemon (a fourth process whose jobs — multi-client access,
  survival, discovery — the detached kernel + connection files already cover).
  Rationale: the kernel is the state; keep exactly one long-lived process.
  Date/Author: 2026-08-20 / grill round 1.

- Decision: **Full mutation tools + audit trail** in the kernel. Rejected: kernel-side guard
  rails (path confinement + elicitation prompts — friction, and trivially bypassed by raw
  Python); read-only default lane (kills half the value; the conversation's strict-mutation-lane
  idea remains available by simply using native tools for mutations).
  Rationale: the honest boundary is the `mcp__ptc__exec` allow decision; make visibility
  (footer + audit.jsonl) excellent instead of pretending to enforce.
  Date/Author: 2026-08-20 / grill round 1.

- Decision: Extras = `llm()` and `history()`; **no in-kernel glob/grep**.
  Rationale: user call — the model already has native rg-backed search; `llm()` is the RLM core
  primitive; `history()` is the PRO-LONG lever with the strongest evidence.
  Date/Author: 2026-08-20 / grill round 1 (user).

- Decision: **Fan-in is awaited in code** (`run`/`spawn+gather` + exec/wait yield). Rejected:
  Prime's admission-only contract.
  Rationale: Prime's contract depends on its host injecting agent messages into the parent's
  next turn; Claude Code offers no such channel to an MCP server. Blocking the *cell* while
  yielding the *model* reproduces the useful half (parent context stays clean, model stays free)
  without fighting the harness.
  Date/Author: 2026-08-20 / grill round 2.

- Decision: Children default to **`permission_mode="bypassPermissions"`**, overridable per call.
  Rejected: `acceptEdits` default (children stall headlessly on shell work); elicitation-routed
  approvals (blocks cells on human input; candidate for a later option).
  Rationale: consistent with the full-tools stance; the depth guard bounds the blast radius.
  Date/Author: 2026-08-20 / grill round 2.

- Decision: `llm()` and `web_search()` are **SDK-one-shot only (subscription-billed)**; the
  `anthropic` API client is not a dependency; `web_fetch` is native httpx. Rejected: Anthropic
  API `web_search` server tool and API-first `llm` (metered billing); third-party search APIs
  (Serper/Brave — an extra key, Prime's choice).
  Rationale: user call — never bill the API for kernel-originated model calls; one backend, one
  auth story. `web_search` stays structured by parsing the WebSearch tool_result from the
  stream instead of trusting prose.
  Date/Author: 2026-08-20 / user revision after design presentation.

- Decision: **No search guidance in the skill** (no `bash("rg …")` examples).
  Rationale: user call — the model already routes search well natively; teaching it here adds
  noise.
  Date/Author: 2026-08-20 / user revision after design presentation.

- Decision: Packaging as `ptc-surface/ptc/` — package/server/skill all named `ptc`, Claude Code
  plugin dir in-repo, Codex registration documented-not-tested.
  Rationale: approved as proposed; short tool names (`mcp__ptc__exec`) matter for prompt economy.
  Date/Author: 2026-08-20 / grill round 2.

- Decision: `exec`/`wait` **yield protocol** copied from Codex code-mode (cell_id + timeout_s),
  with `wait` implemented over kernel-side tee files so it survives adapter restarts; `exec` on a
  busy kernel returns `status: busy` rather than queueing silently.
  Rationale: proven in-repo pattern; kernel-side capture makes MCP and CLI equivalent clients;
  explicit busy beats invisible queuing for a model deciding what to do next.
  Date/Author: 2026-08-20 / design composition.

- Decision: Session discovery via **SessionStart-hook run-file keyed by shared PPID**, with
  explicit-arg > run-file > `PTC_SESSION` > `CLAUDE_CODE_SESSION_ID` > adapter-local fallback,
  and `${CLAUDE_SESSION_ID}` in the skill as the model-visible escape hatch.
  Rationale: no Claude Code API exposes "the session id of the conversation calling this MCP
  tool"; the PPID bridge is the least-magic mechanism available, and the fallback chain keeps
  every layer functional if it breaks (spike S3).
  Date/Author: 2026-08-20 / design composition (flagged review-carefully; approved).

- Decision: **Controlled track** (spec → writing-plans → subagent execution), milestones M1–M3.
  Rejected: autonomous execplan; direct implementation.
  Rationale: mid-size build with taste-heavy surfaces (skill wording, API ergonomics) and five
  spikes worth human-visible checkpoints.
  Date/Author: 2026-08-20 / grill round 3 (user).

## Surprises & Discoveries

- Observation: Prime Agent's model surface is exactly one tool (`ipython`) with **no cell
  timeout** and 64 KiB/stream truncation; `rlm()` is admission-only, and results return solely
  via host-injected agent messages — the one mechanism Claude Code cannot host.
  Evidence: `prime-agent/packages/coding-agent/src/core/tools/ipython.ts` (schema, no timeout),
  `src/core/kernel/index.ts` (`DEFAULT_MAX_OUTPUT_CHARS = 65536`), `docs/rlm.md`.

- Observation: Claude Code's MCP defaults are unusually PTC-friendly: tool timeout ≈ 27.8 h
  (`DEFAULT_MCP_TOOL_TIMEOUT_MS = 100_000_000`) and a 25 000-token output cap — long cells
  cannot be killed by the host, and our 12k-char cap sits far under the ceiling.
  Evidence: `Claude Code Src/src/services/mcp/client.ts:211`, `src/utils/mcpValidation.ts:16`.

- Observation: Claude Code's MCP client advertises `roots` and `elicitation` but **not
  `sampling`** — an MCP server cannot ask the host model for completions, which forecloses the
  cheap `llm()` implementation and forces the SDK-subprocess route.
  Evidence: `Claude Code Src/src/services/mcp/client.ts:994` (capabilities object).

- Observation: `${CLAUDE_SESSION_ID}` is substituted inside SKILL.md at load, and
  `CLAUDE_CODE_SESSION_ID` is exported into Bash-tool environments — two free session-identity
  channels that make the fallback chain robust without any host API.
  Evidence: `Claude Code Src/src/tools/SkillTool/SkillTool.ts:1070`, `src/utils/Shell.ts:325`.

- Observation: `ANTHROPIC_API_KEY` **shadows** OAuth subscription auth in the `claude` CLI —
  "subscription-only billing" is an environment discipline, not a code path we can force.
  Evidence: CC-to-SDK probe 28 (`accountInfo() → apiProvider:"firstParty"` only with the key
  absent); `CC-to-SDK/CLAUDE.md`.

- Observation: the exec/wait/cell_id yield protocol already exists twice in this repo family —
  Codex code-mode (JS isolate) and CC-to-SDK's app-server turn model — so the adapter surface is
  a port, not an invention. Public "IPython kernel MCP" servers exist too; the kernel layer is
  commodity, and this project's differentiated work is the in-kernel runtime library, the agent
  bridge, and the skill.
  Evidence: `codex-rs/code-mode-protocol/src/description.rs` (EXEC/WAIT templates); web survey
  (ipython-mcp, jupyter-kernel-mcp, ipybox).

- Observation: CC-to-SDK's `ccx serve` app-server is WebSocket-only (stdio/UDS spec-named but
  unbuilt), and real Codex is driven by `codex app-server` over stdio with the same JSON-RPC
  vocabulary — which is why the Codex backend costs ~200 lines while a v1 Claude backend over
  the same protocol would have cost a transport.
  Evidence: `CC-to-SDK/docs/parity/appserver.md`;
  `CC-to-SDK/codex-plugin-cc/plugins/codex/scripts/lib/app-server.mjs`.

## Outcomes & Retrospective

Pending — written at finish.

## Revision Notes

- 2026-08-20: Initial spec from the approved design (brainstorming session over
  `Conversation.md`, Prime Agent source, CC-to-SDK, Claude Code 2.1.236 reference source).
  Includes the post-presentation user revisions: SDK-only `llm`/`web_search` (no `anthropic`
  dependency), and no search guidance in the skill.
