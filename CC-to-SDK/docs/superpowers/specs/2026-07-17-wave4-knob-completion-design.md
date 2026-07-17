# Wave 4 — knob completion + drift watch — design

Roadmap: `docs/parity/full-potential.md` §3 Wave 4. Evidence: probes 53/53b/54 (2026-07-17) +
prior probes 43/43b (onElicitation), 50 (spawnClaudeCodeProcess), 35 (MCP deferral), 26 (1M).

## Probe verdicts (53/53b/54)

| premise | verdict |
| --- | --- |
| `sessionId` (caller-chosen UUID) | ✅ honored — `init.session_id` === ours |
| `title` (initial session title) | ✅ round-trips — `getSessionInfo().customTitle` |
| `agent` (main-thread agent) | ✅ agent prompt applied to the main conversation |
| `outputFormat` json_schema → `result.structured_output` | ✅ populated, schema-conformant (runStructured GO) |
| `betas: ['context-1m-2025-08-07']` on sonnet-4-6 | ✅ accepted (no error; window engagement not asserted) |
| `includeHookEvents` | 🚫 DEAD headless — no hook frames (haiku+sonnet, plain+matcher'd programmatic hooks) |
| `promptSuggestions` | 🚫 DEAD headless — no `prompt_suggestion` frame (trivial + real task, haiku+sonnet) |
| `agentProgressSummaries` | 🟡 PARTIAL — `task_progress` fires; `summary` never populated (45s subagent) |
| `tool()` extras (annotations/searchHint/alwaysLoad) | ✅ accepted; annotated tool callable; both tools listed in `init.tools` (alwaysLoad's marginal effect unobservable there; model still ToolSearched) |

## W4.1 — the knob sweep

First-class `HarnessConfig` fields, each a one-line `resolveOptions` wire + unit assertion. Grouped:

- **Session identity/plumbing**: `sessionId`, `title`, `continueSession` (→ `continue`),
  `abortController`.
- **Main-thread agent**: `agent` (pairs with existing `agents`).
- **Context/tools**: `additionalDirectories`, `skills` (`string[] | 'all'`), `toolConfig`,
  `strictMcpConfig`, `betas`, `maxThinkingTokens`, `planModeInstructions`,
  `permissionPromptToolName`.
- **Callbacks (probe-grounded)**: `onElicitation` (43b ✅), `onUserDialog` + `supportedDialogKinds`
  (43: wireable, no deterministic headless trigger — jsdoc caveat), `spawnClaudeCodeProcess` (50 ✅).
- **Process plumbing**: `pathToClaudeCodeExecutable`, `executable`, `executableArgs`, `extraArgs`,
  `stderr`, `debug`, `debugFile`.
- **Dead/partial knobs — wired with jsdoc caveats** (passthrough is cheap; the caveat is the value):
  `includeHookEvents` 🚫, `promptSuggestions` 🚫, `agentProgressSummaries` 🟡.

Non-goals: `permissionPromptToolName` semantics probing (declared-only wire); re-modeling
`AgentDefinition` (our `agents` field already passes the SDK type verbatim — newer per-agent fields
flow through; doc note only).

## W4.2 — tool annotations + runStructured

- Annotate the 5 in-process MCP servers' tools via `tool()` extras: `readOnlyHint` where true
  (TaskGet/TaskList/GetContextUsage/CheckMessages), `title` for each, `searchHint` keywords.
  Pure metadata — no behavior change; unit-pins via server instance tool defs.
- `runStructured<T>(schema, prompt, config?)` in `src/structured/`: Zod schema → `z.toJSONSchema`
  (zod 4 native) → `outputFormat: {type:'json_schema', schema}` → one-shot query →
  `result.structured_output` → `schema.parse` → typed T. Errors: non-success result subtype (incl.
  `error_max_structured_output_retries`) → typed `StructuredRunError` with the raw result attached.
  DI QueryFn like `harness.ts`. Live test: tiny schema on sonnet.

## W4.3 — drift ritual

- `scripts/drift-check.mjs` (repo-local, no deps): fetch `npm view` version + tarball, extract
  `sdk.d.ts`, diff *declared surface names* (Options fields, Query methods, SDKMessage type tags,
  exported functions) installed-vs-HEAD; print an actionable report (added/removed names). Exit 0
  with report; `--json` for automation.
- `docs/parity/drift-ritual.md`: the monthly procedure — run the script, sweep the docs list,
  re-run `probes/probes/00` + the affected probe subset, update `coverage.md`/`full-potential.md`
  §§ rows + standing-exclusions floor.
- First run executed as part of this wave; findings recorded in the doc.

## Wave close

coverage.md (domains 2/6/9 + §7 date) + full-potential.md (§1 rows, §2 recount, §3 Wave-4 header) +
memory. Envelope expectation: ~78% → ~82-84% (the long tail was most of the residual).
