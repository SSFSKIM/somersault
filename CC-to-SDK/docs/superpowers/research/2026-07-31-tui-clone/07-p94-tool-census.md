# P94 — Live Tool Census

**Status:** **Complete. F1 vocabulary gate closed.**  
**Canonical run:** 2026-08-02 · SDK 0.3.220 · Node 24.18.0 · macOS · `claude-fable-5[1m]`  
**Authentication:** `CLAUDE_CODE_OAUTH_TOKEN`, with `ANTHROPIC_API_KEY` explicitly unset  
**Probe:** `probes/probes/94-tool-census.ts`, corpus revision `f1-p94-r3`  
**Executed-source SHA-256:** `2d5e04271052d48475e36bd56c0fb81c13598e82a8bd8cb310ff59c5a703ff34`  
**Committed-source SHA-256:** `8ad206c588ab121d734d0c41e7ff6e3cdf7e727a4cdab6b088b2c6310ce0370c` — only the opening completion-status comment changed after the run; executable TypeScript is identical.

## Verdict

P94 closes F1's tool-result vocabulary gate on the exact Agent SDK shipped by `cc-harness`.

The final contract is **structured-first per call, deterministic fallback per call**:

1. Retain the ordinary `tool_result.content` and the complete original tool input.
2. Retain the user message's optional top-level `tool_use_result` separately.
3. Associate that sidecar with a call only when the message has exactly one `tool_result`, that block has a nonempty `tool_use_id`, and exactly one preceding call owns that ID.
4. Use a recognized, uniquely associated sidecar shape when present. Otherwise derive deterministically from the tool input plus flat result content.
5. Preserve unmatched, ambiguous, duplicate-ID, forwarded, and unknown records without guessing an owner.
6. Never infer session-wide sidecar availability from one successful call. In the canonical run, 52 of 328 calls carried an associated sidecar.

This corrects probe 77 without invalidating its block-level observation: the ordinary `tool_result` block remains flat, while structured executor output may appear on the enclosing `SDKUserMessage.tool_use_result` field.

The result-frame gate is also explicit. A successful queried turn is identified by its submitted `user_message_uuid`; if a result has explicit origin, that origin must agree with the submitted turn's provenance class. SDK error variants have no user UUID, so only an explicit origin matching the FIFO-head waiter may use the fallback. Unassociated results remain lifecycle evidence and cannot complete a different turn.

## Canonical method

The probe generated a fresh private Git repository and private `CLAUDE_CONFIG_DIR` for every case. It used the unrestricted Claude Code tool preset, empty setting sources, auto permission mode with a non-interactive allow callback, disabled session persistence, a 24-turn ceiling, and a 15-minute case deadline. The eight natural prompts described coding tasks without naming or requesting a tool.

The natural corpus covered:

- repository orientation;
- cross-file migration-flag search;
- test-coverage discovery;
- focused implementation inspection;
- parser-file classification;
- a narrow behavior edit plus verification;
- local verification selection;
- migration documentation plus README linkage and verification.

The separately directed Write case exposed only `Write`, supplied the generated fixture's absolute path, and required exactly one successful three-line write with a uniquely associated structured sidecar.

The emitted report is privacy-safe. It contains structural signatures, counts, dimensions, safe command heads, result provenance buckets, and association state. It does not publish prompts, model prose, commands, result text, paths, session IDs, tool-use IDs, environment values, or credentials.

Both canonical runs completed with no setup, query, cleanup, pairing, coverage, or privacy-guard failure:

| Run | Expected | Completed | Failed |
|---|---:|---:|---:|
| Natural corpus | 8 | 8 | 0 |
| Directed Write | 1 | 1 | 0 |

## Canonical 0.3.220 natural tool census

The eight cases produced 328 paired calls and results.

| Tool | Calls | Cases | Flat result | Associated sidecar |
|---|---:|---:|---|---|
| `Read` | 148 | 8/8 | string | 16 present, 132 missing |
| `Bash` | 141 | 8/8 | string; 2 errors | 21 present, 120 missing |
| `Agent` | 11 | 6/8 | array of text blocks | 9 present, 2 missing |
| `TaskUpdate` | 12 | 2/8 | string | missing |
| `TaskCreate` | 6 | 2/8 | string | missing |
| `Edit` | 4 | 2/8 | string | 4 present |
| `TaskGet` | 4 | 1/8 | string | missing |
| `TaskOutput` | 2 | 1/8 | string | 2 present |

No natural case selected `Grep`, `Glob`, `LS`, `Write`, `Skill`, `SendMessage`, `WebFetch`, or `WebSearch`. Absence is scoped to this generated local-coding corpus; it is not a declaration that those tools do not exist. Write has separate directed evidence below.

### Calls per case

| Case | Calls | Tool mix |
|---|---:|---|
| Header-normalizer inspection | 77 | 3 Agent · 25 Bash · 36 Read · 13 task bookkeeping |
| Test-coverage discovery | 64 | 2 Agent · 29 Bash · 24 Read · 9 task bookkeeping |
| Cross-file flag search | 56 | 2 Agent · 28 Bash · 24 Read · 2 TaskOutput |
| Parser-file classification | 49 | 2 Agent · 23 Bash · 24 Read |
| Migration documentation | 31 | 1 Agent · 12 Bash · 2 Edit · 16 Read |
| Orientation | 23 | 1 Agent · 10 Bash · 12 Read |
| Parser behavior edit | 15 | 7 Bash · 2 Edit · 6 Read |
| Local verification selection | 13 | 7 Bash · 6 Read |

Fable delegated in six of eight cases. Counts are evidence for this exact model/runtime/corpus, not stable product constants; F1 must dispatch by observed structure, never by frequency.

## Bash census and `Kr_`

The 141 Bash calls contained 235 safely recorded command heads because calls may contain chains or pipelines:

| Head | Count | Head | Count |
|---|---:|---|---:|
| `git` | 119 | `find` | 42 |
| `grep` | 32 | `sort` | 9 |
| `printf` | 7 | `rg` | 5 |
| `npm` | 5 | `ls` | 3 |
| `node` | 3 | `perl` | 2 |
| `cut` | 1 | `true` | 1 |
| other safe/unknown | 7 |  |  |

The observer found 73 search, 7 read, 3 list, and 5 ignored command statements. `Kr_` classified 65 whole Bash calls and rejected 76 as unclassifiable. Its family tags are overlapping within a classified chain: 65 had search semantics, 5 also had read semantics, and 1 also had list semantics.

The scanner preserves ordinary redirect ownership: `rg marker > hits.txt` remains search-classifiable, while `unknown-command marker > hits.txt` remains unclassifiable. It also preserves `Kr_`'s conservative all-or-nothing rule: a recognized search/read/list head in a chain with an unknown head does not make the complete chain eligible for collapse.

No `Grep` or `Glob` tool was selected. Search behavior came through Bash, confirming the settled fidelity decision to keep Bash available without steering the model toward older dedicated search tools.

## Structured-sidecar shapes

### Read

All 16 Read sidecars used:

```text
{
  type,
  file: { filePath, content, numLines, startLine, totalLines }
}
```

F1 may use `file.numLines`, ranges, and content when this recognized shape is uniquely associated. The 132 flat-only Read calls still require returned-text fallback and prove that line metadata cannot be assumed per tool or per session.

### Edit

All four Edit calls carried:

```text
{
  filePath,
  oldString,
  newString,
  originalFile,
  replaceAll,
  userModified,
  structuredPatch: [{ oldStart, oldLines, newStart, newLines, lines }]
}
```

`structuredPatch` supplies absolute hunk positions. F1 retains it for the later F4 diff renderer and uses the complete input-diff fallback for flat-only replay or future forwarded calls. It does not need an opportunistic disk reread when this sidecar is present.

### Write

Write was not selected naturally. The separately directed 0.3.220 run produced exactly one successful `Write` call and one associated object sidecar:

```text
{
  type,
  filePath,
  content,
  originalFile,
  structuredPatch,
  userModified
}
```

The fixture payload had exactly three nonempty lines (`newlines=2`); the sidecar contained the written content, `originalFile: null`, and an empty `structuredPatch`. F1 can count recognized sidecar content first and fall back to the complete `input.content`.

### Bash

Nineteen successful Bash sidecars were objects with the core shape:

```text
{
  stdout,
  stderr,
  interrupted,
  noOutputExpected,
  isImage,
  returnCodeInterpretation? 
}
```

One observed object additionally carried the optional string `returnCodeInterpretation`. It is retained as structured source, but it is not a numeric exit code and does not make upstream `$`/exit-code framing reachable. Two error calls carried string sidecars matching the two flat result blocks marked `is_error`. F1 uses recognized stdout/stderr/interruption fields when present and keeps the flat result/error fallback for the other 120 calls.

### Agent

Nine Agent calls carried object sidecars; two were flat-only. Completed sidecars used:

```text
{
  agentId,
  agentType,
  content,
  prompt,
  resolvedModel,
  status,
  toolStats: {
    bashCount,
    editFileCount,
    linesAdded,
    linesRemoved,
    otherToolCount,
    readCount,
    searchCount
  },
  totalDurationMs,
  totalTokens,
  totalToolUseCount,
  usage
}
```

Async-launch sidecars instead used `agentId`, `isAsync`, `outputFile`, `canReadOutputFile`, description, prompt, resolved model, and launch status. F3 can use completed totals for recognized top-level calls, but P83 remains necessary for nested and flat-only fallback plus teammate identity semantics.

### Task tools

Both `TaskOutput` calls carried `{ retrieval_status, task }`, with task description, status, IDs, output/result, prompt, task type, and raw-transcript flag. `TaskCreate`, `TaskGet`, and `TaskUpdate` were flat-only in the canonical run.

These are runtime/bookkeeping records. F1 retains them in the canonical document but suppresses ordinary rows for `TaskCreate`, `TaskUpdate`, and `ToolSearch`, matching upstream's invisible task bookkeeping and deferred-tool lookup behavior. Unknown tools retain the generic row/result fallback.

## Result-frame provenance

The canonical exact-source natural run emitted exactly one result frame per case:

| Provenance | Count | Subtype | User UUID | Association | Health |
|---|---:|---|---|---|---|
| `human` | 8 | success | present | matched query | 8 healthy, 0 errors |
| non-originating | 0 | — | — | — | — |

Thus every case closed on exactly one healthy result owned by its explicit UUID-bearing root turn.

A separate successful 0.3.220 natural execution, before the Write-only absolute-path correction and therefore excluded from canonical frequency totals, emitted 11 successful result frames: eight matched human results and three separate `task-notification` results with missing user UUIDs. That supplemental run is lifecycle evidence that result multiplicity can occur and that task completion must not dequeue the queried turn. The final Session prerequisite now binds every success to its submitted UUID and provenance class; explicit-origin SDK errors may settle only a FIFO-head waiter of the same submitted class.

## Final F1 decisions

1. **Canonical source retains both channels.** Store complete tool input, flat `tool_result.content`, optional `tool_use_result`, parent route, lifecycle/error state, and sidecar association state.
2. **One normalizer, two inputs.** Prefer a uniquely associated recognized sidecar; otherwise derive from complete input plus flat result content.
3. **Read:** recognized `file.numLines` first; returned flat-line count second.
4. **Edit:** retain recognized `structuredPatch` absolute positions; input diff remains the fallback and F4 owner.
5. **Write:** recognized sidecar content first; `input.content` line count second.
6. **Bash:** recognized stdout/stderr/interruption first; preserve optional `returnCodeInterpretation` without treating it as a numeric exit code; flat result/error otherwise. Run `Kr_` on the original command.
7. **Agent:** retain recognized launch/completion data. F3 owns totals display; nested and flat-only calls keep fallback source.
8. **Internal rows:** retain `TaskCreate`, `TaskUpdate`, and `ToolSearch`, but produce no ordinary compact row.
9. **Unknown tools:** use the generic tool row/result path. Corpus absence is never a hidden-row rule.
10. **Result ownership:** success requires a matching submitted UUID and, when explicit, matching submitted origin. UUID-less errors require an explicit origin matching the FIFO-head waiter. Every unassociated frame remains visible as lifecycle evidence but cannot complete a different local turn, alter its limit state, or consume its compaction request.

## Scope and limitations

- The canonical report uses one repetition across eight natural cases plus one directed Write case. The probe defaults to two repetitions for later drift checks.
- The corpus is generated local TypeScript-style coding work. It does not measure web, MCP, image, notebook, permission, interruption, background-output, hook, or scheduled-turn behavior. Existing P80/P84/P85 and later probes retain those gates.
- Tool frequencies are model- and prompt-sensitive. They document this run; they are not dispatch constants.
- Sidecar presence is per call. A renderer must never infer that later calls of the same tool will carry one.
- The exact final natural run had no non-originating result; the separate successful 0.3.220 run supplies the task-notification multiplicity evidence.

## Reproduction

From `CC-to-SDK/probes`, load OAuth only without printing or inspecting its value:

```sh
set -a; . ../.env; set +a
unset ANTHROPIC_API_KEY
test -n "${CLAUDE_CODE_OAUTH_TOKEN:-}"
```

Run the keyless gates:

```sh
npx tsx probes/94-tool-census.ts --self-test
npx tsc --noEmit
```

Run the natural corpus and the coverage-directed Write case separately:

```sh
npx tsx probes/94-tool-census.ts --repetitions=1
npx tsx probes/94-tool-census.ts --case=write-coverage --repetitions=1
```

The default intentionally excludes the directed Write case. The probe fails closed on SDK-version drift, unsafe output, unpaired calls/results, a missing or unhealthy originating result, missing directed-Write sidecar evidence, setup/query/cleanup failures, and privacy-guard violations.
