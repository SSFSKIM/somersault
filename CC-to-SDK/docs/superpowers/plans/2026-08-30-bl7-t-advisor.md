# T-ADVISOR Implementation Plan (bl7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use doperpowers:subagent-driven-execution to implement this
> plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render canon 2.1.251's advisor consult rows — the in-flight `⏺ Advising using {model}` row, the
four result shapes, and click-to-expand on the result body — from the `server_tool_use`(advisor) /
`advisor_tool_result` assistant blocks the SDK delivers when settings carry `advisorModel`.

**Architecture:** Two new arms in `render.ts`'s assistant renderer (the blocks currently die there — no
default arm, total silence); a small resolution-state pass (result resolves its consult by `tool_use_id`);
clickability rides the existing `item:` mechanism with zero mouse-layer edits (ownerKey + `clickable: true`),
with `expandedItems` added to the projection cache's `knobKey` so a click actually repaints (spec D9, the
round's highest-risk item). Config knob `advisorModel`, default off.

**Tech Stack:** TypeScript, Ink, vitest, `@anthropic-ai/sdk` types (promoted to direct dep). Commands from
`CC-to-SDK/harness/`: `npm run typecheck` / `npm run test:unit` / `npm run test:tui` — NEVER bare `npm test`.

**Governing docs:** spec `docs/superpowers/specs/2026-08-30-bl7-hookblock-advisor-design.md` §3 (D6-D11);
research `.doperpowers/sdd/2026-08-30-bl7-round/research-advisor.md` (canon `bm` @176900064 verbatim in §2;
ccx seams §3; P118b: distinct uuids per frame — plain append, no merge rule).

## Global Constraints

- Canon copy exact (research §A2 table): in-flight `⏺ Advising using {model}` — "Advising" BOLD undimmed,
  model clause dim; result collapsed `✔ Advisor has reviewed the conversation and will apply the feedback `
  (trailing space before hint) all dim; declined `Advisor declined to advise on this request` warning color;
  error `Advisor unavailable ({error_code})` error color; redacted = the ✔ sentence, NO trailing space, NO
  hint, never clickable.
- **Expanded body is ONE plain dim Text — NOT markdown, no truncation, no gutter, no indent (D10).**
- Result rows: no marginTop ever (flush under the Advising row); in-flight row honours addMargin only.
- Declined = `content.stop_reason === "refusal"`; the reason IS `content.text` (non-empty string or
  undefined). Clickable iff `content.type === "advisor_result"` AND (`!declined || reason !== undefined`)
  AND not already expanded by verbose/detail projection.
- The `(ctrl+o to expand)` hint is SUPPRESSED where the row is click-expandable (fullscreen); shown in the
  classic renderer.
- `advisorModel` defaults OFF; no client-side model-catalog validation; no client-side cost limiter (D7).
- `entryAtom` breaker classification is ASSERTED, never exempted — canon flushes advisor messages (segmenter
  arm 9); ccx's implicit neutral→breaker flip on first render IS the parity behavior.
- Server-tool names other than `advisor` render nothing (benign divergence, recorded).
- House style: dense hand-style, ESM `.js` specifiers, DI-by-deps, spread-when-present.

---

### Task 1: types + config knob

**Files:**
- Modify: `package.json` (promote `@anthropic-ai/sdk` from transitive to `dependencies`, pin the installed
  `0.104.x`), `src/config/types.ts` (`HarnessConfig.advisorModel?: string` + DEFAULTS untouched — absent),
  `src/config/validate.ts:8` (`advisorModel: z.string().min(1).optional()`), `src/config/settings.ts:12-17`
  (one line in `mergeAutoCompact`: `if (config.advisorModel !== undefined) base.advisorModel = config.advisorModel;`
  — rename the function only if trivial, else add a comment), `src/cli/args.ts` (`case "--advisor-model"` in
  the `parseCcx` switch ~:134-195, the `--model` shape at :152), `src/cli/help.ts` (one line),
  `src/tui/prefs.ts` (`advisorModel?: string` + validation ~:90-120), `src/cli/main.ts:441`
  (`inv.config.advisorModel ?? prefs.advisorModel` merge), `src/tui/settingsRows.ts` (row + id union :15)
- Test: `test/unit/` config surface — extend the files that pin `validate`, `resolveOptions`
  settings-passthrough, CLI args, and `test/unit/cli-surface.test.ts` (help text)

**Interfaces:**
- Produces: `config.advisorModel` → SDK `Settings.advisorModel` via the existing
  `resolveOptions.ts:60` settings passthrough. Types available:
  `import type { BetaAdvisorToolResultBlock, BetaAdvisorResultBlock } from "@anthropic-ai/sdk/resources/beta/messages/messages"`
  (verify the exact subpath against the installed package before writing imports).

- [ ] **Step 1: failing tests** — (a) `resolveOptions({ advisorModel: "claude-opus-4-8" })` yields
  `options.settings.advisorModel === "claude-opus-4-8"`; (b) absent by default; (c) `--advisor-model x`
  parses; (d) help text mentions it (cli-surface pin). Run the touched unit files → FAIL.
- [ ] **Step 2: implement** all files above; `npm ls @anthropic-ai/sdk` to confirm the version, add to
  `dependencies` at the installed version. Run → PASS.
- [ ] **Step 3: gates + commit** — `npm run typecheck && npm run test:unit`;
  `git commit -m "bl7 t-advisor: advisorModel knob (default off) + @anthropic-ai/sdk types"`.

### Task 2: render arms + resolution state

**Files:**
- Modify: `src/tui/render.ts` (assistant arm :206-236 — two new `else if` arms;
  `RenderMessageOptions` :200 gains `advisor?: AdvisorRenderContext`),
  `src/tui/toolRenderer.tsx` (`projectMessageEntry` ~:786-814 — compute the context per block and pass it)
- Create: `src/tui/advisorState.ts` (resolution pass)
- Test: `test/tui/advisor-row.test.tsx` (new)

**Interfaces:**
- Produces: `src/tui/advisorState.ts` —
  `export type AdvisorResolution = { resolved: ReadonlySet<string>; errored: ReadonlySet<string> }` and
  `export function advisorResolution(entries: readonly {message: Record<string,unknown>}[]): AdvisorResolution`
  — walks retained assistant messages: an `advisor_tool_result` adds its `tool_use_id` to `resolved` (and to
  `errored` when content is `advisor_tool_result_error` or declined); any `server_tool_use` in a NON-LATEST
  API message (`message.id` differs from the last assistant's) still unresolved is added to both (canon
  `eGt`/`uur`/`tGt` @163035026-163035350: abandoned consults go red, never spin). Must NOT create ToolEvents.
- Produces: `RenderMessageOptions.advisor?: { resolvedIds: ReadonlySet<string>; erroredIds: ReadonlySet<string>; expanded: boolean; clickHintSuppressed: boolean; model?: string }`.
- Produces (render.ts): the two arms —
  - `b?.type === "server_tool_use"`: if `b.name !== "advisor"` → nothing; else one row: bullet glyph
    (existing platform constant, `⏺`/`●`) in a 2-char gutter — dim when
    `!advisor.resolvedIds.has(b.id)`, error-colored when errored, success-colored when resolved — then bold
    `Advising`, then dim ` using {model display name}` when `advisor.model` present. Static glyph (no blink)
    UNLESS an animation tick already reaches renderMessage (it does not today — do NOT add a ticker; record
    the static-glyph micro-divergence in the task report per spec §3.2).
  - `b?.type === "advisor_tool_result"`: the five shapes per the Global Constraints table; `expanded` comes
    from `advisor.expanded`; hint text reuses the existing expand-hint copy plumbing (`opts.expandHint`
    carries the chord text elsewhere — follow that pattern), omitted when `clickHintSuppressed`.

- [ ] **Step 1: failing tests** — `test/tui/advisor-row.test.tsx` cells: (1) in-flight unresolved: dim glyph
  + bold `Advising` + dim ` using `; (2) resolved: success glyph; errored: error glyph; (3) result collapsed:
  the exact ✔ sentence WITH trailing space + hint when not suppressed; hint absent when
  `clickHintSuppressed`; (4) expanded: body text verbatim, and a markdown-sensitive fixture
  (`**not bold** _not italic_`) appears LITERALLY (pins D10 plain-text); (5) declined with reason: warning
  line collapsed, warning line + dim reason expanded; declined without reason: no hint, expanded identical;
  (6) `advisor_tool_result_error`: `Advisor unavailable (overloaded)` error color, identical expanded; (7)
  redacted: ✔ sentence no trailing space, no hint; (8) `advisorResolution` unit cells incl. the non-latest
  force-error. Run → FAIL.
- [ ] **Step 2: implement** `advisorState.ts`, the two render arms, and the `projectMessageEntry` context
  computation (compute `advisorResolution` once per projection over the anchored entries — NOT per block;
  memoizing inside `buildAnchoredEntries` is fine since resolution depends only on document content, which
  keys the outer cache by `revision`). Run → PASS.
- [ ] **Step 3: gates + commit** — `npm run typecheck && npm run test:tui`;
  `git commit -m "bl7 t-advisor: canon advisor rows (in-flight glyph state + five result shapes)"`.

### Task 3: clickability + the knobKey cache fix (spec D9 — highest-risk)

**Files:**
- Modify: `src/tui/toolRenderer.tsx` (`knobKey` :1281-1282; `projectMessageEntry` — stamp
  `ownerKey`/`clickable` on advisor result items and derive `advisor.expanded` from
  `options.expandedItems`)
- Test: `test/tui/fold-click.test.tsx` (real-SGR advisor cell + cache-regression cell),
  `test/tui/hitmap.test.ts`, `test/tui/hover-owner.test.tsx` (ownerKey discipline — this suite FAILS any
  producer that omits ownerKey; run it)

**Interfaces:**
- Consumes: Task 2's render arms and context.
- Produces: advisor result items carry `ownerKey: sdkOwnerKey(<entry id base>)` (`toolRenderer.tsx:589`
  helper) and `clickable: true` iff `content.type === "advisor_result"` && (`!declined || reason defined`)
  && the projection is not already verbose/detail; `knobKey` gains a deterministic `expandedItems` component:
  `` `|x=${[...(options.expandedItems ?? [])].sort().join(",")}` `` (empty set → `|x=`), with a comment
  citing spec D9 and the LRU note at :1253-1257 (clicks are rare; each change is a legitimate
  re-projection).

- [ ] **Step 1: failing SGR cell** — in `fold-click.test.tsx` (T-CLICKGATE cells at :482+ are the template):
  drive a real `ChatApp` with an advisor result message; send SGR press+release on the result row; assert
  the frame AFTER the click contains the full body text and the frame BEFORE does not; click again →
  collapses. Also: clicking a declined-without-reason row changes nothing; error/redacted rows are not in
  `clickableOwners` (hitmap assertion). Run → FAIL (both because rendering isn't clickable yet AND the cache
  would serve stale — the cell is the D9 guard).
- [ ] **Step 2: implement** — stamp ownerKey/clickable; wire `advisor.expanded =
  options.expandedItems?.has(ownerKey) === true`; `clickHintSuppressed = options.fullscreen === true`;
  extend `knobKey`. Run the cell → PASS.
- [ ] **Step 3: cache-regression mutation cell** — a test that monkeypatches/regresses is brittle; instead
  add a direct unit: two `projectAll` calls differing ONLY in `expandedItems` yield different output for the
  advisor row (this fails if `knobKey` omits the set — the exact D9 failure). Run → PASS; then TEMPORARILY
  revert the knobKey change and verify this cell + the SGR cell go RED (record in report); restore.
- [ ] **Step 4: gates + commit** — `npm run typecheck && npm run test:tui` (hover-owner + hitmap suites
  included); `git commit -m "bl7 t-advisor: click-to-expand via item mechanism + expandedItems in knobKey"`.

### Task 4: fold pin, picker, live cell

**Files:**
- Modify: `src/tui/sessionPickerModel.ts:179/:183` (add `advisor_tool_result` to the `isPreviewMessage`
  allowlist)
- Test: `test/tui/fold-expand.test.tsx` or `toolFold`-adjacent (breaker pin), the picker's existing unit
  file, and Create: `test/live/advisor.e2e.test.ts` (gated)

**Interfaces:**
- Consumes: everything prior.

- [ ] **Step 1: breaker pin** — failing-first test: an assistant entry whose only block is
  `advisor_tool_result` classifies as `breaker` in `entryAtom` (a tool cluster before it CLOSES at the
  advisor row — matches canon's flush, segmenter arm 9). Add a comment at `entryAtom` (:1103-1120): "advisor
  blocks intentionally hit the breaker arm once rendered — canon flushes (bl7 spec §3.5); do not exempt."
  Run → PASS (it should already pass — the test pins, the comment prevents 'fixes').
- [ ] **Step 2: picker allowlist** — failing test: an advisor-only message counts in the picker preview
  footer; one-line fix; PASS.
- [ ] **Step 3: gated live cell (A8)** — `test/live/advisor.e2e.test.ts`, `describe.skipIf` on missing
  `CLAUDE_CODE_OAUTH_TOKEN`/`ANTHROPIC_API_KEY` (house pattern in `test/live/image-submit.e2e.test.ts`):
  one session with `advisorModel: "claude-opus-4-8"`, model sonnet, prompt asking to consult the advisor
  (P118's prompt shape); assert the transcript renders `Advising` and one of the result shapes. Run keyed:
  `set -a; . ../.env; set +a; npx vitest run test/live/advisor.e2e.test.ts`. Note: consult ≈ $0.39 — run
  once, not in loops.
- [ ] **Step 4: full gates + commit** — `npm run typecheck && npm run test:unit && npm run test:tui`;
  `git commit -m "bl7 t-advisor: breaker pin + picker allowlist + gated live cell"`.

### Task 5: verification — spec acceptance A5-A9

- [ ] Walk spec §5 A5-A9 as written, naming the exact test cells/evidence for each; full suite green
  (`npm run typecheck && npm run test:unit && npm run test:tui`); the bl6 pty matrices
  (`bash scripts/cluster-expand-cells.sh`, `bash scripts/linkopen-cells.sh`) still green. Report per-check
  evidence.
