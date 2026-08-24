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

## External review round (2026-08-24): 5 findings, all confirmed and fixed

An independent whole-round review (Codex gpt-5.6-sol, relayed by the bl4
session) swept these commits and returned five findings. Every one reproduced;
none were rejected. They cluster into one theme worth stating plainly: **a
guard that only reports is not a guard**, and **a checker that does not cover
the code is not a check**.

| # | finding | fix |
|---|---|---|
| P1 | `runTurn` (the documented M0 entry point) never set `CLAUDE_CONFIG_DIR` — only `baseOptions` did, so M0 scripts still loaded the operator's real `~/.claude` and wrote real sessions | `CONFIG_DIR` moved into `src/runTurn.ts` (one definition, no circular import) and applied there; `harness.ts` re-exports it. Every engine-spawning path audited. |
| P1 | the leak check only set `process.exitCode`; the staged cassette was promoted anyway and the final verdict assignment overwrote the exit code — a contaminated run could exit 0 | check now returns a verdict; on a hit the staged file is discarded, the scenario fails, and nothing is promoted |
| P1 | nondeterminism triage dropped **every** A-vs-B difference at a variable path, so an engine emitting a third, invalid value there was reported identical; the same path set was reused across all three surfaces | both halves of the reviewer's suggestion, and the second turned out to be the real fix — see below |
| P2 | `tsconfig.json` covered only `src/` and `m0/`, so `npx tsc --noEmit` passed green while never checking `m1 m2 m2c m3 strangle` — a real TS2339 sat hidden in `m3/probe-origin.ts` (tsx transpiles without checking) | include widened to every source directory; the hidden error fixed |
| P2 | a misspelled `--scenario` selected nothing, and `[].every(...)` is vacuously true, so the runner printed ALL PASS having executed nothing (a valueless `--scenario` silently ran the entire corpus instead) | unknown tag, missing value, and flag-shaped value all abort with exit 2; an empty verdict set is refused rather than reported as a pass |

Both P2s are the same failure as the P1s in miniature: a green signal that was
never actually looking at anything.

### The triage finding went deeper than the fix first written for it

The review offered two remedies: compare the engine's value against the
oracle's observed alternatives, **or** canonicalize the nondeterministic
structure. The first was implemented — and immediately turned `parallel-tools`
red, correctly: with three parallel calls the oracle can produce six orderings,
two oracle runs sample at most two of them, so an engine producing a third
*valid* ordering is indistinguishable from one producing garbage. **Sampling
cannot certify a value it never saw.**

So the ordering is canonicalized at its source instead, in three layers, each
discarding only arrival order and never a result or its content:

1. `tool_result` blocks inside one message are sorted by `tool_use_id` (the ids
   come from the cassette, so they are stable across engines);
2. the prompt-cache breakpoint, which attaches **positionally** to the last
   block, is replaced by an explicit count — whether the engine sets a
   breakpoint is real behavior (it drives cost), *which* racily-ordered block
   carries it is not;
3. in transcripts the SDK emits one message per result block, so consecutive
   single-`tool_result` messages are sorted the same way.

`parallel-tools` now matches on all three surfaces with no triage at all. The
value-comparison triage stays as a second line of defense for nondeterminism
that cannot be canonicalized, with `m3/variance-guard.test.ts` proving it never
excuses an unobserved value.

## Concurrency: lanes, and the one scenario that cannot be canonicalized

The three cassettes blocked by an account-level rate limit were recorded once it
cleared, and two of them exposed a second class of nondeterminism — **concurrent
lanes**. A backgrounded subagent runs *while* the parent turn finishes, so
several streams of frames progress at once and their interleaving races.
Measured on the identical-code pair: both engines emitted exactly the same 15
frames in the same per-lane order, differing only in where the subagent's frames
and the async task notifications landed relative to the parent's result.

`normalizeTranscript` therefore stable-partitions frames into lanes — root,
subagent (`parent_tool_use_id`), async task notifications — and concatenates
them in a fixed lane order; the request side partitions the same way on the
engine's own `cc_is_subagent` billing marker. **Order within a lane stays a
contract** (a missing or reordered frame inside any lane still diffs); only the
interleaving between concurrently-progressing lanes is discarded. The
per-process `cc_version` suffix is scrubbed for the same reason the proxy port
is.

Two more engine-minted random values surfaced the same way and are scrubbed by
value, since sampling can never certify a draw from a large space: the
per-process `cc_version` suffix, and the two random words plan mode appends to
its plan filename (the prompt-derived prefix is kept — naming the file after the
request *is* behavior).

That fixes the frame and request ordering — but not `background-task`, and the
honest answer there is a **documented exemption rather than more
normalization**. When the background agent completes, its result is spliced into
the parent's *conversation array* either before or after the parent's own reply,
and conversation order inside a request body is a real contract that must not be
sorted away; `subagent_stats.completed` likewise reads 0 or 1 depending on the
same timing, and ending the turn early just makes the two engines stop at
different frame counts. So `Scenario.substanceOnly` opts that scenario out of
diff grading **with a required written reason**, the runner prints the exemption
and the ungraded difference counts every run, and the scenario grades strictly
less than the others. The alternative — stretching normalization until it went
green — would have bought a passing gate by deleting a real contract.

## Next

Scale strangler replacement: one module at a time, each gated by
`strangle/gate.ts`.
