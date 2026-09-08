# Own the C13b Bash command-safety chain

This execution plan is a living document. `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` stay current while the work proceeds. It follows the repository’s approved reforge-full campaign and the execution-plan discipline in the installed `doperpowers:execplan` skill.

## Purpose / Big Picture

C13b replaces the pinned engine’s Bash command classification and per-subcommand permission logic with reforge-owned JavaScript while leaving the surrounding engine and C13a parser seam unchanged. Afterward, the existing W6 Bash permission matrix and the recorded `bash-compound-safety` scenario must make the same decisions through owned code, and every owned flag/effect table must reject a graph-side value that differs from the pinned table. This is parity work, not a customization; the real binary and extracted bundle remain read-only oracles.

## Progress

- [x] (2026-09-07 22:17Z) Re-read the campaign contracts, W10 scout, C13a corrected seam notes, current manifest, lock protocol, C13c scenario registration, and pinned 2.1.251 bytes.
- [x] (2026-09-07 22:17Z) Verified the dispatch baseline is `8b08d87`, the registered tag is exactly `bash-compound-safety`, its cassette exists, and the old 166/166 log survives although the prepared graph entrypoints do not.
- [x] (2026-09-07 22:42Z) Derived and committed the pin-keyed population fixture for both scout regions: exact AST-snapped spans, every top-level declaration, five anchored runtime roots, five folded admission functions, eleven flag/effect tables, their transitive table dependencies, and ten evidence-backed exclusion groups. Final owned-closure versus exclusion adjudication remains part of the implementation record.
- [x] (2026-09-08 01:00Z) Implemented the classifier half and all eleven asserted table declarators. Pinned-byte oracles pass 6,613 classifier differentials and 1,286 table checks; 46 adapter controls name every perturbed table path and prove semantic twins. The classifier splice is live on `perm-rule-deny`; all table twins are reviewed dark over their declared recorded paths; faithful `bash-tool` and `bash-compound-safety` replay is green; engine-ts registration/reachability is green.
- [x] (2026-09-08 01:28Z) Implemented and spliced `_8e` plus its owned `cL` sed predicate and pure closure. The pinned-byte oracle passes 2,522 differentials over 220 focused commands, all 2,191 parser-domain strings, and 90 sed commands. Faithful permission/compound replay is green; the semantic twin is RED on `perm-accept-edits` because it wrongly skips the Bash broker.
- [x] (2026-09-08 04:10Z) Implemented the engine-chunk command-safety half: `$ct`, `jrn`, and `XNt` are anchored beside the existing `KTe` and `_8e` seams; `w8e`, `mrn`, `drn`, `hrn`, and `bQn` are folded; the expanded aggregate pinned-byte contract reports 777 parity checks and 31 controls. The implementation-review correction set is reflected in the shared corpus and direct contracts.
- [x] (2026-09-08 04:10Z) Registered the five runtime splices, eleven asserted table declarators, owned modules, manifest capture derivations, engine-ts entries, focused gate phases, and ledger footprints. Reachability and skeleton checks are green; the three final runtime footprints carry exact 13/53/2 capture inventories.
- [ ] Record the parent-owned final attestation check and generated-report status in this living plan. All other focused final verification evidence—mechanism, derivation, contracts, permission-matrix Bash cells, `bash-compound-safety` replay, liveness controls, reachability, ledger, and TypeScript—is complete. Do not run the full strangler gate.
- [ ] Integrate the parent-owned final attestation counts/status without rewriting the focused evidence; parent independent review and the full gate remain parent-owned.

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
  Evidence: `strangle/mechanism.test.ts` passes 135 checks; `strangle/bash-safety-table-adapters.test.ts` passes 46 checks and requires each graph perturbation to name its exact table path.
- Observation: the eleven direct table declarations occupy 22,674 pinned bytes, not the scout’s approximate 17 KB, and reach 27 additional declaration dependencies. The contract evaluates those exact upstream declarations and performs 1,263 pinned-byte callback comparisons over 83 callable slots.
  Evidence: `research/fixtures/bash-safety-2.1.251.json` and `reforge/build/c13b-table-preintegration.log`.
- Observation: sole-caller topology is not enough to fold an effectful helper. `$ct` has 13 direct free variables, while `jrn` directly reaches permission, sandbox, rule-store, filesystem and cwd state. The manifest correctly refuses to forward those transitive ports through `$ct`, because they are not free in its AST node; `jrn` therefore needs its own anchored seam.
  Evidence: independent AST free-variable inventories for `$ct` and `jrn`, plus the graph-adapter dependency map in `strangle/modules/bash-compound-safety/reference.js`; the population fixture now records five splices and five folds.
- Observation: the fd and grep flag tables feed the later command-allowlist initializer. An immediate semantic twin made that later table's healthy structural assertion abort engine startup, which is an inconclusive crash rather than liveness evidence. Their final twins preserve the two fd spreads and three grep references that Bnn asserts, then expose the named changed flag on subsequent reads; dedicated controls prove both startup compatibility and the changed behavior.
  Evidence: `reforge/build/c13b-table-dependent-sabotage-red.log`, `c13b-table-dependent-sabotage-green.log`, and `c13b-table-dependent-liveness-green.log`; the faithful graph was restored and the sandbox lock released.

- Observation: `perm-rule-deny` executes Bash admission but cannot prove `_8e` live: its matching deny rule decides before the read-only fast path can matter, so the semantic `_8e` twin leaves it GREEN. `perm-accept-edits` is the relevant recorded observation: changing `chmod` from passthrough to read-only allow suppresses the required broker consult and produces the scenario’s named RED failure.
  Evidence: `reforge/build/c13b-read-only-liveness.log` is the negative reachability measurement; `reforge/build/c13b-read-only-accept-edits-liveness.log` is RED with “the Bash was not brokered”; the faithful build is restored in both logs.
- Observation: implementation review closed 26 tracked corrections, with overlaps and extensions grouped by evidence family: sed execute and redirect safety; sandbox deny/ask; remote/command-specific too-complex handling; required effect ports; inherited assignment safety; clamp literal/wildcard/prefix/xargs/Bash(*)/escaped parsing; multi-cd removal and candidate cwd; awaiting async safety; resolved leading-cd path checks; empty suggestion fallback; rule dedup keys; classifier-prefix rules; AbortError; exact env-prefix allowlist; Windows cwd normalization; cwd forwarded to git/cd-git checks; See clamp redirection projection; and the pnn assignment traversal boundary.
  Evidence: `reforge/build/c13b-final-aggregate-parity.log` reports 777 checks and 31 named controls over the corrected shared corpus; `reforge/build/c13b-final-aggregate-coverage.log` reports 1,093/1,771 contract outcomes across 907 generated sites; `reforge/build/c13b-final-permissions.log` reports 2,508 comparisons and 49 controls.
- Observation: the final helper-corpus expansion adds 104 covered outcomes: all 103 reachable helper outcomes and one validator outcome. Its explicit partitions are 71 helper, 15 named semantic, 29 pipe, and two pre-validator aggregate cases. The remaining twelve helper outcomes are pinned-producer verified as four invariant, four impossible, two caller-domain, and two resource-sensitive outcomes rather than silently credited coverage.
  Evidence: `reforge/build/c13b-final-aggregate-coverage.log` reports 1,093/1,771 outcomes over the same 907 generated branch sites and names every residual category.
- Observation: aggregate parity and aggregate contract coverage cannot safely run concurrently. The coverage path regenerates instrumented module state, so the authoritative parity total is the sequential 777 measured before coverage takes that state.
  Evidence: `reforge/build/c13b-final-aggregate-parity.log` and `reforge/build/c13b-final-aggregate-coverage.log` are the sequential durable outputs.
- Observation: the three final runtime adapters have eight graph primitive captures. They now cross only so each adapter can equality-assert the graph value before healthy delegation; `AbortError` is instead implemented as an owned pure helper and compared behaviorally to the pinned declaration.
  Evidence: `reforge/build/c13b-final-aggregate-adapters.log` reports 16 checks across eight primitive perturbations; `reforge/build/c13b-final-aggregate-captures.log` reports exact 13/53/2 inventories and 136 perturbation checks.
- Observation: each contract coverage driver resets coverage while creating its instrumented module. Deferring accumulation until every driver had run discarded all but the final driver; attestation now accumulates each driver's result immediately, before the next reset.
  Evidence: `reforge/build/c13b-final-attestation-unadjudicated.log` preserves the earlier five-driver run that exposed the accumulation defect. It is historical mechanism evidence, not the parent-owned final attestation record.
- Observation: liveness begins only after the engine starts and the scenario reaches the candidate seam. A dependent-table startup crash is inconclusive, while `$ct` and `jrn` each RED on `perm-accept-edits` with “the Bash was not brokered”; `XNt` starts cleanly but remains GREEN/dark on `bash-compound-safety` because the cassette lacks the clamp-plus-crash conjunction.
  Evidence: `reforge/build/c13b-final-entry-liveness.log`, `reforge/build/c13b-final-core-liveness.log`, and `reforge/build/c13b-final-failure-dark.log`; the earlier dependent-table controls are in `reforge/build/c13b-table-dependent-sabotage-red.log`, `c13b-table-dependent-sabotage-green.log`, and `c13b-table-dependent-liveness-green.log`.

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
- Decision: run aggregate parity to completion before aggregate coverage, and treat 777 as the authoritative focused parity count.
  Rationale: coverage regenerates the instrumented module state. Parallel execution makes the result depend on which process last replaced that state rather than on command-safety behavior.
  Date/Author: 2026-09-08 / C13b implementer.
- Decision: accumulate contract coverage immediately after each driver returns.
  Rationale: every driver resets coverage to instrument its own module; end-of-loop accumulation retains only the last driver and silently undercredits the earlier contracts.
  Date/Author: 2026-09-08 / C13b implementer.
- Decision: make all eight primitive captures cross the three final runtime seams as assertions only, and own the pure `AbortError` helper instead of forwarding it as an effect port.
  Rationale: primitive drift must fail before delegation, but a constructor used only to produce the pinned `{name: "AbortError", message: ""}` behavior does not require graph state or identity.
  Date/Author: 2026-09-08 / C13b implementer.
- Decision: count a sabotage as liveness evidence only when the engine starts and the scenario reaches a decision surface that diverges.
  Rationale: a dependent initializer can crash startup before its consumer runs. Such a crash proves incompatibility, not consumer liveness; clean-start GREEN is a reviewed-dark result, not a hidden RED.
  Date/Author: 2026-09-08 / C13b implementer.

## Outcomes & Retrospective

Implementation and focused replay are complete. The existing compound cassette cannot close the two W6 `Fy` caller edges; direct pinned-byte contracts cover multi-`cd`, duplicate tie-breaking, insertion-ordered `Map` behavior, and exact `subcommandResults`, and no live take was made. Parent-owned final attestation evidence still requires documentation integration. The parent also owns independent review and the full strangler gate, so this plan does not claim C13b or campaign closure.

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

Acceptance requires all of the following observable results: the population check reports every planned declaration accounted for with no silent remainder; the parity oracle reports all behavior comparisons and named mutants passing against pinned bytes; every owned table’s perturbation emits that table’s stale-value error; W6’s Bash permission cells remain green through the owned chain; `bash-compound-safety` passes offline, while the direct pinned-byte contract—not that cassette—observes multi-`cd` safety, duplicate tie-breaking, insertion-ordered `Map` behavior, and exact `subcommandResults`; each new splice sabotage produces a named divergence or a reviewed dark verdict; reachability and skeleton registration are green; attestation has zero unadjudicated branches; ledger footprints match the pinned bytes; and TypeScript compiles cleanly.

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

Revision note (2026-09-08 01:28Z): `_8e` is integrated through six direct effectful ports. Its liveness coverage names `perm-accept-edits`, not the earlier `perm-rule-deny` candidate that the rule ladder resolves before read-only classification matters.

Revision note (2026-09-08 04:10Z): the five runtime splices, five folds, eleven asserted tables, engine-ts registration, manifest/gate wiring, and exact ledger footprints are implemented. Focused evidence is complete: aggregate parity is 777/31, root captures are 13/53/2 plus 136 perturbations, graph primitives are 16 checks across eight perturbations, aggregate contract coverage is 1,093/1,771 across 907 sites, and all thirteen W6 Bash cells plus `bash-compound-safety` replay green. Final attestation is not claimed.

Revision note (2026-09-08 04:10Z): incorporated implementation-review closure. The plan now records the 26 tracked correction families, the sequential parity-before-coverage requirement, immediate per-driver coverage accumulation, primitive assertion policy, `AbortError` ownership, and the rule that startup crashes are inconclusive liveness. Documentation remains deliberately pre-attestation; parent independent review and the full gate remain pending.

Revision note (2026-09-08 05:16Z): expanded the helper corpus and superseded the draft's aggregate totals. Focused parity is now 777/31 and contract coverage is 1,093/1,771 across the unchanged 907 sites. The expansion covers all 103 reachable helper outcomes plus one validator; twelve pinned-producer-verified helper outcomes remain categorized as invariant, impossible, caller-domain, or resource-sensitive. Parent-owned final attestation evidence remains deliberately unintegrated in this pre-attestation documentation commit; parent review and the full gate remain pending.
