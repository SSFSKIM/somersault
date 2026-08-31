# Reforge-full campaign — ratchet the extracted engine into owned TypeScript until engine-ts assembles

**Status:** approved 2026-08-31 · **Track:** decomposing (campaign-scale; this spec is the parent
design that `doperpowers:decomposing` cuts into the goal tree)
**Grounding:** `reforge/research/2026-08-31-engine-census.md` (subsystem census of the 2.1.251
bundle) · `reforge/README.md` (harness + gate doctrine, M0→M3-B + pin-bump history) ·
cassette measurement of the headless tool catalog (31 native tools, this spec §1.3)

## Purpose

The project's north star (`CC-to-SDK/CLAUDE.md`) is a fully ownable, fully customizable harness of
Claude Code quality. The Agent SDK delivers the quality today and is simultaneously the ownability
ceiling: its engine is a black box. This campaign closes that ceiling by widening the proven
strangler-fig lane from 3 spliced methods to the engine's full load-bearing client-side surface
(~5–6 MB minified), ending in **engine-ts** — a standalone reforge-owned engine, behind the
unchanged SDK wrapper seam, that passes the full differential acceptance surface with the extracted
substrate gone.

The bar is not the classic trio (prompt engine, tool layer, permissions) alone. Claude Code's moat
is **completeness**: the long tail of fully-shipped capability — agent messaging (`SendMessage`,
`ListAgents`), background tasks with notifications, `Workflow`, `ScheduleWakeup`, plan/worktree
modes, the task-tool family. The campaign's endpoint is the full functionality of the Claude binary,
minus only what is irreplicably server-side (§1.2).

Under the strategy already written into the north star, **"customize X" and "own X" are the same
act: splice X**. Every wave of this campaign is therefore both a reimplementation increment and a
customizability increment — ownership pays rent continuously, not at the end.

## 1. Target inventory

### 1.1 In scope (the load-bearing set, ~5–6 MB minified)

From the census: the engine is concentrated, not spread. One chunk — `chunk-fy12d89p.js`, 4.0 MB,
zero JSX imports — holds essentially the whole agent; satellites add a few hundred KB each.

| Subsystem | Census seam quality | Where |
|---|---|---|
| Tool result formatters + validators (Read, Edit, Bash, Grep, task family…) | very high (proven family) | `fy12d89p` |
| Tool-description chunks (Read, Glob, Grep, WebFetch) | very high — whole-chunk seams | `hx5r9amq`, `y30v0ja7`, `hdmehzg7`, `qe0j59w7` |
| Environment block + system-prompt assembly | high (env block is one 12-line fn) | `fy12d89p` @336–350, @85.3k |
| Compaction: summarization prompt, `compact_boundary` emit, trigger policy (reactive + microcompact) | high | `fy12d89p` @45–48k, @70k, @76.3k |
| Hook dispatch + hooks chunks | high (event names are unique literals) | `7g4v1yq9` + 4 small chunks + `fy12d89p` @30–33k, @70–74k |
| Permission decisions + rule matching/parsing | high (decision fns return plain objects) | `hw8qz4q5`, `8c6qx8qp`, `fy12d89p` @30–37k |
| Control-protocol switch (`control_request`/`control_response` subtypes) | high (one `switch` with literal cases) | `fy12d89p` @38.7k + `mfkbzdqf`, `kje2nmp8` |
| Moat tools: `SendMessage`/`ListAgents`, `Workflow`, `ScheduleWakeup`, TaskCreate family, `Skill`, plan/worktree tools | per-tool (scenario-led) | `fy12d89p` various |
| Session/transcript storage; resume/fork | module-level (Result-monad fs layer) | `d78hxkfm`, `trstwd25`, `fy12d89p` @4–10k |
| Bash executor (exec/timeout/background) + command-safety AST | high (ES class) / medium | `fy12d89p` @2.9k, @100–105k; `w7bq1qyb` |
| MCP adapter (thin layer over the vendored MCP SDK) | high | `4mp04j81`, `1bxday80` |
| Slash commands + skills loading | high | `fy12d89p` @10–12.5k + `g461tywa` |
| Agent/Task subagent dispatch | medium (nested loop reentry) | `fy12d89p` @55–58k, `bf5vvscj` |
| Query loop / turn driver (retry, 529, model fallback, compaction driver) | module-level (long async generator) | `fy12d89p` @75–80k |
| Sandboxing (platform launchers behind an interface) | module-level (CEL/protobuf tangle) | `q4xe0m2r` |

### 1.2 Exclusion ledger (recorded, not implied)

| Excluded | Size | Reason |
|---|---|---|
| TUI / Ink / React (288 JSX-importing chunks) | 6.8 MB | never traverses the headless seam the harness grades through |
| Vendored libraries | ~7.2 MB | engine-ts imports the real npm packages at assembly (`@anthropic-ai/sdk`, MCP SDK, zod, ajv, picomatch, highlight.js…) |
| Peripheral cloud features (teleport, cowork/teammates, self-hosted runner, bridge, computer-use, chrome bridge, artifacts, marketplace) | ~3.0 MB | product periphery, mostly server-coupled |
| Server boundary: WebSearch execution, `count_tokens`, OAuth endpoints, OTLP ingest, update manifests | — | server-side; the engine only formats/calls them. Client-side *formatting/policy* over these stays in scope (e.g. WebSearch result formatting, retry policy over 529s) |
| Glob/Grep beyond the existing splices | — | deprecated surface upstream; no further investment |

**Feature gates are neither spliced nor excluded.** 2,179 gate names with 862 inlined call sites in
the engine chunk have no seam. The campaign owns the *resolver* instead: pin it to a constant table
snapshotted from the real engine's server-delivered client-data blob (§3.3). Call sites then read
pinned values and dead branches fall away naturally in engine-ts.

### 1.3 The headless tool catalog is the moat's reachability proof

Measured from recorded cassette request bodies (2.1.251, SDK transport): the engine presents **31
native tools headlessly** — Agent, AskUserQuestion, Bash, CronCreate/Delete/List, Edit,
EnterPlanMode/ExitPlanMode, EnterWorktree/ExitWorktree, Glob, Grep, ListAgents, NotebookEdit, Read,
RemoteTrigger, ReportFindings, ScheduleWakeup, SendMessage, Skill, TaskCreate/Get/List/Output/Stop/
Update, WebFetch, WebSearch, Workflow, Write. Presence in the tools array proves the *catalog*
traverses the seam; per-tool *execution* reachability headlessly is a delegated unknown probed
scenario-first per tool (§6).

## 2. The granularity ladder — three splice mechanisms

- **S-method** (proven, unchanged): locate by true-substring-unique string anchor, excise the
  balanced-brace body, delegate to `globalThis.__reforge`, re-derive closure identifiers from the
  matched body per build (`deriveArgs`). Scope: nameable functions with distinctive literals —
  formatters, env block, compaction prompt, hook dispatch sites, permission decision functions,
  protocol switch cases. Survived ten versions and a bundler rewrite with zero re-anchoring.
- **S-chunk** (new): replace an entire chunk file with a reforge-owned module exporting the same
  surface. The 2.1.248 ESM packaging change made chunks importable seams. Minified export names
  churn per version, so the build derives them from the original chunk's export statement each
  build — the `deriveArgs` philosophy at file scale, never hardcoded. Debut: the four
  tool-description chunks (1–5 KB each). The build must verify the replaced chunk's import surface
  too (a chunk that imports engine internals needs those passed in or reimplemented).
- **S-module** (later): for the census's tangled list — session storage, sandboxing, the query
  loop — reimplement behind an explicitly designed interface and swap at the module boundary.
  Mechanically an S-chunk (or a set) plus an owned adapter; the difference is the work is
  design-first, not transcription-first, and gets fable-tier implementers (§4).

**Assembly endgame.** engine-ts is a closure event, not a rewrite event: when the owned set covers a
standalone core (protocol shell + query loop + tool layer + prompt assembly + storage), an assembly
spike wires reforge modules + npm deps into a fresh entry speaking stream-json, registered as one
more engine wrapper (`engines/engine-ts`) and graded by the same harness with zero harness changes.

## 3. Verification doctrine (extended, never weakened)

### 3.1 Coverage leads reimplementation

No splice lands without covering scenarios. The two-phase gate is unchanged and both halves stay
mandatory: each splice sabotaged **alone** must turn its own covering scenarios RED (liveness), and
the faithful build must stay GREEN on the full acceptance surface (equivalence). A splice with no
covering scenario is ungated by construction (`strangle/gate.ts` already refuses it).

### 3.2 Corpus growth, by family

Per-wave scenario families: per-tool behavior depth (Read truncation/cat-n format, Edit failure
modes, Bash timeout/backgrounding), a hooks matrix (which of the 8 headless-live events fire, with
what payloads), permission-mode matrix (6 modes × representative tools), compaction depth
(reactive trigger, microcompact, boundary contents), storage/resume depth (chain integrity, fork
divergence), raw-protocol depth (every control subtype), and moat-tool scenarios (task family,
SendMessage/ListAgents, Workflow, plan/worktree). Recording is live and serialized with backoff
(record-freely posture, user-approved); replay grades forever offline.

### 3.3 Determinism hardening (rides wave 1)

Pin the feature-gate client-data blob: snapshot the blob the pinned engine actually uses into
`reforge/config`, assert stability at record time the same way the leak check runs, and document it
as part of the pin (a pin bump re-snapshots). Today's green replays silently depend on whatever
gate values the engine cached; after this, gate values are an explicit input like the pin itself.

### 3.4 Gate cost honesty

The gate is O(splices) builds. Builds are ~2 s and replays are offline-fast; this is fine into the
dozens. If gate runtime strains at ~50 splices, batch liveness checks *within* the two-phase
discipline (group splices whose coverage sets are disjoint into one sabotage build each) — never
around it.

## 4. Orchestration — how the fleet runs

The session owner stays orchestrator; workers execute. Roles:

- **Anchor scouts** (opus): verify a target's anchor uniqueness against the whole graph, extract
  the method body + closure surface, propose the manifest row and `deriveArgs` regexes.
- **Scenario authors** (opus): write the scenario + substance check; the orchestrator serializes
  the live recording step.
- **Splice implementers** (opus): readable behavior-faithful rewrite (user-approved posture:
  extraction is reference, product is clean maintainable code) + sabotage twin + manifest row.
  S-module work (storage, query loop, sandbox interface design) goes to **fable-tier** workers.
- **Independent review**: codex-companion adversarial review at wave boundaries per the standing
  review instructions; verified findings are fixed by a dispatched fix wave, minor-but-real
  findings go to `docs/tech-debt-tracker.md`.

Parallelism rules: implementers run parallel on disjoint modules; **gate runs and cassette
recordings serialize through the orchestrator** (shared `build/` directory; subscription rate
limits). Every wave ends: gate PASS → scorecard ratchet (§5) → one commit per gated wave.

## 5. Progress metric — the ownership ratchet

`reforge/README.md` gains a per-subsystem scorecard: owned bytes (minified, measured from the
excised regions) over the ~5–6 MB load-bearing denominator, plus per-subsystem state
(unowned / partially spliced / owned / assembled-into-engine-ts). `docs/parity/coverage.md` links to
it rather than duplicating. The metric only ever ratchets up; a pin bump that breaks a splice
blocks the bump until re-anchored, it does not un-own the module.

## 6. Wave sequence (the decomposition input)

Ordered by seam quality within the user's stated priorities (prompt+context, tool layer,
permissions+hooks first; moat completeness as the bar). `doperpowers:decomposing` formalizes this
into the goal tree; waves are the natural children.

| Wave | Scope | Mechanism | New corpus families |
|---|---|---|---|
| W1 | Remaining tool-result formatters (Read, Edit, Bash, Grep, task family) + feature-gate blob pinning | S-method | per-tool result depth |
| W2 | Tool-description chunks ×4 | **S-chunk debut** | description-drift scenario (descriptions appear in request `tools` array — already diffed) |
| W3 | Environment block + system-prompt assembly | S-method | prompt-assembly scenarios (settingSources, CLAUDE.md injection) |
| W4 | Compaction: prompt, boundary emit, trigger policy | S-method | compaction depth |
| W5 | Hook dispatch | S-method | hooks matrix |
| W6 | Permission decisions + rule matching/parsing chunks | S-method + S-chunk | permission-mode matrix |
| W7 | Control-protocol switch | S-method | raw-protocol depth |
| W8 | Moat tools: task family, SendMessage/ListAgents, Workflow, ScheduleWakeup, plan/worktree | scenario-led (probe reachability per tool first) | moat scenarios |
| W9 | Session/transcript storage | **S-module debut** (fable) | storage/resume depth |
| W10 | Bash executor + command-safety AST | S-method → S-module | bash depth |
| W11 | Query loop / turn driver | S-module (fable) | fault-injection depth (already exists, widened) |
| W12 | engine-ts assembly spike | assembly | full surface, engine-ts as engineB |

Waves are ordered but not strictly serial: scenario authoring for wave N+1 overlaps implementation
of wave N (coverage leads).

## Acceptance (behavior-phrased)

- **Per wave:** every new splice sabotaged alone turns its own covering scenarios RED; the faithful
  build is GREEN on the full acceptance surface (`m2/all.ts`); the scorecard row moves; the wave is
  one commit with gate output quoted in the message.
- **W1 hardening:** a gate-blob snapshot exists under `reforge/config`, record-time asserts its
  stability, and `src/pin.ts`'s bump ritual documents re-snapshotting.
- **S-chunk debut (W2):** a replaced description chunk passes the gate with export names derived
  per build (test: perturbing a derived name fails the build loudly, never silently).
- **Campaign:** `engines/engine-ts` boots, and passes the full acceptance surface as `engineB`
  with the substrate absent from its process (verifiable: no `build/graph` read at runtime).
- **Standing:** ownership % never decreases; no splice exists without coverage; the differ's
  normalization spec grows only with written justification (existing doctrine).

## Delegated unknowns (empirical residue — named, not hidden)

- Per-tool headless execution reachability for the moat tools (catalog presence is proven; execution
  is probed scenario-first in W8 — some may be catalog-only headlessly, e.g. CronCreate probed dead
  in earlier SDK research).
- S-chunk export-surface derivation mechanics (settled by W2 implementation contact).
- Where the pinned engine caches/reads the client-data gate blob (settled by a W1 probe before the
  snapshot design).
- Gate runtime at ~50 splices (watch, then batch per §3.4 if needed).
- The S-module interface designs (storage, query loop, sandbox) — each is its own design pass at
  its wave, fable-tier, with this spec as parent.

## Decision Log

- **Endpoint: ratchet → engine-ts** (user-confirmed). Rejected: maximal-strangle-only (ownership
  stays hosted in upstream's bundle); straight-to-engine-ts big-bang (abandons the proven
  per-module gate discipline).
- **Rewrite posture: readable behavior-faithful rewrite** (user-confirmed). Rejected:
  transcription-tolerant (hosts code we can't confidently modify — ownership in name only);
  behavior-only clean room (slower, gate-failure-prone, unnecessary under the internal-research
  posture already recorded in `CC-to-SDK/CLAUDE.md`).
- **Recording posture: record freely, serialized with backoff** (user-confirmed). Rejected:
  per-wave caps and ask-before-each-batch (block autonomous waves for no economic reason — replay
  is free forever after).
- **Ordering: seam quality within user priorities; completeness moat is the bar** (user-directed).
  Glob/Grep deprioritized as deprecated upstream (user-supplied fact).
- **Feature gates: own the resolver, pin the blob.** Rejected: splicing call sites (862 of them —
  no seam); ignoring gates (leaves today's replays dependent on an unpinned server-supplied input).
- **Topology: inside-out strangling with a granularity ladder.** Rejected: outside-in (own the
  process shell first, delegate inward) — the control-protocol switch already has a high-quality
  seam inside the chunk, so outside-in buys nothing the ladder doesn't and forfeits the proven
  gate.
- **Metric: per-subsystem scorecard in `reforge/README.md`**, linked from coverage.md. Rejected:
  a new standalone tracker doc (one more thing to rot).
- **Spec location: `docs/superpowers/specs/`** per project convention, overriding the skill
  default path.

## Surprises & Discoveries

- **The engine is concentrated**: one 4.0 MB chunk with zero JSX imports is the whole agent; the
  load-bearing target is ~5–6 MB, not 39.5 MB (census headline).
- **The moat traverses the seam**: 31 native tools presented headlessly at 2.1.251, including
  SendMessage/ListAgents/Workflow/ScheduleWakeup — measured from cassette request bodies, so the
  completeness bar is differentially gradable.
- **Statsig is not bundled in 2.1.251** — only a cache-directory literal; gates resolve from a
  server-delivered client-data blob, which is what makes §3.3's pinning necessary and sufficient.
- **Tool descriptions live in dedicated tiny chunks** — whole-chunk ownership for trivial cost, the
  cheapest wins on the board and the natural S-chunk debut.

## Outcomes & Retrospective

Pending — written at finish.

## Revision Notes

- 2026-08-31: initial version, approved in-session after a census-grounded design pass.
