# Reforge-full campaign — ratchet the extracted engine into owned TypeScript until engine-ts assembles

**Status:** approved 2026-08-31; rev 1 + rev 2 same day after adversarial review rounds 1–2 and an
external architecture assessment (see Revision Notes) · **Track:** decomposing (campaign-scale;
this spec is the parent design that `doperpowers:decomposing` cuts into the goal tree)
**Grounding:** `reforge/research/2026-08-31-engine-census.md` (subsystem census of the 2.1.251
bundle, incl. its 2026-08-31 correction) · `reforge/research/2026-08-31-gate-blob-resolution.md`
(how gates actually resolve offline) · `reforge/README.md` (harness + gate doctrine) · cassette
measurement of the headless tool catalog (31 native tools, §1.3) · measured runtime skew (§3.5)

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
consolidation plan gets flagged at review.

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

## Outcomes & Retrospective

Pending — written at finish.

## Revision Notes

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
