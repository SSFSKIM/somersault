# reforge — differential harness for interchangeable Claude Code engines

The M0 instrument of the engine-reimplementation experiment: drive *any* engine
build through the unmodified SDK wrapper (`sdk.mjs`, via its
`pathToClaudeCodeExecutable` seam) and grade behavioral equivalence by
normalized-transcript diff — record API traffic once, replay it offline into
every engine, compare what each engine says (SDK messages) **and** what each
engine asks (requests emitted).

Pinned target: **Claude Code 2.1.251** (`~/claude-code-bundle/2.1.251/`,
extracted per its MAP.md). The pin lives in **`src/pin.ts` alone** — one
constant; everything else derives from it. SDK wrapper:
`@anthropic-ai/claude-agent-sdk@0.3.251` (installed here with `--omit=optional`
— no platform binary; every run supplies its own engine).

## Engines (`engines/`)

Run **`npx tsx strangle/prepare.ts` first** — it materializes the engine set
under `build/` (gitignored) from the pin and boot-checks it. The wrappers fail
loudly (exit 127) if you skip it.

| name | what it is |
|---|---|
| `engine-real` | the pinned real Mach-O binary (reference / oracle) |
| `engine-extracted` | the same payload extracted from `$bunfs` and run as plain JS under **bun** (must be bun — silent no-op under node). Identical application code to `engine-real`, different packaging: the differ's self-test pair and the substrate the strangler reimplementation will replace module-by-module |
| `engine-strangled` | the extracted graph with every manifest method excised and delegated into reforge-owned modules |
| `engine-ts` | the reforge-owned TS reimplementation — plugs in as one more wrapper script; ccx and this harness change by zero lines. **W0 skeleton today**: it boots, reports the pin it targets and its (empty) owned-module set, and refuses any session with a structured error naming what is unowned. Needs no `prepare.ts` step — its code is committed source, not materialized. See `engine-ts/README.md` |

Wrappers are extension-less shell scripts on purpose: `sdk.mjs` treats non-`.js`
paths as native binaries and spawns them directly, so the shebang runs.

### Packaging changed under us at 2.1.248 — what the bump cost

The pre-2.1.248 payload was **one 28MB CJS blob**. It is now an **ESM graph**:
`cli` plus ~1800 `chunk-*.js` importing each other by `/$bunfs/root/…` — paths
that exist only inside the compiled binary's virtual filesystem, so from disk the
graph does not resolve at all (`Cannot find module`). `strangle/prepare.ts`
copies the extraction out and rewrites every occurrence to the copy's own
location, **absolute rather than relative**, because the same token also appears
in runtime asset reads, which resolve against cwd instead of the importing file
(124,500 specifiers across 1,657 files; ~2s).

**The catch-up was mechanical, as designed.** All three splice anchors survived
the packaging change verbatim and stayed globally unique, and all three target
method bodies were byte-identical modulo minified names — the write tool's
freshness suffix `hui` → `q6t`, glob's truncation notice `yzv` → `APn`, both
**re-derived by `deriveArgs`, neither hardcoded**. That is the whole bet behind
anchoring on string literals, and it held across ten versions and a bundler
rewrite. What did change is the prelude: with no CJS wrapper to inject source
into, each owning chunk now gets an `import` of the reforge-owned module placed
after its banner (imports hoist, so it initializes before the body delegating
into it). The banner must still stay byte-first, and every path that writes a
graph boot-checks it.

## Layout

- `src/pin.ts` — the pinned version + derived paths, **and the pinned bun** (§3.5). Bumping the pin is: extract the new version, edit one constant, re-provision the runtime, re-prepare, regenerate the gate-defaults fixture, re-record cassettes, re-gate.
- `src/env.ts` — **the allowlisted child environment and its record/replay credential schemas** (X6). Every engine spawn goes through it; nothing is inherited.
- `src/canonical.ts` — **the normalization spec**, shared by the differ and the replay proxy's match hash (§3.4). Grow it only with justification, and only with a paired regression test.
- `src/leakcheck.ts` — the gate-cache leak check run after every record and replay.
- `strangle/toolchain.ts` — re-derives the binary's embedded bun version and installs it into `toolchain/` (gitignored).
- `research/tools/extract-gate-defaults.ts` + `research/fixtures/` — the `ENGINE_VERSION`-keyed feature-gate defaults table and the per-gate env-override inventory.
- `strangle/prepare.ts` — materializes + boot-checks the engine set (`build/graph`, `build/real-binary`).
- `strangle/manifest.ts` — the splice manifest, in its own module so reading it never runs a build. Also the schema: target shapes + the capture taxonomy (below).
- `strangle/ast.ts` — anchor position → the span of its enclosing node, per declared target shape.
- `strangle/perturb.ts` — the derivation non-vacuity check (below); reads the pinned bundle, touches nothing under `build/`.
- `src/runTurn.ts` — shared driver: one prompt → one engine → captured SDK-message transcript. Determinism knobs: `settingSources: []`, fixed `sandbox/` cwd, telemetry env off.
- `src/proxy.ts` — record/replay proxy (`ANTHROPIC_BASE_URL` seam). Record forwards + captures (auth redacted before disk); replay serves deterministically (shared-canonical-form hash match, then per-path FIFO — a fallback is FATAL for any engine that is not the identical-code pair, §3.4) and logs every observed request for request-level diffing.
- `src/differ.ts` — **the definition of "behaviorally equivalent"**: scrubbed keys/patterns (ids, clocks `*_ms`/`*_at`, costs) are declared incidental; everything else must match. Its value-level scrubs now live in `src/canonical.ts`, shared with the proxy.
- `engine-ts/` — the reforge-owned engine (W0 skeleton: stream-json shell + module registry + static-reachability check). **Has its own `README.md`** — read it before registering a module.
- `ledger.json` + `ledger/` — the closure ledger: one row per in-scope subsystem and per headless catalog tool, with its ownership state, dependency edges, and upstream footprint. The campaign's primary progress metric; `ledger/check.ts` validates it against the canonical row list.
- `m0/` — milestone cells (below). `cassettes/`, `transcripts/`, `sandbox/` are generated (gitignored).

## Running

```sh
cd reforge && npm install --omit=optional
npx tsx strangle/toolchain.ts     # install the pinned bun into toolchain/ (once per pin)
npx tsx strangle/prepare.ts       # materialize + boot-check the engine set (required first)
set -a; . ../.env; set +a         # RECORDING only — replays need no credential at all
npx tsx m0/02-handshake.ts        # live: one turn per engine
npx tsx m0/06-selftest.ts         # records cassettes once (live), then replays OFFLINE
```

`unset ANTHROPIC_API_KEY` is no longer part of the recipe: the env schema
(`src/env.ts`, W0c) **selects** exactly one credential rather than inheriting
both, so the API key can no longer shadow the OAuth token. Replays are handed a
fixed non-secret placeholder, so grading the whole corpus offline needs no
credential in the shell.

Replays are fully offline — record once, grade forever at zero API cost. That
property is what makes a long-running reimplementation fleet affordable: the
fleet loops against cassettes; only new workload recordings spend tokens.

## M0 status (2026-08-24)

| cell | claim | status |
|---|---|---|
| M0.1 | extracted payload boots under bun (`--version` → the pin) | ✅ |
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

**The check runs against BOTH engines, and reports which side failed.** A
normally-graded scenario constrains the engine under test through the diff
against the oracle, so checking the oracle alone is *nearly* enough there — but
a `substanceOnly` scenario skips those surfaces, so an oracle-only check leaves
nothing at all asserting the engine under test. That is the same hollow pass one
level up: an engine that omitted `background-task`'s behavior outright would have
passed.

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
npx tsx strangle/build.ts [--sabotage <name>]   # -> build/strangled/
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
| background-task | a backgrounded `Agent` emits `task_started` + a `background_tasks_changed` listing that task, and folds its result back into the parent turn | recording blocked (rate limit) |
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
less than the others. Its substance check therefore carries the whole claim, on
both engines: the dispatch frames *and* the fold-back — presence only for the
fold-back, since what races is where it splices, not whether it arrives. Being
the only grader, the check asserts the **correlation identifiers themselves**,
not merely that frames appeared: `task_started` must carry a nonempty `task_id`
and a `tool_use_id` equal to the id of the `Agent` tool_use block that dispatched
it, and some `background_tasks_changed` frame must list an entry under that same
`task_id`. Those are the fields ccx joins its task panel on, and a laxer check
passes vacuously — an absent id on both sides compares `undefined === undefined`.
`m3/background-check.test.ts` is the negative control: it feeds the check
synthetic transcripts with each identifier missing, empty, or mismatched and
proves every one is rejected while the real shape passes. The alternative —
stretching normalization until it went green — would have bought a passing gate
by deleting a real contract.

## M3-B — the splice manifest (2026-08-25)

`strangle/build.ts` went from one hardcoded splice to a **manifest**: each entry
names the reforge-owned module, a true-substring-unique anchor, the delegation
key on `globalThis.__reforge`, an optional `deriveArgs` that recovers closure
identifiers **from the matched body**, and the corpus scenarios that cover it.

| splice | anchor disambiguates | closure captured | covered by |
|---|---|---|---|
| `write-tool-result` | the Edit tool has a sibling "has been updated successfully" template; the `.${` tail picks Write's | freshness suffix (minified `hui`) | `file-tools` |
| `task-create-result` | `" created successfully: "` is unique | none | `todo-tool` |
| `glob-result` | `'content:"No files found"};return'` — the bare phrase appears twice, once in a paginated sibling | truncation-notice fn (minified `yzv`) | `search-tools` |

Adding a splice is now: write the module + its sabotage twin, add a manifest
row, name its covering scenarios. Nothing else changes.

*(As of W0a below, the row also declares a `target` shape, and `deriveArgs` has
become a list of taxonomy-classified `captures`.)*

### The gate sabotages one splice at a time

**An all-at-once sabotage is not a liveness proof.** If every splice were
sabotaged together, the corpus would go red as long as *any single one* was
live — a dead splice could ride along forever behind a live neighbour. So the
gate builds once per splice with only that one sabotaged, and requires **its own
covering scenarios** to go red. The faithful build then has to pass the full
acceptance surface (`m2/all.ts`), not just the corpus.

`deriveArgs` throws rather than returning `[]` when it cannot find what it
expects, for the same reason: a silent empty derivation would build a
delegation that quietly references nothing it needs.

### Cassettes rot at midnight — and the rot was silent

The first manifest gate run failed `cross-resume`, and the cause was neither the
new splices nor the engines: **the engine stamps the current date into its
system prompt**, so a cassette recorded on 2026-08-24 stopped hash-matching on
2026-08-25 and the replay proxy fell back to positional matching — silently.
Positional order is usually right, so every other suite kept passing.
`cross-resume` was the only one that depended on exactness, because it opened a
**fresh proxy per query**: the fallback restarted from the top of the cassette
and served the first turn's response to the resume turn, which then answered
"OK" instead of the codeword.

Three fixes, one per layer:

- the date is scrubbed before hashing, so cassettes stop rotting daily;
- the replay proxy **counts positional fallbacks** and every runner prints
  `served POSITIONALLY (body hash missed — cassette may be stale)`, turning a
  silent degradation into a visible one;
- `cross-resume` now drives write-and-resume through **one** proxy, mirroring how
  the cassette was recorded — replay topology must match recording topology.

It also now tests the interchange properly: each pair has a different writer and
resumer, so "engine-real writes → strangled resumes" and the reverse are both
real cross-engine reads rather than same-engine round-trips.

## Pin bump — 2.1.241 → 2.1.251 (2026-08-31): GATE PASS

The first bump across a **packaging change** (see "Packaging changed under us"
above), which is the real test of the catch-up claim. Everything green:

| surface | result |
|---|---|
| corpus | **22/22 PASS** — including `background-task` and `fork-session`, whose cassettes were blocked by a rate limit at the old pin and are now recorded |
| full acceptance (`m2/all.ts`) | 5/5 — corpus, 5 fault injections, stream partials, cross-resume, raw protocol |
| strangler gate | **PASS** — all three splices individually live (each sabotaged alone → its covering scenario RED), faithful build equivalent on the full surface |

**Cost of the bump, honestly:** one new `differ` scrub, one stale check, and no
re-anchoring at all. The engine now reports a per-process unix socket on
`system:init` (`/tmp/cc-socks/<pid>.sock`) — a fresh pid every run, so oracle
sampling can never certify it and it had to be canonicalized at the source like
the proxy port, not triaged. The gate was separately boot-checking the retired
`build/cli-strangled.js` path, which failed every build after the layout moved to
`build/strangled/`; the build boot-checks the graph it writes, so the gate now
just relays the build's own verdict rather than keeping a second copy of the
check.

**One thing the bump measured and did not fix** (logged in
`docs/tech-debt-tracker.md`): freshly recorded cassettes still take 9 positional
fallbacks across 3 multi-request scenarios, because the proxy's match hash
scrubs less than the differ does — the engine writes a run-scoped `agentId` and
inline `duration_ms` into request *prose*. Reported, not silent, and every
affected scenario still graded identical on all three surfaces; the exactness
guarantee behind the match is what is weakened. Sharing normalization between
the two layers needs a design pass (a hash wants one stateless canonical form; the
differ deliberately wants run-scoped id *mapping*), so it is deferred rather than
regex-patched during a bump.

## W0b — the engine-ts skeleton + the closure ledger (2026-08-31)

The reforge-full campaign's foundation child C2 (spec
`docs/superpowers/specs/2026-08-31-reforge-full-campaign-design.md`, §2.4 and
§1.1; contracts X2 and X7). Two artifacts, both machine-checked:

**`engine-ts/` — the skeleton.** It exists at W0, not at the end, because of the
dependency-direction finding: spliced modules receive closure values *from* the
extracted graph, so without a second wire every "owned" module is secretly
substrate-dependent and the final wave degenerates into a big-bang rewrite. Each
wave now both splices the graph and registers its standalone-complete module
into the skeleton. Today it boots, answers `--version` with the pin it targets,
reports `--owned` (empty), and refuses any stream-json session with a structured
error naming all 15 unowned subsystems — exit 3, never a synthesized `result`
frame, never a hang. `check-reachability.ts` walks its import graph and fails on
anything reaching the extraction bundle, the pinned binary, or `build/`
(symlinks followed), on `/$bunfs/root/` specifiers, on computed dynamic imports,
and on any `engine-ts/` file the walk never reached — because an unregistered
module could otherwise carry a forbidden import invisibly. It is the static half
only; §3.6's OS-enforced hermetic gate is the proof, and it lands at W13/W14.

**`ledger.json` — the closure ledger**, the campaign's primary progress metric:
46 rows (15 subsystems from §1.1, 31 headless catalog tools from §1.3), each with
an ownership state, dependency edges, and an upstream-footprint slot
(`{chunk, hash}`, `null` until its wave records one). Opening state: 45
`unowned`, 1 `spliced` — the tool-result-formatter row, covering the three
existing leaf splices, and `spliced` rather than `standalone-complete` precisely
because those modules still take closure values from the graph.

`ledger/check.ts` refuses a row set that is not exactly `ledger/rows.ts`'s
canonical list, an invalid state, a dangling or self-referential edge, a
malformed footprint, an owned state with no footprint, a `stale` row with no
adjudication note, and an `engineVersion` that has drifted from the pin — so a
pin bump fails the check until §5's semantic invalidation has been run. Both
checkers ship with paired controls (28 ledger, 19 reachability, 25 skeleton
acceptance): every rule is watched rejecting its violation *and* accepting its
legitimate neighbour, per §3.1's non-vacuity doctrine.

```sh
npx tsx engine-ts/check-reachability.ts && npx tsx engine-ts/reachability.test.ts
npx tsx engine-ts/skeleton.test.ts
npx tsx ledger/check.ts && npx tsx ledger/check.test.ts
```

## W0a — splice mechanics generalized (2026-08-31): GATE PASS on six splices

The reforge-full campaign's foundation wave for the splice transform (campaign
spec C1; `docs/superpowers/specs/2026-08-31-reforge-full-campaign-design.md`).
The transform knew exactly **one** syntactic shape — a method named
`mapToolResultToToolResultBlockParam` sitting in an object literal, found by
searching backwards for that name and then scanning for balanced braces. Three
things changed, and the manifest grew a row per new shape to prove each.

### The anchor still locates; the AST now delimits

Anchoring stays a true-substring-unique **string literal** — that is the
versioning bet, and it has now survived ten versions and a bundler rewrite. What
moved is span-finding: the owning chunk is parsed (the TypeScript parser eats the
4.0 MB engine chunk in ~0.5 s with zero diagnostics), the anchor's position is
resolved to its deepest node, and the walk climbs parents until it reaches the
shape the manifest declares. The excised span is exactly that node's span — where
a brace scan approximates and can truncate silently.

Each shape carries its own delegation:

| `target` | node | replacement |
|---|---|---|
| `sibling-method` | method in an object literal | `name(params){return globalThis.__reforge.fn(args)}` |
| `class-method` | method in a class | same, with `this` as the first argument |
| `free-function` | function declaration | `function name(params){return …}`, `async` preserved |
| `switch-case` | one `case` clause | `case X:{…;break}` or `case X:{return …}`, per how the clause exits |

The existing three splices are **byte-identical** under the new path — same
sha256 for the owning chunk — so the generalization is provably a no-op on what
was already green.

### Captures are classified, not just derived

A splice's row now declares every value the excised body took from its enclosing
scope, each with a §2.4 class saying what an adapter may do with it:
`primitive` (own it and equality-assert the graph's), `pure-helper` (own it and
use ours in both wirings), `effectful-port` (an explicitly typed delegation
argument and a ledger edge to the wave that will own its far side). Today all
six rows wire every capture as a delegation argument; the retrofit that makes
the first two classes owned-and-asserted is W1's. The classification is the
truthful input to that work, not a claim that it has happened.

### Module layout and ownership hygiene

The rule the classification exists to serve: **no minified identifier crosses
into owned code**. What crosses the adapter boundary is data and typed ports,
never the graph's symbols — so an owned module names every value it receives in
its own vocabulary and documents the contract in its header, and a capture whose
far side this wave does not own is an explicitly named delegation argument, not
a mystery. Each splice is a pair under `strangle/modules/`: `<name>.js` (the
faithful implementation the gate grades) and `<name>.sabotage.js` (the liveness
twin). The third layer — a `custom` overlay for deliberate deviations, kept
apart from the parity implementation so the first real customization is not
indistinguishable from a bug — arrives with the first customization, not
speculatively.

A sabotage twin should be wrong in a way that is **loud and cheap**. Dropping a
value outright is loud but can leave the engine flailing (the first `text-delta`
twin returned empty assistant text, and the engine then retried the turn a dozen
times against an exhausted cassette — minutes of gate time for the same one-bit
answer). Corrupting the value while keeping the shape gets the same red in
seconds.

`npx tsx strangle/perturb.ts` is the non-vacuity check behind derivation. Per
capture, against the real span in the pinned bundle: **tracking** — rename the
identifier upstream and the derivation must return the new name (a hardcoded
derivation fails here) — and **loudness** — destroy the identifier and the
derivation must THROW rather than return something plausible. 44 checks, all
green at this pin.

### Every build emits an upstream footprint

`build/footprints.json` records, per splice, the owning chunk, the node, the
span, and a **sha256 of the excised upstream bytes** (taken after undoing
prepare.ts's `/$bunfs/root/` rewrite, so the hash moves only when upstream does).
That is what lets a pin bump invalidate owned rows *semantically*: an export
inventory cannot see a changed branch inside a body it still exports.

### The three spikes, and the two suggested targets that did not survive contact

| splice | shape | anchor | covered by |
|---|---|---|---|
| `env-block` | `free-function` | `"Is directory a git repo: "` | `subagent` |
| `text-delta` | `switch-case` | `"content_block_type_mismatch_text"` | `plain` |
| `session-materialize` | `class-method` | `"Session file materialize failed ("` | `resume` |

Each is a permanent owned splice on a real subsystem, not a throwaway. The env
block is covered by `subagent` rather than by everything, because the main
headless system prompt carries no `<env>` block — a dispatched Agent's does
(measured in the recorded request bodies).

Two of the census's suggested targets were **measured wrong** and replaced:

- **The control protocol is not a `switch` headlessly.** The first switch-case
  candidate was the engine's `interrupt` intent clause. It excised and
  boot-checked cleanly and its sabotage stayed **GREEN** — that switch belongs to
  the interactive engine driver, while headless `Query.interrupt()` lands in
  print mode's `if / else if` chain over `request.subtype`. A splice nothing
  reaches is dead code, so it was dropped rather than kept as an ungated row.
  W7 needs an if/else-arm shape, or a different seam.
- **The Bash executor cannot be delegated method-by-method.** Its command class
  keeps essentially all state in ECMAScript *private* fields, which are
  unreachable from outside the class body: a whole-body excision cannot be
  delegated unless the adapter left behind in the class marshals every private
  field the body touches. W10 must budget that adapter, or take the executor at
  S-module granularity.

Both are recorded as Revision Notes on the campaign spec, because they change
what a later wave has to budget.

### Gate

The perturbation check runs as the gate's first phase — cheap, build-free, and a
precondition for believing any of the rest.

```
━━━ derivation: every capture tracks its rename and throws when destroyed ━━━
  === derivation perturbation: 44 check(s) ===
  PASS — every capture tracks its rename and fails loudly when destroyed
...
━━━ equivalence: FAITHFUL build → full acceptance surface must be GREEN ━━━
  PASS  corpus (22 scenarios)
  PASS  faults (5 injections)
  PASS  partials (stream shape)
  PASS  cross-resume (store)
  PASS  raw protocol (no sdk)

=== strangler gate ===
  PASS  derivation perturbation
  PASS  liveness write-tool-result
  PASS  liveness task-create-result
  PASS  liveness glob-result
  PASS  liveness env-block
  PASS  liveness text-delta
  PASS  liveness session-materialize
  PASS  equivalence (faithful)

GATE PASS — every splice is live AND the faithful build is equivalent
```

Closure-ledger movement: `subsystem/environment-and-system-prompt`,
`subsystem/session-storage` and `subsystem/query-loop` move `unowned` →
`spliced`, and all four spliced rows now carry the upstream footprint hashes the
build emits (`ledger.json`, 46 rows, `spliced=4 unowned=42`).

## W0c — determinism & strict replay (2026-08-31): zero positional fallbacks

The reforge-full campaign's third foundation child (campaign spec C3; §3.3 gate
determinism, §3.4 replay strictness, §3.5 runtime pinning). Everything below
exists to answer one question honestly: **when two engines differ, is that the
engine, or is it the machine the harness happens to be running on?**

### The child environment is constructed, never inherited (`src/env.ts`, X6)

Every engine spawn — `runTurn`, `baseOptions`, the raw stream-json driver, the
origin probe, `prepare.ts`'s boot checks — now receives an **allowlisted** env.
Nothing from the operator's shell reaches the engine unless the schema names it,
and `assertSchema` re-checks that as a postcondition so a future caller cannot
quietly widen it.

The motive was a measured mechanism, not tidiness: the bundle carries ~200
`CLAUDE_CODE_*` knobs and at least one *per-gate* override that reaches the
resolver ahead of the compiled-in default. **Turning the allowlist on
immediately found two operator variables that had been steering the oracle all
along:**

| leaked variable | what it was doing |
|---|---|
| `CLAUDE_CODE_ENTRYPOINT` | stamped into every request body as `cc_entrypoint`. Cassettes recorded from inside a Claude Code session carried `sdk-cli`; the same recording from a plain terminal would have carried `sdk-ts`. The corpus's match key depended on which shell recorded it. Now pinned (`PINNED_ENTRYPOINT`), which also makes the SDK-driven and raw drivers agree — they share cassettes. |
| `ENABLE_PROMPT_CACHING_1H` | forced `cache_control.ttl:"1h"` on every prompt-cache breakpoint. Without it the engine falls back to per-scope resolution and the subagent/compaction lanes take `5m`. So the corpus had a **cost-bearing** behavior baked in from a shell export. Three cassettes were re-recorded rather than normalizing it away — prompt-cache TTL is behavior. |

**Credentials are selected, not inherited** (§3.3's round-3 interlock). Record
mode passes exactly one deliberately chosen credential, OAuth preferred; replay
mode passes a fixed non-secret placeholder, because replays are served entirely
by the local proxy and should not depend on the operator being logged in. That
replaces upstream's own precedence, where `ANTHROPIC_API_KEY` silently *shadows*
the OAuth token — the reason every run recipe here had to say `unset
ANTHROPIC_API_KEY` by hand. `src/env.test.ts` grades the five-case matrix
(OAuth-only / key-only / both / missing / seeded-override), each case watched
rejecting its violation *and* accepting its legitimate neighbour: 59 checks.

### Gate determinism: pin the disabled state, snapshot the defaults

- `DISABLE_GROWTHBOOK=1` joins the two telemetry kill-switches. All three trip
  the provider's `isEnabled()` off through *different* predicates; this is the
  narrowest and does not depend on the telemetry chain keeping its current shape.
- `CLAUDE_CODE_GB_DISK_CACHE_WHEN_TELEMETRY_OFF` — the one opt-in that would let
  a cached gate blob override a compiled default — cannot arrive by inheritance
  (not in the allowlist) *or* by hand (`FORBIDDEN_VARS`, refused even when a
  caller declares it as a deliberate override).
- **Leak check** (`src/leakcheck.ts`): after every record *and* every replay, the
  five GrowthBook/client-data cache keys must be absent from
  `reforge/config/.claude.json`. It fails the scenario; the H1 lesson is that a
  check which only sets `process.exitCode` gets overwritten by the final verdict.

**The defaults fixture** (`research/tools/extract-gate-defaults.ts` →
`research/fixtures/gate-defaults-2.1.251.json`, `ENGINE_VERSION`-keyed). Since
every gate resolves to its **call-site default** under these switches, the
effective gate configuration is those literals — and they are baked per build, so
a pin bump can change behavior silently. The extraction derives itself: it finds
functions whose body *shape* is the resolver alias (`return g(a,b).value`, or the
`getFeatureValueWithSource` primitive), resolves them through the ESM
export/import graph to each chunk's local binding, and collects call sites by AST
so a telemetry call taking the same `tengu_*` literal cannot be mistaken for one.

```
call sites: 505  distinct gates: 439  chunks: 120
default shapes: 392×boolean, 24×string, 21×null, 22×object, 3×array, 11×number, 32×computed
plausibility: 439 inline sites vs the research census of 431 (1.9%) — OK; +66 named through a const
```

Corroboration rather than coincidence: the research censused the pretty rendering
by text-grepping one alias for inline literals and got **431**; this AST walk
finds **439** on the comparable population. The extra 66 are call sites that name
their gate through a top-level `var X = "tengu_…"` const, which a literal grep
cannot see — and one of them is `tengu_luminous_whistle`, the single gate the
campaign spec names by hand. Gate reads whose default is a *computed* expression
are kept as their own section rather than dropped: engine-ts cannot serve those
from a constant table.

### Flip-liveness: an override does reach the engine, and the allowlist is what stops it

`m3/flip-liveness.ts` sweeps the fixture's own per-gate override inventory (13
entries at this pin), flipping each one *inside* the allowlist and diffing
against a baseline that is first proved self-consistent.

```
FLIP tengu_cobalt_ridge via CLAUDE_CODE_USE_POWERSHELL_TOOL="1" (default false) → transcripts 26, requests 50
       msg[1].body.tools[10].name: "Read" != "PowerShell"
```

**An override changes the headless tool catalog itself** — `Read` leaves the
presented tool array and `PowerShell` takes its place. That lands directly on
§1.3's moat surface, and it settles the precedence question empirically: the env
override is consulted *before* the compiled-in default, so the defaults fixture
describes reality only because the environment is locked.

The other twelve produced no observable difference on a headless replay,
including `CLAUDE_CODE_LUMINOUS_WHISTLE` — the one the spec names. That is not a
null result, it is the static analysis confirmed: its reader short-circuits on a
first-party-base-URL predicate (`cli.pretty.js:497713`) that a run pointed at the
local record/replay proxy can never satisfy, so the override is unreachable here
by construction.

**The negative control is what carries the claim either way**: the same 13
variables seeded into the *parent* process produce **zero** difference in the
child, on both surfaces. The allowlist, not luck, is what stands between an
operator's shell and the oracle.

### The runtime is pinned to what the binary embeds (§3.5)

The pinned Mach-O carries `Bun/1.4.1`; the external bun running the extracted
graph was **1.3.14**, a whole minor behind, and the gate was green on runtime
luck. `strangle/toolchain.ts` re-derives the embedded version *from the binary*
(two independent strings, which must agree), installs the matching bun into
`reforge/toolchain/` (gitignored, `~/.bun` untouched), and `prepare.ts` now
**refuses** a mismatch:

```
Error: runtime skew: /Users/new/.bun/bin/bun is 1.3.14, the pinned binary embeds 1.4.1.
```

Provenance, stated plainly: **1.4.1 has no tagged upstream release** (latest is
1.4.0). The only public build reporting `1.4.1` today is the rolling `canary`
asset, installed here as `1.4.1-canary.1+d9b769812`. The version string matches
the binary exactly; the underlying commit is not provably the one Anthropic
compiled against. Recorded rather than rounded up — and still far closer than a
minor version of skew. **Nothing went red under the matched runtime.**

### Strict replay: one canonical form, shared (`src/canonical.ts`, §3.4)

The proxy's match hash and the differ had drifted apart, so requests carrying a
run-scoped `agentId` or an inline clock missed the hash and were served
POSITIONALLY. Both layers now read one module, in tiers, because they are
comparing different things: the differ compares **two contemporaneous runs** and
can afford a stateful id *map* (an engine using two ids where the oracle used one
still diffs); the hash compares **a run against a recording from the past** and
needs the stateless equivalent.

| tier | used by | contents |
|---|---|---|
| run values | differ + hash | proxy port, inline `*_ms` in prose *and* XML, `cc_version` process suffix, `cc-socks` pid, plan-file random suffix |
| run id shapes | hash only | agent ids (`a` + exactly 16 hex), RFC-4122 uuids — the differ maps these instead |
| host state | hash only | the `gitStatus` block's `Status:`/`Recent commits:` sections |
| structural | differ + hash | `tool_result` ordering, with the cache breakpoint kept as a count |

The host-state tier is the one asymmetry, and the asymmetry is the point: the
differential sandbox lives inside this repository, so the `<env>` block a
dispatched Agent receives embedded the working tree and commit log — which rotted
the `subagent` and `background-task` cassettes at *every commit*. The hash
ignores it; the differ still grades it, so an engine that stopped emitting the
git block still fails the request diff. (Rejected: making the sandbox
git-invisible. `GIT_CEILING_DIRECTORIES` only half-worked — `status` and `log`
went quiet but the is-a-repo flag, branch and global `user.name` survived — and a
sandbox-owned repository would drop a `.git` directory and a seed commit into a
directory `search-tools` greps and `file-tools` writes into.)

`src/canonical.test.ts` is the non-vacuity control: 55 checks, every pattern
watched catching its value **and** sparing a deliberately adjacent neighbour — a
40-hex sha, a `toolu_` id, a *configured* `timeout_ms`, a different plan prompt,
a different branch name. Widening the agent-id pattern to `[0-9a-f]{16,}` turns
four of them red, which is how we know the suite is looking at something.

**A fallback is now FATAL for every `engineB` that is not `engine-extracted`.**
Warning-only survives solely on the identical-code self-test pair, which makes no
equivalence claim about a different implementation.

### What strictness caught the first time it ran

Both of these were pre-existing, both were invisible while fallbacks were a
warning, and both were real:

- **The engine downgrades out of SSE after a mid-stream failure.** A truncated or
  malformed stream makes it retry the *same* request with `"stream": false` — a
  one-character body difference. The derived fault cassettes had no entry for
  that request, so the retry was served the streaming entry positionally and both
  engines "failed identically" on a response neither had matched. `src/faults.ts`
  now derives the downgraded variant explicitly.
- **The raw stream-json driver was replaying the SDK corpus's cassette.** Print
  mode driven raw builds a materially different prompt from the same prompt text
  driven through `sdk.mjs` (106 KB vs 77 KB at this pin — the raw path also
  injects the Agent tool's agent-type catalog), so *every* raw replay had been
  served positionally. It now records and replays its own cassette. Replay
  topology must match recording topology; `cross-resume` taught the same lesson
  from the other direction.

### Result

```
=== strangler gate ===
  PASS  env schema + credential matrix
  PASS  canonicalization scrubs
  PASS  gate-defaults fixture matches the pin
  PASS  derivation perturbation
  PASS  liveness write-tool-result / task-create-result / glob-result
  PASS  liveness env-block / text-delta / session-materialize
  PASS  equivalence (faithful)

GATE PASS — every splice is live AND the faithful build is equivalent
```

Corpus **22/22**, full acceptance **5/5**, gate **PASS** — all under the pinned
1.4.1 runtime, the allowlisted environment, and **zero `served POSITIONALLY`
lines anywhere in the run**, with the strangled build graded under the fatal
rule.

```sh
npx tsx strangle/toolchain.ts --check        # embedded vs external runtime
npx tsx src/env.test.ts                      # X6 credential/allowlist matrix
npx tsx src/canonical.test.ts                # per-scrub regression + strictness
npx tsx research/tools/extract-gate-defaults.ts --check
npx tsx m3/flip-liveness.ts                  # override sweep + negative control
```

## Next

Continue widening the manifest, ordered by what the corpus already covers —
each new splice needs a covering scenario before it can be gated, so coverage
leads reimplementation rather than trailing it.
