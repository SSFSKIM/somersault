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

*(As of W0a below, the row also declares a `target` shape, a structural
`signature` for the node that shape resolves to, and `deriveArgs` has become an
exhaustive list of taxonomy-classified `captures`. As of W1 the module is a
DIRECTORY — `<name>/reference.js` plus `<name>/sabotage.js`, wired by the two
thin adapters `<name>.js` and `<name>.sabotage.js` — and a row may carry a
`coLiteral` when its anchor is not unique graph-wide. Manifest table below is the
M3-B snapshot; the current thirteen are tabulated in the W1 section.)*

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
on a bare specifier that neither resolves nor is a node builtin, and on any
`engine-ts/` file the walk never reached — because an unregistered module could
otherwise carry a forbidden import invisibly. Discovery is a **TypeScript AST
walk**: the regexes it replaced needed whitespace after `import`/`export`, so
`export{x}from"<chunk>"` and a re-export chain through one such line were
invisible. Resolved packages outside `ALLOWED_PACKAGES` are traversed rather than
treated as leaves, since a package entry can re-export a chunk. It is the static
half only; §3.6's OS-enforced hermetic gate is the proof, and it lands at W13/W14.

**`ledger.json` — the closure ledger**, the campaign's primary progress metric:
46 rows (15 subsystems from §1.1, 31 headless catalog tools from §1.3), each with
an ownership state, dependency edges, and an upstream-footprint slot — the record
C1's strangler build and C2's ledger share,
`{chunk, target:{start,end,sha256}, captures}`, `null` until its wave records
one. Opening state: 42 `unowned`, 4 `spliced` — the rows covering the six
existing leaf splices, `spliced` rather than `standalone-complete` precisely
because those modules still take closure values from the graph.

`ledger/check.ts` refuses a row set that is not exactly `ledger/rows.ts`'s
canonical list, an invalid state, a dangling or self-referential edge, a `stale`
row with no adjudication note, and an `engineVersion` that has drifted from the
pin — so a pin bump fails the check until §5's semantic invalidation has been
run. Footprints are checked against the artifacts they point at, not just for
shape: span sanity, the chunk's real bytes hashing to `target.sha256` against the
pinned bundle (absent bundle warns and skips; a mismatch fails), an evidence link
plus an X7 registration behind every owned state, and a cross-check against
`build/footprints.json`. Both checkers ship with paired controls (59 ledger, 30
reachability, 25 skeleton acceptance): every rule is watched rejecting its
violation *and* accepting its legitimate neighbour, per §3.1's non-vacuity
doctrine.

`captures` is **required**, not advisory, and resolved the same way the target
is: each capture's declaration span must hash to its recorded digest in the
pinned bundle, and an imported capture is resolved on *both* sides — the import
site in the owning chunk and the declaration in the exporting one. A footprint
that recorded only its target could not be staled when a captured declaration
moved, which is half of what §5 exists to catch. An **owned** capture additionally
carries `closure` — the transitive callees of the helper the module reimplemented,
each validated span by span against whichever chunk it names, and rebased into the
upstream basis the same way (W1 boundary review; see "Every build emits an
upstream footprint" below).

The ledger stores every span in the **upstream** basis (offsets into
`~/claude-code-bundle/<pin>/modules/…`, identical on every machine), while
`strangle/build.ts` emits them against its materialized copy, whose specifier
rewrite shifts them. `ledger/backfill-captures.ts` is the conversion: it rebases
each emitted capture, refuses to write any span whose bytes do not hash to the
emitter's digest, and copies through the emitter's `note` when a capture was only
narrowly coverable. Run it after any strangler build, then re-run the checker.

```sh
npx tsx engine-ts/check-reachability.ts && npx tsx engine-ts/reachability.test.ts
npx tsx engine-ts/skeleton.test.ts
npx tsx ledger/backfill-captures.ts --check   # ledger captures == the emitted footprints
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
argument and a ledger edge to the wave that will own its far side).

Classification and wiring are separate facts. Most rows still wire every capture
as a delegation argument; the retrofit that makes the first two classes
owned-and-asserted is W1's, and the classification is the truthful input to that
work, not a claim that it has happened. The one exception carries an `owned: true`
flag: `text-delta`'s `known`/`describe` — upstream `w`/`c` in `chunk-9rhc0mtn.js`,
one-line wrappers over `function r(n){return n}`, an erased type brand that is the
identity function at runtime. The owned module ships them, the build stops
forwarding them, and a contract test pins the behaviour.

The list is also EXHAUSTIVE, and machine-checked to be: the build derives each
excised body's free variables from a real lexical scope walk (`strangle/scope.ts`)
and refuses any mismatch against the declared captures in either direction. So
`captures: []` is the positive claim "verified zero free variables", not an
omission. Before that check the manifest was its own only witness — deleting a
row's captures made the build quieter rather than louder, and the corpus could
not tell either when the forgotten identifier is only read on a branch the
scenarios never take.

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
speculatively. *(W1 moved the pair into a directory: `<name>/reference.js` is the
parity layer and `<name>/sabotage.js` the twin, with `<name>.js` and
`<name>.sabotage.js` as the thin wirings that install them into the graph. The
reference file is also what `engine-ts/modules/index.ts` imports, so one file
serves both wirings — see the W1 section.)*

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
derivation must THROW rather than return something plausible. 44 checks, plus one
capture-inventory check per splice, all green at this pin.

### Every build emits an upstream footprint — target AND closure surface

`build/footprints.json` records, per splice, the owning chunk, the target span
with a **sha256 of the excised upstream bytes** (taken after undoing prepare.ts's
`/$bunfs/root/` rewrite, so the hash moves only when upstream does), and the same
for **every capture's declaration**:

```json
{ "chunk": "chunk-fy12d89p.js",
  "target": { "start": 3208589, "end": 3208823, "sha256": "764b83…" },
  "captures": [
    { "name": "w", "as": "known", "kind": "pure-helper", "declKind": "import",
      "declStart": 2797, "declEnd": 2798, "sha256": "50e721…",
      "from": { "chunk": "chunk-9rhc0mtn.js", "exportedAs": "w",
                "declStart": 638, "declEnd": 664, "sha256": "0f2b89…" } } ] }
```

That is what lets a pin bump invalidate owned rows *semantically*: an export
inventory cannot see a changed branch inside a body it still exports. The closure
half is not an extra — a splice consumes declarations that live OUTSIDE its span
(the Write tool's `q6t` suffix string, Glob's `APn` formatter, often in another
chunk entirely), and upstream can change any of them with the target span
byte-identical. An imported capture is covered on both sides: the import site,
which is what breaks if the export is renamed or dropped, and the declaration in
the exporting chunk, which is where the behaviour lives. When the far side is out
of reach the record carries a `note` saying so rather than narrowing silently.

An **owned** capture goes one level further, and has to (W1 boundary review). The
module reimplements it, and a reimplementation replaces not just the helper but
everything the helper delegates to: Read's owned notebook formatter is upstream's
`hyt`, whose entire body is `e.flatMap(UDn)` — `UDn` calls `NDn`/`$Dn`, where
notebook cell and output formatting actually live; Bash's `y1t` delegates to
`iyt` (data-URI parsing) and `$v` (magic-byte image sniffing, in another chunk).
Hashing only `hyt` and `y1t` let a pin bump rewrite image sniffing or notebook
output formatting with every recorded span byte-identical — a green ledger over
stale owned behaviour, on branches no scenario renders. So each owned capture also
records the **transitive closure** of what its declaration references, resolved
declaration by declaration (same chunk, or across an import) and recursed
breadth-first with the depth kept. On this pin the walks resolve **15 transitive
declarations across 8 owned helpers**, max depth 2. The walk is bounded at 6
levels / 20 declarations; when the bound is hit, or a callee resolves somewhere
the graph cannot follow, the enumeration is abandoned for hashing every chunk it
reached **whole**, with a note saying why — that stales the row on edits it does
not depend on, which is the right way to be wrong. A closure recorded as complete
when it is not is a false green, and a false green is the failure the record
exists to prevent.

### The target-identity guard

The shape walk climbs from the anchor to the NEAREST enclosing node of the
declared shape, so an anchor that drifts into a same-shaped nested helper
resolves to the inner node — a wrong-but-plausible splice the build had no way to
notice. Each row therefore records a **structural signature** verified at splice
time: the target's arity plus the syntax kinds of its enclosing shape-forming
nodes (`params=0 ancestry=SwitchStatement<SwitchStatement<FunctionDeclaration<SourceFile`).
Both facts are free of minified names and byte offsets — the two things that churn
every release — while descending into a nested callable necessarily prepends a
function-like kind to the ancestry. A mismatch fails the build and tells the
operator to re-verify the target and update the signature deliberately; it is
never auto-healed.

### Fixture negative controls (`strangle/mechanism.test.ts`)

Each of the four guards above is watched failing as well as passing, on synthetic
fixture chunks — the real bundle is never mutated, and a mechanism test that
needed it edited would be untestable exactly when it matters. Perturbing a
captured constant moves its capture hash and leaves the target hash untouched;
perturbing an imported helper's body moves its far-side hash and nothing else;
dropping a declared capture fails, inventing one fails; the drifted anchor fails
the signature guard while the verified one passes; a computed destructuring key
fails the build while a plain renamed property still forwards. 30 checks.

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

The mechanism and perturbation checks run as the gate's first phases — cheap,
build-free, and a precondition for believing any of the rest. Mechanism goes
first because it grades the machinery perturbation runs on.

```
━━━ mechanism: footprint closure surface, capture inventory, target guard, computed keys ━━━
  === splice mechanism: 30 check(s) ===
  PASS — footprint covers the closure surface, the inventory is exhaustive, the target guard holds, computed keys are refused
━━━ derivation: every capture tracks its rename, throws when destroyed, and is the complete inventory ━━━
  === derivation perturbation: 44 check(s) + 6 capture inventor(ies) ===
  PASS — every capture tracks its rename, fails loudly when destroyed, and the declared set IS the body's free-variable set
...
━━━ equivalence: FAITHFUL build → full acceptance surface must be GREEN ━━━
  PASS  corpus (22 scenarios)
  PASS  faults (5 injections)
  PASS  partials (stream shape)
  PASS  cross-resume (store)
  PASS  raw protocol (no sdk)

=== strangler gate ===
  PASS  splice mechanism
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
build emits (`ledger.json`, 46 rows, `spliced=4 unowned=42`) — target spans then,
plus all 22 capture declarations since the W0 close-out backfilled them.

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

**Credentials are selected, not inherited** (§3.3's round-3 interlock), and since
the W0 boundary review **the engine never holds a real one in either mode**. The
schema selects the *variable* — OAuth preferred, which replaces upstream's own
precedence where `ANTHROPIC_API_KEY` silently *shadows* the OAuth token — and
writes a **placeholder** into that variable, so the engine still takes the auth
path the operator's real credential implies. `startRecordProxy` swaps the real
value, read in the harness process, into the outbound auth header
(`Authorization` for OAuth, `x-api-key` for the key).

The motive was again measured. The pinned engine's subprocess environment
sanitizer strips `CLAUDE_CODE_OAUTH_TOKEN` from the environments it hands Bash
commands but **preserves `ANTHROPIC_API_KEY`**, so record mode used to make a
live key readable by any command the engine ran — and tool output flows into the
next request body, hence into cassettes, observed logs and transcripts, all of
which are committed.

`CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` looks like the obvious hardening and is
**refused**: at this pin a truthy value forces the permission mode to `default`,
overriding the `bypassPermissions` every corpus scenario is recorded under. It
would grade a different engine rather than a hardened one, so it joins
`FORBIDDEN_VARS` and the leak is closed at its source instead.

`src/env.test.ts` grades the five-case matrix (OAuth-only / key-only / both /
missing / seeded-override), each case watched rejecting its violation *and*
accepting its legitimate neighbour: **71 checks**.
`src/credential-leak.test.ts` is the end-to-end half — the real engine, record
mode, a FAKE credential, a stub upstream and a Bash command that dumps its own
environment: the fake value must appear nowhere, the placeholder must be visible
in the dump, and the stub must have received the fake value on the wire. Watched
failing: restoring the old one-line behaviour turns three of its ten checks red.

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

**The pin is the BYTES** (W0 boundary review). Because that asset *rolls*, a
version-string pin is a pin a moving target satisfies: tomorrow's canary, or any
`BUN` override that printed `1.4.1`, would have been accepted with the hash
difference downgraded to a printed note. `assertBunPin` now checks
`PINNED_BUN_SHA256` — on the downloaded candidate before install, on the cached
binary, and in `prepare.ts` on whatever `BUN` resolves to, env override included
— and the hash is checked *before* the binary is executed. Accepting different
bytes requires editing the pin constant. `strangle/toolchain.test.ts` watches it
both ways (7 checks): the cached surrogate passes; a copy with one appended byte,
a script that merely prints `1.4.1`, and a missing file are all refused.

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
| wall clock | differ + hash | `Today's date is …` body-wide; `The current month is …` **field-scoped** to `system` and `tools[].description` |
| run values | differ + hash | proxy port, inline `*_ms` in prose *and* XML, `cc_version` process suffix, `cc-socks` pid, plan-file random suffix |
| run id shapes | hash only | agent ids and session uuids **in the engine prose that mints them** — `agentId: a…`, `to: 'a…'`, `/tasks/a….output`, `<task-id>a…</task-id>`, `…/<uuid>/tasks/`. The differ maps these instead |
| host state | hash only | the `gitStatus` block's `Status:`/`Recent commits:` sections, **anchored to the whole envelope sentence** |
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

`src/canonical.test.ts` is the non-vacuity control: **84 checks**, every pattern
watched catching its value **and** sparing a deliberately adjacent neighbour — a
40-hex sha, a `toolu_` id, a *configured* `timeout_ms`, a different plan prompt,
a different branch name. Widening the agent-id pattern to `[0-9a-f]{16,}` turns
four of them red, which is how we know the suite is looking at something.

**A fallback is now FATAL for every `engineB` that is not `engine-extracted`.**
Warning-only survives solely on the identical-code self-test pair, which makes no
equivalence claim about a different implementation.

### Two ways normalization can be wrong, and the answer to each (W0 boundary review)

Every scrub is a bet that the text it erases carries no behavior, and the bet can
fail in both directions.

**Too narrow** rots at a calendar boundary. The WebSearch tool description
carries `The current month is August 2026`; the corpus was recorded in August, so
on 1 September *every* scenario missed its body hash and fell back positionally —
fatal under the rule above, which turned the gate's equivalence phase red on all
five surfaces while every graded surface was still identical. A scrub for the
sentence prefix both bundle phrasings share fixes it, scoped to the two fields the
engine authors so that a *user* prompt discussing a month still discriminates.

**Too wide** is the dangerous direction, and it was live: the id scrubs matched
by shape in *any* string anywhere, and the git-state pattern was not anchored to
its envelope. Two genuinely different requests carrying id-shaped tokens, or
quoting a status report, could share one replay key — the proxy would serve the
first match to both, report **zero** fallbacks, and grade two engines against a
response that answered a different question. Tightening the patterns to the
engine's own enclosing prose (table above) removes the known instances.

The structural backstop is what removes the *unknown* ones.
`assertNoKeyCollisions` runs at replay-proxy startup: if two entries whose raw
bodies differ share a canonical key, the proxy **refuses to start** and names the
first differing bytes. Residual over-reach — from these scrubs or any future one
— can now only refuse to run, never misroute. All 28 recorded cassettes load
collision-free; the suite's positive controls prove the check fires on two agent
ids, two session uuids, two host git states and two months.

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
  PASS  splice mechanism
  PASS  derivation perturbation
  PASS  liveness write-tool-result / task-create-result / glob-result
  PASS  liveness env-block / text-delta / session-materialize
  PASS  equivalence (faithful)
  PASS  credential leak (end-to-end, X6)
  PASS  runtime pin is the bytes (§3.5)

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

The two W0-boundary-review suites below used to run only by hand, alongside the
gate rather than inside it, because each spawns a real engine or hashes a 60 MB
binary and the determinism block is meant to be build-free and fast. They are now
the gate's **auxiliary** phase — last, after equivalence, so the build-free
checks still fail first — and a red in either fails the gate. Measured at ~5 s
combined, against a gate that builds seven times. They still run standalone:

```sh
npx tsx src/credential-leak.test.ts          # X6 end-to-end, fake credential + stub upstream
npx tsx strangle/toolchain.test.ts           # the runtime pin is the bytes
```

## W1 — the tool-result formatter family + the standalone-complete retrofit (2026-09-01)

Campaign child **C4** (spec `docs/superpowers/specs/2026-08-31-reforge-full-campaign-design.md`,
§2.4 dual-wiring, §2.5 layers, §3.2's state surface). The manifest went from **6 splices to 13**,
and — the part that matters more than the count — every owned module became **standalone-complete**:
it ships its own constants and pure helpers, and the only things still crossing the adapter are
typed ports and the primitives it deliberately asserts.

| splice | anchor | captures owned / ported | covered by |
|---|---|---|---|
| `write-tool-result` | `has been updated successfully.${` | 1 primitive / — | `file-tools` |
| `edit-tool-result` | `All occurrences were successfully replaced.` | 1 primitive / — | **`edit-tool`** |
| `read-tool-result` | `PDF pages extracted: ` | 6 helpers / 2 ports | `file-tools` |
| `bash-tool-result` | `<error>Command was aborted…` + `coLiteral` | 5 helpers, 3 primitives / 3 ports | `bash-tool`, `hooks`, `partial-tool-args`, `parallel-tools` |
| `grep-tool-result` | `"occurrence":"occurrences"` | 2 helpers / — | `search-tools` |
| `glob-result` | `content:"No files found"};return` | 1 helper / — | `search-tools` |
| `task-create-result` | `" created successfully: "` | none | `todo-tool` |
| `task-get-result` | `Blocked by: ${` | none | **`task-family`** |
| `task-list-result` | `No tasks found` | none | **`task-family`** |
| `task-update-result` | `Task completed. Call TaskList now` | — / 2 ports | **`task-family`** |

Ten of the graph's **44** `mapToolResultToToolResultBlockParam` methods, 6,568 minified chars. Plus
the three W0a spikes (`env-block`, `text-delta`, `session-materialize`), retrofitted the same way.

### Coverage led, and it had to: four of the seven had none

The W1 anchor scout measured the corpus before any code was written and found **no Edit scenario and
no TaskGet/TaskUpdate/TaskList scenario at all**. A splice with no covering scenario is ungated by
construction — the gate's solo-sabotage phase fails it outright — so two scenarios were written and
recorded live *first* (`reforge/w1/scenarios.ts`), taking the corpus to **24**:

- **`edit-tool`** drives both formatter arms in one walk: Write a three-line file, Edit one
  occurrence, then Edit with `replace_all`. The recorded results carry
  `The file <p> has been updated successfully.<suffix>` and
  `The file <p> has been updated. All occurrences were successfully replaced.<suffix>`.
- **`task-family`** walks TaskList (empty) → TaskCreate ×2 → TaskList → TaskGet → TaskUpdate, so
  `"No tasks found"`, `#1 [pending] REFORGE_TASK_ONE`, TaskGet's three-line block and
  `Updated task #1 status` are all observable. Its substance check asserts TaskList ran **before**
  the first TaskCreate, because otherwise the empty-list arm is never rendered.

### The retrofit: `primitive` and `pure-helper` do not wire the same way

§2.4 reads as though both classes simply become "owned". They cannot share one wiring, and the
difference is the whole value of the primitive class:

- **`pure-helper` → owned and NOT forwarded.** The module ships the implementation and uses it in
  both wirings; the graph's function is never called and never identity-compared. The build still
  derives and footprints the graph's binding, so §5 can stale the row when upstream moves it.
- **`primitive` → owned AND still forwarded, on purpose.** The module uses its own copy; the
  graph's copy crosses only so the adapter can equality-assert it, on every single delegation. That
  is not ceremony. A constant whose *value* changes while its name stays put moves no anchor and no
  target-span hash — the assertion is the cheapest thing that can see it, and it costs a comparison.

So `owned: true` marks pure helpers only. The Write and Edit formatters share **one** owned constant
(`strangle/modules/shared/file-state.js`), asserted from both adapters — the coordination point the
W2 scout named, closed before it could become two independently transcribed strings.

What stayed a port is stated in each module's header rather than implied: Read's staleness prefix is
a WeakMap **plus a clock**, Bash's background output path reads a live registry, TaskUpdate's two
agent-team predicates reach a gate and an env var. Those are ledger edges, not leftovers.

### Two mechanism gaps, found by real targets

- **Grep was unspliceable.** Its first parameter is `{mode:e="files_with_matches", …}`, and
  `strangle/ast.ts` refused every parameter-destructuring default. The refusal was
  over-conservative: the delegation reproduces the original parameter list verbatim, so the default
  applies exactly once — in the adapter — before the bound name is forwarded, and the owned module
  sees precisely what the excised body saw. Defaults forward now; a default inside a *nested*
  pattern is still refused, because the nested pattern is.
- **Bash has no graph-unique literal.** Its only distinctive string,
  `"<error>Command was aborted before completion</error>"`, occurs **twice in every bundle from
  2.1.220 to 2.1.251** — the engine chunk and the Windows/PowerShell sibling. Extending the anchor
  in either direction reaches a minified local name, the bet this project has watched lose twice in
  one bump. A row may now declare a **`coLiteral`**: a second literal that must occur in the same
  chunk, after which the anchor must be unique among the chunks carrying both. Deliberately a
  literal and **never a chunk name** — chunk names are content-addressed and churn per pin (2.1.241
  was one `cli` file; 2.1.251 is 400+ `chunk-<hash>.js`), so name scoping would turn every bump into
  a manual re-anchoring pass and destroy exactly the property literal anchors exist for. Bash's is
  `"Run shell command"`, taken from the same object literal as the target, so it names the tool
  rather than the packaging. Every way of mis-declaring the scope throws
  (`strangle/mechanism.test.ts`).

### A green gate says less about an owned module than about a spliced one

Sabotaging a whole method reddens its scenario even when the corpus touches one branch of six — and
after this retrofit the *implementation* of those other five is ours. Measured: the corpus renders
**one of Read's six** result arms, **one of Grep's three**, the plain stdout path of **Bash's six**,
and **never truncates a Glob result at all**.

So §2.4's second clause stops being optional. `strangle/contracts.test.ts` is a new gate phase —
**135 checks**, every expectation written out in full rather than recomputed from the
implementation: Glob's three truncation outputs, `formatBytes` across four unit bands and both
boundaries, Read's numbering helpers and all six result arms (including both ports), the notebook
text-merge with an image breaking the run, Bash's preview splitter and its strict halfway test, the
magic-byte image sniff, Grep's content and count arms, Edit's two arms × three suffix states, the
whole task family — including TaskUpdate's completion nudge with its two ports stubbed **true**, the
branch a headless corpus cannot reach.

### The fourth diff surface (§3.2, cheap subset)

Transcripts, events and requests all describe what the engine *said*. `src/state.ts` adds what it
*did*: the sandbox filesystem tree, recursive and content-hashed, plus the engine's termination —
graded per scenario, failing on any difference, and graded even on `substanceOnly` scenarios, since
that exemption is about transcript nondeterminism and says nothing about what an engine left on
disk. The per-scenario line prints the entry count, so an "identical" over two empty trees reads as
the weak claim it is.

The exit half is **derived**, and says so: capturing a real exit status needs either an env var
outside the X6 schema or dropping `exec` from the engine wrappers — and dropping `exec` puts a shell
between the SDK and the engine, so an aborted run (the corpus has two) would signal the shell and
orphan the engine. It reads the outcome the runner can already see. Process supervision arrives with
the full surface at W9. `src/state.test.ts` is the non-vacuity control: a same-length content change,
a stray file, a missing file, a symlink target and each exit class are all caught, and an mtime
change is ignored — exactly what the canonicalization claims.

The snapshot starts at the sandbox **root itself** (the entry `"."`, carrying its existence and
kind), which the W1 boundary review found missing: listing only the children made an *absent* root
and an existing but *empty* one the same empty array, so an engine that deleted its working
directory graded identical to one that correctly left it clean — on the surface whose entire job is
seeing what a run did to the machine. A missing root now reports `kind: "missing"` and diffs against
the `"dir"` an empty one reports; a root replaced by a file is its own difference; two existing empty
roots still match. `lstat`, not `existsSync`, so a dangling symlink root is a symlink rather than an
absence.

### Dual-wiring is now two importers of one file

There is **one** owned implementation per module, at `strangle/modules/<name>/reference.js` — plain
ESM, no `globalThis`, no minified identifier anywhere in it. Two wirings import that same file: the
strangler adapter (`strangle/modules/<name>.js`), which installs it into the extracted graph and
asserts the primitives, and `engine-ts/modules/index.ts`, which registers it. Importing it in the
skeleton is not decoration — `check-reachability.ts` walks that graph, so all thirteen reference
modules are proven statically, per run, to reach no extraction chunk, no pinned binary and no
`build/` artifact.

The refusal frame got more careful in the same commit. With ten of 44 formatters registered, three
subsystems now have an owned module, and the old wording would have read "engine-ts owns 3/15
in-scope subsystems" — a claim ten formatters do not support. It now reports the two populations
separately and says in words that **registration is per module and partial ownership is not
ownership**.

### Ledger: one row became two, and none of them moved to `standalone-complete`

§1.1's first row was "Tool result formatters **+ validators**". C4 subdivided it with evidence: the
Edit tool's error results are not produced by the formatter at all but by a sibling
`async validateInput` — 3,317 minified chars against the formatters' 155–1,590, with filesystem
reads, `readFileState` access, telemetry and gate reads. Keeping both halves in one row would make
"the formatters are owned" and "the validators are owned" indistinguishable states. The new
`subsystem/tool-result-validators` row is `unowned`, filed under C4 because C4 is what subdivided
it, with an open note recording that **C4 does not close it**.

And the formatter row stays **`spliced`**, not `standalone-complete`: ten owned modules against 34
formatters still in the graph is not an owned family. Same for the three spike rows — one `<env>`
function is not prompt assembly, one delta arm is not the turn driver, one materializer is not the
`SessionPort`. Per-module ownership is real and is recorded through the registry; per-subsystem
ownership is what the ledger grades, and it has not happened yet.

### Gate

```
=== strangler gate ===
  PASS  env schema + credential matrix
  PASS  canonicalization scrubs
  PASS  state surface catches what it claims
  PASS  gate-defaults fixture matches the pin
  PASS  splice mechanism
  PASS  owned-implementation contracts
  PASS  derivation perturbation
  PASS  liveness write-tool-result
  PASS  liveness edit-tool-result
  PASS  liveness read-tool-result
  PASS  liveness bash-tool-result
  PASS  liveness grep-tool-result
  PASS  liveness glob-result
  PASS  liveness task-create-result
  PASS  liveness task-get-result
  PASS  liveness task-list-result
  PASS  liveness task-update-result
  PASS  liveness env-block
  PASS  liveness text-delta
  PASS  liveness session-materialize
  PASS  equivalence (faithful)
  PASS  credential leak (end-to-end, X6)
  PASS  runtime pin is the bytes (§3.5)

GATE PASS — every splice is live AND the faithful build is equivalent
```

Twenty-three phases, up from fourteen: thirteen liveness lines instead of six, plus the two new
non-vacuity phases (owned-implementation contracts, state surface). `bash-tool-result` is the row
whose solo sabotage reddens **four** scenarios rather than one — every scenario that runs a Bash
command reads its result back — and all four are listed in its manifest row so the expected-RED set
is not mistaken for a regression.

Corpus **24/24**, full acceptance **5/5**, **13** liveness phases, zero positional fallbacks.

### Two ways a green gate could still be lying (W1 boundary review)

Both findings were the same shape as W0's: a check that passes because it cannot see the thing it
claims to watch.

- **Transitive pure-helper footprints.** The footprint covered each owned helper's own declaration
  and stopped. But an owned helper is *reimplemented*, and Read's and Bash's owned helpers are both
  one-line delegations — `hyt` is `e.flatMap(UDn)`, `y1t` is `iyt` then `$v`. Every byte that decides
  their behaviour lives one level out, in declarations nothing recorded, so a pin bump could rewrite
  notebook output formatting or image sniffing with the whole ledger green. The emitter now walks the
  transitive closure (details under "Every build emits an upstream footprint"); the control is a
  fixture whose transitive callee is perturbed length-preservingly with the helper, the import site
  and the target all byte-identical — the footprint has to move, and with the walk disabled ten
  controls fail.
- **The state surface could not see a deleted sandbox.** `treeOf` returned the same empty array for
  an absent root and an existing empty one, so an engine that deleted its working directory graded
  identical to one that left it clean. The snapshot now opens with the root itself (details under
  "The fourth diff surface").

## W2 — tool descriptions, and the first chunk the graph no longer owns (2026-09-01)

Campaign child **C5** (spec §2.2 S-chunk, §2.1 S-method, §3.1 coverage attestation). Two things
land: the four tool-description functions become reforge-owned, and the strangler gains a second
unit of ownership — the **chunk**.

| row | mechanism | what is owned | covered by |
|---|---|---|---|
| `glob-description` | **S-chunk** | all of `chunk-y30v0ja7.js`: `"Glob"`, `"REPL"`, the Glob description | `search-tools`, **`search-tools-lean`** |
| `read-description` | S-method (free-function) | the Read description; 2 primitives, 2 ports | `plain`, `api-error` |
| `grep-description` | S-method (free-function) | the Grep description; 3 primitives, 2 ports | `search-tools`, **`search-tools-lean`** |
| `webfetch-description` | S-method (free-function) | the WebFetch description + its usage-notes block; 2 ports | `plain`, `api-error` |

Manifest: **13 splices → 16 splices + 1 chunk**. Corpus **24 → 25**.

### S-chunk: the file, not the function

`chunk-y30v0ja7.js` is now 1,545 generated characters where 1,590 minified ones were, and none of
them are upstream's. The W2 scout's inventory
(`reforge/research/2026-08-31-w2-schunk-scout.md`) is what made that safe — 3 exports, no top-level
side effects, no live bindings, no re-exports — but the build does not take the scout's word for any
of it. Per run `strangle/chunk.ts`:

1. **locates the chunk by a graph-unique string literal**, exactly as a splice is located. Never by
   chunk name: names are content-addressed and churn per pin, and name-scoping would turn every
   bump into a manual re-anchoring pass;
2. **audits the top-level statements** and refuses anything that is not an import, a declaration or
   the single local export clause. A chunk with side effects is not clean for whole-file
   replacement, and "the scout said it was clean" is a claim about bytes that have since moved;
3. **re-derives every export name and every import binding by shape**, and requires each derived set
   to *equal* the real one. §2.2's rule is that export names churn, so they are derived rather than
   written down; the set equality is the other half — an unclaimed export would silently drop a
   binding thirteen other chunks import, and an unclassified import would hide a ledger edge;
4. **compares constant exports against the pinned chunk's own values**, at build time.

### Sabotage is per export, and one export is dark

§2.2 prices S-chunk at "behavioral coverage + sabotage evidence for every retained export, not just
the headline function". One twin per chunk cannot deliver that: it passes as long as *any* export is
live, which is the same vacuous shape solo-sabotage exists to refuse one level down. So
`--sabotage <row>:<export>` takes exactly that binding from the module's sabotage layer and leaves
the others faithful, and the gate walks one liveness phase per export.

Which surfaced the honest edge case. `"REPL"` — the chunk's grab-bag half — is **unobservable by any
corpus request**, and that is a property of the engine rather than of the corpus: the REPL tool sits
behind an interactive-entrypoint test that is false on every headless run, and all four of its
readers are downstream of that gate. Measured: the literal appears in no recorded request except as
prose inside an unrelated tool's description.

Rather than quietly leaving it ungated, the row declares a reviewed `darkReason`; the machinery
refuses an empty coverage list that has no such reason, and the gate prints the adjudication as its
own phase. What grades it instead is *stronger* than a differential red would be — the build
compares the owned constant against the value the pinned chunk declares, every run. A differential
red can only see a constant some scenario happened to render.

### A 25th scenario, because two lean arms had no coverage at all

All four descriptions have the shape `leanPrompt(model) ? brief : full`. Measured across the
recorded requests: Read's and WebFetch's text rides in 23 of 24 scenarios, and `api-error` takes
their lean arm (its deliberately invalid model id falls outside the lean-prompt family test). Glob's
and Grep's appear in exactly **one** request in the whole corpus — `search-tools`, the only scenario
whose `allowedTools` admit them — and that scenario runs a sonnet model. Their lean arms were
unexecuted everywhere.

`search-tools-lean` is the intersection and nothing more: the search-tools tool set on the api-error
model. The request goes out with the full catalog before the model id is rejected. Verified to carry
both lean descriptions and neither full one.

**This corrects the scout on a point that mattered.** The scout read `O_n` as called only via
`description(){return O_n(void 0)}`, making the lean arm dead on its only call path. It is also
called by `prompt({model:e})` — the method that actually fills `requestBody.tools[].description` —
so the arm is live, just unreached by a sonnet corpus. Had that stood, W2 would have recorded a
*reviewed exclusion* for a branch that a single cheap scenario covers.

### Coverage attestation (§3.1's debut)

Solo-sabotage proves a target is **reached**. It says nothing about which of its branches the corpus
renders — and after C4's retrofit, the unrendered ones are our implementation too. `strangle/attest.ts`
closes that:

```
=== coverage attestation: 14/20 executed, 6 excluded ===
PASS — every branch of every attested module is executed or carries a reviewed exclusion
```

Three properties are load-bearing, and each answers a way this mechanism could pass vacuously:

- **The inventory is machine-made and complete.** `strangle/branches.ts` walks the AST for every
  branching construct and **refuses** any it cannot record, rather than skipping it. A tool that
  silently ignores what it does not understand reports full coverage of the subset it understood.
  §3.1 says "major branches" is not a category; this is what makes that enforceable. C5x widened
  what it *can* record — switch clauses (marked per arm), try/catch (two arms on one site), loops
  (by their condition, which makes the zero-iteration arm exact) and single-link optional chains —
  and left four forms refused **by name and with a reason**: a switch with no `default` (the
  no-match path is an arm of no clause), `for(;;)`, a try block that can `return` (the
  end-of-try marker would be skipped on a non-throwing path), and the two optional-chain forms that
  cannot be recorded without over-reporting or moving `this`. `strangle/branches.test.ts` is the
  control: every refusal has a fixture, every recordable form has one too, and each is instrumented,
  executed and compared against the same module uninstrumented — 29 checks.
- **Measurement is on the graded code, not a copy of it.** `strangle/build.ts --instrument` rebuilds
  the strangled graph against an instrumented copy of `strangle/modules`, and every covering
  scenario must stay **GREEN** on it before any coverage is read. An instrumented build that
  diverges is measuring a different engine. No env var carries the recorder's output path (X6
  forbids one); the directory is baked in at generation time, and it appends on first hit rather
  than flushing at exit, so a killed engine still reports what it ran.
- **A stale exclusion fails, in both directions** — one naming a branch that no longer exists (the
  code moved, so the reason now protects nothing), and one the corpus has since started to execute
  (the reason is obsolete, and leaving it would excuse the next real gap on that branch id). The
  adjudication rules live in `strangle/adjudicate.ts`, pure, and `strangle/attest.test.ts` is the
  committed control: both stale directions, an unadjudicated branch and an empty inventory each
  fail, and a fresh attestation passes — 10 checks, in the gate's mechanism block. (W2 asserted
  these controls existed before they did; C5x wrote them.)

The six exclusions are all *environment*-pinned rather than unexamined: the subagent-steer arm of
Glob and Grep (its four sources are an env var X6 forbids, empty clientData, a GrowthBook flag §3.3
pins disabled, and an unset model floor — and it latches on first call), the PDF-capability arm of
both Read arms (needs a `claude-3-haiku` session; reachable, deferred, and recorded as a deferral
rather than an impossibility), and the claude.ai artifact carve-out of both WebFetch arms (needs the
Artifact tool in the session catalog, which the headless catalog does not have).

### What grades a branch no scenario renders

Each exclusion names its oracle, and it is not "nothing". `strangle/description-parity.test.ts`
extracts the four description functions **out of the pinned bundle**, evaluates each with stubbed
ports, and requires byte identity with the owned module over the full cross-product of their
branches — 18 checks. So an excluded arm is graded against upstream *directly*, which is stronger
evidence than a differential red gives a rendered one: a red only ever compares what a scenario
happened to produce.

This is the shape §2.4's "contract test where the helper's domain is wider than the corpus" should
probably take everywhere the upstream body is still on disk. It hand-writes no expectations, so it
cannot encode a transcription error, and a pin bump that moves a body breaks it loudly.

### The closure ledger now fails the gate

C4 left this as a standing suggestion; C5 adjudicates it yes. The ledger is the campaign's progress
metric and nothing validated it on the way past. Two build-free phases, under a second: the
checker's own fixture controls first (it must reject a fabricated footprint, a dangling edge, an
ownership claim with no registration), then the real ledger.

### Ledger: `spliced`, and the row says why not more

`subsystem/tool-descriptions` moves `unowned → spliced` with four footprints, four typed-port edges
and eight evidence links. It does **not** move to `standalone-complete`, and this is the same
judgment W1 made about the formatter row. The row's charter is *every* description function plus the
satellite chunks' other exports; one of those four chunks is owned end to end, and the other three
carry 15/17/4 exports of unrelated behaviour — PDF page-range parsing, the REPL registry, the
deferred-tool policy, the WebFetch answering prompt — that stay upstream's. Every owned module is
individually standalone-complete and registered through X7; the *row* is not closed, and saying
otherwise would make "the description family is owned" and "one chunk of it is" the same state.

The four ports are the honest price, recorded as edges: `leanPrompt` (system-prompt policy, → C6),
`subagentSteer` (subagent dispatch, latching + telemetry, → C15), `pdfCapable` (reads the session
model, → C16) and `cacheTtlPhrase` (the WebFetch cache TTL, → the WebFetch tool row).

### The first thing the ledger phase caught was three of its own controls

Wiring `ledger/check.test.ts` into the gate paid for itself on the first run, in the way these
checks usually do: not by catching a bad ledger, but by catching a control that had stopped being
one. Three of the checker's negative controls — `standalone-complete` with no footprint, `assembled`
with no footprint, `standalone-complete` against the live registry — used
`subsystem/tool-descriptions` as their fixture, because at C4 it was a row with no footprint, no
evidence and no registration. This wave gave it all three. The controls kept running and kept
reporting PASS, while the mutation they applied was no longer a violation of anything.

The fixture is now *derived* from the committed ledger — the first subsystem row still unowned,
unfootprinted, unevidenced and unregistered — so it follows the campaign rather than expiring at
whichever wave owns the row it named, and the derivation throws with instructions if the campaign
ever runs out. 59 controls, all green.

### Gate

```
=== strangler gate ===
  PASS  env schema + credential matrix
  PASS  canonicalization scrubs
  PASS  state surface catches what it claims
  PASS  gate-defaults fixture matches the pin
  PASS  closure-ledger checker fixtures (X2)
  PASS  closure ledger is green (X2)
  PASS  splice mechanism
  PASS  owned-implementation contracts
  PASS  description parity vs the pinned bundle
  PASS  derivation perturbation
  PASS  liveness write-tool-result
  PASS  liveness edit-tool-result
  PASS  liveness read-tool-result
  PASS  liveness bash-tool-result
  PASS  liveness grep-tool-result
  PASS  liveness glob-result
  PASS  liveness task-create-result
  PASS  liveness task-get-result
  PASS  liveness task-list-result
  PASS  liveness task-update-result
  PASS  liveness read-description
  PASS  liveness grep-description
  PASS  liveness webfetch-description
  PASS  liveness env-block
  PASS  liveness text-delta
  PASS  liveness session-materialize
  PASS  liveness glob-description export globToolName
  PASS  liveness glob-description export replToolName (dark, adjudicated)
  PASS  liveness glob-description export globDescription
  PASS  coverage attestation
  PASS  equivalence (faithful)
  PASS  credential leak (end-to-end, X6)
  PASS  runtime pin is the bytes (§3.5)

GATE PASS — every splice is live AND the faithful build is equivalent
```

**Thirty-three phases**, up from twenty-three. Six of the ten are new machinery rather than new
splices: the two closure-ledger phases, the description-parity contract test, the coverage
attestation, and the three per-export liveness lines the S-chunk row contributes — one of which is
the printed adjudication for the export the corpus cannot see.

Corpus **25/25**, full acceptance **5/5**, **20** liveness phases. Zero positional fallbacks, and
that is not a separate claim: a fallback is fatal for any `engineB` other than the identical-code
pair, so a green equivalence phase against `engine-strangled` *is* the zero-fallback proof (§3.4).

## C5x — mechanism round 2: three new target shapes, and the machinery's own controls (2026-09-01)

Campaign child **C5x**, inserted by the roadmap between W2 and the C6–C10 bloc because the W3–W7
anchor scouts measured four transform gaps that would have blocked the waves that follow. Ten units;
what changed, and what each one is evidence for.

### Three new target shapes, each spiked on a real target

§2.1's rule is that a new shape ships behind a mechanism spike — a live target excised, boot-checked,
sabotaged RED, restored GREEN, its derivation perturbed. All three took targets the scouts had
already verified, so each spike is also a permanent owned splice rather than a rehearsal.

| shape | why the mechanism had no target | spike | covering scenario |
|---|---|---|---|
| generator (`yield*`) | the hook dispatchers known at the time were all `async function*`, and a `return`-shaped delegation cannot carry a generator at all (W5's full set turned out to have three shapes, but this one is thirteen of the twenty) | `b3e` / `executePostToolHooks` (363 chars) | `hooks` |
| `arrow-initializer` | the permission chain's three entry points are ONE `var` statement with three arrow declarators | `kye` / `hasPermissionsToUseToolWithSink` (121 chars) | `permission-broker`, `permission-bag` |
| `variable-declarator` | the engine's prompt text lives in `var` initializers, not in functions | `l1n`, the 5,810-character compaction summarization prompt | `slash-compact` |

**The generator delegation is `return yield* globalThis.__reforge.fn(…)`**, which is the only form
that carries all three parts of a generator's contract across the seam: the yielded sequence, the
completion value, and `next`/`throw`/`return` signalling into the delegate. The fixtures do not read
the rewrite — they execute it against a stub delegate and assert each part, including that a caller's
`throw()` lands inside the delegate's own `catch`.

**The arrow shape excises the arrow and nothing else.** Its neighbours, the commas between them and
the `var` keyword belong to bindings the row is not claiming; the spliced chunk keeps `Dd` and `von`
byte-identical, which a fixture asserts directly. What an arrow inherits lexically is refused rather
than approximated: a body reading `this` would see the owned module's, and a body reading `arguments`
is invisible to the capture inventory, which treats it as ambient — true for every other shape,
because a function declaration binds its own.

**The declarator shape brought a value comparison with it.** A prompt's value IS its behaviour, and
it is the one class of upstream change nothing else in the mechanism can see: a constant whose
wording moves while its name stays put moves no anchor, no target hash and no capture hash. So for a
literal-valued declarator the build compares the owned value against the pinned chunk's own bytes and
reports the first differing character. That is chunk.ts's rule-5 argument one level in, and stronger
than a differential, because it holds for a constant no scenario renders.

The comparison is `ast.ts`'s `gradeDeclaratorValue`, and it has its own controls (C5x fix): the
mechanism fixtures drive the same function the build runs, watch it throw on a perturbed **owned**
value — never on upstream's, which is the side it grades against — and check that the failure names
the first differing offset and both lengths. The **not-a-literal** path was the other half. It used
to annotate the log line `[value NOT literal — graded differentially only]` and continue, which
silently retires the shape's whole enforcement property; a regression widening that path would have
built green. It now **refuses the build** unless the row carries a written `valueUngraded` carve-out
naming what grades the value instead — the same bargain `darkReason` strikes for a chunk export the
corpus cannot observe, and for the same reason: the corpus is exactly what cannot see a constant it
never renders. `compaction-prompt`, the only declarator row today, is on the literal path and
verifies 5,810 characters every build.

### The signature learned to CHOOSE, not just to verify

A `coLiteral` scopes to a chunk, so it cannot separate two nodes inside one — and the graph has such
pairs for reasons that are not drift. `kye`'s only literal is `decideLocation:"pre-ask"`, which its
own 11.6 KB neighbour `von` also stamps; the compaction wrapper `nie` shares a byte-identical
five-line preamble with `hRt`. The structural signature already knew how to tell same-shaped nodes
apart; it only ever got to verify after selection.

Two properties keep that from weakening the uniqueness doctrine. A row must declare `siblings: n` to
enter the path at all, so an anchor that quietly stops being unique at a bump still fails loudly
rather than being auto-selected — and the count is itself verified, in both directions. And a
signature matching two candidates is a **tie, which throws**: picking the first would be exactly the
coin flip the rule exists to forbid. `kye` and `von` tie on `params` and `ancestry`, so the signature
gained `declarator` — the index in the declaration list, recorded only by a row that needs it.
Unrecorded is not a claim and is not compared, so no existing row carries a position it never
verified.

### The symbol map: the engine ships a partial name table for itself

The W5–W7 scout found 387 chunks re-exporting engine symbols under source-level names.
`research/tools/symbol-map.ts` harvests both ESM spellings, follows barrel chains to the chunk that
DECLARES each binding, and keeps only aliases that are not themselves minified: **831 names for the
engine chunk** against the scout's independently measured 832, and 6,745 over 621 chunks. Committed
keyed to `ENGINE_VERSION`, `--check`ed in the gate's build-free determinism block, and queryable
(`--chunk`, `--find`) — targets are now looked up rather than hunted by literal. It is also a §5
staleness signal nothing else has: a semantic name that appears, vanishes or moves to another binding
is upstream telling us a subsystem moved with every export inventory, anchor and footprint hash
byte-identical.

### The closure-walk bound: measured, and deliberately not raised

W2 left this as a debt: the WebFetch usage-notes helper crosses the 20-declaration bound and falls
back to whole-chunk hashes. Measured, the premise was wrong in a useful way.

At the committed bound the walk was not abandoning on width — it hit an import of `fs`. A **bare
specifier is a boundary, not a hole**: the graph's own edges are all paths, so a bare one is
something the bundle did not contain and there is nothing on the bundle side to hash either way.
Degrading the whole row for one was worse than useless, staling the row on unrelated edits while
still covering nothing extra. The import site is now recorded as a leaf and the walk continues; a
specifier that IS a graph path and still does not resolve remains a genuine hole and still abandons.

The leaf's NOTE distinguishes two cases the first version conflated (C5x fix). A Node builtin is
pinned by the runtime (§3.5), so "no bundle bump can change it" is exact. A bare non-builtin — `ws`
is the only one the pinned bundle has — is pinned by nothing this repo measures and resolves nowhere
on the headless path, so its leaf records it as external-unresolvable and makes the weaker claim.
Neither changes the walk. On the pinned graph no enumerated closure reaches a bare import today (the
one capture that would, WebFetch's usage notes, degrades on width first), so the note is visible in
`build/footprints.json` and in the mechanism fixtures rather than in `ledger.json`.

With that fixed: at depth 40 and 500 declarations the closure **still** does not terminate — 500+
declarations across 17 chunks and 272 KB. The helper genuinely reaches a subsystem, so no reachable
bound enumerates it. **Decision: bound unchanged, fallback kept, reasoning recorded in
`footprint.ts`.** The alternative of cutting the walk at env-backed memos is rejected on the record:
an owned capture is one the module reimplemented, so everything it called is part of what was
replaced, and stopping at an env reader would narrow the contract in the direction §5 exists to
prevent.

### The instrumenter learned four constructs, and still refuses five forms

`strangle/branches.ts` could only refuse a switch, a loop, a try/catch or an optional chain — which
meant a later wave owning a body with any of them could not be attested at all. Each is now recorded
in the way that construct admits: switch clauses and `for..of`/`for..in` bodies by an inserted mark
(one arm each), `while`/`do`/`for` by their condition (exact — its false arm IS the zero-iteration
case), and try/catch as one site with two arms. Iteration COUNT is deliberately not attested: a loop
that ran seven times instead of six is not a branch.

Five forms stay refused, each because recording it would misreport: a switch with no `default` (the
no-match path is an arm of no clause), `for(;;)`, a braceless `for..of`, a try block that can
`return` (the end-of-try marker would be skipped on a non-throwing path, under-reporting it), an
optional chain over an optional chain (when the inner link short-circuits the outer never evaluates,
so a recorder there reports an arm that did not run — the false-green direction), and an optional
CALL (wrapping the callee would change `this`, a behaviour change in the code being measured).

### Three W2-review findings, fixed rather than logged

- **The attestation's refusals now have the controls the README claimed.** The rules move to
  `strangle/adjudicate.ts`, pure, and `strangle/attest.test.ts` puts each in front of the fixture
  that violates it: both stale directions, an unadjudicated branch, an empty inventory — and a fresh
  attestation that passes, because a checker that fails everything proves as little as one that fails
  nothing.
- **`auditTopLevel` stopped accepting effectful variable initializers.** Rule 2 refused "side
  effects" by STATEMENT KIND, and `var x = effectfulCall()` is a `VariableStatement`. The audit now
  walks each initializer; what bounded the hole before was the accident that the one owned chunk has
  no such declarator.
- **Rule 5's prose says what rule 5 does.** For a constant whose value is its only identity
  (`var ti="Glob"`), the NAME derivation is anchored on the value, so an upstream change throws in
  the derivation before the comparison is reached; the comparison catches the owned side. Both loud,
  not the same direction — and the contrast with the new declarator shape, where the comparison IS
  what fires, is now written down.

### Ledger

Three rows move to `spliced`, each recording exactly what was taken and what stays with its wave:
`subsystem/hook-dispatch` (C8 — the PostToolUse dispatcher; the other seven and the 23 KB executor
remain W5's), `subsystem/permissions` (C9 — the deny-stamping link; the 11.6 KB decision body stays a
port), `subsystem/compaction` (C7 — the summarization prompt outright; the wrappers, boundary
emitters and trigger policy remain W4's). **Eight spliced rows, thirty-nine unowned.**

The rows units 1–3 first landed carried materialized-basis spans copied straight out of
`build/footprints.json`; the ledger's basis is upstream, which is the one every machine shares, so
they were rebased and `ledger/backfill-captures.ts --check` now passes on them.

### The gate found a control that had stopped being one

The first full run after the three splices landed failed on exactly one phase, and not on a splice:
`ledger/check.test.ts`'s "stale without an adjudication note is rejected" mutated
`subsystem/compaction` to `stale` and expected the missing-note rule to fire — but C5x had given that
row a real note, so the mutation became legal and the control accepted it. It had been green for the
wrong reason ever since a row moved underneath it. This is the third time the ledger phase has caught
its own controls rather than a bad ledger, which is what a controls suite looks like when it is
working.

### Gate

```
=== strangler gate ===
  PASS  env schema + credential matrix
  PASS  canonicalization scrubs
  PASS  state surface catches what it claims
  PASS  gate-defaults fixture matches the pin
  PASS  symbol map matches the pin
  PASS  closure-ledger checker fixtures (X2)
  PASS  closure ledger is green (X2)
  PASS  splice mechanism
  PASS  branch instrumenter
  PASS  attestation adjudicator
  PASS  owned-implementation contracts
  PASS  description parity vs the pinned bundle
  PASS  derivation perturbation
  PASS  liveness write-tool-result
  PASS  liveness edit-tool-result
  PASS  liveness read-tool-result
  PASS  liveness bash-tool-result
  PASS  liveness grep-tool-result
  PASS  liveness glob-result
  PASS  liveness task-create-result
  PASS  liveness task-get-result
  PASS  liveness task-list-result
  PASS  liveness task-update-result
  PASS  liveness read-description
  PASS  liveness grep-description
  PASS  liveness webfetch-description
  PASS  liveness env-block
  PASS  liveness text-delta
  PASS  liveness session-materialize
  PASS  liveness post-tool-hooks
  PASS  liveness permission-decision
  PASS  liveness compaction-prompt
  PASS  liveness glob-description export globToolName
  PASS  liveness glob-description export replToolName (dark, adjudicated)
  PASS  liveness glob-description export globDescription
  PASS  coverage attestation
  PASS  equivalence (faithful)
  PASS  credential leak (end-to-end, X6)
  PASS  runtime pin is the bytes (§3.5)

GATE PASS — every splice is live AND the faithful build is equivalent
```

**Thirty-nine phases**, up from thirty-three: the symbol-map fixture, the branch-instrumenter
controls, the attestation-adjudicator controls, and three new liveness rows. Corpus **25/25**, full
acceptance **5/5**, **22** liveness phases, coverage attestation 14/20 executed with 6 adjudicated.

### What the new splices do NOT claim

None of the three modules is branch-attested. Attestation requires an oracle for every excluded
branch — for W2 that is `description-parity.test.ts`, which evaluates the pinned upstream function
over the full branch cross-product — and building one for the hook dispatcher or the permission link
is the owning wave's design work, not a mechanism round's. Recorded here so the absence is an
adjudication rather than an oversight: **C8, C9 and C7 inherit the attestation obligation for the
modules C5x spliced.**

## W3 — the prompt-assembly pipeline, and the corpus that never rendered it (2026-09-01)

The wave's headline finding is not a splice. `src/harness.ts:baseOptions()` sets `settingSources: []`
and passes no `systemPrompt`, so all 25 recordings emitted the SAME two-block `system` array — the
billing header and `"You are a Claude agent, built on Anthropic's Claude Agent SDK."` The engine's
real prompt assembly was **dark on the whole corpus**, and a wave that owned it against that corpus
would have shipped a green gate meaning almost nothing: solo sabotage would still redden, while the
branches actually reimplemented went unexecuted.

So C6's coverage decision was to **record the preset rather than reviewed-exclude it**, and the wave
opens with four new scenarios (`w3/scenarios.ts`).

### Recording the preset sprang two determinism traps that reasoning did not

Both were fixed at the source rather than scrubbed at the differ, and both are the kind of thing only
a live take shows you.

**The preset's prompt ends with a `gitStatus:` section** carrying the working tree's branch, git
user, porcelain status and the subjects and SHAs of the five most recent commits. The sandbox lives
inside this repository, so the first take embedded the campaign's own commit log in the system
prompt — a cassette that misses on the next commit, and under §3.4's fatal-fallback rule that is a
red gate rather than a stale recording. The scenarios now seed the sandbox with **their own git
repository**: an empty commit with pinned author, message and both dates hashes to the same SHA on
every run (verified: two seeds, identical `.git` trees, and neither `git status` nor `git log`
mutates one afterwards). The section is byte-stable, so it is graded rather than discarded — which is
what gives the context tail its coverage.

**`settingSources: ["project"]` walks the working directory's ANCESTORS** for `CLAUDE.md` and
`.claude/CLAUDE.md`, up to and including the home directory. It does not stop at a git root — the
seeded sandbox repository did not bound it. The probe recording loaded four memory files, one of them
the operator's private `~/.claude/CLAUDE.md`, and the harness's cassette leak check refused the take.
The memory scenario now runs in a working directory outside both the repository and the home tree, so
the only `CLAUDE.md` discoverable is the one it wrote.

### Four scenarios, each buying a named branch

| scenario | what it renders that nothing else does |
|---|---|
| `sysprompt-preset` | the preset's full section list — 3 system blocks, 27.9 KB, and the context tail's `gitStatus:` paragraph |
| `sysprompt-append` | `append:` flips the identity line to the append-aware sentence (94 chars, in no other recording) |
| `sysprompt-boundary` | a custom `string[]` prompt carrying the SDK's exported `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`; grades the sentinel's REMOVAL, and is the corpus's only recording of the path where a custom prompt replaces the preset |
| `claude-md-memory` | a project `CLAUDE.md` in the context block — the only two-entry context, so the only place the entry JOIN is observable |

Corpus **25 → 29**.

### Six splices, and two the scout had written off

The pipeline, in the order a request goes through it:

| module | upstream | what it decides |
|---|---|---|
| `identity-prompt` | `r6` | which of three sentences the prompt opens with |
| `context-prompt-lines` | `NAt` | the ambient context appended as `key: value` lines |
| `system-prompt-blocks` | `tOe` | the partition into billing / identity / outcomes / static / dynamic, and each block's cache scope |
| `system-prompt-wire` | `U8n` | those blocks as the API's `system` array, with `cache_control` |
| `context-reminder` | `HAt` | the same context as the first user message — this is CLAUDE.md injection |
| `subagent-prompt` | `zH` | a dispatched agent's whole system prompt |

The scout filed `U8n`, `r6` and `NAt` as **anchorless**, and W3 was to re-assess them under C5x's
sibling selection. Sibling selection turned out not to be the answer; **reading the doctrine more
precisely was**. The rule anchors have to satisfy is being free of MINIFIED IDENTIFIERS — the thing
that churns per bump — not being prose:

- `U8n` → `cacheScope,ttl:`, two property names and punctuation, one occurrence graph-wide;
- `r6` → `?.isNonInteractive`, one occurrence in the engine chunk, scoped by a `coLiteral` (the
  append-aware identity sentence, declared immediately above it and read by nothing else);
- `NAt` → `].filter(Boolean)}`, the manifest's weakest anchor and pure punctuation, takeable because
  it is unique inside the chunk its `coLiteral` scopes it to.

**The sibling mechanism would NOT have taken `U8n`, and the reason is worth recording.** Its other
untainted candidate, `skipGlobalCacheForSystemPrompt`, occurs four times in one chunk — but two of
those four are inside `U8n`'s own body, and `selectExcision` counts matching CANDIDATES rather than
distinct SPANS, so a same-node duplicate reads as a tie and throws. The anchor above makes the
question moot for this row; a later wave that meets the same shape should expect it.

`xMt` stays unspliced, as the scout said: it calls the partition to hash the result for telemetry, so
its sabotage would be green — the W0a `interrupt` precedent.

### Four primitives on one splice, and a Set that needed a new assertion

`system-prompt-blocks` carries the highest micro-differential yield in the manifest: four of its six
captures are `primitive` — the boundary marker, the billing-header prefix, the three identity
sentences, and the 907-character reporting-outcomes section — so every delegation compares four
prompt constants against the graph. That is the only cheap thing in the whole mechanism that can see
a **reworded** prompt constant, which moves no anchor, no target hash and no capture hash.

The identity trio arrives as a frozen `Set`, and `Object.is` cannot see inside one: a blanket
equality assertion over a Set is vacuous in both directions (two different Sets are never equal, the
same Set always is). `shared/assert.js` gained `assertGraphMembers`, which compares the members in
declaration order. The three sentences live in `shared/identity-prompts.js` because two owned modules
need them — the selector PRODUCES one and the partition RECOGNISES it.

### The static-prompt gate is pinned false, and that is measured

`Kde()` is two feature gates and a provider test. Under §3.3's pinned gate state it is FALSE, which
makes two of the partition's three paths — the tool-based-cache path and the whole boundary/global-
scope path — unreachable for the corpus by construction.

That is not an inference from reading the gate. The section builder emits the boundary marker only
when the same gate is true, and `sysprompt-preset` renders the preset's entire section list with **no
marker in the request**. One recording settles it.

The consequence is the campaign's largest single adjudication so far: 38 of 88 branch outcomes are
reviewed exclusions. Which is why the wave's other deliverable is an oracle.

### The oracle: `strangle/prompt-parity.test.ts`

W2's pattern, pointed at prompt assembly. It extracts the six upstream bodies from the pinned bundle,
evaluates them with stubbed ports, and requires identity with the owned module over the full
cross-product — **178 comparisons**, including the TELEMETRY EVENTS, because two of the partition's
three paths differ only in which event they emit. Nothing in it hand-writes an expectation, so
nothing in it can encode a transcription error.

Verified non-vacuous by mutation: giving the boundary path's identity block the wrong cache scope, and
the Vertex arm the wrong sentence, each turns it red.

Every one of the 38 exclusions names it as what grades that branch, and the exclusions fall into four
families rather than 38 separate stories — paths behind the static-prompt gate, block kinds the
assembler never produces, the wire's caller-fixed arguments, and seam-fixed session facts.

### One exclusion was bought back rather than written

`partition@1:T` — the arm that drops the boundary sentinel — would have been the 39th exclusion. It
is executed instead, because `sysprompt-boundary` passes the marker through a custom prompt. **The
marker is the one input to this whole subsystem a caller fully controls**, so it was the one dark
branch a scenario could reach without moving the environment the corpus is graded under. That is the
W2 `search-tools-lean` judgement applied again: when a scenario can turn an adjudication into
coverage for one recording, record it.

### Two attestation gaps, one level below the ones already closed

- **A module with no branches was attested by omission.** `branchSites` legitimately returns nothing
  for a body that is a map, a join and a filter — so the module contributed zero rows and the report
  listed it as attested. That is the vacuity failure one level below the empty-inventory check.
  `AttestedModule` now requires a written `noBranchesReason` for an empty inventory, refuses one that
  has stopped being true, and prints it in the report. Two modules carry it: `context-prompt-lines`
  and `compaction-prompt`.
- **Contract X7 had no gate phase.** C5x shipped three modules and registered none of them in the
  skeleton; `skeleton.test.ts` asserts one registration per manifest row and would have caught it
  immediately, but it was not a gate phase, so a green gate carried the omission until this wave's
  rows shifted the count. Both `skeleton.test.ts` and `check-reachability.ts` are gate phases now, and
  the three modules are registered.

### C5x's deferred attestation, one third closed

C5x deliberately did not attest its three modules, on the reasoning that an exclusion needs an oracle
and building one belongs to the owning wave. W3's oracle reaches one of the three: the summarization
prompt is a constant, so `prompt-parity.test.ts` grades it in the same run. Its adjudication is
recorded rather than assumed — a constant's parity IS the build-time comparison of its initializer
against the pinned chunk's bytes, which runs on every build and is strictly stronger than a
differential red. **The hook dispatcher and the permission link remain C8's and C9's.**

### Ledger

`subsystem/environment-and-system-prompt` carries seven upstream footprints now (W0a's env block plus
this wave's six) with 25 rebased captures. It stays **`spliced`**, not standalone-complete, and the
note says why: the SECTION BUILDERS behind the preset's 27 KB block (upstream `OS()` and its ~45 free
variables) are still upstream's, and so is the per-tool serializer the scout referred to the
tool-runtime wave.

Two typed-port edges leave the row — the message constructor (session/transcript) and the
cache-control builder plus token attachment (query loop) — and one edge is new in kind:
`subagent-prompt` reaches the env block through a port whose far side **this same row already owns**,
the campaign's first intra-row edge.

### Gate

**Forty-eight phases**, up from thirty-nine: X7 registration, engine-ts reachability, the
prompt-assembly parity oracle, and six new liveness rows. Corpus **29/29**, full acceptance **5/5**,
**29** liveness phases, coverage attestation **50/88 executed with 38 adjudicated and zero
un-adjudicated**.

```
  PASS  engine-ts skeleton + X7 registration
  PASS  engine-ts reaches no extracted artifact
  PASS  prompt-assembly parity vs the pinned bundle
  PASS  liveness system-prompt-blocks      (29 scenarios, all RED under solo sabotage)
  PASS  liveness system-prompt-wire
  PASS  liveness identity-prompt
  PASS  liveness context-reminder
  PASS  liveness context-prompt-lines
  PASS  liveness subagent-prompt
  PASS  coverage attestation
  PASS  equivalence (faithful)

GATE PASS — every splice is live AND the faithful build is equivalent
```

### What W3 does NOT claim

The subsystem is not owned. What is owned is the ASSEMBLY — how blocks are chosen, ordered, scoped and
shaped. What the sections SAY is still upstream's: `OS()` builds ~20 prose sections from gate reads
and session state, and every one of them is a candidate for its own decomposition. The scout
recommended deferring that inventory until the preset had a scenario; it does now, so the follow-on
cut is unblocked and no longer speculative.

## W4 — compaction: everything except the drivers (2026-09-01)

`slash-compact` had driven `/compact` to a `compact_boundary` since the corpus began, and stopped
there. Two whole units of the subsystem live on the far side of that stopping point — the message a
compacted session wakes up with, and the predicate that decides a compaction is needed at all — so
W4 opens the same way W3 did, with scenarios rather than splices.

### Two scenarios, and what each one buys

| scenario | what it renders that nothing else does |
|---|---|
| `compact-continue` | one more exchange AFTER `/compact`, which is what puts the stripped-and-wrapped summary into a REQUEST BODY rather than only into the transcript |
| `auto-compact-threshold` | the engine deciding to compact BY ITSELF — two boundaries with `trigger:"auto"` where every other recording says `"manual"`, reached through the trigger predicate |

Corpus **29 → 31**. Both replay offline with zero positional fallbacks and all four surfaces
identical.

### The auto-compaction scenario needed one environment variable, and it is the approved one

The natural reactive trigger is `effectiveWindow − 13,000` tokens. That is not an estimate any more:
the engine's own debug line reports `effectiveWindow=180000`, so the threshold is **167,000 prompt
tokens** — on the order of a hundred exchanges of deliberately enormous payloads and a
multi-megabyte cassette, for one predicate. The campaign spec's C6–C10 bloc records C3's sign-off for
exactly one allowlist addition, `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`, which upstream itself reads as
`testPctOverride`; it arrives as an X6 knob (`autoCompactPct`), declared by the one scenario that
wants it, absent for every scenario that does not, and still dropped when an operator exports it.

**A cleaner-looking lever was tried and disproved.** The predicate also requires the window's SOURCE
to be something other than `auto`, and the settings key `autoCompactWindow` would set that without
touching the environment — but `managedSettings: { autoCompactWindow: … }` does not reach
`options.autoCompactWindow` on the headless seam (with it set, the engine still reported
`thresholdSource=model-default`). It is not needed either: the source is ALREADY non-`auto` for the
corpus's model, so the threshold VALUE was the only thing that ever had to move.

### The first attempt failed for a reason worth keeping

`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=1` looked safest — the lowest possible threshold, reachable
whatever the window turned out to be. It is the wrong choice, and the engine said so:

```
autocompact: tokens=… level=compact effectiveWindow=180000
autocompact: routing through reactive (thresholdSource=model-default)
Reactive compact: no assistant messages in summarize set, bailing
```

The predicate fired on the SECOND exchange and upstream refused to compact a conversation that
short. **A predicate's coverage needs the conversation the predicate's consumer requires, not just
the condition the predicate tests.** The scenario now plateaus at ≈27,800 tokens across three small
exchanges, jumps by one ≈40,000-token payload, and crosses a 30% threshold with ≈26,000 tokens of
margin below it and ≈14,000 above — margins chosen so the recording is reproducible rather than
tuned to one take.

### Two harness gaps the scenarios exposed, both fixed at the source

**The sixth run-scoped id shape, exactly where the canonicalization comment predicted one.** The
continuation message names the session's own transcript file, and that message is the first user
block of EVERY request after a boundary. Unscrubbed, no post-compaction request can hash-match its
recording — all three fell back positionally, which §3.4 makes fatal for a strangled engine. Scrubbed
narrowly: the directory still discriminates, only the session uuid in the file name is replaced.

**A `compact_boundary` names messages the SDK never emits.** It reports preserved messages by uuid,
and some of those frames are engine-internal — their ids appear under no other key, so the differ's
run-id map had no entry to make and two runs of the SAME engine disagreed on
`preserved_messages.uuids[1]`. The map now covers the boundary's own uuid fields, which keeps the
consistency check rather than blanking the field: the map is built over the whole transcript in
traversal order, so an engine that preserved a DIFFERENT message names a uuid already bound to
another placeholder and the diff still fires. `src/differ.test.ts` is new and is a gate phase — the
map had no regression test at all, and every mapped key is now paired with the reimplementation
defect that must still diff.

### Four splices, and a fifth row that was measurably dead

| splice | upstream | what it owns |
|---|---|---|
| `compact-boundary` | `H1` | the one constructor every compaction ends at; both triggers now rendered |
| `compact-boundary-wire` | `rSe` | camelCase metadata → the SDK's `compact_metadata`; zero captures |
| `compact-continuation` | `Cq` + `d1n` | the message a compacted session wakes up with, and the rewriter that strips `<analysis>` and promotes `<summary>` |
| `auto-compact-trigger` | `nKn` | the predicate: four refusals, a measurement, a decision |

**`d1n` was first given its own row, and its solo sabotage came back GREEN on both covering
scenarios.** That is not a coverage problem, it is the taxonomy showing its consequences: `d1n` is a
pure helper with exactly ONE caller, and §2.4 makes a pure helper *owned* rather than called — so the
moment `Cq` is spliced, upstream's `d1n` is unreachable and a separate row is a dead splice whose
twin can never redden anything. It now lives inside `compact-continuation/reference.js`, in the same
file so its two arms are in that module's branch inventory, with the build footprinting its upstream
declaration through the pure-helper closure. **Generalizing: a pure helper reachable only through a
function this wave owns belongs INSIDE that owned module. Splicing it separately buys a row and
loses a liveness proof.**

### Anchors: one scout proposal replaced, on the doctrine's own terms

The scout proposed `pre_tokens:e.preTokens` for the wire mapper, which carries `e` — a minified
parameter name, i.e. exactly what the anchor doctrine excludes. The nested wire keys
`{preserved_segment:{head_uuid:` are unique graph-wide, carry no identifier, and are a public wire
contract rather than minifier output. The other three anchor on prose the target itself emits: the
boundary's `content:"Conversation compacted",isMeta` frame (the bare sentence occurs five times
graph-wide; the property frame makes it the constructor's occurrence), the continuation's preamble
sentence, and the trigger's own log line.

### The trigger predicate is ten captures, and the split is the wave's boundary

Two are owned pure helpers — the recursion guard and the frozen set of non-conversational query
sources. The other eight stay ports, and each is a ledger edge: the settings-and-kill-switch read,
the remote-surface circuit and the window resolver read configuration; the token estimator, its
per-model divisor, the threshold classifier and the effective-window computation are the query
loop's context accounting; the last is the debug log. Owning their arithmetic would mean owning the
model registry and the token estimator, which is C16's subsystem. **What this wave owns is the
DECISION** — which refusals, in which order, and which levels mean act (`compact` *and* `blocked`:
past the blocking limit compaction is the only way forward, and an implementation that treated
`blocked` as "too late" would deadlock the session).

### The oracle: `strangle/compaction-parity.test.ts`

The third instance of the shape W2 established — extract the upstream bodies from the pinned bundle,
stub the ports, compare the cross-product — and the corpus/domain gap here has a different shape from
W3's. A recording can only ever show the ONE path that ended in the decision it recorded, so every
refusal in the predicate and every absence arm in the wire mapper is graded here and nowhere else.
119 comparisons, 37 mutation controls.

It compares the predicate's **port trace** as well as its answer, over **all eight ports**. The two
refusals below the source guards — auto-compaction switched off, and the surface open with an
unconfigured window — return the same `false` and differ from each other in nothing but which ports
ran before they refused, so an output-only comparison would call a predicate that measured the
context before refusing equivalent to one that refused first.

The two **source** refusals call no port at all, so the trace cannot separate them; they are graded
instead by extracting upstream's own `AZt`/`FD`/`tC` bytes and comparing those against the owned
constant and helpers directly. That extraction is the C7 boundary review's fix, and it is load-bearing
rather than belt-and-braces: the block previously bound upstream's body to the OWNED helpers, so a
shared defect flowed through both sides and compared equal — a perturbed entry in the owned source
list left all 94 comparisons green. It now fails four of them. The same file re-extracts C5x's
summarization prompt and compares it, so that claim is checked by something other than the build that
makes it.

### 25 branch outcomes adjudicated, in three families

**Fields the drivers always fill.** The boundary's metadata is written by the compaction drivers
before the SDK maps it, so `post_tokens`, `duration_ms`, the dropped-token count and both preserved
objects have no absence arm on any recording.

**The segment-compaction path — a deferral, measured at the call sites.** Three arms (`user_context`,
`messages_summarized`, and follow-up questions NOT suppressed) are reachable only through upstream's
from/up_to variant, which calls the boundary constructor with FIVE arguments where the two paths the
corpus drives pass three. `/compact <instructions>` does NOT reach it, so no cheap scenario buys
them; whichever wave takes the segment variant inherits the debt.

**Seam-fixed facts.** The headless query source is always `"sdk"`, auto-compaction is on, the surface
is open and the window is model-default, so every refusal in the trigger is unreachable by
construction of the seam being graded.

Two of the exclusions are findings in their own right: **`recentMessagesPreserved` is upstream's own
dead option** — no call site in the pinned bundle passes it — and **`pre_compact_discovered_tools`
needs server-side dynamic tool loading**, not ordinary tool use, so no headless scenario can fill it.

### Microcompaction: a reviewed exclusion, with evidence

`createContextHintController` returns `null` unless `querySource` starts with `repl_main_thread`, and
the headless driver sends `"sdk"` at four call sites. With the controller null the request-error hook
short-circuits and the keep-recent microcompactor can never run. Grading it would need the synthetic
response corpus (a 422/424 carrying `context_hint` edits) PLUS a patched `querySource` — an
engine-behaviour change rather than fault injection. Recorded on the ledger row, not as scenario debt.

### Ledger

`subsystem/compaction` carries five upstream footprints (C5x's summarization prompt plus this wave's
four) with 11 rebased captures, and stays **`spliced`**. The note says what is not owned and why: the
DRIVERS — upstream's `zRe`, the async generator that routes a true decision through the reactive
path, and `Tte`, the reactive driver that runs the PreCompact hooks and calls the summarizer — are
query-loop-shaped and **deferred to C16/W13** with the rest of the turn driver; the summarization
prompt's WRAPPERS (`nie`/`hRt`) share a byte-identical five-line preamble inside one chunk, which no
`coLiteral` can separate.

Two typed-port edges leave the row: session storage (the boundary's uuid is `crypto.randomUUID`
reached through identity minting) and the query loop (the trigger's context accounting, and the
drivers themselves).

### Gate

**Fifty-six phases**, up from fifty: the differ's run-id map, the compaction parity oracle, and four
new liveness rows. Corpus **31/31**, full acceptance **5/5**, **32** liveness phases, coverage
attestation **83/146 executed with 63 adjudicated and zero un-adjudicated**.

```
  PASS  differ run-id map + its negative controls
  PASS  compaction parity vs the pinned bundle
  PASS  liveness compaction-prompt
  PASS  liveness compact-boundary        (slash-compact, compact-continue, auto-compact-threshold)
  PASS  liveness compact-boundary-wire
  PASS  liveness compact-continuation
  PASS  liveness auto-compact-trigger    (auto-compact-threshold)
  PASS  coverage attestation
  PASS  equivalence (faithful)

GATE PASS — every splice is live AND the faithful build is equivalent
```

### What W4 does NOT claim

The subsystem is not owned. What is owned is every client-side DECISION and every piece of TEXT
compaction produces — when to compact, what the model is asked, what its answer becomes, what the
session wakes up with, what the boundary records. What is not owned is the machinery that runs
between those: the async generator that routes a positive decision through the reactive path, the
driver that fires the PreCompact hooks and calls the summarizer, the token estimator the predicate
measures with, and the threshold arithmetic it compares against. Those are the query loop's, and
C16/W13's.

Nor is the auto-compaction path proven at its natural threshold. The corpus reaches it at 30% of the
effective window because a scenario declares that; what runs at 167,000 tokens is the same predicate
with a different number, and the gap is named rather than rounded up.

## W5 — hook dispatch: twenty functions, twenty-one of twenty-three events (2026-09-01)

One scenario in the corpus W5 inherited registered a hook at all — `hooks`, a PreToolUse and a
PostToolUse callback around one `echo`. Two of the engine's live events were graded and the rest were
not, and each event has its **own** dispatcher building its own record. So W5 opens the way W3 and W4
did: with recordings, because almost every function it owns had no covering scenario and a splice
whose solo sabotage cannot turn anything red is dead code the gate refuses.

> **Read this section as a THREE-round wave, and read the rounds as one story about measurement.**
> It landed claiming seven functions over all eight headlessly-live events. C8's boundary review found
> eight wrong and the measurement behind it incapable of being right, re-measured twelve, and added
> four splices. C8's SECOND round found that re-measurement still choosing its own watched list by
> hand — so an event nobody thought of could not be measured as absent — derived the population from
> upstream's own dispatcher registry, and found **twenty-three**. All three rounds are recorded,
> because the mistakes are the more useful half: each round fixed the previous round's answer and left
> its METHOD intact, and the method was the defect every time.

### The live set was re-measured three times, and the population was wrong until the third

`docs/parity/coverage.md` has said "8 of 30 events fire headlessly" since 2026-06, against a
different pin. `w5/probe-hook-events.ts` re-measured it against the **pinned** engine, registering
callbacks for thirteen events and driving one batched tool turn:

| fired | did not fire |
|---|---|
| PreToolUse, PostToolUse, PostToolBatch, UserPromptSubmit, Stop, MessageDisplay | PostToolUseFailure, SessionStart, SessionEnd, Notification, PreCompact |

The old number appeared to survive contact with the new pin, and the five that did not fire became an
"evidence-backed" exclusion. **They were not evidence.** That turn never fails a tool, never compacts,
never ends a session inside the observation window and never completes an MCP elicitation — so for
four of the five, a working dispatcher would have produced exactly the same silence. A negative that
the healthy case also produces measures nothing.

The boundary round also proposed a STRUCTURAL explanation — that a dispatcher's callback hooks come
only from a session hooks registry it is handed, so `vUt`/SessionStart, `tz`/PreCompact and
`EE`/Notification are unreachable from `Options.hooks` by construction. **That explanation is wrong
and is withdrawn.** `Options.hooks` entries are not registry entries: the initialize handler tags them
`origin:"sdkHost"` and pushes them into a GLOBAL store, and `IE(event)` (chunk-fy12d89p offset 538966)
returns that store's entry unconditionally, merged with the settings layers. SessionStart's callback
silence is **registration timing** — its dispatch precedes host-hook registration. The byte fact
underneath survives and is why the owned modules forward no registry; the inference drawn from it did
not.

The probe then ran a PHASE per firing condition and registered BOTH a callback and a settings command
hook for every watched event, reading the command side back off marker files after the iterator ends
so a teardown dispatcher's evidence survives. Four of the five negatives were wrong:

| event | verdict | condition created |
|---|---|---|
| PostToolUseFailure | **FIRED** (callback + command) | a Bash call that exits non-zero |
| PreCompact | **FIRED** (callback + command) | `/compact` |
| SessionStart | **FIRED** (command only) | every run — no callback sees it, for the reason the round below gets wrong and the next one corrects |
| SessionEnd | **FIRED** (command in every phase; callback on `/clear`) | ordinary teardown, and `/clear` |
| Notification | not fired in any phase | — |

That took the count to twelve. **It was still wrong, and for a reason no amount of care inside the
probe could have fixed: the WATCHED LIST was written by hand.** Thirteen events, chosen as "every
event with a dispatcher a single tool-using turn could plausibly reach". Notification's real firing
condition was mis-stated (one MCP call site, when `EE` has eleven across five chunks, one of them a
permission-notify timer); PostCompact and TaskCreated were not in the list at all. An event nobody
thinks to watch cannot be measured as absent, and a list the tester writes can only ever confirm the
tester.

### The enumeration comes from the artifact now

Upstream keeps the enumeration of record: one object literal mapping every hook event to the function
that dispatches it (`zCr`, chunk-fy12d89p offset 3010534). `research/tools/extract-hook-registry.ts`
snapshots it into `research/fixtures/hook-registry-2.1.251.json` — found by SHAPE (a top-level
identifier map of ≥20 entries) and CONFIRMED against a second, independent signal in the same bundle
(the `hook_event_name:"…"` literals the dispatchers stamp; the candidate covers 100% of them). Then
each dispatcher is resolved through the ESM graph to its defining chunk and its call sites are
counted, which is what turns "this event exists" into "and here is where it could fire". A gate phase
re-derives the fixture every run, so a pin that adds, drops or re-points an event reddens rather than
silently narrowing what gets measured. **Same move as C3's bundle-generated override inventory: derive
the enumeration from the artifact, not from judgment.**

The static import graph alone was not enough, and the gap it left is instructive: **SessionEnd's third
caller is the app's own `shutdown()`, reached by DYNAMIC import** through the barrel chunk. The
static sweep saw two callers, which is what the wave had written down — and that miss is also why the
ordinary-teardown fire the probe observed on every phase had no explanation. The extractor resolves
dynamic-import sites too, scoped to the enclosing function.

**33 events. 23 fire. 0 dead. 10 open.**

| verdict | count | what it means |
|---|---|---|
| **FIRED** | 23 | observed, in a phase that created its condition |
| **DEAD** | 0 | a condition was created here and the dispatcher did not run |
| **OPEN** | 10 | the condition is NAMED but not created — no claim either way |

The nine that were new to the measurement: **PostCompact** (the same `/compact` that fires PreCompact,
after the summary exists), **Notification** (a permission consult answered past the 6000 ms notify
timer), **PermissionRequest** (any tool call the permission system evaluates), **TaskCreated** and
**TaskCompleted** (a TaskCreate/TaskUpdate pair), **StopFailure** (a turn ending in an api-error),
**InstructionsLoaded** (a project CLAUDE.md loading), **UserPromptExpansion** (a project slash command
expanding), **FileChanged** (a watcher event under a registered matcher), plus **PreModelSwitch** and
**PostModelSwitch** on a `/model` turn.

The ten OPEN rows each name what would create them — an eliciting MCP server, a teammate session, a
`--worktree` launch, the auto-mode permission classifier, a setup trigger, an interactive config
change, a cwd move, `/add-dir` (measured: it refuses headlessly). **OPEN is not a negative**, and the
probe's table refuses to let it be counted as one.

**Three gotchas cost real measurements**, all silent, all worth carrying forward:

- `bypassPermissions` skips the permission system outright, so nothing permission-scoped can fire
  under it — and every phase of the first two rounds ran under it.
- a bare `allowedTools: ["Bash"]` **shadows** `canUseTool` (the SDK warns); the callback is never
  consulted and no notify timer is armed.
- default mode auto-approves read-only shell commands **without consulting `canUseTool` at all**, so a
  phase built on `echo` measures nothing. `mkdir` is the cheapest command that is not read-only.
- the file watcher is armed from a FileChanged hook's **matcher**, not from anything the hook prints.

### Fourteen recordings

| scenario | what it renders that nothing else does |
|---|---|
| `hooks-prompt-submit` | UserPromptSubmit, MessageDisplay and Stop on one no-tool turn — and the hook's `additionalContext` has to reach the model, so the dispatcher is graded on the REQUEST surface too |
| `hooks-batch` | PostToolBatch, which needs a turn SHAPE (two tool_use blocks in one assistant message), not a matcher |
| `hooks-subagent` | SubagentStart, SubagentStop and the parent Stop — both arms of the one dispatcher that serves two events, plus the agent-id CORRELATION between the two arms |
| `hooks-command` | a COMMAND hook: the record read as the byte stream it is serialised into |
| `hooks-tool-failure` | the OTHER arm of a tool call — a command that does not exist, so the failure dispatcher runs and its sibling does not |
| `hooks-precompact` | a real compaction, with three command hooks producing three different RESULT shapes, because PreCompact's verdict is a reduction over them |
| `hooks-session-start` | the one live event no callback observes (its dispatch precedes host-hook registration) — graded on the sandbox, with the callback's silence asserted beside it |
| `hooks-session-end` | `/clear`, one of upstream's three SessionEnd call sites and the one inside the observation window, plus a failing hook so the drain's reporting arm renders |
| `hooks-permission` | a permission consult answered **7.5 s** later — past the 6000 ms notify timer — which fires PermissionRequest and Notification off one tool call |
| `hooks-tasks` | a TaskCreate/TaskUpdate pair: two near-twin dispatchers that differ in one string, so grading one would state the twinning as a coincidence |
| `hooks-stop-failure` | a turn that ends in an API error — the cassette is recorded healthy and then AUTHORED (see below) |
| `hooks-memory` | a project CLAUDE.md loading, in a `/tmp` working directory so `settingSources: ["project"]` finds no ancestors |
| `hooks-slash` | a project slash command being EXPANDED — the moment between the keystroke and UserPromptSubmit |
| `hooks-file-watch` | a file changing under a registered FileChanged matcher, with a real `sleep` in the turn |

Corpus **31 → 45**. One recording per turn SHAPE rather than one per event: a no-tool turn fires three
events together, one compaction fires PreCompact and then PostCompact, one slow permission consult
fires two, one task pair fires two. All fourteen replay offline with zero positional fallbacks.

**Three of the six new ones needed a shape the corpus had no way to make.**

`hooks-stop-failure`'s firing condition is a RESPONSE, and no prompt makes the real API return an
api-error on demand. `Scenario.deriveFault` is the answer: the live take is a real recording, and the
H2 fault derivation the fault suite already owns rewrites its first exchange into a 500 **before
promotion**, so the committed cassette IS the graded one and a re-record cannot quietly promote the
healthy take. Both engines then replay the same authored failure.

`hooks-permission` really does wait out its 7.5-second delay again on every replay, on both sides.
That is the point rather than the cost: the harness owns the answer timing, so the condition is
*reproduced* offline rather than remembered.

`hooks-file-watch` failed its first recording in a way worth keeping. The turn wrote the file twice
and replied immediately; the debounced watcher fired **after the query had closed**, on both replay
sides, and four requests were served positionally because the record and replay conversations had
diverged. Adding a real `sleep 3` inside the turn fixed it. The sleep is not padding — it is the part
of the firing condition the filesystem owns, and a scenario that omits it is racing the dispatch it
exists to observe.

Two older recordings were re-recorded after the boundary round's first attestation showed which arms a
callback alone could not move, and the compaction recording gained a SECOND set of command hooks in
this round for the same reason one level down — **a callback produces exactly one hook-result shape**,
and PostCompact's verdict, like PreCompact's, is a narration of result shapes. Four exclusions became
coverage. The bundle fact that makes it work: a command hook's `output` is its **stdout when it
succeeds and its stderr when it fails**, so a failing hook that printed to stdout renders as the
silent-failure arm and grades the wrong phrasing.

### The command-hook cell, and how it stopped being expensive

`Options.hooks` takes CALLBACKS, and a callback is handed a JavaScript object — so nothing in the
corpus graded the hook-input record as the **byte stream** a real hook reads on stdin, which is what
these modules' field ORDER is. Command hooks live in settings, and turning on a filesystem setting
source would drag the operator's ancestor `.claude/` directories into the recording (the trap W3
hit). The probe settled the way out: **`Options.settings` takes an inline settings object into the
flag-settings layer with `settingSources: []` still in force.** No filesystem source, nothing read
outside the sandbox, and the command ran with the engine's serialised record on stdin — whose key
order is exactly what `post-tool-hooks/reference.js` says it is.

The hook writes a normalised projection into the sandbox (the raw record carries `session_id` and
`transcript_path`, and `src/state.ts` hashes contents with no normalisation, so a raw dump would
diff on run-scoped ids and grade nothing). The projection keeps the key order verbatim, the
event-specific fields, and the TYPE of the two run-scoped ones. It is graded twice: on the state
surface, where the file's hash is compared between engines, and on the events surface, where the
scenario reads it back inside its own run.

### Nineteen splices, three shapes, one anchor family

| splice | upstream | what only it does |
|---|---|---|
| `pre-tool-hooks` | `Tye` | two execution paths — the in-process function-hook chain and the settings execution it falls back to |
| `post-tool-batch-hooks` | `Fct` | one record for a BATCH of calls; no `matchQuery`, because a batch has no single tool name |
| `user-prompt-submit-hooks` | `bSe` | its results change the CONVERSATION, and its timeout is 30 s where every sibling's is 600 s |
| `stop-hooks` | `y9` | one function, two events, two record shapes |
| `subagent-start-hooks` | `kUt` | hands the executor its session hooks and agent context directly — the agent being started has no context yet |
| `message-display-hooks` | `Zqe` | builds from a MESSAGE and synthesises its own correlation id |
| `post-tool-failure-hooks` | `zNt` | the error arm of a tool call — an error, an interrupt flag and a duration where its sibling carries a tool_response |
| `session-start-hooks` | `vUt` | two sessions in one call (the record's may be synthetic, the executor's is real), and an activity hold released in a `finally` |
| `session-end-hooks` | `ZSe` | not a generator: it AWAITS its results, reports failures to stderr, and clears the session's registry — and its timeout is 1.5 s, not 600 s |
| `pre-compact-hooks` | `tz` | not a generator, and the only dispatcher whose RESULTS the engine obeys: a reduction to custom instructions, a display message and a blocking reason |
| `post-compact-hooks` | `kPe` | PreCompact's sibling with the verdict cut down — nothing left to block, so the reduction is the display message alone, and its delegated-observation guard returns BEFORE the executor rather than after |
| `notification-hooks` | `EE` | the family's simplest: build, await, DROP the results — nothing reads them; its options bag is destructured in the PARAMETER list, so the delegation rebuilds it |
| `instructions-loaded-hooks` | `Qqe` | six event-specific fields, three of them out of an options bag a top-level project memory does not fill |
| `stop-failure-hooks` | `HPe` | the turn-end dispatcher's failure arm, and the only one that hands the executor both the session hooks registry and `getAppState` off its context |
| `task-created-hooks` | `xUt` | dispatched inside the TaskCreate tool's own `call()`, not from the query loop; no `matchQuery`, so a matcher cannot narrow by task |
| `task-completed-hooks` | `eGe` | `xUt`'s twin with one string changed — two rows, because two anchors and two footprints means an upstream edit to either fails on its own row |
| `permission-request-hooks` | `Tee` | the only tool-scoped dispatcher that forwards the REAL tool-use id, and the only record carrying `permission_suggestions`; its results are obeyed by the permission system |
| `user-prompt-expansion-hooks` | `Ldt` | the only guard that keys on the AGENT id when there is one and the session id otherwise; no timeout parameter at all |
| `file-changed-hooks` | `CUt` | neither async nor a generator, and reaches NEITHER executor — it returns the watcher-hooks helper's promise for its caller to chain |

All nineteen are `free-function` targets on `hook_event_name:"<Event>"`, the anchor family C5x's spike
proved out, and all nineteen anchors are unique bundle-wide except one.
`user-prompt-submit-hooks` is not: the literal occurs twice in ONE chunk, so a `coLiteral` cannot
scope it (it scopes to a chunk). The other carrier is `Y4e`, the REPL-side dispatcher, which has six
parameters where this one has five — so `siblings: 2` plus the verified signature selects, and an
upstream edit to either arity makes the build refuse rather than splice the wrong function.

**Three shapes, and each was found a round later than the last.** Thirteen are `async function*` and
stream their executor's results back to a caller that folds them into the conversation. Six are plain
`async function`s that await a DIFFERENT executor (`AE`, the sibling of `jy`), because a compaction, a
teardown, a notification, a memory load and a failed turn have no conversation left to stream into —
so their delegation is a plain `return`, and `executeHooksAwait` is a second unowned executor on the
ledger row. `tz` goes further: it is the one place in this subsystem where hook OUTPUT is behaviour
rather than a stream, and a callback returning `{continue:true}` can neither add instructions to the
summarisation prompt nor block the compaction. And `CUt`/FileChanged is neither — a synchronous
function that reaches no executor at all, handing the whole execution to the watcher-hooks helper it
shares with CwdChanged. That helper is a THIRD unowned execution path on the ledger row.

**Two registry events that FIRE are deliberately not spliced.** `mdt`/PreModelSwitch and
`gdt`/PostModelSwitch are the family's only stateful members: between them a plugin loader, a model
prefetch and validation preamble, a per-session decision holder that `gdt` MUTATES (`landedOn`, a
`pending` queue, an `inFlight` promise set) and a fire-and-forget promise the caller never awaits —
roughly seventeen forwarded ports each. §2.3 puts a stateful core behind a designed port rather than
transcribing it, and doubling this subsystem's capture inventory for two events is not that design.
Recorded as a ledger gap so the remainder is a decision rather than an omission.

### Six pure helpers became owned, and the call graph is why

C7's lesson — a pure helper reachable only through a function the wave owns belongs *inside* that
module — has a converse this wave used across **six distinct pure helpers, captured seven times**
(`Hb` is captured by two dispatchers; the other five once each). The hook fan-out rule (`Hb`), its
two agent-context predicates (`DR`, `ka`), the last-assistant-message pair (`Wy`, `zr`) and the
plain-object test (`He`) all have callers all over the engine, so splicing the dispatchers leaves
upstream's copies live and each stays a real `pure-helper` capture: footprinted, never forwarded,
reimplemented in `strangle/modules/shared/`. That is genuine ownership of the *rules* — which agent
ids a hook lookup runs under, which subagent kinds dispatch nothing, when a turn's last message
counts as text — rather than another port.

### The oracle: `strangle/hooks-parity.test.ts`

**686 comparisons, 107 controls.** The fourth instance of W2's shape, with two additions:

- **The bindings come from the MANIFEST.** Each dispatcher's free variables are re-derived with the
  manifest's own `derive` regexes against the extracted body, so the oracle cannot bind a port the
  splice does not forward, and the owned side is driven through the **adapters** — the same argument
  list the build's delegation synthesises, primitives and their equality assertions included.
- **The port TRACE carries the executor request.** A callback sees the hook input; it never sees the
  options the executor was asked for, and those options are most of what distinguishes one
  dispatcher from another. Comparing the trace is therefore what actually grades the record's field
  set and the request's shape.

The six distinct owned pure helpers are extracted and compared against their **own upstream bytes** before
any dispatcher is bound to them — C7's boundary-review lesson, applied where it would otherwise have
bitten: eight of the twenty bodies call at least one of them.

The second round taught the oracle two things about its own extraction. It gained a **third shape** to
reach FileChanged, which the two existing searches (`async function*` and `async function `) could not
find. And its parameter splitter became **depth-aware**: Notification destructures its options bag in
the parameter list, a naive comma split counted its three fields as three parameters, and the
three-parameter search then failed with a message about the wrong thing entirely.

The boundary round added a third thing the oracle has to do, and it is the largest surface here that no
scenario can reach at all. `tz`/PreCompact's verdict is a **reduction over hook RESULTS** — which of them
become custom instructions and how they are joined, which are narrated and in which of four phrasings,
which count as blocking, and the blocking-only verdict a delegated-observation subagent gets. A callback
that returns `{continue:true}` produces exactly one result shape, so thirteen cases and six controls here
are the only thing standing behind a reduction the compactor obeys. `ZSe`/SessionEnd's reporting policy
needed a mechanism of its own: both sides run with `process.stderr.write` swapped for a per-side
collector, so *which* failures are named and which are silent is compared rather than printed.

### It found a real defect in C5x's spiked module

Every upstream GENERATOR dispatcher ends in a **bare** `yield*`, so it discards the executor
generator's completion value and returns `undefined`. All seven owned modules wrote `return yield*`
and handed that value back. No corpus scenario can see it — nothing on the recorded paths reads a dispatcher's
return value — and the oracle failed on it in its first run. That is precisely what C5x deferred the
attestation obligation *for*: the mechanism wave shipped a module, the owning wave built the oracle,
and the oracle found the difference the corpus could not.

### Branch outcomes adjudicated, in six families

**186 of 312 executed, 126 excluded, zero un-adjudicated**, across 35 attested modules. The two large
families are the managed-hooks options bag (never supplied on the headless seam) and the PreToolUse
function-hook chain (armed only by an in-process module handler or a managed pass, neither of which
the SDK seam exposes).

One family is new to the campaign and is not "the corpus does not do that":

> **A registration guard's REFUSAL arm is unrecordable by construction.** A run with no hook
> registered for an event produces no consult, no record and no observable of any kind — so "the
> guard refused" and "the dispatcher was never called" are the *same recording*. It is also the
> common case in production. Only an upstream-differential oracle can grade it.

The others are the stop dispatcher's guard matrix (two agent kinds the headless Agent tool cannot
produce, two of three turn-end phases, four shapes of the derived `last_assistant_message`), a prompt
submitted inside a subagent context, the two SessionStart overrides no headless caller supplies, and
PreCompact's blocked/cancelled result shapes.

**The boundary round's own lesson landed here, not in the exclusions.** The first attestation of the
four new modules left 23 outcomes un-adjudicated, and the reflex was to write 23 exclusions. Eight of
them were not exclusions — they were arms a callback cannot render but a hook PROCESS can, so two
scenarios were re-recorded with command hooks instead. What is excluded now says which of two kinds it
is: genuinely unproducible on this seam, or producible by a scenario that would then be grading
something else. The blocked-hook family is the second kind and says so — a command hook exiting 2 does
block, but a blocked PreCompact cancels the compaction the scenario exists to record.

**The second round RETIRED an exclusion by accident, and the accident is the lesson.**
PostToolUseFailure's registration-guard refusal was excluded as "unrecordable by construction" — the
campaign's first entry in that family. The round's new recordings render it incidentally, because they
make tool calls without registering a PostToolUseFailure hook, and every scenario that had made tool
calls before happened to register one. So the arm looked like a property of the SEAM when it was a
property of the corpus's habits. **An exclusion is a claim about reachability, and a claim about
reachability is only as good as the population it was made over** — which is the same defect that
produced this whole round, one level down. The note stays in `strangle/attestation.ts` where the
exclusion used to be.

Demonstrated red: swapping `tool_use_id` and `duration_ms` in the PostToolUse record fails five
comparisons; and on the new modules, swapping `error` with `tool_use_id`, merging SessionStart's extra
fields before the named ones, skipping SessionEnd's registry teardown, joining PreCompact's
instructions by a newline instead of a blank line, and narrating cancelled hooks all turn the oracle
red.

### Ledger

`subsystem/hook-dispatch` carries **twenty** upstream footprints with 120 rebased captures, 22
evidence links (the probe among them) and four typed-port edges — and stays **`spliced`**. The gap now has two halves, both named in the note.

**The execution helpers**, three rather than one: the **23 KB shared executor** (upstream `Qxt`,
reached through `jy`/`Xxt`), its awaiting sibling **`AE`**, and the watcher-hooks helper **`zxt`** that
FileChanged shares with CwdChanged. Between them: hook matching, command/callback/http/mcp
invocation, timeouts, cancellation. The W5–W7 scout measured the first **S-module-shaped**, and §2.3
says a stateful core is owned behind a designed port rather than transcribed. Whichever wave takes
them inherits `getMatchingHooks`, the agent-context result filter and the headless-suppression wrapper
with them.

**The two model-switch dispatchers**, which fire and are not spliced, for the §2.3 reason given above.

The note also corrects a claim the wave made about its own chunks. `chunk-scxwkz2z` was described as a
"pure named-export barrel with zero code of its own", which is true and was read as meaning inert. It
is not: the app's `shutdown()` reaches SessionEnd **through it**, by dynamic import, and that is the
third SessionEnd caller and the source of the ordinary-teardown fire the probe sees on every phase.

### Gate

**Seventy-seven phases**, up from sixty-seven: nine new liveness rows and the hook-registry fixture
check. Corpus **45/45**, full acceptance **5/5**, **51** liveness phases, coverage attestation
**186/312 executed with 126 adjudicated and zero un-adjudicated**.

```
  PASS  hook-registry fixture matches the pin
  PASS  hook-dispatch parity vs the pinned bundle
  PASS  liveness message-display-hooks      (hooks-prompt-submit)
  PASS  liveness post-tool-batch-hooks      (hooks-batch)
  PASS  liveness subagent-start-hooks       (hooks-subagent)
  PASS  liveness user-prompt-submit-hooks   (hooks-prompt-submit)
  PASS  liveness stop-hooks                 (hooks-prompt-submit, hooks-subagent)
  PASS  liveness pre-tool-hooks             (hooks)
  PASS  liveness post-tool-hooks            (hooks, hooks-command)
  PASS  liveness post-tool-failure-hooks    (hooks-tool-failure)
  PASS  liveness session-start-hooks        (hooks-session-start)
  PASS  liveness session-end-hooks          (hooks-session-end)
  PASS  liveness pre-compact-hooks          (hooks-precompact)
  PASS  liveness post-compact-hooks         (hooks-precompact)
  PASS  liveness notification-hooks         (hooks-permission)
  PASS  liveness permission-request-hooks   (hooks-permission)
  PASS  liveness instructions-loaded-hooks  (hooks-memory)
  PASS  liveness stop-failure-hooks         (hooks-stop-failure)
  PASS  liveness task-created-hooks         (hooks-tasks)
  PASS  liveness task-completed-hooks       (hooks-tasks)
  PASS  liveness user-prompt-expansion-hooks (hooks-slash)
  PASS  liveness file-changed-hooks         (hooks-file-watch)
  PASS  coverage attestation
  PASS  equivalence (faithful)

GATE PASS — every splice is live AND the faithful build is equivalent
```

Each sabotage reddens its scenario for its OWN reason rather than by crashing the run: the four from
the boundary round (PostToolUseFailure never fires; PreCompact never fires; SessionEnd never fires on
`/clear`; the SessionStart command hook writes no record into the sandbox), and the nine here —
PostCompact stops narrating, Notification and PermissionRequest stop consulting, InstructionsLoaded
stops firing on a loaded memory, StopFailure stops firing on a failed turn, the two task dispatchers
stop firing on their own tool calls, UserPromptExpansion stops firing on an expansion, and
FileChanged never reaches the watcher helper.

**The engine-ts skeleton caught the one thing four green scenarios could not.** Its acceptance phase
requires one registered module per manifest row, and the boundary round's four splices landed without
registering — exactly the coupling that check exists to enforce, and the only failure in that round's
first full gate. It caught the second round's nine the same way, before the gate ever ran.

**The 56-vs-61 counting artifact is resolved, and it was a counting one.** C7 reported 56 phases and
its fix round measured 61 with no phases added — the fix commits touched neither `gate.ts` nor the
manifest, and recomputing the phase count from that tree gives exactly 56. The five extra come from
counting the LOG rather than the summary: the equivalence phase relays `m2/all.ts`'s five suite
verdicts in the gate's own `  PASS  <label>` format before the summary prints, so a transcript-wide
count double-counts them. Measured on the wave's run: 68 such lines in the whole log, 63 in the
summary, and the five in between are the suites (the boundary round's run: 72 and 67; this round's:
82 and 77). **The number to quote is the summary's** — it is a property of the manifest plus the fixed
blocks, not of the transcript.

### What W5 does NOT claim

The subsystem is not owned. What is owned is every per-event **record** — its field set, its order,
and the guard that decides whether to build it — the rules behind the guards, and (for PreCompact
alone) the reduction from hook results to the verdict the compactor obeys. What is not owned is what
happens between the record and the results: which hooks match it, how a command hook is spawned and
timed out, how a callback is dispatched over the control channel, how cancellation propagates. That
is the three execution helpers, and they are ports.

Nor is the hooks matrix complete in the sense of §3.2's family. **Twenty-three of the registry's
thirty-three events are measured to fire and twenty-one are graded.** The two that fire and are not
graded are the model-switch pair, deferred on §2.3 grounds and recorded in the ledger. The ten that
are not measured are **OPEN** — each with the condition that would create it written down — and OPEN
is not a synonym for dead. The wave has now been wrong twice by treating an unmeasured event as a
measured negative; it will not be a third time by treating these as one.

## W6 — permission decisions: the chain, the mode axis, and the broker's return leg (2026-09-01)

Thirteen splices plus two owned-but-unspliced functions, thirteen new recordings, and a fifth parity
oracle grading **2,508 comparisons with 49 controls**. The wave's headline is not a count, though — it
is **three corrections the campaign spec needed** and a set of measurements that changed how liveness
is proven. Three more functions were spliced and then removed: each was measured dark, and the wave
kept the finding instead of the row. (The counts include C9's boundary-fix round, recorded at the end
of this section; the wave as first landed had ten splices, eleven recordings and five removals, two of
which the fix round put back.)

### `bypassPermissions` does not short-circuit the rule engine

The campaign spec and the W5–W7 scout both record that it does, and that "22 of 24 scenarios grade
none of the chain W6 owns". Upstream's pre-check puts the bypass arm at **rung 11 of 13** — below
the tool deny rule, the input deny rule, the allow rule and its delegation, the tool's own
`checkPermissions`, the ask rule, the interaction check, the MCP ask ceiling and the safety floor.
Only the ASK is short-circuited. A deny rule still bites under bypass.

Measured twice, by different means: the pre-check sabotaged alone turns eight inherited scenarios
red, every one of them a bypass run; and the parity oracle carries "bypass short-circuits the deny
rules" as a mutant that must differ from upstream, and it does.

The claim came from reading the **Bash tool's own** mode handler (`T8e`: "Bypass mode is handled in
main permission flow") as a statement about the chain. It is a statement about that tool's
`checkPermissions`. The general form is worth keeping: *a claim read off one function's comment is a
claim about that function.*

### `auto` mode is not gate-dead, and its gate is not a feature flag

The campaign spec carried `auto` as a delegated unknown expected to be REFUSED, because the pinned
environment holds every feature gate at its compiled-in disabled default and the mode-change guard
refuses `auto` unless the auto-mode gate answers true. Both paths **accepted** it: at spawn
(`Options.permissionMode`, which never consults the guard) and over the control channel
(`setPermissionMode`, which does).

The premise was wrong about what the gate IS. Upstream's `hE()` is
`!circuitBreaker && !settingsDisabled && modelSupportsAuto` — three local conditions, none of them
something this environment turns off. **"Gated" was read as "remote flag" when the code says
"guarded by three local facts".**

This also unblocks C8's `PermissionDenied` row halfway. An ordinary broker denial was created with
both hook paths armed and `PermissionDenied` stayed silent while `PermissionRequest` fired, which
confirms C8's call-site reading with a run behind it; the remaining condition is a classifier denial,
which now needs an input rather than a gate.

The wave then read `chmod 600 /etc/hosts` under `auto` running with no broker consult as "the
classifier was not reached", and **C9's fix round refuted that** — see below. The correction is the
more useful half: *no consult* meant no `canUseTool` consult, and a classifier that runs and ALLOWS
is invisible from the host's seat.

Both corrections have the same shape as the bypass one: **a premise about the engine, inherited
through a document, that the artifact does not support.** Two out of two, in a single wave, is the
argument for §2.1's live-probe-first rule stated as a measurement.

### The axes are derived, not chosen

`research/tools/extract-permission-surface.ts` snapshots five enumerations out of the pinned bundle
into `research/fixtures/permission-surface-2.1.251.json`, each located by SHAPE and confirmed
against an independent signal collected elsewhere in the graph:

- **modes** — six, from **four independent enumerations that must agree on the set** or the
  extraction fails, with every member confirmed present in `mode`/`permissionMode` comparison
  position bundle-wide, and upstream's own one-line semantics parsed out of the schema's
  `describe()`;
- **rule behaviors** — `allow`/`deny`/`ask`, confirmed against `ruleBehavior` comparands;
- **rule destinations** — six, confirmed against `destination`/`source` comparands;
- **decisionReason kinds** — eleven RENDERED by the message builder's own switch versus ten
  CONSTRUCTED graph-wide; the asymmetry is recorded rather than smoothed (`permissionPromptTool` is
  only ever assigned as a whole object, by the broker's response mapper — which is another module in
  this same wave);
- **mode guards** — the mode-change seam's refusals, with upstream's own error text, ternary arms
  included.

`--check` re-derives on every gate run, so a pin that adds a mode or re-guards one cannot land
silently. This is C8's "derive the enumeration from the artifact" applied to a different question.

### A liveness twin has one job, and it is not plausibility

Five of this wave's sabotage twins were written as the most plausible wrong implementation, and five
were **measured inert**:

| twin | why it was invisible |
|---|---|
| allow-rule decision returns the prepared ask | differs only in a message no scenario renders |
| mode transition returns the context unchanged | skips only side effects nothing headless reads |
| setter reports success without applying | invisible until something asks the subsystem to decide again — and the honest twin that REFUSED every change turned out to be invisible too, for a different reason (see below) |
| response mapper spreads the host's answer | carries the host's `updatedInput` along with it |
| control-response envelope emptied of its payload | nothing in the corpus reads a control response |

Each twin now changes a **decision**, and the plausible-wrong-implementation mutants moved to the
oracle, where they belong. **A twin that cannot be observed proves nothing about the splice, and it
fails in the quiet direction: the gate goes green on a dead row.**

The same question has to be asked of the SCENARIO. The mode-walk originally changed mode four times
and then said READY, and all three mode-seam splices measured inert on it — a session can be told to
change mode, believe it did, apply none of the transition, and produce a byte-identical transcript,
as long as nothing afterwards asks it to decide anything. Each change is chosen for the DECISION it
flips rather than for the mode it visits.

The wave then wrote that rule down and did not grade it. Its recorded plan turn contained **no tool
call at all** — plan mode injects a reminder the model obeys against any framing — and the check
asked `usedTool` over the whole transcript, which the *dontAsk* turn's Write satisfied. C9's fix
round found it. **A per-turn design rule graded by a whole-transcript assertion is not graded**, and
the check is segmented by `result` frame now.

### The GATE had the same defect the sweep did, and it was hiding a dead row

The sweep's vacuous positive (below) had a twin one level up. The gate's liveness block read
**any non-zero exit as RED**, so a runner that crashed — or one an operator killed — counted as proof
that a splice is live. Nothing bounded the replay either, so a twin that breaks a control-channel
response left the gate waiting on a promise that never settles: the mode-transition phase sat there
for twenty-five minutes before anyone noticed.

A RED now needs **positive evidence** — the runner's own verdict line for the tag, or a timeout,
which is itself a divergence because the faithful build replays the same cassette in seconds and the
corpus phase establishes that on every run. Anything else is INCONCLUSIVE and **fails** the phase,
because "we could not measure it" is not "we measured it and it diverged".

Tightening it immediately turned one green row red: `classifier-streak` had been passing on an exit
code, and under the new reading its sabotage leaves both covering scenarios byte-identical. That row
is now dropped. **The instrument that grades liveness is itself a thing that can be vacuous, and
nothing else in the harness was watching it.**

### A liveness sweep needs its own non-vacuity guard

The wave's first sweep reported six splices live on a scenario tag **that does not exist**:
`m1/run.ts` exits non-zero on an unknown tag, and the sweep read non-zero as RED. It is C8's vacuous
negative with the sign flipped — a vacuous POSITIVE, which is worse, because a false negative gets
investigated and a false positive gets committed. The sweep now runs its whole tag list against a
known-good engine before it measures anything.

### Five functions were spliced, measured dark, and un-spliced — and two of the five were not dark

This was the wave's largest single lesson, and it arrived in four different shapes. **Two of the five
verdicts were wrong, and C9's fix round re-spliced them; the section below states the corrected
finding, because a darkness verdict a later round overturns is worth more read forwards than
preserved.**

**Two were adjudicated dark because their remaining callers were said to be, and they are not.**
`Ree`/`isAskRuleDrivenReason` (6 call sites) and `Fy`/`findSafetyCheckReason` (17, the most-called
function this wave touches) are both anchorable and both have zero free variables. Both were spliced,
built, solo-sabotaged, found green, and removed. Three separate things were wrong with that:

- **the twins could not have been observed by anything.** `Fy`'s returned `undefined` and `Ree`'s
  returned `false`, which is what the healthy functions return on *every input the corpus produces*,
  because both answer by finding something no corpus decision carries. A twin that agrees with the
  original across the whole domain under test measures the twin.
- **the corpus had no `auto` cell.** Their surviving callers include the mode-aware decision body,
  which runs only under `auto`, and nothing had ever entered that mode. Adding one scenario and
  inverting the twins turns both rows red.
- **the written justification was wrong in every particular a reader could check.** It called the
  auto arms "gate-dead under §3.3" — this same wave measured `auto` accepted; it said the corpus's
  decisions "carry no `decisionReason` at all" — every Bash denial carries `subcommandResults`,
  which is exactly the shape both functions recurse into; and it missed that the two callers left
  after the pre-check and the rule checker take their copies are on the LIVE headless Bash path (the
  multi-`cd` aggregator, the subcommand merge's tie-break), wanting only a command shape no cell
  wrote.

C7's "a single-caller pure helper cannot be a live splice" still holds. What does not follow from it
is that a many-caller one is dark because **one** twin, run against **one** corpus, moved nothing.
**A darkness verdict is a measurement, and it inherits every limitation of the twin and the corpus it
was taken against.**

**One is dark because its output is absorbed.** `ql`/`permissionMessage` has **45 call sites** and
RUNS on essentially every tool call — it is the opposite of a dark function — and it is still
unprovable headlessly. An ask's message is consumed by a prompt surface that does not exist in a
headless session, and the one path on which it reaches the model takes the rule checker's annotating
arm, which keeps the TOOL's message rather than this one. **Call-site count is not liveness**; what
matters is whether the value reaches an observable.

**One is dark because the seam is not the seam.** `K0`/`setPermissionModeWithGuards` joins the mode
guard to the mode transition and reads like the `set_permission_mode` handler; the W5–W7 scout tables
it as exactly that. The headless runtime's handler calls the **guard directly** and applies the mode
itself, and `K0`'s only call site in that chunk belongs to a different entry point's
`onSetPermissionMode` callback. A twin that REFUSED every mode change left the mode walk green — the
strongest mutant the seam admits, and still invisible. Its two ends are both owned and both live, so
only the joint is unowned.

**And one is dark because its ANSWER is pinned.** `Uct`/`classifierOnlyStreakActive` is sixty-two
bytes on the allow arm of every tool call in every mode, including the twenty-two bypass scenarios —
by call count the cheapest live unit in the subsystem. §3.3 holds its feature gate at the disabled
default, so upstream returns `false` on every graded run, and the MAXIMAL twin (return `true` always,
suppressing the denial-streak reset on every allowed call) leaves both covering scenarios
byte-identical. The counter it guards is read only by the auto-mode classifier. **A function can run
constantly, be spliced faithfully, and still decide nothing a corpus can see.**

That last one was carried as live for most of the wave, on a RED the gate inferred from a non-zero
exit rather than from a graded verdict — see below.

The takeable-but-dark functions live in `strangle/modules/shared/`, graded against their own upstream
bytes by the oracle before any body is built on them; `Ree` and `Fy` moved out of `shared/` into
manifest rows of their own when the fix round re-spliced them, leaving one-line re-exports behind so
the owned decision modules keep importing them from where they always did. `K0` was dropped outright,
as C1 dropped the interrupt clause, because a delegation is not a helper. **In every case the wave
kept the written finding where the row would have been** — a row the gate cannot prove is worse than
no row, because it goes green for free.

### The branch instrumenter learned a guarded body that returns

`strangle/branches.ts` refused a `try` block that can `return`, because the end-of-block marker is
exactly what a `return` skips. Three of this subsystem's four most-called functions do exactly that,
and rewriting them to hoist a result into a variable would have measured something other than what
upstream wrote — so the instrument was extended, not the code (C8's rule, second instance).

Every escaping `return` now carries its own recorder for the same completed arm, written as an
EXPRESSION (`return (__covS(id:F), EXPR)`) so a braceless `if (x) return y` keeps owning its own
statement; the end-of-block marker is emitted only when the body can actually fall off its end.
Nine new controls, including the false-RED direction the old refusal was protecting against. Still
refused, for a reason a `return` does not share: a `break` or `continue` that leaves the guarded
body, labelled ones included — a jump has no expression position to record in.

### The oracle: `strangle/permissions-parity.test.ts`

The fifth instance of W2's oracle, with one addition to the family: **it finds its subject by the
build's own rule.** Rather than hand-rolling a brace matcher, it calls `resolveAnchor` +
`selectExcision` + `assertSignature` against the pinned bundle — the same three functions
`strangle/build.ts` calls — so an oracle and a build cannot grade different functions, and a row
whose anchor drifted fails here as well as at the build.

It compares the **port trace** alongside the value, because two refusals returning the same thing can
differ in nothing but which ports ran and in what order: the update filter's short-circuit, the
streak predicate's three-term conjunction, the pre-check's two reads of the permission context. And
it walks the fixture's own axes — the mode transition's thirty ordered pairs, the guard's six modes ×
four context shapes × the gate, the message builder's eleven reason kinds × three tool names — so a
mode added upstream widens the cross-product instead of leaving a hole nobody wrote a case for.

### C5x's inherited carve-out, closed

C5x spliced `kye` — the chain's deny-stamping link — as its mechanism spike for the
arrow-initializer target shape, and left the VALUE ungraded: the corpus proved the link live, but
nothing compared what it returns against upstream's bytes. Small is exactly where a transcription
error survives, because every scenario reaching it also reaches thirteen other rungs that would mask
a wrong stamp. The oracle now runs it over five decision shapes and both sink shapes, with four
controls: the stamp landing on a non-deny, a pre-set `decideLocation` surviving instead of being
overwritten, the stamp written before the spread, and a non-deny rebuilt rather than returned.

Closing it needed one extension to the oracle's extractor. An arrow-initializer's excision is the
initializer EXPRESSION — `async(…)=>{…}` with no `kye=` in front of it, because that is the span the
build replaces — so evaluating it needs the binding put back. Every other shape's excision is
already a declaration that names itself.

### `gK` does not carry `initialize`

The scout calls `gK`/`$U` "the highest-leverage pair in W7 — every headless `control_response` passes
through them, so sabotage reddens on `initialize` alone". Measured: the headless runtime builds the
`initialize` and `reinitialize` responses as **inline object literals** and routes every OTHER
inbound subtype through the shared responder. Sabotaging the success constructor leaves `plain`
green and turns `runtime-setters` red.

W6 took both envelopes anyway — the `can_use_tool` round trip is the only control request the
permission chain itself issues, and leaving the return leg unowned would have stopped that chain's
ownership mid-round-trip. W7 inherits the request leg, and should re-verify the rest of the scout's
§3.2 table the same way.

### The attestation is what grades the SCENARIOS

W6's exclusion set is the widest in the campaign — 175 new entries, for a total of 301 against 340
executed outcomes — and the reason is structural
rather than sloppy. **This subsystem's job is to decide, and a rung that is reached and passes leaves
the same transcript as one that was never reached.** A decision ladder is the one shape where
transcript-level coverage says least, which is precisely why the branch inventory earns its cost
here.

It paid for itself three times over:

- it caught the two rule cells above, which no check could have;
- it showed that the pre-check's own **deny rungs never fire** — 80 of its 122 branch outcomes execute, and the
  two rungs the subsystem is named for are not among them, because the engine has faster paths above
  them for both rule shapes a corpus can express (a whole-tool rule removes the tool; a Bash content
  rule is decided by the Bash tool's own subcommand pass);
- and chasing the second of those into the bundle turned up the **input-rule grammar**: upstream's
  matcher takes only `Tool(field:pattern)` and explicitly skips the tool's own rule-content field, so
  every path spelling of a `Write` rule misses the rung. Three spellings were measured live before
  the row was left OPEN with its condition and its refutations written down.

Four exclusion families, each named on its own entries: arms behind the pinned environment
(sandboxing, remote execution, disabled-default gates), arms behind a tool CAPABILITY no headless
tool implements, arms behind an interactive surface a headless session lacks, and arms behind a
condition this project has deliberately not created — a real safety-check trigger means running
something genuinely dangerous in the sandbox, and that is a scenario to design rather than improvise.

Three of the entries are MEASURED negatives rather than deferrals, which is the distinction C8's
vocabulary exists to protect: the whole-tool deny rung (the rule removes the tool), the input-deny
rung (three spellings refuted), and the guard's `auto` refusal (the mode was accepted through both
paths, so the refusal now needs a condition this environment does not produce).

### What W6 does NOT claim

**The subsystem is not owned**, and three gaps are named on the ledger row rather than implied:

- `von`, the 11.6 KB mode-aware decision body ABOVE the pre-check — sixty free variables, a
  model-classifier call, a mutable per-session denial counter. A §2.3 designed port, not a
  transcription.
- `createCanUseTool`, the broker's own class method — five mutable maps on its receiver plus
  thirty-five module imports. The same shape.
- `Dd`, the chain's two-line entry point — **no string literal at all**, so the anchor mechanism
  cannot reach it. Both of its neighbours are owned.

(`eln`/`initializeToolPermissionContext`, 5.4 KB of settings and filesystem I/O, belongs with the
settings layer rather than with the decision chain.)

And **four decisionReason kinds are named but not created**: `safetyCheck` (creating it means
running something genuinely dangerous, which this project should design deliberately rather than
improvise), `subcommandResults`, `sandboxOverride`, `workingDir`, `asyncAgent` — plus `classifier`,
which §4.1 below turned from unreachable into merely uncreated. Each is a row in
`research/2026-09-01-w6-permission-matrix.md` with its condition written out, not a blank.

### The corpus: thirteen recordings, five of which measured the wrong thing first

The mode matrix, the three rule behaviours and the two hook paths cost eleven scenarios, and C9's
fix round added two more (`perm-working-dir`, `perm-auto-classifier-deny`) for a W6 total of thirteen
and a corpus of 58. Three of the original eleven
passed on their first take while grading something other than their claim, and all three failures
were the same shape — **the engine has a shortcut ABOVE the rung the scenario aims at**:

| scenario | what it actually measured | fix |
|---|---|---|
| `perm-accept-edits` (Bash half) | `acceptEdits` auto-allows `mkdir`: upstream hard-codes `mkdir, touch, rm, rmdir, mv, cp, sed` as edit-shaped commands. The "must still be brokered" arm measured the mode's other arm | use `chmod`; the list is now a derived fixture axis |
| `perm-rule-allow` | a CONTENT-scoped allow rule is matched by the tool's own `checkPermissions`, above the ladder's allow rung | a whole-tool `Write` rule |
| `perm-hook-rewrite` | four takes; the PermissionRequest hook's output shape is `{hookSpecificOutput:{hookEventName,decision}}`, and the host broker won the race | correct shape, plus a 1500 ms broker delay so the hook answers first |
| `perm-rule-deny` and `perm-bypass-deny-rule` | a WHOLE-TOOL deny rule is applied by removing the tool from the session, so the model got "No such tool available" and the chain never ran. Both cells PASSED every assertion they carried | command-scoped rules; see below |

The last row is the one worth generalising, because no check caught it. **The
branch attestation did.** A filtered tool and a denied tool leave the same
transcript — tool attempted, no consult, no effect — so every transcript-level
signal agreed with the cell's claim; what disagreed was the pre-check's deny
rungs reading ZERO executions across the entire corpus. Twenty-four tools in
that session's init frame instead of twenty-five was the tell, and nothing but a
per-branch inventory of the OWNED code would have surfaced it.

Both cells came back from the re-recording stronger than they were designed. A
rule denial does emit a `permission_denied` frame once it reaches the chain; the
bypass correction is now confirmed by a recording rather than only by reading the
bytes; and the frame's reason kind is `subcommandResults` — which the matrix had
listed OPEN and expected to need a compound command, since the Bash tool
decomposes unconditionally and every Bash denial is an aggregate of one.

Two more scenarios kept their cassette but had their CLAIM narrowed, which is the same lesson from
the other side. A rule denial produces **no `permission_denied` frame** — the SDK's own types say the
field is populated for `canUseTool` denials only, and a rule deny never reaches the broker — so
`perm-rule-deny` grades the ORDERING (rule before consult) and the oracle grades the stamp. And an
ask rule's consult carries **no `matchedAskRule`** when the tool passed its own check, because only
the pre-check's annotating arm stamps it. **When a recording cannot see a field, say which instrument
can, and grade the claim the recording can actually support.**

### The C9 boundary round: what a review of the RECORD found that a review of the code did not

The boundary review returned NOT CONVERGED on the record side while the code side held: every splice
byte-faithful, every darkness claim verified, the gate's liveness change validated. Everything below
is something the artifacts CLAIMED and the recordings did not support. That asymmetry is the finding
worth keeping — **this wave's code was reviewable and its evidence was not**, because nothing checks
that a document's citation names a run that exists.

| what an artifact claimed | what the recording held |
|---|---|
| the mode walk "makes a tool call after every change", cited in the matrix for a rung-11 decision | its plan turn had no tool call at all; the check read `usedTool` over the whole run, so the *dontAsk* turn's Write carried it. Per-turn checks now, and the plan turn is a read outside the cwd — the only decision-bearing call plan mode's injected reminder lets the model make |
| `perm-plan-mode`: "the decision must not be an allow, and the file must not exist" | the Write was brokered, allowed, and the file created. Plan mode's refusal in the pre-check is guarded on `e.mcpInfo`, so a built-in file tool never reaches it; plan mode DELEGATES. The second half of the claim was graded by nothing, which is how it survived being wrong |
| the classifier "was not reached" under `auto` | it was. It makes its own `/v1/messages` call, and for that command it answered `<severity>25` — allowed. The `classifier` decisionReason and the `PermissionDenied` hook event both fell out of making that one call fail |
| `Ree` and `Fy` are dark | neither is; see above. Both are spliced |
| the committed attestation report | stale, for the second time. `attest --check` now diffs it against the report the run would write, so a stale commit fails the gate loudly instead of drifting |

Three things generalise past this wave:

- **A per-turn design rule needs a per-turn assertion.** Writing the rule in a comment and grading it
  with a whole-transcript predicate is the same hollow pass the comment says the scenario exists to
  prevent, one level up.
- **A correction has to sweep the justification layer, not just the narrative one.** Both of the
  wave's headline corrections were stated correctly in the wave record and left standing, unmarked,
  in the scout that feeds the next wave, in module headers, in exclusion reasons and in the gate's
  own comments — nineteen sites. A refuted premise that survives where the reasoning lives will be
  reasoned from again.
- **A committed artifact that nothing diffs will go stale, and regenerating it only resets the
  clock.** The fix is the guard.

After the round: gate **92 of 92 phases** (the figure is the SUMMARY block's, not the log's — the
earlier 121 counted printed lines, and a liveness phase prints one per covering scenario), corpus
**58 of 58** green against the strangled build, attestation **355 of 669 outcomes executed, 314
excluded, zero unadjudicated**, the permission oracle unchanged at 2,508 comparisons with 49
controls, and the hook oracle at **707 comparisons with 116 controls** after the new dispatcher's
eight cases.

## W7.5 — the completions wave: what was takeable, what was measured, and what the design pass refused (2026-09-02)

The bloc-closing wave. Its four items were ordered so the cheap measurements landed before the
expensive design work, and three of the four ended somewhere other than where the campaign expected.

### The system-prompt sections: inventory first, then six splices

"`OS()`'s ~20 prose sections" had been quoted since W3 — in the campaign spec, in this file, and in
the W3/W4 scout. It is the third population in this campaign to have been carried as a number
somebody wrote down, after the hook events (counted by judgment twice, wrong twice) and the
control-protocol arms (hand-counted, wrong by three). Both of those were fixed the same way, and so
is this one: **`research/tools/extract-prompt-sections.ts` derives the inventory from the pin** into
`research/fixtures/prompt-sections-2.1.251.json`, and the gate re-derives it every run.

The real shape is **27 dynamic section records and a six-element static head**, assembled by a
five-element return array: the static head (a conditional spread, six producers in its else arm and
one, `L8t`, in its then arm), two single-element conditional spreads (`mQn` for
`excludeDynamicSections`, `wO` for the boundary sentinel), the dynamic set itself, and **one**
element after it, `kKe(t)`. The wave first wrote "a two-element tail", which miscounts the return
array: one element follows the dynamic set, not two.

The tool names nothing. It finds the section-RECORD CONSTRUCTOR by shape — a two-parameter function
whose whole body returns `{name: p0, compute: p1, …}`, of which there is exactly one graph-wide —
and then the one top-level function that calls it ten or more times with two arguments. **The naive
version of the second pass is not unique and its top hit is a decoy**: the attachment-list builder in
the same chunk makes 47 two-argument calls to an identically shaped runner and outranks the real
target. Requiring the callee to carry a `compute` property collapses three candidates to one. That
near-miss is recorded in the tool, because a shape-based extractor's real failure mode is a
plausible impostor rather than a miss.

Confirmed from two places that are neither pass: the **boundary sentinel** the already-owned block
partition looks for with `findIndex` (reached through the return array, resolving to the constants
chunk), and the **`defaultSystemPrompt`** property every caller binds the awaited result to. The
second follows one binding hop rather than matching a name, so a chunk that merely mentions the
property and separately imports the builder does not pass.

Then six splices, all on the static head, about **11.2 KB of the preset's prose**:

| row | upstream | bytes | what it renders |
|---|---|---|---|
| `executing-actions-section` | `x8t` | 3,625 | `# Executing actions with care` — **zero free variables**, one template literal |
| `doing-tasks-section` | `P8t` | 4,067 | `# Doing tasks`, the largest prose section |
| `system-section` | `R8t` | 1,116 | `# System` |
| `using-tools-section` | `M8t` | 1,316 | `# Using your tools` — nine `primitive` captures |
| `tone-and-style-section` | `D8t` | 626 | `# Tone and style` |
| `identity-security-section` | `C8t` | 436 | the opener of the section list |

**Every anchor is prose occurring once in 1,802 files** — the strongest class the doctrine has, and a
deliberate contrast with C6's two structural anchors. Two near-misses are recorded on the rows: the
`# Using your tools` heading occurs TWICE inside its own function's two arms, which `selectExcision`
reads as a tie because it counts candidates rather than spans (C6 predicted this shape and left the
mechanism alone; here it is met again and worked around by anchoring on prose the arms share); and
the short form of the parallel-tools sentence also occurs twice, so the anchor is the long form.

All six solo sabotages turn `sysprompt-preset` RED and the faithful build is green on all six
covering scenarios. `strangle/prompt-parity.test.ts` went **178 → 217 comparisons and 8 → 23
controls**; attestation **427/851 → 436/871** with eleven new reviewed exclusions, three
`noBranchesReason` entries and zero unadjudicated.

**One transcription lesson generalises past this wave.** The first take of the largest section was
not byte-identical, and it failed in a way that looks correct: the prose was read out of the SOURCE
TEXT between the template-literal delimiters, which carries upstream's own backslash escapes, so the
owned copy compared equal against the source form while differing from the value. **Read what the
function RETURNS, not what its source says.** Any later wave taking a prose target inherits this.

**And one mechanism detail the taxonomy forced into the open:** a fold-in still has to be DECLARED.
The capture inventory refuses an undeclared free variable, so the single-caller hooks paragraph rides
as an owned `pure-helper` — derived, but neither forwarded nor called — which also keeps §5
footprinting its upstream declaration.

**Two oracle preludes bind upstream bodies to OWNED constants, which is a deliberate exception to
C7's rule.** The standing rule is that an extracted upstream body is bound to UPSTREAM's own helpers,
never the wave's, so the oracle cannot share an input with the thing it grades. `M8t`'s prelude
declares the nine tool-name identifiers from the owned `TASK_CREATE_TOOL`/`BASH_TOOL`/… constants,
and `C8t`'s declares `rKe`/`jfe` from the owned `AGENT_IDENTITY`/`SECURITY_POLICY`. Both are
`primitive` captures — tool names and two prose constants — and every one of them is compared against
its upstream-derived value by `assertGraphValue` **on every delegation the corpus makes**, which is
the check the taxonomy assigns to `primitive`. So the coverage is real and lives one layer down; what
is exceptional is only where it lives. Logged in `docs/tech-debt-tracker.md` as C7's one tolerated
exception, with that reason, so a later reader does not read it as a false green.

### The 27 dynamic records: what the fixture carries, and the three gaps that are takeable today

The wave record first said "the fixture says why each of the 27 dynamic records is or is not
takeable". **It does not.** The fixture carries SHAPE — for each record its name expression, whether
it sits behind a conditional spread, what its thunk produces (`call`, `constant`, `gated`, `inline`)
and, where a producer resolves, its chunk, byte span and declaration kind. The reason each record is
or is not takeable was a single class-level sentence in the ledger note, and that sentence was wrong
in two ways.

**It is wrong as arithmetic.** "Four are inline expressions or cross-chunk requires with nothing to
excise" counts three: ONE inline thunk (`endconv_deferred_hint`, which resolves to no named producer
at all) and TWO cross-chunk producers (`memory` → `pKe` in `chunk-9e2ns8ty.js`, and
`subagent_steer_delegation` → `Rnr` in `chunk-bsdtxcdc.js`).

**It is wrong as a reason.** "The rest are gated behind experiments, background jobs or remote
surfaces the corpus does not enter" is false for records the corpus RENDERS. Probing each producer's
own prose literals against the `m1-sysprompt-preset` cassette — and, for the four producers that hold
no prose of their own, their rendered heading — **nine of the 27 records render today, over seven
producers** (the three `env_info` records share two):

| record | producer | bytes | shape | status |
|---|---|---|---|---|
| `communication…` | `d8t` | 4,213 | call | RENDERS — candidate, anchor not yet measured |
| `pronouns` | `y8t` | 373 | constant | RENDERS — `variable-declarator` shape |
| `session_guidance…` | `O8t` | **1,447** | call | **RENDERS — TAKEABLE NOW** |
| `memory…` | `pKe` | 4,159 | call, cross-chunk | RENDERS — the port-heavy S-module; the one honest deferral in the old sentence |
| `env_info_static` / `env_info_simple` ×2 | `ZGe` (55) / `H8t` (127) | — | call | **RENDERS — TAKEABLE NOW** (`# Environment`) |
| `context_management` | `G8t` | 291 | constant | **RENDERS — TAKEABLE NOW** |
| `act_dont_rederive` | `N8t` | 283 | gated constant | RENDERS — `variable-declarator` shape |

The other eighteen do not render on this corpus, and for most of them the old class reason holds:
`brief`, `focus_mode`, `language`, `bg-session`, `scratchpad` and the three `heron_brook` /
`brook_heron` / `willow_tern` records are gate- or experiment-guarded, and `delivering_work_max`,
`overcorrection`, `subagent_steer_delegation`, `autonomy_append`, `action_caution`,
`task_continuity` and `tool_param_json` are prose behind conditions this corpus does not create.
Those are still OPEN with a named condition rather than dead.

**So: three named TAKEABLE-NOW gaps for a later completions pass** — `session_guidance` (1,447 B),
`context_management` (291 B) and the `env_info` family — each rendered by an existing scenario, so
each is gradeable the day it is taken, no new recording needed. The fixture stays a shape artifact
and this table carries the reasons, because takeability is a two-input judgment: shape comes from the
pin, rendering comes from the cassette, and the fixture is pin-keyed with a gate phase that FAILs on
any diff — binding it to corpus state would make a re-recording stale a pin fixture.

### Segment compaction: an ownability ceiling, and the campaign had the wrong function

W4 left three adjudicated branch outcomes — `user_context`, `messages_summarized`, and the
un-suppressed follow-up-question arm — "reachable only through the from/up_to segment variant", and
every wave since carried that as a coverage debt waiting for an owner. The charter said measure
reachability BEFORE budgeting coverage. The measurement says it is not a coverage debt at all.

**The correction first.** The spec, this file, the W3/W4 scout and W4's own exclusion reasons all
name `hRt` as the variant that passes five arguments to the `compact_boundary` constructor. `hRt` is
513 bytes and is that path's summarization-PROMPT builder; it never calls the constructor. The
function that does is **`E4n`** (4,710 B). Re-counted, the constructor has exactly three call sites,
two passing three arguments and one passing five — so the SHAPE of W4's claim survives and only its
subject changes.

**The reachability.** `E4n` is imported by one chunk and called once, from a method on the
interactive session controller that calls a host-required guard before it, reached only as a prop of
an Ink dialog that a double-Escape keypress opens. Ruled out by enumeration rather than by argument:
all 52 control-protocol arms filtered for the symbol (zero hits — and `rewind_conversation`, the
tempting one, truncates rather than summarizes), all **27** methods the installed SDK's
`interface Query` declares (`sdk.d.ts` 2522–2837 at 0.3.251 — the wave first said nineteen, counted
by hand) and the whole option surface, the PreCompact hook (whose trigger union has two values and
which `E4n` calls with a hardcoded `"manual"`), and the slash-command surface.

**That last one was written wrong the first time and is worth the space.** The wave record said
"there is no `rewind` or `summarize` command at all — 'rewind' is a dialog label". There is a
`/rewind` command: `Snr` in `chunk-fy12d89p.js`, described "Restore the code and/or conversation to
a previous point", aliased `checkpoint` and `undo`, whose `call` is
`o.onQueryEvent?.({type:"open_message_selector"}), {type:"skip"}` — it asks the host to open exactly
the dialog above. The verdict survives on two guards the note had not cited: the headless command
filter `k0t` admits only `type === "local" && supportsNonInteractive`, and `/rewind` declares
`supportsNonInteractive: !1`, so it is refused before its body runs; and the headless query-event
sink in `chunk-dvbbv89q.js` is `if (e.type === "open_message_selector") return;`, so even a `call`
that ran would emit a dropped event. The lesson is in the lessons list below.

**Verdict OPEN, and deliberately not DEAD.** The code is live, both fields are serialized onto the
wire and read back, and a headless session that RESUMES an interactively-produced transcript will
emit them. The reader side is reachable; the writer is the ceiling. Recorded in
`research/2026-09-02-w75-segment-compaction-reachability.md`, the three W4 exclusions moved onto that
evidence, and the variant routed to C16/W13 with the other compaction drivers. No machinery was
built to force the path, which is what the charter asked for.

### The hook executors: the design pass, and what it refused

`subsystem/hook-dispatch` has been `spliced` since W5 and cannot close. §2.3 says an S-module is
design-first; this is that pass (`research/2026-09-02-w75-hook-executor-design.md`), and it changed
the problem enough to justify the rule.

**The layer is ~56 KB, not the ~30 KB every prior scoping assumed.** The three named functions are
30 KB; two functions nobody had named are 13 KB more — the command-hook subprocess runner (7,209 B,
called by BOTH executors and by three callers outside this subsystem) and the JSON-contract
interpreter (5,993 B, five call sites all reached through the streaming executor, one of them
transitively through the callback arm's per-hook body) — plus a ~14 KB belt of already-pure helpers.

**Three names this repository used were wrong, and each changes a decision.** `getMatchingHooks` is
two functions: one matches, the other resolves the SOURCES, and owning the first alone owns no
sources — and the source fan-out has a THIRD consumer, a non-executor that fingerprints the session's
`UserPromptSubmit` hooks for the host, so the port serves someone outside this subsystem. The layer
reader the ledger named is real, but it is not the store: the store behind it is a class whose fields
are **public**, which is precisely why this is the right first S-module where W10's Bash executor is
blocked on private fields. And the wrapper called "headless suppression" suppresses on
**shutdown**: one process-wide flag set only in exit paths, after which six events hang forever on a
promise that never settles and the rest return silently. A filter that does not exist was hiding a
fail-closed gate that does.

**The architecture decision:** the awaiting executor is not the streaming one's wrapper and must not
share a core with it. Their return types are disjoint, it never calls the contract interpreter and
silently drops the entire `hookSpecificOutput` permission contract, two of its arms are stubs, and it
returns results in index order against the other's completion order. One core with two façades would
make it honour fields upstream drops on thirteen events — an "improvement" arriving exactly where the
gate is weakest, since the awaiting path has no yields to compare. Nine ports are proposed with the
reason each grouping holds together; behind those cuts about 27 KB is pure or pure-once-ported and
the effectful residue to write is about 12 KB.

**And the pass refused its own implementation, for reasons that are properties of the target rather
than of the schedule.** The oracle needs the interleaved-event-log rewrite BEFORE the first module:
the tech-debt entry predicted this trigger and was right, and the design adds a reason it did not
anticipate — cleanup pairing for per-hook derived signals, released on six paths plus a catch, is a
property only an ordered log can state. Two further oracle capabilities land with it: reproducing
stdout CHUNK boundaries (async detection latches on the first WRITE after which the accumulated
stdout's first line contains a `}`, and the latch is one-shot, so byte-equal
stdout delivered in a different number of writes is different behaviour) and grading a path that
never settles. And the corpus needs a multi-hook scenario and a repeated-spawn-failure scenario that
do not exist, purely to make the merge and the once-per-process arms gradeable. Forcing it in would
have produced the shape the campaign has already paid for twice: a module shipped ahead of its
oracle, where the debt is real and the interest is invisible. Staged 0–5 in the design, awaiting
executor before streaming one.

### The riders

**CwdChanged fired.** W5 left the event OPEN, correctly — no phase moved the tracked working
directory. The mechanism was never in doubt: the Bash tool appends a `pwd` write to every command and
reads it back, so a persisting `cd` moves the tracked cwd. The new `cwd-change` probe phase creates
it and the event **FIRED** on both hook paths, with the record carrying `old_cwd` and `new_cwd` after
the common prefix. `hooks-cwd-change` recorded it into the corpus (**58 → 59**) and `AUt` is spliced
as `cwd-changed-hooks` — its twin's body with one string and two keys changed. The hooks oracle gains
a field-order block (**707 → 721 comparisons, 116 → 121 controls**) because those two fields are the
only bytes distinguishing this dispatcher's stdin stream from its twin's.

Two things were corrected on the way past. Both the probe and the scenario first claimed two
exchanges were REQUIRED because a `cd` inside one command's subshell moves nothing; the bundle does
not say that, and "the second exchange is evidence, not mechanism" is what they say now. And the
notifier that reaches this dispatcher consults the settings layer and plugin hooks **only** — never
the global store `Options.hooks` callbacks land in — so a callback alone arms nothing, which is why
both register their matcher through `Options.settings`.

**`rewind_files` was measured and declined.** The charter's condition was "only if its scenario is
genuinely cheap", and the scenario really is: one env knob, state the engine snapshots on its own, an
answer that arrives as a `Query` method's return value rather than a transcript frame, and one
recording reaching all four exits. It was still declined on two facts the condition does not cover.
Four of the five free variables are effectful ports into the file-history subsystem, and what the
body owns is two sentences, two guards, a branch and two field sets — the worst
owned-decision-to-capture ratio in the family, with no byte-order contract to own. And all three of
its good literals occur in TWO chunks, because the interactive host object carries a line-for-line
twin; a `coLiteral` resolves it, but the only chunk-unique candidates belong to other arms of the
same control ladder, so the row's locator would name neither the handler nor its subsystem. Logged in
the tech-debt tracker with the measurement, rather than taken or silently skipped.

### After the wave

Gate **107 of 107 summary phases, zero FAIL**, corpus **59 of 59**, attestation **436 of 871 executed, 435 excluded, zero
unadjudicated**, **74 manifest rows** (73 splices plus the one S-chunk replacement), ledger 47 rows with `spliced=9`. The prompt oracle is at 217
comparisons with 23 controls and the hook oracle at 721 with 121.

### The C10.5 boundary round: converged on the code, NOT CONVERGED on the record

The review reproduced every code claim above — the gate, the prompt oracle at 59 of 59, the
attestation split, both oracles, three live sabotages RED. **Everything it rejected was a document**,
so the fix round was documentation only: no code, no re-recording, no re-gating.

| what the record claimed | what the bundle holds |
|---|---|
| "no `rewind` or `summarize` command at all — 'rewind' is a dialog label" (four artifacts) | `/rewind` is registered, aliased `checkpoint`/`undo`, and asks the host to open the message selector. The verdict survives on two guards nothing had cited: the headless command filter rejects `supportsNonInteractive: !1`, and the headless query-event sink drops `open_message_selector` |
| "all nineteen `Query` methods" | the installed SDK's `interface Query` declares **27**; none touches compaction |
| "the fixture says why each of the 27 dynamic records is or is not takeable" | the fixture carries shape; the reasons were one class-level sentence, and it was wrong for the nine records the corpus renders |
| the design doc's `Fq`/`Wie` call-site counts, its `AM`-is-pure claim, its async-detection example, its `IE` correction and its uncited classifier cap | five wrong, one merely uncited — all corrected in place, because that doc is the brief for three waves not yet cut |

**The lesson, and it is the general form of the `/rewind` error: an enumeration that rules something
out must cite the GUARDS that rule it out, not the absence of the thing.** "There is no such command"
is a negative that the healthy case — a command that exists and is refused — does not falsify, so it
survives review by being unfalsifiable rather than by being true. Every other line in that same
enumeration named a mechanism (a filter, a union with two values, a hardcoded argument) and every one
of them held.

## Next

**The bloc is closed.** W3–W7 landed, W7.5 closed it out, and the C10.5 boundary review closed the
record side after a documentation-only fix round. The campaign resumes at **C11/W8 (moat tools)**,
and the S-module lane is now cut rather than pending: **C10.6/W7.6a → C10.7/W7.6b → C10.8/W7.6c**,
each reviewed before the next is cut, with
`research/2026-09-02-w75-hook-executor-design.md` as the brief for all three. What the next waves inherit, newest
first:

- **READ WHAT THE FUNCTION RETURNS, NOT WHAT ITS SOURCE SAYS.** W7.5's largest prose section was
  transcribed out of the source text between the template-literal delimiters, which carries
  upstream's own backslash escapes — so the owned copy compared equal against the source form while
  differing from the value. Every wave that takes a prose target inherits this, and it is invisible
  to a reviewer reading both sides.
- **MEASURE REACHABILITY BEFORE BUDGETING COVERAGE.** Segment compaction was carried as a coverage
  debt for three waves. One afternoon of enumeration — the control-protocol arms, the `Query`
  methods, the option surface, the hook, the slash-command list — showed the producer sits behind a
  terminal dialog and a keypress, so no scenario could ever have paid the debt. And the enumeration
  found the campaign had been naming the wrong function for three waves. **A debt whose reachability
  nobody measured may not be a debt.**
- **A DESIGN PASS IS ALLOWED TO REFUSE ITS OWN IMPLEMENTATION.** W7.5's executor pass found the
  target twice the assumed size, three of the names wrong, and three oracle capabilities missing —
  and said so instead of starting. That is what §2.3's "design-first" buys; a pass that always
  concludes "proceed" is a formality.
- **AN ENUMERATION THAT RULES SOMETHING OUT MUST CITE THE GUARDS, NOT THE ABSENCE.** W7.5's
  reachability note ruled out the slash-command surface by saying no such command exists. One does;
  two guards refuse it. Every other line of the same enumeration named a mechanism and every one of
  them held. A negative stated as an absence cannot be falsified by the healthy case, so it passes
  review without ever having been checked.
- **AN OPEN ROW IS A STATE, AND CREATING ITS CONDITION IS USUALLY CHEAP.** CwdChanged had been OPEN
  since W5 behind one `cd`. Before scheduling machinery for an OPEN row, check whether the condition
  is one line away.
- **"CHEAP SCENARIO" AND "GOOD SPLICE" ARE DIFFERENT QUESTIONS.** `rewind_files` passes the first and
  fails the second: four of five free variables are ports, the body owns no byte-order contract, and
  its only anchors need a `coLiteral` borrowed from an unrelated arm. Ask both.
- **DERIVE THE ENUMERATION FROM THE ARTIFACT, NOT FROM JUDGMENT.** Three populations have now been
  counted by hand and been wrong — the hook events (twice), the control-protocol arms, and the prompt
  sections. All three are pin-keyed fixtures with gate phases now. If the artifact enumerates
  something, read it. **A list a tester writes can only ever confirm the tester.**
- **A SHAPE-BASED EXTRACTOR'S FAILURE MODE IS A PLAUSIBLE IMPOSTOR, NOT A MISS.** The naive version
  of the prompt-section search returns three hits and the top one is a decoy that outranks the
  target. Every such tool should name its near-miss and the discriminator that rejected it.

- **DERIVE THE ENUMERATION FROM THE ARTIFACT, NOT FROM JUDGMENT.** W5 chose the population under
  test by hand twice — first from a stale doc line, then from a list of "events a tool-using turn
  could plausibly reach" — and was wrong both times, because an event nobody thinks to watch cannot
  be measured as absent. Upstream keeps a registry of every hook event and its dispatcher; deriving
  the watched list from that fixture, and gating on it, took the live set from 12 to 23. This is the
  same move C3 made for the feature-gate defaults, and it applies wherever the question is "what is
  the complete set of X": tools, slash commands, settings keys, control-protocol methods. If the
  artifact enumerates them, read it. **A list a tester writes can only ever confirm the tester.**
- **A negative is only evidence if the healthy case would have produced a different one, AND the
  thing was in the population.** W5 hit both halves. The first: five events read as dead off a turn
  that created none of their firing conditions. The second: three live events outside the watched
  list entirely. The verdict vocabulary that survives has three values, not two — **FIRED**, **DEAD**
  (a condition was created and nothing happened), and **OPEN** (the condition is named and was not
  created). OPEN is an absence of evidence and must never be counted as a negative.
- **Measure through every path a feature has, not the convenient one — and re-check the MECHANISM you
  used to explain a gap.** The boundary round explained SessionStart's callback silence structurally
  ("the dispatcher passes no registry, so no callback can reach it") and the bundle refutes it: SDK
  callbacks land in a global store the executor consults unconditionally, and the silence is
  registration TIMING. The byte fact was right; the inference from it was not, and it had propagated
  into two module headers, a scenario tripwire, a ledger note and the parity scorecard. **An
  explanation that fits the evidence is not the same as the mechanism.**
- **Watch for the modes that silently disable the thing you are measuring.** Three cost W5 real
  measurements: `bypassPermissions` skips the ASK (not the permission system — W6 measured that the
  rule engine still runs under it and a deny rule still bites); a bare `allowedTools` entry shadows
  `canUseTool`; and default mode auto-approves read-only shell commands without consulting it at all.
  Each turned a live event into a clean-looking negative. Before believing a probe's silence, check
  that the probe's own options did not switch the subsystem off — **and check that the silence is on
  the seam you think it is.** W6's `auto` cell read "the broker was not consulted" as "the classifier
  did not run"; the classifier makes its own API call, and it had run and allowed.
- **Extend the instrument, not the owned code, when the two disagree.** The branch inventory refused
  `try/finally` with no catch, and upstream's SessionStart dispatcher is exactly that. Rewriting the
  module to be measurable would have measured something other than upstream; teaching the instrumenter
  to splice in a rethrowing `catch` cost twenty lines and one fixture.
- **`Options.settings` is the way to register a COMMAND hook — or any settings-layer fixture —
  without a filesystem setting source.** An inline settings object goes into the flag-settings layer
  with `settingSources: []` still in force, so nothing outside the sandbox is read and the W3
  recording trap does not apply. W6's allow/deny/ask rule fixtures are the same shape and should use
  it rather than writing `.claude/settings.json` anywhere.
- **A REFUSAL that produces no observable is unrecordable by construction, not under-scoped.** A
  dispatcher that returns because nothing is registered emits no consult, no record and no frame, so
  no corpus can distinguish it from a function that was never called — while being the common case in
  production. W6's permission chain is full of the same shape (`bypassPermissions` short-circuits
  before the rule engine says anything). Budget an upstream-differential oracle for those arms
  instead of a scenario, and say so in the exclusion.
- **Grade a serialised record as BYTES somewhere, not only as an object.** Field ORDER is behaviour
  for anything that reaches a subprocess's stdin, and a callback corpus cannot see it. One scenario
  and one oracle assertion cost almost nothing and catch a reordering that every object comparison
  passes.
- **Bind the oracle's upstream body to the MANIFEST's own derived captures.** Re-deriving each free
  variable with the manifest's `derive` regexes and driving the owned side through its ADAPTER means
  the oracle cannot bind a port the splice does not forward, the argument list is the one the build
  synthesises, and a derivation that stopped resolving fails in the oracle as well as at the build.
- **A helper with many callers is a `pure-helper` capture; a helper with one is a fold-in.** W4
  learned the second half; W5 used the first across six distinct helpers, captured seven times. Check
  the call graph before deciding, in both directions.
- **A generator's delegation form is behaviour.** Upstream's dispatchers end in a bare `yield*` and
  return `undefined`; `return yield*` hands the delegate's completion value back instead. Nothing on
  the corpus's paths reads it, so only an oracle sees the difference — and W7's control-protocol
  generators are the same shape.
- **Compare a port TRACE, not just an output, wherever the target's arms differ by effect** (W4), and
  **bind extracted upstream bodies to UPSTREAM's helpers, never the wave's own** (W4's boundary
  review). Both held in W5: the trace is what grades the executor request, and six of eleven bodies
  call a helper this wave owns.
- **An exclusion is a claim about reachability, and it is only as good as the population it was made
  over.** W5 excluded PostToolUseFailure's refusal arm as "unrecordable by construction"; six new
  recordings later it executes, because they make tool calls without registering that hook and every
  earlier tool-using scenario happened to register one. Before writing an exclusion, ask whether the
  arm is unreachable or merely unreached by the scenarios that exist today.
- **`kye`'s neighbours are not takeable the same way.** `Dd` has no string literal at all, and `von`
  ties with `kye` on every structural fact except its position. W6 should expect the chain's other
  links to need coverage-first scenarios rather than more anchor mechanism.
- **`selectExcision` counts candidates, not spans.** An anchor occurring twice inside ONE target node
  ties and throws, even though the two occurrences name the same span. Still not a blocker for any
  target taken so far.

Named debts the roadmap owes an assignment:

- **`subsystem/tool-result-validators`** — an `unowned` ledger row with no wave, filed under C4 because
  C4 subdivided it (open since W1).
- **The preset's prose section builders** behind `OS()` — **six taken by W7.5** (the static head).
  The inventory is now a pin-keyed fixture carrying each of the 27 remaining dynamic records' SHAPE;
  the per-record takeability table is in the W7.5 record above, because rendering is measured from
  the cassette and the fixture is pin-keyed. Three of the 27 are **takeable now**, each already
  rendered by an existing scenario: `session_guidance` (`O8t`, 1,447 B), `context_management`
  (`G8t`, 291 B) and the `env_info` family (`ZGe`/`H8t`).
- **Segment compaction** (named `hRt` here; W7.5 measured the producer to be `E4n` — `hRt` is only
  that path's prompt builder) — three of W4's adjudicated branch outcomes are reachable only through
  it, and W7.5 measured that nothing headless reaches it at all: see
  `research/2026-09-02-w75-segment-compaction-reachability.md`. Routed to C16/W13.
- **The hook EXECUTORS** — **designed by W7.5, not implemented, and now ASSIGNED**
  (`research/2026-09-02-w75-hook-executor-design.md`: the layer is ~56 KB rather than 30 KB, three of
  the names below are corrected there, and the implementation is staged 0–5 behind an oracle change).
  The C10.5 boundary review cut the implementation as its own wave family rather than folding it into
  W8: **C10.6/W7.6a** takes Stages 0–1 (the interleaved event log, stdout write-boundary reproduction,
  non-settling-path grading, then the pure belt led by `Fq`), **C10.7/W7.6b** Stages 2–3
  (`HookSourcePort` + the matcher, then `AE` and `zxt`), **C10.8/W7.6c** Stages 4–5 (`ProcessPort` +
  the command-spec builder, then `Qxt`). The row reaches `standalone-complete` at the end of C10.8. The stale description follows for
  provenance: the 23 KB generator one (upstream `Qxt`, with `Rzn`/`Xxt`/`jy`), its
  awaiting sibling `AE`, and the watcher-hooks helper `zxt` that the second round surfaced. New with
  W5, S-module-shaped, and the largest thing standing between `subsystem/hook-dispatch` and
  `standalone-complete`.
- **The two MODEL-SWITCH dispatchers** (`mdt`, `gdt`) — they fire headlessly and are deferred on §2.3
  grounds (a mutable per-session holder, a fire-and-forget promise, a plugin loader, ~17 ports each).
  The `hooks-model-switch` recording they would need does not exist yet; the probe phase that proves
  they fire does.

And the deferrals now recorded on ledger rows rather than in research notes: the compaction DRIVERS
(`zRe`, `Tte`) are C16/W13's, and the hook executor is C10.6–C10.8's as of the C10.5 boundary review.
