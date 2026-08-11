# P80 + P81 — interrupt / error sentinels on the wire, and the `compact_boundary` frame

**Status:** **Complete. LT14 / TR38 / TR36 gates closed** (TR38 with one condition, credit-balance, that
is static-only — see the split below).
**Questions (master spec, verbatim):**
*P80 — "Does `[Request interrupted by user]` reach a client as a user message? Do context-limit,
credit-balance and abort conditions arrive as assistant text with upstream's sentinel strings, or as SDK
errors?"* (gates `LT14`, `TR38`)
*P81 — "Does the `compact_boundary` frame carry a summarised-message count and direction?"* (gates `TR36`)
**Probes:** `probes/probes/80b-interrupt-error-sentinels.ts` (the `80-*` slot is taken by the unrelated
`80-sandbox-escalation-broker.ts`), `probes/probes/81-compact-boundary.ts`

---

## Verdicts

**LT14 — ALIVE, but only on the `interrupt()` path.** `query.interrupt()` mid-tool-call emits a real
`type:"user"` frame on the wire whose sole content block is
`{"type":"text","text":"[Request interrupted by user for tool use]"}` — the literal upstream sentinel,
delivered as a user message exactly as the spec hoped. It is preceded by a second `user` frame carrying
the rejected `tool_result` plus a wire-level `tool_use_result:"User rejected tool use"` field, and
followed by a `result` frame with `subtype:"error_during_execution"`, `is_error:true`,
`terminal_reason:"aborted_tools"` and an **empty** `result` string. So a client can render the interrupt
row from the wire alone, and can distinguish the "interrupted while a tool was pending" variant from the
bare `[Request interrupted by user]` variant by the trailing ` for tool use`.

**LT14, the abort path — DEAD on the wire, alive on disk.** Aborting the same turn through
`options.abortController` is a *different animal*: the async iterator **throws**
`Error: Claude Code process aborted by user`, zero frames arrive after `abort()`, and no sentinel ever
reaches the client. The CLI still writes the identical `[Request interrupted by user for tool use]` row
into its JSONL before dying, so the row exists — but a client that only reads the stream never sees it.
**A clone must therefore treat `interrupt()` and `abortController` as two different UX paths:** the
former produces a renderable row, the latter produces an exception and requires the client to synthesise
its own row.

**TR38 — ALIVE, and stronger than assumed: API errors arrive as *assistant* frames, not as throws.** A
forced context-limit (a 1.35 MB single prompt, rejected by the API at 400 before any sampling — cost
`$0`) produced no exception at all. It produced an `assistant` frame carrying the sentinel as plain text
— `Prompt is too long · the request is ~347706 tokens (limit 200000) …` — tagged with
`error:"invalid_request"` and an **undeclared** runtime field `is_api_error_message:true`, then a
`result` frame repeating the same string in `result` with `api_error_status:400` and
`terminal_reason:"prompt_too_long"`. The transcript view can render error sentinels as assistant rows.
**One trap:** that `result` frame's `subtype` is **`"success"`** even though `is_error:true` — a client
keying off `subtype` alone will mis-classify a hard API failure as a clean turn.

**TR36 — ALIVE on the wire, DEAD through `getSessionMessages`. No message count, no pre/post direction.**
A `/compact` turn emits exactly one `system/compact_boundary` frame. Its `compact_metadata` carries a
**trigger tag** (`"manual"`), a **token delta** (`pre_tokens:17920` → `post_tokens:1247`, plus an
undeclared `cumulative_dropped_tokens:16673`), `duration_ms`, and relink anchors — and **no summarised-
message count and no direction field**. There is only one frame, emitted after compaction completes, so
"direction" in the pre/post sense does not exist; what stands in for it is the `trigger` tag plus a
top-level `logical_parent_uuid` pointing at the last pre-compaction message. A count must be **derived**
(see the arithmetic below). Separately, `getSessionMessages(..., {includeSystemMessages:true})` returns
the boundary row **stripped of `subtype` and `compactMetadata`** and the summary row **stripped of
`isCompactSummary`** — so the persisted-transcript reader cannot identify either row through the SDK's
own accessor.

---

## Runtime provenance

| | |
|---|---|
| SDK | `@anthropic-ai/claude-agent-sdk` **0.3.220** |
| Bundled CLI | `claude_code_version: "2.1.220"` (manifest commit `4073f595…`, build 2026-07-24) |
| Model | `claude-haiku-4-5-20251001` |
| Auth | OAuth subscription token — `init.apiKeySource: "none"` (no `ANTHROPIC_API_KEY` in env) |
| Options | `permissionMode:"bypassPermissions"`, `settingSources:[]`, temp `cwd` |
| Run date | 2026-08-03 |
| Cost | P80 ≈ `$0.008` (part C billed `$0` — a 400-rejected request samples nothing); P81 ≈ 6 haiku turns |

---

## Frame evidence — P80

### A. `interrupt()` — the full wire sequence

14 frames. `init` · 7 × `system/thinking_tokens` · one bare `rate_limit_event` · `assistant`(thinking) ·
`assistant`(`tool_use` Bash) — then, after `interrupt()`:

```jsonc
// 1. the rejected tool_result, as a user frame with a wire-level annotation
{"type":"user","message":{"role":"user","content":[{"type":"tool_result", …, "is_error":true}]},
 "tool_use_result":"User rejected tool use","timestamp":"2026-08-03T19:12:42.662Z"}

// 2. THE SENTINEL — verbatim, complete frame
{"type":"user",
 "message":{"role":"user","content":[{"type":"text","text":"[Request interrupted by user for tool use]"}]},
 "parent_tool_use_id":null,
 "session_id":"3e91261f-e7a4-47b8-8531-7f29d3d9ffa6",
 "uuid":"ba1b4c71-6f94-43b5-a5d0-36c5803f7b23",
 "timestamp":"2026-08-03T19:12:42.663Z"}

// 3. the terminating result
{"type":"result","subtype":"error_during_execution","is_error":true,"num_turns":3,
 "stop_reason":"tool_use","terminal_reason":"aborted_tools","result":"",
 "total_cost_usd":0.0082576,"duration_ms":5211}
```

Exact key paths on the sentinel frame: `type` · `message.role` · `message.content[0].type` (`"text"`) ·
`message.content[0].text` · `parent_tool_use_id` · `session_id` · `uuid` · `timestamp`. Note there is
**no** `subtype`, no `isMeta`, and no marker field distinguishing it from a genuine user prompt other
than the bracketed text itself. `interrupt()` resolved in 2 ms and did not throw; the stream did not throw.

The persisted transcript (5 rows) ends with the identical row, plus `parent_agent_id:null`.

### B. `abortController` — the divergent path

Identical prompt and timing. 14 frames, all *before* the abort; `frames after abort(): 0`. The iterator
threw:

```
Error: Claude Code process aborted by user     // e.name === "Error", not "AbortError"
```

No `result` frame. No sentinel on the wire. The JSONL nonetheless gained
`[Request interrupted by user for tool use]` (uuid `aba6cf2a-…`, same shape as A) 1.5 s later, read back
successfully via `getSessionMessages` after a settling delay.

### C. Forced context-limit (the only error condition cheap enough to force)

```jsonc
// assistant frame — the sentinel arrives as ASSISTANT TEXT
{"type":"assistant","error":"invalid_request","is_api_error_message":true,
 "request_id":"req_011CdgM5EdK7dgt5BwFE2CzL","timestamp":"2026-08-03T19:12:54.608Z",
 "message":{ …"content":[{"type":"text","text":
   "Prompt is too long · the request is ~347706 tokens (limit 200000) and this conversation's own content is most of it. A single-exchange conversation cannot be compacted; start with less content (smaller files or pasted text)."}]}}

// result frame — subtype "success" DESPITE is_error:true
{"type":"result","subtype":"success","is_error":true,"api_error_status":400,
 "terminal_reason":"prompt_too_long","stop_reason":"stop_sequence","num_turns":1,
 "total_cost_usd":0,"duration_api_ms":0,
 "result":"Prompt is too long · the request is ~347706 tokens (limit 200000) …",
 "usage":{"input_tokens":0,"output_tokens":0, …}}
```

Only three frames total (`init`, the assistant error, the result). Elapsed 2.2 s. `Prompt is too long` was
the only one of the five candidate sentinels present; `input length and \`max_tokens\` exceed context
limit`, `Context limit reached`, `Credit balance is too low` and `API Error` were all absent from this
path — they belong to other code paths (see the static inventory).

---

## Frame evidence — P81

### The `compact_boundary` frame, verbatim from the wire

```jsonc
{"type":"system","subtype":"compact_boundary",
 "session_id":"9068678b-c30b-4165-ac33-faf0bd2eb25a",
 "uuid":"2c091029-2f13-49f3-afde-8af374c97202",
 "compact_metadata":{
   "trigger":"manual",
   "pre_tokens":17920,
   "post_tokens":1247,
   "cumulative_dropped_tokens":16673,          // ← UNDECLARED in sdk.d.ts
   "duration_ms":22606,
   "preserved_segment":{"head_uuid":"09dd7f5e…","anchor_uuid":"421cb242…","tail_uuid":"53a549ed…"},
   "preserved_messages":{"anchor_uuid":"421cb242…",
                         "uuids":["09dd7f5e…","53a549ed…"],
                         "all_uuids":["09dd7f5e…","53a549ed…"]}},   // all_uuids ← UNDECLARED
 "logical_parent_uuid":"53a549ed…"}                                 // ← UNDECLARED at top level
```

Exact key paths: `type` · `subtype` · `session_id` · `uuid` · `logical_parent_uuid` ·
`compact_metadata.{trigger, pre_tokens, post_tokens, cumulative_dropped_tokens, duration_ms}` ·
`compact_metadata.preserved_segment.{head_uuid, anchor_uuid, tail_uuid}` ·
`compact_metadata.preserved_messages.{anchor_uuid, uuids[], all_uuids[]}`.

Three fields present at runtime are **not declared** in `sdk.d.ts`'s `SDKCompactBoundaryMessage`:
`cumulative_dropped_tokens`, `preserved_messages.all_uuids`, and the top-level `logical_parent_uuid`.
Conversely nothing declared was missing. `hasExplicitMessageCount: false`.

### The bracketing `status` frames

The `/compact` turn's system subtypes, in order: `status` · `status` · `init` · `compact_boundary`.

```jsonc
{"type":"system","subtype":"status","status":"compacting", …}
{"type":"system","subtype":"status","status":null,"compact_result":"success", …}
```

These are the progress signal for a spinner/row; `compact_error` would ride the same frame on failure.
Note the **`init` frame re-fires** inside the `/compact` turn — a compaction restarts the session banner.

### Deriving the summarised-message count (the spec's actual question)

Nothing carries it. It is computable two ways, both from data the wire supplies:

- **Kept count** = `compact_metadata.preserved_messages.uuids.length` → **2** in this run (the final
  `DELTA-FOUR` assistant thinking + text pair).
- **Summarised count** = (rows accumulated before the boundary) − kept. From the raw JSONL: the boundary
  sits at raw index 28 of 41; **12** conversational (`user`/`assistant`) rows precede it, 2 preserved
  ⇒ **10 summarised**. A client that keeps its own retained
  transcript document (which F1 already builds) can compute this locally; there is no server-supplied number.
- Token framing is exact and free: `pre_tokens - post_tokens` = 16 673 dropped, matching
  `cumulative_dropped_tokens`. **The honest row label is a token delta, not a message count.**

### `getSessionMessages` fidelity loss — the TR36 trap

Raw JSONL (41 rows) versus what the SDK accessor hands back (9 rows, `includeSystemMessages:true`):

| on disk | via `getSessionMessages` |
|---|---|
| `{type:"system", subtype:"compact_boundary", compactMetadata:{…camelCase…}, logicalParentUuid, level, isMeta:false, content, slug, …}` | `{"type":"system","uuid":"2c09…","session_id":…,"parent_tool_use_id":null,"parent_agent_id":null,"timestamp":…}` — **no `subtype`, no `compactMetadata`, no content** |
| `{type:"user", isCompactSummary:true, isVisibleInTranscriptOnly:true, message:{content:"This session is being continued from a previous conversation…"}}` | `{"type":"user", …}` — **no `isCompactSummary`**, indistinguishable from a real prompt except by the literal opening sentence |
| `{type:"user", isMeta:true, content:"<local-command-caveat>…"}` | **dropped entirely** |
| `type:"queue-operation"` ×10, `type:"attachment"` ×5, `type:"ai-title"` ×2, `type:"last-prompt"` ×2 | **dropped entirely** |

Also note the on-disk metadata is **camelCase** (`compactMetadata.preTokens`, `preservedMessages.allUuids`)
while the wire frame is **snake_case** (`compact_metadata.pre_tokens`). Any code that reads both surfaces
needs both spellings.

---

## Static inventory — sentinel strings in the shipped binary

> **Everything in this section is STATIC evidence**: literal strings and code fragments extracted from
> `/Users/new/.local/share/claude/versions/2.1.220` (the 245 MB bundled CLI, byte-identical to the SDK's
> `manifest.json` `darwin-arm64` entry — same 256 908 272-byte size, hard-linked). It shows which sentinels
> *exist* and how the code *classifies* them. It does **not** prove runtime reachability. Only the
> `Prompt is too long` path above is runtime-proven.

**Present in the binary:**

| sentinel | how the code uses it |
|---|---|
| `[Request interrupted by user]` | literal marker; **runtime-proven** in its `for tool use` variant |
| `[Request interrupted by user for tool use]` | literal marker; **runtime-proven** |
| `Prompt is too long` | `Jq="Prompt is too long"` — an error *classification* constant; **runtime-proven** as assistant text |
| `Credit balance is too low` | `LYr="Credit balance is too low"`, classified by `zcs(e)` = `e instanceof Error && e.message.toLowerCase().includes("credit balance is too low")` |
| `Credit balance too low · Add funds: https://platform.claude.com/settings/billing` | Ink `jsx` **TUI rendering** of the `LYr` case — a status-bar line, not wire text |
| `Context limit reached · /compact or /clear to continue` | Ink `jsx` **TUI rendering**; the `/clear`-only variant appears when `DISABLE_COMPACT` |
| `Context low (N% remaining) · Run /compact to compact & continue` | Ink `jsx` **status-line** warning, not an error path |
| `input length and \`max_tokens\` exceed context limit: (\d+) \+ (\d+) > (\d+)` | classified by `jPt(e)`, then parsed by `Klp(e)` gated on `e.status === 400` to recover a `max_tokens` value |
| `API Error` | `IT="API Error"` prefix constant, alongside AWS/GCP credential-failure constants |
| `Claude Code process aborted by user` | the **thrown** message on the abort path; **runtime-proven** |
| `User rejected tool use` | `vld="User rejected tool use"`; **runtime-proven** as the `tool_use_result` field |

**What the classification shape tells us.** `zcs` / `jPt` / `Klp` all take an `Error` and match on
`e.message` — i.e. these conditions originate as **thrown API errors inside the CLI**, which the CLI then
wraps. Part C proves what the wrapping produces on the SDK boundary: an `assistant` frame with
`is_api_error_message:true` and an `error` tag. The declared enum
`SDKAssistantMessageError = 'authentication_failed' | 'oauth_org_not_allowed' | 'billing_error' |
'rate_limit' | 'overloaded' | 'invalid_request' | 'model_not_found' | 'server_error' | 'unknown' |
'max_output_tokens'` includes **`billing_error`**, which is the credit-balance case's tag. Combined with
the runtime-proven `invalid_request` path, this makes it *very likely* — **but not proven** — that a
credit-balance failure also arrives as an assistant frame with `error:"billing_error"` and the
`Credit balance is too low` text, rather than as a throw. There is no cheap way to force it; a clone
should handle it generically off `is_api_error_message` / `error` rather than off the specific string.

Two further static facts worth carrying into F3:

- **The SDK's own code filters the interrupt sentinel out of session titles.** `sdk.mjs` (and the binary)
  both carry `/^(?:\s*<[a-z][\w-]*[\s>]|\[Request interrupted by user[^\]]*\])/`, applied in a
  first-prompt extractor that also skips rows with `isMeta === true` or `isCompactSummary === true`. That
  regex is exactly the anchor filter a transcript view needs, and it confirms the sentinel is expected to
  appear as a *user* row.
- The CLI's internal message schema declares
  `interrupted_message_id … "@internal For [Request interrupted by user] markers only: the API msg_* id
  that Esc cancelled."` — so upstream's own model of this row is "a user row with a back-reference to
  the cancelled assistant message." That field did **not** appear on our wire frame or transcript row.
- `SDKAssistantMessage.aborted?: true` is declared ("truncated by an interrupt/abort before the stream
  completed"). It did **not** appear in Part A — our interrupt landed between a completed assistant
  message and its tool execution, not mid-stream. Interrupting during token streaming is a separate,
  unprobed case.

---

## Implications for LT14 / TR38 / TR36

**LT14 (interrupt rows in the live turn)** — buildable straight off the wire, with one branch. Render a
distinct interrupt row when a `user` frame's single text block matches
`/^\[Request interrupted by user[^\]]*\]$/`, and suppress the immediately-preceding `tool_result` frame's
generic "rejected" body in favour of the same row (it carries `tool_use_result:"User rejected tool use"`,
which is the cleanest discriminator). Pair it with the `result` frame's `terminal_reason:"aborted_tools"`
for the turn-level state. **The clone's own stop path must call `query.interrupt()`, not
`abortController.abort()`** — the abort path gives the client an exception and nothing to render, and the
two are not interchangeable. If a clone ever does need `abort()` (process teardown), it must synthesise
the row itself and expect no `result` frame.

**TR38 (assistant-text error sentinels in the transcript)** — the premise holds and generalises. Errors
are assistant rows, not exceptions, so the transcript document can hold them as first-class rows with
error styling. Key off `is_api_error_message === true` (undeclared but present) with `error` (the
`SDKAssistantMessageError` tag) as the styling input, and treat the frame's text as already
user-facing — upstream's sentinel wording arrives pre-composed, including the token counts. Two hazards
to encode: `result.subtype` is `"success"` on a failed turn, so error state must be read from `is_error`
/ `terminal_reason` / `api_error_status`; and the TUI-only strings (`Context limit reached · …`,
`Credit balance too low · Add funds: …`, `Context low (N% remaining) · …`) are **status-bar renderings
the clone must compose itself** — they never arrive on the wire.

**TR36 (the compact-summary row)** — buildable, but the row's honest content is a token delta and a
trigger tag, not "N messages summarised". Render from the live `system/compact_boundary` frame
(`trigger`, `pre_tokens → post_tokens`, `duration_ms`), use the two `system/status` frames
(`status:"compacting"` → `status:null, compact_result:"success"`) to drive the in-progress state, and
derive any message count locally against the retained transcript document using
`preserved_messages.uuids` as the kept set. **Do not plan to reconstruct this row from
`getSessionMessages`** — that accessor strips `subtype`, `compactMetadata` and `isCompactSummary`, which
means a resumed/attached client cannot recover the boundary from the SDK's persisted-message API and must
either have witnessed the live frame or parse the raw JSONL. That is a real constraint on how F1's
retained transcript document must be persisted: the boundary metadata has to be captured when it streams,
because it is not re-readable afterwards.
