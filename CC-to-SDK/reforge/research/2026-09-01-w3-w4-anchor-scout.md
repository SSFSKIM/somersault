# W3+W4 (C6/C7) anchor scout — system-prompt assembly · compaction

> **Supersession banner (2026-09-02, W7.5/C10.5).** Two rows below have been re-measured. (1) Row
> **a3 `hRt`** is described here, correctly, as a ~520-byte *prompt* wrapper for the segment path —
> but the campaign's later flow-back notes read it as "the from/up_to variant that passes five
> arguments to the `compact_boundary` constructor", which is a different function: `E4n`, 4,710
> bytes, the only five-argument caller of `H1`. Nothing headless reaches `E4n`; see
> `2026-09-02-w75-segment-compaction-reachability.md`. (2) §0's `OS` inventory is now extracted from
> the pin as a fixture rather than described — see `research/fixtures/prompt-sections-<pin>.json`
> and the W7.5 wave record.

**Scope:** campaign spec `docs/superpowers/specs/2026-08-31-reforge-full-campaign-design.md`, children
**C6 / W3** (system-prompt assembly — the env block itself already shipped as W0a's `env-block` spike) and
**C7 / W4** (compaction). Read-only against `~/claude-code-bundle/2.1.251/`; no build, gate or recording was
run. Counts are real substring counts (`str.count`) over `modules/*.js` + `modules/cli` — the file set
`strangle/prepare.ts:textModules()` uses — never `grep -c`. Anchors were re-counted across
2.1.234 / 236 / 241 / 251; **2.1.220 is excluded from the survival column** — that extraction ships only a
beautified `cli.pretty.js`, so minified-form anchors cannot be counted there. Pretty lines are
`cli.pretty.js`; `fy@N` = line minus 411,873 (`chunk-fy12d89p.js`'s section start).

---

## 0. The two findings that set the scope

**F1 — the corpus never renders the main Claude Code system prompt.** `src/harness.ts:baseOptions()` sets
`settingSources: []` and passes no `systemPrompt`, so every recorded request's `system` array is exactly two
blocks: the billing header, and `"You are a Claude agent, built on Anthropic's Claude Agent SDK."` The big
section list (`OS`, 430592) is only reached when the caller asks for the preset; `K_n` (451916) makes a
caller-supplied `systemPrompt` **fully replace** it. Measured in every cassette. So W3's headline target is
*dark today* and the wave's first deliverable is a scenario, not a splice (§4.1).

**F2 — microcompaction is unreachable on the headless seam at this pin.** `createContextHintController`
(`chunk-hqtc7kgv.js`, pretty 564550) returns `null` unless `querySource.startsWith("repl_main_thread")`; the
headless driver `chunk-dvbbv89q.js` uses `querySource:"sdk"` (4 sites). With the controller null,
`nr?.onRequestError` (498948) short-circuits and `v4n` (`tengu_time_based_microcompact`) can never run. This
sharpens the lectures report (`04-context-lifecycle-cost.md`: microcompaction is server-negotiated over
422/424 + the `context-hint` beta) — the report says the *trigger* moved server-side; the gate above says the
whole controller is REPL-only. **Recommendation: reviewed exclusion candidate with a ledger row and this
evidence, not a scenario debt.**

---

## 1. W3 targets — system-prompt assembly

| # | Target | Anchor (proposed) | 234/236/241/251 | Pretty (fy@) | Shape | Params / chars | Captures | Covering scenario |
|---|---|---|---|---|---|---|---|---|
| a1 | **`tOe`** — prompt-block partition + cache scoping (produces every request's `system` array) | `tengu_sysprompt_boundary_found` | 1/1/1/1 | 497173 (fy@85.3k) | free-function | 2 / 1,533 | 6 | **all 24** (exists) |
| a2 | `xMt` — sysprompt sha256 telemetry | `tengu_sysprompt_block` | 1/1/1/1 | 497169 | free-function | 1 / 137 | 2 | **none — dead splice, do not take** |
| a3 | `U8n` — blocks → API `text` blocks + `cache_control` | *(no literal)* | — | 499576 | free-function | 3 / ~230 | 2 | all 24 (unanchorable) |
| a4 | `OS` — the main section list | *(no node-unique literal)* | — | 430592 (fy@18.7k) | free-function | 4 / ~6.5k | ~45 | **none — see F1** |
| a5 | `r6` — identity-line selector (`Efe`/`Wze`/`Qze`) | *(no literal)* | — | 429243 | free-function | 1 / ~110 | 4 | all 24 (unanchorable) |
| b1 | **`zH`** — subagent prompt assembly | `Messages from the agent that launched you` | 1/1/1/1 | 430672 (fy@18.8k) | free-function | 3 / 1,372 | 3 | `subagent` (exists) |
| b2 | `A_n` — general-purpose agent prompt text | `Performing multi-step research tasks` | 1/1/1/1 | 451357 (fy@39.5k) | free-function | 0 / ~1.9k | 0 | `subagent` (exists) |
| c1 | **`HAt`** — context → `<system-reminder>` user message (**this is CLAUDE.md injection**) | `<system-reminder>\nAs you answer the user's questions` | 1/1/1/1 | 497275 | free-function | 2 / 421 | 1 | **all 24** (exists, one-key input) |
| c2 | `NAt` — context → appended system-prompt lines (`gitStatus: …`) | *(no literal)* | — | 497271 | free-function | 2 / 102 | 0 | `subagent` (unanchorable) |
| d | `Eie` — per-tool serialization into the `tools` array | `has strict: true but its schema is not strict-compatible` | 1/1/1/1 | 497132 | free-function | 2 / 2,268 | ~20 | all 24 — **but not a clean seam** |

Every viable row is a top-level `FunctionDeclaration` → **shape `free-function`, signature
`{ params: N, ancestry: ["SourceFile"] }`** — the shape W0a already spiked with `env-block`. **No new shape
is needed for any W3 row that is takeable.**

### 1.1 `tOe` captures (§2.4 classes)

| as | graph id | class | evidence | derive off (non-identifier text) |
|---|---|---|---|---|
| `staticPromptEnabled` | `Kde` | effectful-port | gate `uw()` + provider (`firstParty`/`anthropicAws`), 306508 | `let ${ID}=(${ID})\(\),${ID}=e\.findIndex` |
| `boundaryMarker` | `wO` | primitive | `"__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__"`, `chunk-7g4v1yq9.js` 183061 | `=>${ID}===(${ID})\)` |
| `billingHeaderPrefix` | `tL` | primitive | `var tL="x-anthropic-billing-header:"` 438072 | `\.startsWith\((${ID})\)` |
| `identityPrompts` | `n6` | primitive (frozen Set of 3) | 429240 — the three `You are …` strings | `else if\((${ID})\.has\(` |
| `reportingOutcomes` | `aE` | primitive | the `# Reporting outcomes` prompt section, 429240 | positional, off `\.has\(${ID}\)\)…else if\(${ID}===(${ID})\)` |
| `telemetry` | `s` | effectful-port | `s("tengu_sysprompt_*")` | `(${ID})\("tengu_sysprompt_using_tool_based_cache"` |

Four primitives means four free micro-differential assertions per delegation — unusually high-yield for
drift detection, since a prompt constant whose value changes but whose name does not moves no anchor and no
target hash. `HAt`'s single capture is `xe` (the message constructor stamping uuid/timestamp/isMeta →
effectful-port, derive `return\[(${ID})\(\{content:`). `zH`'s three: `ar` (tool-name string, primitive),
`W8t` (async env-info section — calls the already-spliced `env-block`, so a **ledger edge to
`subsystem/env-block`**), `kKe` (the `<total_tokens>` attachment); both ports.

### 1.2 Judgments

- **a1 `tOe` is the wave's anchor target** — where the big sections are actually concatenated: partition into
  billing / identity / reporting-outcomes / static / dynamic, `\n\n` join, cache-scope assignment
  (`null` / `"org"` / `"global"`). The census's "@85.3k assembly+hash" resolves to this pair. The lectures
  report `03-context-assembly-prompts.md` §1.11 describes it correctly, with one imprecision: it gives the
  identity block a single cache scope, but the scope differs by branch — `null` in the boundary branch,
  `"org"` in the other two (verified against the code and the recorded `ttl:"1h"` block).
- **a2 `xMt` must not be spliced** — telemetry only; nothing it produces reaches a graded surface, so its
  sabotage stays GREEN. Same dead-splice shape as W0a's dropped `interrupt` case.
- **a3/a5/c2 are anchorless.** `U8n`, `r6` and `NAt` carry no literal unique to their node (`r6`'s only
  literal is `"vertex"`; `NAt`'s is `": "`). Real behavior — `r6` picks which identity string every request
  carries — but out of the mechanism's reach. See §5.
- **a4 `OS` is not splice-sized and not covered:** ~6.5k chars, ~45 free variables, mostly gate reads and
  section builders. Its *sections* are individually anchorable prose constants, which is the natural
  decomposition, but all dark until F1's scenario lands. **Recommend W3 lands a1/b1/c1 and defers the section
  inventory to a follow-on cut.**
- **d `Eie` is a seam but not a clean one:** 2,268 chars around a module-level memoizing registry (`a4t`),
  four gate reads, provider detection, two schema transforms, with the pure projection embedded mid-function.
  **Recommend: not W3** — it belongs with `ToolRuntimePort` (W12) or its own cut. The tool catalog's
  *contents* are graded on every request body regardless of who owns the serializer.

---

## 2. W4 targets — compaction

| # | Target | Anchor (proposed) | 234/236/241/251 | Pretty (fy@) | Shape | Params / chars | Captures | Covering scenario |
|---|---|---|---|---|---|---|---|---|
| a1 | `l1n` — the summarization prompt text | `Your task is to create a detailed summary of the conversation` | 1/1/1/1 | 488140 (fy@76.3k) | **`VariableDeclaration` — NOT a supported shape** | — / ~7.6k | — | `slash-compact` (exists) |
| a2 | `nie` — wraps `l1n` in the no-tools preamble + custom instructions | *(preamble literal shared with `hRt`, 2 nodes, same chunk)* | 2/2/2/2 | 488401 | free-function | 1 / 486 | 2 | `slash-compact` (unanchorable) |
| a3 | `hRt` — the segment (`from`/`up_to`) variant | `?u1n:c1n` (identifier-tainted) | 1/1/1/1 | 488385 | free-function | 2 / ~520 | 4 | none |
| a4 | **`d1n`** — strips `<analysis>`, rewrites `<summary>` → `Summary:` | `<summary>([\s\S]*?)<\/summary>` | 1/1/1/1 | 488417 | free-function | 1 / 252 | **0** | **none — needs `compact-continue`** |
| a5 | **`Cq`** — the post-compaction continuation user message | `This session is being continued from a previous conversation that ran out of context.` | 1/1/1/1 | 488430 | free-function | 2 / 1,009 | 1 (`d1n`, pure-helper) | **none — needs `compact-continue`** |
| b1 | **`H1`** — constructs the internal `compact_boundary` | `content:"Conversation compacted",isMeta` | 1/1/1/1 | 519243 (fy@107.4k) | free-function | 5 / 276 | 1 (`bg`, uuid → port) | `slash-compact` (exists) |
| b2 | **`rSe`** — boundary metadata → wire (`preTokens`→`pre_tokens`) | `pre_tokens:e.preTokens` | 1/1/1/1 | 459992 (fy@48.1k) | free-function | 1 / 808 | **0** | `slash-compact` (exists) |
| c1 | **`nKn`** — the auto-compact trigger predicate | `autocompact: tokens=` | 1/1/1/1 | 489603 (fy@77.7k) | free-function | 6 / 270 | 10 | **none — see §3** |
| c2 | `zRe` — the auto-compact driver/generator | `autocompact: routing through reactive` | 1/1/1/1 | 489615 | free-function (async generator) | 7 / large | many | none |
| c3 | `Tte` — the reactive-compact driver | `tengu_reactive_compact_triggered` | 1/1/1/1 | 461003 (fy@49.1k) | free-function | 1 / 3,224 | ~25 (hooks, compact events, telemetry) | none |
| c4 | `Sve` — the reactive gate predicate | *(no literal)* | — | 461000 | free-function | 1 / 131 | 6 | none (unanchorable) |
| c5 | `v4n` — microcompact (keep-recent tool-result clearing) | `[KEEP-RECENT MC] context_hint trigger, cleared ` | 1/1/1/1 | 483610 (fy@71.7k) | free-function | 3 / 710 | ~12 | **unreachable headlessly — F2** |

All viable rows are again top-level `FunctionDeclaration`s → `free-function`,
`{ params: N, ancestry: ["SourceFile"] }`. `b2 rSe` and `a4 d1n` are `captures: []` (verified zero free
variables) — the cheapest owned units in either wave.

### 2.1 Judgments

- **b1 + b2 are the wave's safe core.** `slash-compact` renders both: its substance check asserts
  `compact_metadata.pre_tokens`, which only `rSe` produces (one definition, one call site graph-wide), and
  the boundary object only `H1` produces (three call sites; `/compact` reaches `H1("manual", …)` at 489285).
  Sabotaging either reddens `slash-compact`'s transcript diff immediately.
- **a1 is the wave's highest-value target and the mechanism cannot take it.** The summarization prompt is a
  top-level `var` string; its only wrapper `nie` shares a byte-identical 5-line preamble with its sibling
  `hRt` — two nodes, same chunk, so `coLiteral` cannot disambiguate. See §5 item 1.
- **a4 + a5 are takeable but dark.** `Cq`'s output carries the summary into the *next* request; the corpus
  ends at the boundary. One extra exchange fixes it (§4.2).
- **c1 `nKn` is splice-sized and clean** (270 chars, a predicate) — unlike `zRe`/`Tte`, which are query-loop
  shaped. **Recommend W4 takes `nKn` (the policy) and defers `zRe`/`Tte` (the driver) to W13**, which already
  owns the compaction driver per §6. `c4 Sve` is the matching reactive predicate but is anchorless.
- **c5 is an exclusion, not a debt** (F2).

---

## 3. Compaction depth — what §3.2 owes, and what it should not buy

**Measured thresholds** (`W3` 435624, `Zge` 435633, `eF` 435751, `wYe=13000`, `PYe=20000`, `j3=0.2`):

```
effectiveWindow = contextWindow − min(maxOutputTokens, 20000)
compact  when  promptTokens ≥ effectiveWindow − 13,000
blocked  when  promptTokens ≥ effectiveWindow − 3,000
```

For a 200k-window model that is **≈167,000 prompt tokens**. The corpus's heaviest scenario runs seven
exchanges of a few thousand tokens each; reaching the natural trigger would take on the order of **80–150
exchanges with deliberately large tool outputs**, a multi-megabyte cassette, and live spend far out of
proportion to one splice. **Recommendation: do not record a natural reactive-trigger scenario.**

The code ships the cheap path itself (435786): `W3` reads `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`
(`testPctOverride`, a percentage of the effective window) and `Zge` reads
`CLAUDE_CODE_BLOCKING_LIMIT_OVERRIDE` — both test-only knobs. At `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=1` the
threshold drops to ≈1% of the effective window (~1.8k tokens), so **two or three exchanges trip
`nKn` → `zRe` → the full compaction path**. `CLAUDE_CODE_AUTO_COMPACT_WINDOW` (clamped) is a coarser second
lever. This is a scenario-declared knob set identically for both engines, not operator inheritance — but it
is still an X6 schema addition and therefore a **parent-impact item for C3** (§5 item 3).

Microcompaction: no scenario at any price (F2). Grading it would need the synthetic-response corpus (a
422/424 with `context_hint` edits) *plus* a patched `querySource` — engine-behavior change, not fault
injection. Recommend the exclusion.

---

## 4. Missing-coverage scenario specs

### 4.1 W3

1. **`sysprompt-preset`** *(the unlock; do this first)* — `drive(<one closed-ended prompt>, {…baseOptions,
   systemPrompt: { type: "preset", preset: "claude_code" }, allowedTools: [], maxTurns: 1})`. Renders `OS()`'s
   full section list through `K_n` → `tOe`, turning a1's multi-section join, the `wO` boundary branch and the
   `"global"` cache scope from dark to graded. Check: ≥3 system blocks carrying the tone/style and env
   sections. **Without it, W3 owns `tOe` while the corpus exercises one of its three branches** — the exact
   W1 lesson about a green gate saying less than it looks like.
2. **`sysprompt-append`** — same plus `append: "REFORGE_APPEND_MARKER"`; flips `r6` to the
   `hasAppendSystemPrompt` identity string (`Wze`), a one-line system-array diff no other scenario produces.
3. **`claude-md-memory`** — seed `<sandbox>/CLAUDE.md` from the scenario body (fs write before `drive`, since
   `resetSandbox()` wipes the tree), then `settingSources: ["project"]`. Renders the `# claudeMd` key through
   `HAt` and the memory section through `OS`. Check: the first user message's `<system-reminder>` carries
   `# claudeMd` and the seeded marker. X6 interaction: `settingSources` also admits `settings.json`, so the
   sandbox must not carry one.
4. *(optional)* **`subagent-custom-agent`** — a `.claude/agents/*.md` definition, exercising `zH` with an
   agent-supplied prompt rather than the built-in `A_n`.

### 4.2 W4

1. **`compact-continue`** — the existing `slash-compact` flow plus one more user message after the boundary
   result. Makes `Cq` + `d1n` observable in the following request body. Cost: one extra exchange on an
   existing recording. Check: the post-boundary request's first user block starts with `This session is being
   continued…` and contains `Summary:`.
2. **`compact-instructions`** — `/compact keep the codeword REFORGE_COMPACT_CHARLIE verbatim`. Exercises
   `nie`'s `Additional Instructions:` branch (dark today) and gives the summarization-prompt row a second
   input partition.
3. **`auto-compact-threshold`** — `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=1` plus three filler exchanges; asserts a
   `compact_boundary` with `trigger:"auto"` (vs `"manual"` today) and a `pre_tokens` well under the natural
   threshold. Blocked on the X6 schema extension.
4. **microcompact — no scenario.** Ledger row `unowned → excluded (unreachable)` with F2 as evidence.

---

## 5. Parent-impact items

1. **A fifth target shape is needed to own prompt-text constants.** `l1n` (the summarization prompt), and
   equally `aE`, `tL` and the identity trio, are top-level `var` initializers. A
   `variable-declarator` shape — excise the initializer, delegate to `globalThis.__reforge.<fn>()` evaluated
   at module init — would let W4 own the compaction prompt outright *and* would convert every prompt-text
   constant in the bundle into an equality-asserted primitive. C1 owns X3; this is a mechanism spike, not a
   W4 deliverable.
2. **Anchor-mechanism gap: sibling nodes with byte-identical literals in the same chunk.** `nie`/`hRt` share
   a 5-line preamble; `coLiteral` scopes to a *chunk*, so it cannot separate them. Same class blocks `U8n`,
   `r6`, `NAt` and `Sve` (no literal at all). If W3/W4 are to own the identity-line selector and the
   compaction prompt wrapper, C1 needs either an in-node literal *pair* predicate or a declared ordinal —
   both are new bets on the anchor doctrine and deserve C1's judgment, not a wave's.
3. **X6 schema extension for `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`** (C3). Without it, compaction depth beyond
   `/compact` is not recordable at sane cost (§3).
4. **One serialized recording batch (X5).** Scenarios 4.1.1–4.1.3 alter `systemPrompt` / `settingSources`,
   which per C3's retrospective ("budget re-records against env/prompt changes") means new cassettes. They
   are additive, so nothing existing is invalidated; the five-to-six new recordings go through the
   orchestrator in one batch.
5. **`tOe`'s covering set is the entire corpus** — its solo sabotage turns all 24 scenarios RED, which is
   loud but undiscriminating. The row must list them all (the `bash-tool` precedent), and §2.4's contract
   test over partitioned inputs (three branches × the billing/identity/reporting/static/dynamic partition) is
   load-bearing here, not optional.
6. **Two dead splices identified in advance:** `xMt` (sysprompt hash, telemetry-only) and `v4n`
   (microcompact, unreachable headlessly). Following the W0a `interrupt` precedent, neither should be taken;
   `v4n` gets an evidence-backed exclusion row.
7. **W3's headline surface is a scenario problem before it is a splice problem** (F1). If the parent wants
   the main Claude Code system prompt owned in W3 rather than deferred, scenario 4.1.1 must land and record
   before the section inventory is cut.
