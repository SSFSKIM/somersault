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

## Known harness defects (audited 2026-08-24, not yet fixed)

Tracked honestly — today's green is bounded by these:

- **H1 `~/.claude` is shared with the real installation.** Corpus runs have
  already written 63 session files there. Isolation via `CLAUDE_CONFIG_DIR`
  needs a probe first: a fresh config dir may change engine behavior
  (onboarding/first-run state).
- **H2 no error/retry coverage.** Retry, backoff, and stream-interruption paths
  are a large share of engine code and are never exercised by happy-path
  recordings. The replay proxy makes **synthetic fault-injection cassettes**
  (mid-stream 500, overloaded, truncated SSE) essentially free — unused so far.
- **H3 partial streaming unverified.** ccx consumes `includePartialMessages`
  stream events; the corpus diffs only final messages, so a reimplementation
  could batch partials differently and still pass.
- **H4 filesystem side effects are not diffed.** The session-store format is a
  contract engine-ts must honor. `resume` only tests same-engine resume;
  **cross-engine resume** (real writes, strangled/ts resumes) is the real test.
- **H5 driven only through sdk.mjs.** Protocol surface the wrapper hides (e.g.
  the hooks that never fire headlessly) needs a raw stream-json driver.

Also fixed this round: the `file-tools` scenario originally let the model pick
its own path and it wrote **outside the sandbox** (a garbled repo path) — every
replay faithfully re-created the stray file. The prompt now pins the absolute
sandbox path and the substance check asserts containment.

## Next (M2b+)

M2b — repair the harness defects above (H1 first, probe-led). M2c — extend the
corpus toward the surfaces ccx actually consumes (subagents, MCP, compaction,
slash commands, session-store CRUD). Then scale strangler replacement: one
module at a time, each gated by `strangle/gate.ts`.
