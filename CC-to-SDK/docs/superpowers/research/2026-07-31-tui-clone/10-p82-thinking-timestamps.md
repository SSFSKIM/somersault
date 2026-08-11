# P82 — Per-block timestamps on the thinking stream

**Status:** **Complete. TR33 / LT2 / LT5 duration-source gate closed.**
**Question (master spec, verbatim):** *"Are there per-block timestamps on the thinking stream, enough to compute `Thought for 12s`?"*
**Probe:** `probes/probes/82-thinking-timestamps.ts`

## Verdict

**No. There is no timestamp on any streaming frame, and no start timestamp anywhere.** Every
`stream_event` frame — including all 58 `thinking_delta` frames, the `signature_delta`, and every
`content_block_start` / `content_block_stop` — carries exactly four wrapper keys (`type`, `event`,
`session_id`, `parent_tool_use_id`, `uuid`) and **zero** time-bearing fields at any depth. The one
exception is `stream_event:message_start`, which carries `ttft_ms` (an integer millisecond
time-to-first-token for that API request), and that is a duration, not a clock.

Wall-clock ISO timestamps **do** exist, but only on **completed message envelopes**:
`SDKAssistantMessage.timestamp`, `SDKUserMessage.timestamp`, and the same `.timestamp` on every
on-disk transcript entry. Per `sdk.d.ts` these are *block-finish* stamps ("ISO timestamp of when this
content block finished on the originating process… for display only; do not order messages by this
field"), and the live run confirms the semantics: the engine emits **one assistant frame per content
block**, all sharing one `message.id`, each with its own `timestamp`. So the wire gives you the moment
a thinking block **ended** and nothing about when it **began**.

**Therefore F3 must clock local arrival time.** The duration source is
`content_block_start(thinking)` arrival → `content_block_stop` arrival, measured with `Date.now()` in
the client, keyed per block. This is safe: the SDK spawns the `claude` CLI on the same host, and the
measured skew between local arrival and the wire `timestamp` was **1–14 ms** across four assistant
frames, with an **8499 ms local span against an 8513 ms wire span** over the same interval (0.16 %
disagreement). Local clocking is not an approximation of engine truth here — it is the same clock.

## Runtime provenance

| | |
|---|---|
| SDK | `@anthropic-ai/claude-agent-sdk` **0.3.220** (`probes/node_modules/.../package.json`) |
| Model (from `system:init` frame) | `claude-sonnet-4-6` (thinking-capable; `result.modelUsage` also shows background `claude-haiku-4-5-20251001`) |
| Authentication | first-party **`CLAUDE_CODE_OAUTH_TOKEN`** from `CC-to-SDK/.env`; `ANTHROPIC_API_KEY` is not present in `.env` (verified by name only, never printed) |
| Run options | `includePartialMessages: true`, `thinking: {type:"enabled", budgetTokens:6000}`, `permissionMode:"bypassPermissions"`, `allowedTools:["Read"]`, `settingSources: []`, `maxTurns: 3`, 180 s abort deadline |
| Canonical run | 2026-08-03, session `fcb28154-9ba7-414b-b2a2-01a301389d41`, turn 71 615 ms, `result.is_error=false`, `RESULT: PASS (measured)` |
| Shape | one 58.6 s thinking burst (3 627 chars, 58 `thinking_delta` frames) + exactly one `Read` tool call |

Rerun: `cd CC-to-SDK/probes && set -a; . ../.env; set +a; npx tsx probes/82-thinking-timestamps.ts`

## Observed frame shapes

Key paths below are the probe's own recursive leaf-path census (depth ≤ 8, arrays sampled at the first
two elements), not a paraphrase. "time-ish" = key name matching
`/time|timestamp|_at$|^at$|date|epoch|elapsed|duration|_ms$|ttft|started|ended/i`.

### `stream_event` — no timestamps, on any sub-type

Nine `stream_event` sub-types were observed. Their **complete** wrapper key set is identical
everywhere: `type`, `event.*`, `session_id`, `parent_tool_use_id`, `uuid` (plus `ttft_ms` on
`message_start` only).

| sub-type | n | time-ish key paths |
|---|---|---|
| `message_start` | 2 | **`ttft_ms=2152`** (integer ms, not a clock) |
| `content_block_start(thinking)` | 1 | NONE |
| `content_block_delta(thinking_delta)` | 58 | NONE |
| `content_block_delta(signature_delta)` | 1 | NONE |
| `content_block_start(text)` | 2 | NONE |
| `content_block_delta(text_delta)` | 14 | NONE |
| `content_block_start(tool_use)` | 1 | NONE |
| `content_block_delta(input_json_delta)` | 3 | NONE |
| `content_block_stop` | 4 | NONE |
| `message_delta` | 2 | NONE |
| `message_stop` | 2 | NONE |

Representative thinking-delta frame (verbatim, thinking text is short here):

```json
{"type":"stream_event",
 "event":{"type":"content_block_delta","index":0,
          "delta":{"type":"thinking_delta","thinking":"…","estimated_tokens":null}},
 "session_id":"fcb28154-…","parent_tool_use_id":null,"uuid":"eea78338-…"}
```

Full leaf-path list for that class — this is the whole frame, there is nothing else in it:
`type, event.type, event.index, event.delta.type, event.delta.thinking, event.delta.estimated_tokens, session_id, parent_tool_use_id, uuid`

`content_block_start(thinking)`:

```json
{"type":"stream_event",
 "event":{"type":"content_block_start","index":0,
          "content_block":{"type":"thinking","thinking":"","signature":""}},
 "session_id":"fcb28154-…","parent_tool_use_id":null,"uuid":"913bb61b-…"}
```

`content_block_stop` is even thinner: `type, event.type, event.index, session_id, parent_tool_use_id, uuid`.

### `assistant` — one frame per content block, each with a finish `timestamp`

```
[assistant(thinking)]  timestamp=2026-08-03T19:12:05.654Z
[assistant(text)]      timestamp=2026-08-03T19:12:10.333Z
[assistant(tool_use)]  timestamp=2026-08-03T19:12:10.410Z
[assistant(text)]      timestamp=2026-08-03T19:12:14.167Z
```

Leaf key paths (thinking variant): `type, message.model, message.id, message.type, message.role,
message.content[].type, message.content[].thinking, message.content[].signature, message.stop_reason,
message.stop_sequence, message.stop_details, message.usage.*, message.diagnostics,
message.context_management, parent_tool_use_id, session_id, uuid, **timestamp**, request_id`.

The only time-ish path is the top-level `timestamp`. **Nothing inside `message.content[]` carries a
time field** — the thinking block itself is `{type, thinking, signature}`.

### `user` (tool_result) — same single finish `timestamp`

`type, message.role, message.content[].tool_use_id, message.content[].type,
message.content[].content, parent_tool_use_id, session_id, uuid, **timestamp**, tool_use_result.type,
tool_use_result.file.filePath, tool_use_result.file.content, tool_use_result.file.numLines,
tool_use_result.file.startLine, tool_use_result.file.totalLines`.

### `system` frames

- `system:init` — no time-ish key at all.
- `system:status` (n=2, `status:"requesting"`) — no time-ish key.
- **`system:thinking_tokens` (n=59)** — `type, subtype, estimated_tokens, estimated_tokens_delta,
  uuid, session_id`. No timestamp, but it is a live per-delta thinking-token counter, i.e. a ready-made
  progress signal to pair with a locally clocked timer.
- `rate_limit_event` — has `rate_limit_info.resetsAt` (epoch seconds), unrelated to block timing.

### `result` — turn-level durations only

`duration_ms=70090`, `duration_api_ms=71067`, `ttft_ms=61488`, `ttft_stream_ms=2457`,
`time_to_request_ms=305`. All whole-turn aggregates; none of them decomposes to a block.

### On-disk transcript (the F3 replay path)

`getSessionMessages(sessionId)` returned 6 entries; every entry key set is
`type, uuid, session_id, message, parent_tool_use_id, parent_agent_id, timestamp` and the only
time-ish path is `timestamp` (e.g. `2026-08-03T19:12:14.167Z`) — the same per-message finish stamp.
**Replay therefore has finish stamps but no start stamps**, and there are no `stream_event` records on
disk at all, so a replayed thinking group cannot recover its own duration from the transcript.

## Local arrival-time measurements

All values are milliseconds since the first frame of the run.

**Thinking block** (`msgSeq 1`, `index 0`):

| anchor | arrival |
|---|---|
| `content_block_start(thinking)` | +4 093 ms |
| first `thinking_delta` | +4 093 ms (same millisecond as the start frame) |
| last `thinking_delta` | +59 850 ms |
| `signature_delta` | +62 667 ms |
| `content_block_stop` | +62 681 ms |
| `assistant(thinking)` frame | +62 681 ms (wire `timestamp` 14 ms earlier) |

→ **start → stop = 58 588 ms**, 58 thinking deltas, 3 627 chars. A `Thought for 59s` row is trivially
derivable from arrival time; the sub-second granularity is far finer than the 1 s tick TR33 needs.

**Tool call** (`toolu_01YBUzthuoQRSRCiqhfP7o3o`, a `Read` of a small file):

| anchor | arrival |
|---|---|
| `content_block_start(tool_use)` | +67 348 ms |
| `assistant(tool_use)` frame | +67 425 ms |
| `user(tool_result)` frame | +67 453 ms |

→ assistant-frame → tool_result = **28 ms**; block-start → tool_result = **105 ms**. Both are usable;
`content_block_start(tool_use)` is the earlier and better start anchor because it fires as soon as the
model names the tool, before the arguments finish streaming.

**Wire-vs-local skew** (the check that justifies local clocking):

```
msg0 thinking  arrivedAt=+62681ms  localArrival − wireTimestamp = 14ms
msg1 text      arrivedAt=+67347ms  localArrival − wireTimestamp =  1ms
msg2 tool_use  arrivedAt=+67425ms  localArrival − wireTimestamp =  2ms
msg3 text      arrivedAt=+71180ms  localArrival − wireTimestamp =  1ms
wire span first→last = 8513ms | local arrival span = 8499ms
```

## Attribution and block scoping

- **Every** `stream_event` frame carries `session_id`, the `parent_tool_use_id` key, and `uuid`
  (90/90 frames in the canonical run). `parent_tool_use_id` was `null` throughout — this run had no
  subagent — but the key is always present, so nested thinking is routable without extra state.
- **Every** `content_block_delta` carried a numeric `event.index` (76/76; zero without). Thinking
  deltas are fully attributable to a block.
- **`event.index` restarts at 0 on every API message.** The canonical run contains `block[1:0]`
  (thinking) and `block[2:0]` (the post-tool text) — both index 0, different blocks. A per-block timer
  keyed on `index` alone silently overwrites the earlier block; the first draft of this probe had
  exactly that defect and reported "no thinking block observed" for a run that had one. **The key must
  be (message ordinal or `message_start.event.message.id`, `event.index`).** This is a hard
  implementation constraint for TR33, not a probe artifact.

## Implication for LT5 / TR33

TR33's live-ticking `Thought for 12s` row and F3's collapsed-group elapsed suffix must both be driven
by **locally clocked arrival time**, and the design docs must say so rather than implying engine-truth
durations. Concretely: start a per-block timer keyed by `(message id, content-block index)` when
`stream_event:content_block_start` arrives with `content_block.type === "thinking"`, tick it once a
second off the local clock while `thinking_delta` frames keep arriving (optionally pairing the tick
with the live `system:thinking_tokens.estimated_tokens` counter, which is the only other per-delta
progress signal the wire offers), and freeze it at `content_block_stop` arrival — optionally snapping
the frozen end to the enclosing assistant frame's `timestamp`, which agrees with local arrival to
within 14 ms and is the only engine-side anchor that exists. The same rule extends to tool rows: start
at `content_block_start(tool_use)` arrival, stop at the `user` frame carrying the matching
`tool_result`. The one thing the clone cannot do is recover durations for a **replayed** transcript:
the on-disk record keeps only per-message finish stamps and no `stream_event` history, so a resumed or
attached session must either render collapsed groups without an elapsed suffix or reconstruct a lower
bound from consecutive `timestamp` deltas (finish-to-finish, which overstates a block that began after
its predecessor ended). Prefer omitting the suffix on replay over showing a number the wire did not
support.
