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
measurement of the headless tool catalog (22 tools by default, 32 in union, §1.3 — the original read 31; W8 scout 2026-09-02) · measured runtime skew (§3.5)
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
| Session/transcript storage; resume/fork | a 31 KB writer class (136 members, ALL public) + a host-scoped store object + a 6.7 KB pure fold to a 39-field session projection (the W9 scout 2026-09-02; the original read "module-level (Result-monad fs layer)" — that layer is the gate-dead v5 backend) | `fy12d89p` @4–10k (chunk-relative pretty lines ≈3,545–9,900 — CORRECT, do not "fix"; 172,430 B contiguous) + `1x1tv6fk` (path derivation, 2.8 KB). `trstwd25` REMOVED (it is the remote-container dir-sync git worker, §1.2 periphery); `d78hxkfm` REMOVED to an exclusion (generic storage-v5 backend behind `tengu_hover_rest`, default false, no env override) |
| Bash executor (exec/timeout/background) + command-safety AST | four tiers (W10 scout 2026-09-02): S-chunk for the parser, S-method for the safety chain/prompt/tool object (an OBJECT LITERAL, 26 members, zero private fields — not a class), owned data for 17 KB of flag tables, S-module for the process core (four small classes, 11.2 KB, where the private fields actually live) | `fgwne0fb` (62,907 B — the hand-written bash parser, 7 exports, 1 import, zero I/O; never named before), `9e2ns8ty` @108,945–162,000 (53 KB classifier region; the rest of that chunk is W6's), `fy12d89p` @100–105k (correct) + four regions totalling 238 KB; `13d9rycm` as a shared edge. `w7bq1qyb` REMOVED — it is the `claude plugin eval` harness (287 KB leave the row; ~354 KB remain) |
| MCP adapter (thin layer over the vendored MCP SDK) | "thin" survives; "high seam quality" does not — every prose anchor in the MCP surface ties 2× because the layer is a RUNTIME GENERATION FORK (W11 scout 2026-09-02) | `1bxday80` (v1, LIVE at this pin, 187,877 B) and `4mp04j81` (v2, DEAD, 193,087 B) are the same module one generation apart, selected by `bT()` (`cr9f4adc`) reading `MCP_SDK_GENERATION` BEFORE the gate `tengu_brindle_causeway`; eight module pairs fork this way; plus the accessor `6rdsq6fw`, the elicitation impl `5ww6p4vy`, the MCP-skills fetcher, ten MCP control arms (13,051 B) |
| Slash commands + skills loading | high (all in one chunk, anchors clean) — W11 scout 2026-09-02 | `fy12d89p` @3,310–3,495 KB (commands + plugin/skill loading, 133-element registry, 181,873 B declared) and @2,019–2,058 KB (skills belt, 37,960 B) — the "@10–12.5k" locator pointed at prompt-expansion/LSP code; plus `304awr1a` (35,905 B, the expansion path, never named). `g461tywa` is a 302 KB / 198-export grab-bag, not a commands chunk and not S-chunk-able |
| Agent/Task subagent dispatch | HIGH (W12 scout 2026-09-02): the Agent tool is an OBJECT LITERAL (27,595 B, 17 members, zero private fields), its `call` one 22,962 B method, its prompt 16,727 B; only three tiny counter classes (1,681 B) carry private fields. "Nested loop reentry" was the wrong seam: the child loop IS the parent's — `Bb` builds the child's context and delegates to `Kx`, the same generator the headless loop imports, so W12 owns everything that constructs `Kx`'s arguments and cleans up after it, and W13 owns `Kx` | `fy12d89p` @55–58k (CORRECT — about a quarter of the row; five further belts at ≈33.9k observers, ≈47.8k agent-worktree, ≈53.5k child-stream builder, ≈77k inheritance contract, ≈105k task records), ~188 KB. `bf5vvscj` REMOVED — it is the plugin-hooks runtime the ledger already assigns to C8 (112,652 B leave; ~700 B stay as the `agent.spawn` edge) |
| Query loop / turn driver (retry, 529, model fallback, compaction driver, transport + streaming assembler, frames, process lifecycle) | HIGH seam (W13 scout 2026-09-02): one exported entry `Kx` over a 58 KB async generator `DAt`, a four-symbol module boundary (`Kx`, `sX`, `E4n`/`wFt`, `mdt`/`gdt`), ZERO private fields in any class, and an injected deps object `aAt()` = `{callModel, autocompact, uuid, now}` that already declares three of the wave's ports; the cross-turn STATE is NOT in the generator — it is 105 accessors in `chunk-38213y7h.js` (895 importers; ports only, never the chunk) | `fy12d89p` @74.5k (`DAt`, correct) + @85.3–88.2k (transport/assembler `HIt` 67 KB) + @34.1k (retry `kQ`) + @49.1k/@77.3–77.8k (compaction drivers) + @3.1k (shutdown coordinator); `dvbbv89q` (`GH`/`ky`/`hu`/`ku`/`Uy`, 205 KB gross); 42 of `g461tywa`'s exports (frames, 40.6 KB); `29shcjw2` (the 780 B shutdown latch). ~549 KB — the largest row measured |
| Sandboxing (platform launchers behind an interface) | "CEL/protobuf tangle" describes the FILE, not the seam (W12 scout 2026-09-02): the chunk is 83.5 % vendored (picomatch, `@bufbuild/cel` + protobuf, `@anthropic-ai/sandbox-runtime` — 478,991 B, all §1.2, engine-ts imports the packages) with a single clean split at offset 485,420; the Claude-Code-own layer is 94,760 B / 230 declarations, its façade `pt` a 2,672 B object literal with no private field on the path; the seatbelt profile builder `PR` is a PURE `inputs → text` function (the wave's cheapest oracle needs no host); on macOS the effectful residue is under 3 KB and `checkDependencies()` never probes `sandbox-exec` (assumed from platform identity — a missing binary surfaces at first spawn) | `q4xe0m2r` @485,420–581,554 (the owned sixth) + `6v95pkgg` (44 self-named sandbox exports — a barrel the symbol map lacks) |

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
| **Gate-dead with no lever at this pin** (added 2026-09-03, C11a's boundary review; `tool/Monitor` behind `tengu_amber_sentinel`) | — | the row's WHOLE surface is unreachable at the pinned engine: the gate's compiled-in default hides it and no env override in the gate fixture reaches it. **PIN-CONDITIONAL — it re-enters the canonical rows on a pin bump that flips the default**, and the condition is declared per row (`ExcludedRow.gateDead`) and held against `research/fixtures/gate-defaults-<pin>.json` by `ledger/check.ts`, so the bump reddens the ledger instead of relying on someone remembering |

**Feature gates are neither spliced nor excluded** — see §3.3 (the resolver is GrowthBook and
reforge pins the disabled state explicitly, snapshots the call-site defaults, and locks the
gate-relevant environment). That rule is about gated CODE INSIDE an owned row, and it does not
answer the different question the row above asks: a row whose ENTIRE surface a gate makes
unreachable has nothing to splice and cannot be closed, so leaving it in the ledger would record
permanently unclosable work as outstanding. Hence the one exclusion kind that expires: every other
row in this table is out structurally and forever, this one is out only while the pin says so.

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
  leaked child processes/sockets, and exit codes/signals between engines. (Delivery status, C12a/W9a 2026-09-03: the
  config-store half **LANDED**. `src/state.ts` snapshots a LIST of roots — the sandbox walked whole,
  the config dir through the scout's §4.2 include-list with a per-record semantic transcript
  projection — and all three oracle capabilities exist: a declared per-scenario config precondition,
  a filesystem fault surface, and a flush decision taken by measurement (`CLAUDE_CODE_EAGER_FLUSH`
  in X6, with its negative control as a gate phase). Process supervision remains W9's named
  carry-over, not assumed delivered; the third root — the dispatched-agent output directory —
  is C15a's one-line seam, deliberately not registered here.) Transcripts and requests
  agreeing does not preclude a stray process or a divergent session file — cross-resume's store
  diff already proved this surface catches what the others miss.

### 3.3 Gate determinism — pin the disabled state, snapshot the defaults, lock the environment

Empirical grounding (`reforge/research/2026-08-31-gate-blob-resolution.md`): the flag provider in
2.1.251 is **GrowthBook** (the `statsig` literal is a vestigial cache path); both the bootstrap
fetch (`/api/claude_cli/bootstrap`) and the disk-cache read are **already disabled** under
reforge's environment, so every gate resolves to its compiled-in call-site default (505 call sites, 439
distinct gates — re-measured from the committed fixture by the W8 scout 2026-09-02; the original read 431/379) with `source:"disabled"`. The original "snapshot the blob into `reforge/config`"
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
| W9 | Session/transcript storage (`SessionPort` + 6 sibling ports, 2 stubs) | **S-module debut** (fable), cut into four children 2026-09-02 | storage/resume depth + dirty-state matrix (14 cells, D1–D14); a synthetic TRANSCRIPT corpus (constructed files — the cheaper of the two synthetic corpora, and the one this subsystem needs) + the config half of the state-surface diff come online |
| W10 | Bash executor + command-safety AST | S-chunk (parser) + S-method (safety chain) + owned data + S-module (process core); the class-method shape is NOT needed; cut into six children 2026-09-02 | bash depth + the backgrounding moat (which has NO scenario today: zero of the corpus's Bash calls set `run_in_background`) |
| W11 | MCP adapter + slash commands + skills loading | S-method/S-chunk (the live MCP generation behind `McpClientPort`; two small S-chunks in skills); ONE family, three children 2026-09-02 | mcp/skills scenario families + the stdio-vs-SDK transport probe |
| W12 | Agent/subagent dispatch + sandbox interface — TWO disjoint cores (no shared state, effectful call or caller); the `ToolRuntimePort` name covered three disjoint boundaries and is retired in favour of `AgentRuntimePort` + siblings, `SandboxPolicyPort`/`SandboxExecPort`, and a separately-routed `ToolInvokerPort` | S-module (fable), cut into C15b (sandbox, first) + C15a (subagent) 2026-09-02 | subagent depth (a scripted child — `Options.agents` is unused corpus-wide, no recorded child has ever called a tool); the sandbox's golden-file profile oracle + one host-capability control; survivor supervision with DECLARED survivors |
| W13 | Query loop / turn driver (`QueryLoopPort` = upstream's own `zve({run})` parameter; `ModelTransportPort` = `aAt().callModel`); **inversion milestone**; **hermetic isolation substrate** (§3.6) | S-module (fable), cut into seven children 2026-09-02 — three things, not one: the loop, the inversion (a decision + a declared out-of-process delegation route), the substrate (shares no file or port with either) | controlled retry/interleaving + long-horizon traces; the synthetic RESPONSE corpus (spec-mandated since W9, still absent) is C16a's; per-event stream control in the replay proxy |
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

#### C12: W9 — session storage — CUT 2026-09-02 into C12a–C12d (see Deferred, "The W9 cut")
- Scouted (`reforge/research/2026-09-02-w9-session-storage-scout.md`): the layer is 172 KB
  contiguous in `fy12d89p` with a fully PUBLIC writer class (no private fields — the opposite of
  W10's Bash executor), upstream's own semantic barrel (`chunk-e6cn1914.js`, 235 names, a dozen
  `*ForTesting` injection points) names the whole API, and the corpus writes 8 of 37 record types.
  Not one S-module wave: the reader is gradeable from CONSTRUCTED FILES with zero engine runs while
  the writer is gradeable only against a live drain schedule, so fusing them would put the cheapest,
  highest-yield unit behind the hardest. Machinery child first (three oracle capabilities only this
  subsystem needs: flush-schedule control, dirty-precondition seeding, filesystem fault injection),
  then reader → writer → GC/damaged-file paths. Blocked-by C1/C2/C3 (met). **Required.**
  Status: C12a unblocked, not-dispatched; C12b–d blocked in sequence.

#### C13: W10 — bash executor + safety AST — CUT 2026-09-02 into C13a–C13f (see Deferred, "The W10 cut")
- Scouted (`reforge/research/2026-09-02-w10-bash-executor-scout.md`). **The private-field
  blocker is answered by measurement: S-module, do not build the accessor adapter.** The tool is
  an object literal; the private fields live in four small classes (11.2 KB) and guard ~25 KB of
  effectful residue out of a ~354 KB row. A whole-class adapter would need ~83 accessors of which
  31 field identities are POSITIONAL-ONLY (bare declarations, no initializer, nothing to anchor)
  — a derivation that cannot be machine-checked, contradicting §2.1's literal-anchoring bet and
  §3.4's zero-positional rule. The class-method shape is not needed anywhere in W10. The other
  two thirds are pure and unblocked today: the parser chunk (the cleanest S-chunk candidate the
  campaign has found, 45× the pilot's size) and the safety chain with its data tables.
  **Charter (2026-09-01, C4 flow-back) stands: `subsystem/tool-result-validators` rides with C13f.**
  Status: C13a/C13b/C13c unblocked (disjoint files; serialize on the shared manifest/gate/ledger
  surface behind C10.6 → C11a → C12a); C13d–f advisory behind their triggers.

#### C14: W11 — MCP adapter + slash commands + skills — CUT 2026-09-02 into C14a–C14c (see Deferred, "The W11 cut")
- Scouted (`reforge/research/2026-09-02-w11-mcp-slash-skills-scout.md`). One family, not two
  waves: a single host switch disables both the slash surface and the `Skill` tool, MCP prompts
  enter the COMMAND registry and are expanded by the same path, MCP resources enter the SKILL list,
  and C10's owned `initialize` handler configures all three in one arm. The MCP half is a runtime
  generation fork (v1 live, v2 dead, selected by an env var that precedes the gate), so every MCP
  prose anchor ties 2× — a targeting nuisance bounded by the manifest's per-chunk anchor
  resolution and by the gate's solo-sabotage liveness rule (a splice landing in the dead
  generation stays GREEN under sabotage, which the tightened rule already fails loudly); C14c owes
  the control that proves both. Status: C14a unblocked; C14b/C14c behind their triggers.

#### C15: W12 — subagent dispatch + sandbox — CUT 2026-09-02 into C15b (sandbox, first) and C15a (subagent) (see Deferred, "The W12 cut")
- Scouted (`reforge/research/2026-09-02-w12-subagent-sandbox-scout.md`, sixteen corrections). The
  two cores share no state, no effectful call and no caller; their oracle needs are disjoint; their
  blockers are opposite in kind — **the sandbox is one settings key away today** (`Options.settings
  .sandbox` is a TYPED member of the installed SDK's options, plus a direct `Options.sandbox`; both
  bypass the environment and survive `settingSources: []`), retiring fourteen standing attestation
  exclusions and unblocking the `SandboxPort` stub C13d waits on; the subagent core's most valuable
  arms need machinery that does not exist. The fork subagent is MODE-DEAD — a fifth class beside
  gate-/env-/entrypoint-/settings-dead: `adr()` returns "disabled" when `Le()` (`!isInteractive()`)
  is true, which it is on every headless run; the lever `CLAUDE_CODE_FORK_SUBAGENT=true` is outside
  X6, and flipping it also REMOVES `run_in_background` from the Agent tool's presented schema
  (reddening `background-task`) — a catalog-shape flip, not a behaviour flip. Neither half inherits
  W10's blocker. **Required.** Status: C15b1, C15a1, C15a2, C15a3 unblocked (disjoint files;
  serialize on the shared surface); C15b2, C15a4, C15a5 behind their triggers.

#### C16: W13 — query loop + inversion + hermetic substrate — CUT 2026-09-02 into C16a–C16g (see Deferred, "The W13 cut")
- Scouted (`reforge/research/2026-09-02-w13-query-loop-scout.md`). **Upstream already ships the
  inversion seam as a named parameter**: all three surfaces that run a turn construct the session
  by passing the loop IN — `zve({run: Kx, …})` — so `QueryLoopPort` is that argument, not a port to
  invent; and the loop's default deps factory `aAt()` names `callModel`/`autocompact`/`uuid`/`now`,
  so `ModelTransportPort` and `CompactionDriverPort` are upstream's shapes too. The row is ~549 KB
  with zero private fields and a four-symbol export surface. The headless turn entry is a gate
  fork (`tengu_print_engine_loop`, default false): the corpus drives the legacy `ask()` side
  (`ku` → `hu` → `Kx`); the `createHeadlessSession` side is gate-dead. Nine deferrals measured and
  placed (see the cut); the model-switch pair is NOT W13's. Three things, not one — the loop is
  ownable when its oracle capabilities exist; the inversion is a decision plus a delegation route
  that must survive §3.6's four negative controls (the only shape that does: an OUT-OF-PROCESS
  supervised delegate over one declared channel, so `check-reachability.ts` keeps its static ban);
  the substrate gates nothing until an engine-ts-primary artifact exists. Blocked-by: C16a/C16b
  nothing (cut now; serialize on the shared surface); C16c–g per the table. **Required.**
  Status: **C16b LANDED 2026-09-03** (the process lifecycle — see the tracking row and the Revision
  Note; it also ships the signal-delivery primitive C16a's capability (iii) generalises, and corrects
  the scout's L17 premise); C16a not-dispatched, unblocked; C16c–g advisory behind their triggers.
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
  five helpers are the auto-react and task-notification subsystems (four in `chunk-fy12d89p`) — and
  the W8 scout (2026-09-02) measured their firing condition as an artifact auto-react subscription
  whose only two writers sit on the gate-dead Monitor WebSocket path, so they are an EXCLUSION with
  named guards, not W8's coverage debt (superseding the routing this sentence first recorded); `rewind_files` (`Tf`,
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
  own design passes). **Model-switch pair, re-placed by the W13 scout (2026-09-02):** "stateful"
  was a reason to find the holder, not to defer — `mdt`/`gdt` run through `jy` (hook-executor
  calls), their holder `qvt` (`{pending, landedOn, inFlight}`, three PUBLIC fields) is a
  session-scoped `Ln` store two stores away, and the arm is ALREADY driven by the corpus:
  `km`/`set_model` (C10-owned) calls `CS` (`chunk-9gqmx4zx.js`) which calls `mdt` with the
  re-validation loop, so `runtime-setters` and the raw driver's `set_model` case are its coverage.
  → **C10.7 inherits the pair** on the hook-family template with the store behind a port; the
  `hooks-model-switch` recording the ledger gap named is one `set_model` frame away. Track hint: controlled worker; the executor design pass gates the
  implementation half.
- **The executor cut (2026-09-02, C10.5 review converged on code, doc round closed):** the
  hook-executor implementation becomes its **own wave family**, not a fold into W8. Folding it in
  would recreate the shape this campaign has already paid for twice — a module shipped ahead of its
  oracle — because Stage 0 is oracle machinery **only this subsystem needs**, and a wave that owns
  something else would carry it as overhead and be tempted to skip it. Three children, cut at the
  frontier, each reviewed before the next is cut. The design doc as corrected in C10.5's boundary
  round (`reforge/research/2026-09-02-w75-hook-executor-design.md`) is the brief for all three.
  - **C10.6 / W7.6a — Stages 0–1** (track: controlled, opus-tier). **Stage 0 is oracle machinery:**
    the hooks oracle's per-port call lists rewritten as ONE interleaved event log with cleanup
    pairing — which retires the standing tech-debt entry, and is a precondition rather than a
    companion, because "every derived signal was cleaned exactly once" over six release paths plus a
    catch is a property only an ordered log can state; stdout **write-boundary** reproduction on the
    replay surface; and non-settling-path grading (stub `SchedulingPort.isShuttingDown()`, then
    assert "no yields and not settled within N ms"). **Stage 1 is the ~13.9 KB pure belt**, led by
    `Fq`, the JSON-contract interpreter (5,993 B; five call sites, all transitively `Qxt`'s; pure
    given an injected clock; it THROWS on an unknown decision or a mismatched event name —
    **reproduce that, do not fix it**), graded entirely by the contract-test shape with no new
    scenario. Carried with the stage: the **module-level-state reset obligation** in the harness —
    the failure-notice singleton, the shutdown flag, six host-scoped lazy singletons and the
    plugin-usage map, none of which is per-session, so a replay that does not reset them leaks
    between scenarios.
  - **C10.7 / W7.6b — Stages 2–3** (fable-tier; cut when C10.6 lands). `HookSourcePort` — whose
    consumers are `Rzn`, `Qxt` **and** `DUt`, the host-facing prompt-submit fingerprint — plus the
    matcher owned pure **with its one `EnvironmentPort` read** (`defaultShell()`, which the dedupe
    key `AM` falls back to). Then `AE` and `zxt`.
  - **C10.8 / W7.6c — Stages 4–5** (fable-tier; cut when C10.7 lands). `ProcessPort` and the
    command-spec builder lifted out of `Nq`, serving the three non-hook callers through the same
    port; then `Qxt` with the merge, the aggregation projection and the permission-precedence
    reducer. **[parent-impact from the W10 scout, 2026-09-02]:** `Nq` uses the process handle
    (`B2`) and the output buffer (`jx`) directly and never touches the Bash-specific spawn layer
    (`LG`: shell provider, snapshot, sandbox wrap, worktree guards, cwd write-back — whose only
    other consumer is PowerShell). So `ProcessPort` should be DESIGNED as the two ports W10 will
    share — `ShellProcessPort` (handle) and `ShellOutputSinkPort` (buffer, spill, truncation) —
    and must not absorb the layer above; C13d takes that layer behind Bash-only ports.
  - **Binding across all three:** two consumers of shared pure helpers, **never one core with
    façades** — their return types are disjoint and `AE` drops the `hookSpecificOutput` permission
    contract on thirteen events, so a unified core would make it honour fields upstream drops,
    exactly where the gate is weakest; the **nine-port partition of design §3.2 as amended**;
    `Li = 600000` preserved as the default hook timeout (ten minutes, not sixty seconds — an owned
    copy that "corrects" it changes real behaviour). `subsystem/hook-dispatch` reaches
    `standalone-complete` only at the end of C10.8, though each child moves the row's evidence.
- **The W8 cut (2026-09-02, from `reforge/research/2026-09-02-w8-moat-tools-scout.md` — adopted
  with grades):** the moat surface is ~260 KB (89.5 KB of tool objects + ~170.5 KB of shared cores),
  the headless catalog is 22 tools by default, 20 of them W8's, 16 of those never executed by any
  scenario though all 20 render description and schema onto every graded request. Four children,
  ordered free-coverage → probe → stateful core → the subsystem the probe decides:
  • **C11a / W8a — the description-and-formatter belt** (autonomous, opus-tier; cut NOW, dispatch
    after C10.6 lands and is reviewed — both edit the manifest/gate/ledger/attestation): the 16
    tool description/prompt builders and schema getters already live on every request body, plus
    the zero-and-low-capture formatters (`TaskCreate`/`TaskGet`/`TaskList` at 0 captures,
    `ReportFindings`, `ScheduleWakeup`, `TaskUpdate`, `TaskOutput`). Zero new recordings (one
    `task-family` re-record to widen its ordering assertions); every sabotage RED on a named
    existing scenario; the zero-capture formatters get contract tests over partitioned inputs.
    Rides along: the ledger corrections the scout measured (`tool/PowerShell` row → C13/W10;
    `tool/WebFetch`/`tool/WebSearch` reassigned off C11; `subsystem/moat-tools` edges to
    session-storage, hook-dispatch, subagent-dispatch, bash-executor, permissions; a `Monitor`
    exclusion line with its gate as the guard).
  • **C11b / W8b — reachability probes and the recordings they justify** (controlled, opus-tier;
    cut NOW, blocked-by C11a): `w8/probe-tool-reachability.ts` (one session per catalog tool,
    FIRED/DEAD/OPEN with a cited guard — the W7 subtype probe's shape on the tool axis),
    `w8/probe-cross-session.ts` (the scout's §6.4 design: two live engines sharing a config
    directory; the ONE live check that decides C11d), the 9–11 recordings the probes rank, and the
    seventh pin-keyed fixture `tool-catalog-2.1.251.json` derived from `Y0()`'s 67 elements with
    per-tool guard expressions and measured corpus presence. Rides along: the gate-fixture
    extractor's `recordEnvOverride` widened to accept a coerced return (`Me(e)`), which is why the
    override inventory misses the cross-session kill switch `CLAUDE_CODE_HARBOR_KITE` — AND (W11
    scout) the second, structurally different blind spot: an env arm that PRECEDES and bypasses the
    gate (`MCP_SDK_GENERATION` is read before `tengu_brindle_causeway` is consulted), which hides a
    whole-subsystem switch; plus `research/tools/symbol-map.ts` harvesting `export{X as Name}`
    aliases (three W11 chunks name their own API — 112/121/63 names — and the map has no entry for
    them). Both are C3-fixture work handed to the wave that next touches the extractors, not patched
    inside a tool wave. The `tool-catalog` fixture must also carry the catalog's THREE contributors
    (natives after `bE` strips four names; MCP tools incl. the three resource tools a server can
    re-add; `skillTools`), sorted in two groups by `SD`.
  • **C11c / W8c — the task and notification core** (fable-tier; ADVISORY, cut when C11b lands):
    `TaskStorePort`, `TaskOutputPort` (READ-SIDE only — the W10 scout measured `DiskTaskOutput`
    with ONE constructor site bundle-wide, the Bash executor's spill path, so its twelve private
    fields and six private methods go behind W10's `ShellOutputSinkPort`; the task tools reach task
    output through free functions), `NotificationQueuePort` over the `ssn` closure factory (10.9 KB — harder
    than a private-field class: no receiver exists to marshal through), and the three frame
    emitters; §3.1's S-module bar. Edges → C12/W9 (both storage leaks), C15/W12, C13/W10, C8/W5.
  • **C11d / W8d — cross-session messaging** (fable-tier; ADVISORY, cut ONLY if C11b's probe
    fires): ~100 KB across eight chunks the campaign never counted; live headlessly because the
    kill switch `Yo()` reads `tengu_harbor_kite` whose compiled-in default is TRUE (the committed
    fixture confirms `{"default":true}`), so §3.3's pinned-disabled policy leaves it on. Inbound
    policy gate first (9.7 KB, no classes, a settings axis `Options.settings` can drive), then
    `SendMessage`'s validation/permission/render functions as S-method rows, `ListAgents` as the
    campaign's first single-export S-chunk row. If the probe says a second addressable session
    cannot be created under the harness, this child collapses to the refusal arms.
  • **Not W8's** (binding): `Monitor` (gate `tengu_amber_sentinel` default false, no env override
    — the measured answer to "the moat includes persistent notifications", recorded as an
    exclusion), the interrupt helpers (artifact surface), `RemoteTrigger.call` (server boundary),
    `PowerShell` (W10's chunk), `WebFetch`/`WebSearch` (C5's / the server's), `Skill` (C14),
    `Agent` (C15), the `background_tasks_changed` emitter (`chunk-g461tywa.js`, unowned).
- **The W9 cut (2026-09-02, from `reforge/research/2026-09-02-w9-session-storage-scout.md` —
  adopted with grades):** four children, machinery first, for the same reason as the executor cut.
  • **C12a / W9a — storage oracle machinery** (controlled, opus-tier; cut NOW): (1) `src/state.ts`
    gains a second root over `reforge/config/` with the scout's §4.2 include-list and a per-record
    semantic transcript projection (today it sees the sandbox only; `m2/cross-resume`'s
    `{type, role, sorted keys}` shape diff cannot see a wrong `parentUuid`, a divergent `leafUuid`
    or a torn tail); (2) the differ's run-id MAP extended to `parentUuid`, `logicalParentUuid`,
    `leafUuid`, `promptId`, `agentId` and the project-key slug, each with a `src/differ.test.ts`
    regression per §3.4; (3) a declared per-scenario config-directory PRECONDITION primitive (every
    interesting storage case is a statement about the filesystem before the run, and the harness
    cannot declare one); (4) a filesystem fault surface generalising `src/faults.ts` (torn tail,
    `parentUuid` cycle, `ENOSPC` — none reachable by prompting a model); (5) the flush-schedule
    decision — the transcript is written on a 100 ms timer, so two identical engines can leave
    byte-different files: either `CLAUDE_CODE_EAGER_FLUSH` enters X6 with a negative control or the
    snapshot waits on an observed quiesce — DECIDE and write it down. Acceptance: a seeded torn
    tail, a seeded cycle and a seeded `ENOSPC` each produce a named stable verdict on both engines;
    each new run-id rule fails a mutation of itself; the config snapshot is byte-stable across two
    replays — which REQUIRES (W11 scout, 2026-09-02) normalizing `.claude.json`'s `skillUsage`: it is
    the shared invocation counter for prompt-type slash commands AND the `Skill` tool, written by
    `Ndt` with a 60 s per-session debounce and never reset, monotonic across the corpus (155 today
    from the W5 probe's project command alone); a value-scrub in the differ or a reset in
    `resetSandbox()`, decided with C14a, or the criterion cannot pass once any slash/skill scenario
    exists. Riders: the ledger's `subsystem/session-storage` row gains its symmetric edges (→ C11c
    for the shared `queue-operation` record and the task store's session-keyed directory, → C11d for
    `<config>/sessions/`, → C7 for `compactMetadata`, → C15/W12 subagent transcripts, → C16/W13 the
    segment form) and its 235-name public surface as artifact list; `d78hxkfm` recorded as an
    exclusion with `tengu_hover_rest` as the guard; `resetSandbox()`'s config-dir policy decided
    (today `tasks/`, `session-env/`, `projects/` accumulate forever — 1,087 / 3,939 / 412 entries).
  • **C12b / W9b — the reader** (fable-tier; blocked-by C12a): the pure heart — the 6.7 KB fold,
    the chain helpers, the record classifier, the projection assembly, the tail scanners,
    `ENTRY_APPEND_POLICY` as data — behind `SessionIdentityPort` and `TelemetryPort` only, the
    direct-fs arm behind `TranscriptFsPort`. §3.1's S-module bar reached WITHOUT a new recording: a
    synthetic transcript corpus over the 37 record types, the boundary forms, leaf resolution
    (explicit, implicit, `clearedToEmpty` — zero corpus coverage today, multi-leaf, cycle), the torn
    tail and the three classifier outcomes, each case with an explicit oracle expectation; the
    mutation battery; a port trace (the fs arms differ by which reads ran, not by their answer).
    Binding: `summary` is a READ-ONLY legacy record at this pin (zero writers bundle-wide) — own the
    reader arm, never invent a writer.
  • **C12c / W9c — the writer and its lifecycle** (fable-tier; blocked-by C12b): the write queue,
    `appendEntry`'s three-policy dispatch, the message-chain envelope, `materializeSessionFile`
    (absorbing the C1 splice), metadata re-append, pointer reset / metadata restore / resumed-file
    adoption / fork adoption, the shutdown seal and exit re-stamp — behind ports 1–6. Mutation
    battery must kill: dropped `pendingEntries` replay, queue item resolved before its bytes landed,
    lost store fence, metadata block before entries, materialized without emitting.
  • **C12d / W9d — the GC and damaged-file paths** (fable-tier; blocked-by C12c): the transcript
    compactor, remove-by-uuid, the seal family, relocation; the atomicity contract asserted
    directly (temp file at 0600, inode check refuses a changed source, rename the only mutation,
    the non-atomic splice DECLARED non-atomic). Last because every arm needs C12a's fault surface.
  • **Port surface, binding-candidates** (the scout's §3, held to at implementation): seven ports
    (`TranscriptFsPort`, `SessionIdentityPort`, `SessionStorePort`, `SchedulingPort`,
    `TelemetryPort`, `MirrorPort`, `SessionQueryPort`) + two throwing stubs (`StorageV5Port`,
    `PeripheryPort`). `renameOver` and `truncateAndSplice` stay DISTINCT members (the one atomic and
    the one non-atomic path); `persistenceSuppressionCause()` returns the four-valued cause, not a
    boolean; the store port is re-read per invocation, never cached across an await; `setTimer` is
    injectable; the v5 stub THROWS (a silent `undefined` looks like the correct false arm).
  • **Not W9's**: the two 500-importer infrastructure chunks; `d78hxkfm` (gate-dead); `trstwd25`
    (dir-sync periphery); bridge/CCR/artifact records (21 KB, stubbed); the resume LOOP half in
    `dvbbv89q` (C16/W13); `ssn` itself (C11c — but the `queue-operation` record contract is shared,
    and its contract test should be written once).
- **The W10 cut (2026-09-02, from `reforge/research/2026-09-02-w10-bash-executor-scout.md` —
  adopted with grades):** six children in four mechanism tiers; the machinery child runs in
  PARALLEL with two children that need none, because the private-field measurement moved 179 KB
  of the 354 KB row off the blocker's critical path.
  • **C13a / W10a — the shell parser, whole-chunk** (autonomous, opus-tier; cut NOW): own
    `chunk-fgwne0fb.js` outright — 62,907 B, 107 declarations at 99 % density, 7 exports, 4 named
    importers, one import of its own (telemetry), zero `process.`/`require`/fs. A hand-written
    recursive-descent bash tokenizer/parser emitting tree-sitter-shaped nodes. Full export-and-
    consumer inventory per §2.2, branch attestation from the chunk's own AST, contract tests over
    partitioned command strings (quoting, heredocs, brace expansion, arithmetic, process
    substitution, the byte-offset table, the length cap, the abort symbol). Riders: the ledger's
    `tool/PowerShell` row (→ C13) and `subsystem/tool-result-validators`'s wave field (C4 → C13).
  • **C13b / W10b — the command-safety chain and its data tables** (autonomous, opus-tier; cut
    NOW; parse types from C13a): the five engine-chunk regions (124,832 B) + `9e2ns8ty`'s
    classifier region (53,180 B: the parse entry, the eleven-predicate too-complex gate, the 10 KB
    command-tree walker, argv/env/redirect/heredoc extraction). Own the ~17 KB of flag/effect
    tables outright with adapter equality assertions; S-method rows on the prose anchors (≥16
    anchors 1-of-1 across all 1,800 module files — "Bash has no graph-unique literal" was true of
    the FORMATTER only; correct the README note); fold in the unanchorable pure helpers at their
    spliced callers. Adds `bash-compound-safety`, which closes the two live-but-dark `Fy` callers
    W6 recorded (the multi-cd aggregator and the subcommand merge tie-break). Edge → C9/W6: this is
    the Bash half of the permission surface — the `subcommandResults` aggregate every corpus Bash
    denial carries. Rider: the `bash-tool-result` row's `useTaskAck` capture derives from a gate
    (`FE()`) that returns `!1` unconditionally in this build — the capture is live, the BRANCH is
    dead; say so in the row.
  • **C13c / W10c — executor oracle machinery** (controlled, opus-tier; cut NOW; serializes per
    X5): the three capabilities no oracle has and only this subsystem needs — a scripted child
    process committed into the sandbox with a declarative argv (byte schedule, exit code, signal
    behaviour, prompt-shaped tail); injectable timers for the six shell deadlines (2 s background
    hint through 45 s stall detect); child-process SUPERVISION as `src/state.ts`'s third snapshot
    root (descendant set at scenario end, deliberately-detached children declared) — W9's named
    carry-over lands here. Each with a negative control (a perturbed schedule changes the graded
    output; a leaked child FAILS the state diff; a perturbed timer moves the background hint).
    Plus the six recordings that need no machinery. (The sandbox-exclusion rider first filed here
    MOVED to C15b1 — the W12 scout measured the remedy as an `Options` field, not an env fight:
    `Settings.sandbox` is a typed SDK member and `Options.sandbox` a second direct route; fourteen
    exclusions across `permission-precheck` and `rule-based-permissions` argue unreachability from
    the ENVIRONMENT, none from the OPTIONS, and the options are the reachable path.)
  • **C13d / W10d — the executor S-module** (fable-tier; ADVISORY, cut when C13c lands):
    `ShellProcessPort` + `ShellOutputSinkPort` (SHARED with the hook runner per the C10.8
    parent-impact above), `ShellProviderPort`, `CwdTrackingPort`, `ShellTimingPort`,
    `ShellTelemetryPort`, and `SandboxPort`/`RemoteConstraintsPort` as throwing stubs. Owns the
    four private-field classes (`Pde` pure lifecycle: status/kill/background/detach/cleanup;
    `jx` a handle wrapping a pure core — line counting, tail sampling, truncation — split along
    that line; `C_t`/`DiskTaskOutput`; `vde`/`jUe`), `LG`, `Gcr`, the snapshot machinery and the
    cwd write-back (`tengu_shell_set_cwd`) — ~25 KB effectful + ~25 KB snapshot. §3.1's full bar:
    the D1–D14 dirty-state matrix (cwd persistence across calls, env inheritance, background job
    lifecycle, kill on abort, timeout, output over the truncation threshold), the mutation battery
    (swallowed exit codes, dropped kill escalation, reordered progress yields, ignored cancellation,
    wrong task-id propagation, missing spill). Edges → C8/W5, C15/W12, C11c/W8c (`TaskRegistryPort`),
    C12/W9 (`storageV5` output persistence — gate-dead today).
  • **C13e / W10e — the backgrounding and notification moat** (fable-tier; ADVISORY, cut when
    C13d's ports exist; its scenarios may start when C13c lands): `Gcr`'s four arms —
    `backgroundedByTurnAbort` is DEAD headlessly (sole producer of `turn-abort` is the interactive
    session controller `6thm48px`; the headless loop never constructs it — recorded with the
    producer named); `backgroundedByUser` is the CHEAPEST route to the moat behaviour: the
    `background_tasks` control subtype the installed SDK can send, which W7 fired against an empty
    registry (FIRED arm / UNREACHED effect — correct the W7 matrix row); plus the explicit
    `run_in_background` arm, the stall detector, the pressure reaper, the `background_hint` progress
    channel. Records `bash-background-explicit` and `bash-background-control`. Separate from C13d
    because it is the wave's PRODUCT CLAIM — "bash with background notification" is one of the
    four named moat behaviours and has NO scenario today (the `background-task` scenario drives the
    AGENT tool's flag; zero of the corpus's Bash calls set `run_in_background`).
  • **C13f / W10f — PowerShell and the validators row** (autonomous, opus-tier; ADVISORY, cut
    last): `tool/PowerShell` (tool object, schema, prose, cmdlet tables; the executor comes free from
    C13d — `hw8qz4q5` imports 62 engine symbols and shares `LG`/`jx`/`Kee`/`Kdt`) behind the
    `CLAUDE_CODE_USE_POWERSHELL_TOOL` recording axis; `subsystem/tool-result-validators` (the Edit
    `validateInput` unit + its 19 siblings).
  • **Binding across W10**: S-module for the process core, NO accessor adapter (joint-view reason:
    31 positional-only field identities cannot be machine-checked — §2.1/§3.4); the two shared
    ports with the hook runner and nothing above them; `detectBlockedSleepPattern` is gate-dead
    (its one caller's arm is guarded on `tengu_amber_sentinel`, the Monitor gate — the "Monitor
    with an until-loop" prose in the tool description ships gated off at this pin).
  • **Not W10's**: `w7bq1qyb` (plugin eval), the sandbox chunk `q4xe0m2r` beyond the `SandboxPort`
    stub (C15/W12), the task store/notification queue (C11c), the permission pre-check (C9).
- **The W11 cut (2026-09-02, from `reforge/research/2026-09-02-w11-mcp-slash-skills-scout.md` —
  adopted with grades):** one family, three children, separated by MECHANISM not topic.
  • **C14a / W11a — the command-and-skill filter belt** (autonomous, opus-tier; cut NOW): (1) the
    eighth pin-keyed fixture, `slash-commands-2.1.251.json`, derived from the registry assembler
    (`frr()`) — one row per element: name, aliases, type, `supportsNonInteractive` /
    `disableNonInteractive`, `isEnabled` source, `isHidden`, load-thunk chunk, and its `k0t`
    verdict; gate-checked. The headless filter, measured in full: `type==="prompt" &&
    !disableNonInteractive || type==="local" && supportsNonInteractive` — W7.5 recorded only the
    `local` clause; the `prompt` clause admits BY DEFAULT (project command files, plugin commands,
    MCP prompts), and twenty commands ship a purpose-built headless implementation selected by
    `Le()` (`!isInteractive()`); 28 of 104 statically-resolvable entries pass; the corpus reaches
    two. (2) The filter core as ONE owned module (`k0t` 0 captures, `Rce`, `Xve`, `SD`, `krr`, `sz`,
    `oX` — seven fold-ins, ~1.6 KB). (3) The skill-usage module (`Ndt`/`Tqn`/`WIe`) with `xft`'s
    usage fields behind a port to W9's config writer, and the `skillUsage` normalization C12a's
    byte-stability criterion requires (decided jointly). Acceptance: a contract test over `k0t` ×
    the fixture population (a filter with a complete enumeration is the cheapest non-vacuity
    instrument in the wave); one recording — a batch session driving three or four `Le()`-gated
    commands, converting the headless-only slash surface from a reading into a graded fact.
  • **C14b / W11b — reachability probes and the recordings they justify** (controlled, opus-tier;
    blocked-by C14a on the shared surface, X5 for recordings): `w11/probe-mcp-transport.ts` — four
    phases, with the SDK-NEGATIVE phase written in: elicitation is live headlessly for STDIO
    servers and explicitly skipped for in-process SDK ones, so the obvious cheap probe would have
    produced a clean-looking false negative; a committed fixture MCP server (stdio and SDK builds of
    the same server: clean tool, `anyOf` tool, invalid-property-key tool, all four `_meta` keys,
    resources, prompts, an eliciting tool); the `pf` permission-prompt-tool probe through the raw
    driver; 11–14 recordings. Resolves the hook registry's two `Elicitation*` OPEN rows to
    FIRED-with-stdio / MEASURED-DEAD-with-SDK with the measurement; ledger rows for
    `tool/ListMcpResources`, `tool/ReadMcpResource`, `tool/ReadMcpResourceDir`, `tool/RefreshMcpTools`
    and the `mcp__*` projection family (X2: one row per catalog tool). The `Skill` tool (7,284 B,
    a thirteen-code refusal matrix) and `qdt` ride here so splice and scenario land together.
  • **C14c / W11c — the MCP adapter behind `McpClientPort`** (fable-tier; ADVISORY, cut when C14b
    lands): the LIVE generation `chunk-1bxday80.js` — lifecycle (`connectToServer`'s stdio/http/sse
    arms, `ensureConnectedClient`, the dial memo with identity-epoch eviction, reconnect,
    `setupSdkMcpClients`), `hydrateToolsFromListing` as the projection (the highest-value single
    function; eight `tengu_mcp_degraded` cells give the mutation battery real targets), the call
    path, the elicitation implementation (`5ww6p4vy`, 3,427 B, five functions — take whole), and a
    generation-guard tripwire reproducing the accessor's. Plus the ten MCP control arms (13,051 B —
    C10 routed `mcp_message`'s 58 B here; the surface is 120× that line) for whichever have
    gradeable success paths. Binding: every MCP row's anchor is scoped to `chunk-1bxday80.js` (the
    manifest resolves anchors per chunk, so the 2× tie across the fork is a targeting nuisance, not
    a mechanism gap), AND the wave ships the negative control that a row aimed at
    `chunk-4mp04j81.js` FAILS — the gate's solo-sabotage liveness rule should already refuse it
    (a dead-generation splice stays GREEN under sabotage), and the control proves that it does.
    Risk stated plainly: if C14b's phase A says a stdio server cannot be driven under the harness,
    this child narrows to the SDK transport plus the projection.
  • **Not W11's**: the vendored SDK + zod chunks; the Chrome and Computer-Use in-process servers;
    `claudeai-proxy` and the OAuth redirect leg (server boundary); `sse-ide`/`ws-ide`; the v2
    generation (exclusion with its env lever named); `g461tywa` (take exports, never the chunk);
    the hook dispatchers themselves (W5 owns them; W11 owns their call sites).
- **The W13 cut (2026-09-02, from `reforge/research/2026-09-02-w13-query-loop-scout.md` —
  adopted with grades):** seven children; three THINGS, order forced. What must land before the
  loop can be owned, because the loop calls it: the hook executors (C10.6–8; reciprocally they
  need W13's shutdown latch, so C16b lands first as a standalone), `ToolRuntimePort` (C15), the
  storage oracle machinery (C12a), the descendant-process snapshot (C13c), the synthetic response
  corpus (C16a). Where the nine deferrals landed: `zRe`/`Tte` W13's, and cheaper than feared —
  `zRe` has no call site because it is INJECTED through `aAt()`; `E4n` W13's by routing and
  permanently REPL-only with a third guard (one importer, one call site, behind `_requireHost()`);
  the resume LOOP half is `Uy` (8,974 B); `ky`'s 52-arm ladder is not separable and its arms stay
  W7/W10/W11's; the driver measured across five regions; the task-frame emitters stay C11c's and
  only the interleaving contract is W13's; the process lifecycle is 780 bytes plus a coordinator;
  the `stream:false` retry has TWO arms and the corpus records the wrong one (404, by accident of
  a non-existent model name; C3's mid-stream arm is unrecorded); the model-switch pair is NOT W13's
  (re-placed to C10.7 above).
  • **C16a / W13a — the loop oracle machinery** (controlled, opus-tier; cut NOW): the five
    capabilities no oracle has — (i) per-event stream control in the replay proxy; (ii) the
    synthetic response corpus, protocol-valid SSE over the case matrix with deterministic seeds and
    an explicit oracle expectation per case (§3.1's non-vacuity: an empty or token case set FAILS);
    (iii) signal delivery to the engine child + the "no further yields within N ms" verdict; (iv)
    raw-wire multi-turn in `m2/raw-protocol.ts`; (v) opt-in unscrubbed request comparison for
    cache-breakpoint placement and ttl. Eight of the twenty edge-matrix cells depend on (i)+(ii).
    **HALF OF (iii) ALREADY LANDED, in C16b:** `reforge/src/signal.ts` delivers a signal to the DIRECT
    child at a declared frame-count trigger and grades the "no further yields within N ms" + exit-status
    + request-count verdict shape, driven by `w13/signals.ts`. What C16a still owes is enumerated in
    that file's SEAM NOTE — arbitrary signals and repeat delivery, delivery to a DESCENDANT (needs
    C13c's snapshot to name one deterministically), request-stream triggers, a scenario-level signal
    plan instead of a bespoke driver, and **the SDK lane, which is a capability and not a refactor:
    the primitive can name a pid only because it spawns the engine as a direct child, and an
    `sdk.mjs`-driven scenario cannot name one at all** (the seam is recorded in `src/signal.ts` and
    `strangle/runners.ts`).
  • **C16b / W13b — the process lifecycle** (autonomous, opus-tier; cut NOW; after C10.6's review
    on the shared manifest): `chunk-29shcjw2.js` whole (`class t{committed=!1}`, `xo()`, the
    never-settling `pm()`), `TWn`'s shutdown pair, the SIGINT/SIGTERM handlers in `ky`, the
    `sealTranscriptAppendsForShutdown` edge to W9 — as `LifecyclePort`; a SIGTERM-mid-turn scenario
    with a named stable verdict on both engines. Unblocks the executor children's stub.
  • **C16c / W13c — transport + assembler** (fable-tier; ADVISORY, blocked-by C16a): the 18-arm SSE
    assembler and transport `HIt`, `XN`/`sX`/`yxe`, the retry driver `kQ` and seven classifiers,
    `EIt` (both arms graded), `S2`/`Eie`/`P8n` — behind `ModelTransportPort` (= `aAt().callModel`)
    and `RetryPolicyPort`; the vendored HTTP client and SSE decoder stay §1.2. Mutation battery:
    dropped events, reordered deltas, duplicated emissions, a swallowed `message_stop`.
  • **C16d / W13d — the turn driver and the compaction drivers** (fable-tier; ADVISORY, blocked-by
    C16c, C10.6–8, C15, C12a): `Kx`/`DAt` (59,808 B), `rAt`/`aAt`, `ORe`, the loop-owned half of
    `XCt`, `zRe`/`Tte`/`wFt`/`E4n`, the 490 B of context accounting, `PostToolBatch` — behind
    `QueryLoopPort` (`run({messages, systemPrompt, promptRenderEpoch, userContext, systemContext,
    canUseTool, toolUseContext, fallbackModel, querySource, maxTurns, taskBudget, stopHookActive})
    -> AsyncGenerator<frame, {reason}>`, the shape of `Kx`'s ONE live call site in `hu.submitMessage`),
    `CompactionDriverPort`, `ToolExecutorPort` (a FACTORY — the refusal-decline path rebuilds it),
    `LoopStatePort`/`CostLedgerPort`. The port trace compares which ports ran, with what, how often.
  • **C16e / W13e — the headless half and the frame layer** (fable-tier; ADVISORY, blocked-by
    C16d): `GH`, `ky`'s drain loop and writer, `hu` (24 members, 0 private), `ku`, `Uy`, and the 42
    shared `g461tywa` exports (`system:init`, `result`, `zve` itself). The `Wn` gate fork recorded
    OPEN with `tengu_print_engine_loop` cited — or FIRED if C16a's flip-liveness adds
    `CLAUDE_CODE_PRINT_ENGINE_LOOP` to the allowlist with a negative control (the override IS in the
    committed fixture's 13 entries; it is the allowlist that excludes it).
  • **C16f / W13f — the hermetic substrate** (controlled, fable-tier; ADVISORY, parallel with
    C16c/d, blocked-by C13c): the sandbox-exec profile with the derived deny/allow list resolved
    through realpaths, exec AND file-open auditing over the descendant tree, a host-capability
    declaration scenarios can require, the `resetSandbox()`/config-dir policy, the four negative
    controls (each route FAILS from inside the boundary; a Bash workload child still passes; the
    audit distinguishes by policy, not env). It shares no file with any other child and gates
    nothing until C16g.
  • **C16g / W13g — the inversion** (controlled, fable-tier; ADVISORY, blocked-by C16b–f): the
    decision and the flip — engine-ts's stream-json shell (a real line reader/writer for the seven
    frame kinds), X7 extended from `{name, subsystem}` to a dispatchable registry, the declared
    delegation route (binding-candidate: OUT-OF-PROCESS supervised delegate over one declared
    channel — `check-reachability.ts` forbids the build tree, the bundle tree and computed dynamic
    imports by construction, and §3.6's four negative controls are exactly the four routes it must
    not be), and the ledger flip. Acceptance: engine-ts drives the corpus as `engineB` under strict
    replay for the scenarios whose subsystems are owned, delegating the rest, inside C16f's boundary.
  • **Not W13's**: `mdt`/`gdt` (C10.7); the Agent tool (C15a); `kUn` — routed by measurement, not
    by port name (see the W12 cut's closing decision); the 52 ladder arms; the
    task-frame emitters (C11c); `kOe` the security-monitor prompt (W6's classifier surface); `cs` in
    `dvbbv89q` (the remote-control/bridge transport, §1.2); the vendored HTTP client and SSE
    decoder; `chunk-38213y7h.js` as a chunk.
- **The W12 cut (2026-09-02, from `reforge/research/2026-09-02-w12-subagent-sandbox-scout.md` —
  adopted with grades):** two waves, seven children, sandbox first.
  • **C15b1 / W12b1 — the profile oracle and the settings-key scenario** (controlled, opus-tier;
    cut NOW): (1) a profile-TEXT oracle on the `description-parity` pattern — extract the seatbelt
    builder `PR` (7,666 B + ~1,400 B of rule emitters) from the pin, evaluate it with a stubbed
    `SandboxPathPort` over the declared cross-product of its ~14 inputs (read/write configs ×
    network restriction × unix sockets × local binding × mach lookup × pty × Apple Events × weaker
    network isolation), require byte identity with the owned module — no sandbox, no host, no engine
    run; (2) the host-capability requirement primitive; (3) the `agent-sandboxed-bash` recording:
    `settings: { sandbox: { enabled: true, autoAllowBashIfSandboxed: true } }`, a Bash read inside
    the allow-set, a Bash write outside it, one `dangerouslyDisableSandbox` call. Acceptance: the
    oracle fails on a perturbed input; the scenario is skipped-with-reason without `sandbox-exec`
    and green here; the fourteen sandbox exclusions retire or are re-justified on their real guard.
    Edges → C13d (the `SandboxPort` stub becomes two real ports), → C9 (the exclusions' rows),
    → C16f (the capability primitive).
  • **C15b2 / W12b2 — the sandbox module** (fable-tier; ADVISORY, cut when C15b1 lands): the
    owned 94,760 B behind `SandboxPolicyPort`/`SandboxExecPort`. The behavioural-partition matrix
    IS the profile cross-product + `bv`'s seven-branch truth table + `F2`'s five outcomes. Mutation
    battery: a dropped deny rule, an allow where a deny belongs, a lost (recoverable)
    `sandboxDisabledThisSession` latch, `checkDependencies` collapsed to a boolean, the two wrap
    members fused. Binding: on macOS `checkDependencies()` does NOTHING (platform-identity only —
    `/usr/bin/sandbox-exec` occurs once in 1,802 files, in the argv assembly at exec time) — an
    owned module reproduces that, and an oracle tests it with no sandbox.
  • **C15a1 / W12a1 — the subagent pure belt** (autonomous, opus-tier; cut NOW) and **C15a2 /
    W12a2 — the Agent tool's prompt** (autonomous, opus-tier; cut NOW, parallel): ~62 KB of the
    ~188 KB row, unblocked, no port, no machinery, no recording — the shape W10's parser-and-safety
    finding had. Every splice solo-sabotaged RED on `subagent`/`background-task`/`hooks-subagent`
    (the corpus's three Agent scenarios — `parallel-tools` is a Bash batch, not a fourth); a contract
    test over child-catalog resolution × four axes whose expectation is the corpus's own three
    catalogs (22 parent / 19 foreground child / 13 background child — the depth cap additionally
    removes `Agent` from a child's catalog at depth ≥ 3).
  • **C15a3 / W12a3 — subagent oracle machinery** (controlled, opus-tier; cut NOW; serializes per
    X5): the scripted child, survivor supervision with declared survivors, the lane-and-id decision,
    the two probes, six recordings. The recorded Agent input surface is four keys wide
    (`description`, `prompt`, `subagent_type` always `general-purpose`, `run_in_background`);
    `isolation`, `model`, `name`, `cwd` have zero recordings; no recorded child has ever called a
    tool, so the depth axis and the child's own dispatch path are entirely unexercised.
  • **C15a4 / W12a4 — the dispatch S-module** (fable-tier; ADVISORY, cut when C15a3 lands): ~55 KB
    of effectful residue behind seven ports and three stubs; mutation battery per the tracking row;
    `ChildQueryPort` IS `Kx` and W12 must not own it. Edges → C16d, C11c (`TaskRegistryPort`,
    `NotificationPort`, the `agentNameRegistry` addressing seam), C12 (subagent transcripts,
    `fork-context-ref`), C8 (SubagentStart/Stop call sites, `ka`'s three suppressions), C14 (`$Ft`,
    the skill preload), C13 (`qit`'s orphaned-shell kill), C9 (the child's permission-context clamp).
  • **C15a5 / W12a5 — worktree isolation, observers, teammates** (fable-tier; ADVISORY, cut last):
    three separate AXES, none blocking anything — the shape W10 gave PowerShell.
  • **Closing decision — `kUn`, routed by measurement, not by port name.** `kUn` (26,716 B, the
    per-tool invoker the streaming tool executor `ORe.executeTool` calls) is a fourth disjoint core
    that both the W12 and W13 scouts declined to place, each pointing at the other by way of the
    `ToolRuntimePort` name. Routing rule: it belongs to whichever wave owns its CALLERS — measure them
    at C16d's cut (one grep). If `ORe` is the only caller, `kUn` is C16d's behind `ToolInvokerPort`
    (it consumes C9's `canUseTool` and the C8/C10.x hook dispatchers and holds no subagent or
    sandbox state); if the Agent dispatch or the sandbox calls it directly, that caller's wave takes
    it. No wave inherits it by port name.
  • **Not W12's**: `bf5vvscj` (C8's plugin-hooks runtime), `Kx`/`DAt` (W13), the vendored 83.5 % of
    `q4xe0m2r`, the task store and notification queue (C11c), the cross-session layer (C11d).
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
| C10.5 | W7.5 | cut 2026-09-02 (Deferred section's "The W7.5 cut"); wave record `reforge/README.md` "W7.5"; `reforge/research/2026-09-02-w75-hook-executor-design.md`, `…-w75-segment-compaction-reachability.md` | **landed** 2026-09-02 — three of the four items ended somewhere other than where the cut expected. **(1) OS() sections:** the inventory is a sixth pin-keyed fixture (`prompt-sections-2.1.251.json`, **27 dynamic records + a six-element static head**, not the "~20" quoted since W3; the C10.5 review corrected the wave's "two-element tail" — the return array has five elements and exactly ONE follows the dynamic set), found by shape from the section-record constructor and confirmed twice; then **six splices over the static head** (~11.2 KB of the preset's prose), every anchor prose occurring ONCE in 1,802 files, every solo sabotage RED on `sysprompt-preset`. Prompt oracle 178 → 217 comparisons / 8 → 23 controls. **(2) Segment compaction:** MEASURED **OPEN — an ownability ceiling, not a coverage debt**, and the campaign had been naming the wrong function (`hRt` is the prompt builder; the producer is `E4n`). Routed to C16/W13; W4's three exclusions moved onto the evidence. **(3) The hook executors:** design pass done and **implementation deliberately refused** — the layer is **~56 KB, not ~30**, two of its largest functions had never been named, three of the campaign's names for it were wrong, and the oracle needs three capabilities it does not have. **(4) Riders:** CwdChanged FIRED on a created condition, `hooks-cwd-change` recorded (corpus 58 → 59) and `AUt` spliced (hook oracle 707 → 721 / 116 → 121); `rewind_files` measured cheap-scenario/poor-splice and logged rather than taken. Gate **107 of 107 summary phases, zero FAIL**, attestation **436/871 with 435 exclusions and zero unadjudicated**, 74 manifest rows (73 splices + the S-chunk replacement). **Boundary-reviewed 2026-09-02: NOT CONVERGED on the record side, converged on the code** — the code claims all reproduced, and a doc-only fix round corrected the `/rewind` enumeration hole, the `Query`-method count, the design doc's six wrong sentences and the fixture's per-record-reason overclaim. The executor implementation is cut as C10.6–C10.8 rather than folded into W8. See the C10.5 boundary-review Revision Note |
| C10.6 | W7.6a | cut 2026-09-02 (Deferred section's "The executor cut"); brief: `reforge/research/2026-09-02-w75-hook-executor-design.md` (as corrected in C10.5's boundary round); wave record `reforge/README.md` "W7.6a" | **landed** 2026-09-02 — Stages 0–1. **Stage 0 is the wave**, and the cut's reason for making it its own child is now measured. **(0a) The trace is ONE ORDERED EVENT LOG** and the tech-debt entry is retired: swapping one adjacent pair of differently-ported events reddens **204 of the 225** log comparisons and moves the retired per-port projection in **zero** of them (the wave wrote 226; both figures are now derived and printed by the oracle every run); the entry's two smaller edges close with it and NEITHER moved an existing comparison, which says both blindnesses were latent. The half the entry could not have known is **cleanup pairing**, stated as a PROPERTY because two sides that both leak COMPARE EQUAL — five controls, including the executor's own shape (the wave wrote six). `comparePerHook` ships design §5(a)'s multi-hook mode expressible and controlled on synthetic logs. **(0b) stdout WRITE boundaries**: the same bytes adopt an async hook in one write and never adopt it when split after a NESTED brace; splitting mid-KEY is indistinguishable from one write, which is the mechanism the design first got wrong, now a test. **(0c) a path that never settles** is a graded outcome — and **the arm that hangs is not in either executor**: the 261-byte shutdown wrapper fourteen dispatcher splices have captured as `executeHooks` since W5 owns it (six more capture the awaiting executor; twenty rows in all, not twenty-one — see the 2026-09-03 boundary Revision Note), an allowlisted event hangs with zero yields while every other event returns SILENTLY with zero yields (indistinguishable by what they yield), and the wrapper DROPS the executor's completion value on both arms. **(0d) the module-state leak is ONE cell**, not the family design §7.7 lists — the shutdown module's `committed` flag, with a setter and no clearer; the rest are keyed-lazy and the spawn-failure set is session-scoped. Reset proven by a once-per-process arm giving the same verdict twice, with a control showing the reset is not a no-op. **Stage 1: purity and anchorability are independent questions** — the doctrine the wave drew, on numbers its boundary round then corrected (see below and the 2026-09-03 Revision Note; as landed the wave read "the belt is not takeable by anchor" off a string-literal scan, and the seventh pin-keyed fixture now measures 151 DECLARATIONS, 40 pure at 5,453 B, 125 of them anchorable). Two splices at landing: **`Fq`** (5,993 B, NOT pure — five effectful-port captures, three throws all reproduced, two of eighteen event arms corpus-reachable) and **`Xpt`** (96 B, pure, both executors' — spliced and MEASURED DARK after the inverted twin was replayed, which is why a splice row may now carry a `darkReason` on the same terms a chunk export always could). Gate **110 of 110 summary phases, zero FAIL**; hook oracle **721 → 1,499 comparisons / 121 → 195 controls / 1,005 property statements**; attestation **460/996 with 536 exclusions and zero unadjudicated**; manifest **74 → 75 splices**; corpus unchanged at 59. Neither named recording was taken: both existed to make Stage 0's proofs possible and both proofs turned out available at the oracle level against upstream's own bytes, which is stronger evidence than a scenario — the cost of each is named for C10.8. **Boundary-reviewed 2026-09-03: NOT CONVERGED, and fixed in one round** (Revision Note above) — the code side reproduced entirely and two harness mechanisms plus several recorded numbers did not. **The wave's headline Stage-1 finding was a wrong measurement**: "the belt is not takeable by anchor" counted string literals of twelve characters or more, which is not what `strangle/anchor.ts` calls an anchor; re-derived by the rule itself, **125 of the 151 declarations are anchorable and 31 of the 40 pure ones are** (the 151 are declarations rather than functions — 126 functions, 12 constants, 4 Sets, 4 classes, 3 instances, 2 regexes — and the pure set is 40 at 5,453 B, because a dynamic `import()` has no free names and a module-level `new` instance is state). The doctrine survives with its own enforcement: **purity decides worth, anchorability decides takeability, and anchorability must be measured by the anchor rule**, which the extractor now does mechanically. Proved by taking **three more splices** — `mS`/`hook-output-async` and `_9`/`hook-invocation-text` LIVE, `ip`/`hook-output-sync` spliced and measured DARK over twelve scenarios, the pair being the round's sharpest result. **The midnight fix did not fix the midnight defect** (the notice is a wrapped MESSAGE, not a sentence; the first fix was validated only by two same-side runs). **`darkReason` gained runtime teeth** — a dark row declares `darkOver` and the gate rebuilds and re-measures it every run, failing as NO LONGER DARK. **The two new ledger captures were in the materialized basis**; rebased, rule 3 tightened to one basis, and `backfill-captures.ts --check` made a gate phase. **The gate's "names every failing verdict" was defeated** by a six-line relay window and an unrecognised proxy reason line. Gate **115 of 115 summary phases, zero FAIL** (110 + the relay control + the ledger-capture check + three liveness rows); oracle **1,499 → 1,549 comparisons / 195 → 210 controls**; attestation **460/996 → 465/1010 with 536 → 545 exclusions and zero unadjudicated**; manifest **75 → 78 splices**; mechanism **122 → 133 checks**; corpus unchanged at 59 |
| C10.7 | W7.6b | as C10.6 | not-dispatched — **blocked by C10.6**. Stages 2–3: `HookSourcePort` (consumers `Rzn`, `Qxt`, `DUt`) + the matcher owned pure with its one `EnvironmentPort.defaultShell()` read; then `AE` and `zxt`. Track hint: fable-tier |
| C10.8 | W7.6c | as C10.6 | not-dispatched — **blocked by C10.7**. Stages 4–5: `ProcessPort` + the command-spec builder out of `Nq` (serving the three non-hook callers through the same port); then `Qxt` with the merge, the aggregation projection and the permission-precedence reducer. `subsystem/hook-dispatch` reaches `standalone-complete` here and not before. Track hint: fable-tier |
| C11a | W8a | scout: `reforge/research/2026-09-02-w8-moat-tools-scout.md` (cut 2026-09-02, Deferred section's "The W8 cut"); wave record `reforge/README.md` "W8a" | **landed** 2026-09-03 — sixteen description splices, ~30 KB of owned prose, zero new recordings. **The wave's premise is now measured**: all twenty C11 tool rows put a description and a schema on the differential surface every turn and SIXTEEN do nothing else (zero `tool_use` blocks for any of them across the recorded corpus). **The population is derived from two artifacts** — `research/fixtures/moat-tools-2.1.251.json`, the EIGHTH pin-keyed fixture and a gate phase: the corpus side reads every recorded request body's `tools` array, the bundle side finds each description's producing DECLARATIONS by searching the graph for the rendered text itself. It corrected the cut twice before a line was spliced (THREE descriptions have more than one carrier; FOUR of the formatters the cut names are already C4/W1's) and corrected a number every document quoted (**"267 cassettes" is a count of FILES**; 186 are replay byproducts, the recorded corpus is 82 cassettes / 199 bodies). Both of those numbers were themselves corrected by the C11a boundary review — see the 2026-09-03 C11a-fix entry: the carriers read FIVE until the search stopped assuming one spelling per window and the walk stopped counting a builder's local `const` as a carrier, and the bodies read 423 until a replay proxy stopped appending its own traffic to the corpus. The anchor rule moved to `research/tools/anchor-enum.ts` and both extractors share it. **Two anchor lessons**: quoting is an escape layer (ScheduleWakeup's obvious anchor is unique graph-wide and points at the WRONG FILE), and an anchor can be ambiguous inside its own target. Seventh parity oracle `strangle/moat-parity.test.ts` (114 comparisons / 10 controls) grades eleven gate-pinned arms the corpus cannot render — two of the four gates default TRUE, so it is the DISABLED prose that is unrecordable. **The three formatters the cut names are deferred to C11b with the measurement**: they belong to the sixteen tools with zero execution coverage, so each row would be dark over the whole corpus at ~12 min per gate run, and C11b's own budget already contains the three recordings that make them live. One `task-family` re-record buys `task-get-result`'s "Task not found" arm. Riders all landed (X6 env fix in `engine-ts/skeleton.test.ts`; `tool/PowerShell` row at C13; `Read` does NOT leave the tool array; "Bash has no graph-unique literal" scoped to the FORMATTER; `background_tasks` FIRED-arm/UNREACHED-effect; `tool/WebFetch` → C5; `tool/WebSearch` and `tool/Monitor` the first two §1.2 exclusions; validators C4 → C13). A THIRD gate-fixture blind spot found by needing to cite it: `DH(e,t,r){return I(e,t)}` is an unrecognised resolver alias and five gates behind it are absent from the fixture — routed to C11b with the other two. (Review correction: those reads are INVISIBLE to the extractor, not unresolved — it visits only two-argument calls — so the repair needs the arity filter widened too.) Gate **133 of 133 summary phases, zero FAIL**; manifest **78 → 94 splices**; attestation **474/1030 with 556 exclusions and zero un-adjudicated**; corpus unchanged at 59. **Boundary review 2026-09-03 — NOT CONVERGED ON THE RECORD, converged on the code**: every owned byte, anchor, liveness row and exclusion reproduced, and both load-bearing defects were in the derivation fixture and the numbers quoted from it (a search that assumed one spelling per window recorded a schema getter as a carrier; an innermost-declaration walk counted builders' locals as carriers; and `--check` compared a subset of its own fields, so the corpus denominator went stale invisibly while an appending observation dump grew it by four per gate run). Fixed and re-derived — carriers 29 → 25, composed descriptions five → three, corpus 82 cassettes / 199 bodies — with the fixture's `--check` now comparing every count it writes, §1.2 gaining the pin-conditional GATE-DEAD exclusion kind that `ledger/check.ts` holds against the gate fixture, and the X6 rider gaining a control that fails when it is removed. Gate re-run **133 of 133 summary phases, zero FAIL**, attestation unchanged at 474/1030 with 556 exclusions. See the 2026-09-03 C11a-fix Revision Note. **Verification round 2026-09-03: CONVERGED** — every fix reproduced from code and artifact; two prose minors corrected in place |
| C11b | W8b | as C11a | not-dispatched — reachability + cross-session probes, 9–11 recordings, the `tool-catalog` fixture (the NINTH pin-keyed fixture, not the seventh: `moat-tools` is the eighth). **Unblocked** by C11a. Inherits from it: (1) the three formatter splices C11a deferred, each cheap once its recording exists — `ReportFindings` (1 pure-helper), `ScheduleWakeup` (3 tool-name primitives), `TaskOutput` (3 ports, ALL effectful — `mSt` reads `process.env.TASK_MAX_OUTPUT_LENGTH` and `rF` walks a gated sanitizer registry, so the scout's `pure-helper` label does not survive contact); (2) three extractor blind spots rather than two — the coerced `return Me(e)`, the env arm that precedes the gate, and W8a's `DH(e,t,r){return I(e,t)}` wrapper alias hiding five gates including the cron kill switch, which needs the walk's `arguments.length === 2` ARITY FILTER widened as well as the alias rule, because a three-argument read is never visited at all; (3) `AskUserQuestion`'s two gated prompt tails and `EnterPlanMode`'s two prose ports, both left as ports on purpose and both splices on C11a's template; (4) the four task-family DESCRIPTIONS, unowned and on the same four shapes |
| C11c | W8c | as C11a (advisory) | not-cut — task/notification core behind ports; cut when C11b lands |
| C11d | W8d | as C11a (advisory) | not-cut — cross-session messaging; cut ONLY if C11b's probe fires |
| C12a | W9a | scout: `reforge/research/2026-09-02-w9-session-storage-scout.md` (cut 2026-09-02, Deferred section's "The W9 cut"); wave record `reforge/README.md` "W9a" | **landed** 2026-09-03 — the storage oracle machinery, no splices. `src/state.ts` snapshots a **LIST of roots** (the mechanism is generic; two registered, the third named and deliberately not): the sandbox walked whole, the config dir through the scout's §4.2 include-list, and every transcript **projected per record** rather than hashed — because its bytes carry a fresh session uuid, a fresh `promptId` and a millisecond clock on every line. The projection is the point: `m2/cross-resume`'s `{type, role, sorted keys}` shape diff PASSES a record chained to the wrong parent, and `src/state.test.ts` demonstrates both halves. Six run-id rules join the differ's MAP, keyed on property name because the lexemes are ambiguous by value, each with a must-catch, a must-survive neighbour and **a mutation of itself** — which needed new machinery (`makeRunNormalizerOver`), and whose first version passed all six controls BY CONSTRUCTION because it compared through `diffTranscripts`, which re-normalizes with the full set. **Three decisions taken by measurement.** (1) THE FLUSH SCHEDULE lands on branch (c): `resume` was byte-stable over five replays, which reads as branch (a) — and `compact-continue` produced a multi-valued record count (49, 50, 53, 71 observed) for the same eight exchanges while its 29 SDK messages were byte-identical every time, so **`CLAUDE_CODE_EAGER_FLUSH` enters X6** ON by default with its negative control as a gate phase (eight takes per arm, because the unforced arm lands on one of two outcomes at even odds and three takes would report a false failure a quarter of the time). Branch (b), an observed quiesce, is implemented and insufficient — the compactor's rewrite races the drain — and `awaitQuiesce` is KEPT anyway, because it turns "the file was still moving" into a named failing outcome and C15a's root has no such knob. (2) `resetSandbox()` WIPES the config dir whole and seeds a declared baseline; the baseline is a measured necessity (two runs against an empty dir mint different `machineID`s) and because the identity is now a declared input the projection GRADES it. (3) `skillUsage` is RESET by that wipe, not scrubbed — a scrub would hide a real counter defect — with the cost landing on C14a. **Five findings on the identical-code pair, and none was the risk the cut flagged**: no cassette's replay depended on accumulated config state. `.claude.json`'s per-project block carries a clock, four durations and a cost (enumerated scrubs, not a pattern — any pattern broad enough eats the now-graded `firstStartTime`); parallel tool results are written in COMPLETION order and the race leaks one record PAST the batch into the successor's `parentUuid`; session files are named after a random uuid, so `/clear` listed two of them in a coin-flip order. **The `slug` overload cost a whole gate run and is the wave's sharpest lesson**: the census reported 124 values under `slug` in no known lexeme, the first reading was the artifact records (`artifactRead:{slug,ver}` — an artifact NAME, which is behaviour) and the guard it produced admitted only project keys, so the value those 124 actually were — a per-run session name the engine starts writing into every stored record AT THE COMPACT BOUNDARY — went unmapped and reddened seven corpus scenarios, the attestation, and two dark liveness rows whose covering scenario one of them is. One property name, two run-scoped values, and the guard admitted the wrong one. The same census recorded a second task-id shape (`b`+8 base36 against the Agent tool's `a`+16 hex, under one property name), which is C15a3's enumeration. **A measured correction to §4.4 D8** (corrected once by the fix round and again by ITS verification, 2026-09-03): a `parentUuid` cycle is seeded and PROVEN (the walk from the leaf cannot reach the first exchange) and costs the headless resume NOTHING — not because the path skips the chain but because it HEALS it: `BSe` walks `parentUuid`, and the already-visited parent is caught by the PARENT-LOOKUP GUARD and diverted to `QVt`, which recovers through the nearest not-yet-visited record within 5,000 ms (`tengu_chain_timestamp_fallback`) and succeeds only because the seed's records are one second apart. The scout's `tengu_chain_parent_cycle` and its partial-transcript log are UNREACHABLE in `BSe` at 2.1.251 — the guard diverts before the loop-top cycle check can see the repeat — and the fix round's first wording, which claimed that codeword fires, is wrong. **ENOSPC is DECLARED UNREACHABLE — a `[parent-impact]` on this row's own acceptance criterion, accepted 2026-09-03**: three of the fence's four codes (`ENOSPC`, `EROFS`, `EDQUOT`) cannot be raised against a chosen path by an unprivileged process on a normal filesystem and neither mechanism that would reach them is bought — the fourth, `ENAMETOOLONG`, IS reachable (a 300-character filename returns it; the first round claimed all four, the fix round measured otherwise) and is handed to C12d as a route through a pathologically deep sandbox cwd, and `store-read-only` grades the store's OTHER latching family (`{EACCES, EPERM}`) with what it does not cover stated — the fence's stickiness is advisory to C16f, whose sandbox profile is the natural place a real mount could raise EROFS/EDQUOT as a machine fact. Three pin-keyed fixtures (TENTH `config-dir-inventory`, ELEVENTH `run-id-shapes`, TWELFTH `session-storage-surface`) and five new gate phases. Riders: the ledger row's EMPTY edge array becomes four symmetric edges and its one-method artifact list becomes the derived 235-name surface (correcting the scout twice: 13 `*ForTesting`, 42 importing chunks); `chunk-d78hxkfm.js` leaves through §1.2's pin-conditional GATE-DEAD door on `tengu_hover_rest`; C16b's carried `darkOver` minor is closed over all three signal paths. Gate **147 of 147 summary phases, zero FAIL**; attestation **478/1038 executed with 560 exclusions, zero un-adjudicated**; corpus **87 cassettes / 205 request bodies over 63 scenarios** (four new recordings). **FIX ROUND 2026-09-03** (see the Revision Note): the exported `read-only-store` fault had no caller and did not fire under its documented file target — it chmodded the target FILE while its comment said "the DIRECTORY", and both the scenario and the control reached the same filesystem through `SeedFile.dirMode` instead of through the fault, so one of the three named faults was grading nothing; it now chmods the containing directory, `SeedFile.dirMode` is deleted, and the scenario and control go through the fault kind with an absence control. Five minor: `lstat` in the wipe and both census walks (a symlink is a leaf); the inventory's `why` column is now read by `--check` (UNEXPLAINED refused, reason compared, floor-of-zero refused); the precondition sidecar records the baseline seed's hash as well as the declaration, 63 sidecars backfilled; the `sessions/<pid>` family declared with its provenance after an uncleanly-killed engine child left one in the census; and three prose corrections (`ENAMETOOLONG` IS reachable, the D8 cycle is HEALED by a timestamp fallback rather than never walked — restated by fix round 2 because the heal is reached through the parent-lookup guard and the cycle codeword never fires — the timer arm's record count is multi-valued). A seventh landed from the round's own first gate: `coverage attestation` came back RED naming only a tag (`hooks-memory`), because attest.ts captured the runner's stdout and dropped it and the gate filtered away what survived — the same "a phase that can fail has to say what failed" defect the equivalence phase documents one block down; both layers now relay through `m2/relay.ts`, and the redness itself was diagnosed as a SENSITIVITY, not an inequivalence (six replays on a fresh instrumented build, all four surfaces identical every take), and did not recur. Fix-round gate **147 of 147, zero FAIL**; attestation **478/1038 executed, 560 excluded**; fs-faults phase **20 checks** (15 before); inventory **26 patterns over 3,449 resets, 17 admitted**; `store-read-only` re-recorded once (state, events, requests identical; **5 config entries** where an unfaulted scenario reads 6, the fault firing in the corpus). **FIX ROUND 2 2026-09-03** (a verification of the fix round; see the Revision Note): five findings, the load-bearing one being that F6(b) corrected a wrong mechanism by writing a different wrong one — `tengu_chain_parent_cycle` cannot fire in `BSe`, and the pattern (the second wave in two to attach an unmeasured mechanism to a measured outcome) is named in the note. The other four: the F7 relay read `stdout` alone, so a runner dying on stderr still produced a bare red tag (all four relays now read both streams and print a marked fallback line; `m2/relay.test.ts` 20 → 26 checks); F2's symlink leaf held for DIRECTORY links only, so a symlinked `.jsonl` was still read through and a dangling one threw inside the reset (`src/precondition.test.ts` 20 → 22 checks); the inventory's `counts` block was written and never compared (now recomputed from its own entries, four mutations proved); and F4's sidecar-backfill comment stated local state as a repository fact. One debt logged and flagged on C14a: seven primary cassettes are recorded against the baseline seed and write no hash of it. No gate run — prose, two logging paths, one census guard and one `--check`; the affected suites were run individually. **Verification closed 2026-09-05** (orchestrator spot-check: a repo-wide scan for the withdrawn cycle-event claim found every campaign site corrected and one survivor outside the campaign, the harness lecture's sessions note, now corrected against the same pin; no third round owed). **Unblocks C12b**. **W9's NAMED CARRY-OVER LANDED AT C13c (2026-09-05)**: process supervision — the surface this wave explicitly did not build ("leaked children and sockets", scout §6.5) — is now a third member of the state snapshot. It is a DIFFERENCE over the process table rather than a walk from the engine child, because at snapshot time the engine has exited and a leaked child has been reparented to pid 1; sockets remain unaddressed and unclaimed. **ANSWERED IN PART BY H1 (2026-09-05)**: F4's re-record dependency — every declaration change, and every baseline change, forcing a live take — is now paid by `m1/run.ts --reseal`, which replays the DECLARED precondition on engine-real and re-seals the sidecar only when `unmatched()`, `fallbackServed()` and `unserved()` (over non-repeat entries) are all clean, the scenario's `check` passes and the run's `ok` holds; the new sidecar names its immediate predecessor by hash. What still needs a LIVE take is stated rather than implied: a change that CAN reach the model, and every new scenario. The corpus's drift census measured 0 of 63. F4's other half is closed the other way: a sidecar with no `baselineSha256` (or none at all) is MALFORMED — grading refuses before the replay instead of grading an empty declaration under a finding. |
| C12b | W9b | as C12a | not-dispatched — the reader (fable; ~18 KB pure: records → session projection, chain helpers, `ENTRY_APPEND_POLICY` as data) graded from a synthetic transcript corpus over all 37 record types with zero recordings; **blocked by C12a** **INHERITS from C12a (2026-09-03)**: the fault surface and `projectRecord`/`projectTranscript` as the shape its oracle expectations should be written against (including the torn-tail marker, which is a property of the FILE, not of any record). And a BINDING measured correction to the scout's §4.4 D8, restated by the C12a fix round (2026-09-03) because the first version of it was wrong: a seeded `parentUuid` cycle is real — `src/precondition.test.ts` walks the file and proves the first exchange is off the chain — and the headless resume carries it anyway because it WALKS the chain and then heals it, not because it skips the walk. `BSe` walks `parentUuid` from the leaf; the already-visited parent is caught by the PARENT-LOOKUP GUARD (`if(!A||u.has(A.uuid))`, @212937) and diverted to `QVt` (@214473), which continues from the nearest not-yet-visited record within `YVt` = 5,000 ms and fires `tengu_chain_timestamp_fallback`. The loop-top cycle check (@212711) — the only site of `tengu_chain_parent_cycle` and of the partial-transcript log — is UNREACHABLE, because `d` is only ever assigned an unvisited record; the binding written by the fix round's first pass, which required the reader to fire that codeword, is WITHDRAWN (verification round 2, 2026-09-03). The reader must reproduce the guard ORDERING and the proximity fallback with its window, and must NOT fire the cycle codeword. `store-parent-cycle` pins the seed's one-second record spacing, which is what makes the fallback succeed (simulated on `BSe`'s own bytes: 4 of 4 records and one fallback event at one-second spacing; at six-second spacing 2 of 4, no event and no log). The chain walk is gradeable from the synthetic corpus, never from a `--print` scenario. **Unblocked** |
| C12c | W9c | as C12a | not-dispatched — the writer + lifecycle behind `SessionPort` (absorbs the C1 `session-materialize` splice); **blocked by C12b** **INHERITS from C12a**: with the drain forced, the write queue's batching is out of every differential run, so this wave's `dropped pendingEntries replay` and `queue item resolved before its bytes landed` mutations are load-bearing rather than belt-and-braces. It also inherits the SESSION TITLE claim: the differ maps the envelope's `slug` whole, which hides which prompt a session was named after, and `saveCustomTitle` / `saveAiGeneratedTitle` are this wave's to grade directly |
| C12d | W9d | as C12a | not-dispatched — the transcript GC, remove-by-uuid, torn-tail sealing, relocation, atomicity contract asserted directly; **blocked by C12c** **INHERITS from C12a**: three of the store fence's four codes (`ENOSPC`, `EROFS`, `EDQUOT`) are declared unreachable by the current harness (accepted as a `[parent-impact]` 2026-09-03); `store-read-only` grades the `{EACCES, EPERM}` family instead. **The fourth is a route this wave owns** (C12a fix round, 2026-09-03): `ENAMETOOLONG` IS raisable unprivileged on a normal filesystem — a 300-character filename returns it — and the store's project path is derived from the cwd, so a pathologically deep sandbox cwd reaches the fence for real without a disk image or an fs shim. Closing this row means taking that route, or grading the rest through C16f's sandbox profile, or adjudicating what remains dark with the measurement |
| C13a | W10a | scout: `reforge/research/2026-09-02-w10-bash-executor-scout.md` (cut 2026-09-02, Deferred section's "The W10 cut"); wave record `reforge/README.md` "W10a" | **landed** 2026-09-05 — the shell parser owned WHOLE as `CHUNK_REPLACEMENTS[2]` (`fgwne0fb`, 62,907 B of file, 62,292 of code, seven exports, one import, zero I/O), the campaign's third S-chunk and its largest ownership by two orders of magnitude. Zero new recordings, no port, no scenario, no engine-driving oracle — exactly as the cut priced it. **The population is derived** (`research/fixtures/shell-parser-2.1.251.json`, the ELEVENTH pin-keyed fixture and a gate phase, locating the chunk by SHAPE rather than by its content-addressed name) and it corrects the cut twice: **105 declarations, not 107** (100 statements, 93 functions, 12 declarators, 99.82 % density — the scout counted statements), and four named importers is exact but **one of the four is a re-export barrel whose own consumer reaches it through `await import(...)`**, a call site no static scan sees, measured separately with a `skipped` list so the dynamic population has a denominator; 294 further modules carry a BARE side-effect import, which is why `grep -l` answers 298. **Nine constructing declarators** declared under chunk.ts rule 2b — eight `new Set` tables and `Symbol("parse-aborted")`, whose IDENTITY is the contract and is why this is a chunk rather than seven splices. **THE FINDING, which reframes what §2.4's contract-test half is for**: every export was sabotaged with a twin and driven over ALL SIXTEEN Bash-bearing corpus scenarios; **one reddens** (`parseOrAbort`, on five of the sixteen, because `dde` → `KTe` turns its sentinel into a `too-complex` verdict the recorded permission decision carries) and **the other six move nothing** — not because the twins are weak (`getParser` answers null for every input, `findCommandNode` for every tree) but because the corpus's Bash commands are `echo`, `chmod`, `mkdir`, `cd`, `pwd` and `sleep`, and the consumers those six feed cannot distinguish a correct answer from a fallback on any of them. Each dark row carries that measurement, and the gate re-measures two of the sixteen every run. **The oracle** `strangle/parser-parity.test.ts` evaluates the PINNED CHUNK'S OWN BYTES and compares parse trees node for node — type, byte range, text, children, to any depth — over seventeen partitions and 2,170 command strings, byte ranges included in the compared value because the consumers slice the command with them; each partition declares the direction a wrong parser would fail it in and the suite applies exactly that corruption, which caught two vacuous controls on its first run. **A SECOND EVIDENCE CHANNEL for the attestation** (spec-level, see the Revision Note): `adjudicate()` takes what a differential contract suite executed on the same instrumented module, driven in its own process and attributed by recorder file and byte offset, reported as its own state — because 3,644 outcomes against a corpus this narrow would otherwise have meant three thousand identical sentences claiming 'reviewed'. Eighty branches remain that no command string reaches, adjudicated in thirteen groups (25 false arms of a `while (true)`, 13 elses of a callee with no failing return, 10 arms no caller's argument selects, …), two of them resource ceilings deliberately not carried and three bought instead by two lines in the coverage driver. Riders: `tool/PowerShell` and `subsystem/tool-result-validators` were ALREADY at wave C13 (verified, not assumed); `subsystem/bash-executor` moves **unowned → spliced** with the chunk's footprint and its one capture rebased upstream, `edges` empty deliberately. Attestation **478/1038 with 560 exclusions → 985/4682 executed, 3,060 by contract suite, 637 excluded, zero un-adjudicated**; whole-chunk rows **2 → 3**; corpus unchanged at 63 scenarios. **Unblocks C13b** (parse types: node shape, the sentinel's identity, the argv/env contracts and the `zshBraceDiff` ERROR wrap — seam notes in the wave record) **RUNS UNDER H1's SANDBOX LOCK (2026-09-05)**: `resetSandbox()` refuses to run while another harness process holds `reforge/.sandbox.lock`, naming the holder's pid and argv, so this row and C13c serialize on the shared `sandbox/`+`config/`+`build/` automatically instead of by convention. Do not delete the lock file; find the pid. |
| C13b | W10b | as C13a | not-dispatched — the command-safety chain (five engine regions, 124,832 B) + the classifier region (53,180 B) + 17 KB of flag tables owned outright; adds `bash-compound-safety` (closes W6's two live-but-dark `Fy` callers). **Unblocked** (parse types from C13a) |
| C13c | W10c | as C13a; wave record `reforge/README.md` "W10c" | **machinery landed 2026-09-05, recordings in flight** — executor oracle machinery: a scripted child process (byte schedule / exit / signal), injectable timers for the six shell deadlines, child-process SUPERVISION as `src/state.ts`'s third root; the six machinery-free recordings; (the sandbox-exclusion rider moved to C15b1 — see the W12 cut). **Unblocked**, serializes per X5 — and the serialization is now MECHANICAL: H1's sandbox lock (2026-09-05) refuses a second harness process by name, so a recording taken while a sibling replays is a loud refusal rather than a corrupted measurement. **STATE 2026-09-05**: all three capabilities landed with their negative controls — the scripted child (`w10/scripted-child.sh`, pure bash under X6's allowlist, no clock in the bytes, a four-row control MATRIX naming which field each axis moves, 44 checks), the six deadlines derived by the SHAPE OF EACH USE and rewritten as a checked derivation on the graph engines (27 checks, every one a refusal; the twelfth pin-keyed fixture), and process supervision as a THIRD MEMBER of the state snapshot (27 checks, each leaking a real process). Two `[parent-impact]`s: the six deadlines are FIVE over seven constants once a poll and its threshold are grouped consistently, and supervision is a DIFFERENCE over the process table rather than a walk from the engine child, because at snapshot time the engine has exited and a leaked child has been reparented to pid 1. Eight scenarios are written and their commands measured against the executor's own predicates (`r_r` decides kill-vs-background; bash's exec-optimization decides whether the signalled pid is the one that traps). Four build-free gate phases added and measured individually — the dispatch's gate policy gives the full gate to C13a, and the orchestrator grades them over the merged tree. Ledger: the row's EMPTY edge array becomes four edges. RECORDINGS AND THE CORPUS-WIDE SUPERVISION CENSUS ARE PENDING THE SHARED SANDBOX LOCK, which C13a's gate has held since 08:16. |
| C13d | W10d | as C13a (advisory) | not-cut — the executor S-module behind `ShellProcessPort`/`ShellOutputSinkPort` (SHARED with the hook runner) + `ShellProviderPort`/`CwdTrackingPort`/`ShellTimingPort`/`ShellTelemetryPort` (Bash-only) + `SandboxPort`/`RemoteConstraintsPort` stubs; `DiskTaskOutput` lives here; cut when C13c lands. **SEAM NOTES FROM C13c (2026-09-05)** — the port shapes the machinery implies. (1) WHICH TIMER EACH PORT MEMBER READS, derived and committed in `research/fixtures/shell-timers-2.1.251.json`: `ShellTimingPort` carries FIVE deadlines over SEVEN constants, not six — `background-hint` (`kzt` 2,000 ms, read by `Gcr`'s elapsed-seconds gate AND by the `Promise.race` that decides whether the command finished before it), `progress-cadence` (`$Kt` 1,000 ms, read by `jUe.startPolling`, so it belongs to the OUTPUT-SINK side rather than the process side), `output-file-watchdog` (`qKt` 5,000 ms, read by `Pde.#T`), `stall-detector` (`plr` 5,000 ms poll AND `mlr` 45,000 ms threshold, read by `kWt` — moving either alone moves nothing, so the port member is the PAIR), and `kill-escalation` (`WKt` 1,500 ms backstop AND `zKt` 100 ms liveness poll, read by `Pde.#h` — also a pair, because the poll is what CANCELS the backstop). Five members over seven numbers is the honest shape; one member per constant would let a reimplementation move a poll without moving the deadline it serves. (2) THE STALL DETECTOR HAS A SECOND INPUT that is not a timer: `_lr` tests the last output line against `ylr`'s seven interactive-prompt regexes, so `ShellTimingPort` is not sufficient for that arm and the pattern list is owned data (derived and committed at this pin). (3) THE SUPERVISION DECLARATION: `Scenario.detachedChildren` is the harness-side counterpart of `Pde.detach()`, and an owned executor must make DETACHMENT observable — a port whose `detach()` is fire-and-forget cannot be graded, because the state surface can see only that a process survived and not that the executor meant it to. (4) `bash-timeout-background` and `bash-kill-escalation` are a matched pair on ONE predicate (`r_r`), so the port that decides auto-backgrounding must expose that predicate rather than its outcome — and the escalation is only reachable when the signalled pid IS the process that ignores the signal, because the backstop is cancelled the moment that pid is gone |
| C13e | W10e | as C13a (advisory) | not-cut — the backgrounding + notification MOAT: `Gcr`'s four arms (one DEAD headlessly with its producer named — the interactive controller's `turn-abort`), the `background_tasks` control subtype (W7 fired the ARM against an empty registry; the EFFECT is unreached), stall detector, pressure reaper; records `bash-background-explicit` and `bash-background-control`; cut when C13d's ports exist. **SEAM NOTES FROM C13c (2026-09-05)** — the two recordings' FRAMES, for the moat product claim. `bash-background-explicit` is TWO TURNS with a wait between them: the completion notification is pushed with `priority: "next"` and delivered on the NEXT user turn, so a second turn sent before the child finished carries nothing — and the failure is SILENT, because a turn with no attachment still looks like a turn. The notification's text is built from `ZCe = "Background command "` + the description + `completed (exit code N)` (`x$e`), which is what a check can assert and what an owned implementation must reproduce byte for byte. `bash-background-control` sends the frame through the installed SDK's own `q.backgroundTasks(toolUseId)` rather than a hand-built `control_request`, and delivers it 1,500 ms AFTER the `tool_use` block rather than on it — the same race `m3`'s interrupt scenario measured into a hard exit with no frames. Both drive C13c's scripted child, so the backgrounded command's OUTPUT is a declaration and the notification can be graded against known bytes. `FE()` returns `!1` unconditionally at this pin, so the delivered notification is the plain summary and the richer `taskDelivery` envelope is dead — an owned implementation reproduces the plain one |
| C13f | W10f | as C13a (advisory) | not-cut — `tool/PowerShell` (executor comes free from C13d; `hw8qz4q5` shares `LG`/`jx`/`Kee`/`Kdt` and the notification path) + `subsystem/tool-result-validators`; cut last |
| C14a | W11a | scout: `reforge/research/2026-09-02-w11-mcp-slash-skills-scout.md` (cut 2026-09-02, Deferred section's "The W11 cut") | not-dispatched — the command-and-skill filter belt: the eighth pin-keyed fixture `slash-commands-2.1.251.json` derived from the 133-element registry with each row's `k0t` verdict (28 pass headlessly; the corpus reaches 2), the filter core as one owned module (7 fold-ins), the skill-usage module with the `skillUsage` normalization C12a needs; 1 recording. **Unblocked** **INHERITS from C12a (2026-09-03)**: the `skillUsage` normalization is DECIDED — RESET, not scrubbed, and the reset is `resetSandbox()`'s config wipe rather than a special case, so a scenario that wants a NON-ZERO counter must SEED it through `ConfigPrecondition.seed` (a `.claude.json` with a `skillUsage` block, which the state surface's config projection grades in full). **AND A DEBT THIS ROW IS THE FIRST TO REACH (2026-09-03, C12a fix round 2 — `CC-to-SDK/docs/tech-debt-tracker.md`)**: F4's baseline-seed sidecar is written and compared by `m1/run.ts` ALONE, so the seven primary cassettes recorded by other runners (`m2-fault-*` ×5, `m2-raw`, `w13-signals`) are recorded against the baseline seed — all three runners call `resetSandbox()` — and record no hash of it. This is the wave that CHANGES the baseline (a seeded `skillUsage` block), and for those seven a baseline change without a pin bump replays green against a world the cassette does not answer. Lift the sidecar write/compare into a helper the three runners call before changing the seed. **AND INHERITS FROM H1 (2026-09-05)**: for the 63 cassettes `m1/run.ts` DOES seal, a baseline change no longer costs a re-record — `npx tsx m1/run.ts --reseal` visits exactly the drifted sidecars, replays each declaration against its cassette, and re-seals the ones whose request stream is provably unchanged (a baseline the model never reads is the archetype). It REFUSES, by name and by byte, any scenario whose stream did move, and those are the ones that owe a live re-record. The seven sidecar-less cassettes above are outside that mechanism, which is why the helper is still this row's to write. |
| C14b | W11b | as C14a | not-dispatched — `w11/probe-mcp-transport.ts` (stdio vs SDK, with the SDK-NEGATIVE phase: elicitation is live for stdio servers and explicitly skipped for in-process ones), a committed fixture MCP server, the `pf` probe via the raw driver, 11–14 recordings; resolves the hook registry's two `Elicitation*` OPEN rows; the `Skill` tool + `qdt` ride here; **blocked by C14a** (shared surface) |
| C14c | W11c | as C14a (advisory) | not-cut — the live MCP generation behind `McpClientPort` (`hydrateToolsFromListing` as the projection, the call path, the 3.4 KB elicitation impl whole, a generation-guard tripwire) + the negative control proving a row aimed at the dead generation FAILS the build; cut when C14b lands |
| C15b1 | W12b1 | scout: `reforge/research/2026-09-02-w12-subagent-sandbox-scout.md` (cut 2026-09-02, Deferred section's "The W12 cut") | not-dispatched — the sandbox profile ORACLE (extract `PR`, evaluate over its ~14-input cross-product with a stubbed path port, byte identity — no host, no engine run), the host-capability requirement primitive (a scenario declares "needs `/usr/bin/sandbox-exec`" and is skipped-with-reason elsewhere; W13's substrate inherits it), and the `agent-sandboxed-bash` recording via `settings.sandbox`; retires or re-justifies the fourteen sandbox exclusions (the rider moved here from C13c). **Unblocked** |
| C15b2 | W12b2 | as C15b1 (advisory) | not-cut — the 94,760 B Claude-Code sandbox layer behind `SandboxPolicyPort`/`SandboxExecPort` (`PR` + rule emitters, `bv`'s seven-branch decision, `F2`'s five outcomes, the guard chain, `eht` the 34 KB settings→srt translator); Linux/Windows as throwing stubs whose reason is the constant-folded `Ct()` dispatch; cut when C15b1 lands |
| C15a1 | W12a1 | as C15b1 | not-dispatched — the subagent PURE BELT (~45 KB, 36 unique prose anchors, zero recordings): child-catalog resolution (already graded three ways by the corpus at 22/19/13 tools), the agent-type ladder + six refusals, model resolution, six schemas, the result mapper, spawn counters, worktree naming/validation. **Unblocked** |
| C15a2 | W12a2 | as C15b1 | not-dispatched — the Agent tool's PROMPT (`wlt`, 16,727 B, six conditional sections under six guard reads — W3's section play; the `## When to fork` section's absence asserted with `Le()` cited). **Unblocked**, parallel with C15a1 |
| C15a3 | W12a3 | as C15b1 | not-dispatched — subagent oracle machinery: a SCRIPTED CHILD (`Options.agents` with pinned tools/maxTurns/model/permissionMode + authored child-lane responses — the synthetic response corpus's second concurrent lane), SURVIVOR supervision (a third state root over `<CONFIG_DIR>`, the task-output directory at `/private/tmp/claude-501/<slug>/<uuid>/tasks/` — outside BOTH roots today, reset by nothing — and `.claude/worktrees/`; descendant set diffed with deliberate survivors DECLARED, because a background agent legitimately outlives its turn), the lane-and-id decision for depth ≥ 2 (agent ids and task ids share the `a`+16-hex lexeme and the differ keys on property name — enumerate id SHAPES before the first nesting scenario), `w12/probe-subagent-depth.ts` (depth cap 3 via `tengu_hazel_trellis`; concurrency 20) and `w12/probe-agent-teams.ts`. **Unblocked**, serializes per X5 **INHERITS from C12a (2026-09-03)**: the third state root is a ONE-LINE seam — append a `StateRoot` for the task-output directory to `defaultStateRoots`, with its own `descend` rule (a root no longer borrows the session store's); the run-id map already binds the `<session-uuid>` in its path. The eager-flush knob does NOT cover that directory — a backgrounded agent writes it after its parent's result frame — which is precisely the case `awaitQuiesce` was kept for. The ID SHAPES the cut asks for are enumerated in `research/fixtures/run-id-shapes-2.1.251.json`: `agentId` and `task_id` share `a`+16 hex, and `task_id` carries a SECOND shape, `b`+8 base36 for background tasks |
| C15a4 | W12a4 | as C15b1 (advisory) | not-cut — the dispatch S-module (~55 KB: `Ane.call`, `Bb`, `n9`, `kan` the inheritance contract, `$Ft`, the task-record writers, the worktree disposition closure) behind `AgentRuntimePort`, `ChildQueryPort` (= `Kx` — W12 must NOT own it), `TaskRegistryPort`, `NotificationPort`, `WorktreePort`, `AgentClockPort`, `AgentTelemetryPort` + `TeammatePort`/`RemoteAgentPort`/`ObserverPort` stubs; mutation battery incl. the leaked concurrency slot, the shared `readFileState`, the double `task_notification`; cut when C15a3 lands |
| C15a5 | W12a5 | as C15b1 (advisory) | not-cut — worktree isolation (17 KB), observers (14 KB + `jna7qpeb`), teammates (`eyzf721y`, 29 KB, OPEN behind the `--agent-teams` ARGV flag the raw driver controls — the gate `tengu_amber_flint` defaults TRUE); three axes, cut last |
| C16a | W13a | scout: `reforge/research/2026-09-02-w13-query-loop-scout.md` (cut 2026-09-02, Deferred section's "The W13 cut") | not-dispatched — the loop oracle machinery: per-event stream control in the replay proxy (drop-after-N / delay / destroy / inject-malformed at `proxy.ts`'s entry loop, strict-fallback rules untouched), the SYNTHETIC RESPONSE CORPUS generalising `src/faults.ts` (spec-mandated since W9, absent), signal delivery + the no-further-yields verdict shape, raw-wire multi-turn, opt-in unscrubbed cache-breakpoint comparison — each with a negative control. **Capability (iii) is HALF LANDED (C16b):** `reforge/src/signal.ts` delivers a signal to the DIRECT child at a declared frame-count trigger (never a clock) and grades "no further yields within N ms" + the exit status the handler CHOSE + the request count; `w13/signals.ts` drives it over three plans. The remainder is the file's own SEAM NOTE — arbitrary/repeat signals, DESCENDANT delivery (**UNBLOCKED 2026-09-05**: `src/supervision.ts`'s `findEngineChild()` names the engine child under the harness pid — a descendant of this process whose command line begins with a path the harness itself constructed, and exactly one at a time, two being a refusal rather than a first match — and `descendantsOf()` walks its tree, which is what the SDK lane needed and `src/signal.ts` could not do), request-stream triggers, a scenario-level signal plan — plus **the SDK-lane seam: the primitive can name a pid only because it spawns the engine as a direct child, and an `sdk.mjs`-driven scenario cannot name one, which is a capability to build rather than a refactor** (recorded in `src/signal.ts`'s SEAM NOTE and `strangle/runners.ts`). **Unblocked** (no dependency on any wave); serializes on the shared harness surface |
| C16b | W13b | as C16a; wave record `reforge/README.md` "W13b" | **landed** 2026-09-03 — the process lifecycle. `chunk-29shcjw2.js` owned OUTRIGHT as `CHUNK_REPLACEMENTS[1]` (780 B of file, **165 B of code**, three exports, zero imports) — the campaign's second S-chunk and the first taken because its STATE is the contract rather than because it is small: three exports that are meaningless apart, so three S-method splices would have been three correct-looking modules that together are not the latch. **The population is derived from the artifact** (`research/fixtures/process-lifecycle-2.1.251.json`, the NINTH pin-keyed fixture and a gate phase) and it corrects the row's own headline before a line was spliced: `grep -l` answers **313 importers**, the cut says 10, and both are true — 303 chunks carry a BARE side-effect import for the bundler's evaluation ordering. Ten named importers, **90 call sites for 165 bytes** (`isShuttingDown` 62 / `commitShutdown` 3 / `hang` 25). Four of `TWn`'s **44** members spliced (`isShuttingDown`, `claimShutdown`, `releaseShutdownClaim`, `shutdownSync`) plus the headless dispatcher's SIGINT handler `Hn`. **Four corrections to this bullet, all measured**: (1) the shutdown PAIR cannot be taken whole — `shutdown` (1,096 B) performs a dynamic `import()` of a graph chunk by literal specifier, which THE CURRENT CAPTURE MECHANISM cannot forward (captures derive to identifiers or member expressions, and `assertCaptureInventory` reconciles free identifiers) and an owned module may not reproduce (the BUNFS reachability rule) — a limit of the mechanism, liftable by a lazy-import capture kind rendered on the graph side, and it is `shutdown` rather than `shutdownSync` that awaits `executeSessionEndHooks`; (2) `LifecyclePort` ships FIVE members, because two different flags are called "is shutting down" — the one-way LATCH (`committed`, no clearer in the bundle) and the two-way CLAIM (`TWn.shutdownInProgress`) — and a port with `claimShutdown`/`releaseShutdownClaim` and no reader is write-only; the fifth is `TWn.isShuttingDown`, an upstream counterpart, exposed as `shutdownClaimed`; (3) **L17's hang is unobservable by any headless stimulus this wave could apply** — measured, not reasoned: no in-flight continuation resumes inside the shutdown window on any of the three paths (14-41 ms hookless, still inert with a ~1.64 s window opened by a sleeping `SessionEnd` hook and with the signal delivered after the `tool_use` frame with the tool running), so `commitShutdown` and `hang` are corpus-DARK with a measured reason and a three-path `darkOver` population the gate re-measures. (This correction is dated: the wave first claimed SIGTERM's abort short-circuits the hang guard, which the bundle refutes — `br` aborts the dispatcher's `Rn`, the guards read the query controller `Qe`, and only SIGINT's `Hn` aborts `Qe`.); (4) there are TWO signal-handler families, not one, and only **one of the graph's six lifecycle handlers fits a target shape** — SIGTERM's `br` writes back to a captured once-guard and stays OPEN with that mechanical reason. New harness capability, the minimal half of C16a's (iii): `src/signal.ts` delivers a signal at a DECLARED FRAME COUNT (never a clock) and grades "no further turn progress + the exit status the handler CHOSE"; `w13/signals.ts` runs three plans over one cassette (SIGTERM→143, SIGINT→0, SIGHUP→129) on both engines. `strangle/chunk.ts` gains **rule 2b** (declared module state) with its own perturbation control — and three of the five existing chunk fixture controls had to be generalised first, because they keyed on facts about the first owned chunk and would have "passed" on this one by rejecting nothing. Ledger: `subsystem/query-loop`'s **edge array was empty and now carries eight outbound edges**, the inbound edge from `subsystem/hook-dispatch`, and the `sealTranscriptAppendsForShutdown` edge to `subsystem/session-storage` recorded NOT owned. The hooks-parity stub is now a CONSUMER of the owned module on the owned side of the oracle. Gate **142 of 142 summary phases, zero FAIL**; manifest **94 → 99 splices**, whole-chunk rows **1 → 2**; attestation **478/1038 with 560 exclusions**; corpus **83 cassettes / 201 request bodies** (one new recording). **Unblocks C10.7/C10.8** — they consume `LifecyclePort` instead of the stub. **Boundary review 2026-09-03: CODE CONVERGED, RECORD NOT CONVERGED — six findings, all closed, re-gated at 142/142 with attestation unchanged** (see the C16b-fix Revision Note). The load-bearing one is correction (3) above: the wave's stated MECHANISM for the latch's darkness was refuted by the bundle and the darkness re-stated as the measurement. The rest: `darkOver` widened to all three signal paths; `w13/signals.ts` now REQUIRES `--engineB` (its default graded the unstrangled graph); `shutdown`'s inexcisability narrowed to the current capture mechanism; C16a's row credited with the half of capability (iii) this child landed; and the engine pin moved out of the auto-updater's directory into `reforge/toolchain/`, byte-pinned like bun **Fix-wave verification 2026-09-03: CONVERGED**; one pre-existing population minor carried to C12a as a rider |
| C16c | W13c | as C16a (advisory) | not-cut — transport + streaming assembler (`HIt` 67 KB, `XN`/`sX`, `kQ` retry + seven classifiers, both `EIt` `stream:false` arms — the corpus records only the 404 arm; C3's mid-stream arm has NO recording) behind `ModelTransportPort` + `RetryPolicyPort`; absorbs C1's `text_delta` splice; blocked by C16a |
| C16d | W13d | as C16a (advisory) | not-cut — the turn driver `DAt` + `ORe` + the compaction drivers `zRe`/`Tte`/`wFt`/`E4n` + context accounting + PostToolBatch, behind `QueryLoopPort` (= `zve`'s `run`), `CompactionDriverPort`, `ToolExecutorPort`, `LoopStatePort`/`CostLedgerPort` over the 105 accessors; blocked by C16c, C10.6–8, C15, C12a |
| C16e | W13e | as C16a (advisory) | not-cut — the headless half (`GH`, `ky`'s drain loop and writer, `hu`, `ku`, `Uy` resume) + the 42 frame exports (`system:init`'s 103 graded fields, `result`'s 48); NOT the 52 ladder arms; blocked by C16d |
| C16f | W13f | as C16a (advisory) | not-cut — the hermetic substrate (§3.6): sandbox-exec profile with the derived deny/allow list, exec AND file-open audit over the descendant tree (shares C13c's descendant snapshot, LANDED 2026-09-05 — and it inherits that surface's NAMED BLIND SPOT with the measurements that close the alternatives: an orphan with no harness-owned token in its command line, whose cwd is not the sandbox and whose lineage is gone, is invisible; `ps -E` is restricted under SIP on macOS, and a process-group discipline buys nothing because the engine's own kill path is `process.kill(-pid, …)` and every shell is already its own group leader — an exec audit under this wave's profile is where it closes), host-capability declaration, the `resetSandbox()`/config-dir policy W9 left open, the four negative controls; parallel with C16c/d, blocked by C13c **ADVISORY from C12a (2026-09-03)**: the session store's fence latches on `{ENOSPC, EROFS, EDQUOT, ENAMETOOLONG}` and C12a measured that three of the four (`ENOSPC`, `EROFS`, `EDQUOT`) cannot be raised against a chosen path by an unprivileged process on a normal filesystem — the fourth, `ENAMETOOLONG`, can, and belongs to C12d as a deep-cwd route rather than to this wave. A real mount under this wave's sandbox-exec profile is the natural place to raise EROFS or EDQUOT as a MACHINE FACT, so if the fence's stickiness is ever graded it is this wave's to grade — explicitly NOT an fs shim preloaded into the engine child, which changes the binary under test and collides with the BUNFS reachability rule |
| C16g | W13g | as C16a (advisory) | not-cut — the inversion: engine-ts's stream-json shell, X7 extended to a dispatchable registry, the declared OUT-OF-PROCESS delegation route, the ledger flip; engine-ts drives the corpus as `engineB` under strict replay inside C16f's boundary; blocked by C16b–f |
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
- **The moat traverses the seam**: 22 native tools presented headlessly by default at 2.1.251, 32 in union across the corpus and
  28 at most in any one session (the W8 scout's re-measurement over 267 request bodies, 2026-09-02;
  this line originally read 31 — a union mistaken for a catalog) — measured from
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

- 2026-09-05 (**C13c / W10c — executor oracle machinery: a declared child, five deadlines that move,
  and a fourth thing a run leaves behind**): the machinery child of the W10 cut. No splices, no owned
  bytes, no port — the three capabilities of scout §5.2, each with the negative control the cut
  named, plus the eight scenarios that cannot exist without them.
  - **The premise, as a measurement.** Every Bash command in the 63-scenario corpus is `echo`,
    `mkdir`, `chmod`, `cd`, `pwd` or `sleep`. That reaches one of `dZe`'s six result arms, no
    truncation, no backgrounding, no timeout, no compound command and no pre-spawn refusal. The
    executor's unreached arms are not behind a gate; they are behind a child nobody specified, a
    deadline nobody could move, and a surface that cannot see a process.
  - **Capability 1 — a child whose behaviour is its argv.** `w10/scripted-child.sh`: exact byte
    schedule, chosen exit status, `trap '' TERM`, a grandchild that holds stdout open past the
    child's own exit, and an interactive-prompt tail. PURE BASH by decision, not preference — it runs
    inside the engine's shell under X6's allowlist, so "whatever node or python is on `PATH`" is the
    operator coupling X6 exists to remove, and two engines graded against two interpreters is a
    difference the harness would call an engine defect. NO CLOCK REACHES THE BYTES, so the same plan
    is byte-identical on every engine and a scenario's `check` can assert the OUTPUT. The declaration
    is checked DIFFERENTIALLY — `expectedOutput` derives the schedule in TypeScript, the script
    derives it in bash, neither reads the other, and the first run found the TypeScript expectation
    wrong, which a record-what-it-produced fixture would have blessed. The cut's control ("a
    perturbed schedule changes the graded output — show which field") is a MATRIX rather than one
    perturbation, because the helper has three independent axes and a perturbation moving four fields
    at once proves nothing about which field carries which: `--bytes` moves the length and the hash,
    `--chunks` moves the hash and the `R<i>` markers while holding the byte total EXACT, `--every`
    moves only the schedule's FLOOR with byte-identical output, `--exit` moves only the status — and
    each row also grades the perturbed plan against its own declaration, so a helper that crashed on
    every perturbation could not pass by failing everything. It is also graded under `engineEnv()`
    itself, with a control asserting that environment is measurably narrower than the parent's.
    **44 checks.**
  - **Capability 2 — timer control as a BUILD-TIME CONSTANT REWRITE, and the reason it cannot be an
    env var.** None of the six deadlines is read from the environment at this pin — they are `var
    NAME=<number>` declarators compiled into the graph — so "add a knob" is the same edit plus a
    fiction about where it came from; and the oracle is a compiled Mach-O binary, so a variable it
    cannot honour would silently apply to one side of a differential. NOTHING IS FOUND BY NAME: each
    deadline is located by the SHAPE OF ITS USE (the `setTimeout`/`setInterval` call or the
    `Date.now()` comparison that makes it a deadline rather than a number), every use-site pattern
    matches exactly once, every derived binding has exactly one numeric definition, the background
    hint's two use sites must AGREE on the binding, and the owning chunk is found by the conjunction
    of all seven shapes. The rewrite then re-reads the bytes at its own derived offset and refuses
    unless they are literally `<binding>=<pinned value>` — because a wrong edit to an engine that is
    then graded applies to BOTH sides, so both agree and the measurement is of something nobody
    named. Every control is therefore about a refusal. **27 checks.**
  - **`[parent-impact]` — the six deadlines are FIVE, over seven constants.** All seven are present,
    verified and rewritable (`kzt` 2,000 / `$Kt` 1,000 / `qKt` 5,000 / `plr` 5,000 / `mlr` 45,000 /
    `WKt` 1,500 / `zKt` 100, each with its byte offset in `chunk-fy12d89p.js`). But grouped
    consistently — a poll interval and its threshold are ONE deadline — they make five:
    `background-hint`, `progress-cadence`, `output-file-watchdog`, `stall-detector` (`plr`+`mlr`) and
    `kill-escalation` (`WKt`+`zKt`). The scout's six comes from pairing `plr`/`mlr` while leaving
    `WKt`/`zKt` apart. Nothing downstream depends on the count; the fixture commits all seven, which
    is the number the rewrite needs, and records the grouping so nobody re-derives it.
  - **The stall detector's OTHER input is a derived population.** It fires only when the last output
    line matches one of `ylr`'s seven interactive-prompt regexes, so `--prompt-tail` was a bet on an
    upstream list. `research/fixtures/shell-timers-2.1.251.json` is the **TWELFTH** pin-keyed fixture
    and a gate phase: it derives the list from the shape of its one consumer (unique across all 1,800
    module files) and asserts the child's tail satisfies TWO of the seven independently, so a pin
    retiring either still fires the arm.
  - **Capability 3 — process supervision, and the measurement that moved its design.** The obvious
    reading is a `ps -o pid,ppid` walk down from the engine child. It does not survive contact with
    what it measures: the snapshot is taken after the query resolves, so the engine has EXITED and a
    leaked child has been reparented to pid 1 — **the leak is precisely the case in which lineage has
    been destroyed**. So the surface is a DIFFERENCE over the process table, before against after,
    which is attributable to the run by construction because H1's lock guarantees no sibling harness
    is spawning engines into the same window. A survivor is graded only when one of three routes ties
    it here (lineage to this process, a cwd inside the sandbox, a harness-owned token in its command
    line); everything else is DROPPED rather than counted, because a count is a graded value the
    operator's browser can move. A survivor must appear in TWO samples 250 ms apart, so a child that
    is exiting cannot make the surface flaky. `findEngineChild` keeps the live half C16a needs — a
    descendant of this process whose command line begins with a path the harness itself constructed,
    and exactly one at a time; two is a refusal, never a first match. **27 checks, every one leaking a
    real process**; the first draft of two of them used `detached: true`, which leaves this process as
    the parent, so the ancestry route attributed them and the routes under test never ran.
  - **The blind spot, with the measurements that close the alternatives.** An orphan with no reforge
    token in its command line, whose cwd is not the sandbox and whose lineage is gone, is invisible.
    `ps -E` is restricted under SIP on macOS (measured: command line, no environment), and a
    process-group discipline would buy nothing because the engine's own kill path is
    `process.kill(-pid, …)` and every shell is already its own group leader. **C16f inherits it**: its
    hermetic substrate already shares this snapshot, and an exec audit over the descendant tree is
    where it closes.
  - **The kill-escalation command form is a measurement, not a preference** — and it is the sharpest
    thing the wave learned about the executor. Two upstream facts must hold at once. The deadline
    only KILLS when `r_r(command)` is false, because otherwise `Gcr` passes `shouldAutoBackground` and
    the timeout BACKGROUNDS the shell without signalling anything. And the process that ignores
    SIGTERM must BE the pid `#h` signals, because the backstop is cancelled the moment that pid is
    gone. Measured: `bash -c '<one simple command>'` exec-optimizes, so the shell IS the script and
    survives; the same command with a redirect, or followed by `; true`, does NOT, so bash dies of the
    TERM, the liveness poll sees the pid gone, the backstop is CANCELLED — and the script it started
    is orphaned and survives, reaching neither the escalation nor a clean shutdown.
    `sleep 0 && exec ./reforge-child.sh --ignore-term …` satisfies both: the leading `sleep` puts
    `sleep` at the head of `Ua`'s first subcommand so `r_r` is false, and the explicit `exec` replaces
    the shell unconditionally. That also makes the two timeout scenarios a matched pair on ONE
    predicate — `bash-timeout-background` is simple and takes the backgrounding arm,
    `bash-kill-escalation` is sleep-guarded and takes the killing one.
  - **Which scenario runs on which engine set, and why.** Six run on the corpus's own pair
    (`engine-real` as oracle, `engine-extracted` under test): none needs a deadline moved. The two
    that do cannot be graded against the oracle at all — the rewrite is of the graph's own bytes — so
    they run on the identical-code GRAPH pair (`engine-extracted` vs `engine-strangled`) through
    `w10/timed.ts`, where any difference is a harness or splice defect, which is exactly how the
    corpus reads its own pair. The stall detector is RECORDED ONCE at the pin's 45 s (the trade the
    scout allowed) and REPLAYED at 1.8 s; the cassette still matches because the notification's
    content is a function of the command and the summary rather than of when the deadline expired.
    The timed scenarios are therefore FACTORIES over the deadlines in force, not fixed bodies: a
    hard-coded wait would either cost 56 s per replay or send the second turn before the notification
    existed, and the second failure is silent because a turn carrying no attachment still looks like a
    turn.
  - **`src/record.ts`** — this wave is the THIRD caller of `m1/run.ts`'s record branch, so it was
    lifted rather than copied, which is the write half of the tech-debt item that named exactly this
    shape. `w10/record.ts` records ONE tag per invocation and is deliberately not the corpus runner:
    registering six cassette-less scenarios would arm six live takes inside somebody else's gate run,
    on somebody else's credential and throttle budget.
  - **The sandbox rows stay OPEN, as the charter says.** The OS-boundary capability — a host assertion
    a scenario can require — is NOT built here. Its primitive belongs to **C15b1** (which already owns
    "the host-capability requirement primitive: a scenario declares `needs /usr/bin/sandbox-exec` and
    is skipped-with-reason elsewhere") and **C16f** inherits it for the hermetic substrate. C13c
    builds neither, and the sandbox exclusions stay where the W12 cut put them.
  - **Ledger.** `subsystem/bash-executor`'s empty edge array becomes four edges, each named by what it
    is a port into: → `subsystem/permissions` (a compound command is decided per subcommand and
    aggregated), → `subsystem/control-protocol` (`background_tasks` reaches into the shell registry;
    W7 fired the ARM against an empty registry), → `subsystem/hook-dispatch` (the hook runner calls
    `B2` and `jx` directly and never touches `LG` — which IS C13d's port cut), → `subsystem/moat-tools`
    (this row composes the notification, C11c's queue and task store deliver it).
  - **Gate phases added, and NOT run here.** Four build-free phases in the determinism block:
    `src/supervision.test.ts`, `w10/child.test.ts`, `w10/timers.test.ts` and
    `research/tools/extract-shell-timers.ts --check`. Per the dispatch's gate policy a sibling child
    (C13a) owns the full gate for this pair, so these were measured individually — 27 + 44 + 27 checks
    green, fixture matching the pin — and the orchestrator grades them over the merged tree.

- 2026-09-05 (**C13a / W10a — the shell parser owned whole, and the measurement that the corpus
  cannot see it**): `chunk-fgwne0fb.js` is `CHUNK_REPLACEMENTS[2]` — 62,907 B of file, 62,292 of
  code, seven exports, one import, zero I/O — reimplemented as a reforge-owned module behind the same
  surface. The campaign's third whole-chunk ownership and, by two orders of magnitude, its largest.
  - **Two numbers in the cut were wrong and are now derived.** `research/fixtures/shell-parser-2.1.251.json`
    is the ELEVENTH pin-keyed fixture and a gate phase, and it locates the chunk BY SHAPE (a top-level
    `new Set` of bash reserved words beside an exported `Symbol` declarator, unique in 1,802 modules)
    rather than by its content-addressed name. The chunk has **105 declarations, not 107** — 100
    top-level statements, 93 functions and 12 declarators, at **99.82 %** density; the scout counted
    statements. And **four named importers is exact but one of them is not a reader**: a 997-byte
    re-export barrel, whose own consumer reaches it through `await import(...)` and destructures one
    export inside a single function — a call site no static import scan sees, measured separately and
    with a `skipped` list so the dynamic population has a denominator. Alongside the four, **294
    modules carry a bare side-effect import**, which is why `grep -l` answers 298.
  - **Nine constructing top-level declarators**, all declared as `moduleState` under chunk.ts rule 2b:
    eight `new Set` lookup tables and `Symbol("parse-aborted")`. The ninth is why this is a chunk and
    not seven splices — its IDENTITY is its contract (`KTe` does exactly one thing with it,
    `if (t === w3)`), and a consumer bound to a different symbol than the producer returns
    type-checks, reads correctly, and silently stops recognising a parse the engine gave up on.
  - **THE FINDING, and it reframes what §2.4's contract-test half is for.** Every export was sabotaged
    with a twin built to invert the one thing it means, and every twin driven over ALL SIXTEEN corpus
    scenarios that carry a Bash `tool_use`. **One reddens** — `parseOrAbort`, on five of the sixteen,
    because `dde` → `KTe` turns its sentinel into a `too-complex` verdict the recorded permission
    decision carries. **The other six move nothing**, and not because the twins are weak: `getParser`
    answers `null` for every input and `findCommandNode` answers `null` for every tree. The reason is
    the corpus. Its Bash commands are `echo REFORGE_TOOL_OK`, `chmod 600 perm.txt`, `mkdir -p`, `cd`,
    `pwd`, `sleep 3` and one missing binary, and the consumers those six feed — eleven safety analyses
    with defined fallbacks, a single keyword rejection guard, an env-prefix list no command has, a
    sentinel only compared on a path no command reaches, and an argv the permission rules do not match
    on (they match the command STRING; argv adds a candidate only when a wrapper is stripped) — cannot
    distinguish a correct answer from a fallback on any of it. That is a fact about the corpus, stated
    as one, and it is the first ownership in the campaign where the differential surface is the
    SMALLER half of the evidence.
  - **The oracle.** `strangle/parser-parity.test.ts` evaluates the PINNED CHUNK'S OWN BYTES and
    compares the two parse trees node for node — type, byte range, text, children, to any depth — over
    seventeen partitions of the input domain and 2,170 command strings. Byte ranges are part of the
    compared value because every offset this parser emits is a UTF-8 BYTE offset over a UTF-16 string
    and the consumers slice the command with them. Each partition declares the DIRECTION a wrong
    parser would fail it in, and the suite applies exactly that corruption to a healthy owned tree; two
    partitions failed that control on the first run, which was the control's defect, not the parser's.
  - **A second evidence channel for the attestation, and it is a spec-level addition.** 3,644 branch
    outcomes against 1,038 for the whole attested set before this child. `strangle/adjudicate.ts` now
    takes a SECOND executed-set — what a differential contract suite ran on the same instrumented
    module, driven by `strangle/parser-coverage.ts` in its own process and attributed by recorder file
    and byte offset — reported as its own state rather than as an exclusion. §3.1's bargain is
    unchanged in substance and sharper in form: a branch is EXECUTED (corpus), EXECUTED BY A SUITE
    against upstream's own implementation of itself with identity required, or carries a reviewed
    reason. Writing the third case for three thousand branches would have claimed "reviewed" for
    entries nobody could review. `attest.test.ts` gained four controls and a third staleness
    direction, so the channel cannot excuse a branch by existing.
  - **Eighty branches no command string reaches**, adjudicated in thirteen groups at the level of the
    module's own control flow: 25 false arms of a `while (true)`, 13 elses of an `if (callee(…))` whose
    callee has no failing return on that path, 10 arms selected by an argument value no caller passes,
    7 defensive re-checks the only caller already made, and so on down to one empty-statement-list arm
    that was argued and then brute-forced over every string of up to three characters in a
    34-character metacharacter alphabet. Two are resource ceilings deliberately not carried (a 64 MiB
    source, and a wall-clock deadline whose case would depend on machine load — the node ceiling, the
    other half of that pair, has its own partition). Three more were bought instead of excluded, by
    adding two commands to the coverage driver.
  - **Riders.** Two were already done and are recorded as verified rather than assumed: `tool/PowerShell`
    and `subsystem/tool-result-validators` both already read wave C13. The third landed:
    `subsystem/bash-executor` moves **unowned → spliced** with the chunk's footprint and its one
    capture rebased into the upstream basis; its `edges` stay EMPTY deliberately, because the owned
    unit has one port and no ledger row owns telemetry, while the subsystem's real edges are consumed
    by the executor C13b–C13e own.
  - **Attestation 478/1038 with 560 exclusions → 985/4682 executed, 3,060 by contract suite, 637
    excluded, zero un-adjudicated.** Manifest whole-chunk rows **2 → 3**. Corpus unchanged: zero new
    recordings, no port, no scenario, no engine-driving oracle, exactly as the cut priced it.
  - **One process note, because two workers shared a checkout.** `src/lock.ts` refused five
    sabotage-measurement cells by name while the sibling replayed a scenario, which is what let a hole
    in a measurement be diagnosed in one `tail` rather than mistaken for six dark exports — and it
    found the one place it was not yet applied: `strangle/attest.ts` took no lock, so a second process
    entered a gap between two of its scenario children and produced a FALSE RED that is
    indistinguishable in the log from a real one.

- 2026-09-05 (**H1 gate-inventory fix — the merged-tree gate's one red, and C12a/F5's deferral
  closed by the surface that should have held it**): the gate ran 158 phases, **157 PASS / 1 FAIL**
  (attestation green at 985/4682 executed, 3060 by contract suite, 637 excluded), and the FAIL was
  `config-dir inventory` naming three undeclared paths — the re-seal control's own harness seed, now
  a declared row whose `not-admitted` is computed from `src/state.ts` rather than chosen, and two
  `sessions/<pid>` files left by an uncleanly killed engine child. H1 closed both by hand (declaring
  the seed, DELETING the two literal rows from the derived census); this round removes the hand step.
  F5 withheld a `<pid>` token because a literal pid "reds loudly (the safe direction)" — right about
  the alarm, wrong about the surface: the census is an ACCUMULATOR shared by every wave, so the red it
  produces is "some run, in some wave, ever left one", repeated on every later gate until an operator
  edits a derived file. The per-run red is kept where it belongs (`src/state.ts`'s `CONFIG_INCLUDE`
  row `["sessions/**", "hash", …]`, line 192 as of `fddf380`, admits it and hashes it, and `entryOf`
  records the path verbatim, so a graded run that leaves one still fails), the projection is anchored
  at `^sessions\/\d+(?=\.)` so it eats no other numeric name, and
  `regeneralizeEntries` — shared by the reset that writes the census and the tool that checks it —
  folds stored literal rows on load with their counts summed, so the file heals itself. New gate phase
  `src/observed.test.ts` (15 controls, three mutations shown to bite; the block is 159 now); the
  `sessions/<pid>` tech-debt entry is CLOSED with its own cost estimate corrected, and one opened in
  its place: the census records no per-run provenance, so a residue row still cannot name the run that
  left it. **Generalizing: an alarm is only as safe as the surface it lands on — a tripwire that
  accumulates across waves cannot carry a per-run fact, because the run it names is gone by the time
  anybody reads it.**

- 2026-09-05 (**H1 — orchestrator-level harness work between W9a's fix round and W10: a
  replay-validated RE-SEAL of the precondition sidecar, and the single-writer sandbox lock**): two
  mechanisms the fleet needs before the waves that run two workers at once, plus the two riders
  C12a's verification round left named. No splices, no scenarios, no engine-ts modules.
  - **The re-seal, and the bill it pays.** C12a/F4's rule — the sidecar records the declaration AND
    the baseline seed's hash, and a drifted declaration is a FINDING with the RECORDED one replayed —
    is right and charges for every declaration change, including ones that provably cannot reach the
    model and including a baseline-seed change, which drifts all 63 sidecars at once. Live takes are
    throttle-bound (C12a-fix's one re-record of `store-read-only`: five attempts over four hours), so
    the bill's practical effect is a stale sidecar grading the wrong world. What was missing was never
    the reasoning but the EVIDENCE, and the replay proxy has been measuring it all along:
    `unmatched()`, `fallbackServed()` and `unserved()`. `m1/run.ts --reseal [--scenario <tag>]`
    replays the DECLARED precondition on the engine that RECORDED the cassette (engine-real: the
    stream is that engine's, and a strangled build would fold two questions into one answer), through
    the SAME graded run the corpus uses — `runOnce` moved to `src/runScenario.ts` unchanged rather
    than being copied — and re-seals only on all five of: no unmatched request, no positional serve,
    no unserved NON-REPEAT entry (a repeat answers a retry loop whose length is the engine's choice,
    not a fact the cassette fixes), the scenario's own `check`, and the run's `ok`. Otherwise the
    sidecar is untouched and the refusal names the FIRST failing signal with the method, path,
    ~200 bytes of canonical body and — for a positional serve — the entry served and the byte at
    which the two canonical bodies diverge. Success writes `resealedFrom` (the replaced
    declaration's sha256 and its baseline hash), the IMMEDIATE PREDECESSOR only: a chain keeps its
    last link, because the field answers a question about one step and the commit log has the rest.
  - **The negative is the mechanism, so it is measured.** `src/reseal.test.ts` drives
    `resealScenario(...)` against COPIES of a real cassette in a temp directory, all three controls on
    `store-seeded-resume` — chosen because its declaration seeds a transcript the engine RESUMES, so
    the seeded bytes reach the request body and the healthy and damaged cases demonstrably differ.
    An inert extra seed file under `projects/<key>/` RE-SEALS; the same seed with the prior assistant
    text `"OK"` → `"SURE"` is REFUSED naming `POST /v1/messages?beta=true`, entry seq 1 and **byte
    549**, printing both sides; a declaration with no seed at all is refused for its OWN reason (seq 1
    never requested, FEWER requests than the recording). 15 checks, **three replays in 2 s measured**
    against a ~2 min budget. Non-vacuity is asserted rather than assumed: the positive control
    requires both recorded exchanges to appear in the observed-request byproduct.
  - **The corpus's drift census is 0 of 63** (measured this run, `--reseal` with no tag), which is
    what C12a-fix's backfill predicts — so the mechanism lands with nothing to repair and its first
    real customer is C14a's baseline change.
  - **A sidecar that names no world is no longer graded.** A pre-F4 sidecar (no `baselineSha256`), or
    none at all, used to replay the recorded declaration — EMPTY when the file was missing — under a
    FINDING: a seeded scenario graded against the wrong world. Grading now REFUSES before the replay
    and names `--reseal` as the repair; watched refusing on a sidecar stripped of its hash and
    restored byte-identical.
  - **The peer guard, formalised (`src/lock.ts`).** Every suite calls `resetSandbox()`, which wipes
    `sandbox/` and `config/`, so two harness processes destroy each other's world mid-measurement and
    the victim reports it as an engine difference (paid for twice this campaign). The first reset in
    a process takes `reforge/.sandbox.lock`; a LIVE holder that is not us is a loud refusal carrying
    its pid and argv — never a wait (a fleet blocking on hour-long gates deadlocks), never a steal; a
    DEAD holder is taken over out loud; release happens on exit and on SIGINT/SIGTERM/SIGHUP,
    re-raising rather than swallowing, because registering a listener at all suppresses the default
    termination. The gate, `m2/all.ts` and the attestation hold it for their WHOLE run: a per-child
    lock leaves the gap between two children, where the corruption lands on the NEXT measurement.
    **Children of a holder are recognised by an ENV MARKER carrying the owner's pid**, and the choice
    is decided by the spawn paths rather than by taste — harness children are spawned with no `env`
    option and inherit `process.env` at any depth, while ENGINE children get X6's CONSTRUCTED
    allowlist, which drops the marker and must (an engine never resets). An ancestor walk would spawn
    a process to answer what the environment already answers, and would answer it wrongly for a
    detached holder whose child is reparented. `src/lock.test.ts`: 11 checks in REAL processes,
    because a live holder refusing and a signalled holder releasing are facts about pids and signals
    no fake has. It was exercised in anger the day it landed — a sibling worker's sabotage sweep held
    the lock and this wave's control run was refused by name.
  - **The gate archives itself** (`strangle/teelog.ts`): both console streams into
    `build/<name>-<yyyymmdd-hhmm>.log`, path printed in the header, for the gate and the attestation.
    `build/gate.log` predated two waves, so every quoted count rested on a `/tmp` redirect somebody
    had to remember. The clock is in the filename and the file is under derived, gitignored `build/`:
    a log may carry a clock, a fixture may not.
  - **What still needs a live take, stated so it cannot be forgotten:** a change that CAN reach the
    model, and every new scenario. And the seven primary cassettes written by runners other than
    `m1/run.ts` carry no sidecar, so they cannot be re-sealed — the re-seal NARROWS that debt (logged,
    flagged on C14a) rather than closing it.
  - **THE GATE RAN: 158 phases inside the block, 157 PASS, 1 FAIL, 75 minutes**
    (`reforge/build/gate-20260905-0816.log`, the first run archived by this unit's own rider). The
    count is exactly the 158 predicted from the phase lists and the manifest before the run: 147 + 9
    (C13a) + 2 (H1). Both new phases green in situ. **The lock's real result is not its own phase but
    an absence**: the gate held the sandbox lock for the whole run, spawned 112 liveness targets'
    worth of covering replays inside that hold, every one of which calls `resetSandbox()`, and
    returned ZERO INCONCLUSIVE — had the env marker not propagated through `spawnSync`, each runner
    would have aborted on a refused acquire and graded nothing, which the three-outcome rule reports
    as INCONCLUSIVE rather than RED. `equivalence (faithful)` green is where `src/runScenario.ts` is
    verified corpus-wide (the phase passes only when all six `m2/all.ts` suites do, the first being
    the 63-scenario corpus). `coverage attestation` green at 985/4682 executed, 3060 by contract
    suite, 637 excluded — moved from the last recorded numbers for C13a's reasons (a new attested
    module and a second evidence channel), not for H1's, which touches no splice and no attested
    module. **The one FAIL was the config-dir tripwire, and all three of its paths were true
    positives.** Two were `sessions/<pid>.json` and its `.key`: `generalizePath` has no `<pid>` token
    ON PURPOSE, so a literal pid arrives undeclared and reds — the residue of an engine child killed
    uncleanly when this session handed the lock back to a sibling. The census accumulates across every
    reset ever taken, so those two entries were dropped from the derived
    `build/config-observed.json` rather than declared; declaring a literal pid is what the
    un-mintable pattern exists to refuse. The third was H1's own: the inert file the re-seal's
    positive control seeds, now a declared row on the `projects/<slug>/.keep` precedent with a `why`
    stating that the engine never writes it. Green on re-run: 27 patterns over 4,979 resets, all
    declared, 17 admitted.
  - **Why it ran at 08:16 rather than when the unit was ready.** The build-free determinism
    block was run phase by phase from the gate's own argv list: **24 of 24 PASS, zero FAIL**,
    including this unit's lock phase and the sibling wave's shell-parser fixture. The re-seal control
    phase is 15 checks green in 2 s; the tagged re-seal was exercised against a real corpus sidecar
    (`store-read-only`, re-sealed with provenance) and the malformed-sidecar refusal was watched
    refusing. **The full gate was not run inline for a measured reason**: C13a landed a seven-export
    chunk replacement mid-unit and was still uncommitted in the same checkout, with
    `attestation/coverage.md` three days stale — so `attest --check` would have been red for its
    reason, and a gate holding the sandbox lock for one to three hours would have refused the very
    `attest.ts` run that fixes it. So the gate was ARMED on a detached launcher rather than launched, and fired ninety minutes later
    on the first checkout that was quiet AND clean (no harness process, no lock, no modified tracked
    file under `reforge/`, no verdict already archived by a sibling's own run). A `[parent-impact]`
    on the brief's gate item stands regardless of the outcome: it was written against a 147 baseline
    that a concurrent worker had already moved to 156, and the arithmetic is 158.
  - **A shared-checkout artefact, recorded because the commit log misleads without it:** `git add`
    stages a path's current contents, so two of C13a's in-flight edits were swept into H1 commits —
    the two gate phases into `9d1c172`, `attest.ts`'s contract-evidence section into `511820f`.
    Nothing lost, both on `main`, attribution wrong. Diff a shared file before staging it.
  - **One debt found in passing and logged** (`CC-to-SDK/docs/tech-debt-tracker.md`, 2026-09-05): a
    corpus scenario that REFUSES TO GRADE prints `FAIL  <tag>`, and `classifyReplay` reads that as
    RED — so in the liveness loop's LIVE direction a row could be satisfied by a scenario that graded
    nothing. Latent (drift census 0 of 63), loud in the log, and safe in the DARK direction, which
    requires GREEN. The fix is a third verdict word, which is read by four layers and was not worth
    changing under a sibling's in-flight wave.

- 2026-09-03 (**C12a / W9a FIX ROUND 2 — a verification of the fix round; the load-bearing finding is
  that the round corrected a wrong mechanism by writing a different wrong one**): the fix round below
  was verified against the pinned bundle and against its own artifacts. Five findings.
  - **X1 — a mechanism claim the bundle does not support, for the second wave running.** F6(b)
    replaced "the headless resume does not walk `parentUuid`" with "it walks, sees the repeat, logs
    `Cycle detected in parentUuid chain … Returning partial transcript` and fires
    `tengu_chain_parent_cycle`", and made that BINDING on C12b. The walk is real; the event is not.
    `BSe`'s loop-top cycle check (`chunk-fy12d89p.js` @212711) is the only site of that log and that
    codeword in the bundle, and it is unreachable: `d` is only ever assigned a not-yet-visited record,
    because the parent-lookup guard (@212937) keeps `e.get(parentUuid)` only when the parent is
    unvisited and otherwise consults `QVt` (@214473), which skips every record already in the visited
    set. The already-visited parent is diverted before the cycle check can see it, in `BSe` (@212659)
    and in each of its seven callers (@191854, @220017, @242071, @266672, @275186, @281619,
    @1391029), all of which enter with a fresh set. Simulated on `BSe`'s own extracted bytes with the
    scenario's seed and the `parent-cycle` fault: one-second spacing recovers 4 of 4 and fires
    `tengu_chain_timestamp_fallback` once, logging nothing; six-second spacing recovers 2 of 4 with no
    event and no log. `YVt` = 5,000 ms (@214460), the nearest-not-yet-visited rule, the 2-of-4 number
    and the seed's load-bearing spacing all hold. Corrected in the README's W9a paragraph and seam
    note, in the C12a and C12b tracking rows, in F6(b) below, in the D8 revision note below, in
    `w9/scenarios.ts` (which now carries the loop and the offsets) and in `src/precondition.ts`. The
    C12b binding is restated: reproduce the guard ORDERING and the fallback, do NOT fire the cycle
    codeword.
    *THE PATTERN, which is the part worth carrying.* This is the second wave in two whose record gave
    a MECHANISM the pinned bytes do not support, and both failed identically: a correct OBSERVATION
    was explained by the first mechanism that fit it, and the explanation inherited the confidence the
    observation had earned. C16b claimed the headless SIGTERM handler's abort short-circuits the hang
    guard — true of SIGINT alone, because the two paths abort different controllers. C12a claimed a
    cycle-detection event fires — true of the walk, false of the event, because a guard one branch
    earlier makes that branch unreachable. In both the outcome was measured and right and the causal
    story was never read back out of the bundle. A measured outcome does not license an unmeasured
    mechanism; they are separate claims. "X happens because the engine does Y" owes Y its own offsets,
    and a NEGATIVE mechanism — a branch that cannot be reached — owes the guard that makes it so,
    rather than the absence of a log line.
  - **X2 — the F7 relay fix read `stdout` alone.** A covering runner that dies before its verdict
    block writes its cause to stderr (a module-load throw on the instrumented graph) or nowhere at all
    (a spawn that never ran), so `fails` and `reasons` both came back empty and the phase reported a
    red tag with nothing under it — the F7 defect surviving on the sibling path. All four relays now
    read stdout AND stderr — `strangle/attest.ts`, `strangle/gate.ts`'s attestation and equivalence
    phases, and `m2/all.ts`, the FIRST hop, which had the identical defect — and print one marked
    fallback line when the vocabulary recognises nothing: the last three non-empty lines of the
    combined output plus the spawn's own error. Marked because it must survive the next hop:
    `RELAY_FALLBACK_MARKER` is part of `REASON_RE`. `m2/relay.test.ts` 20 → **26 checks**; reverting
    the combined read fails 3 of the 6 new ones.
  - **X3 — F2's "a symlink is a leaf" was true of DIRECTORY links only.** `tallyIdShapes`
    (`src/observed.ts`) lstats and then tests `isDirectory()`, false for a link to a file, so a
    symlinked `.jsonl` under `projects/` was queued and `readFileSync` followed it, and a dangling one
    threw inside the reset. A symlink is a leaf of that walk now too, with the comment recording that
    nothing creates one here today (the engine writes no links into its config dir; `SeedFile` has no
    link kind). `src/precondition.test.ts` 20 → **22 checks**, mutation-proved in both directions.
  - **X4 — the config-dir inventory's `counts` block was written and never compared**: F3 one field
    over, and the recurring class of this campaign — a check comparing a subset of what its own
    generator writes. `patterns`, `admitted` and `notAdmitted` are recomputed from the committed
    entries and compared exactly; `resetsObserved` cannot be (it records the census the last
    GENERATION read, 1,773, against the 3,465 today) and is checked for being a real observation and
    reported as a note, the way the `seenAtLeast` floors already are. The fixture's own
    `engineVersion` is compared to the pin. Four mutations, each restored after: a retyped count, a
    flipped `graded`, a zeroed `resetsObserved`, a hand-edited `engineVersion`.
  - **X5 — one comment.** F4's note read as a repository fact; `cassettes/` is gitignored, so the
    63-sidecar backfill was local state and the repository carries the rule rather than the artifacts.
  - **RIDER — one debt** (`CC-to-SDK/docs/tech-debt-tracker.md`, flagged on the C14a row): the
    baseline-seed sidecar is written and compared by `m1/run.ts` alone, so the seven primary cassettes
    recorded by other runners (`m2-fault-*` ×5, `m2-raw`, `w13-signals`) are recorded against the
    baseline seed — all three runners call `resetSandbox()` — and record no hash of it. For those 7 of
    70 a baseline change without a pin bump replays green against a world the cassette does not
    answer. C14a is the wave that changes the baseline.
  - **NO GATE RUN in this round**: it changes prose, two logging paths, one census guard and one
    `--check`. The affected suites were run individually (`m2/relay.test.ts`,
    `src/precondition.test.ts`, `strangle/attest.test.ts`, `strangle/mechanism.test.ts`,
    `extract-config-inventory.ts --check`) and the orchestrator runs the gate over the merged tree.

- 2026-09-03 (**C12a / W9a FIX ROUND — one exported fault that had no caller and did not fire, plus
  five smaller corrections; two independent reviews converged on the first**): a doctrine-boundary
  review and an independent Codex review, cross-verified, both landed on the same load-bearing
  finding. The rest are cheap and were taken in the same pass. Every item below was driven RED against
  the pre-fix code before being fixed.
  - **F1 — the `read-only-store` fault was an exported arm with no caller, inert under its own
    documented usage.** *What was claimed*: the wave record, this spec's C12a row and the gate's phase
    label all say "three named filesystem faults … each watched doing what its name says." *What was
    true*: `applyFault`'s `read-only-store` arm chmodded its TARGET FILE `0o500` while the comment
    directly above it said "the DIRECTORY, not the file", and `FsFault.target` documented the target
    as "the seeded file the fault damages". Under that documented usage the fault does not fire —
    demonstrated: with the file chmodded, creating a NEW file in the project directory still succeeds,
    and creating a new session file is exactly what the store does. Worse, nothing in the repo passed
    `kind: "read-only-store"` at all: the `store-read-only` scenario and the `precondition.test.ts`
    control both reached an unwritable directory through `SeedFile.dirMode: 0o500`, around the fault
    rather than through it. So one of the three named faults had no caller, no test, and no effect
    under its contract. *What is true now*: the fault chmods `dirname(target)` and the contract says
    so in both places; `SeedFile.dirMode` is DELETED, because it was the bypass; the scenario and the
    control both go through the fault kind; and the control asserts all three directions — creating a
    file through the fault fails `EACCES`, the identical creation without the fault succeeds, and the
    file the fault names keeps its own write bit. Driven red against the old behaviour: "the write
    SUCCEEDED", dir `755`, file `500`. `store-read-only` was re-recorded ONCE, deliberately, because
    its declaration changed and the sidecar drift check fired by name (X5).
  - **F2 — a symlink is a leaf, and three walks followed one.** `restoreWritable` (the wipe's
    permission restore) and both walks in `src/observed.ts` used `statSync`, which resolves the link.
    A directory symlink under CONFIG_DIR therefore got its EXTERNAL target chmodded `0o700` by a
    function whose job is to make our own directory removable, and the census tallied another
    directory's contents as config-dir writes (`loop -> .` throws ELOOP — loud, but a reset that dies
    is a reset that did not happen). All three now use `lstatSync` and never recurse through a link.
    Two controls: a symlink to a scratch external directory survives the wipe with its mode and
    contents untouched, and the census records the link and nothing beneath it. Driven red: the census
    reported `elsewhere/sub`, `elsewhere/sub/keepme`, and the external directory came back mode `700`.
    *(Half true when written, corrected by the verification round — see the fix-round-2 note: the
    transcript walk switched to `lstat` but still tested only `isDirectory()`, so a symlinked `.jsonl`
    was queued and READ THROUGH, and a dangling one threw inside the reset. A symlink is a leaf of
    that walk now too, with a third control.)*
  - **F3 — the inventory's `why` column was written and never read** (the C11a class, one artifact
    over). `extract-config-inventory.ts` generated `why: … ?? "UNEXPLAINED — …"` for every excluded
    pattern, and `--check` compared only `kind` and `graded`. Demonstrated: a fixture row carrying the
    UNEXPLAINED placeholder passed. `--check` now refuses any row whose reason is UNEXPLAINED,
    compares the committed reason against the one `PATTERN_REASONS` gives today, and refuses a
    declared floor of zero (a row no census ever contributed). The floor is otherwise a NOTE, not a
    failure: every corpus run raises the census above the recorded floor, and a red that fires after
    every run teaches people to ignore red. Driven red on all three arms at once.
  - **F4 — the sidecar recorded the declaration but not the world.** `applyPrecondition` prepends
    `emptyPreconditionFor(pin)` under every declaration, so the APPLIED precondition is the baseline
    seed plus the declaration — and only the declaration was written beside the cassette. Two
    recordings whose declarations match byte for byte could have been made against different
    baselines, silently. The sidecar now carries `baselineSha256` beside `declared`, is written for
    EVERY cassette (including the empty declaration, which is still a filesystem), and a sidecar
    without it is a named finding rather than a silent equality. The corpus's 63 sidecars were
    backfilled with the current baseline hash; the worker had already measured that none of the
    cassettes depended on accumulated config state, so no re-record was owed. Driven red by corrupting
    one sidecar's hash: `FINDING: the baseline seed has changed since the recording (000000000000 →
    …)`, `FAIL plain`.
  - **F5 — an orphaned engine child's residue became an undeclared census pattern.** A reviewer killed
    a standalone `attest --check` mid-run; the orphan left `config/sessions/10747.json` and its `.key`
    behind, the next reset censused both, and `extract-config-inventory.ts --check` then failed on two
    paths no clean run produces. The census (derived, gitignored) was repaired and the family DECLARED
    honestly: `sessions/<pid>.json` and `sessions/<pid>.<hex>.key`, `graded: admitted` because
    `src/state.ts` hashes `sessions/**` raw, each carrying its provenance — 0 of 1,768 clean resets
    produce one. The family is declared but NOT projected: `generalizePath` has no `<pid>` token, so a
    real `sessions/12345.json` still reds the tripwire by name, which is the safe direction. The
    projection is logged in `CC-to-SDK/docs/tech-debt-tracker.md` against the first scenario that
    reaches the family on purpose.
  - **F6 — three prose corrections.** (a) The ENOSPC justification said none of `{ENOSPC, EROFS,
    EDQUOT, ENAMETOOLONG}` can be raised unprivileged. False for the fourth: a 300-character filename
    returns `ENAMETOOLONG` (measured). The claim is now stated over the three that hold, and C12d
    inherits the fourth as a route through a pathologically deep sandbox cwd — a fault of the PATH
    rather than of the filesystem, needing neither a disk image nor an fs shim. (b) The D8 correction
    said the headless resume "does not walk `parentUuid`". It does: `BSe` walks it, and `QVt` heals the
    walk from the nearest not-yet-visited record within `YVt` = 5,000 ms, firing
    `tengu_chain_timestamp_fallback`. The transcript survives because the fallback rebuilt it, and it
    succeeds only because the seed's records are one second apart; at six-second spacing the walk
    recovers 2 of 4. The C12b row is rewritten as BINDING on the walk and the fallback, and
    `store-parent-cycle` now pins the seed's spacing as much as the fault. *(This item was itself
    wrong in one respect and is corrected by the verification round — see the 2026-09-03 fix-round-2
    note: it claimed the walk also fires `tengu_chain_parent_cycle`, and that arm is unreachable.)* (c) The flush prose binarised the timer arm as "49 or 71"; the measured distribution
    also includes 50 and 53, so it is stated as multi-valued in the note, the table, the README and
    the gate phase's own comment.
  - **F7 — a red coverage attestation could not say what failed, and that cost a gate cycle.** The
    round's FIRST gate came back **146 PASS / 1 FAIL**, the one failure being `coverage attestation`:
    "the instrumented build is not equivalent (hooks-memory went red)". The faithful equivalence phase
    passed in the same run, `hooks-memory` included, so the scenario was red only on the instrumented
    build — and the log said nothing else. `strangle/attest.ts` spawns the corpus runner per covering
    scenario, CAPTURES its stdout and drops it, printing the tag alone; `strangle/gate.ts` then
    filtered that output to verdict-shaped lines, which discards the scenario's own diff lines too. So
    the entire record of the failure was one tag: not which of the four surfaces moved, not by how
    much. That is the identical defect the gate documents at length for the EQUIVALENCE phase fifteen
    lines further down — "a phase that can fail has to say what failed, or its failure is a rumour" —
    and this phase never got the fix because its failure had never been read in anger.
    *The diagnosis, since the log could not give one*: a fresh instrumented build was made and
    `hooks-memory` replayed against it **six times, green every time, all four surfaces identical on
    every take** including the config root this wave added (`state (1 sandbox, 6 config entry, engine
    completed): identical`). So it is NOT a byte the newly-admitted root now sees — that would be
    deterministic — and not a field owing a §3.4 projection; the scenario's own working directory
    (`/private/tmp/reforge-w5-memory`) is not a registered state root at all, and no file under
    `projects/<slug>/memory/` is admitted (the directory is merely DESCENDED into, incidentally,
    because it matches the ancestor of the subagent-transcript rule). A sensitivity, then, not an
    inequivalence — and it did not recur on the second gate. *The fix* is the legibility, not the
    scenario: both layers now relay through `m2/relay.ts`, the module whose own header says the rule
    holds only if every layer between the failure and the log agrees on what a failure looks like.
    Proved on a red runner output: the relay carries `FAIL  hooks-memory` together with
    `state (1 sandbox, 6 config entry, engine completed): 2 difference(s)`.
  - **CLOSE-OUT.** `store-read-only` re-recorded once, deliberately, on the fifth attempt after four
    server-side throttles (`API Error: Server is temporarily limiting requests (not your usage limit)`)
    — 2 API exchanges, **state, events and requests all identical**, `ALL PASS`. Its state line reads
    **5 config entries** where an unfaulted scenario reads 6: the engine could not create its session
    file in the read-only project directory, which is the F1 fault firing end to end in the corpus
    rather than only in a control. Gate, second run, **147 of 147 summary phases, zero FAIL**
    (`GATE PASS — every splice is live AND the faithful build is equivalent`); attestation
    **478/1038 executed with 560 exclusions, zero un-adjudicated**; the filesystem-faults phase at
    **20 checks** against 15 before this round (+3 for F2's symlink controls, +2 net for F1's); the
    config-dir inventory at **26 patterns over 3,449 resets, 17 admitted**; run-id shapes at 20 mapped
    keys with 2 recorded collisions; and the eager-flush control still firing in both directions. No
    attestation rebuild was owed — `attest.ts --check` is the gate's own phase and nothing under
    `strangle/attest*` changed until F7, which is a logging path.

- 2026-09-03 (**C12a / W9a — a `parentUuid` cycle costs the headless resume nothing, and the reason is
  a HEAL rather than an absent walk; the scout's §4.4 D8 is corrected, and so is this note's own first
  wording**): the W9 scout's dirty-state matrix reads D8 as "resume with a `parentUuid` cycle →
  `tengu_chain_parent_cycle`, partial transcript". The cycle is now seeded, and it is real:
  `src/precondition.test.ts` walks the seeded file from its leaf and proves the first exchange is off
  the chain. The engine sends that exchange anyway — the `store-parent-cycle` recording carries both
  seeded codewords, byte-identical to the healthy control's request.
  **What that means was written down wrong twice, and the second wording is corrected here (fix
  round 2 / verification, 2026-09-03).** The first wording was "at 2.1.251 the `--print` resume path
  does not rebuild its history by walking `parentUuid`". It DOES walk it: `BSe` (`chunk-fy12d89p.js`
  @212659) walks up from the leaf. The second wording then said the walk "sees the repeat, logs
  `Cycle detected in parentUuid chain … Returning partial transcript` and fires
  `tengu_chain_parent_cycle`" — and **that arm cannot fire**. The loop-top cycle check
  (`u.has(d.uuid)`, @212711) is the only site of that log and that codeword in the bundle and it is
  DEAD: `d` is only ever assigned a not-yet-visited record, because the parent-lookup guard
  (`if(!A||u.has(A.uuid))`, @212937) keeps `e.get(parentUuid)` only when the parent is unvisited and
  otherwise consults `QVt` (@214473), which skips every record already in the visited set. The
  already-visited parent is diverted before the cycle check can see it, in `BSe` and in each of its
  seven callers (@191854, @220017, @242071, @266672, @275186, @281619, @1391029), all of which enter
  with a fresh visited set. What the scout's row does not carry is the recovery, and the recovery is
  the whole mechanism: `QVt` selects the nearest not-yet-visited record whose timestamp lies within
  `YVt` = **5,000 ms** (@214460) before the current one, fires `tengu_chain_timestamp_fallback`, and
  the walk continues through it; when it finds nothing the walk ends silently, with a partial
  transcript and no event of any kind. The transcript survives because the fallback rebuilt it, not
  because the cycle was inert and not because anything detected it. **The seed's bytes are therefore
  load-bearing**: its records are spaced one second apart and every step falls inside the window.
  Simulated against `BSe`'s own extracted bytes with this seed and this fault — one-second spacing
  recovers **4 of 4** records and fires `tengu_chain_timestamp_fallback` once, logging nothing;
  six-second spacing recovers **2 of 4** with no event and no log. The scenario pins the seed as much
  as the fault. **C12b is bound by this**: the reader must reproduce the guard ordering and the
  timestamp fallback and must NOT fire the cycle codeword, and its chain walk is gradeable from the
  synthetic corpus and never from a `--print` scenario. (One measurement had to be corrected on the
  way in the first round too: with a ONE-exchange seed the fault graded nothing — the walk collects
  both records and then sees the repeat — so the seed carries two exchanges and two codewords, giving
  the cycle something to cost.)

- 2026-09-03 (**C12a / W9a — the storage oracle machinery, and three decisions taken by measurement
  rather than by argument**): the machinery child of the W9 cut, no splices. Gate **147 of 147 summary
  phases, zero FAIL**; attestation **478/1038 executed with 560 exclusions, zero un-adjudicated**; corpus **87 cassettes / 205 request bodies over 63 scenarios**. Five gate
  phases added: `src/precondition.test.ts` and the storage-surface fixture in the determinism block,
  and — in the auxiliary block, where the artifacts they grade exist — the config-dir inventory, the
  run-id shapes, and the eager-flush knob's negative control.
  - **The flush schedule: branch (c), and branch (a) was believed for one scenario.** The cut named
    three branches in order and said to measure. `resume` (16 records) was byte-stable across five
    replays, which reads as branch (a) — and one scenario was not the population. Measured on
    `compact-continue`, `config/projects/<slug>/<session-uuid>.jsonl`, eight takes per arm, config
    reset before each:

    | arm | byte lengths | record counts | projected snapshot |
    |---|---|---|---|
    | eager (`CLAUDE_CODE_EAGER_FLUSH=1`) | 33,111–33,175 | **49 every take** | **STABLE** |
    | timer (the engine's own 100 ms drain) | 33,120 / 33,147 / 55,556–55,730 | **multi-valued: 49, 50, 53, 71** | UNSTABLE |

    Raw sha256 matches in neither arm and is not expected to: every record carries a fresh session
    uuid, a fresh `promptId` and a millisecond clock, which is exactly why the surface projects rather
    than hashes. Branch (b), an observed quiesce, was implemented and is insufficient — the transcript
    compactor rewrites the file while the drain is still appending, and waiting cannot decide a race
    already lost. So **`CLAUDE_CODE_EAGER_FLUSH` enters X6**, ON by default (a property of the
    measurement regime, like the four telemetry switches, not of one scenario), with the negative
    control the cut required as a gate phase at eight takes per arm — the unforced arm's record count
    is MULTI-VALUED (49, 50, 53 and 71 observed; an earlier draft of this note binarised it as "49 or
    71"), so a three-take control would report a false failure a good fraction of the time. What it costs is stated where C12c will pay it: the write queue's batching is out of every
    graded run, so that wave's "dropped `pendingEntries` replay" and "queue item resolved before its
    bytes landed" mutations become load-bearing rather than belt-and-braces. `awaitQuiesce` is kept
    anyway, because it turns "the file was still moving" into a named failing outcome and C15a's root
    has no such knob.
  - **`resetSandbox()` wipes the config dir whole and seeds a declared baseline**, and the baseline is
    a measured necessity rather than a convenience: against a genuinely empty config dir two runs of
    the SAME engine differ on `firstStartTime`, `machineID` and `userID`, and with the seed the engine
    preserves all three byte for byte and writes no clock-named backup at all. Because the identity is
    now a DECLARED INPUT the projection GRADES it instead of hiding it. `skillUsage` is RESET by the
    wipe rather than scrubbed in the differ — a scrub would hide a real counter defect on the one
    surface that can see it — and the cost lands on C14a, which must SEED a non-zero counter through
    the precondition.
  - **The config-dir inventory, measured** (`config-dir-inventory-2.1.251.json`, 23 patterns over 148
    resets, 15 admitted by the state surface). Admitted: `.claude.json`; `projects/`,
    `projects/<slug>/`, `projects/<slug>/<uuid>.jsonl`, `projects/<slug>/<uuid>/`, `…/subagents/` with
    both `agent-<agent-id>.jsonl` and `agent-<agent-id>.meta.json`; `projects/<slug>/memory/`;
    `sessions/`; `tasks/<uuid>/` with `.lock`, `1.json`, `2.json`. Not admitted, each with a stated
    reason: `.last-cleanup`, `backups/` and its clock-named backup file, `session-env/<uuid>/`,
    `shell-snapshots/`, `…/auto-mode-classifier-error.txt`, and `projects/<slug>/.keep` (this wave's
    own read-only-store seed, not an engine write). The fixture exists because the include-list has
    one silent failure mode — a pin that starts writing a seventh family is seen by nothing — and it
    earned itself on its first run twice: it found the `.meta.json` sibling of a file the list already
    admitted, and it found that every shell snapshot was its own pattern, which would have failed the
    check on the next run for a file that is not new.
  - **The new surface found five things on the identical-code pair, and none was the risk the cut
    flagged.** No cassette's replay depended on accumulated config state. All five were calibration:
    `.claude.json`'s per-project block carries a clock, four durations and a cost (enumerated scrubs,
    not a pattern — any pattern broad enough also eats the now-graded `firstStartTime`); parallel tool
    results are written to the store in COMPLETION order, and the race leaks one record PAST the batch
    into the successor's `parentUuid`; session files are named after a random uuid, so `/clear` listed
    two of them in a coin-flip order; and the flush and baseline-seed measurements above.
  - **`slug` is one property name over two run-scoped values, and getting that wrong cost a gate
    run.** The run-id shapes census (the ELEVENTH pin-keyed fixture) reported 124 `slug` values in no
    known lexeme class beside 2,531 project keys. The first reading was the artifact records
    (`artifactRead:{slug,ver}`, the `artifact-changed` queue events), where `slug` is an artifact
    NAME and therefore behaviour — a real overload, and not the one those 124 were. The guard it
    produced admitted only values beginning with the flattened path separator, so the value they
    actually are — a per-run session name the engine starts writing into every stored record AT THE
    COMPACT BOUNDARY (records before one carry no `slug` at all) — went unmapped. That single field
    reddened seven corpus scenarios, the coverage attestation, the eager-flush control, and two dark
    liveness rows whose covering scenario one of the seven is: **five of a three-hour gate run's FAILs
    from one unmapped field.** All `slug` values are mapped now; what that costs is stated where it is
    paid, because the slug's leading component is a prompt-derived TITLE when the session has one
    (`use-the-read-tool-humming-bentley`) and one more random word when it does not
    (`curious-yawning-pebble`), so no partial scrub is stable and the title claim moves to C12c. The
    same census recorded a second task-id shape (`b`+8 base36 for background tasks against the Agent
    tool's `a`+16 hex, under one property name), which is what C15a3's cut asks to enumerate before
    the first nesting scenario.
  - **[parent-impact] ENOSPC is DECLARED UNREACHABLE — a deviation from this child's own acceptance
    criterion, raised with the measurement and ACCEPTED 2026-09-03.** The C12a bullet asks for "a
    seeded torn tail, a seeded cycle and a seeded `ENOSPC`, each producing a named stable verdict on
    both engines". The store fence latches on `{ENOSPC, EROFS, EDQUOT, ENAMETOOLONG}`, and THREE of
    those four — `ENOSPC`, `EROFS`, `EDQUOT` — cannot be raised against a chosen path by an
    unprivileged process on a normal filesystem. The two mechanisms that would reach them are named
    and neither is bought: a mounted disk image is a machine fact rather than a harness fact, and an
    fs shim preloaded into the engine child changes the binary under test and collides with the BUNFS
    reachability rule. **The fourth is reachable and this note first said otherwise** (fix round,
    2026-09-03): a 300-character filename returns `ENAMETOOLONG` unprivileged on a normal filesystem,
    measured. It is a fault of the PATH rather than of the filesystem — the store's project path is
    derived from the cwd, so a pathologically deep sandbox cwd raises it — and it is handed to C12d
    with the fence rather than bought here. `store-read-only` grades the
    store's OTHER latching errno family (`{EACCES, EPERM}`, the fifth of the scout's six
    damaged-filesystem arms) and is honest about what it does not reach: the fence's stickiness across
    the four ENOSPC-family codes. **C12d inherits the decision**, and C16f carries it as an advisory —
    a real mount under that wave's sandbox-exec profile is the natural place to raise EROFS or EDQUOT
    as a machine fact if the stickiness is ever graded.
  - **A population census over a SAMPLE is not a population**, which cost one gate run and is the
    generalizable half of this child's fixture work. The config-dir inventory is derived from what
    `resetSandbox()` saw before wiping, accumulated across a corpus run — but some families are
    written on some runs and not others (`shell-snapshots/snapshot-zsh-<ms>-<rand>.sh` is written per
    shell spawn). Regenerating the fixture from ONE fresh census dropped that pattern, and the next
    gate wrote a snapshot and reddened on a file that is not new. Generation unions with the committed
    fixture now and takes the larger floor, so the declared set only grows, while `--check` still
    refuses anything undeclared — the tripwire is unchanged and only the sampling is fixed. The
    pattern is DECLARED and NOT admitted: a shell snapshot is the Bash executor's artifact, and if it
    is ever graded it belongs to C13d's root rather than storage's. Every excluded family now carries
    its reason next to the pattern rather than only in the include-list's comment, because a row that
    says only `not-admitted` records a decision without recording who made it.
  - **Riders.** The ledger's `subsystem/session-storage` row had an EMPTY edge array while three
    spliced rows pointed edges at it — four symmetric edges now — and its artifact list was one
    723-byte method (0.4 % of a 172 KB subsystem, so §5 could not stale it when the rest moved); it is
    now the derived 235-name public surface, which reproduces the scout's consumer table and corrects
    it twice (**13** `*ForTesting` exports, not 12; **42** importing chunks, not 43).
    `chunk-d78hxkfm.js` leaves through §1.2's pin-conditional GATE-DEAD door on `tengu_hover_rest` —
    the second row to use that kind, and the first to use it for a BACKEND of a row that stays
    canonical. C16b's carried population minor is closed: `twn-claim-shutdown` and
    `twn-release-shutdown-claim` now declare `darkOver` over all three headless signal paths and the
    gate re-measured both GREEN. One mechanism defect is logged rather than fixed
    (`docs/tech-debt-tracker.md`, 2026-09-03): a dark row's verdict reads the whole SCENARIO, so a red
    on any other surface reports every dark row that scenario covers as "NO LONGER DARK".

- 2026-09-03 (**C16b-fix / W13b boundary review — the mechanism was wrong, the darkness was right**):
  the review's verdict was CODE CONVERGED, RECORD NOT CONVERGED, and its load-bearing finding is a
  retraction the wave has to make in its own voice. Re-gated whole: **142 of 142 summary phases, zero
  FAIL** (`GATE PASS — every splice is live AND the faithful build is equivalent`), no phase added or
  removed; attestation unchanged at **478/1038 executed with 560 exclusions**, zero un-adjudicated,
  the committed report being that run's own output. **What the wave said:** the latch's `commitShutdown`
  and `hang` are corpus-dark because every hang consultation reads `xo() && !aborted` and upstream's
  SIGTERM handler aborts before it exits, short-circuiting the guard the commit exists to open.
  **What the bundle says:** SIGTERM's `br` aborts `Rn = gr(500)`, the DISPATCHER's run controller. The
  hang guards read `xo() && !<ctx>.abortController.signal.aborted`, and that controller is the QUERY
  controller `Qe = gr()`, which `ky` passes into `submitMessage` as `abortController: Qe`. `gr` is
  `function gr(e=c){let r=new AbortController;return setMaxListeners(e,r.signal),r}` — an independent
  controller whose argument is a listener cap, not a parent signal — and none of the 30 `Rn` references
  links the two. The abort argument is **true of SIGINT and of nothing else**: `Hn` runs
  `if(Qe&&!Qe.signal.aborted)Qe.abort(Su("user-cancel"));Rn.abort(),wU(),On(0)`. Verified in
  `~/claude-code-bundle/2.1.251/modules/chunk-dvbbv89q.js` and `chunk-t0q53bgm.js`.
  - **THE DARKNESS ITSELF STANDS, AS A MEASURED-DEAD RATHER THAN AN EXPLAINED-DEAD.** The reviewer
    measured signal-to-exit latency at **14-41 ms** hookless on all three paths and perturbed the
    experiment three ways against `engine-strangled` with each twin built — trigger after the
    `tool_use` frame with the tool running; a `SessionEnd` hook sleeping two seconds, widening the
    shutdown window to **~1.64 s**; and both together. Nothing moved in any arm: same four frames,
    same exit status, one request. So the claim the record now makes is the measurement — **no
    in-flight continuation resumes inside the shutdown window on any of the three paths** — and the
    parent-impact filed against L17 is **withdrawn on its false basis and restated on the measured
    one**: L17 is not refuted, its hang is UNOBSERVABLE by any headless stimulus this wave could
    apply. Reworded in `strangle/manifest.ts` (both `darkReason`s), `w13/signals.ts`'s header, the
    `reforge/README.md` W13b section, this document's C16b bullet (3) and its C16b tracking row.
  - **THE `darkOver` POPULATION IS NOW ALL THREE PATHS.** `sigint-mid-turn` joins the two on both dark
    chunk exports. The dominance argument that justified leaving it out was sound and is now moot: the
    reviewer measured both twins inert on that path, standard and hooked. The tech-debt entry that
    logged the gap is REMOVED rather than marked paid, because the debt was the omission itself.
  - **A DEFAULT THAT MADE A HAND-RUN SABOTAGE CHECK READ GREEN.** `w13/signals.ts` defaulted
    `--engineB` to `engine-extracted`, so running it by hand without the flag graded the UNSTRANGLED
    graph against the oracle — a twin-sabotage check that cannot fail. The flag is now REQUIRED (exit
    2 with the reason) rather than re-defaulted: a driver whose whole purpose is to grade one engine
    against another should not guess which one, and the gate already passes it from `strangle/runners.ts`.
  - **PROCESS, logged rather than fixed:** two C16b commits carried splices with no ledger change —
    `d467459` (the chunk taken whole) and `2fe7e0e` (the four `TWn` members) — with the evidence
    landing in `ba7edff` and `2d75065`. Not retro-fixable. The 2026-09-02 closure-ledger entry in
    `docs/tech-debt-tracker.md` now records this as a RECURRENCE, which is what moves the "promote it
    to a check" argument: one occurrence was not enough evidence, two on different waves is closer.
  - **C16a's ROW AND BULLET NOW SAY WHAT C16b TOOK OUT OF THEM.** Half of capability (iii) landed with
    C16b and neither place recorded it: `src/signal.ts` delivers a signal to the DIRECT child at a
    declared frame-count trigger and grades the "no further yields within N ms" + exit-status +
    request-count verdict shape. What is left is the file's SEAM NOTE, and one item in it is a
    CAPABILITY rather than a refactor and deserved naming in the parent: **the SDK lane cannot name a
    pid.** The primitive can send a signal only because it spawns the engine as a direct child; the
    corpus runner drives through `sdk.mjs`, which owns the spawn and exposes no pid, which is why the
    three signal tags are non-corpus runners in `strangle/runners.ts`.
  - **"`shutdown` IS NOT EXCISABLE" WAS STATED AS AN ABSOLUTE AND IS A PROPERTY OF THE MECHANISM.**
    `Capture.derive` returns an identifier or a member expression, `assertCaptureInventory` reconciles
    the excised body's FREE IDENTIFIERS against the declared captures, and the BUNFS reachability rule
    forbids an owned module from carrying a `/$bunfs/root/` specifier — which together make a literal
    dynamic `import()` unforwardable, not unownable. A **lazy-import capture kind rendered on the
    GRAPH side** (the graph passes a thunk that performs the `import()` itself, leaving the specifier
    where it is already legal) would lift it. Reworded in the reach table and both record sites.
  - **THE ENGINE PIN NOW LIVES WHERE THE AUTO-UPDATER CANNOT REACH IT** (§3.5, extended). C16b's own
    environment note recorded that Claude Code's updater pruned `~/.local/share/claude/versions/2.1.251`
    mid-child and left `build/real-binary` dangling; recording a hazard is not removing it. The bun
    pin already had the right shape — provision into `reforge/toolchain/` from an upstream URL, verify
    a pinned sha256, refuse otherwise — and the oracle now mirrors it: `toolchain/claude-<version>`,
    pinned by `PINNED_ENGINE_SHA256` (`625869b0…`), with `REAL_BINARY` pointing at the toolchain copy
    and `strangle/prepare.ts` hashing before it symlinks. The provisioner prefers a copy out of the
    updater's cache when that still hashes to the pin (so the move costs no download on a machine that
    already has the version) and otherwise downloads from Anthropic's release endpoint, cross-checking
    the published `darwin-arm64` manifest checksum against the constant — a disagreement is a refusal,
    because exactly one of the two is then wrong. The §3.5 phase now asserts the oracle bytes as it
    does bun's, with the wrong-checksum negative control, and `engine-ts/check-reachability.ts` names
    `~/.local/share/claude/versions` as a forbidden root EXPLICITLY rather than as a side effect of
    where the pin happened to live. Nothing under `~/.local/share/claude` is written, and the
    operator's `claude` symlink is not moved.
  - **Verification round (2026-09-03, fresh-context reviewer): CONVERGED.** Every fix reproduced from the
    bundle, the code and tool output: `br` aborts `Rn` @198395 and only `Hn` @198209 aborts `Qe` among the
    signal handlers, `gr` takes a listener cap; no live carrier of the retracted mechanism remains (four
    hits, all retraction contexts); the hang twin re-run over all three plans on engine-strangled reads
    GREEN; `--engineB` absent exits 2; the pin's bytes match the live manifest (197,171,680 B) and both
    negative controls fire; nothing under `~/.local/share/claude` was written; 142 of 142 inside the
    gate block; `attest --check` 478/1038 with 560 exclusions. Two minors: the abort-claim scoping
    ("of the three signal handlers" — corrected in place in `w13/signals.ts` and the manifest), and
    the PRE-EXISTING two-of-three `darkOver` on `twn-claim-shutdown`/`twn-release-shutdown-claim`,
    carried as a rider on the next gate-running wave (C12a) and logged in the tech-debt tracker.
- 2026-09-03 (**C16b / W13b — the process lifecycle, LANDED**): the first of the seven W13 children,
  cut to land before the loop it belongs to because the hook-executor children reciprocally need what
  it owns. Gate **142 of 142 summary phases, zero FAIL**; corpus **83 cassettes / 201 request bodies** (one new recording,
  shared by three scenario tags); manifest **94 -> 99 splices** and **1 -> 2 whole-chunk rows**;
  attestation **478/1038 executed with 560 exclusions**, zero un-adjudicated. Every headline number
  the cut gave this child was answering a question next to the one asked, and the corrections are the
  substance of the wave.
  - **THE POPULATION, AND THE NUMBER THAT WAS TRUE OF A DIFFERENT QUESTION.** The cut says the latch
    has "10 importers". A literal `grep -l` over the graph answers **313**, because 303 chunks carry a
    BARE side-effect import of it for the bundler's evaluation ordering and exactly ten carry a named
    import clause. Both are true; only one is "who reads the latch". `research/fixtures/process-lifecycle-2.1.251.json`
    is the **ninth pin-keyed fixture** and a gate phase, derived entirely by shape: the latch chunk
    (780 B of file, **165 B of code**), its ten named importers with the ROLE each imports and its call
    sites (`isShuttingDown` 62 / `commitShutdown` 3 / `hang` 25 — **90 call sites for 165 bytes**), the
    coordinator's 44 members and the twelve a free-function facade exposes, and **every
    `process.on("SIG...")` in the graph** (25 registrations, 23 readable, **6 touching the lifecycle
    surface**) each carrying its exit status, its guards and its EXCISABILITY as a measurement.
  - **TWO THINGS ARE CALLED "IS SHUTTING DOWN" AND THEY ARE NOT THE SAME THING.** The LATCH
    (`committed`, one-way, **no clearer anywhere in the bundle**, 62 reads) means "this process has
    decided to go down"; the CLAIM (`TWn.shutdownInProgress`, two-way, 37 reads) means "a shutdown is
    currently in flight". They move together on the graceful path and come apart exactly where it
    matters — the interactive relauncher claims without committing, and the headless SIGTERM handler
    reads the CLAIM as its once-guard while committing the LATCH. `LifecyclePort` refuses to merge
    them, and that refusal is why it ships **five** members rather than the cut's four: a port that
    lets a consumer take and release a claim while giving it no way to READ one is write-only, and
    the only way to close that without inventing anything is to expose `TWn.isShuttingDown` under a
    name that is not `isShuttingDown`. **[parent-impact, additive]** against the C16b bullet's
    four-member list — no member lacks an upstream counterpart, which was the binding rule.
  - **L17's HANG IS UNOBSERVABLE BY ANY HEADLESS STIMULUS THIS WAVE COULD APPLY** (corrected
    2026-09-03 by the boundary review — see the separate Revision Note line below; the original
    wording of this bullet asserted a MECHANISM the bundle does not support, and the correction
    replaces it with the measurement). Cell L17 reads "shutdown during a turn (`xo()` true ->
    `await pm()`)". What was measured: **no in-flight continuation resumes inside the shutdown window
    on any of the three paths** — 14-41 ms hookless from signal to exit, and still inert with a
    `SessionEnd` hook sleeping two seconds (window ~1.64 s), with the signal delivered after the
    `tool_use` frame with the tool running, and with both perturbations at once. Both twins were built
    and driven over all three paths on both engines; nothing moved. So `commitShutdown` and `hang` are
    **corpus-DARK with a measured reason and a population the gate re-measures every run**, and the
    wave's headline chunk has one live export of three. **[parent-impact]** against the cut's L17
    wording — restated on the measured basis: the cell is not refuted, it is unreachable.
  - **THE `TWn` SHUTDOWN PAIR CANNOT BE TAKEN WHOLE.** `shutdownSync` (292 B) is spliced and live —
    its no-op twin hangs `plain`, because the process never exits. `shutdown` (1,096 B) is **not
    excisable BY THE CURRENT CAPTURE MECHANISM**: its body performs a dynamic `import()` of a graph
    chunk by literal specifier. `Capture.derive` yields an identifier or a member expression and
    `assertCaptureInventory` reconciles the body's free IDENTIFIERS against it, so a string specifier
    is not a thing the mechanism can forward, and an owned module may not reproduce the literal
    because `engine-ts/check-reachability.ts`'s BUNFS rule forbids any specifier carrying
    `/$bunfs/root/`. A limit of the mechanism, not of the method: a **lazy-import capture kind
    rendered on the GRAPH side** — the graph passes a thunk that performs its own `import()`, leaving
    the specifier where it is already legal — would lift it.
    A second correction in the same place: the cut says `shutdownSync` awaits `executeSessionEndHooks`;
    **`shutdown` does**, and `shutdownSync` reaches it only through `this.shutdown(...)`.
    **[parent-impact]** against "`TWn`'s shutdown pair".
  - **ONE OF THE GRAPH'S SIX LIFECYCLE SIGNAL HANDLERS FITS A TEMPLATE, AND THE REFUSALS ARE
    MECHANICAL.** The fixture records, per handler, the free identifiers its body ASSIGNS to — a
    splice forwards captures BY VALUE, so a body that writes back to one cannot be delegated. SIGINT
    `Hn` (148 B) has none and is **spliced**; SIGTERM `br` (61 B) assigns `Gn`, the once-guard declared
    beside it, and is **OPEN with that mechanical reason**, owned through the chunk instead (the
    `commitShutdown()` it calls is this wave's export); the coordinator's four are inline arguments to
    `process.on` with no declaration to replace. The scout collapsed two handler FAMILIES into one:
    the coordinator's SIGINT/SIGTERM are suppressed in print mode by a marker the dispatcher sets, its
    SIGHUP is not — which is why a headless engine answers SIGTERM from `ky` and SIGHUP from the
    coordinator, with different statuses and different observability for the latch.
  - **A SIGNAL PRIMITIVE WHOSE TRIGGER IS A FRAME COUNT, NEVER A CLOCK** (`src/signal.ts`) — the
    minimal half of C16a's capability (iii). "Send SIGTERM 800 ms in" is not a measurement; a
    wall-clock trigger lands at a different point in the engine's control flow on different runs, and
    a differential harness whose stimulus moves cannot attribute a difference in response to the
    engine. The verdict reuses `hooks-parity`'s `drainBounded`/`nonSettling` shape one level out, and
    **the exit STATUS is the load-bearing half**: a process that ignores a signal also stops, and only
    `code: 143, signal: null` says the engine's own handler ran. `w13/signals.ts` grades three plans
    over ONE cassette (SIGTERM->143, SIGINT->0, SIGHUP->129), each on both engines, each also asserting
    exactly one `/v1/messages` request — which on the SIGINT plan is load-bearing rather than
    corroborating, since an engine that never got the signal also exits 0.
  - **THE RECORDING MUST NOT BE THE EXPERIMENT.** The first driver signalled during the live take and
    produced a cassette with no `/v1/messages` entry: the engine writes its `assistant` frame from the
    last SSE event, a tick before the recording proxy sees its upstream response END, so killing on
    that frame killed the run inside that tick. The replay then had nothing to serve, spent ten
    retries discovering it, and graded a synthetic error turn — a green-looking pipeline measuring
    nothing. Recording clean is also the better experiment: the cassette is a real complete
    conversation and the INTERRUPTION is the variable.
  - **RULE 2b — DECLARED MODULE STATE** (`strangle/chunk.ts`). The audit refuses a whole-file
    replacement over any constructing top-level declarator, which is right, and wrong about the one
    shape where the construction IS the module: a latch object and a promise built never to settle,
    which the replacement RE-DECLARES at module scope with the same one-per-process identity ESM gives
    upstream's. The row now declares them and the build checks the declaration in both directions,
    including that an entry matching nothing fails. **Three of the five existing chunk fixture
    controls had to be generalised first**, and that is a finding: they keyed on `var x="Glob"` and a
    leading `import{`, which are facts about the FIRST owned chunk, so on a chunk with no string
    literal and no imports both mutations were no-ops and both controls would have "passed" by
    rejecting nothing. **A control that cannot fire on a row is not a control for that row.**
  - **LEDGER: `subsystem/query-loop`'s edge array was empty and now is not.** Eight outbound edges
    per the scout section 3.2 table, the inbound edge from `subsystem/hook-dispatch` (the executor
    children consume the owned latch rather than the stub they were going to build), and the
    `sealTranscriptAppendsForShutdown` edge to `subsystem/session-storage` **recorded, not owned** —
    measured as `Ccn`, wired by the headless dispatcher as the session store's
    `onInternalEventLaneClosed` callback. Row stays `spliced`; one latch is not the loop.
  - **ENVIRONMENT, and it will recur.** Mid-child the ORACLE side began failing: Claude Code's own
    auto-updater had pruned `~/.local/share/claude/versions/2.1.251`, leaving `build/real-binary` a
    dangling symlink. Restored from Anthropic's official release endpoint, verified against the
    published `darwin-arm64` manifest checksum, with the operator's own `claude` symlink untouched.
    A project pinned to an old version of a self-updating tool should expect this; the repair is a
    download and a checksum because the release manifest still serves the pin.

- 2026-09-03 (C11a-fix / W8a boundary review — **NOT CONVERGED on the record**, converged on the
  code): the review reproduced every owned byte, every anchor, every liveness row and every
  reviewed exclusion of the wave, and found both of its load-bearing defects in what the wave SAID
  rather than in what it built — in the derivation fixture and in the numbers four documents quoted
  from it. Six findings, all fixed. Gate **133 of 133 summary phases, zero FAIL** (quoted from the gate's own summary block; attestation unchanged at **474/1030 with 556 exclusions**, and its committed report is this run's own output); the fixture's own `--check` and the ledger
  checker gain the comparisons and controls that would have caught them.
  - **QUOTING IS AN ESCAPE LAYER FOR THE SEARCH, NOT ONLY FOR THE ANCHOR — and the search failure
    is worse.** W8a wrote that rule for its anchors. The same tool then looked for 48-character
    windows of the RENDERED description in minified SOURCE in exactly one spelling, so
    ScheduleWakeup's window missed its own builder (that chunk single-quotes, and writes `user\'s`)
    and matched the tool's memoized zod `.describe(…)` copy instead — the fixture recorded the
    SCHEMA GETTER as a producer of the description. An anchor in the wrong style points at the
    wrong file; a SEARCH in the wrong style can name a declaration that does not produce the text
    at all. Windows are now searched for as every quoting style would write them, with hits summed
    across the forms so a sentence occurring once per style stays ambiguous rather than being
    attributed to whichever form was tried first. Locatable windows rose 1,191 → 1,342 of 1,505.
  - **A CARRIER IS A UNIT SOMETHING CAN OWN, WHICH IS NOT THE INNERMOST DECLARATION.** The walk
    resolved a window to the innermost enclosing declaration, so a builder's local `const o = …`
    counted as a carrier of its own — and nothing can splice a local, because excising the
    enclosing function takes it along. That is not a rounding error in a fixture whose subject is
    what the manifest must own: it made CronCreate look composed of three declarations and
    SendMessage of two, and it put SendMessage's PRIMARY carrier on a local while the manifest
    splices the enclosing free function. The walk keeps the outermost declaration now, with the one
    exception the campaign's own splice shapes require (an object-literal method is independently
    excisable — TaskOutput's description is owned that way). **Carriers 29 → 25, and the descriptions
    genuinely composed of more than one declaration are THREE — EnterPlanMode, ScheduleWakeup,
    Workflow — not five.** Generalising: when a derivation resolves "which X produces this" through
    an AST, the node kind it stops at has to be the kind the CONSUMER can act on.
  - **EVERY NUMBER A FIXTURE STATES IS A CLAIM, AND A CHECK THAT COMPARES A SUBSET OF ITS OWN
    FIELDS LETS THE REST GO STALE IN SILENCE.** `--check` compared the per-tool rows and the
    bundle-derived half; `counts`, `catalogs` and `outsideW8` were written and never read. So
    `bodiesWithTools` sat at 423 while the tool printed PASS and printed the stale number in the
    same breath — the staleness was invisible *because* the field it printed was the field it did
    not compare. Every count is compared now: floors where growth is legitimate (cassette files,
    request bodies, catalog shapes), exact everywhere else; a recorded catalog shape may gain
    bodies but may not vanish; the tools outside the wave's scope are checked for presence and byte
    identity. Each new comparison was driven red before it landed.
  - **A MEASUREMENT OVER AN ARTIFACT DIRECTORY INHERITS THAT DIRECTORY'S HYGIENE.** The stale
    denominator was not a re-record's doing, which is what made it worth chasing.
    `startReplayProxy` APPENDS to its observation dump; of its eleven call sites, eight pass a dump
    path and seven of those delete the file first; `m2/cross-resume.ts` did not, and had accumulated 59 runs of its own traffic — 9.5 MB
    per dump, 118 request bodies apiece and **236 of the 431 bodies the corpus side counted**, growing by four every time anyone
    ran the gate. W8a's own correction ("267 cassettes" is a count of FILES, and a file count
    depends on how often the gate ran) was therefore still true one layer down: the pattern-exact
    filter fixed which FILES count and left a file whose BODY count is a function of gate runs.
    Truncation moved into the proxy — a per-run invariant nine call sites have to remember is one
    a call site will not — and the recorded corpus is **82 cassettes carrying 199 request bodies**.
    The first regenerated fixture said 197, because the accumulated dumps were hand-trimmed to
    their last two lines on the assumption that a run writes two, and a `cross-resume` run writes
    four. The gate's own run corrected it, which is the lesson twice over: **a number derived from
    a hand-trimmed artifact is a number derived from an assumption**, and the fix for both was to
    let the machinery produce the artifact and re-derive from that.
  - **§1.2 GAINS THE ONE EXCLUSION KIND THAT EXPIRES, AND THE PIN ENFORCES IT.** `tool/Monitor`
    was filed under §1.2 while §1.2 says feature gates are neither spliced nor excluded — and that
    rule is about gated CODE INSIDE an owned row, not about a row whose ENTIRE surface a gate makes
    unreachable, which has nothing to splice and can never close. The row stays excluded under a
    kind the table now names — **gate-dead with no lever AT THIS PIN, re-entering the canonical
    rows on a bump that flips the default** — and the condition is declared (`ExcludedRow.gateDead`)
    rather than described, so `ledger/check.ts` holds it against `gate-defaults-<pin>.json` on every
    run: a bump that changes the default, drops the gate or gives it an env override reddens the
    ledger and forces the re-adjudication. Three controls, one per way it can go red.
    `tool/WebSearch` stays as filed — server-executed, and no pin changes that.
  - **A BLIND SPOT DESCRIBED AS THE WRONG KIND OF BLIND SPOT.** The wave said the seven `DH(…)`
    gate reads "land in the extractor's 2,549 `unresolved` sites". They do not: the walk enters
    only calls with exactly two arguments, so a three-argument read is never visited and no
    unresolved entry has `DH` as its callee. INVISIBLE, not unresolved — an unresolved site is a
    gap the fixture declares and can be counted; this one it cannot see. The substance holds (five
    of the seven gates absent from the fixture, including the cron kill switch, which itself
    defaults TRUE so no coverage claim moves), and C11b's repair grows: the ARITY FILTER has to be
    widened as well as the alias taught.
  - **A FIX WHOSE ABSENCE IS INVISIBLE IS A FIX THE NEXT REFACTOR REMOVES.** W8a's X6 rider routed
    `engine-ts/skeleton.test.ts` through `engineEnv` and asserted nothing about it — every check in
    the file passed with the `env` option deleted. The wrapper reads exactly one variable, so
    poisoning `BUN` in the parent is a canary the spawn path actually consumes: through the
    allowlisted environment `--version` still reports the pin, and the same spawn inheriting the
    parent dies at 127. Both directions asserted, and verified by deleting the option.
  - Terminology, on the same paragraph in three places: the seventeen files the first `-observed-`
    filter nearly ate are replay-proxy OBSERVATION DUMPS carrying real request bodies (fifteen
    `m3-flip-observed-*`, two `m2-xresume-observed-*`), not record-mode cassettes. They belong in
    the corpus because their bodies are real bodies from a real engine — which is also exactly why
    a dump that accumulates runs corrupts a denominator.
  - **Flagged for the next re-record, not fixed here:** three LOCAL cassettes
    (`m1-background-task`, `m1-hooks-subagent`, `m1-subagent`) carry the operator's identity in a
    recorded request body (`Git user: SSFSKIM`, from the environment block). `cassettes/` is
    gitignored and nothing is committed, so this is a hygiene item rather than a leak — but a
    corpus that ever becomes shareable would carry it, and the scrub belongs with whichever wave
    re-records those three.
  - **Verification round (2026-09-03, fresh-context reviewer): CONVERGED.** All six fixes reproduced from
    the code and the artifact, none from the documents: the three-encoding window search resolves
    ScheduleWakeup's offset-1464 window to its builder `KXn` (the adjacent 1488 window is now AMBIGUOUS
    — builder plus the zod `.describe` copy — and attributed to nobody, which is the honest reading);
    the object-literal-method exception is the S-method excision unit (11 sibling-method rows), not a
    TaskOutput hatch; `--check` re-derived 25 carriers / 3 composed / 199 bodies over 82 cassettes and
    was driven red on six named fields; the 199 no longer depends on how many times the gate ran; the
    `gateDead` controls and the X6 control each fail for their own reason; `attest --check` clean. Two
    MINORS closed here: the caller count above read "eight of nine" (the code has eleven call sites,
    eight passing a dump path, seven deleting first — corrected in place in both documents), and
    commit 9ea1024's message says "118 runs" where the record says 59 runs at 118 bodies apiece
    (commit messages are not the record).
- 2026-09-03 (C11a / W8a — the moat-tool description belt): the cheapest wave in the campaign
  and the reason is now measured rather than argued. The ledger assigns C11 twenty tool rows;
  all twenty put a description and a JSON schema onto the differential surface on every turn,
  and **sixteen do nothing else** — zero `tool_use` blocks for any of them across the whole
  recorded corpus. Sixteen splices, ~30 KB of owned prose, zero new recordings. Gate **133 of
  133 summary phases, zero FAIL**; manifest **78 → 94 splices**; attestation **465/1010 with
  545 exclusions → 474/1030 with 556 and zero un-adjudicated**; a seventh parity oracle
  (`strangle/moat-parity.test.ts`, 114 comparisons / 10 controls); corpus unchanged at **59**
  with one re-record. Seven items change what the rest of C11 inherits.
  - **THE POPULATION IS DERIVED FROM TWO ARTIFACTS, AND IT CORRECTED THE CUT TWICE.**
    `research/fixtures/moat-tools-<pin>.json` is the EIGHTH pin-keyed fixture and the fifth
    population this campaign had been carrying by hand. Its corpus side reads every recorded
    request body's `tools` array; its bundle side finds each description's producing
    DECLARATIONS by searching the graph for the rendered text itself in 48-character windows,
    so a carrier is found rather than looked up by name. Two corrections fell out before a line
    was spliced: **three descriptions have more than one carrier** (Workflow's span two chunks,
    so it is owned as "120 of 128 locatable windows" rather than as "the description"), and
    **four of the formatters the cut assigns to C11a are already owned by C4/W1**. A third,
    smaller correction: the cut says these sixteen "render into every graded request body",
    and thirteen do — the other three (`AskUserQuestion`, `EnterPlanMode`, `ExitPlanMode`) are
    in the plan-mode catalog only, 14 of the 82 recorded cassettes, so their coverage tag is
    `perm-plan-mode` rather than `plain`. The
    anchor rule itself moved to `research/tools/anchor-enum.ts` and both extractors share it —
    "measure a mechanism by its own definition" (W7.6a) only holds if the definition has one
    implementation.
  - **"267 CASSETTES" IS A COUNT OF FILES, NOT OF RECORDINGS.** 186 of them are
    `-observed-A|A2|B` dumps a replay writes beside the cassette it replayed: byte-identical
    traffic on a green run, and a number that depends on how many times someone ran the gate.
    The recorded corpus is **82 cassettes carrying 199 request bodies**, the 22-tool baseline in
    59 of them and the plan-mode catalog in 14. Every owned-code, ledger and manifest claim is
    corrected; the scout keeps its text. **The first version of the filter made the mistake it
    existed to catch** — it dropped every name CONTAINING `-observed-` and silently took
    seventeen OBSERVATION DUMPS carrying real request bodies with it, including the only cassette in which `PowerShell` is
    presented at all. A population defined by a substring is a population whose boundary nobody
    has looked at.
  - **CHECK THE ESCAPE LAYER BEFORE COUNTING AN ANCHOR, AND QUOTING IS AN ESCAPE LAYER.** The W8
    scout wrote that rule for `—`. ScheduleWakeup's obvious anchor sentence is unique
    graph-wide AND POINTS AT THE WRONG FILE: its own chunk single-quotes the string, so the
    source there carries `user\'s` while another chunk carries the same sentence unescaped. The
    second anchor lesson is narrower and new: **an anchor can be ambiguous inside its own
    target** — CronDelete's and CronList's opening clauses occur twice apiece, once per arm of
    their own ternary.
  - **A GATE FIXTURE'S THIRD BLIND SPOT, FOUND BY NEEDING TO CITE IT.** The cron durability
    exclusion is the only one in the wave that cannot cite `gate-defaults-<pin>.json`, because
    `Lz()` is `DH("tengu_kairos_cron_durable", !0, t)` and `DH` is a three-argument WRAPPER
    around the resolver (`function DH(e,t,r){return I(e,t)}`) that the extractor does not
    recognise as an alias. **Five of the seven gates read through it are absent from the
    fixture**, including the cron subsystem's own kill switch. (Corrected on review: the seven
    reads do NOT "land in the 2,549 `unresolved` sites" — the extractor visits only calls with
    exactly two arguments, so a three-argument read is INVISIBLE rather than declared, and no
    unresolved entry has `DH` as its callee. C11b's repair therefore needs the arity filter
    widened as well as the alias taught.) Structurally different from the two already routed to C11b (the coerced `return
    Me(e)`, and an env arm that precedes the gate) and handed to the same child.
  - **THE SCHEMA GETTERS ARE MEASURED AND DEFERRED, and the reason is mechanical.** The same
    sixteen tools put **16,011 bytes** of `input_schema` JSON on the same bodies, recorded per
    tool in the fixture with a sha. A description is a STRING, which is why the
    `variable-declarator` shape can compare its value against upstream's bytes at build time —
    the belt's whole cheapness. A schema is a memoized zod CONSTRUCTION with no equivalent
    check, so it belongs with C11b's catalog work rather than with the prose. The bytes are in
    the fixture so the deferral has a size rather than being a silence.
  - **THE THREE FORMATTERS THE CUT NAMES ARE DEFERRED TO C11b, WITH THE MEASUREMENT.** A result
    formatter runs when its tool is CALLED, and `ReportFindings`/`ScheduleWakeup`/`TaskOutput`
    belong to the sixteen tools with zero execution coverage — so each row would be dark, and
    its honest `darkOver` population is the WHOLE corpus, there being no discriminating property
    to narrow it with the way "hook-registering scenarios" narrowed W7.6a's `ip`. Three dark
    rows × 59 replays is about twelve minutes on every gate run, permanently, for rows that
    prove nothing until C11b records the three cheap scenarios its own budget already contains.
    Generalising: **a dark row's cost is |darkOver| replays per gate run, so an honest population
    is also a price — and when the child that makes it live is the very next one, deferring beats
    paying it.**
  - **A GATE HIDES EXACTLY AS MUCH WHICHEVER WAY IT DEFAULTS.** Eleven reviewed branch
    exclusions, and two of the four gates behind them default TRUE — so for SendMessage's
    cross-session sections and the cron durability branch it is the *disabled* prose that no
    recording can carry. The oracle grades all eleven against upstream's own declaration with
    the gate as a stubbed port. It also adds two rules to the parity family: **a `primitive` is
    resolved from the bundle rather than written down** (CronCreate's retention window is
    `AM.recurringMaxAgeMs / 86400000`, and writing `7` would grade the owned constant against a
    second transcription), and **await before comparing** — TaskOutput's prompt is `async`, two
    promises both stringify to `{}`, and the file's first run passed a case it had not run.
  - **THE RIDERS, ALL EVIDENCE-BACKED.** `engine-ts/skeleton.test.ts` spawned the wrapper with no
    `env` and now goes through `engineEnv` (X6, in the engine the inversion makes primary);
    `tool/PowerShell` is a row at C13; **`Read` does not leave the tool array** — the flipped
    catalog is 23 tools and `PowerShell` is INSERTED at the sorted index 10, so three documents
    had read a positional diff as a substitution (*a diff over an ordered collection should say
    whether the LENGTH changed before anyone reads a per-index difference as a swap*); "Bash has
    no graph-unique literal" is scoped to the FORMATTER; `background_tasks` is FIRED on the arm
    and UNREACHED on the effect, whose condition is one running background task AND a control
    frame while it runs; `tool/WebFetch` moves to C5 and `tool/WebSearch` and `tool/Monitor`
    become the **first two rows to leave through §1.2's exit door**, in opposite directions —
    one has a client-side residue other rows already own and no execution to own, the other has
    no client-side surface at all. Monitor's line is the measured answer to a standing product
    claim. `subsystem/tool-result-validators` moves C4 → C13.
- 2026-09-03 (C10.6-fix verification round — **CONVERGED**, W7.6a's review loop closed): a
  bounded round reproduced every fix-wave claim, including its own full gate run at exactly 115
  summary phases, zero FAIL. The midnight rule now drops the whole wrapped rollover MESSAGE,
  field-scoped to `messages[]`, with the emitted shapes tested and four must-survive neighbours
  (the sentence inside a user prompt still diffs); the helper extractor implements the anchor
  doctrine mechanically (taint, maximal untainted runs ≥ 8, shortest unique window confirmed by
  an exact count over 1,802 text modules) and its corrected table reproduces — 151 declarations,
  126 functions, 40 pure, 125 anchorable, 31 pure anchorable; the three new splices are
  byte-faithful with non-prose 1/1 anchors, `mS` and `_9` demonstrated RED live, and `ip`'s
  darkness is a GUARD artifact (all nineteen call sites sit behind JSON-stdout, async, http, mcp
  or elicitation conditions no corpus hook creates); the `darkOver` teeth run in the gate (24
  tags GREEN as required) with chunk exports on the same path; the ledger basis check refuses a
  materialized-only span by name and is a gate phase; the relay names a deliberately broken
  first-of-59 scenario on both hops. Six minors, closed in the loop's final commit: the dark
  row's population sentence said twelve hook-registering scenarios where the corpus has EIGHTEEN
  (the reviewer replayed the six omitted under the twin — all GREEN — so the verdict held and
  `darkOver` is widened to all eighteen, six more ~3 s replays per gate run), three module-header
  offsets, the C10.7 remainder split (19 anchorable non-class + 2 classes + 8 anchorless), "731
  spans" → 734, the midnight rule's stated cost (the whole message is invisible — wrong turn,
  never, twice, wrong date — and the `date_change` renderer's owner owes a contract test), and a
  misnamed consumer. Doctrine recorded twice over: **a dark row's population is a doctrine
  obligation, not a mechanical one** — `darkOver` can be declared narrow enough to hide
  liveness, and the only mechanical rule is non-emptiness, so the reviewer's enumeration of the
  population is part of every dark verdict's review. **Stop-signal honored**: W7.6a closes at one
  review + one fix + one converged verification, three of whose five load-bearing findings were
  harness mechanisms (the scrub shape, the relay, the dark-row teeth) rather than owned bytes.
- 2026-09-03 (C10.6 / W7.6a — the BOUNDARY ROUND: **NOT CONVERGED → fixed**). The review reproduced
  every code claim — `Fq` byte-faithful, the hook oracle at 1,499 comparisons / 195 controls /
  1,005 property statements, every twin red, the gate at 110 of 110 — and found two harness
  mechanisms and several recorded numbers wrong. Five load-bearing findings; four of them are
  general lessons rather than local repairs.
  - **A FIX VALIDATED ONLY BY RUNS THAT COULD NOT SEE THE DEFECT IS NOT A FIX.** The midnight
    rollover removal deleted the bare SENTENCE. The engine never emits it that way: both producers
    hand the notice to `hs()`, which wraps string content in `hl()` —
    `<system-reminder>\n…\n</system-reminder>` — so it arrives as its OWN `messages[]` element.
    Erasing the sentence left an empty message behind that one side still carried, and the two
    bodies still canonicalized differently. **The defect survived its own fix, and the two gate runs
    that followed were both wholly on one side of midnight**, so neither could have seen it. The
    canonical form now drops the whole rollover MESSAGE — content string, lone text block, or one
    block among others — field-scoped to `messages[]` and anchored on the exact wrapped envelope,
    with the tests rewritten as message-count comparisons plus four must-survive neighbours.
    Generalising: when a fix is verified by a run that does not create the failing condition, the
    verification is that the run passed, not that the defect is gone.
  - **THE ANCHORABILITY VERDICT WAS A WRONG MEASUREMENT, AND THE DOCTRINE IT CARRIED SURVIVES IT.**
    W7.6a's headline Stage-1 finding — "84 of 151 carry no string literal, only 4 of the 43 pure ones
    are uniquely anchorable, the belt is not takeable by anchor" — came from a scan for string
    literals of twelve characters or more. **That is not what an anchor is.** `strangle/anchor.ts`
    asks for a true-substring-unique span carrying no minified identifier and says nothing about
    prose; much of the manifest is anchored on structural fragments. Re-derived by the doctrine's own
    rule — every maximal untainted run of a declaration, counted across the graph's 1,802 text
    modules — **125 of the 151 are anchorable and 31 of the 40 pure ones are**. Two further errors
    fell out of the same re-derivation: the 151 are **declarations**, not functions (126 functions,
    12 constants, 4 Sets, 4 classes, 3 module-level instances, 2 regexes), and the pure set is **40
    (5,453 B), not 43 (5,961 B)** — one member's body is a dynamic `import()` plus a SandboxManager
    call, which has no free NAMES and arbitrary effects, and another is a module-level `new`
    instance, which is state rather than a value. **The doctrine stands and is now stated with its
    own enforcement: purity decides worth, anchorability decides takeability, they are independent —
    and anchorability must be MEASURED BY THE ANCHOR RULE, which the extractor now does
    mechanically.** The generalisation for every later S-module: a claim about a mechanism has to be
    measured by that mechanism's own definition, not by a proxy that is easier to compute.
  - **AND IT WAS PROVED BY TAKING, NOT BY ARGUING.** Three more splices, all pure with zero captures
    and none anchored on prose: `mS` → `hook-output-async` (47 B, four consumers; LIVE on
    `hooks-prompt-submit` and `perm-hook-deny`), `_9` → `hook-invocation-text` (291 B, six consumers;
    LIVE on `hooks-precompact`), and `ip` → `hook-output-sync` (52 B, four consumers), which was
    spliced EXPECTING liveness and measured DARK over twelve scenarios. The pair is the round's
    sharpest result: two complementary predicates, one live and one dark on the same scenarios,
    because the corpus acts on "is this an acknowledgement?" and never on "is this a result?". It
    also shows **dark is not unreached** — the branch attestation records the dark predicate running.
  - **DARKNESS IS NOW RE-MEASURED EVERY RUN.** `darkReason` had no runtime teeth: `manifestViolations`
    enforced only structural exclusivity, and the gate pushed a pass and `continue`d before any
    build, so an adjudication written once in prose was never checked again — the day a scenario
    created the firing condition, the row would keep reporting "dark, adjudicated" while running live
    and ungraded. A dark row now declares **`darkOver`**, the scenario tags its darkness was measured
    over; the liveness loop builds its sabotage like any other row and requires every one GREEN, and
    a RED fails the gate as **NO LONGER DARK**. The gate flattens splices and chunk exports into one
    loop, so §2.2's chunk-export darkness inherits the same teeth. Driven on synthetic runner output,
    including the RED-on-a-dark-row outcome the old skip made unreachable.
  - **A CHECK NOTHING RUNS IS A CHECK NOTHING ENFORCES, one artifact over from where C6 found it.**
    W7.6a's new ledger captures were copied raw out of `build/footprints.json`, whose spans are
    measured against the MATERIALIZED graph, while the ledger's declared basis is upstream:
    `bge`'s recorded `[691175, 691297)` is `}}async function VE(` upstream. `ledger/check.ts` passed
    because rule 3 accepted either basis, and `backfill-captures.ts --check` — the tool that exists
    for exactly this — was not a gate phase. All three are fixed: the row is rebased (the correction
    was larger than the two captures), rule 3 accepts ONE basis and names a materialized-only match
    with the conversion in the message, and the backfill check is a gate phase in the auxiliary block
    where a faithful emission exists.
  - **"A PHASE THAT CAN FAIL HAS TO SAY WHAT FAILED" WAS DEFEATED BY THE LAYER BELOW IT.** The
    aggregate relayed the last six matching lines per suite — the tail of a 59-scenario verdict block
    — so a corpus failure outside the last five never reached the gate at all; and the replay proxy's
    positional-serve line, the commonest cause of a red equivalence phase, was neither a verdict nor
    matched by the gate's reason filter. Both now live in one module shared by the two layers that
    relay, with the marker imported from the module that writes it. Driven live on a deliberately
    broken first-of-59 scenario. The general form: a guarantee that spans two layers has to be
    enforced where they meet, not asserted at the top.
  - **THE ROUND'S COUNTS.** Gate **115 of 115 summary phases, zero FAIL**, quoted from the gate's own
    summary block — the wave's 110 plus five: the relay control, the ledger-capture check, and three
    liveness rows. Hook oracle **1,549 comparisons / 210 controls** (from 1,499 / 195); attestation
    **465/1010 executed with 545 exclusions and zero un-adjudicated** (from 460/996 with 536);
    manifest **78 splices** (from 75); mechanism **133 checks** (from 122); corpus unchanged at 59.
    The round's first gate run failed exactly one phase — contract X7's registration check, on the
    three new modules — which is the phase W3 added after C5x's went unregistered through a green
    gate, working as intended.
  - **NUMBERS THAT NOBODY RECOMPUTES.** Five recorded figures were wrong and each is now derived
    rather than written down where that was possible: the ordered-log comparison count is **225**
    (the oracle prints it, with the "204 reddened by a one-pair swap" as a running tally and a floor);
    the pairing property has **five** controls, not six; the corpus has **eleven** command hooks
    (seven silent on stdout, two echoing, two writing files), not ten; **twenty** dispatcher splices
    forward an executor — 14 `executeHooks` + 6 `executeHooksAwait` — where the record said
    twenty-one, and upstream's registry counts (18 and 12) are a different measurement from the
    manifest's; and the graph is **1,802** text modules (`cli` plus every `.js`, recursively), which
    the extractor had been under-counting as 1,800. `bge`'s `effectful-port` label is KEPT and its
    description corrected to "unowned pure chain, forwarded" — it is a pure parser chain, and
    re-cutting it as `pure-helper` would claim an owned copy this module does not have.

- 2026-09-02 (C10.6 / W7.6a — Stages 0–1, the executor's oracle built before the executor): the
  first executor child. Its charter was to spend most of a wave on instruments for modules that do
  not exist yet, and the reason that was the right cut is now measured rather than argued. Gate
  **110 of 110 summary phases, zero FAIL**; hook oracle **721 → 1,499 comparisons and 121 → 195 controls**, plus a third
  counted class (**1,005 property statements over 11 paired cases**); corpus unchanged at **59**;
  manifest **74 → 75 splices**. Nine items change what the rest of the family inherits.
  - **THE INTERLEAVED EVENT LOG LANDED, AND ITS RED DIRECTION IS MEASURED.** `Trace` is gone;
    `EventLog` records one ordered stream and the comparison is that stream. Swapping ONE adjacent
    pair of differently-ported events in each owned log reddens **204 of the 225** log comparisons
    and moves the retired per-port projection in **zero** of them — the projection is kept on the
    class so the control can assert the old shape's blindness rather than claim it. The debt entry's
    two smaller edges close with it (a present-but-`undefined` field no longer compares equal to an
    absent one; a port called with `undefined` is now a position rather than an array length), and
    **neither moved a single existing comparison**, which is the honest reading that both
    blindnesses were latent rather than load-bearing. **The half the entry could not have known is
    cleanup pairing**, and it is why this had to precede the module rather than accompany it: two
    sides that both leak a derived signal COMPARE EQUAL, so no comparison however ordered can state
    "cleaned exactly once". It is a PROPERTY, counted separately, with six controls including the
    executor's own shape — five hooks released and a sixth leaked.
  - **STDOUT WRITE BOUNDARIES ARE REPRODUCIBLE, AND THE DESIGN'S CORRECTED EXAMPLE IS NOW A TEST.**
    The same bytes, `{"a":{"b":1},"async":true}`, adopt the async hook in one write and never adopt
    it when split after the NESTED brace — the one-shot latch is spent on a truncated document and
    the completing write is never examined. Splitting mid-KEY is indistinguishable from one write,
    which is the mechanism the design pass first got wrong and now cannot silently un-learn.
  - **A PATH THAT NEVER SETTLES IS A GRADED OUTCOME, AND THE ARM THAT HANGS IS NOT IN THE EXECUTOR.**
    `Qxt` and `AE` never consult the shutdown flag on the streaming path; the 261-byte wrapper the
    twenty-one dispatcher splices have captured as `executeHooks` since W5 does. Under shutdown an
    allowlisted event hangs with zero yields and a non-allowlisted one RETURNS SILENTLY with zero
    yields — **indistinguishable by what they yield**, which is the argument for the mode in one
    line. **And the wrapper drops the executor's completion value on BOTH arms**: `yield* Xxt(e);
    return`, where the bare return discards the delegated value. C8 found that exact shape as a
    defect in a shipped module; here it is upstream's own, and an owned copy that "fixed" it would
    diverge.
  - **THE MODULE-STATE LEAK IS ONE CELL, NOT A FAMILY.** Design §7 item 7 lists a failure-notice
    singleton, a shutdown flag, six host-scoped lazy singletons and a plugin-usage map, "none of it
    per-session". Derived: six cells the belt reaches, of which exactly ONE is genuinely
    process-global — the shutdown module's `committed` flag, a class with one boolean, a setter, a
    reader and a promise constructed to never resolve, with no clearer anywhere in the bundle. The
    rest are keyed-lazy, and the spawn-failure set the design calls process-global is reached through
    `sessionScratch` and is SESSION-scoped. **That correction is the one a harness acts on**: a
    keyed cell is reset by using a fresh key, and only the flag needs an explicit reset. Proven by
    the once-per-process arm giving the same verdict on a second run after a reset, with a control
    showing the reset is not a no-op.
  - **THE PURE BELT IS NOT TAKEABLE, AND THE CONSTRAINT IS ANCHORABILITY RATHER THAN PURITY.**
    **[SUPERSEDED 2026-09-03 — see the boundary Revision Note above. The generalisation at the end of
    this bullet stands; every number in it was measured by a string-literal scan rather than by the
    anchor rule, and 125 of the 151 declarations are in fact anchorable.]** This
    is the wave's largest correction to the design pass and it is a correction to the STAGING, not
    just to a number. `research/tools/extract-hook-helpers.ts` (the SEVENTH pin-keyed fixture, and
    the fourth population this campaign carried as a hand-written number) measures 151 in-chunk
    functions reached from the dispatchers' four shared entry points, of which **43 are pure
    (5,961 B)** — against the design's "~13.9 KB across ~34". But **84 of the 151 carry no string
    literal at all**, and only **4 of the 43 pure ones** carry a literal occurring in exactly one
    bundle file; three of those four have a single caller and fold into that caller's future module.
    So Stage 1 could not be "the pure belt". **Generalising, and it belongs on every later S-module:
    purity decides whether a function is worth owning, and ANCHORABILITY decides whether this
    campaign's mechanism can take it — they are independent, and a design pass that measures only
    the first will over-scope every stage it plans.**
  - **THREE DERIVATIONS THAT CORRECTED SOMETHING, AND ONE BOUNDARY THAT WAS REJECTED.** The
    executors are found rather than named, which surfaced that the streaming dispatchers do not call
    the streaming executor at all. Design §2's "two consumers, never one core" is ASSERTED by the
    tool — it throws unless one executor is a generator, the other awaited, and their callee sets
    overlap by under half (measured 32 of 80 / 40 against the design's 30 of 87 / 38) — so a pin
    that unified them fails the gate. And a spatial boundary for the layer (the run of declarations
    a bundler emits contiguously) was tried and REJECTED: its edge lands on whichever declaration
    nothing inside happens to reference, and widening the tolerance to cross that doubled the
    answer. **A boundary that moves by a factor of two under a parameter nobody can justify is not a
    measurement**, so the boundary is hops from the entry points, on the campaign's own doctrine that
    a helper reachable only THROUGH a function nobody owns is that function's business.
  - **THE MANIFEST GAINED A VOCABULARY IT DID NOT HAVE, and it is the smaller half of the same
    finding.** `Xpt` — the belt's one pure, multi-caller, anchorable member — is spliced and MEASURED
    DARK: both call sites are guarded on a hook-output validation error that none of the corpus's
    eleven command hooks produces, and the INVERTED twin was built and replayed before the verdict was
    written (it appends unconditionally, so it moves every call rather than the rare one; both
    candidate scenarios stayed GREEN). `darkReason` had existed for chunk EXPORTS since W2 but not
    for splices, so the only available answer for a function measured dark was to UN-SPLICE it, which
    C9 did three times. **That is right for a function with no observable effect and wrong for one
    with a real effect the corpus never CREATES**, because un-splicing then trades owned bytes for
    nothing. A splice row may now carry the same adjudication on the same terms — population,
    inverted twin, and the surface that grades it instead — enforced in both directions and driven on
    synthetic rows in `strangle/mechanism.test.ts`, because a guard only ever fed valid input proves
    nothing about what it excludes.
  - **AND THE GATE FOUND A HARNESS DEFECT NOBODY HAD SEEN, because the run straddled midnight.**
    The first full gate came back FAIL on exactly ONE row of 110 — the corpus, inside equivalence —
    and named no scenario; the same phase on the same faithful build was green twice afterwards,
    both times wholly on one side of midnight. Upstream builds a rollover notice ("The date has
    changed. Today's date is now `${d}`. …") on two surfaces, one of them a conversation MESSAGE, and
    the harness's date scrub does not match it because `now` intervenes. **A substitution would not
    have fixed it either**: the corpus spawns its two engines SEQUENTIALLY, so a run starting at
    23:59 has one cross midnight mid-session and emit the notice while the other, started after the
    rollover, emits nothing — present in one body, absent from the other. The notice is now removed
    outright, with the cost written down, and four regression tests hold the rule's both halves.
    **The second fix is the one that generalises:** the equivalence phase filtered its output to the
    last five verdict lines, so a red corpus was undiagnosable from the gate log — the same defect
    class C9 fixed one block up, where any non-zero exit was read as RED without the runner's own
    verdict. **A phase that can fail has to say what failed, or its failure is a rumour.**
  - **`Fq` IS NOT PURE, AND ITS THROWS ARE THREE.** The cut scoped it as "pure given an injected
    clock", which is wrong in both halves: its five free variables are a terminal-sequence sanitiser,
    a debug logger, a traced `JSON.stringify`, a telemetry probe and a message minter — all ordinary
    `effectful-port` captures, none a clock or a uuid. It throws on an unknown legacy `decision`, on
    an unknown PreToolUse `permissionDecision` in the standalone pre-pass, and on an event-name
    mismatch — and the second carries an asymmetry nothing had written down: the SAME switch inside
    the event arm has no default clause, so one bad value throws by one route and is silently ignored
    by the other. All reproduced. Its attestation is the widest corpus/domain gap the campaign has
    recorded — the corpus reaches TWO of eighteen event arms, because reaching an arm needs a hook
    that ANSWERS with a `hookSpecificOutput` and a callback returning `{continue:true}` reaches none
    of them — and it is adjudicated in six families rather than one.

- 2026-09-02 (W12 scout — subagent dispatch and the sandbox re-measured, and the C15 cut; the
  tenth and last scout): **the spec's single `ToolRuntimePort` was naming three disjoint
  boundaries.** Subagent dispatch and the sandbox share no state, no effectful call and no caller,
  so C15 becomes two waves, sandbox FIRST — it is one typed `Options.settings.sandbox` key away
  from retiring fourteen attestation exclusions (whose reasons argued unreachability from the
  environment while the options were the reachable path all along) and from unblocking the stub
  C13d waits on. Sixteen corrections; the ones that change the plan: the chunk the census carried
  on the subagent row is the plugin-hooks runtime the ledger already lists under C8 (112 KB leave;
  two documents disagreed about one chunk and nobody had run the `grep -c` that settles it); the
  child query loop IS the parent's (`Bb` delegates to `Kx`), which fixes the W12/W13 boundary as
  a clean split and retires "nested loop reentry"; the fork subagent is MODE-DEAD — a fifth class
  beside gate-, env-, entrypoint- and settings-dead, invisible to the gate fixture by construction,
  and the one env flip that opens it also removes `run_in_background` from the tool's schema; the
  sandbox chunk is 83.5 % vendored with a single clean split and its profile builder is a PURE
  function, so the primary oracle is a golden file, not a host; on macOS the dependency check never
  probes `sandbox-exec`. Neither half inherits W10's blocker (three counter classes totalling
  1,681 B on the subagent side; none on the sandbox path). A subagent's output file lands outside
  both the sandbox and the config dir and is reset by nothing — the W9 leak class one directory
  out. `kUn`, which both this scout and W13's routed away from themselves by port name, is routed
  by a caller measurement at C16d's cut. Four self-naming barrels exist for this wave and none is
  in the symbol map (the harvest rider on C11b grows). **Lesson: when a feature looks gated, check
  whether the guard is the launch mode** — and ask whether the OS-coupled thing is actually the
  coupled part. **Roadmap state: every wave scouted; 37 cut children from C10.6 through C16g.**
- 2026-09-02 (W13 scout — the query loop re-measured, and the C16 cut): **the
  inversion seam already exists upstream as a named parameter.** All three surfaces that run a
  turn pass the loop in — `zve({run: Kx, …})` in the REPL builder, the interactive controller and
  the headless `bu` — and the loop's default deps factory `aAt()` is 94 bytes naming
  `callModel`/`autocompact`/`uuid`/`now`: three of the wave's ports declared as property names.
  The campaign spent three review rounds designing `ModelTransportPort`; upstream ships its shape.
  The row is ~549 KB across three chunks (1.55× W10's), a four-symbol module boundary, ZERO private
  fields in any class; the cross-turn state is 105 accessors in a 94 KB chunk with 895 importers
  (ports only, never the chunk). The headless turn entry is a gate fork whose live side is the
  legacy `ask()` path — the engine logs which in words. Nine deferrals measured and placed; the
  model-switch pair is re-placed to C10.7 because "stateful" was a reason to find the holder
  (three public fields, two `Ln` stores away, the arm already recorded via `set_model`), not to
  defer. The `stream:false` retry has two arms and the corpus records the accidental one. Cut:
  seven children, three things — the loop (ownable when five oracle capabilities exist: per-event
  stream control, the synthetic response corpus, signal delivery, raw-wire multi-turn,
  cache-breakpoint comparison), the inversion (a decision — out-of-process delegate — plus a
  route), the substrate (shares nothing; gates nothing until an engine-ts-primary artifact
  exists). Two scout claims NOT adopted: its correction #5 says the gate-defaults fixture cannot
  see `CLAUDE_CODE_PRINT_ENGINE_LOOP` — it can and does (one of the 13 committed overrides, the
  same shape the extractor accepts; it is the env ALLOWLIST that excludes it), so the extractor
  blind spot remains the two shapes W8/W11 measured, not three; and `coverage.md`'s ~88 % for
  turn execution describes what the SDK exposes, not what reforge grades (five named sub-features
  have zero corpus coverage) — recorded for C16's landing note rather than edited now. Also
  found: `engine-ts/skeleton.test.ts` inherits the operator's environment inside a gate phase (an
  X6 violation; rider on C11a). **Lesson, from the scout's own method notes: read the deps object
  before designing the port** — grep the target for a literal whose values are its own effects.
  **Every wave is now scouted.** Ten scouts, ten census corrections; the roadmap has 30 cut
  children from C10.6 through C16g, with the code lane serialized on one shared surface.
- 2026-09-02 (W10 scout — the Bash executor re-measured, and the C13 cut): **the campaign's
  oldest open blocker is answered by measurement, and it guards a third of what it was thought
  to guard.** The Bash tool is an object literal (26 members, zero private fields); the private
  fields live in four small classes totalling 11.2 KB inside a ~354 KB row (not ~550 KB — the
  census's only named satellite, `w7bq1qyb`, is the `claude plugin eval` harness and leaves; two
  chunks nobody had named join: `fgwne0fb`, a 62,907 B hand-written bash parser with zero I/O —
  the cleanest S-chunk candidate found anywhere — and a 53 KB classifier region inside `9e2ns8ty`).
  A whole-class accessor adapter would need ~83 accessors of which 31 field identities are
  positional-only, so its derivation cannot be machine-checked: **S-module, no adapter**, and the
  class-method shape §2.1 budgeted for W10 is not needed at all. Three further corrections: the
  named moat behaviour "bash with background notification" has NO scenario (zero of the corpus's
  Bash calls set `run_in_background`; `background-task` drives the Agent tool) — one of its four
  arms is dead headlessly with the producer named, and the cheapest live route is a control
  subtype W7 already fired against an empty registry; the sandbox is behind `settings.sandbox
  .enabled`, a settings key with no gate and no env var, so seven attestation exclusion reasons
  are wrong in premise (right in conclusion); `detectBlockedSleepPattern` is gate-dead behind the
  Monitor gate. The hook runner `Nq` never touches the Bash spawn layer, so C10.8's `ProcessPort`
  is re-specified as the two ports W10 shares (recorded as a parent-impact on the executor cut),
  and `DiskTaskOutput` moves from C11c's port to W10's (one constructor site bundle-wide). Cut:
  six children — parser and safety chain (179 KB, unblocked, no port, no machinery) in parallel
  with the oracle machinery (scripted child, injectable deadlines, child-process supervision),
  then the S-module, then the moat, then PowerShell + validators. **Lesson: a blocker measured is
  a blocker bounded** — "private fields" had been carried as the row's seam quality since the
  census; measured, it is 25 KB behind a handle-shaped port.
- 2026-09-02 (W11 scout — MCP, slash commands and skills re-measured, and the C14 cut): **the MCP
  adapter is a runtime GENERATION FORK, not one module.** The two chunks the census and §1.1
  called "transports" and "call+validate" are v1 (live, 187,877 B) and v2 (dead, 193,087 B) of
  the same module, selected at `import.meta.require` time by `bT()` reading `MCP_SDK_GENERATION`
  BEFORE the gate — an env arm that bypasses the gate, and the second structurally-different shape
  the gate-fixture extractor cannot see (after W8's coerced-return miss). Eight module pairs fork
  this way, so every prose anchor in the MCP surface ties exactly 2× bundle-wide; the manifest's
  per-chunk anchor resolution scopes it and the liveness rule refuses a dead-generation splice,
  and C14c owes the control. The slash surface was mis-located (the "@10–12.5k" locator pointed at
  prompt-expansion code; the real belts are at 3,310–3,495 KB and 2,019–2,058 KB, plus a 36 KB
  expansion chunk never named), and W7.5's headless filter was quoted from one half of a two-clause
  rule: the missing `prompt` clause admits by default, twenty commands ship a purpose-built
  headless implementation, 28 of 104 entries pass, the corpus reaches two. `skillUsage` in
  `.claude.json` is the shared counter for prompt-type slash commands and the `Skill` tool, never
  reset — a live hazard for C12a's byte-stable config snapshot, recorded there as a cross-child
  contract. C10 routed `mcp_message`'s 58 bytes here; the MCP control surface is ten subtypes and
  13 KB. Cut: one family, three children by mechanism — the filter belt with the eighth fixture
  (a filter over a complete enumeration is the cheapest non-vacuity instrument), the transport
  probe with its SDK-negative phase written in (elicitation is live for stdio servers and skipped
  for in-process ones — the obvious cheap probe would have produced a clean false negative), the
  live generation behind `McpClientPort`. **Lesson: when two large chunks look like two halves,
  check whether they are two VERSIONS** — a subset relation between export lists (112 of 112 ⊂ 121)
  is the tell, and it turns a size question into a targeting one.
- 2026-09-02 (W9 scout — session storage re-measured, and the C12 cut): the first scout to
  EXONERATE a census locator (`fy12d89p @4–10k` is right — chunk-relative pretty lines, and it
  should not be "corrected") while removing both of the row's satellites: `trstwd25` (177,692 B)
  is the remote-container dir-sync git worker with zero transcript vocabulary, and `d78hxkfm`
  (233,050 B) is the generic storage-v5 backend behind `tengu_hover_rest`, compiled-in default
  false and absent from the 13 per-gate env overrides — 411 KB leave the row, whose denominator
  is ~175 KB. Measured shape: 172,430 B across 477 declarations in ONE contiguous span, a 31 KB
  writer class with 136 PUBLIC members (no private fields anywhere in the layer — W10's blocker
  does not recur), upstream's own semantic barrel (`chunk-e6cn1914.js`, 235 readable names incl.
  a dozen `*ForTesting` exports) which proved the region's boundaries. Three findings change the
  plan: the state-surface diff sees NOTHING under the config dir today (§3.2's promise is C12a's
  content, not delivered); the corpus writes 8 of 37 record types and one reader arm
  (`clearedToEmpty`) has zero coverage; `summary` records have zero writers bundle-wide — a
  read-only legacy format. Three oracle capabilities do not exist (flush-schedule control,
  dirty-precondition seeding, fs fault injection). Cut: four children, machinery first, reader
  before writer because the reader is gradeable from constructed files with no engine run.
  Also recorded: the harness's config dir has accumulated 412 session files, 1,087 task dirs and
  3,939 empty session-env dirs since the first recording — `resetSandbox()` wipes only the
  sandbox and `plans/`; C12a decides the policy. **Lesson: for a storage core, most unreached
  behaviour is cheaper to reach by constructing a file than by running a session** — the
  synthetic corpus §3.2 names is two corpora, and the transcript one is the cheap one.
- 2026-09-02 (W8 scout — the moat surface re-measured, and the C11 cut): the campaign's
  first scout to find a subsystem the census had NO row for. Enumerating the catalog two
  ways that share no machinery (the builder `Y0()`'s 67 elements; 267 recorded request
  bodies read as an artifact), the headless catalog is **22 tools by default, 32 in
  union, 28 at most in one session** — the "31 native tools" this document quoted was a
  union mistaken for a catalog, and four of them (the Task family) were present only
  because two cassettes' model ids fail a version regex. Three corrections change the
  roadmap: **cross-session messaging is LIVE headlessly** (kill switch `tengu_harbor_kite`
  defaults true, so the disabled-defaults policy leaves it on; a Unix socket opens at
  headless startup; ~100 KB across eight chunks, never counted); **`Monitor` is gate-dead
  at this pin** (`tengu_amber_sentinel` false, no env override) — which also settles the
  interrupt helpers as an exclusion with named guards rather than W8's debt; and **the
  PowerShell flip ADDS a tool, it does not swap `Read` out** (positional diff misread as
  substitution in C3's note). Also measured: §3.3's gate count is 505 sites / 439 gates
  (not 431/379); the override inventory misses `CLAUDE_CODE_HARBOR_KITE` because the
  extractor only accepts a bare identifier return; `TodoWrite` is disabled by default at
  this pin and the census's "already spliced" formatter belongs to `TaskCreate`; the
  private-field blocker recurs once (`DiskTaskOutput`, 1.8 KB) while a closure factory
  (`ssn`, 10.9 KB) under the notification surface is strictly harder. Inline corrections
  landed at §1.3 (twice), §3.3, the C3 note and the C10 flow-back; the cut is in the
  Deferred section with C11a/C11b cut now and C11c/C11d advisory behind their triggers.
  **Lesson: a census row that says "various" is a row nobody measured** — the moat's
  shared cores were 170 KB of "various".
- 2026-09-02 (C10.5 boundary review — **NOT CONVERGED on the record side**, converged on the code):
  the review reproduced the wave's code claims and rejected several of its written ones. **The code
  side is fully reproduced**: gate 107 of 107 summary phases with zero FAIL, prompt oracle 59 of 59,
  attestation 436/871 with 435 exclusions and zero unadjudicated, both oracles green, three live
  sabotages RED as claimed. Everything that failed was a document, and the round was doc-only — no
  code, no re-recording, no re-gating.
  - **THE `/rewind` HOLE.** Four artifacts — the reachability note, the README's W7.5 record, the
    C10.5 Revision Note below, and an attestation exclusion reason — said "there is no `rewind` or
    `summarize` command at all; 'rewind' is a dialog label". There **is** a `/rewind` command,
    registered with aliases `checkpoint` and `undo`, whose whole body asks the host to open the
    message selector. The OPEN verdict was right for reasons nobody had written down: the headless
    command filter admits only `type === "local" && supportsNonInteractive` and `/rewind` declares
    the latter false, and the headless query-event sink drops `open_message_selector` outright.
    **Generalising, and this is the lesson of the round: an enumeration that rules something out
    must cite the GUARDS that rule it out, not the absence of the thing.** A negative claim is not
    falsified by the healthy case — a command that exists and is refused — so it survives review by
    being unfalsifiable rather than by being true. The same sweep corrected "all nineteen `Query`
    methods" to the 27 the installed SDK declares.
  - **THE DESIGN DOC'S KNOWN-WRONG SENTENCES, corrected in place rather than annotated**, because it
    is the brief for three waves that had not been dispatched: `Fq`'s call-site count (five, the fifth
    a spread inside `d6n`, whose own single caller keeps "only through `Qxt`" true transitively);
    `Wie`'s count (four, one of them a NON-executor host fingerprint, `DUt`, which gives
    `HookSourcePort` a consumer outside the executors); the dedupe key `AM`, which is not pure and
    needs one `EnvironmentPort.defaultShell()` read; the async-detection example, which was wrong
    about the mechanism while right about the capability; a strawman in one of the three name
    corrections; and the classifier cap, which was named without a citation and is now located.
  - **AN ARTIFACT MAY NOT CLAIM COVERAGE THAT LIVES SOMEWHERE ELSE.** The wave said "the fixture
    says why each of the 27 dynamic records is or is not takeable". The fixture carries SHAPE; the
    reasons were one class-level sentence, and that sentence was wrong for the records the corpus
    renders. Measured: nine of the 27 render, and **three are takeable today** — `session_guidance`,
    `context_management` and the `env_info` family — each already covered by an existing scenario.
    The per-record table now lives in the README rather than in the fixture, because takeability is
    a two-input judgment (shape from the pin, rendering from the cassette) and the fixture is
    pin-keyed with a gate phase that fails on any diff. Logged in the same round: the `M8t` and
    `C8t` oracle preludes bind upstream bodies to OWNED constants rather than upstream bytes, which
    is C7's one tolerated exception — every identifier involved is a `primitive` capture, and the
    adapter's per-delegation `assertGraphValue` compares it against the graph on every request, so
    the coverage exists one layer down. A taxonomy choice, not a false green, and now written down
    as one.
  - **THE EXECUTOR CUT IS MADE** (Deferred section, "The executor cut"): three children — C10.6,
    C10.7, C10.8 — rather than a fold into W8, on the ground that Stage 0 is oracle machinery only
    this subsystem needs.

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
    store's `materializeSessionFile` (public receiver, covered by `resume` — one scenario, one solo
    sabotage, and NOT in the attestation's ATTESTED set; the W9 scout's qualification, 2026-09-02).
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
    `CLAUDE_CODE_USE_POWERSHELL_TOOL` (gate `tengu_cobalt_ridge`), which ADDS
    `PowerShell` to the headless tool catalog as a 23rd tool at sorted index 10 (`Read` shifts one
    place and stays; the original note read that positional diff as a substitution — corrected by
    the W8 scout 2026-09-02) — i.e. a per-gate
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
