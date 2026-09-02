# Reforge-full campaign — ratchet the extracted engine into owned TypeScript until engine-ts assembles

**Status:** approved 2026-08-31; revised through 5 adversarial review rounds (converged — see
Revision Notes); **composite spec** as of the same day — the roadmap cut lives in
"## Roadmap — the cut" below, per `doperpowers:decomposing` (design up top, roadmap below, one
document) · **Parent:** root — the north star in `CC-to-SDK/CLAUDE.md` ("A fully ownable, fully
customizable harness of Claude Code quality"), reforge lane · **Level name:** Campaign; children
are **Waves**
**Grounding:** `reforge/research/2026-08-31-engine-census.md` (subsystem census of the 2.1.251
bundle, incl. its 2026-08-31 correction) · `reforge/research/2026-08-31-gate-blob-resolution.md`
(how gates actually resolve offline) · `reforge/README.md` (harness + gate doctrine) · cassette
measurement of the headless tool catalog (31 native tools, §1.3) · measured runtime skew (§3.5)
· `docs/lectures/claude-code-harness/research/` (2026-09-01, a parallel session's 13 reports +
17-chapter lecture mined from the same 2.1.251 bundle — secondary reference for wave briefs:
bash/sandbox→W10, orchestration→W12, permissions/hooks→W5–W6, MCP→W11, persistence→W9, service
layer→W13; cross-check against the census and probes before relying on any claim)

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
modes, the task-tool family. The campaign's contract is **the full headless client contract**
(stream-json protocol, query/session semantics, tools, permissions, hooks, resume/fork,
compaction, subagents/tasks, retries/errors) — the full functionality of the Claude binary minus
only what is irreplicably server-side or explicitly excluded (§1.2). What reforge removes is not
reimplementation work itself but its catastrophic shape: the big-bang risk, the unusable interim,
the un-attributable wrongness. Reimplementation cost is split into small units, each instantly
verifiable against the original oracle.

Under the strategy already written into the north star, **"customize X" and "own X" are the same
act: splice X**. Every wave of this campaign is therefore both a reimplementation increment and a
customizability increment — ownership pays rent continuously, not at the end. §2.5 keeps that
promise honest once customization actually begins.

## 1. Target inventory

### 1.1 In scope (the load-bearing set, ~5–6 MB minified)

From the census: the engine is concentrated, not spread. One chunk — `chunk-fy12d89p.js`, 4.0 MB,
zero JSX imports — holds essentially the whole agent; satellites add a few hundred KB each.

| Subsystem | Census seam quality | Where |
|---|---|---|
| Tool result formatters + validators (Read, Edit, Bash, Grep, task family…) | very high (proven family) | `fy12d89p` |
| Tool-description functions (Read, Glob, Grep, WebFetch) + their satellite chunks' other exports | high — but the chunks are multi-export grab-bags, NOT single-function seams (census correction) | `hx5r9amq` (15 exports), `y30v0ja7` (3), `hdmehzg7` (17), `qe0j59w7` (4) |
| Environment block + system-prompt assembly | high (env block is one 12-line fn) | `fy12d89p` @336–350, @85.3k |
| Compaction: summarization prompt, `compact_boundary` emit, trigger policy (reactive + microcompact) | high | `fy12d89p` @45–48k, @70k, @76.3k |
| Hook dispatch + hooks chunks | high (event names are unique literals) — **corrected 2026-09-01: dispatchers are `async function*` free functions in the engine chunk; the satellite "hooks chunks" are shared-constant/barrel chunks, not owned units** | `fy12d89p` @30–33k, @70–74k (scout: `…w5-w7-anchor-scout.md`) |
| Permission decisions + rule matching/parsing | high (decision fns return plain objects) — **corrected 2026-09-01: `hw8qz4q5` is the PowerShell tool (W10), not permissions; `8c6qx8qp` is a 500-consumer constants chunk; the chain lives in the engine chunk, pure S-method** | `fy12d89p` @30–37k |
| Control-protocol switch (`control_request`/`control_response` subtypes) | high (one `switch` with literal cases) | `fy12d89p` @38.7k + `mfkbzdqf`, `kje2nmp8` |
| Moat tools: `SendMessage`/`ListAgents`, `Workflow`, `ScheduleWakeup`, TaskCreate family, `Skill`, plan/worktree tools | per-tool (scenario-led) | `fy12d89p` various |
| Session/transcript storage; resume/fork | module-level (Result-monad fs layer) | `d78hxkfm`, `trstwd25`, `fy12d89p` @4–10k |
| Bash executor (exec/timeout/background) + command-safety AST | high (ES class) / medium | `fy12d89p` @2.9k, @100–105k; `w7bq1qyb` |
| MCP adapter (thin layer over the vendored MCP SDK) | high | `4mp04j81`, `1bxday80` |
| Slash commands + skills loading | high | `fy12d89p` @10–12.5k + `g461tywa` |
| Agent/Task subagent dispatch | medium (nested loop reentry) | `fy12d89p` @55–58k, `bf5vvscj` |
| Query loop / turn driver (retry, 529, model fallback, compaction driver) | module-level (long async generator) | `fy12d89p` @75–80k |
| Sandboxing (platform launchers behind an interface) | module-level (CEL/protobuf tangle) | `q4xe0m2r` |

**The closure ledger.** The decomposition (step after this spec) materializes this table as a
machine-checkable ledger: every in-scope subsystem row and every headless tool maps to an
implementation wave, its owned artifact(s), its covering scenario families, its outstanding
dependency edges (typed ports into not-yet-owned subsystems, §2.4), and an ownership state
(`unowned / spliced / standalone-complete / assembled`, plus `stale` after pin-bump invalidation,
§5). The engine-ts assembly wave is **blocked while any row is unmapped** — a row leaves the
ledger only by shipping or by moving to §1.2 with evidence. The ledger is the campaign's primary
progress metric (§5).

### 1.2 Exclusion ledger (recorded, not implied)

| Excluded | Size | Reason |
|---|---|---|
| TUI / Ink / React (288 JSX-importing chunks) | 6.8 MB | never traverses the headless seam the harness grades through |
| Vendored libraries | ~7.2 MB | engine-ts imports the real npm packages at assembly (`@anthropic-ai/sdk`, MCP SDK, zod, ajv, picomatch, highlight.js…) |
| Peripheral cloud features (teleport, cowork/teammates, self-hosted runner, bridge, computer-use, chrome bridge, artifacts, marketplace) | ~3.0 MB | product periphery, mostly server-coupled |
| Server boundary: WebSearch execution, `count_tokens`, OAuth endpoints, OTLP ingest, update manifests | — | server-side; the engine only formats/calls them. Client-side *formatting/policy* over these stays in scope (e.g. WebSearch result formatting, retry policy over 529s) |
| Updater, install/auth UX, enterprise host integrations, IDE-proprietary integrations | — | outside the headless client contract this campaign targets |
| Glob/Grep beyond the existing splices | — | deprecated surface upstream; no further investment |

**Feature gates are neither spliced nor excluded** — see §3.3 (the resolver is GrowthBook and
reforge pins the disabled state explicitly, snapshots the call-site defaults, and locks the
gate-relevant environment).

### 1.3 The headless tool catalog is the moat's reachability proof

Measured from recorded cassette request bodies (2.1.251, SDK transport): the engine presents **31
native tools headlessly** — Agent, AskUserQuestion, Bash, CronCreate/Delete/List, Edit,
EnterPlanMode/ExitPlanMode, EnterWorktree/ExitWorktree, Glob, Grep, ListAgents, NotebookEdit, Read,
RemoteTrigger, ReportFindings, ScheduleWakeup, SendMessage, Skill, TaskCreate/Get/List/Output/Stop/
Update, WebFetch, WebSearch, Workflow, Write. Presence in the tools array proves the *catalog*
traverses the seam; per-tool *execution* reachability headlessly is a delegated unknown probed
scenario-first per tool (§6). Every catalog tool gets a closure-ledger row: owned execution, or an
evidence-backed exclusion.

## 2. The granularity ladder — three splice mechanisms, dual-wired from the start

### 2.1 S-method — generalize the proven transform to four target shapes

The proven mechanism: locate by true-substring-unique string anchor, excise the balanced-brace
body, delegate to `globalThis.__reforge`, re-derive closure identifiers from the matched body per
build (`deriveArgs`). It survived ten versions and a bundler rewrite with zero re-anchoring.

**But the current builder handles exactly one syntactic shape** — a sibling method named
`mapToolResultToToolResultBlockParam` (`strangle/manifest.ts` hardcodes `METHOD`; the builder
searches backward from the anchor for that name). The subsystems this campaign assigns to S-method
are different shapes: free functions (env block, formatters not on that method), `switch` cases
(control protocol), class methods (Bash executor), dispatch sites (hooks). **The manifest therefore
gains a `target` shape per splice** — `sibling-method | free-function | class-method | switch-case`
— each with its own excision transform. Transforms stay literal-anchored (that is the versioning
bet that has paid off), but body identification moves from name-search + balanced braces to an AST
walk of the owning chunk (parse the chunk, find the anchor's enclosing function/case node, excise
its exact span): minified chunks are plain ES modules, and an AST span is exact where a regex
heuristic silently truncates. Feasibility measured: the TypeScript parser handles the 4.0 MB engine
chunk in ~0.6 s with zero parse diagnostics (16,318 function-like nodes). Each new shape ships
behind a **mechanism spike** (W0): a trivial target excised, boot-checked, sabotaged RED, restored
GREEN, and its derivation perturbed to prove loud failure — before any wave that depends on that
shape is scheduled.

**The anchor budget.** Anchor survival is per-splice-per-release; even at 99.5% survival, 500
method anchors mean some break in the normal case (0.995⁵⁰⁰ ≈ 8% all-survive). Method splices are
therefore a *transitional* state, not an accumulation target: the ladder's later tiers exist
partly to keep total anchor count bounded — an S-module absorbs many method splices into one
interface seam. The ledger tracks live anchor count; a wave that would push it past ~50 without a
consolidation plan gets flagged at review. Non-prose STRUCTURAL anchors — property-name fragments
and operator sequences, admitted when a target emits no prose of its own — are admissible but
measurably weaker per pin than prose: C6's two (`?.isNonInteractive`, `].filter(Boolean)}`) are
unique today only because the chunk split scoped them per file, and occur 17× and 2× in the
single-file payloads of three of the four prior pins, so each would have needed a `coLiteral` scope
or a different target there; the failure mode is loud availability churn at the next bump rather
than a silent mis-splice, and re-anchoring them is the expected cost of using them, not a defect.

### 2.2 S-chunk — whole-chunk ownership, priced honestly

Replace an entire chunk file with a reforge-owned module exporting the same surface. The ESM
packaging change made chunks importable seams — but the census's "each exports one description
function" was **wrong** (corrected 2026-08-31): the four description chunks export 15/3/17/4
symbols and import 2/3/10/4 other chunks, carrying real behavior (Read page-range parsing, Grep
defer policy, WebFetch cache-TTL/prompt construction — and `q6t`, the Write freshness suffix our
first splice derives). So S-chunk's price is the whole export surface:

- **Precondition: an export-and-consumer inventory** — every export, every importer, top-level
  side effects, live-binding requirements — committed as part of the wave's design.
- **Acceptance per export**: behavioral coverage + sabotage evidence for every retained export,
  not just the headline function. Export names are minified and churn per version, so the build
  derives them from the original chunk's export statement each build; perturbing a derived name
  must fail the build loudly.
- Where an inventory reveals a chunk too entangled to own whole, the wave falls back to S-method
  splices of the individual functions — ownership narrows rather than overclaims.

Debut target: `y30v0ja7` (3 exports, 1.4 KB) — the smallest surface that exercises the whole
mechanism.

### 2.3 S-module — design-first reimplementation behind typed ports

For the census's tangled list — session storage, sandboxing, the query loop — reimplement behind an
explicitly designed **typed port interface** and swap at the module boundary. The port catalog the
S-module waves converge on (names indicative): `ToolRuntimePort` (execute a tool call in context),
`PermissionPort` (decide a permission request), `SessionPort` (load/append session state),
`ModelTransportPort` (stream a model request). Ports are how stateful cores are owned without
pretending they are pure functions: object identity, caches, abort controllers, event emitters,
pending permission promises, and child-process registries live behind the port, with lifecycle
documented in the port contract. S-module work is design-first, not transcription-first, gets
fable-tier implementers (§4), and carries the deepest verification obligations (§3.1).

### 2.4 Dual-wiring — the skeleton starts in W0; ownership hygiene; the inversion milestone

Round-1 review exposed a dependency-direction flaw in the original "assembly is a closure event"
framing: spliced modules *receive* closure values from the extracted graph (`freshnessSuffix`,
`truncationNotice`), so every owned module was secretly substrate-dependent, and the final wave
would have degenerated into the big-bang rewrite this design exists to avoid. Corrected
architecture:

- **Every owned module is standalone-complete**: it owns its constants and helper closures
  outright, in readable TS. **Ownership hygiene rule: no minified identifier crosses into owned
  code.** What crosses the adapter boundary is data and typed ports, never the graph's symbols.
- **The strangled graph gets a thin adapter** per splice. What the adapter does with a
  graph-supplied capture depends on its class — round 2 showed one blanket equality assertion is
  wrong for functions. The **closure-capture taxonomy**, declared per splice in the manifest:
  - `primitive` (strings, numbers, frozen config): the adapter equality-asserts the graph's value
    against the module's owned value — every delegation is a free micro-differential check, and an
    upstream constant change fails loudly at the adapter.
  - `pure-helper` (e.g. the Glob truncation-notice function): the owned module ships its own
    implementation and **uses it in both wirings**; the graph's function is not called and not
    compared by identity. Drift is caught by the differential surfaces the helper's output flows
    into, plus a small contract test over partitioned inputs where the helper's domain is wider
    than the corpus exercises.
  - `effectful/stateful`: the capture becomes an explicit typed port (§2.3); the dependency is
    recorded as a ledger edge to the subsystem that owns it, and sabotage coverage exercises the
    port. Ownership of the port's far side belongs to that subsystem's wave.
- **The engine-ts skeleton exists from W0**: a stream-json protocol shell + module registry that
  boots, reports its owned-module set, and fails gracefully on everything unowned. Each wave
  registers its standalone-complete modules into the skeleton as well as splicing the graph.
- **Closure is machine-checked continuously**: static reachability over the skeleton proves no
  extracted-chunk import in the standalone set; hermetic execution (§3.6) proves it at runtime.
- **The inversion milestone.** Mid-campaign, primacy flips: from "extracted engine with owned
  islands" to "**owned engine-ts with extracted compatibility islands**" — engine-ts runs the
  protocol shell and query loop, delegating only not-yet-owned subsystems back to extracted
  modules behind ports. The flip is ledger-triggered (when the owned set can carry the shell +
  loop end-to-end, expected around W13) and is what makes the extracted code's disappearance an
  observable trend rather than a final-wave event.

### 2.5 Parity and customization are separate lanes

The campaign's product promise is *different* behavior on demand; the gate's promise is *identical*
behavior. Conflating them would make the first real customization indistinguishable from a bug.
Per owned module, three layers: `reference` (the parity implementation the gate grades),
`custom` (deliberate deviations, applied over reference), `sabotage` (the liveness twin). Two
gates: the **parity gate** (oracle ↔ owned reference — must be identical; this is the campaign
gate) and, once the first customization lands, the **custom-delta gate** (reference ↔ customized
build — only deltas declared in an allowed-deltas manifest may appear; everything else must remain
equal). Module layout anticipates this from W1; the delta-manifest machinery ships with the first
real customization, not speculatively.

## 3. Verification doctrine (extended, never weakened)

### 3.1 What green means, said honestly

A faithful GREEN is **corpus equivalence**: equality of normalized behavior on the recorded
acceptance surface. It is strong evidence, not proof, of behavioral equivalence; the campaign
widens the corpus so the gap shrinks per wave, and names the gap instead of rounding it up.
Coverage leads: no splice lands without covering scenarios; the two-phase gate (each splice
sabotaged **alone** turns its own covering scenarios RED; the faithful build stays GREEN on the
full surface) is unchanged and both halves stay mandatory. Substance checks run against **both**
engines (harness fixed 2026-08-31, commit `98d9553d`, with a negative control; round 2 then
hardened the `background-task` check's ID-correlation (commit `908275d0`, eight negative
controls) — `substanceOnly` checks require nonempty, cross-correlated identifiers and carry
malformed-input negative controls, since they are the only thing grading engine B on those
scenarios).

Verification depth scales with mechanism tier:

- **S-method**: covering scenarios + solo sabotage + derivation-perturbation loudness.
- **S-chunk**: the above per retained export (§2.2), plus **coverage attestation**: the strangled
  build is AST-instrumented to record that covering scenarios actually execute the owned code's
  major branches — "a scenario exists" and "the scenario covers the code" are different claims.
- **S-module**: all of the above **plus a behavioral-partition matrix defined in that wave's
  design pass** — mandatory input partitions and error paths per subsystem; dirty/pre-existing
  filesystem states for storage; controlled retry/interleaving schedules for the query loop;
  long-horizon randomized session traces replayed differentially; and a **bounded mutation
  battery** (auto-generated mutants per module: swallowed errors, dropped side effects, reordered
  events, duplicated emissions, ignored cancellation, wrong ID propagation, missing persistence —
  the covering suite must kill them; one sabotage twin only proves one output is watched).
- **Engine-ts acceptance additionally requires**: the **synthetic response corpus** (§3.2) and the
  **state-surface diff** (§3.2), and strict replay matching (§3.4).

**Non-vacuity contracts (round 3).** Every verification mechanism above must ship with a
machine-checkable non-vacuity contract before it may gate anything — a gate whose emptiness passes
is this project's canonical failure. Full schemas are written at each mechanism's owning wave, but
the binding minimums are fixed now:

- **Coverage attestation**: a *complete* branch inventory of the owned code (generated from its
  AST, not hand-picked), with exclusions listed and reviewed — "major branches" is not a category.
- **Mutation battery**: reports generated/killed/survived/unexecuted/equivalent counts;
  **zero generated mutants fails**; a surviving mutant fails by default and passes only with
  written adjudication.
- **Synthetic corpus**: the §3.2 case matrix is the mandatory minimum, seeds are deterministic,
  and every case carries an explicit oracle expectation; an empty or token case set fails.
- **Custom-delta manifest**: deltas are bounded at scenario + surface + path granularity —
  allowlisting an entire subtree is invalid by schema — and each delta ships an adjacent-drift
  negative control (a nearby *undeclared* difference must still fail the custom-delta gate).
- **`substanceOnly` checks**: as the sole engine-B grading on their scenarios, they are full
  contracts — dispatch semantics, lifecycle completion, and identifier correlation, each with
  malformed-input negative controls (the background-task check's two successive hardenings are
  the template and the cautionary tale).

### 3.2 Corpus growth, by family — plus two new surfaces

Per-wave scenario families: per-tool behavior depth (Read truncation/cat-n format, Edit failure
modes, Bash timeout/backgrounding), a hooks matrix (which of the 8 headless-live events fire, with
what payloads), permission-mode matrix (6 modes × representative tools), compaction depth
(reactive trigger, microcompact, boundary contents), storage/resume depth (chain integrity, fork
divergence, dirty-state), raw-protocol depth (every control subtype), and moat-tool scenarios
(task family, SendMessage/ListAgents, Workflow, plan/worktree). Recording is live and serialized
with backoff (record-freely posture, user-approved); replay grades forever offline.

Two surfaces join the doctrine on a staged schedule:

- **Synthetic response corpus** (mandatory from W9; required for W13/W14): a protocol-valid
  SSE/response generator — text-only, single/parallel tools, partial and malformed JSON arguments,
  tool errors, thinking+tool, stop_reason variants, truncated streams, duplicate events,
  retryable/non-retryable errors, subagent responses, compaction-inducing lengths. A recorded
  cassette exercises the one path the model chose that day; the generator verifies the engine's
  state machine against paths the model didn't choose. It generalizes the existing fault-derivation
  harness (`src/faults.ts`).
- **State-surface diff** (fourth diff surface; cheap subset from W1, full from W9): after each
  replayed scenario, diff the sandbox filesystem tree + content hashes, the session/config store,
  leaked child processes/sockets, and exit codes/signals between engines. Transcripts and requests
  agreeing does not preclude a stray process or a divergent session file — cross-resume's store
  diff already proved this surface catches what the others miss.

### 3.3 Gate determinism — pin the disabled state, snapshot the defaults, lock the environment

Empirical grounding (`reforge/research/2026-08-31-gate-blob-resolution.md`): the flag provider in
2.1.251 is **GrowthBook** (the `statsig` literal is a vestigial cache path); both the bootstrap
fetch (`/api/claude_cli/bootstrap`) and the disk-cache read are **already disabled** under
reforge's environment, so every gate resolves to its compiled-in call-site default (431 sites, 379
distinct gates) with `source:"disabled"`. The original "snapshot the blob into `reforge/config`"
plan would have pinned a cache that is never read; replaced by:

- **Pin the disabled state explicitly**: set `DISABLE_GROWTHBOOK=1` in the harness env (the
  narrowest kill-switch) and assert `CLAUDE_CODE_GB_DISK_CACHE_WHEN_TELEMETRY_OFF` stays unset.
- **Lock the child environment** (round 2): reforge currently inherits the full parent env into
  engine subprocesses, and at least one **per-gate env override survives in the public build**
  (`CLAUDE_CODE_LUMINOUS_WHISTLE`, research line 80) — an operator's environment could flip
  oracle behavior. Engine subprocesses get an **allowlisted environment** (the vars the harness
  deliberately sets, plus a minimal platform set); the override inventory is regenerated per pin
  bump; a **negative control** seeds a known override in the parent and proves both engines still
  observe pinned defaults.
- **The allowlist has an explicit credential contract** (round 3 caught the interlock: a literal
  allowlist strands the SDK child's auth in record mode, while broadly admitting `CLAUDE_CODE_*`/
  `ANTHROPIC_*` reopens the override leak). Two schemas: **record-mode** passes exactly one
  deliberately selected credential (OAuth preferred per project policy; the API-key-shadows-OAuth
  precedence is handled by *selection*, not inheritance); **replay-mode** passes a fixed
  non-secret placeholder credential (replays never authenticate). All other Claude/Anthropic
  variables are rejected in both schemas. The W0 test matrix covers OAuth-only, API-key-only,
  both-set, missing-auth, and seeded-gate-override parents.
- **Flip-liveness** (was a delegated unknown; resolved affirmative): the surviving per-gate env
  override enables a test that flips a covered gate inside the allowlist and observes behavior
  change — proving the resolver precedence is what the research says and that the allowlist is
  what actually stands between operator env and engine behavior.
- **Leak-check the config**: after record and replay, assert the GrowthBook/client-data cache keys
  never appear in `reforge/config/.claude.json`.
- **Snapshot the defaults table as a tracked fixture**: extract the 431 call-site (gate → default)
  pairs from the pinned bundle into a committed, `ENGINE_VERSION`-keyed fixture; a pin bump
  regenerates it and the diff is reviewed (§5). This table is also the engine-ts deliverable:
  engine-ts implements gates as this constant table.

### 3.4 Replay strictness (tightened round 3: strict from the first candidate wave, not W14)

Round 3's objection to "strict only at engine-ts acceptance" is correct: `engine-strangled` is a
genuinely different build from W1 onward, and a positional fallback (serve-in-order when the body
hash misses) can hand a drifted request the "right" response through thirteen waves — including
the inversion milestone — before strictness finally bites. So:

- **W0 acceptance includes zero positional fallbacks across the whole corpus** (achieved by the
  proxy/differ normalization-sharing pass — the known run-scoped-prose misses are exactly what it
  canonicalizes). This supersedes the 2026-08-31 tech-debt deferral outright.
- **From W1, a fallback is a gate FAILURE for any `engineB` that is not `engine-extracted`** —
  every strangled and engine-ts run grades strictly.
- Warning-only behavior survives **solely** in the real-vs-extracted identical-code self-test,
  where it is a harness diagnostic rather than an equivalence claim.

Every normalization/scrub rule continues to require written justification, and each value-level
scrub carries a regression test (a scrub named `*_ms` must never eat a configured timeout that is
a real contract).

### 3.5 Runtime pinning (measured skew)

The binary embeds **Bun 1.4.1**; the external Bun running `engine-extracted`/`engine-strangled` is
**1.3.14** — a version behind, today. The gate is green despite the skew, but "extracted equals
real" claims must not silently ride on runtime luck: `prepare.ts` asserts the external Bun's
version equals the version string extracted from the pinned binary, the pinned Bun is recorded in
`src/pin.ts`, and the pin-bump ritual includes matching the embedded runtime. Residual differences
that no external Bun can close (`process.execPath`, standalone-executable detection, embedded-VFS
semantics) are documented per occurrence if a scenario ever surfaces one.

### 3.6 Hermetic ownership gate (round 2; strengthened round 3)

"No extracted import + corpus green" can be satisfied by an engine-ts that *spawns* the real
binary or dynamically loads extracted artifacts — a delegating wrapper owning nothing. Round 3
added that env-absence + child tracing is not isolation either: the artifacts sit at well-known
host paths, and an engine can `read + eval` extracted code **in-process**, producing no traced
child at all, or reach it through a shell trampoline under an allowlisted Bash workload.

The ownership gate is therefore **OS-enforced hermetic**: engine-ts runs inside an isolation
boundary in which the real binary, the extraction bundle, `build/`, and every other engine wrapper
are **genuinely unreadable and unexecutable** (deny-by-default filesystem policy — e.g. a
sandbox-exec profile or an environment where those paths do not exist — not merely unset env
vars), with `exec` *and* file-open/import activity audited across the whole descendant tree.
**Negative controls ship with the gate, one per delegation route**: direct exec of the real
binary, a shell trampoline via a workload child, a dynamic `import()` of an extracted chunk, and
read-plus-eval of extracted source — each must FAIL the gate. Bash scenarios still spawn user
commands; the isolation policy (not an env allowlist) is what distinguishes workload children from
reference-artifact access. The isolation substrate is built at the inversion milestone (W13) —
the first point an engine-ts-primary artifact exists to gate — and hardens into the W14
acceptance.

### 3.7 Gate cost honesty

The gate is O(splices) builds. Builds are ~2 s and replays are offline-fast; this is fine into the
dozens. If gate runtime strains at ~50 splices, batch liveness checks *within* the two-phase
discipline (group splices whose coverage sets are disjoint into one sabotage build each) — never
around it. The anchor budget (§2.1) works the same pressure from the other side.

## 4. Orchestration — how the fleet runs

The session owner stays orchestrator; workers execute. Roles:

- **Anchor scouts** (opus): verify a target's anchor uniqueness against the whole graph, extract
  the target node + closure surface, classify each capture per the taxonomy (§2.4), propose the
  manifest row (incl. `target` shape) and derivation regexes; for S-chunk, produce the
  export-and-consumer inventory.
- **Scenario authors** (opus): write the scenario + substance check (which must hold for any
  equivalent engine and carry negative controls when `substanceOnly`); the orchestrator serializes
  the live recording step.
- **Splice implementers** (opus): readable behavior-faithful rewrite (user-approved posture:
  extraction is reference, product is clean maintainable code), standalone-complete + adapter per
  §2.4, reference/custom/sabotage layout per §2.5, manifest row. S-module work (storage, query
  loop, sandbox, ports design) goes to **fable-tier** workers with a design pass before code.
- **Independent review**: codex-companion adversarial review at wave boundaries per the standing
  review instructions; verified findings are fixed by a dispatched fix wave, minor-but-real
  findings go to `docs/tech-debt-tracker.md`.

Parallelism rules: implementers run parallel on disjoint modules; **gate runs and cassette
recordings serialize through the orchestrator** (shared `build/` directory; subscription rate
limits). Every wave ends: gate PASS → ledger + scorecard update (§5) → one commit per gated wave.

## 5. Progress metric — the closure ledger, with bytes as color

Primary: the **closure ledger** (§1.1) — per subsystem and per catalog tool, the ownership state
(`unowned / spliced / standalone-complete / assembled / stale`), dependency edges, and evidence
links. Secondary, informational only: owned minified bytes over the load-bearing denominator.

**Pin bumps invalidate semantically, not just numerically** (round 2; footprint-mapped after
round 3): regenerating the `tengu_*` map and size buckets cannot see a new branch or changed
protocol case inside an owned subsystem — and export/target inventories alone cannot see a body
change *inside* an owned S-module whose upstream counterpart changed internally (retry ordering in
the query loop can change with identical exports). Each owned ledger row therefore records its
**upstream implementation footprint**: the chunk(s) and AST-node spans it replaces, content-hashed
at splice time. Each bump runs the semantic inventories — per-owned-chunk import/export diff,
tool-catalog diff (fresh bundle scan), AST diff of every splice target + closure surface,
**footprint hash diff for every owned row**, gate-defaults fixture diff, control-protocol subtype
inventory diff — and **any diff touching an owned row flips it to `stale`**, requiring
adjudication (and new coverage if behavior changed) before it returns to
`standalone-complete`/`assembled`. Where footprint attribution is imprecise, the rule is
conservative: every owned row mapped to a changed chunk goes `stale`. A **bump negative control**
proves the mechanism: an internal branch change with unchanged exports must stale its row. A pin
bump that breaks a splice blocks the bump until re-anchored. Newly shipped upstream subsystems
enter as new `unowned` rows.

**Upstream inheritance decays by design**: while the extracted graph is primary, unowned code
inherits upstream improvements for free; each owned subsystem converts future upstream changes
into observed oracle deltas to port selectively. The ledger makes that cost visible per bump. At
full ownership the standing question — track upstream as a clone, or diverge as a product —
becomes the user's product decision; this campaign keeps both open by keeping the differential
harness and the pin ritual alive.

`reforge/README.md` hosts the scorecard; `docs/parity/coverage.md` links to it.

## 6. Wave sequence (the decomposition input)

Ordered by seam quality within the user's stated priorities (prompt+context, tool layer,
permissions+hooks first; moat completeness as the bar). `doperpowers:decomposing` formalizes this
into the goal tree; waves are the natural children. Waves overlap where mechanisms allow (scenario
authoring for N+1 during implementation of N; W1 runs on the proven shape while W0 builds the new
ones).

| Wave | Scope | Mechanism | New corpus families / gates |
|---|---|---|---|
| W0 | **Mechanism foundation**: manifest `target` shapes + AST-span excision, one spike per shape gated end-to-end; **engine-ts skeleton** (stream-json shell + module registry + static-reachability check); **determinism hardening**: §3.3 env allowlist + credential schemas + kill-switch + defaults fixture + flip-liveness + negative controls, §3.5 Bun pin; **§3.4 strict replay delivered** (proxy/differ normalization sharing; zero fallbacks corpus-wide) | infrastructure | spike gates; skeleton boot; env + credential matrix; runtime version assert; zero-fallback corpus |
| W1 | Remaining tool-result formatters (Read, Edit, Bash, Grep, task family); retrofit existing 3 splices to standalone-complete + taxonomy-classified adapters + reference/custom/sabotage layout; cheap state-surface diff (fs tree + exit codes) | S-method (proven shape) | per-tool result depth |
| W2 | Tool-description functions (generalized S-method); S-chunk pilot on `y30v0ja7` (3 exports) with full export inventory; coverage attestation debuts | S-method + **S-chunk debut** | per-export coverage; derivation-perturbation |
| W3 | Environment block + system-prompt assembly | S-method (free-function shape) | prompt-assembly scenarios (settingSources, CLAUDE.md injection) |
| W4 | Compaction: prompt, boundary emit, trigger policy | S-method | compaction depth |
| W5 | Hook dispatch | S-method | hooks matrix |
| W6 | Permission decisions + rule matching/parsing chunks (`hw8qz4q5`, `8c6qx8qp` with inventories) | S-method + S-chunk | permission-mode matrix |
| W7 | Control-protocol switch | S-method (switch-case shape) | raw-protocol depth |
| W8 | Moat tools: task family, SendMessage/ListAgents, Workflow, ScheduleWakeup, plan/worktree | scenario-led (probe reachability per tool first) | moat scenarios; ledger rows per catalog tool |
| W9 | Session/transcript storage (`SessionPort`) | **S-module debut** (fable) | storage/resume depth + dirty-state matrix; synthetic corpus + full state-surface diff come online |
| W10 | Bash executor + command-safety AST | S-method (class-method shape) → S-module | bash depth |
| W11 | MCP adapter + slash commands + skills loading | S-method/S-chunk | mcp/skills scenario families |
| W12 | Agent/subagent dispatch + sandbox interface (`ToolRuntimePort` boundary) | S-module (fable) | subagent depth; sandbox matrix; mutation battery |
| W13 | Query loop / turn driver (`ModelTransportPort`); **inversion milestone** — engine-ts becomes primary with extracted compatibility islands; **hermetic isolation substrate built** (§3.6) | S-module (fable) | controlled retry/interleaving + long-horizon traces; synthetic corpus required |
| W14 | engine-ts closure: **OS-enforced hermetic** ownership gate (§3.6) with all four delegation-route negative controls; static reachability; full acceptance surface with engine-ts as engineB under strict replay | assembly (measured closure) | ledger complete or evidence-backed exclusions only |

## Roadmap — the cut (2026-08-31)

The campaign fails the ownability gate (no single agent context can own fifteen waves), so it
divides along §6's wave seams. Per the frontier discipline, **binding detail concentrates on the
children nearest execution** (the W0 trio and W1/W2); distant waves stay deliberately coarse —
purpose, acceptance, and edges from §6's table, with their precise cuts made at dispatch. Every
child spec opens by citing this document (path + child id). §6's wave table remains the design
view; the sections below are the commitment view.

### Grounding baseline (measured this session)

3 splices owned (leaf formatters, 1 anchor each; 805 minified chars excised); corpus 22
scenarios + 5 acceptance suites, all green at pin 2.1.251; strangler gate PASS; 3 live anchors;
positional fallbacks: 9 across 3 corpus scenarios plus 3 on `background-task` (the §3.4 W0
target is zero); Bun skew 1.3.14 external vs 1.4.1 embedded; load-bearing denominator ~5–6 MB
minified; headless tool catalog 31; `substanceOnly` contract hardened through 5 commits with 24
negative-control assertions.

### Children

Waves W3–W14 map to C6–C17; the W0 foundation divides into three parallel children (different
deliverable types, verification strategies, and no shared files — the split signals), and W1/W2
follow as C4/C5.

#### C1: Splice mechanics (W0a) — autonomous
- **Purpose:** generalize the splice transform: manifest `target` shapes
  (`sibling-method | free-function | class-method | switch-case`), AST-span excision (§2.1),
  capture-taxonomy fields (§2.4), per-splice upstream-footprint hash emission (§5); one mechanism
  spike per new shape.
- **Acceptance:** the W0 spike bullets in "## Acceptance" — each shape: excise → boot →
  solo-sabotage RED → faithful GREEN → derivation-perturbation fails loudly, on a trivial target;
  manifest schema documented in `strangle/manifest.ts`; builds emit footprint hashes.
- **Edges:** blocked-by: —; blocks: C4, C5, and every splice-bearing wave.
- **Contracts:** owns X3, X4; participates X1, X5.
- **Design inheritance:** §2.1, §2.4 taxonomy **[binding]**; AST tooling choice (TypeScript
  parser, measured 0.6 s) advisory.
- **Required.** Status: not-dispatched (dispatchable now).

#### C2: Skeleton & closure ledger (W0b) — autonomous
- **Purpose:** the engine-ts skeleton (stream-json shell + module registry + static-reachability
  check, §2.4) and the closure-ledger artifact (§1.1): machine-checkable rows for every in-scope
  subsystem and all 31 catalog tools, with states, dependency edges, footprint hashes, and a
  checker.
- **Acceptance:** skeleton boots and reports its (near-empty) owned set; reachability check runs
  green on it; ledger materialized with every §1.1 row + 31 tool rows, checker rejects invalid
  states/edges/missing rows.
- **Edges:** blocked-by: —; blocks: every wave child (registration + ledger rows) and C17.
- **Contracts:** owns X2, X7; participates X1.
- **Design inheritance:** §2.4 dual-wiring, §1.1 ledger definition **[binding]**; ledger file
  format (JSON + tsx checker suggested) advisory.
- **Required.** Status: not-dispatched (dispatchable now).

#### C3: Determinism & strictness (W0c) — autonomous
- **Purpose:** the §3.3 environment lockdown (allowlist, record/replay credential schemas,
  five-case test matrix, gate-defaults fixture, flip-liveness, override negative control), the
  §3.5 Bun pin assert, and §3.4 strict replay: proxy/differ normalization sharing to a
  zero-fallback corpus, then fallback-fatal for every non-extracted engineB.
- **Acceptance:** the W0 determinism bullets in "## Acceptance" (env matrix green, flip observed,
  fixture committed and `ENGINE_VERSION`-keyed, `prepare.ts` refuses mismatched Bun, corpus
  replays with zero positional fallbacks, fatal mode active thereafter).
- **Edges:** blocked-by: —; blocks: the *gate* of C4 and every later wave (X1 strictness).
- **Contracts:** owns X6 and X1's strictness clause; participates X5.
- **Design inheritance:** §3.3, §3.4, §3.5 **[binding]**. Advisory: canonicalization will likely
  change recorded body hashes — plan for one corpus re-record (record-freely posture covers it);
  Bun 1.4.1 must be installed pinned, not by upgrading the default toolchain.
- **Required.** Status: not-dispatched (dispatchable now).

#### C4: W1 — tool-result formatters + retrofit — autonomous
- **Purpose:** own the remaining tool-result formatters (Read, Edit, Bash, Grep, task family) on
  the proven shape; retrofit the existing 3 splices to standalone-complete + taxonomy-classified
  adapters + reference/custom/sabotage layout; cheap state-surface diff (sandbox fs tree + exit
  codes).
- **Acceptance:** per-wave bullets in "## Acceptance"; every new formatter's covering scenario
  goes RED under solo sabotage; ledger rows move to `spliced`/`standalone-complete`.
- **Edges:** blocked-by: C1 (X3 schema), C2 (X7 registration); gate blocked-by C3.G(strict).
  Scenario authoring may start immediately (advisory).
- **Contracts:** X1, X3, X4, X5, X6, X2 (row updates).
- **Design inheritance:** §2.4 module layout, §2.5 layers **[binding]**; census formatter
  locations advisory.
- **Required.** Status: not-dispatched (blocked-by C1/C2).

#### C5: W2 — descriptions + S-chunk pilot — autonomous
- **Purpose:** description functions via generalized S-method; the S-chunk mechanism debut on
  `y30v0ja7` (3 exports) with a full export-and-consumer inventory (§2.2); coverage attestation
  debut (§3.1).
- **Acceptance:** S-chunk bullets in "## Acceptance" (per-export coverage + sabotage, loud
  derivation perturbation, attestation shows branch execution).
- **Edges:** blocked-by: C1, C2; gate blocked-by C3.G(strict).
- **Contracts:** X1–X7 as C4.
- **Required.** Status: not-dispatched (blocked-by C1/C2).

#### C5x: mechanism round 2 (scout flow-back) — autonomous
- **Purpose:** close the four transform gaps the W3–W7 scouts measured before the bloc runs:
  (a) `yield*` delegation for `async function*` targets (all 8 hook dispatchers — W5's hard
  blocker); (b) an `arrow-initializer` shape for arrows inside multi-declarator `var`s (W6);
  (c) a `variable-declarator` shape for top-level prompt-text constants (W3/W4 — the
  summarization prompt is one); (d) same-chunk sibling disambiguation for identical anchor
  literals (blocking `nie`/`r6`/`U8n`/`NAt` — structural-signature-based selection at splice
  time, extending the existing signature mechanism). Plus (e) **the symbol map as a committed,
  pin-keyed artifact**: the W5–W7 scout found 387 chunks re-exporting engine symbols under
  source-level names (832 minified→semantic names for the engine chunk); generate it, commit it
  under research/fixtures/, regenerate per pin bump (a §5 staleness signal nothing else sees).
- **Acceptance:** one gated spike per new shape/mechanism (the W0 ritual: excise → boot →
  solo-sabotage RED → faithful GREEN → perturbation loud); symbol-map artifact committed with a
  `--check` mode; gate stays green end-to-end.
- **Edges:** blocked-by: C5 (lock); blocks: C6–C10. **Required.** Status: **landed** 2026-09-01 (Revision Note below).

#### C6–C10: W3–W7 (prompt assembly · compaction · hooks · permissions · control protocol) — autonomous at dispatch
- One child per §6 wave row; purpose/acceptance/corpus families as tabled. Each is blocked-by
  C1/C2/C3 **and C5x**; the W3→W7 sequence is priority order, not hard edges — the orchestrator
  sequences them by recording/gate serialization (X5). Their fine structure is cut at dispatch,
  from the scouted groundwork (`reforge/research/2026-09-01-w3-w4-anchor-scout.md`,
  `…-w5-w7-anchor-scout.md`).
- **Scout-driven corrections to §6's table (2026-09-01, binding for the bloc's cuts):** W6 and
  W5 are **pure S-method** — no S-chunk candidates exist (the census's `hw8qz4q5` row is
  actually the PowerShell tool, W10's domain; the other candidate chunks are 500-consumer
  shared-constant chunks or barrels). W7 **drops the switch/arm approach entirely**: the
  headless seam is a 55-arm `else if` chain whose arms bind loop control + ~40 locals; the wave
  splices the named whole-function handlers instead, and extends `m2/raw-protocol.ts` into a
  control-subtype driver — grading validation branches and response constructors with zero new
  live recordings. W3 notes: `xMt` is telemetry-only (never splice); the main system-prompt
  preset is **dark on the current corpus** (`settingSources: []`, no `systemPrompt`) — C6's cut
  decides preset-enabled scenario vs. reviewed exclusion. W4 notes: reactive compaction's
  natural trigger is ≈167k tokens — never record it; `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` is
  approved for the X6 allowlist (C3 sign-off recorded here) to make compaction-depth recordable
  cheaply; **microcompaction is headlessly unreachable** (`createContextHintController` returns
  null unless querySource starts with `repl_main_thread`; the SDK path sends `"sdk"`) — a
  reviewed exclusion with evidence, not a scenario debt. Coverage debts quantified: ~5 hook
  recordings, ~10–12 permission-matrix recordings, one probe on whether `auto` mode is gate-dead under
  pinned defaults. **C9's outturn corrects the reason for that permission budget** (the
  recordings were still owed, for different cells): `bypassPermissions` does NOT
  short-circuit the chain W6 owns. Its arm is rung 11 of 13 in upstream's pre-check —
  below the deny rules, the allow rules, the tool's own `checkPermissions` and the ask
  rules — so a deny rule still bites under bypass and the corpus's 22 bypass scenarios
  exercise most of the pre-check rather than none of it. The claim came from reading the
  BASH TOOL's own mode handler as a statement about the chain. **C8's outturn corrects the hook half of this, and C8 was then corrected
  TWICE.** The live set is **23 of the engine's 33-event dispatcher registry**, not 8 and not 12.
  The first re-measurement registered callbacks only, on one turn that created none of the missing
  firing conditions; the second still chose its watched list by hand, so three live events were
  never watched. The enumeration now comes from the registry itself
  (`reforge/research/fixtures/hook-registry-2.1.251.json`, gate-checked per run), with a named
  firing condition per event and a three-valued verdict — FIRED / DEAD / **OPEN**, the last for a
  condition named but not created. Fourteen recordings cover 21 of the 23; the model-switch pair is
  a §2.3 deferral recorded on the ledger row. The matrix's command-hook cell needs no filesystem
  setting source — `Options.settings` reaches the flag-settings layer with `settingSources: []` in
  force, which is the only path to a dispatcher whose dispatch precedes host-hook registration.
- **Required.** Status: **C6, C7, C8, C9 and C10 all landed** (C6–C9 2026-09-01, C10 2026-09-02; Revision Notes below). **The bloc is closed, which is W7.5's cut trigger** (see Deferred / out of scope). C8's "a refusal that produces no observable is unrecordable by construction" family did cover most of §2.1's permission chain — but not for the reason given: the family holds because a rung that is REACHED and passes leaves the same transcript as one that was never reached, not because `bypassPermissions` skips the chain (C9 measured that it does not). W7 inherits the control-response envelopes already owned and one correction to the scout's §3.2 table (see C9's Revision Note).

#### C11: W8 — moat tools — decomposing at dispatch
- Scenario-led; per-tool reachability probing first, then its own cut (the tool set is too wide
  for one owned unit). Blocked-by C2 (ledger rows), C3. **Required** (rows may resolve to
  evidence-backed exclusions). Status: not-dispatched.

#### C12: W9 — session storage (`SessionPort`) — controlled (fable)
- First S-module; its design pass owns the behavioral-partition matrix, dirty-state matrix, and
  brings the synthetic response corpus + full state-surface diff online (§3.1–3.2). Blocked-by
  C1/C2/C3. **Required.** Status: not-dispatched.

#### C13–C14: W10–W11 (bash executor + safety AST · MCP adapter + slash/skills) — autonomous at dispatch
- Per §6 rows; C13 needs C1's class-method shape. **C13's charter widened (2026-09-01, C4
  flow-back): it also owns `subsystem/tool-result-validators`** — the Edit `validateInput` unit
  C4's scout split out of the formatter row (3,317 chars, effectful captures: file-staleness
  side channel; W10 is the execution-depth wave, so the file-tool validation path rides with
  it). C13's cut at dispatch decides S-method vs S-module for it. **Required.** Status:
  not-dispatched.

#### C15: W12 — subagent dispatch + sandbox (`ToolRuntimePort`) — controlled (fable)
- Per §6 row; mutation battery per §3.1. **Required.** Status: not-dispatched.

#### C16: W13 — query loop + inversion + hermetic substrate — controlled (fable)
- `ModelTransportPort`; the inversion milestone (§2.4) and the §3.6 isolation substrate build
  here. Blocked-by: substantially all of C4–C15 (the inversion needs the owned set to carry the
  shell). **Required.** Status: not-dispatched (deliberately late).
#### C17: W14 — engine-ts closure — controlled
- The hermetic ownership gate with its four delegation-route negative controls; the campaign's
  recomposition verification follows its landing. Blocked-by: all. **Required.** Status:
  not-dispatched (deliberately late).

### Cross-child contracts

- **X1 — The gate** *(binding: the campaign's correctness definition)*: two-phase gate (solo
  sabotage RED + faithful GREEN on `m2/all.ts`), strict replay per §3.4 (owner of strictness:
  C3), non-vacuity contracts per §3.1. Binds every wave child; no child re-litigates.
- **X2 — The closure ledger** *(binding schema authority; owner C2)*: the ledger artifact +
  checker; every wave child updates its rows in its landing commit; pin bumps stale rows per §5.
- **X3 — The manifest schema** *(binding; owner C1)*: target shapes, capture taxonomy, footprint
  hashes; consumed by every splice-bearing child.
- **X4 — Module layout & hygiene** *(binding; owner C1 documents it)*: standalone-complete +
  adapter per taxonomy; `reference`/`custom`/`sabotage` files; no minified identifier crosses
  into owned code (§2.4–2.5).
- **X5 — Serialization** *(binding)*: gate runs and cassette recordings serialize through the
  orchestrator; workers never run either concurrently (§4).
- **X6 — Environment & credentials** *(binding; owner C3)*: all engine spawns go through the
  allowlisted env + credential schemas; no child adds env vars outside the schema.
- **X7 — Skeleton registration** *(binding interface; owner C2)*: the module-registry API every
  wave child registers its standalone-complete modules through.

### Ordering & dependency map

C1 ∥ C2 ∥ C3 run in parallel now (disjoint files; C3's corpus re-record serializes through the
orchestrator per X5). C4's implementation starts when C1+C2 land; its gate waits for C3. C5
follows C1/C2 the same way. C6–C10 run in §6 priority order under orchestrator capacity, C11–C15
after their bloc, C16 deliberately late (needs the owned set), C17 last. Scenario authoring for
wave N+1 overlaps implementation of wave N throughout (§6 note).

### Deferred / out of scope

- **Deferred (may return):** custom-delta gate machinery (ships with the first real
  customization, §2.5); platform/runtime matrix (pre-W14, per delegated unknowns); SDK-shim
  ownership (post-campaign, "## Beyond the campaign"); **the preset's ~20 prose section
  builders** behind `OS()` (C6 flow-back: the section inventory is unblocked now that the corpus
  renders the preset — the env-and-system-prompt row cannot reach `standalone-complete` without
  them, so W14's ledger gate enforces eventual placement; route into a prompt-sections follow-up
  wave when the bloc clears); **`selectExcision` counts candidates, not distinct spans** (C6
  flow-back: a same-node duplicate literal reads as a tie and throws — a wrinkle for the next
  mechanism round, blocked nothing yet); **segment compaction** (C7 flow-back: upstream's from/up_to
  variant `hRt` is the only path that passes `userContext` and `messagesSummarized` to the
  `compact_boundary` constructor and the only one that leaves follow-up questions un-suppressed, so
  three of W4's adjudicated branch outcomes are reachable only through it — and `/compact
  <instructions>` does NOT reach it, so no cheap scenario buys them; whichever wave takes the variant
  inherits the coverage) **[SUPERSEDED 2026-09-02 by C10.5: the function is `E4n`, not `hRt` (which
  is only that path's prompt builder), and NOTHING HEADLESS REACHES IT — the three outcomes are an
  ownability ceiling rather than coverage, and the variant is routed to C16/W13. See the C10.5
  Revision Note and `reforge/research/2026-09-02-w75-segment-compaction-reachability.md`]**; **the hook executors** (C8 flow-back: upstream `Qxt`, ~23 KB, plus
  `Rzn`/`Xxt`/`jy`, AND its awaiting sibling `AE`, which C8's boundary round surfaced when it
  spliced the two dispatchers that call it — S-module-shaped, and the only thing between
  `subsystem/hook-dispatch` and `standalone-complete`) **[SCOPE CORRECTED 2026-09-02 by C10.5's
  design pass: the layer is ~56 KB, not ~30 — two of its largest functions are unnamed here — and
  three of the names in this sentence are wrong. See the C10.5 Revision Note and
  `reforge/research/2026-09-02-w75-hook-executor-design.md`, which also stages the implementation and
  says why it did not start in W7.5]**. **Routing decision (2026-09-01):** the accumulated S-method-sized
  remainders — the OS() prompt sections, segment compaction — congeal into a proposed
  bloc-closing **completions wave (W7.5)**, cut when C10 lands; the hook executors ride with it
  or get S-module treatment inside it per their own design pass. **C10 landed 2026-09-02, so the
  trigger has fired.** W7 leaves it three seam notes rather than a to-do list: the `interrupt` arm's
  five helpers are the auto-react and task-notification subsystems (four in `chunk-fy12d89p`) with a
  named firing condition W8's task family creates more cheaply than W7.5 could; `rewind_files` (`Tf`,
  485 B) is takeable and anchorable today and wants only a scenario of its own — the probe already
  fires the arm and nothing grades its answer; and `mcp_message` (`QKn`, 58 B) is one line into the
  MCP transport and belongs with W11. None of the three is control-protocol work in anything but
  where its arm happens to sit.
- **The W7.5 cut (2026-09-02, C10 review converged — the cut is made):** child **C10.5**, the
  bloc-closing completions wave, dispatches next. Scope: (1) the **OS() prompt sections** —
  inventory-first, the section list extracted from the bundle as a pin-keyed fixture, then
  section builders spliced on the free-function template where takeable, honest gaps otherwise;
  (2) **segment compaction** (`hRt`) — first measure whether anything headless reaches the
  from/up_to variant at all (the subtype driver and the SDK seam are the candidates); if nothing
  does, the three W4 outcomes it guards become an ownability-ceiling finding, not a scenario
  debt; (3) **the hook executors** (`Qxt`/`AE`/`zxt`) as the campaign's first S-module splice —
  a DESIGN PASS first (port surface: `getMatchingHooks`, the agent-context result filter, the
  headless-suppression wrapper; the trace's interleaved-event-log rewrite is priced in the debt
  tracker and unlocks here), then implementation behind the designed port; (4) riders: the
  CwdChanged one-`cd` probe phase (fires → `AUt` on the family template, sharing `zxt`), and
  `rewind_files` only if its scenario is genuinely cheap. Explicitly NOT C10.5's: the interrupt
  helpers (W8), `mcp_message` (W11), the model-switch pair and W6's four recorded gaps (their
  own design passes). Track hint: controlled worker; the executor design pass gates the
  implementation half.
- **Explicitly out of scope:** §1.2's exclusion ledger, cross-referenced as standing exclusions.

### Tracking map

| child | wave | spec | status |
|---|---|---|---|
| C1 | W0a | commit `2621aad3` (direct execution vs this doc) | **landed + boundary-reviewed** — 4 target shapes, AST spans, 3 spike splices, closure-surface footprints, free-variable inventory, structural signatures (fix commits `97701dc6`/`dd260620`/`2f057702`) |
| C2 | W0b | commit `453f5952` | **landed + boundary-reviewed** — skeleton boots, ledger 46 rows evidence-backed, AST-based reachability w/ package allowlist (fix commits `bedff4b8`/`080e8dfd`/`cadb2e66`) |
| C3 | W0c | commits `d73bb3b5`/`1fadfeba` | **landed + boundary-reviewed** — env allowlist + credential injection (engine never holds a live secret), collision-fatal replay keys, SHA-pinned Bun, month-rot scrub (fix commits `64318463`…`fa8009d0`); gate 12/12, zero fallbacks |
| C4 | W1 | scout: `reforge/research/2026-08-31-w1-anchor-scout.md` | **landed** — 13 splices (10 tool-result formatters), corpus 24, every owned module standalone-complete + registered, contract tests and the cheap state surface online; validator row split out `unowned` |
| C5 | W2 | scout: `reforge/research/2026-08-31-w2-schunk-scout.md` | **landed** — S-chunk mechanism + `chunk-y30v0ja7` owned whole, 3 description splices, corpus 25, coverage attestation online (14/20 executed, 6 adjudicated), ledger folded into the gate |
| C5x | mech r2 | scouts (flow-back) | **landed** — 3 new target shapes each spiked on a real target (generator `yield*` → PostToolUse dispatcher, `arrow-initializer` → the permission deny stamp, `variable-declarator` → the summarization prompt), signature-based sibling selection, the 831-name symbol map committed + gate-checked, the instrumenter extended to switch/try/loops/optional chains, and the three W2 review findings fixed; gate 39/39 |
| C6 | W3 | scout: `reforge/research/2026-09-01-w3-w4-anchor-scout.md` | **landed** — the preset RECORDED rather than excluded (corpus 25 → 29); six prompt-assembly splices incl. three the scout filed anchorless; `strangle/prompt-parity.test.ts` grades 38 gate-dark branches; X7 registration folded into the gate; gate 48/48. **Boundary review closed 2026-09-01**: the corpus git seed and the memory scenario's working directory are no longer decided by the recorder's machine (that scenario re-recorded), the reachability checker's liveness proof and the seed control are gate phases, and the prompt-parity oracle carries committed mutation controls; gate 50/50. Finding 1 (structural-anchor churn) priced in §2.1 and logged as debt |
| C7 | W4 | scout: `reforge/research/2026-09-01-w3-w4-anchor-scout.md` | **landed** — two scenarios past the boundary (corpus 29 → 31), four compaction splices plus C5x's prompt, `strangle/compaction-parity.test.ts` grading 94 comparisons incl. the trigger's port trace, microcompaction excluded with evidence, `zRe`/`Tte` deferred to C16/W13; gate 56/56; two harness gaps fixed at the source (the continuation's transcript path as the sixth run-scoped id shape; the differ's run-id map extended to the boundary's uuid fields, with `src/differ.test.ts` as its first regression test) |
| C8 | W5 | scout: `reforge/research/2026-09-01-w5-w7-anchor-scout.md` | **landed, then corrected TWICE** — fourteen scenarios (corpus 31 → 45) covering the live hook events the corpus never reached, incl. the matrix's two command-hook cells via `Options.settings`, a `canUseTool` answered past the notify timer, and an authored API failure (`Scenario.deriveFault`); nineteen dispatcher splices, which with C5x's spike make **twenty functions over twenty-one of the TWENTY-THREE events the engine is measured to fire headlessly** out of upstream's 33-event dispatcher registry (the model-switch pair is a §2.3 deferral on the ledger row; the other ten registry events are OPEN with named conditions, not dead). The wave first claimed seven functions over all eight on a probe whose negatives were vacuous, then eleven over twelve on a probe that still chose its own watched list — see the two C8-fix Revision Notes. `strangle/hooks-parity.test.ts` grades 686 comparisons with 107 controls, which closed C5x's deferred attestation AND found a real defect in its shipped module (`return yield*` where upstream discards the completion value, invisible to every scenario); attestation 186/312 with 126 exclusions and zero un-adjudicated, incl. the campaign's first "unrecordable by construction" — one of which the new recordings then RETIRED by reaching it; all three hook execution helpers (`Qxt`, `AE`, `zxt`) named as the row's remaining gap; gate **77/77** |
| C9 | W6 | scout: `reforge/research/2026-09-01-w5-w7-anchor-scout.md`; matrix: `reforge/research/2026-09-01-w6-permission-matrix.md` | **landed, then corrected once** (2026-09-02 boundary round: **NOT CONVERGED on the record side**, the code side sound — five things the artifacts claimed that the recordings did not support; see the C9-fix Revision Note) — thirteen splices over the decision chain, the mode axis and the headless broker's return leg, plus **three functions spliced, measured dark and un-spliced** (an output absorbed before any observable, at 45 call sites; a seam the headless handler bypasses; and an answer pinned by a disabled gate) — **two more were adjudicated dark and were not**, and the fix round spliced them: their twins returned what the healthy functions return on every corpus input, and their surviving callers live in the mode-aware body, under a mode the corpus had never entered. Thirteen new recordings (corpus 45 → 58), the last three from the fix round: `perm-working-dir` closes the `workingDir` decisionReason, `perm-auto-classifier-deny` closes the `classifier` one AND fires `PermissionDenied` (OPEN across two waves) by choosing a 400 for the auto-mode classifier's OWN API call at record time, and the re-recorded `perm-mode-walk` finally makes a decision in every turn. Gate **92/92** — quoted from the gate's own SUMMARY block, which is the fix round's correction to the earlier **121/121**: that figure counted printed LOG LINES, and a liveness phase prints one per covering scenario. Attestation **355/669 with 314 exclusions and zero unadjudicated**; `strangle/permissions-parity.test.ts` grades **2,508 comparisons with 49 controls** over axes derived from the bundle (`research/fixtures/permission-surface-2.1.251.json`: six modes agreed by four independent enumerations, three rule behaviours, eleven decisionReason kinds) and finds every module byte-faithful. **A measured correction to this spec: `bypassPermissions` does NOT short-circuit the rule engine** — the bypass arm is rung 11 of 13 in upstream's pre-check, so a deny rule still bites under bypass and the corpus's bypass scenarios exercise most of the pre-check rather than none of it. Five sabotage twins and one whole scenario were rewritten after being MEASURED INERT (a twin that cannot be observed proves nothing, and it fails in the quiet direction); the branch instrumenter gained a guarded body that returns (nine controls); the oracle now locates its subject by the build's own anchor rule. **A second: `auto` is NOT gate-dead** — accepted through both the spawn and the control-channel paths, because upstream's auto gate is three local conditions rather than a remote flag. **A third, from the fix round: `auto` DOES consult the classifier** — the wave read "the tool ran with no broker consult" as "the classifier was not reached", and the classifier makes its OWN `/v1/messages` call, which for the probed command answered `<severity>25` and allowed. Only its BLOCK verdict stays OPEN. **Two scenarios were caught by the BRANCH ATTESTATION rather than by any check** — both used a whole-tool deny rule, which upstream applies by removing the tool from the session, so both passed while executing none of the chain; re-recorded command-scoped, they fired `subcommandResults` (a kind the matrix had OPEN) and confirmed the bypass correction live. **And the GATE itself had the vacuity defect**: it read any non-zero exit as a RED, so a crashed or killed runner proved liveness, and one dead row was passing on exactly that — a RED now needs the runner's own verdict line or a timeout, and anything else FAILS as inconclusive. Three §2.3 gaps named on the ledger row: `von`, `createCanUseTool`, and `Dd` (no string literal at all). **And the fix round's structural deliverable: `attest --check` now diffs the COMMITTED report against the one the run would write**, so a stale attestation artifact fails the gate loudly instead of drifting — it had gone stale twice |
| C10 | W7 | scout: `…w5-w7-anchor-scout.md` (now carrying a second supersession banner, for §3) | **landed** 2026-09-02 — five splices over the named handlers the live dispatch arms delegate to (`initialize` + the ~1 KB payload it answers with, `set_permission_mode`, `set_model`, `set_max_thinking_tokens`), which with W6's two response envelopes makes the round trip owned end to end for those subtypes. **The wave's substance is the measurement hole it closed**: `sdk.mjs` consumes control responses, so the protocol had ZERO coverage and no scenario could have given it any — `m2/raw-protocol.ts` now sends ten control requests ahead of its prompt and grades each answer on both engines. `strangle/control-parity.test.ts` grades 1,536 comparisons with 21 controls over axes read from `research/fixtures/control-protocol-2.1.251.json` (the fifth pin-keyed fixture: 52 arms / 54 subtypes / 37 sendable, derived from the engine's ladder AND from `sdk.mjs`, two artifacts sharing no machinery) and from the permission surface. `w7/probe-control-subtypes.ts` measures the whole population one subtype per session: **FIRED 38, DEAD 0, OPEN 16 of 54**, each OPEN with a written reason. Attestation 427/851 with 424 exclusions and zero unadjudicated, and **five of W6's exclusions RETIRED** because the driver's mode change executes them. Four scout corrections (the ladder is in the generator `runHeadless` drives, not in `runHeadless`; 52 arms not 55; two anchors that live in the arm rather than the handler; the interrupt helpers are W8's), one harness defect fixed at the source (the raw driver never reset or seeded its sandbox, so its recording captured the operator's own repository — invisible until a subtype that reads the system prompt was added), and one instrument defect caught by its own controls (two arms reported DEAD by a probe that closed stdin before their deferred answer landed). Gate **99/99** |
| C10.5 | W7.5 | cut 2026-09-02 (Deferred section's "The W7.5 cut"); wave record `reforge/README.md` "W7.5"; `reforge/research/2026-09-02-w75-hook-executor-design.md`, `…-w75-segment-compaction-reachability.md` | **landed** 2026-09-02 — three of the four items ended somewhere other than where the cut expected. **(1) OS() sections:** the inventory is a sixth pin-keyed fixture (`prompt-sections-2.1.251.json`, **27 dynamic records + a six-element static head**, not the "~20" quoted since W3; the C10.5 review corrected the wave's "two-element tail" — the return array has five elements and exactly ONE follows the dynamic set), found by shape from the section-record constructor and confirmed twice; then **six splices over the static head** (~11.2 KB of the preset's prose), every anchor prose occurring ONCE in 1,802 files, every solo sabotage RED on `sysprompt-preset`. Prompt oracle 178 → 217 comparisons / 8 → 23 controls. **(2) Segment compaction:** MEASURED **OPEN — an ownability ceiling, not a coverage debt**, and the campaign had been naming the wrong function (`hRt` is the prompt builder; the producer is `E4n`). Routed to C16/W13; W4's three exclusions moved onto the evidence. **(3) The hook executors:** design pass done and **implementation deliberately refused** — the layer is **~56 KB, not ~30**, two of its largest functions had never been named, three of the campaign's names for it were wrong, and the oracle needs three capabilities it does not have. **(4) Riders:** CwdChanged FIRED on a created condition, `hooks-cwd-change` recorded (corpus 58 → 59) and `AUt` spliced (hook oracle 707 → 721 / 116 → 121); `rewind_files` measured cheap-scenario/poor-splice and logged rather than taken. Gate **107 of 107 summary phases, zero FAIL**, attestation **436/871 with 435 exclusions and zero unadjudicated**, 74 manifest rows (73 splices + the S-chunk replacement) |
| C11 | W8 | — | not-dispatched (decomposing at dispatch; inherits the interrupt-helper OPEN from C10) |
| C12 | W9 | — | not-dispatched (controlled, fable) |
| C13–C14 | W10–W11 | — | not-dispatched |
| C15 | W12 | — | not-dispatched (controlled, fable) |
| C16 | W13 | — | not-dispatched — deliberately late |
| C17 | W14 | — | not-dispatched — deliberately late |

## Acceptance (behavior-phrased)

- **Per wave:** every new splice sabotaged alone turns its own covering scenarios RED; the faithful
  build is GREEN on the full acceptance surface (`m2/all.ts`); every owned module is registered
  standalone-complete in the skeleton with its captures classified per the taxonomy (§2.4) and its
  reference/custom/sabotage layout in place; the ledger rows move with evidence links; one commit
  per gated wave with gate output quoted.
- **W0:** each mechanism spike passes excise → boot → solo-sabotage RED → faithful GREEN →
  derivation-perturbation-fails-loudly on a trivial target; the skeleton boots and reports its
  owned set; the env allowlist ships with its credential schemas and the full test matrix green
  (OAuth-only / key-only / both / missing / seeded-override); the flip-liveness test observes a
  gate flip through the allowlist; defaults fixture committed and keyed to `ENGINE_VERSION`;
  `prepare.ts` refuses a Bun whose version differs from the binary's embedded runtime; **the
  corpus replays with zero positional fallbacks**, and fallbacks are fatal for every non-extracted
  `engineB` thereafter.
- **S-chunk (from W2):** per-export coverage + sabotage evidence for every retained export; export
  derivation perturbation fails the build loudly; coverage attestation shows covering scenarios
  execute the owned branches.
- **S-module (from W9):** the wave's behavioral-partition matrix is written before implementation
  and fully green; the mutation battery is killed by the covering suite; state-surface diff clean.
- **Campaign (W14):** `engines/engine-ts` passes the full acceptance surface as `engineB` inside
  the OS-enforced hermetic boundary (§3.6) with zero replay fallbacks (§3.4); all four
  delegation-route negative controls (direct exec, shell trampoline, dynamic import, read+eval)
  FAIL the same gate; static reachability finds no extracted import; the closure ledger holds no
  `unowned` or `stale` in-scope rows.
- **Standing:** the ledger regresses only by explicit `stale`/rebaseline entries at pin bumps; no
  splice exists without coverage; the differ's normalization spec grows only with written
  justification and per-scrub regression tests; substance checks grade both engines and carry
  negative controls where they are the only grading.

## Beyond the campaign (named, out of scope)

After W14 the last external dependency on the engine path is the Agent SDK shim itself. The
endgame architecture keeps the SDK as a compatibility adapter and oracle-driving tool — ccx talks
to engine-ts through an owned client (SDK-compatible adapter for existing users; direct stream-json
client as the native path, whose wire contract `m2/raw-protocol.ts` already exercises). A separate
initiative, not this campaign.

## Delegated unknowns (empirical residue — named, not hidden)

- Per-tool headless execution reachability for the moat tools (catalog presence is proven;
  execution is probed scenario-first in W8 — some may be catalog-only headlessly, e.g. CronCreate
  probed dead in earlier SDK research).
- AST-span excision on minified chunks at scale (parser feasibility measured; excision mechanics
  settled by the W0 spikes).
- Whether Bun 1.4.1 (or any future embedded version) is installable/pinnable on demand at bump
  time (expected yes; verified at each bump by the §3.5 assert).
- Gate runtime at ~50 splices (watch, then batch per §3.7 if needed).
- The S-module port designs (storage, query loop, sandbox) — each is its own design pass at its
  wave, fable-tier, with this spec as parent.
- Platform matrix (Linux x64, Windows) — deferred until engine-ts approaches W14; macOS is the
  product surface today.

## Decision Log

- **Endpoint: ratchet → engine-ts** (user-confirmed). Rejected: maximal-strangle-only (ownership
  stays hosted in upstream's bundle); straight-to-engine-ts big-bang (abandons the proven
  per-module gate discipline).
- **Rewrite posture: readable behavior-faithful rewrite** (user-confirmed). Rejected:
  transcription-tolerant (hosts code we can't confidently modify); behavior-only clean room
  (slower, gate-failure-prone, unnecessary under the internal-research posture recorded in
  `CC-to-SDK/CLAUDE.md`).
- **Recording posture: record freely, serialized with backoff** (user-confirmed). Rejected:
  per-wave caps and ask-before-each-batch (block autonomous waves for no economic reason).
- **Ordering: seam quality within user priorities; completeness moat is the bar** (user-directed).
  Glob/Grep deprioritized as deprecated upstream (user-supplied fact).
- **Feature gates: pin the disabled state + snapshot call-site defaults + allowlisted child env**
  (revised twice: the gate-resolution scout disproved the blob-snapshot plan; round 2 showed env
  inheritance leaves a live per-gate override path). Rejected: splicing 862 call sites (no seam);
  blob-snapshot-into-config (pins a cache the engine never reads); kill-switch without env lockdown
  (operator env can flip oracle behavior).
- **Topology: inside-out strangling with a granularity ladder, dual-wired to a W0 skeleton, with a
  named inversion milestone** (revised after round 1 + external assessment). Rejected: outside-in
  only (forfeits the proven gate); skeleton-at-the-end (degenerates into big-bang — the
  dependency-direction finding); no-inversion (hundreds of standing splices in an extracted-primary
  graph is an unmanageable terminal topology).
- **S-method generalization: AST-span excision with literal anchors, four target shapes** (adopted
  round 1; parser feasibility measured same day). Rejected: stretching name-search + balanced
  braces per shape (silent-truncation risk); pure-AST anchoring without literals (forfeits the
  anchor bet that survived ten versions).
- **Closure captures: per-class taxonomy — equality-assert primitives, own pure helpers outright,
  port the effectful** (round 2 corrected rev 1's blanket equality-assert, which is undefined for
  function values). Rejected: identity/source comparison of functions (minifier-sensitive, unsafe
  to evaluate); one assertion for all classes.
- **S-chunk honesty: export-and-consumer inventory + per-export acceptance** (round 1, verified
  against the extracted chunks). Rejected: whole-chunk claims priced by headline function only.
- **Ownership gate: hermetic with a delegating-wrapper negative control** (round 2). Rejected:
  static reachability alone (a wrapper that spawns the real binary passes it while owning
  nothing).
- **Pin bumps: semantic invalidation to `stale` with adjudication** (round 2). Rejected:
  numeric-only rebaseline (regenerated size buckets cannot see a changed branch in an owned row —
  false completeness).
- **Metric: closure ledger primary, bytes informational** (round 1). Rejected: monotonic
  owned-bytes percentage (can approach 100% while parity regresses).
- **Green = corpus equivalence; verification depth scales by tier; synthetic corpus + state
  surface + mutation battery staged at S-module tiers** (round 1 + external assessment). Rejected:
  calling corpus green "behavioral equivalence"; imposing mutation/coverage machinery on leaf
  formatters (disproportionate — tiering is the proportionality mechanism).
- **Parity/custom separation: reference-custom-sabotage layers + custom-delta gate** (external
  assessment). Rejected: customizing the faithful implementation directly (first customization
  becomes indistinguishable from a bug and breaks the parity gate permanently).
- **Replay strictness: fallbacks fail engine-ts acceptance; diagnostic-only meanwhile** (external
  assessment; supersedes the 2026-08-31 tech-debt deferral). Rejected: keeping fallback tolerance
  at final acceptance (a wrong request served the next response can grade as equivalent).
- **Runtime: pin external Bun to the binary's embedded version** (external assessment; skew then
  measured 1.3.14 vs 1.4.1). Rejected: unpinned "any recent Bun" (equivalence claims ride on
  runtime luck).
- **Ownership isolation: OS-enforced, with per-route negative controls; substrate built at W13,
  not W0** (round 3, partially adopted). Round 3 asked for hermetic isolation as a W0
  prerequisite; adopted at W13 instead, with reasoning: hermeticity gates only an
  engine-ts-primary artifact, which first exists at the inversion milestone — before that, every
  graded engine legitimately lives inside the extracted graph, so a W0 hermetic harness would
  gate nothing while inflating the foundation wave. Rejected: env-absence + child tracing as
  "isolation" (in-process read+eval and shell trampolines bypass both).
- **Replay strictness: strict from W0/W1, not W14** (round 3 corrected rev 2's own schedule).
  Rejected: strictness-at-the-end (a masking path through thirteen waves including the
  inversion).
- **Pin-bump invalidation: content-hashed upstream footprints per owned row, conservative
  chunk-level staling** (round 3). Rejected: export/target inventories alone (blind to internal
  body changes in owned S-modules — the exact false-completeness class the mechanism exists to
  close).
- **Non-vacuity contracts for every verification mechanism, binding minimums fixed now, full
  schemas at owning waves** (round 3, adopted in tiered form). Rejected: full schema authorship
  before decomposition (speculative for W9+ machinery with no implementation contact); no
  contracts (every named gate becomes claimable vacuously — the project's canonical failure).
- **Credential contract: selection, not inheritance** (round 3 caught the allowlist/auth
  interlock). Rejected: broad `CLAUDE_CODE_*`/`ANTHROPIC_*` passthrough (reopens the gate-override
  leak the allowlist exists to close); literal allowlist without schemas (strands record-mode
  auth).
- **Metric location: per-subsystem scorecard in `reforge/README.md`**, linked from coverage.md.
  Rejected: a new standalone tracker doc (one more thing to rot).
- **Spec location: `docs/superpowers/specs/`** per project convention, overriding the skill
  default path.
- **The cut: W0 trisected (C1 mechanics ∥ C2 skeleton+ledger ∥ C3 determinism); waves as
  children; distant waves coarse per the frontier** (decomposing run). Rejected: one monolithic
  W0 child (three deliverable types with disjoint files and different verification strategies —
  the split signals — and trisection buys immediate 3-way parallelism); fully detailed cuts for
  W3–W14 now (distant commitments go stale; §6's design view suffices until dispatch).
- **No board materialization: the tracking map + closure ledger are the progress record**
  (decomposing run). Rejected: registering wave tickets on an issue board (this repo does not run
  the board pipeline; a second registry would be new substrate the tree doctrine forbids).

## Surprises & Discoveries

- **The engine is concentrated**: one 4.0 MB chunk with zero JSX imports is the whole agent; the
  load-bearing target is ~5–6 MB, not 39.5 MB (census headline).
- **The moat traverses the seam**: 31 native tools presented headlessly at 2.1.251 — measured from
  cassette request bodies, so the completeness bar is differentially gradable.
- **The flag provider is GrowthBook, not Statsig**, and reforge's env already forces compiled-in
  defaults — the planned blob pinning targeted a cache that is never read (scout, empirical). A
  per-gate env override (`CLAUDE_CODE_LUMINOUS_WHISTLE`) survives in the public build and reaches
  the engine through the inherited environment (round 2).
- **The "description chunks" are multi-export grab-bags** (15/3/17/4 exports), not single-function
  seams — caught by adversarial review, verified against the extracted chunks, census corrected.
- **The substance check graded only the oracle** until `98d9553d`; round 2 then showed the
  strengthened check still accepted vacuous `undefined === undefined` ID correlation; round 3
  then *demonstrated* (by adversarially mutating the real transcript) that the twice-hardened
  check still accepted a foreground task with no completion notification — three successive
  lessons that a `substanceOnly` check is a full-fledged contract, not a smoke test, now codified
  in §3.1's non-vacuity contracts.
- **Spliced modules were substrate-dependent by construction** (graph-supplied closure values) —
  the dependency-direction insight that moved the skeleton from W12 to W0 — and rev 1's blanket
  equality-assert fix was itself wrong for function-valued captures (round 2).
- **The runtime skew was real and measurable**: embedded Bun 1.4.1 vs external 1.3.14, green gate
  notwithstanding.
- **The TypeScript parser eats the 4 MB minified engine chunk in ~0.6 s** with zero diagnostics —
  the AST premise is cheap, not speculative.

- **Cassette rot has a month class above the day class** (2026-09-01): the WebSearch description
  embeds "The current month is …"; the day-scoped scrub caught midnight rot (M3-B) and missed the
  month rollover. Caught within hours of the boundary *because* fallbacks had just become fatal —
  the strictness rule proved its liveness on its first calendar event.
- **`CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` is not a pure sanitizer**: a truthy value force-resets the
  permission mode to `default` (bundle evidence), so "hardening" with it would silently grade a
  different engine. Kill-switch env vars must be read in the bundle before adoption.
- **`import.meta.resolve(spec, parentURL)` silently ignores its second argument under tsx** — the
  reachability checker had been resolving every bare specifier against itself. Found while fixing
  the package-traversal gap.
- **The shared working tree is a real hazard**: a concurrent session's `git reset` wiped two
  workers' uncommitted state mid-wave (both recovered). Standing mitigation: workers commit
  incrementally; at most one code-writing worker in the tree at a time. **[Closed 2026-09-01:
  the lectures session's `strangle-scope` worktree turned out to hold a frozen 02:25 pre-reset
  snapshot; cross-session diff confirmed every reforge draft in it was strictly superseded by
  the landed fix wave (hypothesis "orphaned draft", not parallel work). Forensic branch
  `snapshot/strangle-scope-0225` preserved; drafts discarded; zero divergence remains on
  campaign paths. Cross-lane conventions since agreed: merge-preserving pulls
  (`--rebase=merges`), campaign paths main-authoritative, path-disjoint lanes stated.]**

## Outcomes & Retrospective

Pending — written at finish.

## Revision Notes

- 2026-09-02 (C10.5 / W7.5 — the completions wave): the bloc's four remainders, ordered so the cheap
  measurements landed before the expensive design work. **Three of the four ended somewhere other
  than where the cut expected**, and each of those is a correction to this document rather than a
  result within it. Gate **107 of 107 summary phases, zero FAIL**; corpus 58 → **59**; manifest rows 68 → **74** (73 splices plus the one S-chunk replacement); attestation
  **436/871 with 435 exclusions and zero unadjudicated**. Seven items change what the rest of the
  campaign inherits.
  - **THE PROMPT-SECTION COUNT WAS WRONG AND IT IS NOW A FIXTURE.** "`OS()`'s ~20 prose sections"
    appears in this spec, in the reforge README and in the W3/W4 scout. The pin says **27 dynamic
    section records plus a six-element static head**, in a five-element return array of which
    exactly ONE element follows the dynamic set (the wave first wrote "a two-element tail" and the
    C10.5 boundary review corrected it). This is the THIRD
    population the campaign counted by hand and got wrong — after the hook events (twice) and the
    control-protocol arms — so it became the sixth pin-keyed fixture with its own gate phase.
    `research/tools/extract-prompt-sections.ts` names nothing: it finds the section-RECORD
    CONSTRUCTOR by shape, then the one function calling it ten or more times. **The naive second pass
    is not unique and its top hit is a decoy** — an attachment-list builder in the same chunk makes 47
    two-argument calls to an identically shaped runner and outranks the target. Requiring a `compute`
    property collapses three candidates to one. Generalising: **a shape-based extractor's failure mode
    is a plausible impostor, not a miss**, and each such tool should name its near-miss and the
    discriminator that rejected it.
  - **THE SIX SECTION SPLICES ARE THE STRONGEST ANCHOR CLASS THE CAMPAIGN HAS TAKEN.** Every one is
    prose occurring ONCE over the 1,802-file set — a deliberate contrast with C6's two structural
    anchors, which were admitted with their churn cost recorded. Two near-misses are on the rows
    rather than in anyone's memory: the `# Using your tools` heading occurs twice inside its own
    function's two arms, which `selectExcision` ties because it counts CANDIDATES rather than SPANS
    (C6 predicted exactly this shape and left the mechanism alone; W7.5 met it again and anchored on
    prose the arms share rather than fixing the mechanism inside a wave that does not own it), and the
    short form of the parallel-tools sentence also recurs.
  - **READ WHAT A FUNCTION RETURNS, NOT WHAT ITS SOURCE SAYS.** The first take of the largest section
    was not byte-identical, and it failed in the way that looks correct: the prose was read out of the
    SOURCE TEXT between the template-literal delimiters, which carries upstream's own backslash
    escapes, so the owned copy compared equal against the source form while differing from the value.
    Every later wave taking a prose target inherits this, and a reviewer comparing both sides by eye
    cannot see it.
  - **SEGMENT COMPACTION IS AN OWNABILITY CEILING, AND THIS SPEC NAMED THE WRONG FUNCTION.** C7's
    flow-back, the Deferred section and W4's exclusion reasons all say `hRt` passes five arguments to
    the `compact_boundary` constructor. `hRt` is 513 bytes and is that path's summarization-PROMPT
    builder; it never calls the constructor. **`E4n` (4,710 B) does**, and the three-call-site /
    five-argument shape of the claim survives with only its subject changed. Reachability, measured by
    enumeration rather than argument: `E4n` has ONE caller, a method on the interactive session
    controller behind a host guard, an Ink dialog and a double-Escape keypress. Zero of the 52
    control-protocol arms delegate to it, none of the **27** methods the installed SDK's
    `interface Query` declares (`sdk.d.ts` 2522–2837 at 0.3.251) reaches it and neither does any
    option, the PreCompact hook cannot distinguish it, and the `/rewind` slash command — which DOES
    exist (`Snr`: "Restore the code and/or conversation to a previous point", aliases `checkpoint`
    and `undo`, whose `call` is `onQueryEvent({type:"open_message_selector"})`) — is stopped by two
    guards: the headless command filter `k0t` admits only `type === "local" && supportsNonInteractive`
    and `/rewind` declares `supportsNonInteractive: !1`, and the headless query-event sink drops
    `open_message_selector` outright. **Verdict OPEN, deliberately not DEAD**: the code is live, both fields are serialized and
    read back, and a headless session resuming an interactively-produced transcript will emit them —
    the READER side is reachable, the writer is the ceiling. W4's three exclusions now rest on that
    evidence and the variant routes to C16/W13 with `zRe`/`Tte`. **Generalising: a debt whose
    reachability nobody measured may not be a debt.**
  - **THE FIRST S-MODULE DESIGN PASS REFUSED ITS OWN IMPLEMENTATION, and that is the pass working.**
    The hook-execution layer is **~56 KB, not the ~30 KB** every prior scoping assumed: two of its
    largest functions — the command-hook subprocess runner (7,209 B, shared with three callers OUTSIDE
    this subsystem) and the JSON-contract interpreter (5,993 B) — had never been named anywhere. Three
    of the campaign's names for it are wrong: `getMatchingHooks` is two functions and owning the
    matcher alone owns no SOURCES; the session hooks store is not the layer reader this spec called
    `IE` but a class whose fields are **public** (which is exactly why this is the right first
    S-module, where §2.1's W10 finding blocks the Bash executor on PRIVATE fields); and the wrapper
    called "headless suppression" suppresses on **shutdown**, after which six events hang forever on a
    promise that never settles. **The architecture decision: the awaiting executor is not the streaming
    one's wrapper and must not share a core with it** — disjoint return types, and it silently drops
    the whole `hookSpecificOutput` permission contract, so a unified core would make it honour fields
    upstream drops on thirteen events, exactly where the gate is weakest. Nine ports proposed; behind
    those cuts ~27 KB is pure or pure-once-ported and the effectful residue is ~12 KB. Implementation
    was NOT started, because the oracle needs three capabilities it lacks — the interleaved event log
    (whose tech-debt entry predicted this trigger and was right, plus a reason it did not anticipate:
    **cleanup pairing** for per-hook derived signals released on six paths plus a catch), stdout CHUNK
    reproduction (async detection latches, once, on the first write after which the accumulated stdout's
    first line contains a brace), and grading a path that
    never settles — and the corpus needs two scenarios that do not exist. Staged 0–5, awaiting executor
    before streaming one. **A design pass that always concludes "proceed" is a formality.**
  - **AN OPEN ROW IS A STATE, AND CREATING ITS CONDITION IS USUALLY CHEAP.** CwdChanged had been OPEN
    since W5 behind one `cd`. The `cwd-change` phase created it, the event FIRED on both hook paths,
    `hooks-cwd-change` recorded it (corpus 58 → 59) and `AUt` — its twin's body with one string and two
    keys changed — is spliced, with the hook oracle gaining a field-order block because `old_cwd` and
    `new_cwd` are the only bytes distinguishing this dispatcher's stdin stream from its twin's. Two
    corrections rode with it: "two exchanges are required" was a mechanism claim the bundle does not
    make (the tracker reads the cwd back after EVERY command, so the second exchange is evidence), and
    the notifier consults the SETTINGS layer and plugin hooks only — never the global store
    `Options.hooks` callbacks land in — so a callback alone arms nothing.
  - **"CHEAP SCENARIO" AND "GOOD SPLICE" ARE DIFFERENT QUESTIONS, and the charter only asked the
    first.** `rewind_files` passes it — one env knob, state the engine snapshots itself, an answer that
    arrives as a `Query` method's return value, one recording reaching all four exits — and was still
    declined: four of five free variables are ports into the file-history subsystem, the body owns no
    byte-order contract, and all three of its good literals occur in two chunks because the interactive
    host carries a line-for-line twin, so its `coLiteral` would have to be borrowed from an unrelated
    arm of the control ladder. Logged with the measurement rather than taken or silently skipped.

- 2026-08-31: initial version, approved in-session after a census-grounded design pass.
- 2026-08-31 (rev 1): adversarial review round 1 (two Codex `gpt-5.6-sol` lenses) + the
  gate-resolution scout. All eight findings adopted: S-method target shapes + W0 spikes; S-chunk
  export inventories (census corrected); §3.3 rewritten around the GrowthBook kill-switch +
  defaults fixture; dual-wiring + W0 skeleton + machine-checked closure; closure ledger as primary
  metric; corpus-equivalence phrasing + tiered verification depth; waves added for MCP,
  slash/skills, subagent dispatch, sandbox; substance-check both-engines harness fix (`98d9553d`).
- 2026-08-31 (rev 2): adversarial review round 2 (five findings, all adopted: hermetic W14 +
  delegating negative control; closure-capture taxonomy; semantic pin-bump invalidation; env
  allowlist + override negative control + flip-liveness; background-task ID-correlation hardening
  → fix wave) + external architecture assessment (adopted: parity/custom lanes + custom-delta
  gate; typed ports + no-minified-identifier hygiene; inversion milestone; anchor budget; strict
  no-fallback at engine-ts acceptance; staged synthetic corpus / state-surface / mutation
  layers; upstream-decay policy; post-campaign SDK outlook) + measured Bun runtime skew (§3.5).
- 2026-08-31 (rev 3): adversarial review round 3 (six findings; five adopted fully, one
  partially with recorded rationale): background-task lifecycle assertions + adversarial-mutation
  negative controls (fix wave); §3.6 OS-enforced isolation with four delegation-route negative
  controls, substrate pulled to W13; §5 footprint-hashed pin-bump staling with conservative
  chunk-level fallback + bump negative control; §3.4 strict replay moved to W0/W1 (zero-fallback
  corpus is W0 acceptance; fatal for non-extracted engines from W1); §3.1 non-vacuity contracts
  with binding minimums; §3.3 record/replay credential schemas + test matrix.
- 2026-08-31 (rounds 4–5, code-only — no spec change beyond this note): round 4 declared the
  spec free of new non-delegated blockers and found one demonstrated code hole (the
  `substanceOnly` check accepted a second complete Agent lifecycle → fixed `3a5edd9a`,
  transcript-wide multiplicity counts, 22 assertions); round 5 verified that fix sound and found
  one medium strictness nit (falsy-vs-explicit-`null` parent-lane marker → fixed `f5e1efe7`,
  verified against the real transcript's explicit `null`, 24 assertions). **Loop declared
  converged after round 5**: five rounds, seventeen findings, zero rejected as false — each
  either fixed with negative controls or adopted with its rejected alternative logged; a sixth
  round over a one-predicate change would be review for its own sake. The background-task check's
  five successive hardenings (`98d9553d`, `908275d0`, `6c9ad4b6`, `3a5edd9a`, `f5e1efe7`) stand
  as the measured case study behind §3.1's non-vacuity doctrine.
- 2026-08-31 (C1 / W0a — splice mechanics): the mechanism generalization landed
  (manifest `target` shapes + capture taxonomy per §2.1/§2.4, AST-span excision,
  per-splice upstream-footprint hashes per §5, one spike per new shape). Two
  **advisory** target assignments in §2.1 and §6 were overturned with measured
  evidence; both change what a later wave must budget for:
  - **The control protocol is not a `switch` on the headless path.** §2.1 and
    §6's W7 row assign the switch-case shape to the control protocol. The
    `control_request` subtype dispatch headless traffic actually reaches (print
    mode, `chunk-dvbbv89q`) is an `if / else if` chain over `request.subtype`;
    the one switch carrying an `interrupt` case (`chunk-g461tywa`) belongs to
    the interactive engine driver. Measured: that clause excised, boot-checked
    and sabotaged alone left the `interrupt` scenario GREEN — a dead splice, so
    it was dropped rather than kept as an ungated row. The switch-case spike
    moved to the streaming assembler's `text_delta` arm, which every turn
    traverses. **W7 needs an if/else-arm shape (or a different seam) for the
    control protocol; the switch-case shape does not reach it.**
  - **The Bash executor cannot be delegated method-by-method.** §2.1 and §6's
    W10 row assign the class-method shape to it. Its command class keeps
    essentially all state in ECMAScript *private* fields (`#e`, `#g`, …), which
    are unreachable from outside the class body, so a whole-body excision cannot
    be delegated unless the adapter left in the class marshals every private
    field the body touches. The class-method spike moved to the transcript
    store's `materializeSessionFile` (public receiver, covered by `resume`).
    **W10 must budget a declared private-field accessor adapter, or take the
    executor at S-module granularity instead.**
  Also recorded: the AST rewrite is byte-identical to the old name-search +
  balanced-brace path on the three original splices (same owning-chunk sha256),
  and `strangle/perturb.ts` makes the derivation claim machine-checkable —
  every capture must track an upstream rename and must throw when its shape is
  destroyed (44 checks at this pin).
- 2026-08-31 (C3 / W0c — determinism & strictness): §3.3's environment lockdown,
  §3.5's runtime pin and §3.4's strict replay landed; corpus 22/22 and the
  strangler gate PASS with **zero positional fallbacks** and the strangled build
  graded under the fatal rule. Four items change what later waves should expect:
  - **The environment leak was real and it was steering the ORACLE.** Two
    operator variables reached every engine run: `CLAUDE_CODE_ENTRYPOINT` (written
    into every request body, so a cassette's match key depended on which shell
    recorded it) and `ENABLE_PROMPT_CACHING_1H` (forcing `cache_control.ttl:"1h"`
    on breakpoints that otherwise resolve per scope). The second is cost-bearing
    behavior. §3.3's premise is therefore confirmed empirically, not just by
    inference from the override inventory.
  - **The re-record advisory was right for the wrong reason.** C3's advisory
    predicted that canonicalization would invalidate body hashes and cost one
    corpus re-record. Canonicalization cost **zero** re-records — the hash is
    computed over both sides through the same scrub, as the contract says. Three
    scenarios (`subagent`, `background-task`, `slash-compact`) were re-recorded
    because the *env lockdown* removed the leaked cache-TTL variable, and
    `m2/raw-protocol.ts` gained its own cassette because it had been replaying
    the SDK corpus's recording despite building a materially different prompt.
    Later waves should budget re-records against **env/prompt changes**, not
    against normalization changes.
  - **Flip-liveness is affirmative, but not through the gate the spec names.**
    §3.3 cites `CLAUDE_CODE_LUMINOUS_WHISTLE`; measured, that override is
    unreachable on a headless proxied run — its reader short-circuits on a
    first-party-base-URL predicate. The flip was observed instead through
    `CLAUDE_CODE_USE_POWERSHELL_TOOL` (gate `tengu_cobalt_ridge`), which swaps
    `Read` out of the headless tool catalog for `PowerShell` — i.e. a per-gate
    env override can rewrite §1.3's moat surface. The override inventory is now
    generated from the bundle (13 entries at this pin) rather than cited by hand,
    so the sweep follows the pin.
  - **Delegated unknown resolved, with a caveat: Bun 1.4.1 is pinnable, but not
    from a tagged release.** The binary embeds 1.4.1; upstream's latest tag is
    1.4.0, and the only public build reporting 1.4.1 is the rolling `canary`
    asset (installed as `1.4.1-canary.1+d9b769812`). The version string matches
    exactly; the commit is not provably the one upstream compiled against. Future
    bumps should expect the same shape — the embedded runtime may lead the
    release channel — and `strangle/toolchain.ts` tries the tagged release first,
    then canary, and refuses anything that does not report the pinned version.
  Also recorded: strictness caught two pre-existing defects on its first run (the
  engine retries with `"stream": false` after a mid-stream failure, which the
  derived fault cassettes did not answer; and the raw-protocol suite's borrowed
  cassette), which is the liveness evidence for the rule itself. One deferral
  logged in `docs/tech-debt-tracker.md`: `PINNED_ENTRYPOINT` is `sdk-cli` to stay
  compatible with the recorded corpus, and should become `sdk-ts` at the next pin
  bump, when a re-record is already being paid for.
- 2026-08-31 (composite): the decomposing run extended this document in place with
  "## Roadmap — the cut" — grounding baseline, children C1–C17 (W0 trisected; binding detail at
  the frontier, distant waves coarse), cross-child contracts X1–X7, ordering, tracking map. The
  design sections above are unchanged; authority grades on inherited content are marked in the
  child sections and contracts.
- 2026-09-01 (C5x — mechanism round 2): the four transform gaps the W3–W7 scouts measured are
  closed, each behind a §2.1 spike on a target the scouts had already verified, so all three new
  shapes ship as permanent owned splices rather than rehearsals: **generator delegation** (`return
  yield* …`, the only form that carries a generator's yielded sequence, completion value and
  `next`/`throw` signalling — spiked on `b3e`/`executePostToolHooks`, covered by `hooks`);
  **`arrow-initializer`** (the arrow alone, leaving its declarator siblings byte-identical — spiked
  on `kye`, covered by `permission-broker`/`permission-bag`); **`variable-declarator`** (a constant's
  initializer, spiked on `l1n`, the 5,810-character summarization prompt, covered by
  `slash-compact`). Five items change what the bloc inherits:
  - **`siblings` + `declarator` extend the anchor doctrine, deliberately narrowly.** A `coLiteral`
    scopes to a CHUNK and therefore cannot separate two nodes inside one, which blocks `nie`/`hRt`
    and `kye`/`von`. The signature can now SELECT among same-anchored candidates, but only for a row
    that declares `siblings: n` (so an anchor that quietly stops being unique still fails loudly),
    the count is verified in both directions, and a signature matching two candidates is a **tie that
    throws** rather than a coin flip. The scout's suggestion of a declared ORDINAL was rejected —
    `declarator` is the index in a declaration list, which fails loudly when the list changes rather
    than silently selecting a different sibling.
  - **The scout's "`Dd`/`kye` need a coLiteral" is wrong, and the correction matters for W6.**
    `decideLocation:"pre-ask"` occurs twice in ONE chunk, so no co-literal can scope it; `kye` is
    takeable only because its declarator index separates it from `von`. `Dd` carries no string
    literal at all and is not takeable by this mechanism — W6 should plan coverage-first scenarios
    for the chain's other links rather than more anchor machinery.
  - **A literal-valued declarator is now compared against upstream's own bytes at build time.** A
    prompt whose wording changes while its name stays put moves no anchor, no target hash and no
    capture hash; this is the only thing that sees it, and it is chunk.ts's rule-5 argument one level
    in. Every prompt-text constant the later waves take inherits it for free.
  - **The transitive-closure bound stays at 6/20, on measurement.** W2's debt named the wrong cause:
    the WebFetch usage-notes walk was abandoning on an import of `fs`, and an external module is a
    boundary rather than a hole (no pin bump can change it). With that recorded as a leaf, the
    closure still does not terminate at depth 40 / 500 declarations — 500+ declarations, 17 chunks,
    272 KB — so the whole-chunk fallback is the designed behaviour for that row and the env-backed-memo
    cut rule is rejected: an owned capture is one the module REIMPLEMENTED, so stopping at an env
    reader would narrow §5's contract.
  - **Attestation is now possible for the constructs later waves own** (switch clauses, try/catch
    arms, loop conditions, single-link optional chains), with five forms still refused by name and
    reason. But **C5x's own three modules are deliberately NOT attested**: an exclusion needs an
    oracle, W2's is `description-parity.test.ts`, and building one for a hook dispatcher or a
    permission link is the owning wave's design work. C8, C9 and C7 inherit that obligation.
  Also fixed, all three W2-review findings (the campaign's own defect class, so fixed rather than
  logged): `strangle/attest.test.ts` gives the stale-exclusion detector the controls the README
  claimed; `auditTopLevel` refuses effectful variable initializers (it enforced "no side effects" by
  statement kind, and `var x = f()` is a `VariableStatement`); rule 5's prose now says which
  direction it actually catches. Gate **39/39 phases PASS**, corpus 25/25, 22 liveness phases.
  Ledger: `subsystem/hook-dispatch`, `subsystem/permissions` and `subsystem/compaction` → `spliced`
  (8 spliced rows, 39 unowned).
- 2026-09-01 (C7/W4 boundary review, internal): verdict **sound** — every splice byte-faithful
  (upstream bodies extracted and compared; all 8 footprint spans re-hashed), the `d1n` fold-in's
  only-caller claim verified graph-wide, the differ/canonical machinery edits tight with their
  new gate-phase tests. Three findings, all closed same-day (commits `abf32000`…`e28d2efcb`):
  the trigger oracle had been grading itself (upstream bound to the OWNED helpers — a shared
  defect compared equal; fixed by extracting upstream's helper bytes with a measured
  before/after: the perturbed constant passed 94/27 pre-fix, fails 4 graders post-fix; parity
  suite now 119/37), the port trace extended 3 → 8 ports so the recorded lesson is true as
  written (the two source refusals are unseparable by any trace — scoped honestly in all three
  prose sites), and the continuation-block position corrected. **Two generalizable lessons
  handed to W5/W6:** bind extracted upstream bodies to upstream's helpers, never the wave's own;
  and a single-caller pure helper cannot be a live splice (C7's own doctrine finding). Gate
  measured **61 phases zero-FAIL** post-fix; C7's 56/56 figure predates the fix wave and the
  +5 delta is a counting artifact flagged for the next gate-number touch, not added phases.
- 2026-09-01 (C6/W3 boundary review, internal): verdict **sound**, four non-blocking findings,
  all closed same-day (gate 48 → 50): the git seed hardened against operator config with
  both-directions poison controls (real value: recorder portability — honestly scoped by the
  fix); the memory scenario moved to a stable path + one re-record; the reachability liveness
  controls and seed control gated; eight parity mutation controls committed. The doctrine
  calibration stands in §2.1: C6's two non-prose anchors would have collided at 3 of 4 prior
  pins (17×/2× pre-chunk-split, independently re-measured) — loud availability churn, logged in
  the tech-debt tracker as inherent. The reviewer also verified all six splice bodies byte-level
  and recomputed the seeded SHA by hand.
- 2026-09-01 (C5x boundary review, internal): verdict **sound — no false-green path**; the
  reviewer extracted `b3e`/`l1n` from the bundle itself, resolved the symbol-map 831-vs-832
  delta empirically (one non-semantic alias filtered), and confirmed upstream's bare `yield*`
  and our `return yield*` coincide (inner generator returns undefined on every path). Four
  findings: three fixed same-day (commits through `fdba8f73a` — the declarator value comparison
  gained 12 controls and its silent non-literal downgrade became a loud refusal with a
  `valueUngraded` written-carve-out escape; generator early-`return()` gained 5 controls proven
  non-vacuous against a return-shaped seam; the external-import leaf note now distinguishes
  builtin from bare-external). The fourth (the kye deny-stamp's value graded by nothing) stood
  as the recorded C7/C9 carve-out and is **CLOSED by C9**: `strangle/permissions-parity.test.ts`
  now grades `kye` over five decision shapes x two sink shapes with four controls — the stamp
  landing on a non-deny, a pre-set `decideLocation` surviving, the stamp written before the
  spread, and a non-deny rebuilt rather than returned. Mechanism suite 99 → 119 checks; gate 39/39.
- 2026-09-01 (W2 boundary review): **Codex became unavailable mid-campaign** — the account's
  ChatGPT-plan Codex entitlement now rejects every model ("not supported when using Codex with a
  ChatGPT account"; setup shows auth active, so it is an entitlement/plan change, surfaced to the
  user). The round ran as an internal fresh-context fable reviewer instead, same challenge brief.
  Verdict: **sound — no false-green path found**; all six claims verified (S-chunk faithfulness
  line-by-line vs the bundle incl. port call order; parity extraction; derivation
  false-equality; attestation exclusions re-derived empirically; per-export sabotage; lean
  scenario substance via the requests surface). Three non-blocking findings routed to C5x:
  attest.ts's stale-exclusion detector has no committed controls though the README claims two
  (the campaign's own defect class — fix, don't log); `auditTopLevel` accepts effectful
  variable initializers (bounded today by whole-chunk staling); rule-5 value derivations are
  self-referential-but-loud, oversold in comments. Cross-model review resumes when Codex is
  restored.
- 2026-09-01 (W1 boundary review): one consolidated Codex lens over C4's nine commits. Verdict:
  formatter translations faithful to upstream, the destructuring-defaults overturn and coLiteral
  scoping both sound. Two findings, both fixed (commits `65f5f000`…`16a5ccf98`): **pure-helper
  footprints now cover the transitive closure of their upstream callees** (15 declarations
  resolved across 8 helpers, depth ≤2, hashes independently verified; bounded walk with a
  conservative whole-chunk fallback that was never needed; `closure: []` is a positive claim) —
  closing the last known blind spot in §5's staleness contract; and **the state surface records
  the sandbox root's own existence and kind** (lstat-based, so a dangling-symlink root is a
  symlink), distinguishing a deleted working directory from a clean empty one. Gate 23/23 after
  fixes.
- 2026-09-01 (W0 boundary review): three parallel Codex `gpt-5.6-sol` lenses over the whole wave
  diff returned **11 findings (all confirmed, none dismissed)** — every one an
  enforcement-integrity gap in W0's own machinery rather than a behavior defect: compact-syntax
  and bare-package bypasses in the reachability walk; fabricated-evidence acceptance in the
  ledger checker; footprints blind to closure-declaration drift; a perturbation phase that could
  not detect an incomplete capture inventory; no target-identity guard on the nearest-shape walk;
  computed destructuring keys silently re-evaluated; five pure helpers misclassified as effectful
  ports; shape-only canonicalization scrubs that let genuinely different requests share a replay
  key; the live API key reaching Bash subprocesses in key-mode recording; and a drift-tolerant
  Bun surrogate. Fixed across four workers (commits `bedff4b8`…`fa8009d00`); the collision-fatal
  cassette-load backstop, the free-variable inventory cross-check, per-row structural signatures,
  proxy-side credential injection, and the SHA-pinned runtime are the durable upgrades. Gate:
  **12/12 phases PASS, zero fallbacks, zero collisions.** One briefed fix was deliberately
  refused with bundle evidence: `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` force-resets the permission
  mode to `default` (cli.pretty.js:233080), which would silently grade a different engine — the
  variable is forbidden instead and the leak closed at its source.
- 2026-09-01 (C4 / W1 — tool-result formatters + retrofit): the manifest went from 6 splices to
  13 and every owned module became standalone-complete. Corpus 24 (two new scenarios,
  `edit-tool` and `task-family`, recorded live and replaying offline with zero fallbacks); the
  ten owned tool-result formatters cover 6,568 of the 44 formatter methods' minified chars.
  Five items change what later waves inherit:
  - **§1.1's first row is now two rows.** "Tool result formatters **+ validators**" was one row;
    C4 subdivided it with measured evidence. The Edit tool's error results
    ("String to replace not found in file.", "File has not been read yet.", the stale-read and
    match-count messages) are not produced by `mapToolResultToToolResultBlockParam` at all — they
    are returned by a sibling `async validateInput`, 3,317 minified chars against the formatters'
    155–1,590, carrying filesystem reads, `readFileState` access, `tengu_edit_tool_stale_read`
    telemetry and gate reads, i.e. mostly `effectful-port` captures. It needs its own scenario (a
    deliberately missing `old_string`) and its own gate row, so C4 scoped it out rather than
    smuggling a validator in behind a formatter wave. The new
    `subsystem/tool-result-validators` row is `unowned` and filed under C4 because C4 is what
    subdivided it — **C4 does not close it, and the roadmap owes it a wave assignment** (20
    `validateInput` methods exist in `chunk-fy12d89p.js`; the natural home is whichever wave takes
    the file tools' execution path).
  - **The `primitive` and `pure-helper` classes wire DIFFERENTLY, and §2.4 did not say so.** The
    taxonomy reads as if both become "owned", but they cannot share one wiring: a `pure-helper` is
    owned and NOT forwarded (the graph's function is never called), while a `primitive` must stay
    forwarded — the module uses its own copy, and the graph's copy crosses only so the adapter can
    equality-assert it. That assertion is not ceremony: a constant whose VALUE changes while its
    name stays put moves no anchor, no target hash and no capture hash shape that any other
    mechanism watches, so the per-delegation comparison is the only cheap thing that can see it.
    `owned: true` therefore marks pure helpers only. Later waves should read §2.4's "the adapter
    equality-asserts the graph's value" as *requiring* the forward, not as an alternative to it.
  - **Two mechanism gaps surfaced on real targets, both fixed in-wave.** (1) `strangle/ast.ts`
    refused any parameter-destructuring DEFAULT, which made the Grep formatter
    (`{mode:e="files_with_matches", …}`) unspliceable; the refusal was over-conservative, since the
    delegation reproduces the original parameter list verbatim and so applies the default exactly
    once before forwarding the bound name. Defaults now forward; nested patterns are still refused.
    (2) The Bash formatter carries **no graph-unique literal at all** — its only distinctive one
    occurs twice in every bundle from 2.1.220 to 2.1.251 (engine chunk + Windows/PowerShell
    sibling). The manifest gained an optional `coLiteral` scope, deliberately a co-occurring
    LITERAL and never a chunk name: chunk names are content-addressed and churn per pin, so name
    scoping would convert every bump into a manual re-anchoring pass. Waves facing an anchorless
    target should reach for this rather than for an identifier-tainted anchor.
  - **A green gate says less about an owned module than it did about a spliced one.** Sabotaging a
    whole method reddens its scenario even when the corpus touches one branch of six, and after
    this retrofit the *implementation* of those five other branches is ours. The corpus renders one
    of Read's six result arms, one of Grep's three, the plain stdout path of Bash's six, and never
    truncates a Glob result. §2.4's second clause — a contract test over partitioned inputs — is
    therefore load-bearing from W1 onward, not optional: `strangle/contracts.test.ts` (135 checks)
    is a gate phase, and every wave that owns a helper wider than its corpus owes one.
  - **§3.2's state surface is live in its cheap form, with one half honestly weaker.** The sandbox
    filesystem tree (recursive, content-hashed) is a direct fourth graded surface on every
    scenario, including `substanceOnly` ones — that exemption is about transcript nondeterminism
    and says nothing about what an engine left on disk. The exit-code half is DERIVED from the
    error the SDK throws, because a true exit status needs either an env var outside X6 or dropping
    `exec` from the engine wrappers, and dropping `exec` would orphan the engine when an aborted
    run signals the shell. Process supervision belongs with the full surface at W9.
- 2026-09-01 (C5 / W2 — descriptions + the S-chunk debut): the strangler gained a second unit of
  ownership. `chunk-y30v0ja7.js` is the first file in the graph with no upstream bytes left in it,
  and the four tool-description functions are owned (one whole-chunk, three S-method). Manifest
  13 splices → 16 splices + 1 chunk; corpus 24 → 25; gate 23 → 33 phases, PASS. Six things change
  what later waves inherit:
  - **The W2 scout was wrong about one call path, and the error would have bought a false
    exclusion.** The scout recorded Glob's description as reached only through
    `description(){return O_n(void 0)}`, making its lean arm dead code on its only call path. It is
    also reached through `prompt({model})` — the method that actually fills
    `requestBody.tools[].description` — so the arm is live and merely unrendered by a sonnet
    corpus. Had that reading stood, C5 would have recorded a reviewed exclusion for a branch one
    cheap scenario covers (`search-tools-lean`: the search-tools tool set on the api-error model,
    which emits the full catalog before the model id is rejected). **A "dead code" finding about a
    function with more than one caller should be re-derived from the call sites, not inherited.**
  - **S-chunk needs per-EXPORT sabotage, and §2.2 already said so.** One twin per chunk passes as
    long as any single export is live — the same vacuous shape solo-sabotage refuses one level
    down. `--sabotage <row>:<export>` wires one export from the sabotage layer and leaves the rest
    faithful. Waves taking a chunk should budget one liveness phase per retained export, not one
    per chunk.
  - **A constant can be graded better than a scenario can grade it.** The chunk's `"REPL"` export is
    unobservable by any corpus request — the REPL tool is gated behind an interactive-entrypoint
    test false on every headless run — so it declares a reviewed `darkReason` and the machinery
    refuses an empty coverage list without one. What grades it is the build comparing the owned
    constant against the value the PINNED CHUNK declares, every run, which is strictly stronger
    than a differential red: a red only sees a constant some scenario happened to render. **For
    `primitive` exports, prefer the build-time comparison to a coverage argument.**
  - **The attestation's oracle should be upstream, not a hand-written expectation.**
    `strangle/description-parity.test.ts` extracts the four upstream bodies from the pinned bundle,
    runs them with stubbed ports and requires byte identity over the full branch cross-product (18
    checks). Every one of the six reviewed exclusions names it as what grades that arm — so an
    unrendered branch is graded *against upstream directly*, which is better evidence than a
    differential red gives a rendered one. §2.4's "contract test where the domain is wider than the
    corpus" should take this shape wherever the upstream body is still on disk; it hand-writes no
    expectations, so it cannot encode a transcription error.
  - **§3.1's "complete inventory" is enforceable only if the tool refuses what it cannot record.**
    `strangle/branches.ts` walks the AST for every branching construct and FAILS on any it cannot
    instrument (switch, loops, try/catch, optional chaining) rather than skipping it, because a tool
    that silently ignores what it does not understand reports full coverage of the subset it
    understood. Coverage is measured on an instrumented rebuild of the graded graph whose covering
    scenarios must stay GREEN first, and no env var carries the recorder's path (X6) — the
    directory is baked in at generation time.
  - **The ledger now fails the gate** (C4's standing suggestion, adjudicated yes): two build-free
    phases, the checker's own fixture controls and then the real ledger. `subsystem/tool-descriptions`
    moves `unowned → spliced`, not `standalone-complete` — its charter is every description function
    plus the satellite chunks' other exports, and three of the four chunks still carry 15/17/4
    exports of unrelated behaviour. Four typed-port edges recorded: system-prompt policy (C6),
    subagent steer (C15), the session-model read (C16) and the WebFetch cache TTL.
- 2026-09-02 (C10 boundary round — **CONVERGED**, W7's review loop closed in one
  round): a fresh-context review over the eight W7 commits found zero
  load-bearing defects. All five splice bodies extracted through the build's own
  machinery and compared line-by-line (sizes and port counts exact; km's
  `default: break` a documented oracle-proven equivalent); the
  dispatch-location correction verified in the bundle (the 52-arm ladder lives
  in `ky`, re-exported as `_runHeadlessStreamingForTesting`, whose only caller
  is `runHeadless` — the production loop despite the name); the fixture
  re-derived (52 arms / 54 subtypes / 37 sendable, hand-recounted); the probe
  re-run row-for-row (38 FIRED / 0 DEAD / 16 OPEN, controls passing); the
  re-recorded raw cassette confirmed clean of operator state with the sandbox
  seed traced to C6's; the five retired W6 exclusions attributed cleanly to the
  driver's mode change; red-direction demonstrated live on um's short circuit
  (24 violations) and Ey's port order (8 violations, visible only to the port
  trace); the gate reproduced at exactly 99 summary phases; and the attestation
  +182 delta decomposed exactly into the five modules' rows. Seven findings,
  all documentation-grade, closed in this round's commit: a false counterfactual
  in the mode-setter reference (upstream's transition is itself same-mode
  guarded, so the short circuit's side effects are DOUBLY guarded), an
  off-by-one in the manifest's port prose, a driver grades-string claiming the
  short circuit a real transition actually exercises, the "async generator"
  phrasing corrected to the async-iterable-queue reality, and the raw cassette's
  machine-absolute paths folded into the pin-bump debt entry. **One round to
  convergence** — the first wave in the campaign to survive review without a fix
  wave; the C8/C9 doctrine (artifact-derived enumeration, created conditions,
  population-scoped verdicts) was written into this wave's brief from the start,
  which is the intended compounding.
- 2026-09-02 (C10 / W7 — the control protocol): the wave owns the REQUEST leg of
  the four control subtypes that have a named handler, graded by a sixth parity
  oracle (`strangle/control-parity.test.ts`, 1,536 comparisons with 21 controls)
  over axes derived from two artifacts rather than chosen. Corpus 58 unchanged
  and one cassette re-recorded; gate **99/99** (quoted from the gate's own
  SUMMARY block, per C9's correction); attestation **427/851 with 424 exclusions
  and zero unadjudicated**. Nine items change what the rest of the campaign
  inherits.
  - **THE PROTOCOL HAD ZERO COVERAGE, AND THE REASON IS THE WRAPPER RATHER THAN
    THE CORPUS.** `sdk.mjs` CONSUMES control responses. An `initialize` answer, a
    validation refusal and an unsupported-subtype error reach no surface an
    SDK-driven scenario can see, whatever the scenario does — so the ~1 KB
    initialize payload naming the session's commands, agents, models, output
    styles, account shape and permission mode had never been observed by
    anything in this project. `m2/raw-protocol.ts` sent one user message and no
    control request at all; it now sends ten ahead of the prompt and grades each
    answer on BOTH engines by the `request_id` it named. **The general form: a
    wrapper's convenience is a measurement hole, and the only instrument that can
    see through one is a driver that does not use the wrapper.**
  - **THE LADDER IS NOT THE SEAM, and the fixture says so in numbers.** 52
    `else if` arms over 54 subtypes, seventeen carrying a loop-control jump
    relative to the enclosing `for await`, all of them closing over the frame
    handler's locals. An excised arm would have to hand loop control back through
    a return value, which is a different mechanism rather than a generalisation
    of an existing one. C1 struck the switch-case shape from this row; W7 strikes
    the arm shape too, and the seam is the named handler each live arm delegates
    to — every one a plain top-level `free-function`.
  - **THE SCOUT WAS WRONG IN FOUR PLACES AND THE FIRST IS THE INSTRUCTIVE ONE.**
    §3.1 says the dispatch is inside `runHeadless`. It is inside the async
    generator `runHeadless` DRIVES, which the bundle re-exports as
    `_runHeadlessStreamingForTesting` — and the scout dismissed that function as
    "a separate testing entry point, not the production path" on the strength of
    the name. It is the production streaming loop, exported so tests can drive
    it. **An export NAME is a claim about who may call a function, not about who
    does.** The other three: 52 arms rather than 55 and 37 sendable subtypes
    rather than ~39; two anchor-table rows naming literals that live in the ARM
    rather than in the handler (anchoring `Ey` on the scout's literal would have
    excised the frame handler); and the interrupt arm's five "named helpers",
    which are the auto-react and task-notification subsystems rather than this
    one. The scout keeps its history and gains a dated banner plus four inline
    markers, per C9's rule.
  - **THE POPULATION IS DERIVED FROM TWO ARTIFACTS THAT SHARE NO MACHINERY.**
    `research/tools/extract-control-protocol.ts` finds the ladder by SHAPE (the
    longest `if/else if` chain over `<expr>.subtype`), confirms it against a
    guard in the same artifact (it must sit under `type === "control_request"`)
    and then against a DIFFERENT artifact entirely — the installed SDK's sendable
    set, recovered from three construction shapes in `sdk.mjs`. At this pin the
    chain serves 37 of 37. The fixture is a gate phase, so an arm added, retired
    or re-pointed reddens rather than silently narrowing the wave's claim — and
    so does an SDK bump, which is the intended reading: what a host can send is
    part of the population.
  - **38 OF 54 SUBTYPES FIRE, NONE IS DEAD, 16 ARE OPEN.**
    `w7/probe-control-subtypes.ts` sends each subtype into its own session on the
    no-wrapper wire and reads the answer. A REFUSAL counts as FIRED — an arm that
    validates its input and answers with its own sentence has run. The 16 OPEN
    rows each name what creating their condition would cost (an OAuth browser
    flow, a relay socket, a feedback endpoint, a second model call; for
    `apply_flag_settings`, changing the gate state the whole corpus is graded
    under). **Two rows were reported DEAD by the probe's first take and were
    not**: `get_workspace_diff` and `register_repo_root` defer through the
    command-lifecycle wrapper, and the probe closed stdin on the same tick, so
    the session ended before the answer arrived. **A DEAD verdict earned by the
    instrument's own impatience is the vacuous negative one layer down from
    C8's** — the probe now holds the session open until the answer lands.
  - **THE RAW DRIVER HAD NEVER RESET ITS SANDBOX, AND `get_context_usage` IS WHAT
    EXPOSED IT.** The driver only ever `mkdir -p`-ed, so the session's working
    directory was whatever the last suite left behind — and because the sandbox
    sits inside this repository, an unseeded one made `git` resolve to the
    repository ITSELF. That is C6's finding one suite over, and it stayed
    invisible because nothing in the raw lane read the system prompt. Adding a
    subtype whose handler counts tokens SECTION BY SECTION put the prompt on the
    graded request surface, and the recording immediately carried the operator's
    own branch, git user and dirty file list, with five requests falling back
    positionally under §3.4's fatal rule. Fixed by reusing C6's seed rather than
    re-deriving one. **A surface nothing reads is a surface nothing guards.**
  - **`get_context_usage` IS NOT A FREE READ.** Its handler makes twenty-one
    further `count_tokens` calls of its own — the cassette went from 1 exchange
    to 23 — which is why it HUNG against the one-exchange recording. A control
    subtype that looks like a query can be the most model-expensive frame in the
    protocol, and this one is invisible to the SDK lane entirely.
  - **FIVE PREVIOUSLY EXCLUDED ARMS ARE NOW EXECUTED, and the wave that retires
    an exclusion is not the wave that wrote it.** The driver's `set_permission_mode`
    is a real transition out of `bypassPermissions`, which reaches four of W6's
    mode-transition arms and the auto-compact trigger's threshold arm — all five
    had reviewed exclusions, and the attestation's stale-exclusion rule caught
    them the moment the raw driver joined the replay set. That rule has now
    earned its keep twice.
  - **A COVERAGE TAG THAT CANNOT GO RED IS A ROW THE GATE PASSES WITHOUT TESTING.**
    `sysprompt-preset` was listed as covering the initialize handler and MEASURED
    GREEN under the twin: the SDK sends a preset selection outside the initialize
    payload, so that scenario reaches the handler with nothing for it to apply.
    Dropped from the row rather than kept as a scenario that looks like coverage.
    And the routing that lets a non-corpus tag be graded at all lives in ONE place
    (`strangle/runners.ts`), shared by the gate's liveness loop and the coverage
    attestation, so a splice cannot be graded live by a suite whose branches
    nothing attested.
  - **THE GAPS, all named rather than implied.** The interrupt arm is inlined and
    its helpers are W8's. Their condition is named and CHECKED rather than
    assumed — the corpus's `interrupt` scenario runs one `sleep 25` under
    `allowedTools: ["Bash"]` with no `cancel_queued`, no background task and no
    queued command, so it creates none of it. That is a claim about the
    SCENARIO, verified from its source, and deliberately not a darkness verdict:
    no twin was measured against a population that reaches those helpers, so
    none is claimed. `rewind_files` is takeable and
    anchorable and has no scenario of its own — the probe fires the arm and
    nothing grades its answer. `mcp_message` is one line into the MCP transport
    and belongs with W11. The remaining 48 arms are peripheral: 16 serve subtypes
    no installed SDK can send, and a dozen more reach outside the harness.
- 2026-09-02 (C9-fix verification round — **CONVERGED**, W6's review loop closed):
  a bounded round over the five fix commits reproduced every claim under its own
  runs — the full gate re-run at exactly 92 summary phases (and the old 121
  figure's arithmetic verified as a log-line count: 89 + 3 new targets = 92),
  corpus 58/58, attestation 355/669/314 with the committed report byte-identical
  to a fresh regeneration and the new drift guard proven non-vacuous by
  perturbation, both reversal splices (`Ree`/`Fy`) and `VNt` extracted and
  compared byte-level, the record-time fault cassette shown self-consistent and
  deterministic across 8 replays over 6 build variants with a genuinely
  differential graded surface, and the mode-walk's per-turn segmentation shown
  to fail the exact hollow shape it replaced. The strongest result exceeded the
  wave's own claim: with the OLD twin shapes restored, every permission scenario
  including the new auto cell stays green — so the darkness verdict's overturn
  needed both the inverted twins and the population change, which is the
  "a darkness verdict is a measurement" lesson confirmed by experiment rather
  than argument. Three findings, all debt-grade, logged in the tracker (the
  fault predicate's missing unit control; the splice total living only in build
  output; `firedIn` provenance as prose). **Stop-signal honored** — W6 closes at
  two rounds + one bounded verification: review → fix (which itself overturned
  one review conclusion by measurement) → converged.
- 2026-09-02 (C9-fix / W6 boundary round — **NOT CONVERGED on the record side**;
  the code side held): a boundary review over the wave's ten splices found every
  splice byte-faithful, every darkness claim verified against the bundle and the
  gate's liveness change sound — and the RECORD it all rests on wrong in five
  places. That asymmetry is the note's subject. **This wave's code was reviewable
  and its evidence was not**, because nothing in the harness checks that a
  document's citation names a run that exists.
  - **THE LOAD-BEARING ONE: a per-turn design rule graded by a whole-transcript
    assertion is not graded.** `perm-mode-walk` exists to prove a mode change
    changes what the next tool call decides, and its own comment says the walk
    would be hollow without a tool call after every change. Its plan turn had NO
    tool call — plan mode injects a system reminder the model obeys against any
    framing — and the check asked `usedTool` over the whole run, which the
    *dontAsk* turn's Write satisfied. Three artifacts then cited that turn for a
    rung-11 decision the recording did not contain. Checks are segmented by
    `result` frame now, and the plan turn is a READ outside the allowed
    directories: read-only, so the reminder permits it, and ask-worthy, so the
    bypass rung answering above it is a real asymmetry (`perm-working-dir` is the
    control). Four takes; the intermediate one that aimed at the plan file gets
    the call but not a replayable cassette, because the engine names that file
    with a per-session random word.
  - **STEP 0 OF THE REVIEWER'S CHALLENGE, and the wave's third correction:
    `auto` DOES consult the classifier.** The wave read "the tool ran with no
    broker consult" as "the classifier was not reached". It measures the wrong
    seam: the classifier makes its OWN `/v1/messages` call, and when it allows,
    no host is ever asked. Watched on the wire, a `chmod` under `auto` produces
    one toolless, non-streaming request stopping at `</severity>` that answered
    `<severity>25`. The probe counts classifier calls now, so the conflation
    cannot recur. **An instrument that can only see one seam will read silence on
    that seam as absence.**
  - **STEP 1: the classifier's fail-closed arm closes two OPEN cells at once.**
    Upstream denies with `{type:"classifier", classifier:"auto-mode"}` when the
    classifier call is UNAVAILABLE — byte-for-byte the guard on the
    `PermissionDenied` dispatcher's sole call site, which C8 and C9's first round
    both left OPEN. Choosing a 400 for that one request with a harmless command
    creates it: the `classifier` decisionReason is now recorded, `PermissionDenied`
    FIRES on both hook paths, and `VNt` is spliced as `permission-denied-hooks`.
    The injection has to happen during the LIVE take, and the contract is general:
    `Scenario.deriveFault` can only express a fault the engine does not recover
    FROM, because a post-hoc cassette rewrite leaves the rest of the file
    answering a conversation that no longer happens. `Scenario.recordInject` is
    for faults that change what happens next.
  - **A DARKNESS VERDICT IS A MEASUREMENT, and it inherits the limits of the twin
    and the corpus it was taken against.** This note's own C9 entry (below) says
    `Ree` and `Fy` are owned-but-unspliced because their remaining callers are
    dark. Both are now spliced. Their twins returned `undefined` and `false` —
    what the healthy functions return on every input the corpus produces, so the
    twins could not have been observed by anything; and their surviving callers
    live in the mode-aware body, which runs only under `auto`, a mode the corpus
    had never entered. Inverted twins plus one `auto` scenario redden both. The
    withdrawn justification was also wrong in three checkable particulars (it
    called the auto arms gate-dead, which this same wave refuted; it said corpus
    decisions carry no `decisionReason`, when every Bash denial carries
    `subcommandResults`; and it missed that the two Bash-path callers are live and
    want only a command shape no cell wrote).
  - **A COMMITTED ARTIFACT NOTHING DIFFS WILL GO STALE, and regenerating it only
    resets the clock.** `reforge/attestation/coverage.md` was stale for the second
    time. `attest --check` now compares the committed report against the report
    the run would write and fails the gate loudly on any drift; the report body
    was audited for run-varying fields first, and has none. The guard earned its
    keep inside the same round, catching an exclusion that the re-recorded mode
    walk had made stale.
  - **A CORRECTION MUST SWEEP THE JUSTIFICATION LAYER, NOT ONLY THE NARRATIVE
    ONE.** Both of the wave's headline corrections were stated correctly in the
    wave record and left standing, unmarked, in the scout that is W7's designated
    input, in the parity scorecard, in module headers, in exclusion reasons and in
    the gate's own comments — nineteen sites. The scout keeps its history and
    gains a dated supersession banner plus inline markers, because a scout records
    what was believed at scouting time and editing that away destroys the record of
    a premise being refuted. **A refuted premise that survives where the reasoning
    lives will be reasoned from again.**
  - Also closed: `perm-plan-mode`'s self-contradiction (it asserted the Write must
    not be allowed while the recording had it brokered, allowed and the file
    created — plan mode DELEGATES, because the pre-check's plan refusal is guarded
    on `e.mcpInfo` and a built-in file tool never reaches it); the `workingDir`
    decisionReason (one scenario, `perm-working-dir`); and `asyncAgent`, which
    drops from OPEN to **MEASURED-DEAD** — the condition was created and the arm
    did not run, because every construction of that kind sits behind
    `shouldAvoidPermissionPrompts` and the SDK seam is itself a prompt surface.
    That last one is a fact about the ownability ceiling rather than about this
    corpus. Two harness defects fell out of the takes, both the same shape: state a
    run leaves behind that nothing resets (the plan directory now resets with the
    sandbox; a `repeat` cassette entry no longer reports itself as never served).
    **Deferred, logged rather than fixed:** the semantic dangerous-command
    classifier scenario, whose cost is a live two-stage consult over multiple
    takes, consult bodies carrying transcript and git enrichment as extra matching
    surface, and a classifier model that derives from the main model and so rots
    faster on a pin bump.
- 2026-09-01 (C9 / W6 — permission decisions): the wave owns the decision chain
  from the pre-check down, the mode axis end to end, and the headless broker's
  return leg — ten splices plus four owned-but-unspliced functions, graded by a fifth
  parity oracle (`strangle/permissions-parity.test.ts`, 2,508
  comparisons with 49 controls) over axes derived from the bundle
  rather than chosen: `research/fixtures/permission-surface-2.1.251.json` holds
  six modes agreed by FOUR independent enumerations, three rule behaviours, six
  rule destinations and the eleven decisionReason kinds upstream's own message
  builder renders. Corpus 45 → 56, gate **121/121** (a LOG-LINE count — see the C9-fix note; the gate's own summary block is the number to quote), and C5x's inherited `kye` carve-out CLOSED, attestation 340/641 with 301 exclusions and zero unadjudicated. Twelve items change what
  the rest of the campaign inherits.
  - **THE SPEC WAS ALSO WRONG ABOUT `auto`, AND FOR A DIFFERENT REASON THAN
    BEING WRONG.** §764's delegated unknowns carried `auto` as probably
    unreachable, because §3.3 pins every feature gate to its disabled default.
    Measured through BOTH paths — `Options.permissionMode` at spawn, which never
    consults the mode-change guard, and `setPermissionMode` over the control
    channel, which does — and ACCEPTED on both. Upstream's auto gate is
    `!circuitBreaker && !settingsDisabled && modelSupportsAuto`: three LOCAL
    conditions, not a remote flag, and none of them is something the pinned
    environment turns off. The mode is live and its CLASSIFIER's blocking arm is
    still OPEN (a `chmod 777 /etc/hosts` under `auto` was allowed with no consult
    and no hook), which is a strictly better state than "unreachable" and an
    honest one. **The general form: "gated" is a claim about a mechanism, and the
    mechanism has to be read before the claim can be inherited.** This also
    supersedes Wave T's reading in `docs/parity/coverage.md`, which measured a
    refusal on a model that does not support auto and attributed it to a gate.
  - **A CELL CAN PASS EVERY CHECK IT CARRIES AND EXECUTE NONE OF THE CODE IT
    NAMES — and only the branch attestation can say so.** Two of the wave's rule
    cells used a whole-tool deny rule (`deny: ["Write"]`). Both passed, both
    replayed identically on either engine, and neither executed a single rung of
    the permission chain: upstream applies a whole-tool deny rule by REMOVING the
    tool from the session (twenty-four tools in the init frame instead of
    twenty-five), so the model got "No such tool available" and nothing decided
    anything. A filtered tool and a denied tool leave the SAME transcript, so no
    transcript-level assertion could have caught it; what caught it was the
    pre-check's deny rungs reading zero executions across the whole corpus.
    Re-recorded on command-scoped rules, both cells came back stronger than
    designed — a real denial frame, the bypass correction confirmed live rather
    than by reading, and `subcommandResults` fired, a decisionReason kind the
    matrix had listed OPEN and expected to need a compound command (the Bash tool
    decomposes unconditionally, so every Bash denial is an aggregate of one).
    **§3's branch attestation stops being a completeness formality here and
    becomes the instrument that grades the SCENARIOS.**
  - **THE GATE'S OWN LIVENESS READING WAS VACUOUS, AND IT WAS HIDING A DEAD
    ROW.** The liveness block read ANY non-zero exit as RED, so a runner that
    crashed — or one an operator killed — counted as proof that a splice is live;
    and nothing bounded the replay, so a twin that breaks a control-channel
    response left the gate awaiting a promise that never settles (one phase sat
    for twenty-five minutes). A RED now needs POSITIVE evidence: the runner's own
    verdict line for the tag, or a timeout, which is itself a divergence because
    the faithful build replays the same cassette in seconds. Anything else is
    INCONCLUSIVE and FAILS the phase. Tightening it immediately turned one green
    row red — `classifier-streak`, sixty-two bytes on the allow arm of every tool
    call in every mode, had been passing on an exit code, and its maximal twin
    leaves both covering scenarios byte-identical. **The instrument that grades
    liveness is itself a thing that can be vacuous, and nothing else in the
    harness was watching it.** This is the third member of C8's vacuity family
    and the first one located in the gate rather than in a measurement.
  - **THREE MORE FUNCTIONS WERE SPLICED, MEASURED DARK AND UN-SPLICED, and the
    reasons are new kinds.** `ql`/`permissionMessage` has FORTY-FIVE call sites
    and runs on essentially every tool call — the opposite of a dark function —
    and is still unprovable headlessly, because an ask's message is consumed by a
    prompt surface a headless session does not have, and the one path that
    reaches the model takes the rule checker's ANNOTATING arm, which keeps the
    tool's message instead. **Call-site count is not liveness; what matters is
    whether the value reaches an observable.** And `K0`/`setPermissionModeWithGuards`
    joins the mode guard to the mode transition and reads like the
    `set_permission_mode` seam — the W5–W7 scout tables it as exactly that — but
    the headless runtime's handler calls the GUARD directly and applies the mode
    itself; `K0`'s only call site in that chunk belongs to another entry point's
    callback. A twin that REFUSED every mode change left the mode walk green.
    Dropped as C1 dropped the interrupt clause, with the finding kept where the
    row would have been. The third is `Uct`/`classifierOnlyStreakActive` above:
    dark because its ANSWER is pinned — the disabled streak gate makes upstream
    return `false` on every graded run, so even the maximal twin decides nothing
    a corpus can see. **A splice can be byte-faithful, run constantly, and still
    be unprovable; the campaign's answer is to keep the finding, not the row.**
  - **THE SPEC WAS WRONG ABOUT `bypassPermissions`, AND THE ERROR SHAPED TWO
    WAVES' BUDGETS.** §6's scout-driven corrections and the W5–W7 scout both
    record that bypass "short-circuits the whole rule engine", so "22 of 24
    scenarios grade none of §2.1's chain". Upstream's pre-check puts the bypass
    arm at rung ELEVEN of thirteen — below the tool deny rule, the input deny
    rule, the allow rule and its delegation, the tool's own `checkPermissions`,
    the ask rule, the interaction check, the MCP ask ceiling and the safety
    floor. Only the ASK is short-circuited; a deny rule still bites under bypass.
    Measured twice by different means: the pre-check sabotaged alone turns eight
    inherited scenarios red, every one of them a bypass run, and the parity
    oracle carries "bypass short-circuits the deny rules" as a mutant that must
    differ. The reading came from the BASH TOOL's own mode handler ("Bypass mode
    is handled in main permission flow"), which is a statement about that tool's
    checkPermissions and not about the chain. **The general form: a claim read
    off one function's comment is a claim about that function.**
  - **A LIVENESS TWIN HAS ONE JOB AND IT IS NOT PLAUSIBILITY.** Five of this
    wave's sabotage twins were written as the most plausible wrong
    implementation, and five were MEASURED INERT: an allow-rule decision that
    returns the prepared ask differs only in a message no scenario renders; a
    mode transition that returns the context unchanged skips only side effects
    nothing headless reads; a setter that reports success without applying is
    invisible until something asks the subsystem to decide again; a response
    mapper that spreads the host's answer carries the host's `updatedInput` with
    it; a control-response envelope emptied of its payload changes nothing,
    because nothing in the corpus reads one. Each twin now changes a DECISION,
    and the plausible-wrong-implementation mutants moved to the oracle where they
    belong. **A twin that cannot be observed proves nothing about the splice, and
    it fails in the QUIET direction — the gate goes green on a dead row.**
  - **AND THE SAME QUESTION HAS TO BE ASKED OF THE SCENARIO.** The wave's
    mode-walk scenario originally changed mode four times and then said READY;
    all three mode-seam splices measured inert on it. A session can be told to
    change mode, believe it did, apply none of the transition and produce a
    byte-identical transcript, as long as nothing afterwards asks it to decide
    anything. The walk now makes a tool call after every change, and each change
    is chosen for the DECISION it flips rather than for the mode it visits.
  - **`gK` DOES NOT CARRY `initialize`, and W7 should not budget as if it did.**
    The W5–W7 scout calls `gK`/`$U` "the highest-leverage pair in W7 — every
    headless `control_response` passes through them, so sabotage reddens on
    `initialize` alone". Measured: the headless runtime builds the `initialize`
    and `reinitialize` responses as INLINE object literals and routes every OTHER
    inbound subtype through the shared responder. Sabotaging the success
    constructor leaves `plain` green and turns `runtime-setters` red. W6 took
    both envelopes (the `can_use_tool` round trip is the only control request the
    permission chain itself issues, and leaving the return leg unowned would have
    stopped that chain's ownership mid-round-trip); W7 inherits the REQUEST leg
    and should re-verify the rest of §3.2's table the same way.
  - **A LIVENESS SWEEP NEEDS ITS OWN NON-VACUITY GUARD.** The first sweep of this
    wave reported six splices live on a scenario tag that does not exist:
    `m1/run.ts` exits non-zero on an unknown tag, and the sweep reads non-zero as
    RED. It is C8's vacuous negative with the sign flipped — a vacuous POSITIVE,
    which is worse, because a false negative gets investigated and a false
    positive gets committed. The sweep now runs its whole tag list against a
    known-good engine before it measures anything.
  - **TWO TAKEABLE FUNCTIONS ARE OWNED WITHOUT BEING SPLICED, and the reason
    generalises C7's rule.** *(SUPERSEDED 2026-09-02 by the C9-fix note above:
    both are spliced. The twins that produced this verdict returned what the
    healthy functions return on every corpus input, and the corpus had no `auto`
    cell, where their surviving callers live. The paragraph stands as written
    because the shape of the mistake is the finding.)* `Ree`/`isAskRuleDrivenReason` (6 call sites) and
    `Fy`/`findSafetyCheckReason` (17) are
    both anchorable and both have zero free variables; both were spliced, built
    and solo-sabotaged, and neither turned a scenario red. After the pre-check and
    the rule checker take their own copies, upstream's remaining callers are the
    mode-aware body's gate-dead auto/dontAsk arms and the broker's ask path, where
    the corpus's decisions carry no `decisionReason` at all — so a finder that
    never finds anything returns exactly what the healthy one does. *(Every clause
    in that sentence is false; see the supersession above. `auto` is not gate-dead,
    the mode-aware body returns on dontAsk before either call, and every Bash
    denial in the corpus carries `subcommandResults`.)* C7's "a
    single-caller pure helper cannot be a live splice" is the special case of **a
    helper whose remaining callers are all dark cannot be either.** They live in
    `strangle/modules/shared/` as `pure-helper` captures alongside `ql`, graded
    against their own upstream bytes before any body is built on them.
  - **EXTEND THE INSTRUMENT, NOT THE OWNED CODE — the second instance.**
    `strangle/branches.ts` refused a `try` block that can `return`, because the
    end-of-block marker is what a `return` skips. Three of this subsystem's four
    most-called functions do exactly that, and rewriting them to hoist a result
    into a variable would have measured something other than upstream. Every
    escaping `return` now carries its own recorder for the same completed arm,
    written as an EXPRESSION so a braceless `if (x) return y` keeps owning its own
    statement; the end-of-block marker is emitted only when the body can actually
    fall off its end. Nine new controls. Still refused, for a reason a `return`
    does not share: a `break` or `continue` that leaves the guarded body, labelled
    ones included — a jump has no expression position to record in.
  - **THE ORACLE NOW FINDS ITS SUBJECT BY THE BUILD'S OWN RULE.** The four
    previous parity oracles hand-rolled a brace matcher to extract upstream's
    body; this one calls `resolveAnchor` + `selectExcision` + `assertSignature`
    against the pinned bundle — the same three functions `strangle/build.ts`
    calls — so an oracle and a build cannot grade different functions, and a row
    whose anchor drifted fails in the oracle as well as at the build. It compares
    the PORT TRACE alongside the value, because two refusals returning the same
    thing can differ in nothing but which ports ran and in what order.
  - **THE GAPS, all named rather than implied.** `von` (the 11.6 KB mode-aware
    decision body ABOVE the pre-check: sixty free variables, a model-classifier
    call, a mutable per-session denial counter) and `createCanUseTool` (the
    broker's class method: five mutable maps on its receiver plus thirty-five
    module imports) are §2.3 designed-port deferrals, not omissions. `Dd`, the
    chain's two-line entry point, carries no string literal at all and is not
    takeable by the anchor mechanism — both of its neighbours are owned.
    `eln`/`initializeToolPermissionContext` (5.4 KB, filesystem and settings I/O)
    belongs with the settings layer. And one mechanism gap is recorded rather than
    built: the target signature has no ASYNC dimension, which is what would have
    separated the broker's two five-parameter functions (an anchor change solved
    it here).
- 2026-09-01 (C8-fix-2 verification round — **CONVERGED**, W5's review loop closed):
  a third boundary round over the nine new splices found no wrong byte, no
  false-green path and no wrong measured claim. All nine upstream bodies were
  re-extracted through the manifest's own machinery and compared line-by-line
  (record field order, executor-request key order, guards, defaults — including
  the family's historical defect classes: the oracle demonstrably reddens on a
  reintroduced `return yield*`); every headline number reproduced from a fresh
  run in the round's own session (686/107 oracle, 186/312/126/0 attestation,
  45/45 corpus, 33/32 registry, the 77-phase arithmetic); two sabotages
  demonstrated live for their own named reasons; the model-switch deferral judged
  a defensible, accurately characterized §2.3 call. Three findings, all
  debt-class, closed in the loop's final commit: the CwdChanged OPEN row's
  justification was factually wrong about the seam (the Bash tool's
  post-command `tengu_shell_set_cwd` tracking DOES move the tracked cwd on a
  persisting `cd`; the verdict stands because no phase ran one — prose corrected,
  the one-`cd` follow-up phase logged in the tech-debt tracker with `AUt` named
  recordable via the shared `zxt`), the ledger row's curated evidence list had
  silently gone stale at round one's inventory (the nine new manifest rows and
  six new scenarios appended; the mechanical footprint had covered them
  throughout), and the trace comparison's present-with-undefined blindness was
  already in the tracker. **Stop-signal honored: a round that produces only
  logged debt and prose corrections is convergence** — three rounds, each
  finding the layer beneath the previous one (vacuous negatives → judgment-derived
  enumeration → nothing), is this campaign's measured case for review-until-quiet
  on every multi-splice wave.
- 2026-09-01 (C8-fix-2 / W5 second boundary round — the measurement layer was
  wrong, so the enumeration now comes from the artifact): a verification round on
  the first fix confirmed all four new splices byte-faithful and the oracle,
  differ, instrumenter and attestation sound. What it did not confirm was the
  thing they all rest on. The first fix corrected the wave's ANSWER (8 → 12) and
  left its METHOD in place: the probe still decided by hand which events to
  watch — "every event with a dispatcher a single tool-using turn could plausibly
  reach" — so three live events (PostCompact, TaskCreated, Notification) were
  outside the measurement entirely and six more were never asked. **An event
  nobody thinks to watch cannot be measured as absent.**
  The population under test now comes from upstream's own dispatcher REGISTRY:
  one object literal mapping every hook event to the function that dispatches it,
  snapshotted as `reforge/research/fixtures/hook-registry-2.1.251.json` by
  `research/tools/extract-hook-registry.ts` and re-derived on every gate run. It
  is found by SHAPE and confirmed against a second independent signal in the same
  bundle (the `hook_event_name:"…"` literals the dispatchers stamp — 100%
  coverage), then each dispatcher is resolved through the ESM graph and its call
  sites counted, INCLUDING dynamic-import sites: SessionEnd's third caller is the
  app's own `shutdown()`, which a static sweep cannot see and which is the
  ordinary-teardown fire the wave had left unexplained.
  **33 events. 23 FIRED. 0 DEAD. 10 OPEN.** Nineteen splices now (nine new:
  `post-compact-hooks`, `notification-hooks`, `instructions-loaded-hooks`,
  `stop-failure-hooks`, `task-created-hooks`, `task-completed-hooks`,
  `permission-request-hooks`, `user-prompt-expansion-hooks`,
  `file-changed-hooks`), six new recordings (corpus 39 → 45), oracle 503 → **686
  comparisons with 107 controls**, attestation 165/283 → **186/312 with 126
  exclusions and zero un-adjudicated**, gate **77/77**. The two model-switch
  dispatchers FIRE and are deliberately not spliced — a mutable per-session
  holder, a fire-and-forget promise, a plugin loader, ~17 ports each — recorded as
  a §2.3 ledger gap rather than an omission. What the rest of the campaign should
  take from it:
  - **DERIVE THE ENUMERATION FROM THE ARTIFACT, NOT FROM JUDGMENT.** This is C3's
    move (the bundle-generated feature-gate override inventory) applied to a
    different question, and it generalises to every "what is the complete set of
    X" the campaign still has to answer: tools, slash commands, settings keys,
    control-protocol methods, permission rule kinds. If the engine enumerates
    them somewhere, extract that enumeration into a pin-keyed fixture, gate on
    it, and derive the test's population from the fixture. A hand-written list
    can only ever confirm the hand that wrote it, and it fails SILENTLY — the run
    is green, the table is complete, and the missing rows are invisible.
  - **A VERDICT VOCABULARY NEEDS THREE VALUES, NOT TWO.** FIRED, DEAD (a firing
    condition was created here and nothing happened), and **OPEN** (the condition
    is named and was not created). The first fix taught "a negative is only
    evidence if the healthy case would have produced a different one"; OPEN is
    what that rule looks like once it is enforced by the reporting format rather
    than by remembering. Ten of the 33 rows are OPEN, each naming what would
    create it. Two rounds of this wave were wrong by writing a negative where the
    honest answer was OPEN.
  - **RE-CHECK THE MECHANISM YOU USED TO EXPLAIN A GAP, NOT JUST THE GAP.** The
    first fix explained SessionStart's callback silence structurally — "the
    dispatcher hands the executor no session hooks registry, so no callback can
    reach it" — and that explanation is refuted by the bundle: `Options.hooks`
    entries are tagged `origin:"sdkHost"` and pushed into a GLOBAL store which
    `IE(event)` consults unconditionally. The silence is registration TIMING. The
    byte fact underneath was right and survives; the inference drawn from it was
    wrong and had propagated into two module headers, a scenario tripwire, the
    ledger note and `docs/parity/coverage.md`. An explanation that fits the
    evidence is not the same thing as the mechanism.
  - **CHECK THAT YOUR OWN OPTIONS DID NOT SWITCH THE SUBSYSTEM OFF.** Three modes
    silently disabled what was being measured: `bypassPermissions` skips the
    permission system outright (every phase of the first two rounds ran under it,
    so nothing permission-scoped could fire); a bare `allowedTools` entry SHADOWS
    `canUseTool`, so the callback is never consulted; and default mode
    auto-approves read-only shell commands without consulting it either, so a
    probe built on `echo` measures nothing. Each turned a live event into a
    clean-looking negative. W6 inherits all three directly.
  - **AN EXCLUSION IS A CLAIM ABOUT REACHABILITY, AND IT IS ONLY AS GOOD AS THE
    POPULATION IT WAS MADE OVER.** The campaign's first "unrecordable by
    construction" exclusion — PostToolUseFailure's registration-guard refusal —
    was RETIRED by this round without anyone targeting it: the new recordings
    make tool calls without registering that hook, and every earlier tool-using
    scenario happened to register one. The arm looked like a property of the seam
    when it was a property of the corpus's habits. Same defect as the headline
    one, one level down.
  - **A SCENARIO WHOSE CONDITION IS A RESPONSE CAN AUTHOR IT.** StopFailure fires
    on the arm where a turn ends in an api-error, and no prompt makes the real API
    return one on demand. `Scenario.deriveFault` records the take live and then
    rewrites its first exchange into the H2 fault BEFORE promoting the cassette,
    so the committed cassette is the graded one and both engines replay the same
    authored failure. W7's control-protocol error paths are the same shape.
  - **A DEBOUNCED CONDITION NEEDS TIME INSIDE THE TURN.** `hooks-file-watch`
    failed its first recording because the turn ended the moment the file landed
    and the watcher's dispatch arrived after the query had closed — on both replay
    sides, with four requests served positionally. A real `sleep` inside the turn
    is not padding; it is the part of the firing condition the filesystem owns.
- 2026-09-01 (C8-fix / W5 boundary round — the hook set was mis-measured): the
  wave's headline claim, "seven functions covering all EIGHT headlessly-live
  events", was wrong in both halves, and the way it was wrong is the finding.
  Its probe drove ONE batched tool turn and read "did not fire" off it for five
  events. That turn fails no tool, compacts nothing, ends no session inside the
  observation window and completes no MCP elicitation — so for four of the five,
  a working dispatcher would have produced exactly the same silence. Re-measured
  with a phase per firing condition, TWELVE events fire; four splices were added
  (`post-tool-failure-hooks`, `session-start-hooks`, `session-end-hooks`,
  `pre-compact-hooks`) with four recordings, and every claim in the wave record,
  the ledger note and `docs/parity/coverage.md` was rewritten to match. Gate
  **67/67**, corpus 39/39, attestation 165/283 with 118 exclusions and zero
  un-adjudicated, oracle 503 comparisons with 58 controls. What the rest of the
  campaign should take from it:
  - **A NEGATIVE IS ONLY EVIDENCE IF THE HEALTHY CASE WOULD HAVE PRODUCED A
    DIFFERENT ONE.** This is the general form of the campaign's own
    "unrecordable by construction" family, applied to itself: that family says a
    refusal and a never-call are the same recording, and the probe's negatives
    had exactly that shape without anyone noticing. Before recording "X does not
    happen", name the run that would make it happen, and either make that run or
    say the question is open. The same reflex produced eight attestation
    exclusions that turned out to be arms a real hook PROCESS renders and a
    callback does not; re-recording two scenarios with command hooks moved them
    instead.
  - **MEASURE THROUGH EVERY PATH A FEATURE HAS.** A dispatcher's callback hooks
    come only from a session hooks registry it is HANDED, and three dispatchers
    are called without one — so they are unreachable from `Options.hooks` by
    construction and reachable from the settings layer. A callback-only probe
    measures the registration path, not the dispatcher, and no amount of
    re-running fixes it. W6's permission rules have the same split (settings vs
    `canUseTool`) and should be probed on both.
  - **EXTEND THE INSTRUMENT, NOT THE OWNED CODE, WHEN THE TWO DISAGREE.** The
    branch inventory refused `try/finally` with no catch; upstream's SessionStart
    dispatcher is exactly that, and its `finally` is behaviour (an executor that
    throws still releases the activity hold). Rewriting the module to be
    measurable would have measured something other than upstream. Teaching
    `strangle/branches.ts` to splice in a recording, rethrowing `catch` cost
    twenty lines and one generator fixture, and the same two outcomes a
    try/catch has now apply.
  - **A DISPATCHER WHOSE RESULT IS OBEYED IS A DIFFERENT KIND OF TARGET.**
    `tz`/PreCompact is not a generator: it awaits a SECOND executor (`AE`, which
    the round added to the ledger's gap) and reduces hook results to a verdict
    the compactor acts on. A callback returning `{continue:true}` produces one
    result shape, so most of that reduction is oracle-only — thirteen cases and
    six controls. Expect the same shape wherever hook or rule OUTPUT feeds a
    decision rather than a stream, which is most of W6.
  - **THE SERIALISED RECORD IS SMALLER THAN THE BUILT ONE.** Five of the ten keys
    the SessionStart dispatcher builds are undefined on the headless seam, and
    JSON drops them — so a command hook sees five. The scenario grades the
    absence; the oracle grades the construction. A wave that graded only the
    bytes would under-claim, and one that graded only the object would miss what
    a real hook reads.
- 2026-09-01 (C8 / W5 — hook dispatch): the wave owns every per-event
  DISPATCHER and none of the executor they delegate into. Four scenarios first
  (`hooks-prompt-submit`, `hooks-batch`, `hooks-subagent`, `hooks-command`;
  corpus 31 → 35), then six `free-function` generator splices which, with C5x's
  PostToolUse spike, make seven functions covering all EIGHT headlessly-live
  events — one function serves Stop and SubagentStop and the corpus reaches both
  arms. `strangle/hooks-parity.test.ts` grades 371 comparisons with 36 controls;
  attestation 132/235 executed, 103 excluded, zero un-adjudicated. Gate
  **63/63 phases PASS**, corpus 35/35, 38 liveness phases. Seven items change
  what the rest of the bloc and the roadmap inherit:
  - **A REFUSAL that produces no observable is unrecordable BY CONSTRUCTION, and
    that is a new exclusion family.** Five of the seven dispatchers return
    without building anything when no hook is registered for the event — no
    consult, no record, no frame — so "the guard refused" and "the dispatcher was
    never called" are the same recording, while being the common case in
    production. Every prior exclusion in this campaign said "the corpus does not
    drive that"; this one says no corpus could. It generalizes immediately: W6's
    chain short-circuits on `bypassPermissions` before the rule engine says
    anything, so the same argument covers most of §2.1's decision chain, and the
    honest response is an upstream-differential oracle for those arms rather than
    a scenario that cannot exist.
  - **The oracle found a real defect in C5x's shipped module, which is what the
    deferred obligation was FOR.** Every upstream dispatcher ends in a bare
    `yield*` and therefore returns `undefined`; all seven owned modules wrote
    `return yield*` and handed the executor's completion value back. Nothing on
    the corpus's paths reads a dispatcher's return value, so no scenario, no
    sabotage and no differential could see it — the parity oracle failed on it in
    its first run. The general form: **when a wave ships a module ahead of its
    oracle, the debt is real and the interest is invisible.** W7's control-protocol
    generators are the same shape.
  - **`Options.settings` registers a settings-layer fixture without a filesystem
    setting source**, which is what made the matrix's one non-trivial cell cheap.
    `Options.hooks` takes callbacks only, so nothing in the corpus graded a hook
    record as the BYTE STREAM it is serialised into — and field order is
    behaviour for anything that reaches a subprocess's stdin. Turning on
    `settingSources` would have re-run W3's ancestor-directory trap; an inline
    settings object goes into the flag-settings layer with `settingSources: []`
    still in force. W6's allow/deny/ask rule fixtures are the same shape and
    should use it.
  - **Bind the oracle to the MANIFEST's own derived captures, and drive the owned
    side through its ADAPTER.** Re-deriving each free variable with the
    manifest's `derive` regexes against the extracted body means the oracle
    cannot bind a port the splice does not forward; calling through the adapter
    makes the argument list the one the build synthesises, primitives and their
    equality assertions included. It is the same "no second transcription"
    argument §2.4's oracle shape already makes, one level further in, and it
    turned a 7-module cross-product into one generic harness.
  - **A helper with MANY callers is a `pure-helper` capture; a helper with ONE is
    a fold-in.** C7 recorded the second half after `d1n`'s row came back green.
    W5 used the first half seven times — the hook fan-out rule, its two
    agent-context predicates, the last-assistant-message pair and the
    plain-object test all have callers throughout the engine, so splicing six
    dispatchers leaves upstream's copies live and each stays a real owned helper.
    The check is the call graph, in both directions.
  - **The corpus can be grown by FEWER recordings than the scout budgeted when a
    probe says which events share a turn.** The W5 scout owed five; one no-tool
    turn fires UserPromptSubmit, MessageDisplay and Stop together, so four bought
    the same eight events. The probe that established it also re-measured the
    live set against the pinned engine rather than inheriting a 2026-06 number,
    and turned five never-firing events into evidence-backed ledger exclusions.
  - **The hook EXECUTOR is a new named debt, and it is the whole remaining
    subsystem.** Upstream `Qxt` (23 KB, reached through `jy`/`Xxt`) does hook
    matching, command/callback/http/mcp invocation, timeouts and cancellation;
    the scout measured it S-module-shaped and §2.3 says a stateful core is owned
    behind a designed port. Whichever wave takes it inherits `getMatchingHooks`,
    the agent-context result filter and the headless-suppression wrapper.
    Until then `subsystem/hook-dispatch` is `spliced` and cannot close.
  - **The gate's phase count had a counting artifact, and it is resolved.** C7
    reported 56 and its fix round measured 61 with no phases added. Recomputed
    from the tree: the gate pushed exactly 56 `results` entries at C7's landing
    commit and the fix round changed neither `gate.ts` nor the manifest (its four
    commits touch the compaction oracle, the canonicalizer and three docs), so 56
    was right. The 61 comes from counting PASS lines in the LOG rather than
    entries in the summary — the equivalence phase relays `m2/all.ts`'s five suite
    verdicts in the gate's own `  PASS  <label>` format before the summary prints,
    and 56 + 5 = 61. Measured on W5's run: 68 such lines in the whole log, 63 in
    the summary, the five in between being the suites. **The number to quote is
    the summary's** — it is a property of the manifest plus the fixed blocks, not
    of the transcript.
- 2026-09-01 (C7 / W4 — compaction): the wave owns everything in the
  subsystem except its drivers. Two scenarios first (`compact-continue`,
  `auto-compact-threshold`; corpus 29 → 31), then four splices — the
  `compact_boundary` constructor, its wire shaping, the post-compaction
  continuation message with the summary rewriter it calls, and the
  auto-compaction trigger predicate — plus a parity oracle over all five owned
  bodies. Gate **56/56 phases PASS**, corpus 31/31, 32 liveness phases,
  attestation 83/146 executed with 63 adjudicated and zero un-adjudicated.
  Seven items change what the rest of the bloc and the
  roadmap inherit:
  - **The X6 addition was needed and the cleaner-looking alternative was
    disproved.** `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` landed on the C3 sign-off
    recorded in this bloc, as a scenario-declared knob. But
    `managedSettings: { autoCompactWindow }` — an SDK option, i.e. the lever that
    would have needed no allowlist change at all — does NOT reach
    `options.autoCompactWindow` on the headless seam: with it set the engine
    still reported `thresholdSource=model-default`. Recorded because "declared
    surface ≠ reachable surface" applies to SDK options exactly as it applies to
    engine capability, and the next wave tempted by `managedSettings` should
    probe before designing on it.
  - **A predicate's coverage needs the conversation its CONSUMER requires.** The
    first take set the threshold as low as possible on the theory that lower is
    safer. The predicate fired on the second exchange and upstream refused to
    compact a conversation that short ("no assistant messages in summarize set,
    bailing"), so the recording carried a `true` decision and no boundary. The
    scenario now crosses a threshold chosen to sit in a wide gap, after enough
    exchanges for the compactor to have something to summarize.
  - **A pure helper with one caller cannot also be a live splice.** `d1n` was
    given its own row and its solo sabotage came back GREEN on both covering
    scenarios: §2.4 makes a pure helper owned rather than called, so splicing its
    only caller makes upstream's copy unreachable and the row dead. It moved
    inside the owning module, where its arms stay in the branch inventory and the
    build still footprints its upstream declaration. Generalizing for every later
    wave: **a pure helper reachable only through a function the wave owns belongs
    inside that owned module.**
  - **Two normalization gaps, both found by continuing PAST a boundary, both
    fixed at the source.** The continuation message names the session's own
    transcript file and rides in the first user message of every post-compaction
    request — as its SECOND text block, after the `claudeMd`/`currentDate`
    system-reminder block that leads every user message
    — the sixth run-scoped id shape §3.4's canonicalization comment predicted, and
    without it every such request fell back positionally. And a
    `compact_boundary` names preserved messages the SDK never emits, so their ids
    exist under no other key and the differ's run-id map had no entry to make.
    The map now covers the boundary's uuid fields and, for the first time, has a
    regression test of its own (`src/differ.test.ts`, a gate phase) — §3.4 has
    always required one per rule and the MAP half had none.
  - **The oracle should compare a port TRACE, not just an output, wherever the
    target's arms differ by effect — and the trace must cover EVERY port, or it
    separates only the arms it happens to reach.** Two of the trigger predicate's
    four refusals differ from each other in nothing but which ports ran before
    they refused. `compaction-parity.test.ts` compares which ports ran, with what,
    and how often, across all eight, alongside the answer. The other two refusals
    call no port at all and no trace can separate them: an arm that refuses before
    any effect needs its GUARD graded rather than its trace. This is the same
    lesson W3 learned about telemetry events, one level more general, and every
    later predicate-shaped target inherits it. (The scoping of the last two
    sentences is C7's boundary review; the first take of this note claimed the
    trace separated all four.)
  - **Bind the extracted upstream body to UPSTREAM's helpers, never to the wave's
    own.** The trigger oracle bound upstream's two source guards to the OWNED
    implementations, reasoning that a wrong owned helper would make upstream's
    body take a different arm and fire the comparison. It does not — the same
    defect flows through both sides and the comparison comes back EQUAL.
    Measured: a perturbed entry in the owned non-conversational source list left
    all 94 comparisons green. The fix extracts the helpers' own bytes
    (`AZt`/`FD`/`tC`), value-compares them against the owned constant and
    helpers, and only then binds the body to the upstream pair; the same
    perturbation now fails four comparisons. Every later oracle whose target
    calls a helper the same wave owns inherits this — it is the general form of
    "an oracle that shares an input with the thing it grades is not an oracle".
  - **Microcompaction is a reviewed exclusion, and the segment-compaction path is
    a new named debt.** The first is settled with the scout's evidence
    (`createContextHintController` is REPL-only; the headless driver sends
    `"sdk"`). The second is new and measured at the call sites: `user_context`,
    `messages_summarized` and the un-suppressed continuation arm are reachable
    ONLY through upstream's from/up_to segment variant (`hRt`)
    **[SUPERSEDED 2026-09-02 by C10.5: the producer is `E4n`; `hRt` is only that
    path's prompt builder. The five-argument shape below holds; the debt is an
    ownability ceiling, not a coverage debt.]**, which passes five
    arguments to the boundary constructor where the paths the corpus drives pass
    three — and `/compact <instructions>` does not reach it. Whichever wave takes
    the segment variant inherits the coverage.
  - **The compaction DRIVERS are formally C16/W13's.** `zRe` (the async generator
    that routes a true decision through the reactive path) and `Tte` (the reactive
    driver that runs the PreCompact hooks and calls the summarizer) are
    query-loop-shaped, as the scout judged; the ledger row now records the
    deferral rather than leaving it in a research note. C16's charter is
    correspondingly wider than §6's row says.
- 2026-09-01 (C6 / W3 — environment block + system-prompt assembly): the wave's
  first deliverable was a scenario, not a splice. **C6's coverage decision on the
  preset: record it.** `baseOptions()` sets `settingSources: []` and passes no
  `systemPrompt`, so all 25 recordings emitted the same two-block `system` array
  and the engine's real prompt assembly was dark corpus-wide; owning it against
  that corpus would have shipped a green gate that meant almost nothing. Four
  scenarios landed (`sysprompt-preset`, `sysprompt-append`, `sysprompt-boundary`,
  `claude-md-memory`; corpus 25 → 29), then six `free-function` splices covering
  the whole pipeline — identity selector, context tail, block partition, wire
  shaping, CLAUDE.md injection, subagent assembly. Gate **48/48 phases PASS**.
  Six items change what the rest of the bloc inherits:
  - **An anchor must be free of MINIFIED IDENTIFIERS; it does not have to be
    prose.** The W3 scout filed `U8n`, `r6` and `NAt` as anchorless and the cut
    was to re-assess them under C5x's sibling selection. Sibling selection was
    not the answer; the doctrine read more precisely was. `cacheScope,ttl:` (two
    property names), `?.isNonInteractive` + a `coLiteral`, and
    `].filter(Boolean)}` + a `coLiteral` are all stable across a minifier and all
    fail loudly. **Before filing a target unanchorable, enumerate its untainted
    substrings and count them**, and reach for a `coLiteral` before reaching for
    sibling selection, which is the narrower tool.
  - **`selectExcision` counts CANDIDATES, not SPANS.** `U8n`'s other untainted
    anchor occurs four times in one chunk, two of them inside `U8n`'s own body —
    which the selector reads as a tie and refuses, though both name one span. It
    blocked no target here (the anchor above makes it moot) and was left
    unchanged rather than fixed opportunistically inside a wave that does not own
    the mechanism; recorded so the next wave that meets the shape knows the
    failure is the mechanism's rather than the anchor's.
  - **Live recording is a determinism test the design pass cannot run.** Two
    traps surfaced only on the first take, both fixed at the source rather than
    scrubbed at the differ: the preset's prompt ends with a `gitStatus:` section
    carrying the working tree's commit SHAs (so the first cassette embedded this
    campaign's own commit log — fatal under §3.4 on the next commit), and
    `settingSources: ["project"]` walks the working directory's ANCESTORS up to
    and including the home directory, loading the operator's private
    `~/.claude/CLAUDE.md` (the cassette leak check refused it, correctly). The
    scenarios now seed a deterministic git repository and run the memory case
    outside both the repository and the home tree. **Later waves recording any
    scenario that turns on `settingSources` or the preset should budget for the
    same class.**
  - **The static-prompt gate is pinned false, measured rather than inferred**,
    which makes two of the block partition's three paths unreachable and produces
    the campaign's largest single adjudication: 38 of 88 branch outcomes are
    reviewed exclusions. The evidence is one recording — the section builder
    emits the boundary marker only when the same gate is true, and
    `sysprompt-preset` renders the preset's whole section list without one. The
    oracle is `strangle/prompt-parity.test.ts` (178 comparisons, including the
    telemetry EVENTS, since two of the three paths differ only in which event
    they emit; verified non-vacuous by mutation). **§2.4's "contract test where
    the domain is wider than the corpus" now has two instances and one shape** —
    extract upstream, stub the ports, compare the cross-product.
  - **Two vacuity holes one level below the ones already closed.** A module with
    NO branch-forming construct contributed zero rows and was attested by
    omission; `AttestedModule` now requires a written `noBranchesReason` for an
    empty inventory and refuses one that has stopped being true. And **contract
    X7 had no gate phase at all**: C5x registered none of its three modules in
    the skeleton, `skeleton.test.ts` would have caught it immediately, and a
    green gate carried the omission until this wave's rows shifted the count.
    Both `skeleton.test.ts` and `check-reachability.ts` are gate phases now.
    Generalizing: **a contract nothing runs is a contract nothing enforces** —
    every X-numbered contract should be able to name its gate phase.
  - **C5x's deferred attestation is one third closed.** The summarization prompt
    is a constant, so W3's oracle reaches it and the adjudication is recorded
    (its parity IS the build-time comparison of the initializer against the
    pinned chunk's bytes, which is stronger than a differential red and runs on
    every build). `post-tool-hooks` and `permission-decision` remain C8's and
    C9's. Also: `OS()`'s ~20 prose sections are now RENDERED by the corpus, so
    the section inventory the scout deferred is unblocked — it is not W3's and
    not automatically W4's, and the roadmap should place it deliberately.
