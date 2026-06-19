# Increment 5 — Live streaming + live status bar (`cc-harness-chat`)

**Status:** approved design (brainstorm complete) · 2026-06-19
**Topic:** make the in-process chat REPL render *live* — token-by-token text, streaming-then-collapsing
thinking, in-place tool running→done status — plus a live status bar (model · mode · ctx% · streaming).

## Product framing (the reframe that motivates this)

`cc-harness` (the library) is the **backend engine**. The program's north star is **an interactive agent
(+daemon) — a faithful reproduction of interactive Claude Code**, *not* a headless service. Measured against
that interactive yardstick, the engine is mature but the front-end has runway. This is **increment 5** of the
Phase-3 interactive track (after: 1 `top` dashboard · 2 `cc-harness-console` · 3 `cc-harness-chat` · 4
daemon-attached permissions).

The interactive-CC feature runway (for context — only **A** is in scope here):

| | Feature | Increment |
|---|---|---|
| **A** | **Live streaming** — token text, streaming thinking, tool running→done | **5 (this spec)** |
| B | Slash commands in-REPL (`/compact`, `/model`, `/clear`, `/resume`) | later |
| C | Model-switch UI mid-session | later |
| D | Rich tool rendering — Edit diffs, TodoWrite list, Task/subagent nesting | later |
| E | Input ergonomics — multiline, history, `@`-file mentions | later |
| F | Session continuity — resume/continue at launch, `/resume` picker | later |
| G | Status affordances — live context %, auto-compact warning, cost | **slice in 5** (status bar) |

## Goal

When the user submits a turn in `cc-harness-chat`, the assistant's text appears **as it is generated**
(not in one block at message completion), thinking streams live then collapses to a marker, each tool shows
`⟳ running → ✓/✗ done` updating **in place**, and a bottom status bar shows the live model · permission
mode · context % · a streaming indicator. No `cc-harness` (engine) changes beyond flipping one config flag.

## Probe-verified premises (A1 live-probe-first — the load-bearing evidence)

Probe 12 proved `includePartialMessages:true` emits `stream_event` partials in **one-shot** (string-prompt)
mode. The chat REPL drives a **multi-turn streaming-input** `Session` (async-iterable input queue), a
different SDK path. **Probe 20** (`probes/probes/20-partial-stream-session.ts`, model `claude-sonnet-4-6`)
verified that path and captured the exact frame shapes. Result: **PASS** (20 stream_event frames; partials
flow; running→done boundary present).

**Frame envelope** (delivered to `Session.submit`'s `onMessage`, interleaved with full messages):
```
{ type:"stream_event", event:{…}, session_id, parent_tool_use_id, uuid, ttft_ms }
```
**`event` sub-types seen, in order, for a (thinking → Read tool → answer) turn:**
```
message_start
  content_block_start{ index:0, content_block:{ type:"thinking", thinking:"", signature:"" } }
  content_block_delta{ index:0, delta:{ type:"thinking_delta" | "signature_delta" } }
  content_block_stop{ index:0 }
  content_block_start{ index:1, content_block:{ type:"tool_use", id:"toolu_…", name:"Read", input:{}, caller:{type:"direct"} } }
  content_block_delta{ index:1, delta:{ type:"input_json_delta", partial_json:"…" } }
  content_block_stop{ index:1 }
message_delta ; message_stop
message_start
  content_block_start{ index:0, content_block:{ type:"text", text:"" } }
  content_block_delta{ index:0, delta:{ type:"text_delta", text:"The codeword is **" } }
  content_block_stop{ index:0 }
message_delta ; message_stop
… then full `assistant` messages, the full `user` tool_result message, and one `result`.
```

**Three consequences this drives (and they are the whole design):**

1. **A turn is multiple assistant messages, and block indices reset per message.** Above, message-1's
   `thinking` and message-2's `text` are *both* `index 0`. → the accumulator must key blocks by
   **`(messageSeq, index)`**, bumping `messageSeq` on every `message_start`. An index-only buffer would
   clobber thinking with the answer.
2. **Tool status is a message-boundary fact, not a special event.** `content_block_start{tool_use}` already
   carries `{id, name}` → we render `⟳ {name}` the instant the block opens; the matching `tool_result`
   (full `user` message, matched by `tool_use_id`) flips it to `✓/✗`.
3. **The SDK delivers BOTH partials AND the full `assistant`/`user` messages.** → the renderer must **dedupe**:
   stream text/thinking from partials only; consume full messages *solely* to finalize authoritative text and
   to drive tool running→done. This makes double-rendering structurally impossible.

## Locked decisions

- **Scope:** live streaming (A) **+** a live status-bar slice (G). B–F deferred to later increments.
- **Tool status:** *collapse + update in place* — one line per tool, `⟳ {name} {target}` → `✓ {name} {target} │ {short preview}` / `✗ …`. Verbose Edit diffs and full result bodies are **deferred to increment D** (rich tool rendering).
- **Thinking:** *stream live, then collapse* — dim live while the active block; once a later block opens, replace with a single dim `✦ Thinking` marker; stays collapsed in scrollback.
- **Architecture:** a **dedicated pure reducer** (`tui/src/liveTurn.ts`), frames in → `RenderLine[]` out. Chosen over extending `render.ts` + `useChat` (which would spread stateful `(msg,index)` keying + dedup across React and break `render.ts`'s purity).

## Architecture

A single new pure module owns all streaming state; React stays thin; the engine is untouched but for one flag.

```
chat.tsx  openSession({ …, includePartialMessages: true })   ← only engine-facing change
                          │
useChat.submit(prompt) → session.submit(prompt, onMessage)
                          │ onMessage(frame)                  (stream_event | assistant | user | result | system)
                          ▼
                    LiveTurn.ingest(frame)
                          │  blocks keyed (messageSeq, index)
                          │  text/thinking ← partial deltas (dedup: never from full msg)
                          │  tool run→done ← block_start id + tool_result id
                          ▼  setStreaming(lt.snapshot())      ← per frame, live region
                    on result: setLines([...lines, ...lt.finalize()]); setStreaming([])   ← commit to scrollback
```

`Transcript` is unchanged: `<Static items={lines}>` (scrollback) + a live region mapping `streaming`.

## Components

### `tui/src/liveTurn.ts` (create) — the reducer
```ts
export class LiveTurn {
  ingest(frame: unknown): void;     // updates internal block state; ignores unknown/irrelevant frames
  snapshot(): RenderLine[];         // current live-region lines (call after each ingest)
  finalize(): RenderLine[];         // authoritative lines to commit to scrollback
  fail(message: string): void;      // append a red error line; subsequent finalize() includes it
}
```
- **State:** an ordered list of blocks, each `{ key:`${msg}:${index}`, kind:"text"|"thinking"|"tool", … }`,
  plus a `Map<toolUseId, toolBlock>` for O(1) result matching, plus `messageSeq`.
- **Pure:** no React, no SDK imports, no clock. Reuses small formatting helpers exported from `render.ts`
  (`trunc`, tool `target`) — no duplication.
- **Rendering rules:**
  - *text* — accumulate `text_delta.text` into the `(msg,index)` text block; render as plain lines. At
    `message_stop` / on the full `assistant` message, **overwrite** the block with the message's authoritative
    text (backstop against a dropped delta).
  - *thinking* — accumulate `thinking_delta.thinking`; render dim live; when a later block opens (or the turn
    ends), collapse to one dim `✦ Thinking`. `signature_delta` ignored.
  - *tool* — on `content_block_start{tool_use}`: create `{id, name, status:"running"}` → `⟳ {name} {target}`
    (target/`firstArg` from the full `assistant` message's complete `input`, which arrives right after — or
    empty until then). On the matching `tool_result`: `status` → `done`/`error`, render
    `✓ {name} {target}  │ {trunc(firstResultLine)}` or `✗ {name} {target}`. (`input_json_delta.partial_json`
    is available for live-forming args but is **deferred** — using the full message's `input` is simpler and
    sufficient.)
  - *dedup & fallback* — a block that **streamed** renders from its deltas; a full `assistant` block with **no**
    preceding partials (partials disabled, or a dropped stream) renders from the full message via `render.ts`.
    Full `assistant` messages also overwrite authoritative text + register tool_use input; full `user` messages
    flip tool status. Each block renders **exactly once** — never twice.

### `tui/src/useChat.ts` (modify)
- In `submit`, replace the `acc.push(...renderMessage(m))` accumulation with a per-turn `LiveTurn`: each
  `onMessage(m)` → `lt.ingest(m); if (!disposed) setStreaming(lt.snapshot())`. On the promise settling, commit
  `lt.finalize()` to `lines` and clear `streaming` (reject path → `lt.fail(msg)` first). The `disposed` guard
  and `refreshCtx()` are preserved.
- Track `model`: add `model?: string` to `ChatState`; fetch once (best-effort, like `refreshCtx`) via a new
  optional `initializationResult?()` on the `ChatSession` interface (the real `Session` provides it; test fakes
  may omit it). Resolve the active model from its result; tolerate absence.

### `tui/src/render.ts` (modify, minimal)
- Stays pure and keeps `renderMessage` — now used by the reducer to render a full-message block that arrived
  **without** partials (the fallback path) and as the authoritative-text source at finalize. **Export** the
  small helpers the reducer reuses (`trunc`, and a `toolTarget(name,input)` extracted from today's
  `toolUseLines` so the running line and the diff path share one formatter).

### `tui/src/ChatStatusBar.tsx` (modify)
- Add `model?: string` (render `model {name}` when present) and make the activity segment a live streaming
  indicator: `⟳ streaming` while `busy` (replacing `…working`). Keep mode (color-coded), `ctx%`, and the
  hint segment.

### `tui/src/ChatApp.tsx` (modify)
- Thread `state.model` and `state.busy` into `<ChatStatusBar>`. No new keys/behavior.

### `tui/src/chat.tsx` (modify)
- Add `includePartialMessages: true` to the `openSession({…})` config. (Already flows: `OpenSessionConfig
  extends HarnessConfig`; `HarnessConfig.includePartialMessages` → `resolveOptions.ts:43`.) **No harness change.**

## Data flow (one turn)

1. user submits → `setLines([...,'› prompt'])`, `setStreaming([])`, `setBusy(true)`, new `LiveTurn`.
2. SDK streams frames → each `ingest` updates blocks → `setStreaming(snapshot())` paints the live region
   (text grows, thinking streams then collapses, tools flip running→done).
3. `result` resolves the turn → `setLines([...lines, ...finalize()])`, `setStreaming([])`, `setBusy(false)`,
   `refreshCtx()`; model fetched once if not yet known.

## Error / edge handling

- **Turn rejects** → `lt.fail(message)` (red line) then finalize; partial work preserved in scrollback.
- **Esc interrupt mid-stream** → existing `interrupt()`; whatever streamed so far is finalized — no loss.
- **Unknown `stream_event` sub-types / blocks** → ignored (forward-compatible).
- **Dropped text delta** → message-completion overwrite backstops the authoritative final text.
- **`disposed`** guard preserved on every `setState`; a thinking/tool block still open at `finalize()`
  collapses / marks gracefully (no dangling `⟳`).

## Testing strategy

- **`tui/test/liveTurn.test.ts` (keyless, core):** replay the **exact probe-20 frame sequence** as fixtures →
  assert (a) snapshots grow monotonically as text deltas arrive; (b) thinking streams dim then collapses to
  `✦ Thinking`; (c) the tool goes `⟳ Read` → `✓ Read` on its `tool_result`; (d) **`(messageSeq,index)` keying
  — message-2 `text@0` does NOT overwrite message-1 `thinking@0`**; (e) the full `assistant` message does not
  double-render streamed text; (f) `fail()` appends a red line and finalize includes it.
- **Status-bar component test (keyless):** `ink-testing-library`; assert model + `⟳ streaming` while busy,
  mode color, ctx%. Carry the **`useInput` passive-effect timing discipline** (await a render tick before keys).
- **One gated live test** (`tui/test/live/`, `ANTHROPIC_API_KEY`, skips cleanly without): a real turn through
  `openSession({includePartialMessages:true})` — assert ≥2 distinct streaming snapshots (proves live growth),
  a correct final transcript, and a status bar showing a model + ctx%. Wrapped in try/finally teardown.

## Out of scope (explicit)

- Verbose Edit/Write diffs and full tool-result bodies in the live region (→ increment D).
- Slash commands, model-switch UI, input ergonomics, session resume (→ B/C/E/F).
- The daemon console (`cc-harness-console`) streaming — increment 5 is the **lib chat REPL only**; the daemon
  path (`DaemonSession` via supervisor) is untouched.
- `input_json_delta` live-forming tool args (available, deferred).

## Global constraints (verbatim)

- **No Prettier — dense hand-style;** match surrounding code (compact, multi-statement lines).
- **ESM `.js` import specifiers** in `tui/` (`from "./liveTurn.js"`); bare `"cc-harness"` for engine imports.
- **`tui/` build-first rule:** `cc-harness` must be built (`cd ../harness && npm run build`) before `tui`
  typecheck/tests resolve types — but **this increment needs no harness rebuild** (no engine source change).
- **ink `useInput` passive-effect timing discipline** in component/app tests; never swap to raw stdin; never
  mutate shared components.
- Keep modules small/focused; `liveTurn.ts` is a new module precisely to keep `useChat.ts`/`render.ts` lean.
- Live tests gate on `ANTHROPIC_API_KEY` from `CC-to-SDK/.env` (never committed/printed); keyless suites must
  skip cleanly without a key.
