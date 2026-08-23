# Grounding — the three open product decisions (images · dynamic tools · cross-session)

**Date:** 2026-08-23 · **Branch:** `backlog-archive-race` · **Kind:** grounding pass. Not a design — each
section ends at the fork the owner has to call, with a recommendation. Sources are cited per claim; the
Codex shapes are read from this fork's own `codex-rs` tree, the SDK facts from the installed 0.3.237 and
this repo's live probes.

---

## 1. An image surface for the app-server (scorecard gap 11)

### What Codex ships

`codex-rs/app-server-protocol/src/protocol/v2/turn.rs` — turn input is a `Vec<UserInput>` whose variants
include, beside `Text`:

- `Image { url, detail? }` — an image by URL (data: URLs included, so remote-safe);
- `LocalImage { path, detail? }` — an image by filesystem path (a shared-filesystem assumption, made
  openly: the IDE client and the server sit on one machine);
- also `Audio { url }` / `LocalAudio { path }` / `Skill` / `Mention` — the input enum is a general
  attachment surface, not an image special-case.

**No staging op anywhere.** Codex never moves image bytes over its control channel at all: a path or a
URL is the whole transport story.

### What we have, layer by layer

- **Engine (live-verified):** `session/turnInput.ts` — a turn's input is content blocks, and a base64
  image block (`{type:"image", source:{type:"base64", media_type, data}}`) is the ONE way an image
  reaches a turn. Bytes are re-decoded and verified, never caller-trusted. This layer is done and live.
- **Host wire (F9 T-IMAGE):** `host/ops.ts` `stageImage` + `prompt.images` claims — a negotiated staging
  protocol (mint a `0600` file, client writes bytes over the filesystem, claims by id+sha256), built
  because the host control socket bounds client frames at 256 KiB. `host/imageStaging.ts` owns mint /
  verify / orphan-sweep.
- **App-server: nothing** (gap 11). No method names an image; a fleet-origin thread cannot send one.

### The constraint that decides the shape

The app-server's inbound cap is **the same 256 KiB** (`peer.ts` MAX_IN; `transport/ws.ts` sets
`maxPayload` to it plus headroom). So "just take base64 on `turn/start`" does not fit the wire as it
stands — the exact pressure that produced the host's staging protocol. But unlike the host socket, the
app-server's transport seam is a WebSocket an embedder may bind anywhere: **a remote client is possible in
principle**, and a filesystem-staging method quietly reintroduces the shared-fs assumption for them.

### The fork (owner's call)

1. **Mirror Codex:** `Image{url}` + `LocalImage{path}` variants on turn input. Cheap, canon-shaped, and
   the local variant is honest about its shared-fs assumption (Codex makes the same one). data: URLs
   under 256 KiB ride the wire as-is; big remote images come by URL.
2. **Mirror our host wire:** a `turn/stageImage` method + claim list — one staging story everywhere,
   verified bytes, but shared-fs assumed and a bigger method surface.
3. **Both** (URL variant for remote, staging for local big-bytes), or **decline** (flip the row to `N/A
   — decided not to expose`).

**Recommendation:** option 1. It is the smallest surface that unblocks a fleet thread sending an image,
matches canon, and does not pre-commit the staging protocol to a second wire before anything needs it.
The scorecard row then moves `unscored → shipped` (or the `prompt.images` field-level note stays, since
the host wire remains its own transport).

---

## 2. Dynamic tools (the M6 candidate — the one genuine reverse-request feature)

### What Codex ships (read verbatim from `codex_protocol::dynamic_tools` + `common.rs`)

- **Declaration**, at `thread/start`: `dynamic_tools: Option<Vec<DynamicToolSpec>>` where a spec is
  `Function { name, description, inputSchema (raw JSON Schema), deferLoading }` or
  `Namespace { name, description, tools: [Function…] }`.
- **The reverse request**, server→client: `item/tool/call` — `DynamicToolCallRequest { callId, turnId,
  startedAtMs, namespace?, tool, arguments }` answered by `DynamicToolResponse { contentItems:
  [InputText | InputImage | InputAudio], success }`. The client **is** the tool runtime; the server
  blocks the model turn on the client's answer.

### What the SDK gives us to implement it

- `createSdkMcpServer` + `tool()` — in-process tools whose handler is a JS function. The natural
  runtime: register the client's declared tools as an in-process MCP server whose every handler
  forwards over the app-server socket and awaits the client's response. MCP tool results are content
  blocks (text/image), which map onto Codex's `contentItems` almost one-to-one.
- `deferLoading` maps onto measured SDK behavior for free: custom MCP tool schemas already load lazily
  behind ToolSearch ([[sdk-mcp-tools-deferred-not-inline]]).
- Namespaces map onto MCP server names (`mcp__<ns>__<tool>`).
- Known hazard to design around: native tool names shadow MCP tools, and permission wiring
  (disallow/allow/broker) must name them explicitly ([[sdk-mcp-tool-shadowing-and-permission]]).

### What it costs our protocol

This is the **deliberate D1 breach**: today every request on our wire is client→server; the server only
notifies. A dynamic tool call is a server→client REQUEST with an id awaiting a response — new frame
discipline (ids minted by the server, response routing, per-call timeout, what happens on client
disconnect mid-call, interaction with turn interrupt/park). The **fleet elicitation bridge (D-M4-8)**
wants the same reverse channel; designing the channel once for both is the reason this needs a real
design pass rather than a task.

### The fork (owner's call)

Whether to take dynamic tools as the next milestone (M7). If yes, the design pass must settle: the
reverse-request frame protocol (shared with elicitation?), disconnect/timeout semantics, permission
treatment of client tools, and how declarations interact with `thread/start`'s existing config guard.

**Recommendation:** yes, as its own milestone — it is the largest capability gap Codex still holds over
this server, the SDK runtime mapping is unusually clean, and the reverse channel it forces is the same
one two other parked features (elicitation bridge, inline review delivery) are queued behind.

---

## 3. Cross-session messaging — next phase

Grounding already complete: `docs/superpowers/specs/2026-08-22-m6-cross-session-messaging-grounding.md`.
The premise flip stands — every headless SDK session already binds an authenticated inbound UDS socket;
the receive side is not ours to build. Remaining host work is **discovery, addressing, policy, plumbing**
(that doc's §6). One observation is still open for an environmental reason: probe 113c must re-run
unchanged when the weekly quota resets (**2026-08-26 1pm**) to watch `origin.kind === 'peer'` execute as
a model turn.

### The fork (owner's call)

Open the design session now (design against the routed-and-queued evidence, with 113c's execution link as
a stated assumption to confirm on the 26th), or hold until 113c closes the last link.

**Recommendation:** hold until 2026-08-26 — the re-run is three days away, costs one probe, and the
design's central object (a message that runs as a model turn) is exactly the unobserved link. Dynamic
tools is the better use of the gap.

---

*Related memories: [[m6-backlog-round-shipped]], [[sdk-mcp-tools-deferred-not-inline]],
[[sdk-mcp-tool-shadowing-and-permission]].*
