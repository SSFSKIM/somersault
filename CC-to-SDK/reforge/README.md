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

## Next (M2+)

Extend the corpus toward the surfaces ccx actually consumes (subagents,
MCP, compaction, slash commands, session-store CRUD), then begin strangler
reimplementation: replace one module of the extracted payload at a time,
gating every replacement on the full cassette suite staying green against
`engine-real`.
