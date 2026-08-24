# reforge — differential harness for interchangeable Claude Code engines

The M0 instrument of the engine-reimplementation experiment: drive *any* engine
build through the unmodified SDK wrapper (`sdk.mjs`, via its
`pathToClaudeCodeExecutable` seam) and grade behavioral equivalence by
normalized-transcript diff — record API traffic once, replay it offline into
every engine, compare what each engine says (SDK messages) **and** what each
engine asks (requests emitted).

Pinned target: **Claude Code 2.1.241** (`~/claude-code-bundle/2.1.241/`,
extracted per its MAP.md). SDK wrapper: `@anthropic-ai/claude-agent-sdk@0.3.237`
(installed here with `--omit=optional` — no 302MB platform binary; every run
supplies its own engine).

## Engines (`engines/`)

| name | what it is |
|---|---|
| `engine-real` | the pinned real 2.1.241 Mach-O binary (reference / oracle) |
| `engine-extracted` | the same 2.1.241 payload extracted from `$bunfs`, run as plain JS under **bun** (must be bun — silent no-op under node). Identical application code to `engine-real`, different packaging: the differ's self-test pair and the substrate the strangler reimplementation will replace module-by-module |
| `engine-ts` *(future)* | the TS reimplementation — plugs in as one more wrapper script; ccx and this harness change by zero lines |

Wrappers are extension-less shell scripts on purpose: `sdk.mjs` treats non-`.js`
paths as native binaries and spawns them directly, so the shebang runs.

## Layout

- `src/runTurn.ts` — shared driver: one prompt → one engine → captured SDK-message transcript. Determinism knobs: `settingSources: []`, fixed `sandbox/` cwd, telemetry env off.
- `src/proxy.ts` — record/replay proxy (`ANTHROPIC_BASE_URL` seam). Record forwards + captures (auth redacted before disk); replay serves deterministically (scrubbed-body hash match, then per-path FIFO) and logs every observed request for request-level diffing.
- `src/differ.ts` — **the normalization spec is the definition of "behaviorally equivalent"**: scrubbed keys/patterns (ids, clocks `*_ms`/`*_at`, costs) are declared incidental; everything else must match. Grow it only with justification.
- `m0/` — milestone cells (below). `cassettes/`, `transcripts/`, `sandbox/` are generated (gitignored).

## Running

```sh
cd reforge && npm install --omit=optional
set -a; . ../.env; set +a; unset ANTHROPIC_API_KEY   # OAuth token, no API-key shadowing
npx tsx m0/02-handshake.ts        # live: one turn per engine
npx tsx m0/06-selftest.ts         # records cassettes once (live), then replays OFFLINE
```

Replays are fully offline — record once, grade forever at zero API cost. That
property is what makes a long-running reimplementation fleet affordable: the
fleet loops against cassettes; only new workload recordings spend tokens.

## M0 status (2026-08-24)

| cell | claim | status |
|---|---|---|
| M0.1 | extracted payload boots under bun (`--version` → 2.1.241) | ✅ |
| M0.2 | sdk.mjs completes a full live turn against the extracted payload (`system:init → assistant → result:success`) | ✅ both engines |
| M0.3 | record proxy captures real SSE exchanges to cassettes (auth redacted) | ✅ |
| M0.4 | replay proxy re-serves cassettes offline, deterministically | ✅ |
| M0.5 | normalization spec + structural differ | ✅ self-corrected once (latency-telemetry hole found by M0.6, closed by `*_ms` pattern scrub) |
| M0.6 | identical-code pair (real vs extracted) is normalized-identical on transcripts **and** emitted requests, across a plain turn and a 3-exchange Bash-tool turn | ✅ PASS |

## M1 — cassette corpus (2026-08-24): 9/9 PASS

`m1/scenarios.ts` + `m1/run.ts`: each scenario is one behavioral claim, graded
on three surfaces (SDK transcripts, harness-side events, requests emitted) plus
a **substance check** — an assertion that the scenario actually exercised the
behavior it claims. The substance check exists because the first
permission-broker scenario passed hollowly: default mode auto-approves
read-only Bash commands *without consulting canUseTool*, so both engines
agreed on an empty event log. Two engines agreeing on nothing still diff as
identical; only an assertion catches that.

```sh
npx tsx m1/run.ts [--scenario <tag>] [--rerecord]
```

| scenario | claim |
|---|---|
| plain | single no-tool turn |
| bash-tool | one Bash execution round-trip |
| file-tools | Write then Read in the sandbox |
| permission-broker | default-mode canUseTool consult; a Write is denied (read-only Bash is auto-approved WITHOUT consult — mutating tools force the broker) |
| hooks | PreToolUse + PostToolUse fire around Bash |
| multi-turn | two user messages over one streaming-input session (pushable input waits for each result) |
| resume | second query resumes the first query's session; codeword survives |
| api-error | nonexistent model → SDK-level throw (captured as reforge-exception) |
| thinking | adaptive thinking streams a thinking block (task must be hard — sonnet-5 adaptive SKIPS thinking on trivial prompts; 17×23 recorded zero blocks) |

## M2a — strangler seam spike (2026-08-24): GATE PASS

The plan's one untested load-bearing premise — *can a module be excised from the
extracted payload, reimplemented in reforge-owned source, and spliced back in?*
— is now proven end to end on a real method (the Write tool's
`mapToolResultToToolResultBlockParam`).

```sh
npx tsx strangle/build.ts [--sabotage]   # build/cli-strangled.js
npx tsx strangle/gate.ts                 # the two-phase acceptance ritual
```

**The gate is two-phase and both halves are mandatory** — either alone is
satisfiable by a no-op splice:

1. **SABOTAGE build must go RED.** Proves our module is live in the execution
   path. Measured: the wrong `tool_result` content surfaces in both the
   transcript *and* the next request body — one splice, two observable surfaces.
2. **FAITHFUL build must go GREEN.** Proves equivalence. Measured: 9/9.

**How the splice works** (`strangle/build.ts`): locate the target method by a
unique **string-literal anchor** (literals survive minification and version
churn), excise its balanced-brace body, replace it with a delegation into
`globalThis.__reforge`, and inject our module source as a prelude. Captured
closure identifiers are **re-derived from the matched body** (here the
freshness-suffix constant, minified to `hui`), never hardcoded — that is what
makes a version catch-up mechanical.

Two traps this spike measured, both silent-failure class:

- **`grep -c` lies on this payload.** It is effectively one line, so `-c` counts
  lines, not matches: it reported the anchor unique when the true substring
  count was 2 (the Edit tool has a sibling template). Count substrings.
- **The payload's first bytes are the magic banner `// @bun @bytecode
  @bun-cjs`.** Prepending *anything* silently disables the bundle — it boots to
  exit 0 with **no output and no error**. The prelude must be injected inside
  the CJS wrapper opening. Any build that touches the head needs a boot check,
  because this failure is invisible without one.

## M2b — harness repair (2026-08-24): five audited defects closed

The audit that produced these ("is that really all?") is the reason today's
green means more than yesterday's. One aggregate entry point runs the whole
acceptance surface:

```sh
npx tsx m2/all.ts [--engineB <name>]   # corpus + faults + partials + cross-resume + raw
```

| id | defect | fix | verdict |
|---|---|---|---|
| H1 | shared real `~/.claude` | `CLAUDE_CONFIG_DIR` → `reforge/config` in `baseOptions`, plus a record-time leak check | closed |
| H2 | zero error/retry coverage | `src/faults.ts` derives fault cassettes; `m2/faults.ts` grades 5 injections | 5/5 |
| H3 | partial streaming unverified | `m2/partials.ts` diffs the stream-event *type sequence* and reassembled text | PASS |
| H4 | filesystem/store contract undiffed | `m2/cross-resume.ts` — store shape + **cross-engine** resume both ways | 4/4 |
| H5 | driven only through sdk.mjs | `m2/raw-protocol.ts` speaks stream-json over stdio directly | PASS |

**H1 was worse than "untidy".** The isolation probe (`m2/probe-isolation.ts`)
measured that `settingSources: []` does **not** contain the config dir: the
operator's memory index, personal slash commands, and identity were being
injected into every recorded system prompt — so cassettes carried personal data
*and* would change whenever that state changed. Isolation is total (real-store
writes: +0) and all nine cassettes were re-recorded clean. Cassettes are
gitignored and were never committed (verified). The leak check now runs at
record time so this cannot silently return.

**H2 caught a second hollow pass — in the harness itself.** The first fault run
reported 5/5 PASS, but every injected fault (529, 429, truncated) surfaced as
`API Error: 500 {"error":"reforge-replay: no cassette entry"}` — the engines
agreed on *the proxy's own fallback*, because a retry consumed the cassette.
Fixed with repeatable cassette entries (`repeat: true`), plus a substance gate
that fails any fault run where the engine saw the fallback. Retries are bounded
via `CLAUDE_CODE_MAX_RETRIES`, which also makes the retry count itself diffable
instead of a timing artifact.

Normalization additions this round (each justified, each found by a suite):
`*_ms`/`*_at` clock patterns, and **value-level** `127.0.0.1:<port>` — the
engine echoes the harness-assigned proxy port into user-facing error text,
where key-based scrubbing cannot reach it.

Also fixed: the `file-tools` scenario let the model pick its own path and it
wrote **outside the sandbox**; every replay re-created the stray file. The
prompt now pins the absolute sandbox path and the check asserts containment.

## M2c — coverage widened to what ccx actually consumes (2026-08-24): 17/17

Scenario selection was **derived from the product**, not guessed: an inventory
of every SDK surface `harness/src` consumes at runtime (options set, frames
branched on, control-handle methods called, tool names hard-coded). Eight
scenarios added in `m2c/scenarios.ts`, appended to the M1 corpus:

| scenario | claim |
|---|---|
| subagent | the `Agent` tool dispatches a child turn, its result folds back, and frames carry `parent_tool_use_id` |
| partial-tool-args | `input_json_delta` fragments reassemble into valid tool arguments |
| mcp-tool | an in-process SDK MCP server tool is callable and round-trips |
| parallel-tools | a batch of tool calls is issued without waiting, all results return |
| slash-compact | `/compact` is dispatched engine-side and reaches a `compact_boundary` with `pre_tokens` |
| runtime-setters | `setPermissionMode` mid-session; the session survives |
| todo-tool | task-list tool structured input round-trips |
| search-tools | Glob and Grep operate inside the sandbox |

**The runner now triages failures instead of trusting them.** A diff between
the oracle and the engine under test means "the engines differ" *only if the
oracle is deterministic on that scenario*. Measured counter-example:
parallel tool execution returns `tool_result` blocks in **completion** order,
so the oracle disagrees with itself. On any diff the runner replays the oracle
a second time and marks the paths where it self-disagrees as nondeterministic;
only the remaining diffs fail the run. Without this, racy scenarios produce a
flaky gate — which is worse than no gate, because it teaches you to ignore red.

Four scenario-level facts this round measured (each one a spec line engine-ts
must satisfy, and each one initially wrong in the scenario as written):

- The subagent dispatch tool is **`Agent`**, not `Task`. (ccx's TUI matches
  only `Agent`; the appserver accepts both — an engine emitting only `Task`
  loses every TUI subagent row.)
- **The SDK splits a multi-block assistant message into one message per block**,
  so "was this a parallel batch?" cannot be answered by looking for a message
  with >1 `tool_use`. The observable signature is consecutive `tool_use`
  messages with no `tool_result` between them.
- The engine reaches for **`TaskCreate`**, not `TodoWrite`, and `allowedTools`
  does not narrow the catalog under `bypassPermissions`.
- `/compact` on a short conversation **fails** with "Not enough messages to
  compact" — real compaction needs history, so the scenario builds six turns
  first.

Normalization additions, each forced by a measured diff: run-scoped **id
mapping** (engine-minted `agentId`/`task_id`/`session_id` become `<id0>`,
`<id1>`… in first-seen order — mapped rather than blanked so an engine that
uses two ids where the oracle used one still diffs), `_time` keys, `output_file`,
and in-prose `*_ms: N` clock values.

## M3-A — Tier-1 surfaces (2026-08-24)

The five surfaces the ccx inventory ranked highest, in `m3/scenarios.ts`:

| scenario | claim | state |
|---|---|---|
| uuid-correlation | caller-minted `uuid` echoes on `result.user_message_uuid`; origin survives only for `human` | PASS |
| interrupt | `interrupt()` cuts a running tool short and the turn reaches a definite end | PASS |
| permission-bag | `canUseTool` gets a populated bag (`toolUseID`, `signal`); `updatedInput` actually changes what runs | PASS |
| background-task | a backgrounded `Agent` emits `task_started` + `background_tasks_changed` | recording blocked (rate limit) |
| fork-session | `forkSession` mints a new id and keeps the parent's context | recording blocked (rate limit) |

**The origin contract is narrower than the types suggest** — and the probe
(`m3/probe-origin.ts`) settled *who* enforces it. Driving the engine on the raw
stream-json path, with no `sdk.mjs` in between: of the declared kinds
`human | channel | peer`, **only `human` survives** onto the result frame;
`peer`, `channel`, and unknown kinds all come back as `origin: null`
(unattributed, which fails closed at strict `isHuman()` gates). So the stripping
is the **engine's**, not the wrapper's — engine-ts must reproduce it, because an
engine that echoed the caller's kind verbatim would let unattributed input walk
through those gates. Two consequences: ccx's own `auto-continuation` stamping
arrives unattributed, and peer/channel attribution is not deliverable over this
path at all.

**New harness guard: infrastructure failures are never frozen into cassettes.**
A recording that captured a rate limit or gateway error is not a cassette —
replaying it grades every engine against the same failure, so the scenario
silently measures nothing. The runner now discards such a take and reports it,
instead of freezing the bad recording.

Two scenario-authoring corrections this round, both the same shape as earlier
rounds: interrupting the instant a `tool_use` block appears races the engine's
dispatch and produced a bare `exit(1)` (interrupt once the tool is actually
running); and "did the interrupted command complete?" must be judged on tool
**results**, not a whole-transcript substring search — the `tool_use` block
necessarily contains the command string it was told to run.

## Recording is currently blocked (2026-08-24)

19 of 22 scenarios replay green offline. Three cannot be graded because their
cassettes cannot be recorded: `background-task` and `fork-session` were never
recorded, and `plain` lost its cassette to a `--rerecord` during the outage
(the bug that motivated staged recordings, now fixed).

Diagnosis, so nobody re-debugs it: **a sustained account-level 429**, not a
harness fault and not a transient blip. A direct `curl` to
`api.anthropic.com/v1/messages` returns `429 rate_limit_error` with no
rate-limit or `retry-after` headers, only `x-should-retry: true`; twelve polls
across ~9 minutes were all 429; a refreshed token in the same organization
behaves identically. Note the engine renders this as "Server is temporarily
limiting requests (not your usage limit)" — that text is the engine's reading of
a bare 429 and should not be trusted as a diagnosis.

Everything replay-only is unaffected: replays never touch the network.

## Next

Record the three outstanding cassettes once the limit clears (`npx tsx m1/run.ts`
picks up exactly the missing ones), then scale strangler replacement: one module
at a time, each gated by `strangle/gate.ts`.
