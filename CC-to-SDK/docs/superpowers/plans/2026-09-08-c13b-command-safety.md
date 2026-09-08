# Own the C13b Bash command-safety chain

This execution plan is a living document. `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` stay current while the work proceeds. It follows the repository’s approved reforge-full campaign and the execution-plan discipline in the installed `doperpowers:execplan` skill.

## Purpose / Big Picture

C13b replaces the pinned engine’s Bash command classification and per-subcommand permission logic with reforge-owned JavaScript while leaving the surrounding engine and C13a parser seam unchanged. Afterward, the existing W6 Bash permission matrix and the recorded `bash-compound-safety` scenario must make the same decisions through owned code, and every owned flag/effect table must reject a graph-side value that differs from the pinned table. This is parity work, not a customization; the real binary and extracted bundle remain read-only oracles.

## Progress

- [x] (2026-09-07 22:17Z) Re-read the campaign contracts, W10 scout, C13a corrected seam notes, current manifest, lock protocol, C13c scenario registration, and pinned 2.1.251 bytes.
- [x] (2026-09-07 22:17Z) Verified the dispatch baseline is `8b08d87`, the registered tag is exactly `bash-compound-safety`, its cassette exists, and the old 166/166 log survives although the prepared graph entrypoints do not.
- [x] (2026-09-07 22:42Z) Derived and committed the pin-keyed population fixture for both scout regions: exact AST-snapped spans, every top-level declaration, five anchored runtime roots, five folded admission functions, eleven flag/effect tables, their transitive table dependencies, and ten evidence-backed exclusion groups. Final owned-closure versus exclusion adjudication remains part of the implementation record.
- [x] (2026-09-08 01:00Z) Implemented the classifier half and all eleven asserted table declarators. Pinned-byte oracles pass 6,613 classifier differentials and 1,286 table checks; 46 adapter controls name every perturbed table path and prove semantic twins. The classifier splice is live on `perm-rule-deny`; all table twins are reviewed dark over their declared recorded paths; faithful `bash-tool` and `bash-compound-safety` replay is green; engine-ts registration/reachability is green.
- [ ] Implement the engine-chunk command-safety half, including anchored adapters, owned/folded pure helpers, table equality assertions, and a named compound aggregate contract; keep each TDD cycle recorded in durable logs.
- [ ] Register all owned modules in engine-ts, add manifest/footprint/attestation/gate wiring, update the closure ledger, and regenerate only derived artifacts whose focused checks require it.
- [ ] Run focused mechanism, derivation, contract, permission-matrix Bash cells, `bash-compound-safety` replay, liveness/negative controls, attestation check, reachability, ledger, and TypeScript verification. Do not run the full strangler gate.
- [ ] Update `reforge/README.md` and the campaign spec’s C13b row/living tail with evidence and limits, commit explicit paths in logical units, and push the completed branch.

## Surprises & Discoveries

- Observation: C13c already registered and recorded the required scenario under the exact tag `bash-compound-safety`; no additional live take is authorized or presently needed.
  Evidence: `reforge/w10/scenarios.ts` defines the tag and `reforge/cassettes/m1-bash-compound-safety.jsonl` is present.
- Observation: snapping the scout’s coarse offsets to complete top-level statements yields 254 declared entries over bytes 890302–1015363 in `chunk-fy12d89p.js`, and 105 over bytes 108945–162610 in `chunk-9e2ns8ty.js`. The classifier scout endpoint 162000 is inside a multi-declarator statement, so treating it as an excision boundary would silently split declarations.
  Evidence: `research/tools/extract-bash-safety.ts --check` and `research/fixtures/bash-safety-2.1.251.json`.
- Observation: the baseline log exists at `reforge/build/gate-20260906-1939.log`, but the prepared `build/graph` and `build/strangled` CLI entrypoints are absent. Focused replay work must prepare once under the sandbox lock rather than assuming old artifacts survived.
- Observation: byte-level caller tracing changes the scout’s splice cut. The runtime roots are `KTe`, `_8e`, `$ct`, the separately anchored effectful core `jrn`, and the deliberately admitted clamp-crash fallback `XNt`; `w8e`, `mrn`, `drn`, `hrn`, and the previously omitted `bQn` are collaborators folded beneath `jrn`. The 53,180-byte classifier endpoint lands inside a declaration, and `bQn` at bytes 163205–175587 is a required sole callee of `jrn`.
  Evidence: `research/fixtures/bash-safety-2.1.251.json` records ten rooted/folded functions, the classifier extension, table closure, and exclusions with pinned spans.
- Observation: the existing `bash-compound-safety` recording reaches neither W6 `findSafetyCheckReason` caller it was expected to close. Replacing each exact call site with a unique throwing probe still left the replay green; the subshell in the recorded command is rejected by `mrn` before the `drn` multi-`cd` aggregate, and the command has no duplicate normalized subcommand for `jrn`’s merge tie-break.
  Evidence: `reforge/build/c13b-fy-multicd-reachability.log` and `reforge/build/c13b-fy-tiebreak-reachability.log`, both `EXIT_STATUS=0`; the faithful build was restored afterward.
- Observation: table ownership needs a distinct data splice: the original graph initializer must execute once so its independently constructed value can be structurally asserted before consumers receive the owned replacement. `asserted-variable-declarator` supplies that exact value without treating callable slots as identity-bearing.
  Evidence: `strangle/mechanism.test.ts` passes 135 checks; `strangle/bash-safety-table-adapters.test.ts` passes 44 checks and requires each graph perturbation to name its exact table path.
- Observation: the eleven direct table declarations occupy 22,674 pinned bytes, not the scout’s approximate 17 KB, and reach 27 additional declaration dependencies. The contract evaluates those exact upstream declarations and performs 1,263 pinned-byte callback comparisons over 83 callable slots.
  Evidence: `research/fixtures/bash-safety-2.1.251.json` and `reforge/build/c13b-table-preintegration.log`.
- Observation: sole-caller topology is not enough to fold an effectful helper. `$ct` has 13 direct free variables, while `jrn` directly reaches permission, sandbox, rule-store, filesystem and cwd state. The manifest correctly refuses to forward those transitive ports through `$ct`, because they are not free in its AST node; `jrn` therefore needs its own anchored seam.
  Evidence: independent AST free-variable inventories for `$ct` and `jrn`, plus the graph-adapter dependency map in `strangle/modules/bash-compound-safety/reference.js`; the population fixture now records five splices and five folds.
- Observation: the fd and grep flag tables feed the later command-allowlist initializer. An immediate semantic twin made that later table's healthy structural assertion abort engine startup, which is an inconclusive crash rather than liveness evidence. Their final twins preserve the two fd spreads and three grep references that Bnn asserts, then expose the named changed flag on subsequent reads; dedicated controls prove both startup compatibility and the changed behavior.
  Evidence: `reforge/build/c13b-table-dependent-sabotage-red.log`, `c13b-table-dependent-sabotage-green.log`, and `c13b-table-dependent-liveness-green.log`; the faithful graph was restored and the sandbox lock released.

## Decision Log

- Decision: use the existing shared checkout and current `main` branch rather than an isolated worktree.
  Rationale: the task explicitly requires the current branch and gives shared-checkout staging and lock rules; sandbox/build writers will serialize through `src/lock.ts`.
  Date/Author: 2026-09-07 / C13b implementer.
- Decision: treat C13a’s parser exports and sentinel as the only parser implementation dependency. The owned classifier imports `PARSE_ABORTED` rather than minting a symbol, keeps positional `commandArgv` semantics, and treats only `ERROR`, `test_rhs_missing`, `backtick_escape_unsupported`, and `backtick_body_overrun` as recovery-only.
  Rationale: these are corrected, byte-verified seam contracts and are already graded by parser parity.
  Date/Author: 2026-09-07 / C13b implementer.
- Decision: use five runtime splice roots: `KTe`, `_8e`, `$ct`, `jrn`, and `XNt`. Fold the five lower pure admission functions beneath `jrn`; do not add seams for them.
  Rationale: caller tracing first suggested folding `jrn` beneath its sole admission caller `$ct`, but the adapter mechanism can forward only the root’s exact lexical free variables. `jrn` reads permission, sandbox, rule-store, filesystem and cwd ports that are not free in `$ct`; hiding or reimplementing those stateful ports would violate the ownership boundary. Its graph-unique telemetry anchor makes a separate splice the smallest honest cut. `XNt` remains included because its 294-byte clamp-crash fail-closed decision is command admission and leaving it gains no useful boundary.
  Date/Author: 2026-09-08 / C13b implementer.
- Decision: derive a complete declaration population before finalizing splice granularity. Anchored public roots own their transitive pure closure; declarations outside that closure are either separately rooted or explicitly excluded with caller and byte evidence.
  Rationale: claiming the scout’s byte ranges wholesale without accounting for every declaration would silently narrow ownership; copying unrelated neighboring permission/path code would overclaim it.
  Date/Author: 2026-09-07 / C13b implementer.
- Decision: the pinned-byte oracle binds upstream bodies to upstream helpers and exercises owned adapters, while table controls perturb one named entry at a time.
  Rationale: sharing owned helpers between oracle and implementation can hide the same defect on both sides; a generic “something changed” control does not prove which table assertion is live.
  Date/Author: 2026-09-07 / C13b implementer.

## Outcomes & Retrospective

Work is in progress. The existing compound cassette cannot close the two W6 caller edges; direct contract parity will still land, and the final record will name the minimal additional observation instead of taking it live. Closure is parent-owned: this plan will report focused implementation evidence but will not claim C13b finally closed before independent review and the parent’s full gate.

## Context and Orientation

`reforge/strangle/manifest.ts` declares each splice, its literal anchor, structural target signature, exhaustive captures, and covering scenarios. A splice replaces one pinned function body with a call through `globalThis.__reforge`; its adapter under `reforge/strangle/modules/` installs the owned reference function and rejects stale primitive/table inputs. `reforge/engine-ts/modules/index.ts` imports the same reference implementation, proving dual wiring and static independence from extracted artifacts. `reforge/strangle/attestation.ts` accounts for every branch in owned modules. `reforge/ledger.json` records subsystem ownership and upstream footprint hashes.

C13a already owns `reforge/strangle/modules/shell-parser/reference.js`. Its `PARSE_ABORTED` symbol has identity semantics. C13b consumes its parser, tree nodes, command-node walk, and argv extraction. C13c already supplies the offline recording `reforge/cassettes/m1-bash-compound-safety.jsonl`; this plan reuses it and does not record live by default.

The pinned source of truth is `/Users/new/claude-code-bundle/2.1.251/modules/`. It is read-only. All offsets and expected behavior in new fixtures and tests must be re-derived from those bytes, not copied from the scout.

## Plan of Work

First add a pin-keyed extractor and fixture that locate the two source regions by stable structure or literals, enumerate every top-level declaration and table, compute anchored-root closures, and list exclusions with evidence. The check mode must fail when the fixture differs from the pin.

Next write a focused `strangle/bash-safety-parity.test.ts` before the implementation. It will extract the exact upstream targets using `resolveAnchor`, `selectExcision`, and manifest capture derivations; bind upstream bodies to upstream helpers; drive partitions covering parser rejection, redirection/heredoc extraction, read-only classification, wrapper peeling, effect tables, pipe/subshell behavior, multiple `cd` commands, and duplicate-subcommand tie-breaking; and compare full decision values including `decisionReason.subcommandResults`. Each behavioral partition and each table gets a named mutant that must differ.

Implement one readable shared reference layer for the classifier and one for engine-side safety, with thin per-splice adapters and sabotage twins. Pure helpers that have no stable anchor are folded into these reference layers. State, filesystem, settings, existing permission context, telemetry, and session-dependent policy remain named adapter ports. Structured table assertions compare keys, primitive leaves, ordered set members, and declared callable slots; parity tests grade callable behavior against upstream bytes.

Finally wire the new rows into the manifest, engine-ts registry, attestation inventory, gate contract phase, and ledger. Build and backfill footprints using existing scripts. Focused replays will use the registered C13c cassette and only the W6 Bash-bearing permission cells. Documentation will state exact owned spans and exclusions, focused verdict counts, and parent-owned closure.

## Concrete Steps

All commands run from `/Users/new/Developer/GitHub/somersault/CC-to-SDK/reforge`.

1. Run the population extractor in write mode once, then `npx tsx research/tools/extract-bash-safety.ts --check`.
2. Run `npx tsx strangle/bash-safety-parity.test.ts` before modules exist and archive the expected RED in `build/c13b-red.log`.
3. Implement classifier and safety reference modules/adapters in small GREEN cycles, rerunning the focused oracle after each.
4. Run mechanism and registration checks: `npx tsx strangle/mechanism.test.ts`, `npx tsx strangle/perturb.ts`, `npx tsx engine-ts/check-reachability.ts`, and `npx tsx engine-ts/skeleton.test.ts`.
5. Prepare once if needed using `npx tsx strangle/prepare.ts`, then replay the named W6 Bash cells and `npx tsx m1/run.ts --scenario bash-compound-safety` through the faithful strangled build. Archive complete output under `build/`.
6. Run `npx tsx strangle/attest.ts --check`, `npx tsx ledger/backfill-captures.ts --check`, `npx tsx ledger/check.ts`, focused contract suites, and `npx tsc --noEmit`.

## Validation and Acceptance

Acceptance requires all of the following observable results: the population check reports every planned declaration accounted for with no silent remainder; the parity oracle reports all behavior comparisons and named mutants passing against pinned bytes; every owned table’s perturbation emits that table’s stale-value error; W6’s Bash permission cells remain green through the owned chain; `bash-compound-safety` passes offline and its contract observes a multi-part `subcommandResults` aggregate rather than only successful shell output; each new splice sabotage produces a named divergence or a reviewed dark verdict; reachability and skeleton registration are green; attestation has zero unadjudicated branches; ledger footprints match the pinned bytes; and TypeScript compiles cleanly.

The parent owns independent review and the final full strangler gate. This implementer will not report campaign closure from focused results alone.

## Idempotence and Recovery

Extractors support `--check`, footprint backfill supports `--check`, and focused tests are repeatable offline. All sandbox resets go through the existing lock; a live holder is waited out or reported, never evicted. Prepared build artifacts are disposable and may be rebuilt. No command mutates the pinned bundle, user configuration, credentials, `harness/src/tui`, the untracked sibling `pi/`, or live Claude installation paths.

## Artifacts and Notes

Durable logs live under `reforge/build/` and are gitignored. The final README record cites exact log paths and counts. The source plan, pin-keyed fixture, tests, modules, manifest, attestation metadata, registry, ledger, README, and parent spec are committed; generated engine trees and credentials are not.

## Interfaces and Dependencies

Owned classifier code imports parser behavior only from `strangle/modules/shell-parser/reference.js`, including the one `PARSE_ABORTED` instance. Thin adapters use shared assertion utilities under `strangle/modules/shared/`. The oracle uses the manifest’s real anchor, AST, and capture machinery rather than a parallel extractor. No new runtime package is required.

Revision note (2026-09-07): initial plan written after byte-level inventory and before implementation; it makes declaration accounting a first milestone because the scout’s regions are deliberately coarse.

Revision note (2026-09-07 22:42Z): the population milestone is complete. The fixture records AST-complete spans rather than pretending the scout’s mid-statement endpoint is an ownership boundary.

Revision note (2026-09-07 22:50Z): targeted throwing probes proved the registered compound cassette does not execute either W6 `findSafetyCheckReason` call site. The plan preserves direct parity acceptance and records the missing end-to-end observation separately.

Revision note (2026-09-07 22:54Z): fixed the population locator to treat TypeScript AST spans as half-open. A boundary equal to one statement’s end is the next statement’s start; the previous inclusive test silently attributed the preceding declarations to both regions.

Revision note (2026-09-07 23:19Z): caller tracing initially selected four splices and six folds, the omitted `bQn` extension, eleven tables with their closure, and explicit exclusion groups. The plan now follows actual admission callers rather than the scout’s invalid mid-declaration ranges.

Revision note (2026-09-08 00:00Z): classifier and table cores are GREEN against pinned bytes. The runtime table declarators and remaining engine-side safety roots are in integration; no closure claim is made.

Revision note (2026-09-08 00:12Z): corrected the runtime cut to five splices and five folds. `jrn` is sole-called by `$ct` but is effectful, and the exact-capture mechanism makes its transitive ports impossible to hide behind the caller; its own graph-unique anchor is the honest seam.

Revision note (2026-09-08 01:00Z): all eleven table declarators now evaluate and assert the original graph initializer before selecting owned values. Solo table twins are measured without treating two dependency-induced startup crashes as liveness; the corrected semantic twins remain GREEN over their reviewed-dark paths.
